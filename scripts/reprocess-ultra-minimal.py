#!/usr/bin/env python3
"""
Ultra-minimal document reprocessor.
Uses aws CLI subprocess for Bedrock calls to minimize memory.
Processes ONE chunk at a time with aggressive GC.
"""
import os, sys, json, gc, subprocess
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.environ['DATABASE_URL'].split('?')[0]
REGION = os.environ.get('AWS_REGION', 'us-east-1')
BUCKET = os.environ.get('S3_BUCKET_NAME', 'fundlens-documents-dev')


def get_conn():
    return psycopg2.connect(DB_URL, sslmode='require')


def get_s3_text(key):
    """Download text from S3 using aws CLI (no boto3 memory overhead)."""
    result = subprocess.run(
        ['aws', 's3', 'cp', f's3://{BUCKET}/{key}', '/tmp/raw_text.txt', '--region', REGION],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise Exception(f"S3 download failed: {result.stderr}")
    with open('/tmp/raw_text.txt', 'r') as f:
        text = f.read()
    os.remove('/tmp/raw_text.txt')
    return text


def embed_text_via_cli(text):
    """Get embedding using aws CLI subprocess (no boto3 in-process)."""
    payload = json.dumps({
        'inputText': text[:8000],
        'dimensions': 1024,
        'normalize': True,
    })
    with open('/tmp/emb_in.json', 'w') as f:
        f.write(payload)

    result = subprocess.run(
        ['aws', 'bedrock-runtime', 'invoke-model',
         '--model-id', 'amazon.titan-embed-text-v2:0',
         '--content-type', 'application/json',
         '--accept', 'application/json',
         '--region', REGION,
         '--body', 'fileb:///tmp/emb_in.json',
         '/tmp/emb_out.json'],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise Exception(f"Bedrock invoke failed: {result.stderr}")

    with open('/tmp/emb_out.json', 'r') as f:
        resp = json.load(f)

    os.remove('/tmp/emb_in.json')
    os.remove('/tmp/emb_out.json')
    return resp['embedding']


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
        # Always advance by at least 1 char to prevent infinite loop
        new_start = end - overlap
        if new_start <= start:
            new_start = start + max_chars
        start = new_start
    return chunks


def process_doc(doc_id, tenant_id, deal_id, raw_text_key, file_name):
    print(f"\n=== {file_name} ({doc_id}) ===")

    # Get raw text
    print("  Downloading raw text...")
    raw_text = get_s3_text(raw_text_key)
    print(f"  {len(raw_text)} chars")

    if len(raw_text) < 100:
        print("  Text too short, skipping")
        return

    # Chunk
    chunks = chunk_text(raw_text)
    del raw_text
    gc.collect()
    print(f"  {len(chunks)} chunks")

    # Clear existing chunks
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM intel_document_chunks WHERE document_id = %s::uuid", (doc_id,))
    conn.commit()

    # Embed + index one at a time
    indexed = 0
    for i, chunk in enumerate(chunks):
        try:
            emb = embed_text_via_cli(chunk['content'])
            emb_str = '[' + ','.join(str(x) for x in emb) + ']'
            del emb
            gc.collect()

            cur.execute(
                "INSERT INTO intel_document_chunks "
                "(id, document_id, tenant_id, deal_id, chunk_index, content, section_type, "
                "token_estimate, embedding, created_at) "
                "VALUES (gen_random_uuid(), %s::uuid, %s::uuid, %s::uuid, %s, %s, 'narrative', %s, %s::vector, NOW())",
                (doc_id, tenant_id, deal_id,
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

    # Update document status
    cur.execute(
        "UPDATE intel_documents SET processing_mode = 'fully-indexed', chunk_count = %s, "
        "status = 'queryable', error = NULL, updated_at = NOW() WHERE document_id = %s::uuid",
        (indexed, doc_id)
    )
    conn.commit()
    conn.close()
    print(f"  ✅ {indexed} chunks indexed")


def main():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT document_id, file_name, tenant_id, deal_id, raw_text_s3_key "
        "FROM intel_documents WHERE raw_text_s3_key IS NOT NULL ORDER BY created_at"
    )
    docs = cur.fetchall()
    conn.close()

    print(f"Processing {len(docs)} documents")
    for doc_id, file_name, tenant_id, deal_id, raw_key in docs:
        process_doc(str(doc_id), str(tenant_id), str(deal_id), raw_key, file_name)
        gc.collect()

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
