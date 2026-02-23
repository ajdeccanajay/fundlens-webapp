/**
 * Sync Envelope Generator Service
 *
 * Generates structured sync envelopes from completed instant RAG sessions
 * and uploads document chunks to S3 for Bedrock KB ingestion.
 *
 * CRITICAL: All S3 uploads include tenant_id in both the path and metadata
 * to maintain strict tenant isolation. The existing S3 Lambda trigger
 * automatically starts KB ingestion when new files land in the bucket.
 *
 * S3 path structure: kb-ready/{tenant_id}/{deal_id}/{session_id}/
 * Metadata sidecar: .metadata.json with tenant_id, visibility='private'
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 9.3
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Structured metric extracted from session documents
 */
export interface ExtractedMetric {
  metric: string;
  value: string;
  period: string;
  source: string;
  documentIndex: number;
}

/**
 * Document chunk for KB ingestion
 */
export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  ticker: string;
  tenant_id: string;
  deal_id: string;
  session_id: string;
  document_type: string;
  filing_type: string;
  fiscal_period: string;
  section_type: string;
  page_number?: number;
  file_name: string;
  visibility: 'private';
}

/**
 * Sync artifact types
 */
export interface StructuredMetricsArtifact {
  artifactType: 'structured_metrics';
  syncTarget: 'rds';
  table: 'deal_metrics';
  data: ExtractedMetric[];
}

export interface DocumentChunksArtifact {
  artifactType: 'document_chunks';
  syncTarget: 's3_then_kb';
  s3Path: string;
  chunks: DocumentChunk[];
}

export interface SessionQALogArtifact {
  artifactType: 'session_qa_log';
  syncTarget: 'rds';
  table: 'research_sessions';
  data: {
    sessionId: string;
    dealId: string;
    documentsProcessed: string[];
    questionsAsked: number;
    provocationsGenerated: number;
    durationMinutes: number;
    summary: string;
  };
}

export interface ProvocationsArtifact {
  artifactType: 'provocations';
  syncTarget: 'rds';
  table: 'provocations';
  data: any[];
}

export type SyncArtifact =
  | StructuredMetricsArtifact
  | DocumentChunksArtifact
  | SessionQALogArtifact
  | ProvocationsArtifact;

/**
 * Complete sync envelope structure
 * Requirements: 7.1, 7.8
 */
export interface SyncEnvelope {
  tenantId: string;
  workspaceId: string;
  dealId: string;
  ticker: string;
  sessionId: string;
  userId: string;
  createdAt: string;

  artifacts: SyncArtifact[];

  syncInstructions: {
    priority: 'normal' | 'high';
    rdsSync: {
      upsertStrategy: 'merge_on_composite_key';
      conflictResolution: 'latest_session_wins';
      keys: Record<string, string[]>;
    };
    s3KbSync: {
      trigger: 'post_session';
      kbIngestionScope: 'tenant_deal_datasource';
      embeddingConsistency: 'titan_text_v2_only';
    };
  };
}

export interface S3UploadResult {
  success: boolean;
  chunksUploaded: number;
  s3Path: string;
  error?: string;
}

export interface EnvelopeGenerationResult {
  envelope: SyncEnvelope;
  s3Upload?: S3UploadResult;
}

export interface KBIngestionResult {
  success: boolean;
  dataSourceId?: string;
  ingestionJobId?: string;
  error?: string;
  retryCount: number;
}

export interface AsyncSyncResult {
  sessionId: string;
  envelope: SyncEnvelope;
  s3Upload: S3UploadResult;
  kbIngestion?: KBIngestionResult;
  completedAt: string;
}

@Injectable()
export class SyncEnvelopeGeneratorService {
  private readonly logger = new Logger(SyncEnvelopeGeneratorService.name);
  private readonly s3Client: S3Client;
  private readonly s3Bucket: string;

  /** Max chunk size in characters (~1500 tokens) */
  private readonly MAX_CHUNK_SIZE = 6000;
  /** Overlap between chunks for context continuity */
  private readonly CHUNK_OVERLAP = 200;
  /** Max retry attempts for KB ingestion */
  private readonly MAX_KB_RETRIES = 3;
  /** Retry delay in ms (exponential backoff base) */
  private readonly RETRY_DELAY_BASE_MS = 1000;

  constructor(private readonly prisma: PrismaService) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 5,
      retryMode: 'adaptive',
    });
    this.s3Bucket = process.env.BEDROCK_CHUNKS_BUCKET || 'fundlens-bedrock-chunks';
  }

  /**
   * Generate a complete sync envelope for a session.
   * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8
   */
  async generateEnvelope(sessionId: string): Promise<SyncEnvelope> {
    this.logger.log(`Generating sync envelope for session ${sessionId}`);

    // Fetch session data
    const session = await this.getSessionData(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const documents = await this.getSessionDocuments(sessionId);
    const qaLog = await this.getQALog(sessionId);
    const summaries = await this.getIntakeSummaries(sessionId);

    const artifacts: SyncArtifact[] = [];

    // 1. Structured metrics artifact from intake summaries
    const metrics = this.extractMetricsFromSummaries(summaries);
    if (metrics.length > 0) {
      artifacts.push({
        artifactType: 'structured_metrics',
        syncTarget: 'rds',
        table: 'deal_metrics',
        data: metrics,
      });
    }

    // 2. Document chunks artifact for KB ingestion
    const s3Path = this.buildS3Path(session.tenant_id, session.deal_id, sessionId);
    const chunks = this.chunkDocuments(documents, session);
    if (chunks.length > 0) {
      artifacts.push({
        artifactType: 'document_chunks',
        syncTarget: 's3_then_kb',
        s3Path,
        chunks,
      });
    }

    // 3. Session Q&A log artifact
    const userQuestions = qaLog.filter(e => e.role === 'user');
    const sessionDurationMs = session.last_activity_at
      ? new Date(session.last_activity_at).getTime() - new Date(session.created_at).getTime()
      : 0;

    artifacts.push({
      artifactType: 'session_qa_log',
      syncTarget: 'rds',
      table: 'research_sessions',
      data: {
        sessionId,
        dealId: session.deal_id,
        documentsProcessed: documents.map(d => d.file_name),
        questionsAsked: userQuestions.length,
        provocationsGenerated: 0, // Provocations not yet implemented
        durationMinutes: Math.round(sessionDurationMs / 60000),
        summary: this.generateSessionSummary(documents, userQuestions),
      },
    });

    // 4. Provocations artifact (placeholder — generated if any exist)
    // Will be populated when provocations engine is integrated

    const envelope: SyncEnvelope = {
      tenantId: session.tenant_id,
      workspaceId: session.tenant_id, // workspace = tenant for now
      dealId: session.deal_id,
      ticker: session.ticker,
      sessionId,
      userId: session.user_id,
      createdAt: new Date().toISOString(),
      artifacts,
      syncInstructions: {
        priority: 'normal',
        rdsSync: {
          upsertStrategy: 'merge_on_composite_key',
          conflictResolution: 'latest_session_wins',
          keys: {
            deal_metrics: ['tenant_id', 'deal_id', 'metric', 'period'],
            research_sessions: ['session_id'],
          },
        },
        s3KbSync: {
          trigger: 'post_session',
          kbIngestionScope: 'tenant_deal_datasource',
          embeddingConsistency: 'titan_text_v2_only',
        },
      },
    };

    this.logger.log(
      `Envelope generated: ${artifacts.length} artifacts, ${chunks.length} chunks, ${userQuestions.length} Q&A entries`,
    );

    return envelope;
  }

  /**
   * Upload document chunks to S3 for KB ingestion.
   * Uses the existing pattern: .txt content + .metadata.json sidecar.
   * The S3 Lambda trigger will automatically start KB ingestion.
   *
   * CRITICAL: tenant_id is embedded in both the S3 path AND chunk metadata
   * to ensure strict tenant isolation in Bedrock KB filtering.
   *
   * Requirements: 7.9, 9.3
   */
  async uploadToS3(envelope: SyncEnvelope): Promise<S3UploadResult> {
    const chunksArtifact = envelope.artifacts.find(
      a => a.artifactType === 'document_chunks',
    ) as DocumentChunksArtifact | undefined;

    if (!chunksArtifact || chunksArtifact.chunks.length === 0) {
      return { success: true, chunksUploaded: 0, s3Path: '' };
    }

    const s3Path = chunksArtifact.s3Path;
    let uploaded = 0;

    this.logger.log(
      `Uploading ${chunksArtifact.chunks.length} chunks to s3://${this.s3Bucket}/${s3Path}`,
    );

    for (const chunk of chunksArtifact.chunks) {
      const contentKey = `${s3Path}chunk-${chunk.chunkIndex}.txt`;
      const metadataKey = `${contentKey}.metadata.json`;

      try {
        await Promise.all([
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.s3Bucket,
              Key: contentKey,
              Body: chunk.content,
              ContentType: 'text/plain',
            }),
          ),
          this.s3Client.send(
            new PutObjectCommand({
              Bucket: this.s3Bucket,
              Key: metadataKey,
              Body: JSON.stringify({
                metadataAttributes: {
                  ticker: chunk.metadata.ticker,
                  tenant_id: chunk.metadata.tenant_id,
                  deal_id: chunk.metadata.deal_id,
                  session_id: chunk.metadata.session_id,
                  document_type: chunk.metadata.document_type,
                  filing_type: chunk.metadata.filing_type,
                  fiscal_period: chunk.metadata.fiscal_period,
                  section_type: chunk.metadata.section_type,
                  file_name: chunk.metadata.file_name,
                  visibility: 'private',
                  chunk_index: String(chunk.chunkIndex),
                  ...(chunk.metadata.page_number != null
                    ? { page_number: String(chunk.metadata.page_number) }
                    : {}),
                },
              }),
              ContentType: 'application/json',
            }),
          ),
        ]);
        uploaded++;
      } catch (error) {
        this.logger.error(`Failed to upload chunk ${chunk.chunkIndex}: ${error.message}`);
        // Continue uploading remaining chunks
      }
    }

    const success = uploaded > 0;
    this.logger.log(`S3 upload complete: ${uploaded}/${chunksArtifact.chunks.length} chunks`);

    return {
      success,
      chunksUploaded: uploaded,
      s3Path,
      ...(uploaded < chunksArtifact.chunks.length
        ? { error: `${chunksArtifact.chunks.length - uploaded} chunks failed to upload` }
        : {}),
    };
  }

  /**
   * Build S3 path for sync envelope chunks.
   * Pattern: kb-ready/{tenant_id}/{deal_id}/{session_id}/
   * Requirements: 7.9, 9.3
   */
  buildS3Path(tenantId: string, dealId: string, sessionId: string): string {
    return `kb-ready/${tenantId}/${dealId}/${sessionId}/`;
  }

  /**
   * Split documents into chunks suitable for KB ingestion.
   * Each chunk is ≤ MAX_CHUNK_SIZE chars with CHUNK_OVERLAP overlap.
   */
  chunkDocuments(
    documents: SessionDocRow[],
    session: SessionRow,
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let globalIndex = 0;

    for (const doc of documents) {
      if (!doc.extracted_text || doc.processing_status !== 'complete') {
        continue;
      }

      const text = doc.extracted_text;
      let offset = 0;

      while (offset < text.length) {
        const end = Math.min(offset + this.MAX_CHUNK_SIZE, text.length);
        const content = text.substring(offset, end);

        chunks.push({
          chunkIndex: globalIndex,
          content,
          metadata: {
            ticker: session.ticker,
            tenant_id: session.tenant_id,
            deal_id: session.deal_id,
            session_id: session.id,
            document_type: 'instant_rag_upload',
            filing_type: doc.file_type,
            fiscal_period: '',
            section_type: 'full_document',
            file_name: doc.file_name,
            visibility: 'private',
          },
        });

        globalIndex++;

        // If we reached the end of the text, we're done with this document
        if (end >= text.length) break;

        // Advance with overlap for context continuity
        offset = end - this.CHUNK_OVERLAP;
      }
    }

    return chunks;
  }

  /**
   * Extract headline metrics from intake summaries for the structured_metrics artifact.
   */
  private extractMetricsFromSummaries(summaries: IntakeSummaryRow[]): ExtractedMetric[] {
    const metrics: ExtractedMetric[] = [];

    for (const summary of summaries) {
      const headlineMetrics = summary.headline_metrics || [];
      for (const m of headlineMetrics) {
        metrics.push({
          metric: m.metric || 'Unknown',
          value: m.value || 'N/A',
          period: m.period || 'Unknown',
          source: summary.file_name,
          documentIndex: 0,
        });
      }
    }

    return metrics;
  }

  /**
   * Generate a brief text summary of the session for the Q&A log artifact.
   */
  private generateSessionSummary(
    documents: SessionDocRow[],
    userQuestions: QALogRow[],
  ): string {
    const docNames = documents.map(d => d.file_name).join(', ');
    const questionCount = userQuestions.length;

    if (questionCount === 0) {
      return `Uploaded ${documents.length} document(s): ${docNames}. No questions asked.`;
    }

    const firstQuestion = userQuestions[0]?.content?.substring(0, 100) || '';
    return `Uploaded ${documents.length} document(s): ${docNames}. Asked ${questionCount} question(s). First: "${firstQuestion}..."`;
  }

  /**
   * Trigger KB ingestion for uploaded chunks.
   * The S3 Lambda trigger automatically starts KB ingestion when files land in kb-ready/.
   * This method verifies the upload and logs the ingestion trigger.
   *
   * Uses amazon.titan-embed-text-v2:0 for embeddings (matching existing KB config).
   * Implements retry logic with exponential backoff (3 attempts max).
   *
   * Requirements: 8.1, 8.2, 8.3, 8.5
   */
  async triggerKBIngestion(envelope: SyncEnvelope): Promise<KBIngestionResult> {
    const chunksArtifact = envelope.artifacts.find(
      a => a.artifactType === 'document_chunks',
    ) as DocumentChunksArtifact | undefined;

    if (!chunksArtifact || chunksArtifact.chunks.length === 0) {
      this.logger.log('No chunks to ingest - skipping KB ingestion trigger');
      return {
        success: true,
        retryCount: 0,
      };
    }

    const s3Path = chunksArtifact.s3Path;
    let lastError: string | undefined;

    // The S3 Lambda trigger handles actual KB ingestion automatically.
    // This method verifies the upload completed and logs the trigger.
    // Retry logic handles transient S3 verification failures.
    for (let attempt = 1; attempt <= this.MAX_KB_RETRIES; attempt++) {
      try {
        this.logger.log(
          `KB ingestion trigger attempt ${attempt}/${this.MAX_KB_RETRIES} for ${s3Path}`,
        );

        // Verify at least one chunk exists in S3 (confirms upload succeeded)
        const verifyKey = `${s3Path}chunk-0.txt`;
        const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
        
        await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.s3Bucket,
            Key: verifyKey,
          }),
        );

        this.logger.log(
          `KB ingestion triggered successfully for ${envelope.sessionId} ` +
          `(${chunksArtifact.chunks.length} chunks at ${s3Path})`,
        );

        // Log ingestion trigger for audit trail
        await this.logKBIngestionTrigger(envelope, 'triggered', attempt);

        return {
          success: true,
          dataSourceId: `tenant-${envelope.tenantId}-deal-${envelope.dealId}`,
          retryCount: attempt - 1,
        };
      } catch (error) {
        lastError = error.message;
        this.logger.warn(
          `KB ingestion trigger attempt ${attempt} failed: ${error.message}`,
        );

        if (attempt < this.MAX_KB_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = this.RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.logger.error(
      `KB ingestion trigger failed after ${this.MAX_KB_RETRIES} attempts: ${lastError}`,
    );

    await this.logKBIngestionTrigger(envelope, 'failed', this.MAX_KB_RETRIES, lastError);

    return {
      success: false,
      error: lastError,
      retryCount: this.MAX_KB_RETRIES,
    };
  }

  /**
   * Execute async sync on session end.
   * Generates envelope, uploads to S3, and triggers KB ingestion.
   * Returns immediately to user before sync completes (non-blocking).
   *
   * Requirements: 8.6
   */
  async executeAsyncSync(sessionId: string): Promise<void> {
    // Fire and forget - don't await
    this.performAsyncSync(sessionId).catch(error => {
      this.logger.error(`Async sync failed for session ${sessionId}: ${error.message}`);
    });
  }

  /**
   * Perform the actual async sync work.
   * This runs in the background after the user receives their response.
   *
   * Requirements: 7.1-7.9, 8.1-8.6, 9.3
   */
  private async performAsyncSync(sessionId: string): Promise<AsyncSyncResult> {
    this.logger.log(`Starting async sync for session ${sessionId}`);
    const startTime = Date.now();

    try {
      // 1. Generate sync envelope
      const envelope = await this.generateEnvelope(sessionId);

      // 2. Upload chunks to S3
      const s3Upload = await this.uploadToS3(envelope);

      if (!s3Upload.success) {
        this.logger.error(`S3 upload failed for session ${sessionId}: ${s3Upload.error}`);
      }

      // 3. Trigger KB ingestion (S3 Lambda handles actual ingestion)
      let kbIngestion: KBIngestionResult | undefined;
      if (s3Upload.success && s3Upload.chunksUploaded > 0) {
        kbIngestion = await this.triggerKBIngestion(envelope);
      }

      const result: AsyncSyncResult = {
        sessionId,
        envelope,
        s3Upload,
        kbIngestion,
        completedAt: new Date().toISOString(),
      };

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Async sync completed for session ${sessionId} in ${durationMs}ms ` +
        `(${s3Upload.chunksUploaded} chunks, KB: ${kbIngestion?.success ? 'triggered' : 'skipped'})`,
      );

      // Log sync completion for audit
      await this.logSyncCompletion(sessionId, result, durationMs);

      return result;
    } catch (error) {
      this.logger.error(`Async sync error for session ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Log KB ingestion trigger for audit trail
   */
  private async logKBIngestionTrigger(
    envelope: SyncEnvelope,
    status: 'triggered' | 'failed',
    attempts: number,
    error?: string,
  ): Promise<void> {
    try {
      // Note: session_id and deal_id are UUID, tenant_id is TEXT
      await this.prisma.$executeRaw`
        INSERT INTO instant_rag_sync_log (
          session_id, tenant_id, deal_id, event_type, status, attempts, error_message, created_at
        ) VALUES (
          ${envelope.sessionId}::uuid,
          ${envelope.tenantId},
          ${envelope.dealId}::uuid,
          'kb_ingestion_trigger',
          ${status},
          ${attempts},
          ${error || null},
          NOW()
        )
        ON CONFLICT DO NOTHING
      `;
    } catch (logError) {
      // Don't fail the main operation if logging fails
      this.logger.warn(`Failed to log KB ingestion trigger: ${logError.message}`);
    }
  }

  /**
   * Log sync completion for audit trail
   */
  private async logSyncCompletion(
    sessionId: string,
    result: AsyncSyncResult,
    durationMs: number,
  ): Promise<void> {
    try {
      // Note: session_id and deal_id are UUID, tenant_id is TEXT
      await this.prisma.$executeRaw`
        INSERT INTO instant_rag_sync_log (
          session_id, tenant_id, deal_id, event_type, status, 
          chunks_uploaded, duration_ms, created_at
        ) VALUES (
          ${sessionId}::uuid,
          ${result.envelope.tenantId},
          ${result.envelope.dealId}::uuid,
          'sync_complete',
          ${result.s3Upload.success ? 'success' : 'partial'},
          ${result.s3Upload.chunksUploaded},
          ${durationMs},
          NOW()
        )
        ON CONFLICT DO NOTHING
      `;
    } catch (logError) {
      this.logger.warn(`Failed to log sync completion: ${logError.message}`);
    }
  }

  /**
   * Sleep helper for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Database queries ───────────────────────────────────────────

  private async getSessionData(sessionId: string): Promise<SessionRow | null> {
    const rows = await this.prisma.$queryRaw<SessionRow[]>`
      SELECT id, tenant_id, deal_id, user_id, ticker, status,
             created_at, last_activity_at, expires_at,
             sonnet_calls, opus_calls, total_input_tokens, total_output_tokens
      FROM instant_rag_sessions
      WHERE id = ${sessionId}::uuid
    `;
    return rows[0] || null;
  }

  private async getSessionDocuments(sessionId: string): Promise<SessionDocRow[]> {
    return this.prisma.$queryRaw<SessionDocRow[]>`
      SELECT id, file_name, file_type, file_size_bytes, content_hash,
             extracted_text, page_count, processing_status
      FROM instant_rag_documents
      WHERE session_id = ${sessionId}::uuid
      ORDER BY created_at ASC
    `;
  }

  private async getQALog(sessionId: string): Promise<QALogRow[]> {
    return this.prisma.$queryRaw<QALogRow[]>`
      SELECT id, role, content, model_used, input_tokens, output_tokens, created_at
      FROM instant_rag_qa_log
      WHERE session_id = ${sessionId}::uuid
      ORDER BY created_at ASC
    `;
  }

  private async getIntakeSummaries(sessionId: string): Promise<IntakeSummaryRow[]> {
    return this.prisma.$queryRaw<IntakeSummaryRow[]>`
      SELECT s.id, s.document_type, s.reporting_entity, s.period_covered,
             s.headline_metrics, s.notable_items, d.file_name
      FROM instant_rag_intake_summaries s
      JOIN instant_rag_documents d ON s.document_id = d.id
      WHERE d.session_id = ${sessionId}::uuid
      ORDER BY d.created_at ASC
    `;
  }
}

// ─── Internal row types ─────────────────────────────────────────

interface SessionRow {
  id: string;
  tenant_id: string;
  deal_id: string;
  user_id: string;
  ticker: string;
  status: string;
  created_at: Date;
  last_activity_at: Date | null;
  expires_at: Date;
  sonnet_calls: number;
  opus_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
}

interface SessionDocRow {
  id: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  content_hash: string;
  extracted_text: string | null;
  page_count: number;
  processing_status: string;
}

interface QALogRow {
  id: string;
  role: string;
  content: string;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: Date;
}

interface IntakeSummaryRow {
  id: string;
  document_type: string;
  reporting_entity: string;
  period_covered: string;
  headline_metrics: Array<{ metric: string; value: string; period: string }>;
  notable_items: string[];
  file_name: string;
}
