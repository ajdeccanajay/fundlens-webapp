/**
 * Session Manager Service for Instant RAG
 * 
 * Manages session lifecycle including:
 * - Session creation with rate limit enforcement
 * - Session state management
 * - Timeout handling and cleanup
 * - Rate limiting (max 3 per tenant, max 1 per user+deal)
 * 
 * Requirements: 1.7, 1.8, 1.9, 11.1, 11.4, 13.1, 13.2
 */

import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RateLimitException } from './rate-limit.exception';

// Session timeout in seconds (10 minutes)
const SESSION_TIMEOUT_SECONDS = 600;

// Rate limits
const MAX_TENANT_SESSIONS = 3;
const MAX_USER_DEAL_SESSIONS = 1;

export interface CreateSessionParams {
  tenantId: string;
  dealId: string;
  userId: string;
  ticker: string;
}

export interface SessionState {
  id: string;
  tenantId: string;
  dealId: string;
  userId: string;
  ticker: string;
  status: 'active' | 'processing' | 'ended' | 'expired';
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  sonnetCalls: number;
  opusCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  filesTotal: number;
  filesProcessed: number;
  filesFailed: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Event emitted when a session is about to expire
 * Requirements: 11.5
 */
export interface SessionTimeoutWarningEvent {
  sessionId: string;
  tenantId: string;
  userId: string;
  dealId: string;
  expiresAt: Date;
  secondsRemaining: number;
}

/**
 * Event emitted when a session expires and needs sync
 * Requirements: 11.2, 11.3
 */
export interface SessionExpiredEvent {
  sessionId: string;
  tenantId: string;
  dealId: string;
  userId: string;
}

@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);
  
  // Track sessions that have already received timeout warnings
  private readonly warnedSessions = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a new instant RAG session
   * Enforces rate limits before creation
   */
  async createSession(params: CreateSessionParams): Promise<SessionState> {
    const { tenantId, dealId, userId, ticker } = params;

    this.logger.log(`Creating session for tenant=${tenantId}, deal=${dealId}, user=${userId}`);

    // Check rate limits
    const rateLimitResult = await this.enforceRateLimits(tenantId, userId, dealId);
    if (!rateLimitResult.allowed) {
      // Log rate limit violation
      this.logger.warn(
        `Rate limit exceeded for tenant=${tenantId}, user=${userId}, deal=${dealId}: ${rateLimitResult.reason}`,
      );
      
      // Determine limit type for proper error response
      const limitType = rateLimitResult.reason?.includes('tenant')
        ? 'tenant_sessions'
        : 'user_deal_session';
      
      throw new RateLimitException(
        rateLimitResult.reason || 'Rate limit exceeded',
        rateLimitResult.retryAfterSeconds || 60,
        limitType as 'tenant_sessions' | 'user_deal_session',
      );
    }

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_SECONDS * 1000);

    // Create session
    // Note: tenant_id and user_id are TEXT columns, deal_id is UUID
    const result = await this.prisma.$queryRaw<SessionState[]>`
      INSERT INTO instant_rag_sessions (
        tenant_id, deal_id, user_id, ticker, status, expires_at
      )
      VALUES (
        ${tenantId}, ${dealId}::uuid, ${userId}, ${ticker}, 'active', ${expiresAt}
      )
      RETURNING 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
    `;

    this.logger.log(`Created session ${result[0].id}`);
    return result[0];
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionState | null> {
    const result = await this.prisma.$queryRaw<SessionState[]>`
      SELECT 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
      FROM instant_rag_sessions
      WHERE id = ${sessionId}::uuid
    `;

    return result[0] || null;
  }

  /**
   * Get active session for user+deal combination
   */
  async getActiveSession(tenantId: string, dealId: string, userId: string): Promise<SessionState | null> {
    // Note: tenant_id and user_id are TEXT columns, deal_id is UUID
    const result = await this.prisma.$queryRaw<SessionState[]>`
      SELECT 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
      FROM instant_rag_sessions
      WHERE tenant_id = ${tenantId}
        AND deal_id = ${dealId}::uuid
        AND user_id = ${userId}
        AND status = 'active'
        AND expires_at > NOW()
    `;

    return result[0] || null;
  }

  /**
   * Update session state
   */
  async updateSession(sessionId: string, updates: Partial<SessionState>): Promise<SessionState> {
    const updateFields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      updateFields.push(`status = $${values.length + 1}`);
      values.push(updates.status);
    }
    if (updates.sonnetCalls !== undefined) {
      updateFields.push(`sonnet_calls = $${values.length + 1}`);
      values.push(updates.sonnetCalls);
    }
    if (updates.opusCalls !== undefined) {
      updateFields.push(`opus_calls = $${values.length + 1}`);
      values.push(updates.opusCalls);
    }
    if (updates.totalInputTokens !== undefined) {
      updateFields.push(`total_input_tokens = $${values.length + 1}`);
      values.push(updates.totalInputTokens);
    }
    if (updates.totalOutputTokens !== undefined) {
      updateFields.push(`total_output_tokens = $${values.length + 1}`);
      values.push(updates.totalOutputTokens);
    }
    if (updates.filesTotal !== undefined) {
      updateFields.push(`files_total = $${values.length + 1}`);
      values.push(updates.filesTotal);
    }
    if (updates.filesProcessed !== undefined) {
      updateFields.push(`files_processed = $${values.length + 1}`);
      values.push(updates.filesProcessed);
    }
    if (updates.filesFailed !== undefined) {
      updateFields.push(`files_failed = $${values.length + 1}`);
      values.push(updates.filesFailed);
    }

    // Always update last_activity_at
    updateFields.push(`last_activity_at = NOW()`);

    if (updateFields.length === 0) {
      const session = await this.getSession(sessionId);
      if (!session) throw new NotFoundException('Session not found');
      return session;
    }

    values.push(sessionId);
    const query = `
      UPDATE instant_rag_sessions
      SET ${updateFields.join(', ')}
      WHERE id = $${values.length}::uuid
      RETURNING 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
    `;

    const result = await this.prisma.$queryRawUnsafe<SessionState[]>(query, ...values);
    
    if (!result[0]) {
      throw new NotFoundException('Session not found');
    }

    return result[0];
  }

  /**
   * End a session and mark it as ended
   */
  async endSession(sessionId: string): Promise<SessionState> {
    this.logger.log(`Ending session ${sessionId}`);

    const result = await this.prisma.$queryRaw<SessionState[]>`
      UPDATE instant_rag_sessions
      SET status = 'ended', last_activity_at = NOW()
      WHERE id = ${sessionId}::uuid AND status IN ('active', 'processing')
      RETURNING 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
    `;

    if (!result[0]) {
      throw new NotFoundException('Session not found or already ended');
    }

    this.logger.log(`Session ${sessionId} ended successfully`);
    return result[0];
  }

  /**
   * Extend session timeout on user activity
   */
  async extendTimeout(sessionId: string): Promise<SessionState> {
    const newExpiresAt = new Date(Date.now() + SESSION_TIMEOUT_SECONDS * 1000);

    const result = await this.prisma.$queryRaw<SessionState[]>`
      UPDATE instant_rag_sessions
      SET expires_at = ${newExpiresAt}, last_activity_at = NOW()
      WHERE id = ${sessionId}::uuid AND status = 'active'
      RETURNING 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
    `;

    if (!result[0]) {
      throw new NotFoundException('Session not found or not active');
    }

    this.logger.debug(`Extended timeout for session ${sessionId} to ${newExpiresAt}`);
    return result[0];
  }

  /**
   * Enforce rate limits for session creation
   * - Max 3 concurrent sessions per tenant
   * - Max 1 active session per user+deal
   */
  async enforceRateLimits(
    tenantId: string,
    userId: string,
    dealId: string,
  ): Promise<RateLimitResult> {
    // Check tenant-level limit (max 3 concurrent sessions)
    // Note: tenant_id is TEXT column
    const tenantSessionCount = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int as count
      FROM instant_rag_sessions
      WHERE tenant_id = ${tenantId}
        AND status = 'active'
        AND expires_at > NOW()
    `;

    if (tenantSessionCount[0].count >= MAX_TENANT_SESSIONS) {
      this.logger.warn(`Rate limit exceeded: tenant ${tenantId} has ${tenantSessionCount[0].count} active sessions`);
      return {
        allowed: false,
        reason: `Maximum ${MAX_TENANT_SESSIONS} concurrent sessions per tenant exceeded`,
        retryAfterSeconds: 60,
      };
    }

    // Check user+deal limit (max 1 active session)
    // Note: tenant_id and user_id are TEXT columns, deal_id is UUID
    const userDealSessionCount = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int as count
      FROM instant_rag_sessions
      WHERE tenant_id = ${tenantId}
        AND deal_id = ${dealId}::uuid
        AND user_id = ${userId}
        AND status = 'active'
        AND expires_at > NOW()
    `;

    if (userDealSessionCount[0].count >= MAX_USER_DEAL_SESSIONS) {
      this.logger.warn(`Rate limit exceeded: user ${userId} already has active session for deal ${dealId}`);
      return {
        allowed: false,
        reason: 'Active session already exists for this deal. End the current session first.',
        retryAfterSeconds: 30,
      };
    }

    return { allowed: true };
  }

  /**
   * Cleanup expired sessions and trigger sync envelope generation
   * Runs every minute via cron
   * Requirements: 11.1, 11.2, 11.3
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupExpiredSessions(): Promise<number> {
    this.logger.debug('Running expired session cleanup');

    // Find expired sessions that need sync
    const expiredSessions = await this.prisma.$queryRaw<{
      id: string;
      tenant_id: string;
      deal_id: string;
      user_id: string;
    }[]>`
      UPDATE instant_rag_sessions
      SET status = 'expired', last_activity_at = NOW()
      WHERE status = 'active'
        AND expires_at < NOW()
      RETURNING id, tenant_id, deal_id, user_id
    `;

    if (expiredSessions.length > 0) {
      this.logger.log(`Cleaned up ${expiredSessions.length} expired sessions`);

      // Emit events for each expired session to trigger sync
      for (const session of expiredSessions) {
        const event: SessionExpiredEvent = {
          sessionId: session.id,
          tenantId: session.tenant_id,
          dealId: session.deal_id,
          userId: session.user_id,
        };
        
        this.eventEmitter.emit('instant-rag.session.expired', event);
        this.logger.log(`Emitted session.expired event for ${session.id}`);
        
        // Clean up warning tracking
        this.warnedSessions.delete(session.id);
      }
    }

    return expiredSessions.length;
  }

  /**
   * Check for sessions expiring soon and emit timeout warnings
   * Runs every 30 seconds via cron
   * Requirements: 11.5
   */
  @Cron('*/30 * * * * *') // Every 30 seconds
  async checkSessionTimeoutWarnings(): Promise<number> {
    const sessionsExpiringSoon = await this.getSessionsExpiringSoon();
    let warningsSent = 0;

    for (const session of sessionsExpiringSoon) {
      // Skip if we already warned this session
      if (this.warnedSessions.has(session.id)) {
        continue;
      }

      const secondsRemaining = Math.max(
        0,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
      );

      const event: SessionTimeoutWarningEvent = {
        sessionId: session.id,
        tenantId: session.tenantId,
        userId: session.userId,
        dealId: session.dealId,
        expiresAt: session.expiresAt,
        secondsRemaining,
      };

      this.eventEmitter.emit('instant-rag.session.timeout-warning', event);
      this.warnedSessions.add(session.id);
      warningsSent++;

      this.logger.log(
        `Sent timeout warning for session ${session.id} (${secondsRemaining}s remaining)`,
      );
    }

    if (warningsSent > 0) {
      this.logger.log(`Sent ${warningsSent} session timeout warnings`);
    }

    return warningsSent;
  }

  /**
   * Get sessions expiring soon (within 60 seconds)
   * Used for sending timeout warnings
   */
  async getSessionsExpiringSoon(tenantId?: string): Promise<SessionState[]> {
    const warningThreshold = new Date(Date.now() + 60 * 1000);

    let query = `
      SELECT 
        id, tenant_id as "tenantId", deal_id as "dealId", user_id as "userId",
        ticker, status, created_at as "createdAt", last_activity_at as "lastActivityAt",
        expires_at as "expiresAt", sonnet_calls as "sonnetCalls", opus_calls as "opusCalls",
        total_input_tokens as "totalInputTokens", total_output_tokens as "totalOutputTokens",
        files_total as "filesTotal", files_processed as "filesProcessed", files_failed as "filesFailed"
      FROM instant_rag_sessions
      WHERE status = 'active'
        AND expires_at > NOW()
        AND expires_at < $1
    `;

    const params: any[] = [warningThreshold];

    if (tenantId) {
      // Note: tenant_id is TEXT column, no UUID cast needed
      query += ` AND tenant_id = $2`;
      params.push(tenantId);
    }

    return this.prisma.$queryRawUnsafe<SessionState[]>(query, ...params);
  }

  /**
   * Increment model usage counters
   */
  async incrementModelUsage(
    sessionId: string,
    modelType: 'sonnet' | 'opus',
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    const column = modelType === 'sonnet' ? 'sonnet_calls' : 'opus_calls';

    await this.prisma.$executeRawUnsafe(`
      UPDATE instant_rag_sessions
      SET ${column} = ${column} + 1,
          total_input_tokens = total_input_tokens + $1,
          total_output_tokens = total_output_tokens + $2,
          last_activity_at = NOW()
      WHERE id = $3::uuid
    `, inputTokens, outputTokens, sessionId);
  }

  /**
   * Increment file processing counters
   */
  async incrementFileCounters(
    sessionId: string,
    processed: number = 0,
    failed: number = 0,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE instant_rag_sessions
      SET files_processed = files_processed + ${processed},
          files_failed = files_failed + ${failed},
          last_activity_at = NOW()
      WHERE id = ${sessionId}::uuid
    `;
  }

  /**
   * Set total file count for session
   */
  async setFilesTotal(sessionId: string, total: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE instant_rag_sessions
      SET files_total = ${total}, last_activity_at = NOW()
      WHERE id = ${sessionId}::uuid
    `;
  }
}
