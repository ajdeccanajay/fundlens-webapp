/**
 * Instant RAG Service
 * 
 * Orchestrates document processing and Q&A for instant RAG sessions.
 * Handles:
 * - Session creation and management
 * - Parallel document processing
 * - Progress event emission via SSE
 * - Partial failure handling
 * 
 * Requirements: 1.5, 1.6, 12.1, 12.2, 12.3
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionManagerService, SessionState, CreateSessionParams } from './session-manager.service';
import type { SessionExpiredEvent } from './session-manager.service';
import { DocumentProcessorService, ProcessedDocument } from './document-processor.service';
import { FileValidatorService, ValidationResult } from './file-validator.service';
import { BedrockService, ChunkResult, MetadataFilter } from '../rag/bedrock.service';
import { ModelRouterService, ModelSelection } from './model-router.service';
import { SyncEnvelopeGeneratorService } from './sync-envelope-generator.service';

/**
 * Document type categories for intake summaries
 * Requirements: 3.2
 */
export type DocumentCategory =
  | '10-K' | '10-Q' | '8-K'
  | 'earnings_transcript' | 'investor_presentation'
  | 'CIM' | 'pitch_deck' | 'due_diligence_report'
  | 'financial_model' | 'other';

/**
 * Headline metric extracted from document
 * Requirements: 3.7
 */
export interface HeadlineMetric {
  metric: string;
  value: string;
  period: string;
}

/**
 * Intake summary structure for uploaded documents
 * Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
 */
export interface IntakeSummary {
  documentId: string;
  documentIndex: number;
  fileName: string;
  documentType: DocumentCategory;
  reportingEntity: string;
  periodCovered: string;
  pageCount: number;
  keySectionsIdentified: string[];
  headlineMetrics: HeadlineMetric[];
  notableItems: string[];
  extractionConfidence: 'high' | 'medium' | 'low';
  extractionNotes: string;
}

export interface ProcessingProgress {
  sessionId: string;
  phase: 'uploading' | 'extracting_text' | 'extracting_tables' | 'generating_embeddings' | 'complete' | 'failed';
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  progress: number; // 0-100
  error?: string;
}

export interface ProcessingResult {
  sessionId: string;
  documents: ProcessedDocument[];
  validationResult: ValidationResult;
  successCount: number;
  failureCount: number;
  duplicateCount: number;
}

export interface SessionDocument {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  contentHash: string;
  pageCount: number;
  processingStatus: string;
  processingError?: string;
  extractedText?: string;
  pageImages?: string[]; // base64-encoded images for vision
  createdAt: Date;
}

/**
 * Citation extracted from Claude response
 * Requirements: 4.5, 4.6
 */
export interface Citation {
  documentIndex: number;
  pageNumber?: number;
  text: string;
}

/**
 * Citation from KB retrieval results
 * Requirements: 4.5, 4.6, 9.2
 */
export interface KBCitation {
  ticker: string;
  filingType: string;
  fiscalPeriod: string;
  sectionType: string;
  pageNumber?: number;
  text: string;
}

/**
 * Options for hybrid query mode
 * Requirements: 4.1, 4.2, 9.2
 */
export interface HybridQueryOptions extends QueryOptions {
  /** Number of KB results to retrieve (default: 5) */
  kbResultCount?: number;
  /** Whether to include KB results at all (default: true) */
  includeKB?: boolean;
}

/**
 * Q&A log entry for session history
 * Requirements: 4.1
 */
export interface QALogEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  citations: Citation[];
  createdAt: Date;
}

/**
 * Query options for instant Q&A
 */
export interface QueryOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * Stream chunk types for Q&A response
 */
export type QueryStreamChunk =
  | { type: 'content'; content: string; citations: Citation[] }
  | { type: 'model_info'; modelType: 'sonnet' | 'opus'; fallbackFromOpus: boolean; opusCallsRemaining: number; matchedTrigger?: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number; modelId: string } }
  | { type: 'error'; error: string };

@Injectable()
export class InstantRAGService {
  private readonly logger = new Logger(InstantRAGService.name);

  // Claude Sonnet model ID for intake summary generation
  private readonly SONNET_MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

  // In-memory cache for page images during active sessions
  // Key: sessionId, Value: Map<documentFileName, base64Images[]>
  private readonly sessionImageCache = new Map<string, Map<string, string[]>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionManager: SessionManagerService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly fileValidator: FileValidatorService,
    private readonly bedrockService: BedrockService,
    private readonly modelRouter: ModelRouterService,
    private readonly syncEnvelopeGenerator: SyncEnvelopeGeneratorService,
  ) {}

  /**
   * Handle expired session events - trigger async sync
   * Requirements: 11.2, 11.3
   */
  @OnEvent('instant-rag.session.expired')
  async handleSessionExpired(event: SessionExpiredEvent): Promise<void> {
    this.logger.log(`Handling expired session ${event.sessionId}`);
    
    // Clean up image cache for this session
    this.sessionImageCache.delete(event.sessionId);
    
    // Trigger async sync for the expired session
    await this.syncEnvelopeGenerator.executeAsyncSync(event.sessionId);
  }

  /**
   * Create a new instant RAG session
   */
  async createSession(params: CreateSessionParams): Promise<SessionState> {
    this.logger.log(`Creating session for tenant=${params.tenantId}, deal=${params.dealId}`);
    return this.sessionManager.createSession(params);
  }

  /**
   * Get or create session for user+deal
   */
  async getOrCreateSession(
    tenantId: string,
    dealId: string,
    userId: string,
    ticker: string,
  ): Promise<SessionState> {
    // Check for existing active session
    const existing = await this.sessionManager.getActiveSession(tenantId, dealId, userId);
    if (existing) {
      await this.sessionManager.extendTimeout(existing.id);
      return existing;
    }

    // Create new session
    return this.sessionManager.createSession({
      tenantId,
      dealId,
      userId,
      ticker,
    });
  }

  /**
   * Process documents with progress tracking
   * Returns an async generator for SSE streaming
   */
  async *processDocuments(
    sessionId: string,
    files: Express.Multer.File[],
    tenantId: string,
    dealId: string,
  ): AsyncGenerator<ProcessingProgress> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Validate files
    const validationResult = this.fileValidator.validateBatch(files);

    if (validationResult.batchError) {
      yield {
        sessionId,
        phase: 'failed',
        fileName: '',
        fileIndex: 0,
        totalFiles: files.length,
        progress: 0,
        error: validationResult.batchError.message,
      };
      return;
    }

    const validFiles = validationResult.validFiles;
    const totalFiles = validFiles.length;

    // Set total file count
    await this.sessionManager.setFilesTotal(sessionId, totalFiles);

    // Process each file
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const fileName = file.originalname;

      try {
        // Emit uploading phase
        yield {
          sessionId,
          phase: 'uploading',
          fileName,
          fileIndex: i,
          totalFiles,
          progress: Math.round((i / totalFiles) * 100),
        };

        // Emit extracting text phase
        yield {
          sessionId,
          phase: 'extracting_text',
          fileName,
          fileIndex: i,
          totalFiles,
          progress: Math.round(((i + 0.25) / totalFiles) * 100),
        };

        // Process the file
        const result = await this.documentProcessor.processFile(
          file,
          sessionId,
          tenantId,
          dealId,
        );

        // Emit extracting tables phase
        yield {
          sessionId,
          phase: 'extracting_tables',
          fileName,
          fileIndex: i,
          totalFiles,
          progress: Math.round(((i + 0.5) / totalFiles) * 100),
        };

        // Store document if not duplicate
        if (!result.isDuplicate && result.processingStatus === 'complete') {
          await this.storeDocument(sessionId, tenantId, result);
          await this.sessionManager.incrementFileCounters(sessionId, 1, 0);

          // Cache page images for vision queries
          if (result.pageImages && result.pageImages.length > 0) {
            if (!this.sessionImageCache.has(sessionId)) {
              this.sessionImageCache.set(sessionId, new Map());
            }
            this.sessionImageCache.get(sessionId)!.set(result.fileName, result.pageImages);
            this.logger.log(`Cached ${result.pageImages.length} images for ${result.fileName}`);
          }
        } else if (result.processingStatus === 'failed') {
          await this.sessionManager.incrementFileCounters(sessionId, 0, 1);
        }

        // Emit complete phase for this file
        yield {
          sessionId,
          phase: 'complete',
          fileName,
          fileIndex: i,
          totalFiles,
          progress: Math.round(((i + 1) / totalFiles) * 100),
        };

      } catch (error) {
        this.logger.error(`Failed to process ${fileName}: ${error.message}`);
        await this.sessionManager.incrementFileCounters(sessionId, 0, 1);

        yield {
          sessionId,
          phase: 'failed',
          fileName,
          fileIndex: i,
          totalFiles,
          progress: Math.round(((i + 1) / totalFiles) * 100),
          error: error.message,
        };
      }
    }

    // Emit validation errors for invalid files
    for (const error of validationResult.invalidFiles) {
      yield {
        sessionId,
        phase: 'failed',
        fileName: error.fileName,
        fileIndex: -1,
        totalFiles,
        progress: 100,
        error: error.message,
      };
    }

    // ── IMMEDIATE SESSION-TO-PERMANENT PROMOTION ─────────────────────
    // Trigger async sync NOW (not just on session expiry) so uploaded docs
    // persist to the deal immediately. This ensures analysts don't lose
    // access to uploaded documents when the session expires, and the docs
    // become available in the permanent document library right away.
    // The sync is fire-and-forget — it runs in the background after the
    // user receives their upload confirmation.
    try {
      this.logger.log(`🔄 Triggering immediate sync-to-permanent for session ${sessionId}`);
      await this.syncEnvelopeGenerator.executeAsyncSync(sessionId);
    } catch (syncError) {
      // Non-fatal — docs are still available via session, sync will retry on expiry
      this.logger.warn(`⚠️ Immediate sync failed (will retry on session expiry): ${syncError.message}`);
    }
  }

  /**
   * Store processed document in database
   */
  private async storeDocument(
    sessionId: string,
    tenantId: string,
    doc: ProcessedDocument,
  ): Promise<string> {
    // Note: session_id is UUID, tenant_id is TEXT
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO instant_rag_documents (
        session_id, tenant_id, file_name, file_type, file_size_bytes,
        content_hash, s3_key, extracted_text, extracted_tables,
        page_count, processing_status, processing_duration_ms
      ) VALUES (
        ${sessionId}::uuid, ${tenantId}, ${doc.fileName},
        ${doc.fileType}, ${BigInt(Math.round(doc.fileSizeMb * 1024 * 1024))},
        ${doc.contentHash}, ${'instant-rag/' + sessionId + '/' + doc.fileName},
        ${doc.extractedText}, ${JSON.stringify(doc.extractedTables)}::jsonb,
        ${doc.pageCount}, 'complete', ${doc.processingDurationMs}
      )
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Get session state
   */
  async getSessionState(sessionId: string): Promise<SessionState | null> {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Get documents in a session
   */
  async getSessionDocuments(sessionId: string): Promise<SessionDocument[]> {
    const documents = await this.prisma.$queryRaw<SessionDocument[]>`
      SELECT 
        id, file_name as "fileName", file_type as "fileType",
        file_size_bytes as "fileSizeBytes", content_hash as "contentHash",
        page_count as "pageCount", processing_status as "processingStatus",
        processing_error as "processingError", extracted_text as "extractedText",
        created_at as "createdAt"
      FROM instant_rag_documents
      WHERE session_id = ${sessionId}::uuid
      ORDER BY created_at ASC
    `;

    return documents.map(doc => ({
      ...doc,
      fileSizeBytes: Number(doc.fileSizeBytes),
    }));
  }

  /**
   * Get full document content for Q&A context
   */
  async getDocumentContent(sessionId: string): Promise<string> {
    const documents = await this.getSessionDocuments(sessionId);
    
    return documents
      .filter(doc => doc.extractedText)
      .map((doc, idx) => `[Document ${idx + 1}: ${doc.fileName}]\n${doc.extractedText}`)
      .join('\n\n---\n\n');
  }

  /**
   * Generate intake summaries for all documents in a session
   * Calls Claude Sonnet to extract summary fields from document content
   * 
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
   */
  async generateIntakeSummaries(sessionId: string): Promise<IntakeSummary[]> {
    this.logger.log(`Generating intake summaries for session ${sessionId}`);

    const documents = await this.getSessionDocuments(sessionId);
    
    if (documents.length === 0) {
      this.logger.warn(`No documents found for session ${sessionId}`);
      return [];
    }

    const summaries: IntakeSummary[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      
      if (!doc.extractedText || doc.processingStatus !== 'complete') {
        this.logger.warn(`Skipping document ${doc.fileName} - no extracted text or not complete`);
        continue;
      }

      try {
        const summary = await this.generateSingleIntakeSummary(doc, i);
        
        // Store summary in database
        await this.storeIntakeSummary(doc.id, summary);
        
        summaries.push(summary);
        this.logger.log(`Generated intake summary for ${doc.fileName}`);
      } catch (error) {
        this.logger.error(`Failed to generate intake summary for ${doc.fileName}: ${error.message}`);
        // Continue with other documents even if one fails
      }
    }

    return summaries;
  }

  /**
   * Generate intake summary for a single document using Claude Sonnet
   */
  private async generateSingleIntakeSummary(
    doc: SessionDocument,
    documentIndex: number,
  ): Promise<IntakeSummary> {
    // Truncate text if too long (keep first 100K chars for context window)
    const maxTextLength = 100000;
    const truncatedText = doc.extractedText && doc.extractedText.length > maxTextLength
      ? doc.extractedText.substring(0, maxTextLength) + '\n\n[Content truncated...]'
      : doc.extractedText || '';

    const prompt = this.buildIntakeSummaryPrompt(doc.fileName, truncatedText, doc.pageCount);

    const response = await this.bedrockService.invokeClaude({
      prompt,
      modelId: this.SONNET_MODEL_ID,
      max_tokens: 2000,
    });

    return this.parseIntakeSummaryResponse(response, doc, documentIndex);
  }

  /**
   * Build the prompt for intake summary extraction
   */
  private buildIntakeSummaryPrompt(fileName: string, content: string, pageCount: number): string {
    return `You are a financial document analyst. Analyze the following document and extract a structured summary.

DOCUMENT: ${fileName}
PAGE COUNT: ${pageCount}

CONTENT:
${content}

---

Please analyze this document and provide a JSON response with the following structure:

{
  "document_type": "<one of: 10-K, 10-Q, 8-K, earnings_transcript, investor_presentation, CIM, pitch_deck, due_diligence_report, financial_model, other>",
  "reporting_entity": "<company name as it appears in the document>",
  "period_covered": "<e.g., 'Fiscal Year Ended December 31, 2024' or 'Q3 2024'>",
  "key_sections_identified": ["<list of main sections found, e.g., 'Risk Factors', 'MD&A', 'Financial Statements'>"],
  "headline_metrics": [
    {"metric": "<metric name>", "value": "<value with units>", "period": "<period>"}
  ],
  "notable_items": ["<any restatements, material weaknesses, going concern language, or other notable items>"],
  "extraction_confidence": "<high, medium, or low based on document quality and clarity>",
  "extraction_notes": "<any issues encountered: poor scan quality, redacted sections, incomplete data, etc.>"
}

IMPORTANT:
- For headline_metrics, extract the 3-5 most important financial metrics (revenue, net income, EPS, etc.)
- For notable_items, look for: restatements, material weaknesses, going concern language, significant changes, risk warnings
- Set extraction_confidence to "low" if the document is poorly scanned or has significant redactions
- If you cannot determine a field, use "Unknown" or an empty array as appropriate

Respond ONLY with the JSON object, no additional text.`;
  }

  /**
   * Parse Claude's response into IntakeSummary structure
   */
  private parseIntakeSummaryResponse(
    response: string,
    doc: SessionDocument,
    documentIndex: number,
  ): IntakeSummary {
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      let jsonStr = response.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);

      // Validate and normalize document_type
      const validDocTypes: DocumentCategory[] = [
        '10-K', '10-Q', '8-K', 'earnings_transcript', 'investor_presentation',
        'CIM', 'pitch_deck', 'due_diligence_report', 'financial_model', 'other'
      ];
      const documentType = validDocTypes.includes(parsed.document_type)
        ? parsed.document_type as DocumentCategory
        : 'other';

      // Validate and normalize extraction_confidence
      const validConfidence = ['high', 'medium', 'low'];
      const extractionConfidence = validConfidence.includes(parsed.extraction_confidence)
        ? parsed.extraction_confidence as 'high' | 'medium' | 'low'
        : 'medium';

      // Parse headline_metrics
      const headlineMetrics: HeadlineMetric[] = Array.isArray(parsed.headline_metrics)
        ? parsed.headline_metrics.map((m: any) => ({
            metric: String(m.metric || 'Unknown'),
            value: String(m.value || 'N/A'),
            period: String(m.period || 'Unknown'),
          }))
        : [];

      return {
        documentId: doc.id,
        documentIndex,
        fileName: doc.fileName,
        documentType,
        reportingEntity: String(parsed.reporting_entity || 'Unknown'),
        periodCovered: String(parsed.period_covered || 'Unknown'),
        pageCount: doc.pageCount || 0,
        keySectionsIdentified: Array.isArray(parsed.key_sections_identified)
          ? parsed.key_sections_identified.map(String)
          : [],
        headlineMetrics,
        notableItems: Array.isArray(parsed.notable_items)
          ? parsed.notable_items.map(String)
          : [],
        extractionConfidence,
        extractionNotes: String(parsed.extraction_notes || ''),
      };
    } catch (error) {
      this.logger.error(`Failed to parse intake summary response: ${error.message}`);
      
      // Return a default summary with low confidence
      return {
        documentId: doc.id,
        documentIndex,
        fileName: doc.fileName,
        documentType: 'other',
        reportingEntity: 'Unknown',
        periodCovered: 'Unknown',
        pageCount: doc.pageCount || 0,
        keySectionsIdentified: [],
        headlineMetrics: [],
        notableItems: [],
        extractionConfidence: 'low',
        extractionNotes: `Failed to parse AI response: ${error.message}`,
      };
    }
  }

  /**
   * Store intake summary in database
   * Requirements: 3.1
   */
  private async storeIntakeSummary(documentId: string, summary: IntakeSummary): Promise<string> {
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO instant_rag_intake_summaries (
        document_id, document_type, reporting_entity, period_covered,
        key_sections, headline_metrics, notable_items,
        extraction_confidence, extraction_notes
      ) VALUES (
        ${documentId}::uuid,
        ${summary.documentType},
        ${summary.reportingEntity},
        ${summary.periodCovered},
        ${JSON.stringify(summary.keySectionsIdentified)}::jsonb,
        ${JSON.stringify(summary.headlineMetrics)}::jsonb,
        ${JSON.stringify(summary.notableItems)}::jsonb,
        ${summary.extractionConfidence},
        ${summary.extractionNotes}
      )
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Get intake summaries for a session
   */
  async getIntakeSummaries(sessionId: string): Promise<IntakeSummary[]> {
    const summaries = await this.prisma.$queryRaw<any[]>`
      SELECT 
        s.id,
        s.document_id as "documentId",
        d.file_name as "fileName",
        s.document_type as "documentType",
        s.reporting_entity as "reportingEntity",
        s.period_covered as "periodCovered",
        d.page_count as "pageCount",
        s.key_sections as "keySectionsIdentified",
        s.headline_metrics as "headlineMetrics",
        s.notable_items as "notableItems",
        s.extraction_confidence as "extractionConfidence",
        s.extraction_notes as "extractionNotes"
      FROM instant_rag_intake_summaries s
      JOIN instant_rag_documents d ON s.document_id = d.id
      WHERE d.session_id = ${sessionId}::uuid
      ORDER BY d.created_at ASC
    `;

    return summaries.map((s, idx) => ({
      documentId: s.documentId,
      documentIndex: idx,
      fileName: s.fileName,
      documentType: s.documentType as DocumentCategory,
      reportingEntity: s.reportingEntity,
      periodCovered: s.periodCovered,
      pageCount: s.pageCount || 0,
      keySectionsIdentified: s.keySectionsIdentified || [],
      headlineMetrics: s.headlineMetrics || [],
      notableItems: s.notableItems || [],
      extractionConfidence: s.extractionConfidence as 'high' | 'medium' | 'low',
      extractionNotes: s.extractionNotes || '',
    }));
  }

  /**
   * Query documents in a session using instant Q&A mode
   * Passes full document content directly to Claude for immediate response
   * Streams response tokens via SSE
   * 
   * Requirements: 4.1, 4.2, 4.3, 4.5
   */
  async *query(
    sessionId: string,
    query: string,
    options?: QueryOptions,
  ): AsyncGenerator<QueryStreamChunk> {
    this.logger.log(`Processing query for session ${sessionId}: ${query.substring(0, 100)}...`);

    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== 'active') {
      throw new BadRequestException('Session is not active');
    }

    // Extend session timeout on activity
    await this.sessionManager.extendTimeout(sessionId);

    // Get document content for context
    const documentContent = await this.getDocumentContent(sessionId);
    
    if (!documentContent) {
      yield {
        type: 'error',
        error: 'No documents available in session',
      };
      return;
    }

    // Build the prompt with document context
    const systemPrompt = this.buildQuerySystemPrompt();
    const userPrompt = this.buildQueryUserPrompt(query, documentContent);

    // Store user message in Q&A log
    await this.storeQALogEntry(sessionId, 'user', query);

    // Route query through ModelRouter
    const modelSelection = await this.modelRouter.routeQuery(query, sessionId);
    const modelId = modelSelection.modelId;

    // Emit model selection info (so frontend can show fallback notice)
    yield {
      type: 'model_info',
      modelType: modelSelection.modelType,
      fallbackFromOpus: modelSelection.fallbackFromOpus,
      opusCallsRemaining: modelSelection.opusCallsRemaining,
      matchedTrigger: modelSelection.matchedTrigger,
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fullResponse = '';

    try {
      // Check if session has cached images for vision analysis
      const sessionImages = this.sessionImageCache.get(sessionId);
      const hasVisionContent = sessionImages && sessionImages.size > 0;

      if (hasVisionContent) {
        // Use vision API with images for richer analysis (charts, colors, graphs)
        const allImages: { base64: string; mediaType: 'image/png' | 'image/jpeg' }[] = [];
        for (const [, images] of sessionImages) {
          // Limit to first 20 images total to stay within context limits
          for (const img of images) {
            if (allImages.length >= 20) break;
            allImages.push({ base64: img, mediaType: 'image/png' });
          }
          if (allImages.length >= 20) break;
        }

        this.logger.log(`Using vision API with ${allImages.length} images for query`);

        const response = await this.bedrockService.invokeClaudeWithVision({
          prompt: userPrompt,
          images: allImages,
          systemPrompt: systemPrompt,
          modelId,
          max_tokens: 4000,
        });

        fullResponse = response;
        totalInputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4) + (allImages.length * 1000);
        totalOutputTokens = Math.ceil(response.length / 4);
      } else {
        // Text-only query — no vision content available
        const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

        const response = await this.bedrockService.invokeClaude({
          prompt: combinedPrompt,
          modelId,
          max_tokens: 4000,
        });

        fullResponse = response;
        totalInputTokens = Math.ceil(combinedPrompt.length / 4);
        totalOutputTokens = Math.ceil(response.length / 4);
      }

      // Extract citations from response
      const citations = this.extractCitations(fullResponse);

      // Yield the response
      yield {
        type: 'content',
        content: fullResponse,
        citations,
      };

      // Yield completion
      yield {
        type: 'done',
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          modelId,
        },
      };

    } catch (error) {
      this.logger.error(`Query failed: ${error.message}`);
      yield {
        type: 'error',
        error: error.message,
      };
      return;
    }

    // Store assistant response in Q&A log
    await this.storeQALogEntry(
      sessionId,
      'assistant',
      fullResponse,
      modelId,
      totalInputTokens,
      totalOutputTokens,
      this.extractCitations(fullResponse),
    );

    // Track usage through model router
    await this.modelRouter.trackUsage(sessionId, modelSelection.modelType, {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });
  }

  /**
   * Hybrid query: combines session documents (direct context) with KB retrieval results.
   * Session docs get priority (freshest, most relevant context).
   * KB results fill in historical context (prior filings, older research).
   * Falls back to session-only mode if KB is unavailable.
   *
   * Requirements: 4.1, 4.2, 4.5, 4.6, 9.2
   */
  async *hybridQuery(
    sessionId: string,
    query: string,
    options?: HybridQueryOptions,
  ): AsyncGenerator<QueryStreamChunk> {
    this.logger.log(`Processing hybrid query for session ${sessionId}: ${query.substring(0, 100)}...`);

    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== 'active') {
      throw new BadRequestException('Session is not active');
    }

    // Extend session timeout on activity
    await this.sessionManager.extendTimeout(sessionId);

    // Get session document content (priority context)
    const documents = await this.getSessionDocuments(sessionId);
    const sessionDocContent = documents
      .filter(doc => doc.extractedText)
      .map((doc, idx) => `[Session Doc ${idx + 1}: ${doc.fileName}]\n${doc.extractedText}`)
      .join('\n\n---\n\n');

    if (!sessionDocContent) {
      yield { type: 'error', error: 'No documents available in session' };
      return;
    }

    // Attempt KB retrieval for historical context
    let kbChunks: ChunkResult[] = [];
    let kbAvailable = true;
    const includeKB = options?.includeKB !== false;

    if (includeKB) {
      try {
        // CRITICAL: Include tenant_id and deal_id filters for tenant isolation
        // This ensures we only retrieve chunks that belong to this tenant
        // Requirements: 9.2, 9.4, 9.5
        const kbFilter: MetadataFilter = { 
          ticker: session.ticker,
          // Note: tenant_id filtering is handled by TenantAwareRAGService
          // which wraps BedrockService and adds (visibility='public' OR tenant_id=current)
          // For instant RAG private uploads, we filter by deal_id to scope to this deal
        };
        kbChunks = await this.bedrockService.retrieve(
          query,
          kbFilter,
          options?.kbResultCount ?? 5,
        );
        
        // Post-filter to ensure tenant isolation (safety net)
        // Only include public chunks or chunks belonging to this tenant
        kbChunks = kbChunks.filter(chunk => {
          const meta = chunk.metadata as any;
          // Allow public data (SEC filings)
          if (meta.visibility === 'public') return true;
          // Allow data from this tenant
          if (meta.tenant_id === session.tenantId) return true;
          // Allow legacy data without tenant_id (assume public)
          if (!meta.tenant_id && !meta.visibility) return true;
          // Reject cross-tenant private data
          this.logger.warn(`Filtered out cross-tenant chunk: ${meta.tenant_id} != ${session.tenantId}`);
          return false;
        });
        
        this.logger.log(`KB retrieval returned ${kbChunks.length} chunks for ticker=${session.ticker} (tenant-filtered)`);
      } catch (error) {
        this.logger.warn(`KB retrieval failed, falling back to session-only mode: ${error.message}`);
        kbAvailable = false;
      }
    }

    // Build hybrid prompt
    const systemPrompt = this.buildHybridSystemPrompt(kbAvailable && kbChunks.length > 0);
    const userPrompt = this.buildHybridUserPrompt(query, sessionDocContent, kbChunks);

    // Store user message in Q&A log
    await this.storeQALogEntry(sessionId, 'user', query);

    // Route query through ModelRouter
    const modelSelection = await this.modelRouter.routeQuery(query, sessionId);
    const modelId = modelSelection.modelId;

    // Emit model selection info
    yield {
      type: 'model_info',
      modelType: modelSelection.modelType,
      fallbackFromOpus: modelSelection.fallbackFromOpus,
      opusCallsRemaining: modelSelection.opusCallsRemaining,
      matchedTrigger: modelSelection.matchedTrigger,
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let fullResponse = '';

    try {
      const sessionImages = this.sessionImageCache.get(sessionId);
      const hasVisionContent = sessionImages && sessionImages.size > 0;

      if (hasVisionContent) {
        const allImages: { base64: string; mediaType: 'image/png' | 'image/jpeg' }[] = [];
        for (const [, images] of sessionImages) {
          for (const img of images) {
            if (allImages.length >= 20) break;
            allImages.push({ base64: img, mediaType: 'image/png' });
          }
          if (allImages.length >= 20) break;
        }

        const response = await this.bedrockService.invokeClaudeWithVision({
          prompt: userPrompt,
          images: allImages,
          systemPrompt,
          modelId,
          max_tokens: 4000,
        });

        fullResponse = response;
        totalInputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4) + (allImages.length * 1000);
        totalOutputTokens = Math.ceil(response.length / 4);
      } else {
        const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;

        const response = await this.bedrockService.invokeClaude({
          prompt: combinedPrompt,
          modelId,
          max_tokens: 4000,
        });

        fullResponse = response;
        totalInputTokens = Math.ceil(combinedPrompt.length / 4);
        totalOutputTokens = Math.ceil(response.length / 4);
      }

      // Extract both session doc citations and KB citations
      const citations = this.extractCitations(fullResponse);
      const kbCitations = this.extractKBCitations(fullResponse);

      yield {
        type: 'content',
        content: fullResponse,
        citations: [...citations, ...kbCitations.map(kbc => ({
          documentIndex: -1, // KB citations don't map to session doc indices
          pageNumber: kbc.pageNumber,
          text: kbc.text,
        }))],
      };

      yield {
        type: 'done',
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          modelId,
        },
      };
    } catch (error) {
      this.logger.error(`Hybrid query failed: ${error.message}`);
      yield { type: 'error', error: error.message };
      return;
    }

    // Store assistant response
    await this.storeQALogEntry(
      sessionId,
      'assistant',
      fullResponse,
      modelId,
      totalInputTokens,
      totalOutputTokens,
      this.extractCitations(fullResponse),
    );

    // Track usage
    await this.modelRouter.trackUsage(sessionId, modelSelection.modelType, {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });
  }

  /**
   * Build system prompt for Q&A queries
   */
  private buildQuerySystemPrompt(): string {
    return `You are a financial document analyst assistant. You have access to uploaded financial documents and must answer questions based solely on their content.

IMPORTANT GUIDELINES:
1. Answer questions using ONLY the information in the provided documents
2. When citing information, use the format [Doc N, p.X] where N is the document number and X is the page number if available
3. For numeric values, preserve the exact precision from the source documents
4. If a metric appears in multiple documents, show all instances and note any discrepancies
5. For calculations, show your work step-by-step with input sources
6. If information is ambiguous (e.g., GAAP vs Non-GAAP), calculate both and note the difference
7. If you cannot find the requested information in the documents, clearly state that
8. Check footnotes when answering metric queries
9. For tables, extract ALL rows and columns accurately

RESPONSE FORMAT:
- Be concise but thorough
- Use bullet points for lists
- Include citations for all factual claims
- Highlight any notable items (restatements, material weaknesses, going concern language)`;
  }

  /**
   * Build user prompt with document context
   */
  private buildQueryUserPrompt(query: string, documentContent: string): string {
    return `DOCUMENTS:
${documentContent}

---

USER QUESTION:
${query}

Please answer the question based on the documents above. Include citations in the format [Doc N, p.X] for any information you reference.`;
  }

  /**
   * Extract citations from Claude response
   * Parses [Doc N, p.X] format citations
   */
  private extractCitations(response: string): Citation[] {
    const citations: Citation[] = [];
    const citationRegex = /\[Doc\s*(\d+)(?:,\s*p\.?\s*(\d+))?\]/gi;
    
    let match;
    while ((match = citationRegex.exec(response)) !== null) {
      const docIndex = parseInt(match[1], 10);
      const pageNumber = match[2] ? parseInt(match[2], 10) : undefined;
      
      // Avoid duplicates
      const exists = citations.some(
        c => c.documentIndex === docIndex && c.pageNumber === pageNumber
      );
      
      if (!exists) {
        citations.push({
          documentIndex: docIndex,
          pageNumber,
          text: match[0],
        });
      }
    }

    return citations;
  }

  /**
   * Extract KB citations from Claude response
   * Parses [KB: TICKER FILING PERIOD, p.X] format citations
   * Requirements: 4.5, 4.6, 9.2
   */
  private extractKBCitations(response: string): KBCitation[] {
    const citations: KBCitation[] = [];
    const kbCitationRegex = /\[KB:\s*([A-Z]+)\s+(\S+)\s+(\S+)(?:,\s*p\.?\s*(\d+))?\]/gi;

    let match;
    while ((match = kbCitationRegex.exec(response)) !== null) {
      const ticker = match[1];
      const filingType = match[2];
      const fiscalPeriod = match[3];
      const pageNumber = match[4] ? parseInt(match[4], 10) : undefined;

      const exists = citations.some(
        c => c.ticker === ticker && c.filingType === filingType &&
             c.fiscalPeriod === fiscalPeriod && c.pageNumber === pageNumber
      );

      if (!exists) {
        citations.push({
          ticker,
          filingType,
          fiscalPeriod,
          sectionType: '',
          pageNumber,
          text: match[0],
        });
      }
    }

    return citations;
  }

  /**
   * Build system prompt for hybrid Q&A (session docs + KB context)
   * Requirements: 4.1, 4.2, 4.5, 4.6, 9.2
   */
  private buildHybridSystemPrompt(hasKBContext: boolean): string {
    const kbInstructions = hasKBContext
      ? `
You also have access to KNOWLEDGE BASE CONTEXT from prior filings and historical research.
- For session documents, cite as [Session Doc N, p.X]
- For KB context, cite as [KB: TICKER FILING PERIOD, p.X] (e.g., [KB: AAPL 10-K FY2023, p.12])
- Session documents are the PRIMARY source — prioritize them
- KB context provides HISTORICAL background — use it to enrich analysis with trends and comparisons`
      : `
You only have session documents available (KB context is unavailable).
- Cite as [Session Doc N, p.X]`;

    return `You are a financial document analyst assistant. You have access to uploaded financial documents from the current session.
${kbInstructions}

IMPORTANT GUIDELINES:
1. Answer questions using the provided documents and context
2. Session documents take priority over KB context
3. For numeric values, preserve the exact precision from the source documents
4. If a metric appears in multiple sources, show all instances and note any discrepancies
5. For calculations, show your work step-by-step with input sources
6. If inputs are ambiguous (GAAP vs Non-GAAP), calculate both and note the difference
7. If you cannot find the requested information, clearly state that
8. Check footnotes when answering metric queries
9. For tables, extract ALL rows and columns accurately

RESPONSE FORMAT:
- Be concise but thorough
- Use bullet points for lists
- Include citations for all factual claims
- Highlight any notable items (restatements, material weaknesses, going concern language)`;
  }

  /**
   * Build user prompt for hybrid query with session docs and KB context
   */
  private buildHybridUserPrompt(
    query: string,
    sessionDocContent: string,
    kbChunks: ChunkResult[],
  ): string {
    const parts: string[] = [];

    // Session documents (priority)
    parts.push('=== SESSION DOCUMENTS (PRIMARY) ===');
    parts.push(sessionDocContent);

    // KB context (historical)
    if (kbChunks.length > 0) {
      parts.push('\n\n=== KNOWLEDGE BASE CONTEXT (HISTORICAL) ===');
      kbChunks.forEach((chunk, idx) => {
        const meta = chunk.metadata;
        const label = `${meta.ticker || 'Unknown'} ${meta.filingType || ''} ${meta.fiscalPeriod || ''}`;
        parts.push(`\n[KB Source ${idx + 1}: ${label}${meta.sectionType ? ' - ' + meta.sectionType : ''}]`);
        parts.push(chunk.content);
      });
    }

    parts.push('\n\n---\n');
    parts.push(`USER QUESTION:\n${query}`);
    parts.push('\nPlease answer using the documents above. Cite session documents as [Session Doc N, p.X] and KB sources as [KB: TICKER FILING PERIOD, p.X].');

    return parts.join('\n');
  }

  /**
   * Store Q&A log entry in database
   */
  private async storeQALogEntry(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    modelUsed?: string,
    inputTokens?: number,
    outputTokens?: number,
    citations?: Citation[],
  ): Promise<void> {
    await this.prisma.$queryRaw`
      INSERT INTO instant_rag_qa_log (
        session_id, role, content, model_used, input_tokens, output_tokens, citations
      ) VALUES (
        ${sessionId}::uuid,
        ${role},
        ${content},
        ${modelUsed || null},
        ${inputTokens || null},
        ${outputTokens || null},
        ${citations ? JSON.stringify(citations) : null}::jsonb
      )
    `;
  }

  /**
   * Get Q&A history for a session
   */
  async getQAHistory(sessionId: string): Promise<QALogEntry[]> {
    const entries = await this.prisma.$queryRaw<any[]>`
      SELECT 
        id, role, content, model_used as "modelUsed",
        input_tokens as "inputTokens", output_tokens as "outputTokens",
        citations, created_at as "createdAt"
      FROM instant_rag_qa_log
      WHERE session_id = ${sessionId}::uuid
      ORDER BY created_at ASC
    `;

    return entries.map(e => ({
      id: e.id,
      role: e.role as 'user' | 'assistant',
      content: e.content,
      modelUsed: e.modelUsed,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      citations: e.citations || [],
      createdAt: e.createdAt,
    }));
  }

  /**
   * End session and trigger sync
   * Requirements: 8.6
   */
  async endSession(sessionId: string): Promise<SessionState> {
    this.logger.log(`Ending session ${sessionId}`);
    
    const session = await this.sessionManager.endSession(sessionId);

    // Clean up image cache for this session
    this.sessionImageCache.delete(sessionId);

    // Trigger async sync envelope generation (fire-and-forget)
    // This runs in the background - user gets immediate response
    await this.syncEnvelopeGenerator.executeAsyncSync(sessionId);

    return session;
  }

  /**
   * Check if session is active and not expired
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return false;
    
    return session.status === 'active' && session.expiresAt > new Date();
  }

  /**
   * Get cached images for a session (for vision queries)
   */
  getSessionImages(sessionId: string): Map<string, string[]> | undefined {
    return this.sessionImageCache.get(sessionId);
  }

  /**
   * Check if session has vision content available
   */
  hasVisionContent(sessionId: string): boolean {
    const cache = this.sessionImageCache.get(sessionId);
    return !!cache && cache.size > 0;
  }

  /**
   * Extend session timeout on activity
   */
  async extendSessionTimeout(sessionId: string): Promise<void> {
    await this.sessionManager.extendTimeout(sessionId);
  }
}
