/**
 * QUL Output Validator
 * Spec: FundLens_QUL_Specification_v1.md, Appendix C.2
 *
 * Validates Haiku JSON output against QueryUnderstanding schema.
 * Computes derived fields deterministically (primaryEntity, useWorkspaceContext,
 * suggestedRetrievalPaths, suggestedChart, needsPeerComparison) so Haiku
 * only needs to get ~6 required fields right.
 */
import { Logger } from '@nestjs/common';
import {
  QueryUnderstanding,
  QueryIntent,
  ResolvedEntity,
  TemporalScope,
  RetrievalPath,
  ChartType,
  HaikuRawOutput,
  WorkspaceContext,
} from './types/query-understanding.types';

const VALID_INTENTS: QueryIntent[] = [
  'METRIC_LOOKUP', 'METRIC_TREND', 'METRIC_COMPARISON', 'NARRATIVE_SEARCH',
  'HYBRID_ANALYSIS', 'SEGMENT_ANALYSIS', 'PEER_SCREENING', 'CROSS_TRANSCRIPT',
  'DEAL_ANALYSIS', 'DEAL_COMPARISON', 'MANAGEMENT_ASSESSMENT', 'RED_FLAG_DETECTION',
  'PROVOCATION', 'IC_MEMO_GENERATION', 'DOCUMENT_INTAKE', 'UPLOADED_DOC_QUERY',
  'CLARIFICATION_NEEDED', 'INVALID',
];

const VALID_DOMAINS = ['public_equity', 'private_equity', 'cross_domain', 'uploaded_doc'];

const logger = new Logger('QULValidator');

/**
 * Parse raw Haiku JSON string into a validated QueryUnderstanding object.
 * Computes derived fields deterministically.
 */
export function validateAndEnrich(
  raw: HaikuRawOutput,
  rawQuery: string,
  workspace: WorkspaceContext,
): QueryUnderstanding {
  // ── Validate required fields ───────────────────────────────────────
  const intent = validateIntent(raw.intent);
  const isValidQuery = typeof raw.isValidQuery === 'boolean' ? raw.isValidQuery : intent !== 'INVALID';
  const confidence = clamp(raw.confidence ?? 0.5, 0, 1);
  const domain = VALID_DOMAINS.includes(raw.domain as string)
    ? (raw.domain as QueryUnderstanding['domain'])
    : workspace.domain === 'private_equity' ? 'private_equity' : 'public_equity';

  // ── Validate entities ──────────────────────────────────────────────
  const entities = validateEntities(raw.entities || []);

  // ── Validate temporal scope ────────────────────────────────────────
  const temporalScope = validateTemporalScope(raw.temporalScope);

  // ── Compute derived fields (spec Appendix C.2) ─────────────────────
  const primaryEntity = derivePrimaryEntity(entities, workspace);
  const useWorkspaceContext = deriveUseWorkspaceContext(entities);
  const suggestedRetrievalPaths = deriveSuggestedPaths(raw.suggestedRetrievalPaths, intent, domain, entities);
  const suggestedChart = deriveSuggestedChart(raw.suggestedChart, intent);
  const needsPeerComparison = raw.needsPeerComparison ??
    ['METRIC_COMPARISON', 'DEAL_COMPARISON', 'PEER_SCREENING'].includes(intent);

  const normalizedQuery = raw.normalizedQuery || rawQuery;
  const complexity = (['simple', 'multi_part', 'comparative', 'screening'].includes(raw.complexity as string)
    ? raw.complexity as QueryUnderstanding['complexity']
    : entities.length > 1 ? 'comparative' : 'simple');

  return {
    entities,
    primaryEntity,
    useWorkspaceContext,
    intent,
    domain,
    complexity,
    isValidQuery,
    queryQualityScore: clamp(raw.queryQualityScore ?? (isValidQuery ? 0.8 : 0.1), 0, 1),
    rejectionReason: raw.rejectionReason,
    temporalScope,
    subQueries: raw.subQueries,
    unifyingInstruction: raw.unifyingInstruction,
    suggestedRetrievalPaths,
    suggestedChart,
    needsPeerComparison,
    peerContext: raw.peerContext,
    resolvedBy: 'tier1_haiku',
    confidence,
    rawQuery,
    normalizedQuery,
  };
}

/**
 * Parse raw JSON string from Haiku. Handles markdown fences, trailing commas, etc.
 */
export function parseHaikuJSON(text: string): HaikuRawOutput | null {
  try {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    // Remove trailing commas before } or ]
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  } catch (e) {
    logger.warn(`Failed to parse Haiku JSON: ${e.message}`);
    return null;
  }
}

// ── Helper functions ─────────────────────────────────────────────────

function validateIntent(raw: any): QueryIntent {
  if (typeof raw === 'string' && VALID_INTENTS.includes(raw as QueryIntent)) {
    return raw as QueryIntent;
  }
  return 'HYBRID_ANALYSIS'; // Safe default
}

function validateEntities(raw: any[]): ResolvedEntity[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && typeof e.name === 'string')
    .map(e => ({
      name: e.name,
      ticker: typeof e.ticker === 'string' ? e.ticker.toUpperCase() : undefined,
      entityType: e.entityType || 'public_company',
      source: e.source || 'explicit',
      parentTicker: e.parentTicker,
      documentId: e.documentId,
    }));
}

function validateTemporalScope(raw: any): TemporalScope {
  if (!raw || typeof raw !== 'object') {
    return { type: 'latest' };
  }
  const validTypes = ['latest', 'specific_period', 'range', 'trailing', 'all_available'];
  return {
    type: validTypes.includes(raw.type) ? raw.type : 'latest',
    periods: Array.isArray(raw.periods) ? raw.periods : undefined,
    rangeStart: raw.rangeStart,
    rangeEnd: raw.rangeEnd,
    fiscalYearEndMonth: raw.fiscalYearEndMonth,
  };
}

function derivePrimaryEntity(
  entities: ResolvedEntity[],
  workspace: WorkspaceContext,
): ResolvedEntity | undefined {
  if (entities.length > 0) {
    // If the only entity came from uploaded_document source but workspace has a ticker,
    // and the entity ticker differs from workspace ticker, prefer workspace.
    // This prevents uploaded doc tickers from hijacking unscoped queries.
    const first = entities[0];
    if (
      entities.length === 1 &&
      first.source === 'uploaded_document' &&
      workspace.ticker &&
      first.ticker &&
      first.ticker.toUpperCase() !== workspace.ticker.toUpperCase()
    ) {
      logger.warn(
        `⚠️ QUL entity from uploaded_document (${first.ticker}) differs from workspace (${workspace.ticker}). ` +
        `Keeping Haiku's choice but flagging for review.`,
      );
    }
    return first;
  }
  if (workspace.ticker) {
    return {
      name: workspace.companyName || workspace.ticker,
      ticker: workspace.ticker,
      entityType: 'public_company',
      source: 'workspace_context',
    };
  }
  return undefined;
}

function deriveUseWorkspaceContext(entities: ResolvedEntity[]): boolean {
  if (entities.length === 0) return true;
  return entities[0].source === 'workspace_context';
}

function deriveSuggestedPaths(
  rawPaths: string[] | undefined,
  intent: QueryIntent,
  domain: string,
  entities: ResolvedEntity[],
): RetrievalPath[] {
  // If Haiku provided valid paths, use them
  if (rawPaths && Array.isArray(rawPaths) && rawPaths.length > 0) {
    const validPaths: RetrievalPath[] = [
      'structured_db', 'semantic_kb', 'uploaded_doc_rag',
      'earnings_transcript', 'peer_comparison', 'formula_engine', 'deal_library',
    ];
    const filtered = rawPaths.filter(p => validPaths.includes(p as RetrievalPath)) as RetrievalPath[];
    if (filtered.length > 0) return filtered;
  }

  // Deterministic derivation from intent + domain + entity type
  const hasUploadedEntity = entities.some(e => e.entityType === 'uploaded_entity');
  const hasPublicEntity = entities.some(e => e.entityType === 'public_company');

  // Cross-domain: both uploaded entities and public companies
  if (domain === 'cross_domain' || (hasUploadedEntity && hasPublicEntity)) {
    return ['uploaded_doc_rag', 'structured_db'];
  }

  if (hasUploadedEntity || domain === 'private_equity') {
    // PE-specific intent routing
    switch (intent) {
      case 'DEAL_ANALYSIS':
      case 'MANAGEMENT_ASSESSMENT':
      case 'RED_FLAG_DETECTION':
        return ['uploaded_doc_rag', 'deal_library'];
      case 'DEAL_COMPARISON':
        return ['uploaded_doc_rag', 'structured_db', 'peer_comparison'];
      case 'IC_MEMO_GENERATION':
        return ['uploaded_doc_rag', 'deal_library', 'structured_db'];
      default:
        return ['uploaded_doc_rag', 'structured_db'];
    }
  }

  switch (intent) {
    case 'METRIC_LOOKUP':
    case 'METRIC_TREND':
      return ['structured_db'];
    case 'METRIC_COMPARISON':
    case 'PEER_SCREENING':
      return ['structured_db', 'peer_comparison'];
    case 'NARRATIVE_SEARCH':
    case 'SEGMENT_ANALYSIS':
    case 'CROSS_TRANSCRIPT':
      return ['semantic_kb', 'earnings_transcript'];
    case 'HYBRID_ANALYSIS':
    case 'RED_FLAG_DETECTION':
    case 'PROVOCATION':
      return ['structured_db', 'semantic_kb'];
    case 'DEAL_ANALYSIS':
    case 'DEAL_COMPARISON':
    case 'MANAGEMENT_ASSESSMENT':
      return ['uploaded_doc_rag', 'deal_library'];
    case 'UPLOADED_DOC_QUERY':
    case 'DOCUMENT_INTAKE':
      return ['uploaded_doc_rag'];
    default:
      return ['structured_db', 'semantic_kb'];
  }
}

function deriveSuggestedChart(raw: any, intent: QueryIntent): ChartType | undefined {
  const validCharts: ChartType[] = ['line_chart', 'bar_chart', 'stacked_bar', 'pie_chart', 'metric_card', 'none'];
  if (typeof raw === 'string' && validCharts.includes(raw as ChartType)) {
    return raw as ChartType;
  }
  // Deterministic derivation
  switch (intent) {
    case 'METRIC_TREND': return 'line_chart';
    case 'METRIC_COMPARISON': return 'bar_chart';
    case 'METRIC_LOOKUP': return 'metric_card';
    case 'SEGMENT_ANALYSIS': return 'stacked_bar';
    default: return undefined;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
