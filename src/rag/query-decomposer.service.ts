import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from './bedrock.service';
import { QueryIntent } from './types/query-intent';

/**
 * Decomposed query result — either a fast-path single-intent pass-through
 * or an LLM-decomposed set of sub-queries with a unifying instruction.
 */
export interface DecomposedQuery {
  isDecomposed: boolean;
  subQueries: string[];
  unifyingInstruction?: string;
  originalQuery: string;
}

/**
 * Compound markers that, combined with mixed intent types,
 * indicate a multi-part query needing decomposition.
 * Req 12.2
 */
const COMPOUND_MARKERS = [
  'additionally',
  'as well as',
  'also',
  'and',
  'both',
  'plus',
];

/**
 * QueryDecomposerService — Sprint 3
 *
 * Splits multi-part analyst queries into independently answerable sub-queries.
 * Single-intent queries take a fast-path that avoids any LLM call (Req 12.1).
 * Multi-part queries are decomposed via Claude Haiku with a max of 3 sub-queries (Req 12.3).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 */
@Injectable()
export class QueryDecomposerService {
  private readonly logger = new Logger(QueryDecomposerService.name);

  constructor(private readonly bedrock: BedrockService) {}

  /**
   * Decompose a query into sub-queries if it has multiple information needs.
   * Fast-path: single-intent queries return immediately without LLM call.
   */
  async decompose(query: string, intent: QueryIntent): Promise<DecomposedQuery> {
    // Req 12.1: Single-intent fast-path — no LLM call
    if (this.isSingleIntent(query, intent)) {
      return {
        isDecomposed: false,
        subQueries: [],
        originalQuery: query,
      };
    }

    // Multi-part query — invoke LLM for decomposition
    try {
      const prompt = this.buildDecompositionPrompt(query, intent);
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        max_tokens: 600,
      });

      const result = this.parseDecomposition(response, query);

      // Req 22.4: Log sub-query count and unifying instruction
      if (result.isDecomposed) {
        this.logger.log(
          `Decomposed "${query.substring(0, 60)}…" into ${result.subQueries.length} sub-queries. ` +
            `Unifying: ${result.unifyingInstruction}`,
        );
      }

      return result;
    } catch (error) {
      // Error handling: LLM failure → treat as single-intent (graceful degradation)
      this.logger.error(`Query decomposition LLM call failed: ${error.message}`);
      return {
        isDecomposed: false,
        subQueries: [],
        originalQuery: query,
      };
    }
  }

  /**
   * Determine whether the query has a single information need.
   *
   * A query is single-intent when BOTH:
   *   1. No compound markers appear in the query text
   *   2. No mixed intent types (e.g., structured + semantic)
   *
   * If either condition is true → multi-intent → needs decomposition.
   * Req 12.1, 12.2
   */
  isSingleIntent(query: string, intent: QueryIntent): boolean {
    const lowerQuery = query.toLowerCase();

    // Check for compound markers (word-boundary aware)
    const hasCompoundMarker = COMPOUND_MARKERS.some((marker) => {
      // Use word-boundary matching to avoid false positives
      // e.g., "and" should match " and " but not "band" or "android"
      const regex = new RegExp(`\\b${marker}\\b`, 'i');
      return regex.test(lowerQuery);
    });

    // Check for mixed intent types: structured + semantic signals
    const hasMixedIntent = this.hasMixedIntentTypes(intent);

    // Single intent only when NEITHER condition is true
    if (hasCompoundMarker && hasMixedIntent) {
      return false;
    }

    return true;
  }

  /**
   * Detect mixed intent types — e.g., query needs both structured data
   * and narrative/semantic context, suggesting multiple information needs.
   */
  private hasMixedIntentTypes(intent: QueryIntent): boolean {
    const hasStructured =
      intent.type === 'structured' ||
      intent.type === 'hybrid' ||
      (intent.metrics && intent.metrics.length > 0);
    const hasSemantic =
      intent.type === 'semantic' ||
      intent.type === 'hybrid' ||
      intent.needsNarrative;

    // Mixed = both structured and semantic signals present
    return !!(hasStructured && hasSemantic);
  }

  /**
   * Build the LLM prompt for query decomposition.
   * Requests JSON response with sub-queries and a unifying instruction.
   * Req 12.3, 12.4, 12.5, 12.6
   */
  buildDecompositionPrompt(query: string, intent: QueryIntent): string {
    const tickers = Array.isArray(intent.ticker)
      ? intent.ticker.join(', ')
      : intent.ticker || 'unknown';
    const period = intent.period || 'not specified';

    return `You are a financial analyst query planner. Decompose the following multi-part query into independently answerable sub-queries.

ORIGINAL QUERY: "${query}"
DETECTED TICKERS: ${tickers}
PERIOD CONTEXT: ${period}

RULES:
1. Produce a MAXIMUM of 3 sub-queries. Each must be independently answerable.
2. PRESERVE company names/tickers and time periods from the original query in EVERY sub-query.
3. ORDER sub-queries by dependency: quantitative/data questions FIRST, then qualitative/narrative questions.
4. Provide a unifyingInstruction that describes how to combine the sub-query answers into a single coherent response.

Respond ONLY with valid JSON in this exact format:
{
  "subQueries": ["sub-query 1", "sub-query 2"],
  "unifyingInstruction": "Combine the quantitative data from sub-query 1 with the qualitative analysis from sub-query 2 to provide a complete picture."
}`;
  }

  /**
   * Parse the LLM JSON response into a DecomposedQuery.
   * Enforces max 3 sub-queries and validates unifyingInstruction.
   * On parse failure → graceful degradation to single-intent.
   * Req 12.3, 12.6
   */
  parseDecomposition(response: string, query: string): DecomposedQuery {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonStr = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      const parsed = JSON.parse(jsonStr);

      if (
        !parsed.subQueries ||
        !Array.isArray(parsed.subQueries) ||
        parsed.subQueries.length === 0
      ) {
        return { isDecomposed: false, subQueries: [], originalQuery: query };
      }

      // Req 12.3: Enforce max 3 sub-queries
      let subQueries: string[] = parsed.subQueries
        .filter((sq: unknown) => typeof sq === 'string' && sq.trim().length > 0)
        .map((sq: string) => sq.trim());

      if (subQueries.length > 3) {
        this.logger.warn(
          `Decomposition returned ${subQueries.length} sub-queries; truncating to 3`,
        );
        subQueries = subQueries.slice(0, 3);
      }

      if (subQueries.length === 0) {
        return { isDecomposed: false, subQueries: [], originalQuery: query };
      }

      // Req 12.6: Validate unifyingInstruction is non-empty
      const unifyingInstruction =
        typeof parsed.unifyingInstruction === 'string' &&
        parsed.unifyingInstruction.trim().length > 0
          ? parsed.unifyingInstruction.trim()
          : 'Combine the sub-query answers into a unified analysis addressing all aspects of the original question.';

      return {
        isDecomposed: true,
        subQueries,
        unifyingInstruction,
        originalQuery: query,
      };
    } catch (error) {
      // Graceful degradation: invalid JSON → treat as single-intent
      this.logger.error(`Failed to parse decomposition response: ${error.message}`);
      return { isDecomposed: false, subQueries: [], originalQuery: query };
    }
  }
}
