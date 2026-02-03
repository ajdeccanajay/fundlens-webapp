#!/usr/bin/env node

/**
 * Check Document Sync Status
 * 
 * Verifies if uploaded documents have been:
 * 1. Processed (text extracted, chunked)
 * 2. Stored in PostgreSQL
 * 3. Synced to Bedrock KB
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkDocumentSyncStatus() {
  console.log('🔍 Checking document sync status...\n');

  try {
    // Get all user-uploaded documents
    const documents = await prisma.document.findMany({
      where: {
        sourceType: 'USER_UPLOAD',
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            chunks: true,
          },
        },
      },
    });

    if (documents.length === 0) {
      console.log('❌ No uploaded documents found');
      return;
    }

    console.log(`📄 Found ${documents.length} uploaded document(s)\n`);

    for (const doc of documents) {
      console.log('─'.repeat(80));
      console.log(`📄 ${doc.title}`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Ticker: ${doc.ticker}`);
      console.log(`   File Type: ${doc.fileType}`);
      console.log(`   File Size: ${(Number(doc.fileSize) / 1024).toFixed(2)} KB`);
      console.log(`   Uploaded: ${doc.createdAt.toLocaleString()}`);
      console.log(`   Tenant: ${doc.tenantId}`);
      console.log();

      // Check processing status
      if (!doc.processed) {
        console.log('   ⏳ Status: PROCESSING');
        console.log('   ⚠️  Document is still being processed');
      } else if (doc.processingError) {
        console.log('   ❌ Status: FAILED');
        console.log(`   ⚠️  Error: ${doc.processingError}`);
      } else {
        console.log('   ✅ Status: PROCESSED');
      }

      // Check chunks
      const chunkCount = doc._count.chunks;
      console.log(`   📦 Chunks: ${chunkCount}`);

      if (chunkCount === 0 && doc.processed && !doc.processingError) {
        console.log('   ⚠️  Warning: Processed but no chunks found');
      } else if (chunkCount > 0) {
        console.log('   ✅ Chunks stored in PostgreSQL');

        // Check if chunks have embeddings
        const chunksWithEmbeddings = await prisma.$queryRaw`
          SELECT COUNT(*) as count
          FROM document_chunks
          WHERE document_id = ${doc.id}
          AND embedding IS NOT NULL
        `;

        const embeddingCount = Number(chunksWithEmbeddings[0].count);
        console.log(`   🧮 Embeddings: ${embeddingCount}/${chunkCount}`);

        if (embeddingCount === chunkCount) {
          console.log('   ✅ All chunks have embeddings');
        } else {
          console.log('   ⚠️  Some chunks missing embeddings');
        }
      }

      // Check KB sync status (if kb_sync_tracking table exists)
      try {
        const syncStatus = await prisma.$queryRaw`
          SELECT 
            sync_status,
            last_synced_at,
            sync_error
          FROM kb_sync_tracking
          WHERE document_id = ${doc.id}
          ORDER BY last_synced_at DESC
          LIMIT 1
        `;

        if (syncStatus.length > 0) {
          const status = syncStatus[0];
          console.log(`   🔄 KB Sync: ${status.sync_status}`);
          if (status.last_synced_at) {
            console.log(`   📅 Last Synced: ${new Date(status.last_synced_at).toLocaleString()}`);
          }
          if (status.sync_error) {
            console.log(`   ⚠️  Sync Error: ${status.sync_error}`);
          }
          if (status.sync_status === 'synced') {
            console.log('   ✅ Synced to Bedrock KB');
          }
        } else {
          console.log('   ⏳ KB Sync: Pending or no tracking data');
        }
      } catch (error) {
        // kb_sync_tracking table might not exist
        console.log('   ℹ️  KB sync tracking not available');
      }

      // Overall status
      console.log();
      if (doc.processed && !doc.processingError && chunkCount > 0) {
        console.log('   🎉 READY FOR SEARCH');
        console.log('   ✅ Document is indexed and searchable');
      } else if (!doc.processed) {
        console.log('   ⏳ PROCESSING');
        console.log('   ⏱️  Wait 30-60 seconds and check again');
      } else if (doc.processingError) {
        console.log('   ❌ FAILED');
        console.log('   ⚠️  Document processing failed');
      } else {
        console.log('   ⚠️  INCOMPLETE');
        console.log('   ⚠️  Document processed but chunks missing');
      }

      console.log();
    }

    console.log('─'.repeat(80));
    console.log();

    // Summary
    const processed = documents.filter(d => d.processed && !d.processingError).length;
    const processing = documents.filter(d => !d.processed).length;
    const failed = documents.filter(d => d.processingError).length;

    console.log('📊 Summary:');
    console.log(`   ✅ Processed: ${processed}`);
    console.log(`   ⏳ Processing: ${processing}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📄 Total: ${documents.length}`);

  } catch (error) {
    console.error('❌ Error checking sync status:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  checkDocumentSyncStatus()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { checkDocumentSyncStatus };
