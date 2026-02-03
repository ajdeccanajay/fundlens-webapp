import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from './bedrock.service';

interface UserDocumentChunk {
  id: string;
  documentId: string;
  content: string;
  pageNumber: number | null;
  ticker: string | null;
  filename: string;
  score: number;
}

interface SearchUserDocumentsOptions {
  tenantId: string;
  ticker?: string | null; // null = search across all tickers
  topK?: number;
  minScore?: number;
}

interface SearchResult {
  chunks: UserDocumentChunk[];
  totalFound: number;
  avgScore: number;
}

/**
 * Document RAG Service
 * 
 * Handles vector search and retrieval for user-uploaded documents.
 * Integrates with existing hybrid RAG system.
 */
@Injectable()
export class DocumentRAGService {
  private readonly logger = new Logger(DocumentRAGService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bedrock: BedrockService,
  ) {}

  /**
   * Search user documents using vector similarity
   * 
   * @param query - User's search query
   * @param options - Search options (tenant, ticker, topK, etc.)
   * @returns Relevant document chunks with scores
   */
  async searchUserDocuments(
    query: string,
    options: SearchUserDocumentsOptions,
  ): Promise<SearchResult> {
    const { tenantId, ticker, topK = 5, minScore = 0.7 } = options;

    this.logger.log(
      `🔍 Searching user documents for tenant ${tenantId}${ticker ? ` (ticker: ${ticker})` : ' (all tickers)'}`,
    );

    try {
      // Generate query embedding
      const queryEmbedding = await this.bedrock.generateEmbedding(query);

      // Build SQL query with tenant filtering
      const tickerFilter = ticker ? `AND c.ticker = $3` : '';
      const params = ticker
        ? [queryEmbedding, tenantId, ticker, topK]
        : [queryEmbedding, tenantId, topK];

      const sqlQuery = `
        SELECT 
          c.id,
          c.document_id as "documentId",
          c.content,
          c.page_number as "pageNumber",
          c.ticker,
          d.title as filename,
          1 - (c.embedding <=> $1::vector) as score
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id
        WHERE c.tenant_id = $2
          ${tickerFilter}
          AND d.source_type = 'USER_UPLOAD'
          AND d.processed = true
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector
        LIMIT $${params.length}
      `;

      const chunks = await this.prisma.$queryRawUnsafe<UserDocumentChunk[]>(
        sqlQuery,
        ...params,
      );

      // Filter by minimum score
      const filteredChunks = chunks.filter((chunk) => chunk.score >= minScore);

      const avgScore =
        filteredChunks.length > 0
          ? filteredChunks.reduce((sum, c) => sum + c.score, 0) /
            filteredChunks.length
          : 0;

      this.logger.log(
        `📄 Found ${filteredChunks.length} relevant chunks (avg score: ${avgScore.toFixed(2)})`,
      );

      return {
        chunks: filteredChunks,
        totalFound: filteredChunks.length,
        avgScore,
      };
    } catch (error) {
      this.logger.error(`Error searching user documents: ${error.message}`);
      throw error;
    }
  }

  /**
   * Merge and rerank results from multiple sources
   * 
   * @param userDocChunks - Chunks from user documents
   * @param secChunks - Chunks from SEC filings
   * @param topK - Number of top results to return
   * @returns Merged and reranked chunks
   */
  mergeAndRerankResults(
    userDocChunks: UserDocumentChunk[],
    secChunks: any[],
    topK: number = 5,
  ): any[] {
    // Combine all chunks
    const allChunks = [
      ...userDocChunks.map((chunk) => ({
        ...chunk,
        source: 'user_document',
        sourceType: 'USER_UPLOAD',
      })),
      ...secChunks.map((chunk) => ({
        ...chunk,
        source: 'sec_filing',
        sourceType: 'SEC_FILING',
      })),
    ];

    // Sort by score (descending)
    allChunks.sort((a, b) => b.score - a.score);

    // Return top K
    return allChunks.slice(0, topK);
  }

  /**
   * Build context string from chunks for LLM prompt
   * 
   * @param chunks - Document chunks
   * @returns Formatted context string
   */
  buildContextFromChunks(chunks: UserDocumentChunk[]): string {
    if (chunks.length === 0) {
      return '';
    }

    return chunks
      .map((chunk, index) => {
        const pageInfo = chunk.pageNumber ? ` (Page ${chunk.pageNumber})` : '';
        const tickerInfo = chunk.ticker ? ` [${chunk.ticker}]` : '';
        return `[${index + 1}] ${chunk.filename}${tickerInfo}${pageInfo}:\n${chunk.content}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Extract citations from chunks
   * 
   * @param chunks - Document chunks used in response
   * @returns Citation objects
   */
  extractCitationsFromChunks(chunks: UserDocumentChunk[]): any[] {
    return chunks.map((chunk, index) => ({
      citationNumber: index + 1,
      documentId: chunk.documentId,
      chunkId: chunk.id,
      filename: chunk.filename,
      ticker: chunk.ticker,
      pageNumber: chunk.pageNumber,
      snippet: chunk.content.substring(0, 200) + '...',
      score: chunk.score,
    }));
  }

  /**
   * Get document statistics for a tenant
   * 
   * @param tenantId - Tenant ID
   * @param ticker - Optional ticker filter
   * @returns Document statistics
   */
  async getDocumentStats(
    tenantId: string,
    ticker?: string,
  ): Promise<{
    totalDocuments: number;
    totalChunks: number;
    indexedDocuments: number;
    processingDocuments: number;
  }> {
    const where: any = {
      tenantId,
      sourceType: 'USER_UPLOAD',
    };

    if (ticker) {
      where.ticker = ticker;
    }

    const [totalDocuments, indexedDocuments, processingDocuments, chunks] =
      await Promise.all([
        this.prisma.document.count({ where }),
        this.prisma.document.count({
          where: { ...where, processed: true, processingError: null },
        }),
        this.prisma.document.count({
          where: { ...where, processed: false },
        }),
        this.prisma.documentChunk.count({
          where: {
            tenantId,
            ...(ticker && { ticker }),
          },
        }),
      ]);

    return {
      totalDocuments,
      totalChunks: chunks,
      indexedDocuments,
      processingDocuments,
    };
  }
}
