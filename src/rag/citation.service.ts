import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateCitationDto {
  tenantId: string;
  messageId: string;
  documentId: string;
  chunkId: string;
  quote: string;
  pageNumber?: number;
  relevanceScore?: number;
}

export interface Citation {
  id: string;
  tenantId: string;
  messageId: string;
  documentId: string;
  chunkId: string;
  quote: string;
  pageNumber: number | null;
  relevanceScore: number | null;
  createdAt: Date;
  document?: {
    id: string;
    title: string;
    ticker: string | null;
    sourceType: string;
  };
  chunk?: {
    id: string;
    content: string;
    pageNumber: number | null;
  };
}

/**
 * Citation Service
 * 
 * Manages citations for research assistant messages.
 * Links messages to specific document chunks with relevance scores.
 */
@Injectable()
export class CitationService {
  private readonly logger = new Logger(CitationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a single citation
   */
  async createCitation(dto: CreateCitationDto): Promise<Citation> {
    this.logger.log(`Creating citation for message ${dto.messageId}`);

    const result = await this.prisma.$queryRaw<Citation[]>`
      INSERT INTO citations (
        tenant_id, message_id, document_id, chunk_id, 
        quote, page_number, relevance_score
      )
      VALUES (
        ${dto.tenantId}::uuid,
        ${dto.messageId}::uuid,
        ${dto.documentId}::uuid,
        ${dto.chunkId}::uuid,
        ${dto.quote},
        ${dto.pageNumber || null},
        ${dto.relevanceScore || null}
      )
      RETURNING 
        id, tenant_id as "tenantId", message_id as "messageId",
        document_id as "documentId", chunk_id as "chunkId",
        quote, page_number as "pageNumber", 
        relevance_score as "relevanceScore", created_at as "createdAt"
    `;

    return result[0];
  }

  /**
   * Create multiple citations in batch
   */
  async createCitations(citations: CreateCitationDto[]): Promise<Citation[]> {
    if (citations.length === 0) {
      return [];
    }

    this.logger.log(`Creating ${citations.length} citations in batch`);

    const values = citations
      .map(
        (c) =>
          `('${c.tenantId}'::uuid, '${c.messageId}'::uuid, ${c.documentId ? `'${c.documentId}'::uuid` : 'NULL'}, '${c.chunkId}'::uuid, '${(c.quote || '').replace(/'/g, "''")}', ${c.pageNumber || 'NULL'}, ${c.relevanceScore || 'NULL'})`,
      )
      .join(', ');

    const result = await this.prisma.$queryRawUnsafe<Citation[]>(`
      INSERT INTO citations (
        tenant_id, message_id, document_id, chunk_id, 
        quote, page_number, relevance_score
      )
      VALUES ${values}
      RETURNING 
        id, tenant_id as "tenantId", message_id as "messageId",
        document_id as "documentId", chunk_id as "chunkId",
        quote, page_number as "pageNumber", 
        relevance_score as "relevanceScore", created_at as "createdAt"
    `);

    return result;
  }

  /**
   * Get citations for a message
   */
  async getCitationsForMessage(
    messageId: string,
    tenantId: string,
  ): Promise<Citation[]> {
    this.logger.log(`Fetching citations for message ${messageId}`);

    const citations = await this.prisma.$queryRaw<Citation[]>`
      SELECT 
        c.id, c.tenant_id as "tenantId", c.message_id as "messageId",
        c.document_id as "documentId", c.chunk_id as "chunkId",
        c.quote, c.page_number as "pageNumber", 
        c.relevance_score as "relevanceScore", c.created_at as "createdAt"
      FROM citations c
      WHERE c.message_id = ${messageId}::uuid
        AND c.tenant_id = ${tenantId}::uuid
      ORDER BY c.relevance_score DESC NULLS LAST, c.created_at ASC
    `;

    return citations;
  }

  /**
   * Get citations with full document and chunk details
   */
  async getCitationsWithDetails(
    messageId: string,
    tenantId: string,
  ): Promise<Citation[]> {
    this.logger.log(
      `Fetching citations with details for message ${messageId}`,
    );

    const citations = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        c.id, c.tenant_id as "tenantId", c.message_id as "messageId",
        c.document_id as "documentId", c.chunk_id as "chunkId",
        c.quote, c.page_number as "pageNumber", 
        c.relevance_score as "relevanceScore", c.created_at as "createdAt",
        jsonb_build_object(
          'id', d.id,
          'title', d.title,
          'ticker', d.ticker,
          'sourceType', d.source_type
        ) as document,
        jsonb_build_object(
          'id', ch.id,
          'content', ch.content,
          'pageNumber', ch.page_number
        ) as chunk
      FROM citations c
      JOIN documents d ON c.document_id = d.id
      JOIN document_chunks ch ON c.chunk_id = ch.id
      WHERE c.message_id = '${messageId}'::uuid
        AND c.tenant_id = '${tenantId}'::uuid
      ORDER BY c.relevance_score DESC NULLS LAST, c.created_at ASC
    `);

    return citations;
  }

  /**
   * Get citations for a document
   */
  async getCitationsForDocument(
    documentId: string,
    tenantId: string,
  ): Promise<Citation[]> {
    this.logger.log(`Fetching citations for document ${documentId}`);

    const citations = await this.prisma.$queryRaw<Citation[]>`
      SELECT 
        c.id, c.tenant_id as "tenantId", c.message_id as "messageId",
        c.document_id as "documentId", c.chunk_id as "chunkId",
        c.quote, c.page_number as "pageNumber", 
        c.relevance_score as "relevanceScore", c.created_at as "createdAt"
      FROM citations c
      WHERE c.document_id = ${documentId}::uuid
        AND c.tenant_id = ${tenantId}::uuid
      ORDER BY c.created_at DESC
    `;

    return citations;
  }

  /**
   * Get citation statistics for a tenant
   */
  async getCitationStats(
    tenantId: string,
  ): Promise<{
    totalCitations: number;
    uniqueDocuments: number;
    avgRelevanceScore: number;
    citationsBySourceType: Record<string, number>;
  }> {
    this.logger.log(`Fetching citation stats for tenant ${tenantId}`);

    const stats = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        COUNT(*)::int as "totalCitations",
        COUNT(DISTINCT c.document_id)::int as "uniqueDocuments",
        AVG(c.relevance_score)::float as "avgRelevanceScore"
      FROM citations c
      WHERE c.tenant_id = '${tenantId}'::uuid
    `);

    const bySourceType = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        d.source_type as "sourceType",
        COUNT(*)::int as count
      FROM citations c
      JOIN documents d ON c.document_id = d.id
      WHERE c.tenant_id = '${tenantId}'::uuid
      GROUP BY d.source_type
    `);

    const citationsBySourceType: Record<string, number> = {};
    for (const row of bySourceType) {
      citationsBySourceType[row.sourceType] = row.count;
    }

    return {
      totalCitations: stats[0]?.totalCitations || 0,
      uniqueDocuments: stats[0]?.uniqueDocuments || 0,
      avgRelevanceScore: stats[0]?.avgRelevanceScore || 0,
      citationsBySourceType,
    };
  }

  /**
   * Delete citations for a message
   */
  async deleteCitationsForMessage(
    messageId: string,
    tenantId: string,
  ): Promise<number> {
    this.logger.log(`Deleting citations for message ${messageId}`);

    const result = await this.prisma.$executeRaw`
      DELETE FROM citations
      WHERE message_id = ${messageId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    return result;
  }

  /**
   * Delete citations for a document
   */
  async deleteCitationsForDocument(
    documentId: string,
    tenantId: string,
  ): Promise<number> {
    this.logger.log(`Deleting citations for document ${documentId}`);

    const result = await this.prisma.$executeRaw`
      DELETE FROM citations
      WHERE document_id = ${documentId}::uuid
        AND tenant_id = ${tenantId}::uuid
    `;

    return result;
  }
}
