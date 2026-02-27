/**
 * Document Indexing Service — Spec §3.4 Step 4, §7.1 Source 2
 *
 * Embeds document chunks with Titan V2 and stores in pgvector
 * for tenant-scoped vector similarity search.
 *
 * Uses the same embedding model (amazon.titan-embed-text-v2:0, 1024 dims)
 * as Bedrock KB to ensure consistent relevance rankings (Spec §6.1).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../rag/bedrock.service';
import { S3Service } from '../services/s3.service';
import { DocumentChunk } from './document-chunking.service';

export interface IndexedChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  sectionType: string;
  pageNumber?: number;
}

export interface VectorSearchResult {
  id: string;
  documentId: string;
  content: string;
  sectionType: string;
  pageNumber: number | null;
  fileName: string;
  documentType: string;
  companyTicker: string | null;
  score: number;
}

@Injectable()
export class DocumentIndexingService {
  private readonly logger = new Logger(DocumentIndexingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
    @Optional() private readonly s3?: S3Service,
  ) {}

  /**
   * Embed and index chunks for a document.
   * Stores in intel_document_chunks table with pgvector embeddings.
   */
  async indexChunks(
    documentId: string,
    tenantId: string,
    dealId: string,
    chunks: DocumentChunk[],
  ): Promise<number> {
    if (chunks.length === 0) return 0;

    this.logger.log(
      `[${documentId}] Indexing ${chunks.length} chunks with Titan V2 embeddings`,
    );

    const batchSize = 10; // Titan V2 rate limit friendly
    let indexed = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(chunks.length / batchSize);

      try {
        // Generate embeddings in parallel
        const embeddings = await Promise.all(
          batch.map(chunk => this.bedrock.generateEmbedding(chunk.content)),
        );

        // Insert chunks with embeddings
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];
          const embeddingStr = `[${embedding.join(',')}]`;

          await this.prisma.$executeRaw`
            INSERT INTO intel_document_chunks (
              id, document_id, tenant_id, deal_id,
              chunk_index, content, section_type, page_number,
              token_estimate, embedding, created_at
            ) VALUES (
              gen_random_uuid(),
              ${documentId}::uuid,
              ${tenantId}::uuid,
              ${dealId}::uuid,
              ${chunk.chunkIndex},
              ${chunk.content},
              ${chunk.sectionType || 'narrative'},
              ${chunk.pageNumber || null},
              ${chunk.tokenEstimate},
              ${embeddingStr}::vector,
              NOW()
            )
          `;
          indexed++;
        }

        this.logger.log(
          `[${documentId}] Batch ${batchNum}/${totalBatches} indexed (${indexed}/${chunks.length})`,
        );
      } catch (error) {
        this.logger.error(
          `[${documentId}] Batch ${batchNum} failed: ${error.message}`,
        );
        // Continue with remaining batches
      }
    }

    this.logger.log(`[${documentId}] Indexed ${indexed}/${chunks.length} chunks`);
    return indexed;
  }

  /**
   * Vector similarity search across uploaded document chunks.
   * Spec §7.1 Source 2: OpenSearch ephemeral (we use pgvector equivalent).
   * Tenant-scoped (cross-deal) — searches ALL uploaded docs for the tenant.
   * Optionally filters by companyTicker if provided.
   */
  async searchChunks(
    query: string,
    tenantId: string,
    dealId: string,
    options: { topK?: number; minScore?: number; companyTicker?: string } = {},
  ): Promise<VectorSearchResult[]> {
    const topK = options.topK || 10;
    const minScore = options.minScore || 0.5;

    try {
      const queryEmbedding = await this.bedrock.generateEmbedding(query);
      const embeddingStr = `[${queryEmbedding.join(',')}]`;

      // Tenant-scoped search (cross-deal) — finds docs uploaded under ANY deal
      // Optionally filter by company_ticker on intel_documents if provided
      let sql: string;
      let params: any[];

      if (options.companyTicker) {
        sql = `
          SELECT
            c.id,
            c.document_id AS "documentId",
            c.content,
            c.section_type AS "sectionType",
            c.page_number AS "pageNumber",
            d.file_name AS "fileName",
            d.document_type AS "documentType",
            d.company_ticker AS "companyTicker",
            1 - (c.embedding <=> $1::vector) AS score
          FROM intel_document_chunks c
          JOIN intel_documents d ON c.document_id = d.document_id
          WHERE c.tenant_id = $2::uuid
            AND UPPER(d.company_ticker) = UPPER($3)
            AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> $1::vector
          LIMIT $4
        `;
        params = [embeddingStr, tenantId, options.companyTicker, topK];
      } else {
        sql = `
          SELECT
            c.id,
            c.document_id AS "documentId",
            c.content,
            c.section_type AS "sectionType",
            c.page_number AS "pageNumber",
            d.file_name AS "fileName",
            d.document_type AS "documentType",
            d.company_ticker AS "companyTicker",
            1 - (c.embedding <=> $1::vector) AS score
          FROM intel_document_chunks c
          JOIN intel_documents d ON c.document_id = d.document_id
          WHERE c.tenant_id = $2::uuid
            AND c.embedding IS NOT NULL
          ORDER BY c.embedding <=> $1::vector
          LIMIT $3
        `;
        params = [embeddingStr, tenantId, topK];
      }

      const results = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);
      const filtered = results.filter(r => r.score >= minScore);

      this.logger.log(
        `Vector search (tenant-scoped${options.companyTicker ? `, ticker=${options.companyTicker}` : ''}): ${filtered.length} chunks above ${minScore} threshold (top score: ${filtered[0]?.score?.toFixed(3) || 'N/A'})`,
      );

      return filtered;
    } catch (error) {
      this.logger.error(`Vector search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Query extracted metrics from intel_document_extractions.
   * Spec §7.1 Source 1: Deterministic metric lookup (< 50ms).
   * Tenant-scoped (cross-deal) — searches ALL uploaded docs for the tenant.
   * Optionally filters by companyTicker if provided.
   */
  async queryMetrics(
    metricKeys: string[],
    tenantId: string,
    dealId: string,
    options: { companyTicker?: string } = {},
  ): Promise<any[]> {
    if (metricKeys.length === 0) return [];

    try {
      // Tenant-scoped search (cross-deal) — finds extractions from ANY deal
      // Optionally filter by company_ticker on intel_documents if provided
      let sql: string;
      let params: any[];

      if (options.companyTicker) {
        sql = `
          SELECT
            e.id,
            e.document_id AS "documentId",
            e.data,
            e.confidence,
            e.verified,
            e.page_number AS "pageNumber",
            d.file_name AS "fileName",
            d.document_type AS "documentType",
            d.company_ticker AS "companyTicker"
          FROM intel_document_extractions e
          JOIN intel_documents d ON e.document_id = d.document_id
          WHERE e.tenant_id = $1::uuid
            AND UPPER(d.company_ticker) = UPPER($2)
            AND e.extraction_type IN ('metric', 'headline')
            AND e.data->>'metric_key' = ANY($3::text[])
          ORDER BY e.confidence DESC
        `;
        params = [tenantId, options.companyTicker, metricKeys];
      } else {
        sql = `
          SELECT
            e.id,
            e.document_id AS "documentId",
            e.data,
            e.confidence,
            e.verified,
            e.page_number AS "pageNumber",
            d.file_name AS "fileName",
            d.document_type AS "documentType",
            d.company_ticker AS "companyTicker"
          FROM intel_document_extractions e
          JOIN intel_documents d ON e.document_id = d.document_id
          WHERE e.tenant_id = $1::uuid
            AND e.extraction_type IN ('metric', 'headline')
            AND e.data->>'metric_key' = ANY($2::text[])
          ORDER BY e.confidence DESC
        `;
        params = [tenantId, metricKeys];
      }

      const results = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);

      this.logger.log(
        `Metric lookup (tenant-scoped${options.companyTicker ? `, ticker=${options.companyTicker}` : ''}): found ${results.length} metrics for keys [${metricKeys.join(', ')}]`,
      );

      return results.map(r => ({
        ...r,
        metricKey: r.data?.metric_key,
        rawValue: r.data?.raw_value,
        numericValue: r.data?.numeric_value,
        period: r.data?.period,
        isEstimate: r.data?.is_estimate,
        source: `${r.fileName} (uploaded)`,
      }));
    } catch (error) {
      this.logger.error(`Metric query failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Delete all chunks for a document (for re-indexing).
   */
  async deleteChunks(documentId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM intel_document_chunks
      WHERE document_id = ${documentId}::uuid
    `;
  }

  /**
   * Fetch raw text snippets from long-context-fallback documents.
   * When docs have no chunks/embeddings (long-context-fallback mode),
   * this retrieves the raw text from S3 so it can be used as narrative context.
   * Returns up to maxDocs documents, each capped at maxCharsPerDoc.
   */
  async getLongContextFallbackText(
    tenantId: string,
    options: { companyTicker?: string; maxDocs?: number; maxCharsPerDoc?: number } = {},
  ): Promise<{ documentId: string; fileName: string; companyTicker: string; content: string }[]> {
    const maxDocs = options.maxDocs || 2;
    const maxCharsPerDoc = options.maxCharsPerDoc || 6000;

    if (!this.s3) {
      this.logger.warn('S3 service not available for long-context-fallback retrieval');
      return [];
    }

    try {
      // Find long-context-fallback docs with no chunks
      let sql: string;
      let params: any[];

      if (options.companyTicker) {
        sql = `
          SELECT d.document_id, d.file_name, d.company_ticker, d.raw_text_s3_key
          FROM intel_documents d
          WHERE d.tenant_id = $1::uuid
            AND d.processing_mode = 'long-context-fallback'
            AND d.status IN ('queryable', 'fully-indexed')
            AND d.raw_text_s3_key IS NOT NULL
            AND UPPER(d.company_ticker) = UPPER($2)
          ORDER BY d.created_at DESC
          LIMIT $3
        `;
        params = [tenantId, options.companyTicker, maxDocs];
      } else {
        sql = `
          SELECT d.document_id, d.file_name, d.company_ticker, d.raw_text_s3_key
          FROM intel_documents d
          WHERE d.tenant_id = $1::uuid
            AND d.processing_mode = 'long-context-fallback'
            AND d.status IN ('queryable', 'fully-indexed')
            AND d.raw_text_s3_key IS NOT NULL
          ORDER BY d.created_at DESC
          LIMIT $2
        `;
        params = [tenantId, maxDocs];
      }

      const docs = await this.prisma.$queryRawUnsafe<any[]>(sql, ...params);
      if (docs.length === 0) return [];

      this.logger.log(`📄 Found ${docs.length} long-context-fallback docs for retrieval`);

      const results: { documentId: string; fileName: string; companyTicker: string; content: string }[] = [];

      for (const doc of docs) {
        try {
          const buf = await this.s3.getFileBuffer(doc.raw_text_s3_key);
          const fullText = buf.toString('utf-8');
          const content = fullText.substring(0, maxCharsPerDoc);
          results.push({
            documentId: doc.document_id,
            fileName: doc.file_name,
            companyTicker: doc.company_ticker || '',
            content,
          });
          this.logger.log(`📄 Fetched ${content.length} chars from ${doc.file_name} (${fullText.length} total)`);
        } catch (e) {
          this.logger.warn(`📄 Failed to fetch raw text for ${doc.file_name}: ${e.message}`);
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`Long-context-fallback retrieval failed: ${error.message}`);
      return [];
    }
  }
}
