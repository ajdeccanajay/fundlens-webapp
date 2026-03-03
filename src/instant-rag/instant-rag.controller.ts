/**
 * Instant RAG Controller
 * 
 * REST API for instant document processing and Q&A.
 * Supports batch file upload, session management, and SSE streaming.
 * 
 * All endpoints are protected by TenantGuard for tenant isolation.
 * 
 * Requirements: 1.1, 1.6, 12.1, 12.2, 4.1, 4.2, 4.3, 4.5
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UseFilters,
  UploadedFiles,
  BadRequestException,
  NotFoundException,
  Req,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { TenantGuard } from '../tenant/tenant.guard';
import { TENANT_CONTEXT_KEY, TenantContext } from '../tenant/tenant-context';
import { SessionManagerService, SessionState } from './session-manager.service';
import { DocumentProcessorService, ProcessedDocument } from './document-processor.service';
import { FileValidatorService, MAX_FILES_PER_BATCH } from './file-validator.service';
import { InstantRAGService, IntakeSummary, QALogEntry } from './instant-rag.service';
import { RateLimitExceptionFilter } from './rate-limit.filter';
import { PrismaService } from '../../prisma/prisma.service';

interface UploadResponse {
  sessionId: string;
  status: 'processing' | 'complete' | 'partial_success';
  documents: {
    fileName: string;
    status: 'processing' | 'complete' | 'failed' | 'duplicate' | 'pending';
    documentId?: string;
    error?: string;
    isDuplicate?: boolean;
    existingDocumentId?: string;
  }[];
  errors: {
    fileName: string;
    errorCode: string;
    message: string;
  }[];
  summary: string;
}

interface SessionStatusResponse {
  sessionId: string;
  status: string;
  expiresAt: string;
  expiresInSeconds: number;
  filesTotal: number;
  filesProcessed: number;
  filesFailed: number;
  modelUsage: {
    sonnetCalls: number;
    opusCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
}

@Controller('instant-rag')
@UseGuards(TenantGuard)
@UseFilters(RateLimitExceptionFilter)
export class InstantRAGController {
  private readonly logger = new Logger(InstantRAGController.name);

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly documentProcessor: DocumentProcessorService,
    private readonly fileValidator: FileValidatorService,
    private readonly instantRAGService: InstantRAGService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Upload documents to an instant RAG session
   * Creates a new session if none exists for the user+deal
   */
  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_BATCH, {
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
    }),
  )
  async uploadDocuments(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('dealId') dealId: string,
    @Req() req: Request,
  ): Promise<UploadResponse> {
    const context = this.getTenantContext(req);
    const { tenantId, userId } = context;

    this.logger.log(`Upload request: ${files?.length || 0} files for deal ${dealId}, tenant=${tenantId}, user=${userId}`);

    // Validate request
    if (!dealId) {
      throw new BadRequestException('dealId is required');
    }

    // Validate dealId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(dealId)) {
      throw new BadRequestException(`Invalid dealId format: "${dealId}". Must be a valid UUID.`);
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    // Validate deal exists and belongs to tenant
    const deal = await this.prisma.$queryRaw<{ id: string; ticker: string }[]>`
      SELECT id, ticker FROM deals 
      WHERE id = ${dealId}::uuid AND tenant_id = ${tenantId}
    `;

    if (!deal[0]) {
      throw new NotFoundException('Deal not found');
    }

    const ticker = deal[0].ticker || 'UNKNOWN';

    // Validate files
    const validationResult = this.fileValidator.validateBatch(files);

    // If batch-level error, return immediately
    if (validationResult.batchError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: validationResult.batchError.errorCode,
        message: validationResult.batchError.message,
      });
    }

    // Get or create session
    let session = await this.sessionManager.getActiveSession(tenantId, dealId, userId);
    
    if (!session) {
      session = await this.sessionManager.createSession({
        tenantId,
        dealId,
        userId,
        ticker,
      });
      this.logger.log(`Created new session ${session.id}`);
    } else {
      // Extend timeout on activity
      await this.sessionManager.extendTimeout(session.id);
      this.logger.log(`Using existing session ${session.id}`);
    }

    // Set total file count
    await this.sessionManager.setFilesTotal(session.id, validationResult.validFiles.length);

    // Process valid files
    const processedDocs: ProcessedDocument[] = [];
    for (const file of validationResult.validFiles) {
      const result = await this.documentProcessor.processFile(
        file,
        session.id,
        tenantId,
        dealId,
      );
      processedDocs.push(result);

      // Update counters
      if (result.processingStatus === 'complete') {
        await this.sessionManager.incrementFileCounters(session.id, 1, 0);
      } else if (result.processingStatus === 'failed') {
        await this.sessionManager.incrementFileCounters(session.id, 0, 1);
      }

      // Store document in database (both complete and failed, skip duplicates)
      // Note: session_id is UUID, tenant_id is TEXT
      if (!result.isDuplicate) {
        const pageImagesJson = result.pageImages && result.pageImages.length > 0
          ? JSON.stringify(result.pageImages)
          : '[]';
        const docResult = await this.prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO instant_rag_documents (
            session_id, tenant_id, file_name, file_type, file_size_bytes,
            content_hash, s3_key, extracted_text, extracted_tables,
            page_count, page_images, processing_status, processing_error, processing_duration_ms
          ) VALUES (
            ${session.id}::uuid, ${tenantId}, ${result.fileName},
            ${result.fileType}, ${BigInt(Math.round(result.fileSizeMb * 1024 * 1024))},
            ${result.contentHash}, ${'instant-rag/' + session.id + '/' + result.fileName},
            ${result.extractedText || ''}, ${JSON.stringify(result.extractedTables)}::jsonb,
            ${result.pageCount}, ${pageImagesJson}::jsonb, ${result.processingStatus}, ${result.processingError || null},
            ${result.processingDurationMs}
          )
          RETURNING id
        `;
        result.documentId = docResult[0].id;
      }
    }

    // Build response
    const documents = processedDocs.map(doc => ({
      fileName: doc.fileName,
      status: doc.isDuplicate ? 'duplicate' as const : doc.processingStatus,
      documentId: doc.documentId || doc.existingDocumentId,
      error: doc.processingError,
      isDuplicate: doc.isDuplicate,
      existingDocumentId: doc.existingDocumentId,
    }));

    const errors = validationResult.invalidFiles.map(err => ({
      fileName: err.fileName,
      errorCode: err.errorCode,
      message: err.message,
    }));

    const successCount = documents.filter(d => d.status === 'complete' || d.status === 'duplicate').length;
    const failCount = documents.filter(d => d.status === 'failed').length + errors.length;

    let status: 'processing' | 'complete' | 'partial_success';
    if (failCount === 0) {
      status = 'complete';
    } else if (successCount > 0) {
      status = 'partial_success';
    } else {
      status = 'complete'; // All failed but we still return
    }

    return {
      sessionId: session.id,
      status,
      documents,
      errors,
      summary: this.fileValidator.getSummary(validationResult),
    };
  }

  /**
   * Get session details
   */
  @Get('session/:sessionId')
  async getSession(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<SessionState> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  /**
   * Get session status (for polling)
   */
  @Get('session/:sessionId/status')
  async getSessionStatus(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<SessionStatusResponse> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const expiresInSeconds = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));

    return {
      sessionId: session.id,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      expiresInSeconds,
      filesTotal: session.filesTotal,
      filesProcessed: session.filesProcessed,
      filesFailed: session.filesFailed,
      modelUsage: {
        sonnetCalls: session.sonnetCalls,
        opusCalls: session.opusCalls,
        totalInputTokens: session.totalInputTokens,
        totalOutputTokens: session.totalOutputTokens,
      },
    };
  }

  /**
   * Stream session status updates via SSE
   * Emits events for each processing phase and per-file status
   * Requirements: 12.1, 12.2
   */
  @Get('session/:sessionId/status/stream')
  async streamSessionStatus(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send initial status
    const sendStatus = async () => {
      const currentSession = await this.sessionManager.getSession(sessionId);
      if (!currentSession) {
        res.write(`data: ${JSON.stringify({ type: 'session_ended' })}\n\n`);
        return false;
      }

      const expiresInSeconds = Math.max(0, Math.floor((currentSession.expiresAt.getTime() - Date.now()) / 1000));
      
      const statusEvent = {
        type: 'status',
        sessionId: currentSession.id,
        status: currentSession.status,
        expiresAt: currentSession.expiresAt.toISOString(),
        expiresInSeconds,
        filesTotal: currentSession.filesTotal,
        filesProcessed: currentSession.filesProcessed,
        filesFailed: currentSession.filesFailed,
        modelUsage: {
          sonnetCalls: currentSession.sonnetCalls,
          opusCalls: currentSession.opusCalls,
          totalInputTokens: currentSession.totalInputTokens,
          totalOutputTokens: currentSession.totalOutputTokens,
        },
      };

      res.write(`data: ${JSON.stringify(statusEvent)}\n\n`);

      // Check if session is ended or expired
      if (currentSession.status === 'ended' || currentSession.status === 'expired') {
        res.write(`data: ${JSON.stringify({ type: 'session_ended', status: currentSession.status })}\n\n`);
        return false;
      }

      // Send timeout warning if expiring soon (< 60 seconds)
      if (expiresInSeconds > 0 && expiresInSeconds <= 60) {
        res.write(`data: ${JSON.stringify({ 
          type: 'timeout_warning', 
          expiresInSeconds,
          message: `Session expires in ${expiresInSeconds} seconds`
        })}\n\n`);
      }

      return true;
    };

    // Send initial status
    const shouldContinue = await sendStatus();
    if (!shouldContinue) {
      res.end();
      return;
    }

    // Poll for updates every 2 seconds
    const intervalId = setInterval(async () => {
      try {
        const shouldContinue = await sendStatus();
        if (!shouldContinue) {
          clearInterval(intervalId);
          res.end();
        }
      } catch (error) {
        this.logger.error(`SSE status error: ${error.message}`);
        clearInterval(intervalId);
        res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
        res.end();
      }
    }, 2000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(intervalId);
      this.logger.log(`SSE connection closed for session ${sessionId}`);
    });
  }

  /**
   * End a session and trigger sync
   */
  @Post('session/:sessionId/end')
  async endSession(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{ sessionId: string; status: string; message: string }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const endedSession = await this.sessionManager.endSession(sessionId);

    // TODO: Trigger sync envelope generation asynchronously

    return {
      sessionId: endedSession.id,
      status: endedSession.status,
      message: 'Session ended. Sync will be processed asynchronously.',
    };
  }

  /**
   * Retry failed files in a session
   * Allows re-uploading specific files that failed during initial processing
   * Requirements: 12.3, 12.4, 12.5
   */
  @Post('session/:sessionId/retry')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_BATCH, {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async retryFailedFiles(
    @Param('sessionId') sessionId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ): Promise<{
    sessionId: string;
    retried: { fileName: string; status: string; documentId?: string; error?: string }[];
    summary: string;
  }> {
    const context = this.getTenantContext(req);
    const { tenantId } = context;

    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== tenantId) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== 'active') {
      throw new BadRequestException('Session is not active. Cannot retry files.');
    }

    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided for retry');
    }

    this.logger.log(`Retry request: ${files.length} files for session ${sessionId}`);

    // Extend session timeout on activity
    await this.sessionManager.extendTimeout(sessionId);

    // Validate files
    const validationResult = this.fileValidator.validateBatch(files);

    if (validationResult.batchError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: validationResult.batchError.errorCode,
        message: validationResult.batchError.message,
      });
    }

    // Process retry files
    const retried: { fileName: string; status: string; documentId?: string; error?: string }[] = [];

    for (const file of validationResult.validFiles) {
      try {
        const result = await this.documentProcessor.processFile(
          file,
          sessionId,
          tenantId,
          session.dealId,
        );

        if (result.processingStatus === 'complete' && !result.isDuplicate) {
          // Store document in database
          // Note: session_id is UUID, tenant_id is TEXT
          const pageImagesJson = result.pageImages && result.pageImages.length > 0
            ? JSON.stringify(result.pageImages)
            : '[]';
          const docResult = await this.prisma.$queryRaw<{ id: string }[]>`
            INSERT INTO instant_rag_documents (
              session_id, tenant_id, file_name, file_type, file_size_bytes,
              content_hash, s3_key, extracted_text, extracted_tables,
              page_count, page_images, processing_status, processing_duration_ms
            ) VALUES (
              ${sessionId}::uuid, ${tenantId}, ${result.fileName},
              ${result.fileType}, ${BigInt(Math.round(result.fileSizeMb * 1024 * 1024))},
              ${result.contentHash}, ${'instant-rag/' + sessionId + '/' + result.fileName},
              ${result.extractedText}, ${JSON.stringify(result.extractedTables)}::jsonb,
              ${result.pageCount}, ${pageImagesJson}::jsonb, 'complete', ${result.processingDurationMs}
            )
            RETURNING id
          `;

          await this.sessionManager.incrementFileCounters(sessionId, 1, 0);

          retried.push({
            fileName: result.fileName,
            status: 'complete',
            documentId: docResult[0].id,
          });
        } else if (result.isDuplicate) {
          retried.push({
            fileName: result.fileName,
            status: 'duplicate',
            documentId: result.existingDocumentId,
          });
        } else {
          retried.push({
            fileName: result.fileName,
            status: 'failed',
            error: result.processingError,
          });
        }
      } catch (error) {
        this.logger.error(`Retry failed for ${file.originalname}: ${error.message}`);
        retried.push({
          fileName: file.originalname,
          status: 'failed',
          error: error.message,
        });
      }
    }

    // Add validation errors
    for (const err of validationResult.invalidFiles) {
      retried.push({
        fileName: err.fileName,
        status: 'failed',
        error: err.message,
      });
    }

    const successCount = retried.filter(r => r.status === 'complete' || r.status === 'duplicate').length;
    const failCount = retried.filter(r => r.status === 'failed').length;

    return {
      sessionId,
      retried,
      summary: `Retried ${files.length} files: ${successCount} succeeded, ${failCount} failed`,
    };
  }

  /**
   * Get failed documents in a session for retry
   * Requirements: 12.3
   */
  @Get('session/:sessionId/failed')
  async getFailedDocuments(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{
    sessionId: string;
    failedDocuments: { fileName: string; error: string; createdAt: string }[];
    total: number;
  }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const failedDocs = await this.prisma.$queryRaw<{
      file_name: string;
      processing_error: string;
      created_at: Date;
    }[]>`
      SELECT file_name, processing_error, created_at
      FROM instant_rag_documents
      WHERE session_id = ${sessionId}::uuid
        AND processing_status = 'failed'
      ORDER BY created_at ASC
    `;

    return {
      sessionId,
      failedDocuments: failedDocs.map(doc => ({
        fileName: doc.file_name,
        error: doc.processing_error || 'Unknown error',
        createdAt: doc.created_at.toISOString(),
      })),
      total: failedDocs.length,
    };
  }

  /**
   * Recover a recently expired session
   * Allows recovery within 5 minutes of expiration
   * Requirements: 12.4, 12.5
   */
  @Post('session/:sessionId/recover')
  async recoverSession(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{
    sessionId: string;
    status: string;
    recovered: boolean;
    message: string;
    expiresAt?: string;
  }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    // Check if session is recoverable (expired within last 5 minutes)
    const RECOVERY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const expiredAt = session.expiresAt.getTime();
    const timeSinceExpiry = now - expiredAt;

    if (session.status === 'active') {
      // Session is still active, just extend it
      const extended = await this.sessionManager.extendTimeout(sessionId);
      return {
        sessionId,
        status: extended.status,
        recovered: false,
        message: 'Session is still active. Timeout extended.',
        expiresAt: extended.expiresAt.toISOString(),
      };
    }

    if (session.status === 'ended') {
      return {
        sessionId,
        status: session.status,
        recovered: false,
        message: 'Session was explicitly ended and cannot be recovered.',
      };
    }

    if (session.status === 'expired' && timeSinceExpiry <= RECOVERY_WINDOW_MS) {
      // Recover the session
      const newExpiresAt = new Date(now + 10 * 60 * 1000); // 10 minutes from now
      
      await this.prisma.$executeRaw`
        UPDATE instant_rag_sessions
        SET status = 'active',
            expires_at = ${newExpiresAt},
            last_activity_at = NOW()
        WHERE id = ${sessionId}::uuid
      `;

      this.logger.log(`Recovered expired session ${sessionId}`);

      return {
        sessionId,
        status: 'active',
        recovered: true,
        message: 'Session recovered successfully.',
        expiresAt: newExpiresAt.toISOString(),
      };
    }

    // Session expired too long ago
    return {
      sessionId,
      status: session.status,
      recovered: false,
      message: `Session expired ${Math.round(timeSinceExpiry / 1000 / 60)} minutes ago. Recovery window (5 minutes) has passed.`,
    };
  }

  /**
   * Get documents in a session
   */
  @Get('session/:sessionId/documents')
  async getSessionDocuments(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{ documents: any[]; total: number }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const documents = await this.prisma.$queryRaw<any[]>`
      SELECT 
        id, file_name as "fileName", file_type as "fileType",
        file_size_bytes as "fileSizeBytes", content_hash as "contentHash",
        page_count as "pageCount", processing_status as "processingStatus",
        processing_error as "processingError", processing_duration_ms as "processingDurationMs",
        created_at as "createdAt"
      FROM instant_rag_documents
      WHERE session_id = ${sessionId}::uuid
      ORDER BY created_at ASC
    `;

    return {
      documents: documents.map(doc => ({
        ...doc,
        fileSizeBytes: Number(doc.fileSizeBytes),
      })),
      total: documents.length,
    };
  }

  /**
   * Get active session for current user+deal
   */
  @Get('active-session')
  async getActiveSession(
    @Body('dealId') dealId: string,
    @Req() req: Request,
  ): Promise<SessionState | null> {
    const context = this.getTenantContext(req);
    
    if (!dealId) {
      throw new BadRequestException('dealId is required');
    }

    return this.sessionManager.getActiveSession(
      context.tenantId,
      dealId,
      context.userId,
    );
  }

  /**
   * Query documents in a session using instant Q&A mode
   * Streams response via SSE
   * Requirements: 4.1, 4.2, 4.3, 4.5
   */
  @Post('session/:sessionId/query')
  async query(
    @Param('sessionId') sessionId: string,
    @Body('query') query: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Query is required');
    }

    this.logger.log(`Query request for session ${sessionId}: ${query.substring(0, 100)}...`);

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      // Stream the response
      for await (const chunk of this.instantRAGService.query(sessionId, query)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    } catch (error) {
      this.logger.error(`Query error: ${error.message}`);
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    }

    res.end();
  }

  /**
   * Generate intake summaries for session documents
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
   */
  @Post('session/:sessionId/intake-summaries')
  async generateIntakeSummaries(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{ summaries: IntakeSummary[] }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const summaries = await this.instantRAGService.generateIntakeSummaries(sessionId);

    return { summaries };
  }

  /**
   * Get intake summaries for a session
   */
  @Get('session/:sessionId/intake-summaries')
  async getIntakeSummaries(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{ summaries: IntakeSummary[] }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const summaries = await this.instantRAGService.getIntakeSummaries(sessionId);

    return { summaries };
  }

  /**
   * Get Q&A history for a session
   */
  @Get('session/:sessionId/qa-history')
  async getQAHistory(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{ history: QALogEntry[] }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    const history = await this.instantRAGService.getQAHistory(sessionId);

    return { history };
  }

  /**
   * Get cost metrics for a session
   * Tracks token usage, model usage, and estimated costs
   * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
   */
  @Get('session/:sessionId/cost')
  async getSessionCost(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<{
    sessionId: string;
    usage: {
      sonnetCalls: number;
      opusCalls: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    };
    estimatedCost: {
      sonnetInputCost: number;
      sonnetOutputCost: number;
      opusInputCost: number;
      opusOutputCost: number;
      totalCost: number;
      currency: string;
    };
    warnings: string[];
  }> {
    const context = this.getTenantContext(req);
    
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session || session.tenantId !== context.tenantId) {
      throw new NotFoundException('Session not found');
    }

    // Pricing per 1M tokens (approximate as of 2026)
    const SONNET_INPUT_PRICE = 3.00;  // $3 per 1M input tokens
    const SONNET_OUTPUT_PRICE = 15.00; // $15 per 1M output tokens
    const OPUS_INPUT_PRICE = 15.00;   // $15 per 1M input tokens
    const OPUS_OUTPUT_PRICE = 75.00;  // $75 per 1M output tokens

    // Estimate token distribution (assume 80% Sonnet, 20% Opus based on call ratio)
    const totalCalls = session.sonnetCalls + session.opusCalls;
    const sonnetRatio = totalCalls > 0 ? session.sonnetCalls / totalCalls : 1;
    const opusRatio = totalCalls > 0 ? session.opusCalls / totalCalls : 0;

    const sonnetInputTokens = Math.round(session.totalInputTokens * sonnetRatio);
    const sonnetOutputTokens = Math.round(session.totalOutputTokens * sonnetRatio);
    const opusInputTokens = Math.round(session.totalInputTokens * opusRatio);
    const opusOutputTokens = Math.round(session.totalOutputTokens * opusRatio);

    const sonnetInputCost = (sonnetInputTokens / 1_000_000) * SONNET_INPUT_PRICE;
    const sonnetOutputCost = (sonnetOutputTokens / 1_000_000) * SONNET_OUTPUT_PRICE;
    const opusInputCost = (opusInputTokens / 1_000_000) * OPUS_INPUT_PRICE;
    const opusOutputCost = (opusOutputTokens / 1_000_000) * OPUS_OUTPUT_PRICE;
    const totalCost = sonnetInputCost + sonnetOutputCost + opusInputCost + opusOutputCost;

    // Generate warnings for high-cost sessions
    const warnings: string[] = [];
    const HIGH_COST_THRESHOLD = 1.00; // $1
    const HIGH_TOKEN_THRESHOLD = 100_000;

    if (totalCost > HIGH_COST_THRESHOLD) {
      warnings.push(`High cost session: $${totalCost.toFixed(2)} exceeds threshold of $${HIGH_COST_THRESHOLD}`);
      this.logger.warn(`High cost session ${sessionId}: $${totalCost.toFixed(2)}`);
    }

    if (session.totalInputTokens + session.totalOutputTokens > HIGH_TOKEN_THRESHOLD) {
      warnings.push(`High token usage: ${session.totalInputTokens + session.totalOutputTokens} tokens`);
    }

    if (session.opusCalls >= 5) {
      warnings.push('Opus budget exhausted (5 calls max)');
    }

    return {
      sessionId,
      usage: {
        sonnetCalls: session.sonnetCalls,
        opusCalls: session.opusCalls,
        totalInputTokens: session.totalInputTokens,
        totalOutputTokens: session.totalOutputTokens,
      },
      estimatedCost: {
        sonnetInputCost: Math.round(sonnetInputCost * 10000) / 10000,
        sonnetOutputCost: Math.round(sonnetOutputCost * 10000) / 10000,
        opusInputCost: Math.round(opusInputCost * 10000) / 10000,
        opusOutputCost: Math.round(opusOutputCost * 10000) / 10000,
        totalCost: Math.round(totalCost * 10000) / 10000,
        currency: 'USD',
      },
      warnings,
    };
  }

  /**
   * Get aggregated cost metrics for a tenant (admin endpoint)
   * Requirements: 14.3, 14.4
   */
  @Get('admin/cost-metrics')
  async getTenantCostMetrics(
    @Req() req: Request,
  ): Promise<{
    tenantId: string;
    period: { start: string; end: string };
    sessions: {
      total: number;
      active: number;
      ended: number;
      expired: number;
    };
    usage: {
      totalSonnetCalls: number;
      totalOpusCalls: number;
      totalInputTokens: number;
      totalOutputTokens: number;
    };
    estimatedTotalCost: number;
    topSessions: {
      sessionId: string;
      dealId: string;
      totalTokens: number;
      estimatedCost: number;
    }[];
  }> {
    const context = this.getTenantContext(req);
    const tenantId = context.tenantId;

    // Get sessions from last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const sessionStats = await this.prisma.$queryRaw<{
      status: string;
      count: number;
      total_sonnet_calls: number;
      total_opus_calls: number;
      total_input_tokens: number;
      total_output_tokens: number;
    }[]>`
      SELECT 
        status,
        COUNT(*)::int as count,
        SUM(sonnet_calls)::int as total_sonnet_calls,
        SUM(opus_calls)::int as total_opus_calls,
        SUM(total_input_tokens)::int as total_input_tokens,
        SUM(total_output_tokens)::int as total_output_tokens
      FROM instant_rag_sessions
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${thirtyDaysAgo}
      GROUP BY status
    `;

    // Aggregate stats
    let totalSessions = 0;
    let activeSessions = 0;
    let endedSessions = 0;
    let expiredSessions = 0;
    let totalSonnetCalls = 0;
    let totalOpusCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const stat of sessionStats) {
      totalSessions += stat.count;
      totalSonnetCalls += stat.total_sonnet_calls || 0;
      totalOpusCalls += stat.total_opus_calls || 0;
      totalInputTokens += stat.total_input_tokens || 0;
      totalOutputTokens += stat.total_output_tokens || 0;

      if (stat.status === 'active') activeSessions = stat.count;
      if (stat.status === 'ended') endedSessions = stat.count;
      if (stat.status === 'expired') expiredSessions = stat.count;
    }

    // Estimate total cost
    const SONNET_COST_PER_TOKEN = (3.00 + 15.00) / 2 / 1_000_000; // Average of input/output
    const OPUS_COST_PER_TOKEN = (15.00 + 75.00) / 2 / 1_000_000;
    
    const totalCalls = totalSonnetCalls + totalOpusCalls;
    const sonnetRatio = totalCalls > 0 ? totalSonnetCalls / totalCalls : 1;
    const opusRatio = totalCalls > 0 ? totalOpusCalls / totalCalls : 0;
    
    const estimatedTotalCost = 
      (totalInputTokens + totalOutputTokens) * sonnetRatio * SONNET_COST_PER_TOKEN +
      (totalInputTokens + totalOutputTokens) * opusRatio * OPUS_COST_PER_TOKEN;

    // Get top sessions by cost
    // Note: tenant_id is TEXT column
    const topSessions = await this.prisma.$queryRaw<{
      id: string;
      deal_id: string;
      total_tokens: number;
    }[]>`
      SELECT 
        id,
        deal_id,
        (total_input_tokens + total_output_tokens)::int as total_tokens
      FROM instant_rag_sessions
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${thirtyDaysAgo}
      ORDER BY (total_input_tokens + total_output_tokens) DESC
      LIMIT 10
    `;

    return {
      tenantId,
      period: {
        start: thirtyDaysAgo.toISOString(),
        end: new Date().toISOString(),
      },
      sessions: {
        total: totalSessions,
        active: activeSessions,
        ended: endedSessions,
        expired: expiredSessions,
      },
      usage: {
        totalSonnetCalls,
        totalOpusCalls,
        totalInputTokens,
        totalOutputTokens,
      },
      estimatedTotalCost: Math.round(estimatedTotalCost * 100) / 100,
      topSessions: topSessions.map(s => ({
        sessionId: s.id,
        dealId: s.deal_id,
        totalTokens: s.total_tokens,
        estimatedCost: Math.round(s.total_tokens * SONNET_COST_PER_TOKEN * 10000) / 10000,
      })),
    };
  }

  /**
   * Extract tenant context from request
   */
  private getTenantContext(req: Request): TenantContext {
    const context = (req as any)[TENANT_CONTEXT_KEY] as TenantContext;
    if (!context) {
      throw new BadRequestException('Tenant context not found');
    }
    return context;
  }
}
