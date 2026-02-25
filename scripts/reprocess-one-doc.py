#!/usr/bin/env python3
"""
Process ONE document at a time. Ultra-minimal memory footprint.
Usage: python3 scripts/reprocess-one-doc.py <doc_id|all>
"""
import os, sys, json, gc
import boto3
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ['DATABASE_URL'].split('?')[0]
REGION = os.environ.get('AWS_REGION', 'us-east-1')
BUCKET = os.environ.get('S3_BUCKET_NAME', 'fundlens-documents-dev')


def get_conn():
    return psycopg2.connect(DB_URL, sslmode='require')


def get_s3_text(key):
    s3 = boto3.client('s3', region_name=REGION)
    resp = s3.get_object(Bucket=BUCKET, Key=key)
    text = resp['Body'].read().decode('utf-8')
    del resp
    gc.collect()
    return text


def extract_pdf_text(s3_key):
    import io
    from PyPDF2 import PdfReader
    s3 = boto3.client('s3', region_name=REGION)
    resp = s3.get_object(Bucket=BUCKET, Key=s3_key)
    pdf_bytes = resp['Body'].read()
    del resp
    gc.collect()
    reader = PdfReader(io.BytesIO(pdf_bytes))
    parts = [page.extract_text() or '' for page in reader.pages]
    text = '\n\n'.join(parts)
    del reader, pdf_bytes, parts
    gc.collect()
    return text


def embed_text(text):
    br = boto3.client('bedrock-runtime', region_name=REGION)
    resp = br.invoke_model(
        modelId='amazon.titan-embed-text-v2:0',
        contentType='application/json',
        accept='application/json',
        body=json.dumps({
            'inputText': text[:8000],
            'dimensions': 1024,
            'normalize': True,
        }),
    )
    result = json.loads(resp['body'].read())
    emb = result['embedding']
    del resp, result, br
    gc.collect()
    return emb


def chunk_text(raw, max_chars=2400, overlap=100):
    chunks = []
    idx = 0
    start = 0
    while start < len(raw):
        end = min(start + max_chars, len(raw))
        if end < len(raw):
            seg = raw[start:end]
            bp = max(seg.rfind('. '), seg.rfind('\n'))
            if bp > max_chars * 0.5:
                end = start + bp + 1
        content = raw[start:end].strip()
        if len(content) > 50:
            chunks.append({'idx': idx, 'content': content})
            idx += 1
        start = end - overlap
        if start >= len(raw):
            break
    return chunks


def process_doc(doc_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT document_id, file_name, status, processing_mode, chunk_count, "
        "tenant_id, deal_id, raw_text_s3_key, s3_key, document_type "
        "FROM intel_documents WHERE document_id = %s::uuid", (doc_id,)
    )
    row = cur.fetchone()
    if not row:
        print(f"Document {doc_id} not found")
        conn.close()
        return False

    cols = [d[0] for d in cur.description]
    doc = dict(zip(cols, row))
    print(f"\n=== {doc['file_name']} ({doc_id}) ===")
    print(f"  status={doc['status']}, mode={doc['processing_mode']}, chunks={doc['chunk_count']}")

    # Get raw text
    raw_text = ''
    if doc['raw_text_s3_key']:
        print("  Reading raw text from S3...")
        raw_text = get_s3_text(doc['raw_text_s3_key'])
    elif doc['s3_key']:
        print("  Extracting text from PDF...")
        raw_text = extract_pdf_text(doc['s3_key'])
        raw_key = f"extracted/{doc['tenant_id']}/{doc['deal_id']}/{doc_id}/raw_text.txt"
        s3 = boto3.client('s3', region_name=REGION)
        s3.put_object(Bucket=BUCKET, Key=raw_key, Body=raw_text.encode('utf-8'), ContentType='text/plain')
        cur.execute(
            "UPDATE intel_documents SET raw_text_s3_key = %s, status = 'queryable', "
            "processing_mode = 'long-context-fallback', page_count = %s, updated_at = NOW() "
            "WHERE document_id = %s::uuid",
            (raw_key, max(1, len(raw_text) // 3000), doc_id)
        )
        conn.commit()
        print(f"  Extracted {len(raw_text)} chars")
        del s3
        gc.collect()
    else:
        print("  No text source")
        conn.close()
        return False

    if len(raw_text) < 100:
        print("  Text too short")
        conn.close()
        return False

    print(f"  Raw text: {len(raw_text)} chars")

    # Clear existing chunks
    cur.execute("DELETE FROM intel_document_chunks WHERE document_id = %s::uuid", (doc_id,))
    conn.commit()

    # Chunk
    chunks = chunk_text(raw_text)
    del raw_text
    gc.collect()
    print(f"  Created {len(chunks)} chunks")

    # Embed + index one at a time
    indexed = 0
    for i, chunk in enumerate(chunks):
        try:
            emb = embed_text(chunk['content'])
            emb_str = '[' + ','.join(str(x) for x in emb) + ']'
            del emb

            cur.execute(
                "INSERT INTO intel_document_chunks "
                "(id, document_id, tenant_id, deal_id, chunk_index, content, section_type, "
                "token_estimate, embedding, created_at) "
                "VALUES (gen_random_uuid(), %s::uuid, %s::uuid, %s::uuid, %s, %s, 'narrative', %s, %s::vector, NOW())",
                (doc_id, str(doc['tenant_id']), str(doc['deal_id']),
                 chunk['idx'], chunk['content'],
                 len(chunk['content']) // 4, emb_str)
            )
            conn.commit()
            del emb_str
            gc.collect()
            indexed += 1

            if (i + 1) % 3 == 0 or i == len(chunks) - 1:
                print(f"  Indexed {indexed}/{len(chunks)} chunks")
        except Exception as e:
            print(f"  Chunk {i} failed: {e}")
            conn.rollback()

    # Update document
    cur.execute(
        "UPDATE intel_documents SET processing_mode = 'fully-indexed', chunk_count = %s, "
        "status = 'queryable', error = NULL, updated_at = NOW() WHERE document_id = %s::uuid",
        (indexed, doc_id)
    )
    conn.commit()
    print(f"  ✅ {indexed} chunks indexed")
    conn.close()
    return True


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else 'all'

    if target == 'all':
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT document_id FROM intel_documents ORDER BY created_at")
        doc_ids = [r[0] for r in cur.fetchall()]
        conn.close()
        print(f"Processing {len(doc_ids)} documents")
        for did in doc_ids:
            process_doc(str(did))
            gc.collect()
    else:
        process_doc(target)

    # Final status
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT file_name, status, processing_mode, chunk_count FROM intel_documents ORDER BY created_at")
    print("\n========== FINAL STATUS ==========")
    for row in cur.fetchall():
        icon = '✅' if row[2] == 'fully-indexed' and (row[3] or 0) > 0 else '⚠️'
        print(f"{icon} {row[0]}: status={row[1]}, mode={row[2]}, chunks={row[3]}")
    cur.execute("SELECT COUNT(*) FROM intel_document_chunks")
    print(f"Total chunks: {cur.fetchone()[0]}")
    conn.close()


if __name__ == '__main__':
    main()
