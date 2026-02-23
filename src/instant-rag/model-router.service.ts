/**
 * Model Router Service for Instant RAG
 *
 * Routes queries to Claude Sonnet (standard) or Opus (complex cross-document analysis)
 * based on trigger keyword detection, with a per-session Opus budget cap.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { Injectable, Logger } from '@nestjs/common';
import { SessionManagerService } from './session-manager.service';

/** Maximum Opus calls allowed per session */
export const MAX_OPUS_CALLS_PER_SESSION = 5;

/** Trigger keywords that route a query to Opus */
export const OPUS_TRIGGER_KEYWORDS: string[] = [
  'cross-reference',
  'compare',
  'contradict',
  'provocation',
  'why would',
  "doesn't match",
  'inconsistent',
  "what's missing",
  "devil's advocate",
];

export interface ModelSelection {
  modelId: string;
  modelType: 'sonnet' | 'opus';
  /** True if the query matched Opus triggers but was downgraded due to budget */
  fallbackFromOpus: boolean;
  /** The trigger keyword that matched, if any */
  matchedTrigger?: string;
  /** Remaining Opus calls for this session */
  opusCallsRemaining: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);

  private readonly SONNET_MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';
  private readonly OPUS_MODEL_ID = 'us.anthropic.claude-opus-4-5-20251101-v1:0';

  constructor(private readonly sessionManager: SessionManagerService) {}

  /**
   * Route a query to the appropriate model based on trigger keywords and budget.
   *
   * - Default: Sonnet
   * - If query contains a trigger keyword AND Opus budget remains: Opus
   * - If query contains a trigger keyword BUT budget exhausted: Sonnet (fallback)
   */
  async routeQuery(query: string, sessionId: string): Promise<ModelSelection> {
    const matchedTrigger = this.detectTriggerKeyword(query);
    const session = await this.sessionManager.getSession(sessionId);
    const currentOpusCalls = session?.opusCalls ?? 0;
    const opusCallsRemaining = Math.max(0, MAX_OPUS_CALLS_PER_SESSION - currentOpusCalls);

    // No trigger keyword → Sonnet
    if (!matchedTrigger) {
      this.logger.log(`[ModelRouter] session=${sessionId} → Sonnet (no trigger keyword)`);
      return {
        modelId: this.SONNET_MODEL_ID,
        modelType: 'sonnet',
        fallbackFromOpus: false,
        opusCallsRemaining,
      };
    }

    // Trigger keyword found but budget exhausted → Sonnet fallback
    if (opusCallsRemaining <= 0) {
      this.logger.warn(
        `[ModelRouter] session=${sessionId} → Sonnet (Opus budget exhausted, trigger="${matchedTrigger}")`,
      );
      return {
        modelId: this.SONNET_MODEL_ID,
        modelType: 'sonnet',
        fallbackFromOpus: true,
        matchedTrigger,
        opusCallsRemaining: 0,
      };
    }

    // Trigger keyword found and budget available → Opus
    this.logger.log(
      `[ModelRouter] session=${sessionId} → Opus (trigger="${matchedTrigger}", remaining=${opusCallsRemaining})`,
    );
    return {
      modelId: this.OPUS_MODEL_ID,
      modelType: 'opus',
      fallbackFromOpus: false,
      matchedTrigger,
      opusCallsRemaining: opusCallsRemaining - 1, // after this call
    };
  }

  /**
   * Check if the Opus budget is available for a session.
   */
  async checkOpusBudget(sessionId: string): Promise<boolean> {
    const session = await this.sessionManager.getSession(sessionId);
    const currentOpusCalls = session?.opusCalls ?? 0;
    return currentOpusCalls < MAX_OPUS_CALLS_PER_SESSION;
  }

  /**
   * Track token usage for a session after a query completes.
   */
  async trackUsage(
    sessionId: string,
    modelType: 'sonnet' | 'opus',
    tokens: TokenUsage,
  ): Promise<void> {
    await this.sessionManager.incrementModelUsage(
      sessionId,
      modelType,
      tokens.inputTokens,
      tokens.outputTokens,
    );
    this.logger.log(
      `[ModelRouter] Tracked usage session=${sessionId} model=${modelType} in=${tokens.inputTokens} out=${tokens.outputTokens}`,
    );
  }

  /**
   * Detect if a query contains any Opus trigger keyword (case-insensitive).
   * Returns the first matched keyword or null.
   */
  detectTriggerKeyword(query: string): string | null {
    const lowerQuery = query.toLowerCase();
    for (const keyword of OPUS_TRIGGER_KEYWORDS) {
      if (lowerQuery.includes(keyword)) {
        return keyword;
      }
    }
    return null;
  }
}
