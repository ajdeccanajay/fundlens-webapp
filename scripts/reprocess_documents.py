#!/usr/bin/env python3
"""
Direct document reprocessing using Python (avoids Node 25 OOM bug).
Reads raw text from S3, chunks it, embeds with Titan V2, stores in pgvector.

Usage: python3 scripts/reprocess_documents.py
"""
import os
import json
import boto3
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ['DATABASE_URL']
REGION = os.environ.get('AWS_REGION', 'us-east-1')
S3_BUCKET = os.environ.get('S3_BUCKET_NAME', 'fundlens-documents-dev')

s3 = boto3.client('s3', region_name=REGION)
bedrock = boto3.client('bedrock-runtime', region_name=REGION)


def get_s3_text(key):
    resp = s3.get_object(Bucket=S3_BUCKET, Key=key)
    return resp['Body'].read().decode('utf-8')


def generate_embedding(text, dims=1024):
    """Generate embedding using Titan V2. Returns list of floats."""
    truncated = text[:32000]
    resp = bedrock.invoke_model(
        modelId='amazon.titan-embed-text-v2:0',
        contentType='application/json',
        accept='application/json',
        body=json.dumps({
            'inputText': truncated,
            'dimensions': dims,
            'normalize': True,
        }),
    )
    result = json.loads(resp['body'].read())
    return result['embedding']


def chunk_text(raw_text, max_chars=2400, overlap=100):
    """Split text into chunks with overlap."""
    chunks = []
    idx = 0
    start = 0
    while start < len(raw_text):
        end = min(start + max_chars, len(raw_text))
        if end < len(raw_text):
            seg = raw_text[start:end]
            bp = max(seg.rfind('. '), seg.rfind('\n'))
            if bp > max_chars * 0.5:
                end = start + bp + 1
        content = raw_text[start:end].strip()
        if len(content) > 50:
            chunks.append({'idx': idx, 'content': content, 'section': 'narrative'})
            idx += 1
        start = end - overlap
        if start >= len(raw_text):
            break
    return chunks


def extract_text_from_pdf(s3_key):
    """Download PDF from S3 and extract text using PyPDF2."""
    import io
    try:
        from PyPDF2 import PdfReader
    except ImportError:
        print("  Installing PyPDF2...")
        import subprocess
        subprocess.check_call(['pip3', 'install', 'PyPDF2', '-q'])
        from PyPDF2 import PdfReader

    resp = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
    pdf_bytes = resp['Body'].read()
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text_parts = []
    for page in reader.pages:
        text_parts.append(page.extract_text() or '')
    return '\n\n'.join(text_parts)


def process_document(conn, doc):
    doc_id = doc['document_id']
    print(f"\n=== {doc['file_name']} ({doc_id}) ===")
    print(f"  status={doc['status']}, mode={doc['processing_mode']}, chunks={doc['chunk_count']}")

    # Step 1: Get raw text
    raw_text = ''
    if doc['raw_text_s3_key']:
        print(f"  Reading raw text from S3...")
        raw_text = get_s3_text(doc['raw_text_s3_key'])
    elif doc['s3_key']:
        print(f"  Extracting text from PDF...")
        raw_text = extract_text_from_pdf(doc['s3_key'])
        # Store raw text to S3
        raw_key = f"extracted/{doc['tenant_id']}/{doc['deal_id']}/{doc_id}/raw_text.txt"
        s3.put_object(Bucket=S3_BUCKET, Key=raw_key, Body=raw_text.encode('utf-8'), ContentType='text/plain')
        cur = conn.cursor()
        cur.execute(
            "UPDATE intel_documents SET raw_text_s3_key = %s, status = 'queryable', "
            "processing_mode = 'long-context-fallback', page_count = %s, updated_at = NOW() "
            "WHERE document_id = %s::uuid",
            (raw_key, max(1, len(raw_text) // 3000), doc_id)
        )
        conn.commit()
        print(f"  Extracted {len(raw_text)} chars")
    else:
        print("  ❌ No text source")
        return False

    print(f"  Raw text: {len(raw_text)} chars")

    # Step 2: Clean existing chunks
    cur = conn.cursor()
    cur.execute("DELETE FROM intel_document_chunks WHERE document_id = %s::uuid", (doc_id,))
    conn.commit()

    # Step 3: Chunk
    chunks = chunk_text(raw_text)
    print(f"  Created {len(chunks)} chunks")
    if not chunks:
        return False

    # Step 4: Embed and index one at a time
    indexed = 0
    for i, chunk in enumerate(chunks):
        try:
            embedding = generate_embedding(chunk['content'])
            emb_str = '[' + ','.join(str(x) for x in embedding) + ']'

            cur = conn.cursor()
            cur.execute(
                "INSERT INTO intel_document_chunks "
                "(id, document_id, tenant_id, deal_id, chunk_index, content, section_type, "
                "token_estimate, embedding, created_at) "
                "VALUES (gen_random_uuid(), %s::uuid, %s::uuid, %s::uuid, %s, %s, %s, %s, %s::vector, NOW())",
                (doc_id, doc['tenant_id'], doc['deal_id'],
                 chunk['idx'], chunk['content'], chunk['section'],
                 len(chunk['content']) // 4, emb_str)
            )
            conn.commit()
            indexed += 1

            if (i + 1) % 5 == 0 or i == len(chunks) - 1:
                print(f"  Indexed {indexed}/{len(chunks)} chunks")
        except Exception as e:
            print(f"  ⚠️ Chunk {i} failed: {e}")
            conn.rollback()

    # Step 5: Update document
    cur = conn.cursor()
    cur.execute(
        "UPDATE intel_documents SET processing_mode = 'fully-indexed', chunk_count = %s, "
        "status = 'queryable', error = NULL, updated_at = NOW() WHERE document_id = %s::uuid",
        (indexed, doc_id)
    )
    conn.commit()
    print(f"  ✅ DONE: {indexed} chunks indexed")
    return True


def main():
    # Strip Prisma-specific params from DATABASE_URL
    db_url = DB_URL.split('?')[0]
    conn = psycopg2.connect(db_url, sslmode='require')
    print("Connected to DB")

    cur = conn.cursor()
    cur.execute(
        "SELECT document_id, file_name, status, processing_mode, chunk_count, "
        "tenant_id, deal_id, raw_text_s3_key, s3_key, file_type "
        "FROM intel_documents ORDER BY created_at"
    )
    columns = [desc[0] for desc in cur.description]
    docs = [dict(zip(columns, row)) for row in cur.fetchall()]
    print(f"Found {len(docs)} documents")

    for doc in docs:
        try:
            process_document(conn, doc)
        except Exception as e:
            print(f"  ❌ Failed: {e}")
            conn.rollback()

    # Final status
    print("\n========== FINAL STATUS ==========")
    cur = conn.cursor()
    cur.execute(
        "SELECT file_name, status, processing_mode, chunk_count, metric_count "
        "FROM intel_documents ORDER BY created_at"
    )
    for row in cur.fetchall():
        icon = '✅' if row[2] == 'fully-indexed' and (row[3] or 0) > 0 else '⚠️'
        print(f"{icon} {row[0]}: status={row[1]}, mode={row[2]}, chunks={row[3]}")

    conn.close()


if __name__ == '__main__':
    main()
