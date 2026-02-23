import { Logger } from '@nestjs/common';
import { BedrockService } from '../bedrock.service';
import { MetricRegistryService } from '../metric-resolution/metric-registry.service';
import { ConceptRegistryService } from '../metric-resolution/concept-registry.service';

/**
 * Result of LLM classification — raw entity extraction and intent flags.
 * The LLM extracts entities as the user wrote them; metric resolution
 * is always delegated to MetricRegistryService downstream.
 *
 * Requirements: 1.5, 1.6, 5.1, 9.3
 */
export interface LlmClassificationResult {
  tickers: string[];
  rawMetricPhrases: string[];
  queryType: 'structured' | 'semantic' | 'hybrid';
  period?: string;
  periodStart?: string;
  periodEnd?: string;
  documentTypes?: string[];
  sectionTypes?: string[];
  subsectionName?: string;
  needsNarrative: boolean;
  needsComparison: boolean;
  needsComputation: boolean;
  needsTrend: boolean;
  needsPeerComparison: boolean;
  needsClarification: boolean;
  ambiguityReason?: string;
  conceptMatch?: string;
  confidence: number;
  /** Advisory retrieval paths: which data sources to query */
  retrievalPaths?: string[];
  /** LLM-suggested chart type for visualization */
  suggestedChart?: string | null;
}

/** Required fields that must be present in a valid LLM JSON response */
const REQUIRED_FIELDS: (keyof LlmClassificationResult)[] = [
  'tickers',
  'rawMetricPhrases',
  'queryType',
  'needsNarrative',
  'needsComparison',
  'needsComputation',
  'needsTrend',
  'needsPeerComparison',
  'needsClarification',
  'confidence',
];

const VALID_QUERY_TYPES = new Set(['structured', 'semantic', 'hybrid']);

const VALID_SECTION_TYPES = new Set([
  'item_1', 'item_1a', 'item_2', 'item_3', 'item_7', 'item_8',
  'item_11', 'item_1_10q', 'item_2_10q',
]);

const VALID_RETRIEVAL_PATHS = new Set(['structured', 'semantic']);
const VALID_CHART_TYPES = new Set([
  'line', 'bar', 'grouped_bar', 'stacked_bar', 'waterfall', 'pie', 'table',
]);

/**
 * LlmDetectionEngine — Layer 3 of the three-layer intent detection architecture.
 *
 * A plain class (not a NestJS service) instantiated by IntentDetectorService.
 * Constructs a system prompt with registry context, invokes Claude 3.5 Haiku
 * via BedrockService, and parses the structured JSON response.
 *
 * The LLM is a classifier only — it extracts entities and classifies intent.
 * Metric resolution is always delegated to MetricRegistryService.
 * Concept matching is always delegated to ConceptRegistryService.
 *
 * Requirements: 1.5, 1.6, 5.1, 5.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export class LlmDetectionEngine {
  private readonly logger = new Logger(LlmDetectionEngine.name);
  private cachedSystemPrompt: string | null = null;
  private promptVersion: number = 0;

  private static readonly MODEL_ID = 'us.anthropic.claude-3-5-haiku-20241022-v1:0';
  private static readonly MAX_TOKENS = 500;
  private static readonly TIMEOUT_MS = 3000;

  constructor(
    private readonly bedrock: BedrockService,
    private readonly metricRegistry: MetricRegistryService,
    private readonly conceptRegistry: ConceptRegistryService,
  ) {}

  /**
   * Classify a query using Claude 3.5 Haiku.
   * Returns structured classification result with extracted entities and intent flags.
   *
   * Enforces a 3-second timeout — if exceeded, throws to trigger fallback.
   *
   * Requirements: 1.5, 1.6, 9.5, 9.6
   */
  async classify(query: string, contextTicker?: string): Promise<LlmClassificationResult> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildUserPrompt(query, contextTicker);

    const llmPromise = this.bedrock.invokeClaude({
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      modelId: LlmDetectionEngine.MODEL_ID,
      max_tokens: LlmDetectionEngine.MAX_TOKENS,
    });

    // 3-second timeout via Promise.race
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('LLM classification timed out after 3 seconds')), LlmDetectionEngine.TIMEOUT_MS);
    });

    const response = await Promise.race([llmPromise, timeoutPromise]);
    return this.parseResponse(response, query);
  }

  /**
   * Invalidate the cached system prompt. Called when MetricRegistryService
   * or ConceptRegistryService rebuilds their indices.
   *
   * Requirements: 9.2
   */
  invalidatePromptCache(): void {
    this.cachedSystemPrompt = null;
    this.promptVersion++;
    this.logger.log(`Prompt cache invalidated (version ${this.promptVersion})`);
  }

  /** Current prompt version — useful for testing cache invalidation */
  getPromptVersion(): number {
    return this.promptVersion;
  }

  /**
   * Get the system prompt, building and caching it on first access.
   */
  getSystemPrompt(): string {
    if (this.cachedSystemPrompt) return this.cachedSystemPrompt;
    this.cachedSystemPrompt = this.buildSystemPrompt();
    return this.cachedSystemPrompt;
  }

  /**
   * Build the system prompt with registry context and few-shot examples.
   *
   * Includes:
   * - Canonical metric display names from MetricRegistryService
   * - Concept trigger phrases from ConceptRegistryService
   * - Valid values for each field
   * - Few-shot examples covering all query types
   *
   * Requirements: 5.6, 9.1, 9.4
   */
  private buildSystemPrompt(): string {
        const metricDisplayNames = this.getMetricDisplayNames();
        const conceptTriggers = this.getConceptTriggers();

        return `You are a financial query classifier for an equity research platform called FundLens.
  Given a user query, extract structured intent as JSON.

  ═══════════════════════════════════════════════════════════════
  SECTION 1: CORE EXTRACTION RULES
  ═══════════════════════════════════════════════════════════════

  TICKER EXTRACTION:
  - Extract ticker symbols (e.g., AAPL, MSFT) or company names → tickers
  - Map company names to tickers: "Apple" → "AAPL", "Microsoft" → "MSFT", "Amazon" → "AMZN", "Google"/"Alphabet" → "GOOGL", "Meta"/"Facebook" → "META", "Tesla" → "TSLA", "Nvidia" → "NVDA"
  - Do NOT extract SEC filing type codes as tickers. "10-K", "10-Q", "8-K" contain filing codes (K, Q), NOT ticker symbols.
  - Single-letter tickers: Only "V" (Visa) and "X" (US Steel) are valid. Reject K, Q, A, S, D, F as filing artifacts.
  - Subsidiary/segment → parent ticker mapping:
    - "AWS" / "Amazon Web Services" → "AMZN"
    - "Azure" / "Microsoft Cloud" → "MSFT"
    - "Google Cloud" / "YouTube" / "Waymo" → "GOOGL"
    - "Instagram" / "WhatsApp" / "Reality Labs" → "META"
    - "iCloud" / "App Store" / "Apple Services" → "AAPL"

  METRIC EXTRACTION:
  - Extract metric phrases AS THE USER WROTE THEM (do NOT canonicalize) → rawMetricPhrases
  - Examples: "revenue" stays "revenue", "gross margin" stays "gross margin", "debt-to-equity" stays "debt-to-equity"

  QUERY TYPE CLASSIFICATION:
  - "structured": Numeric/quantitative data requests (revenue, margins, ratios, financial metrics)
  - "semantic": Narrative/qualitative requests (risk factors, MD&A, strategy, management discussion)
  - "hybrid": Both quantitative AND qualitative (e.g., "How is Apple's profitability trending and what's driving it?")

  ═══════════════════════════════════════════════════════════════
  SECTION 2: RETRIEVAL PATH ROUTING
  ═══════════════════════════════════════════════════════════════

  Determine which retrieval paths to use:

  PATH A — STRUCTURED (database metrics):
  Use when query asks for specific financial metrics, ratios, or computed values.
  → retrievalPaths: ["structured"]
  Examples: "AAPL revenue FY2024", "Compare NVDA and MSFT gross margin", "Tesla debt-to-equity ratio"

  PATH B — SEMANTIC (Bedrock Knowledge Base / narrative chunks):
  Use when query asks about qualitative information from SEC filings.
  → retrievalPaths: ["semantic"]
  Examples: "What are AMZN's key risk factors?", "NVDA management discussion on AI demand", "Tesla's accounting policies"

  PATH C — HYBRID (both structured + semantic):
  Use when query needs both numbers AND narrative context.
  → retrievalPaths: ["structured", "semantic"]
  Examples: "How is Apple's profitability trending and what's driving it?", "Is Amazon's AWS growth decelerating relative to Azure?"

  ═══════════════════════════════════════════════════════════════
  SECTION 3: INTENT FLAGS
  ═══════════════════════════════════════════════════════════════

  - needsComparison: true when 2+ tickers are being compared
  - needsPeerComparison: true when "peers", "competitors", "vs", "versus", "compared to" with multiple tickers
  - needsTrend: true when "over time", "year over year", "trend", "historical", multi-period analysis
  - needsComputation: true when margins, ratios, growth rates, or derived metrics are needed
  - needsNarrative: true when qualitative/narrative content from filings is needed
  - needsClarification: true ONLY when query is genuinely vague or ambiguous

  CRITICAL RULES FOR needsClarification:
  - Comparative/relative analysis queries (e.g. "Is X's growth decelerating relative to Y?") → needsClarification: false
  - When multiple companies are mentioned in a comparative context → needsComparison: true, needsClarification: false
  - When a query asks about trends, growth, or multi-period data for multiple tickers → needsTrend: true AND needsComparison: true
  - Concept-match queries like "How levered is Apple?" → needsClarification: false (these are well-defined analytical questions)
  - Only set needsClarification: true for genuinely ambiguous queries like "Tell me about Tesla" (no specific ask)

  ═══════════════════════════════════════════════════════════════
  SECTION 4: PERIOD RESOLUTION
  ═══════════════════════════════════════════════════════════════

  VALID PERIOD FORMATS: FY2024, Q4-2024, latest, TTM

  PERIOD RULES:
  - "latest" or "most recent" → period: "latest"
  - "FY2024" or "fiscal year 2024" → period: "FY2024"
  - "Q3 2024" or "third quarter 2024" → period: "Q3-2024"
  - "last 3 years" → periodStart: "FY2022", periodEnd: "FY2024"
  - "last 5 years" → periodStart: "FY2020", periodEnd: "FY2024"
  - "over time" or "trend" without specific dates → periodStart: "FY2020", periodEnd: "FY2024"
  - "trailing twelve months" → period: "TTM"
  - If no period mentioned → period: "latest"

  ═══════════════════════════════════════════════════════════════
  SECTION 5: DOCUMENT & SECTION TYPES
  ═══════════════════════════════════════════════════════════════

  DOCUMENT TYPES: 10-K, 10-Q, 8-K, DEF 14A, earnings_call
  SECTION TYPES: item_1, item_1a, item_2, item_3, item_7, item_8, item_11, item_1_10q, item_2_10q

  SECTION MAPPING:
  - "risk factors" → sectionTypes: ["item_1a"], documentTypes: ["10-K"]
  - "business description" / "business overview" → sectionTypes: ["item_1"], documentTypes: ["10-K"]
  - "MD&A" / "management discussion" → sectionTypes: ["item_7"], documentTypes: ["10-K"]
  - "financial statements" / "notes to financials" → sectionTypes: ["item_8"], documentTypes: ["10-K"]
  - "properties" → sectionTypes: ["item_2"], documentTypes: ["10-K"]
  - "legal proceedings" → sectionTypes: ["item_3"], documentTypes: ["10-K"]
  - "executive compensation" / "proxy" → sectionTypes: ["item_11"], documentTypes: ["DEF 14A"]
  - "quarterly results" / "quarterly MD&A" → sectionTypes: ["item_2_10q"], documentTypes: ["10-Q"]

  ═══════════════════════════════════════════════════════════════
  SECTION 6: CHART VISUALIZATION SUGGESTIONS
  ═══════════════════════════════════════════════════════════════

  Based on the query intent, suggest an appropriate chart type:
  - Single ticker + trend over time → suggestedChart: "line"
  - Multiple tickers + same metric → suggestedChart: "grouped_bar"
  - Revenue/cost breakdown → suggestedChart: "stacked_bar" or "waterfall"
  - Market share / composition → suggestedChart: "pie"
  - Single data point comparison → suggestedChart: "bar"
  - Tabular data / many metrics → suggestedChart: "table"
  - Narrative-only queries → suggestedChart: null

  VALID CHART TYPES: "line", "bar", "grouped_bar", "stacked_bar", "waterfall", "pie", "table", null

  ═══════════════════════════════════════════════════════════════
  SECTION 7: KNOWN METRICS & CONCEPTS
  ═══════════════════════════════════════════════════════════════

  KNOWN METRICS (for reference, extract user's phrasing not these IDs):
  ${metricDisplayNames}

  KNOWN CONCEPTS (analytical question triggers → conceptMatch ID):
  ${conceptTriggers}

  NOTE: When matching concepts, use the concept ID exactly as listed above (e.g., "leverage", "profitability", "liquidity"). Do NOT add suffixes like "_profile".

  ═══════════════════════════════════════════════════════════════
  SECTION 8: CONFIDENCE SCORING
  ═══════════════════════════════════════════════════════════════

  CONFIDENCE RUBRIC:
  - 0.90-1.00: Clear, unambiguous query with explicit ticker + metric + period
  - 0.80-0.89: Clear query, minor inference needed (e.g., company name → ticker)
  - 0.70-0.79: Moderate inference (e.g., concept match, implied metrics)
  - 0.50-0.69: Significant ambiguity, partial extraction possible
  - Below 0.50: Very vague, needsClarification should be true

  ═══════════════════════════════════════════════════════════════
  SECTION 9: OUTPUT FORMAT
  ═══════════════════════════════════════════════════════════════

  Return ONLY valid JSON:
  {
    "tickers": ["AAPL"],
    "rawMetricPhrases": ["revenue", "gross margin"],
    "queryType": "structured",
    "period": "FY2024",
    "periodStart": null,
    "periodEnd": null,
    "documentTypes": [],
    "sectionTypes": [],
    "subsectionName": null,
    "needsNarrative": false,
    "needsComparison": false,
    "needsComputation": false,
    "needsTrend": false,
    "needsPeerComparison": false,
    "needsClarification": false,
    "ambiguityReason": null,
    "conceptMatch": null,
    "confidence": 0.95,
    "retrievalPaths": ["structured"],
    "suggestedChart": null
  }

  ═══════════════════════════════════════════════════════════════
  SECTION 10: EXAMPLES
  ═══════════════════════════════════════════════════════════════

  Query: "AAPL revenue FY2024"
  → {"tickers":["AAPL"],"rawMetricPhrases":["revenue"],"queryType":"structured","period":"FY2024","needsNarrative":false,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"confidence":0.95,"retrievalPaths":["structured"],"suggestedChart":"bar"}

  Query: "Compare NVDA and MSFT gross margin"
  → {"tickers":["NVDA","MSFT"],"rawMetricPhrases":["gross margin"],"queryType":"structured","period":"latest","needsNarrative":false,"needsComparison":true,"needsComputation":true,"needsTrend":false,"needsPeerComparison":true,"needsClarification":false,"confidence":0.9,"retrievalPaths":["structured"],"suggestedChart":"grouped_bar"}

  Query: "Is Amazon's AWS growth decelerating relative to Azure?"
  → {"tickers":["AMZN","MSFT"],"rawMetricPhrases":["revenue growth"],"queryType":"hybrid","needsNarrative":true,"needsComparison":true,"needsComputation":false,"needsTrend":true,"needsPeerComparison":true,"needsClarification":false,"confidence":0.85,"retrievalPaths":["structured","semantic"],"suggestedChart":"line"}

  Query: "Compare AAPL, MSFT, and GOOGL operating margins over the last 3 years"
  → {"tickers":["AAPL","MSFT","GOOGL"],"rawMetricPhrases":["operating margins"],"queryType":"structured","periodStart":"FY2022","periodEnd":"FY2024","needsNarrative":false,"needsComparison":true,"needsComputation":true,"needsTrend":true,"needsPeerComparison":true,"needsClarification":false,"confidence":0.9,"retrievalPaths":["structured"],"suggestedChart":"line"}

  Query: "How levered is Apple?"
  → {"tickers":["AAPL"],"rawMetricPhrases":[],"queryType":"hybrid","needsNarrative":true,"needsComparison":false,"needsComputation":true,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"conceptMatch":"leverage","confidence":0.9,"retrievalPaths":["structured","semantic"],"suggestedChart":"table"}

  Query: "What are AMZN's key risk factors from their latest 10-K?"
  → {"tickers":["AMZN"],"rawMetricPhrases":[],"queryType":"semantic","sectionTypes":["item_1a"],"documentTypes":["10-K"],"needsNarrative":true,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"confidence":0.9,"retrievalPaths":["semantic"],"suggestedChart":null}

  Query: "NVDA revenue trend over the last 5 years"
  → {"tickers":["NVDA"],"rawMetricPhrases":["revenue"],"queryType":"structured","periodStart":"FY2020","periodEnd":"FY2024","needsNarrative":false,"needsComparison":false,"needsComputation":false,"needsTrend":true,"needsPeerComparison":false,"needsClarification":false,"confidence":0.9,"retrievalPaths":["structured"],"suggestedChart":"line"}

  Query: "Tell me about Tesla"
  → {"tickers":["TSLA"],"rawMetricPhrases":[],"queryType":"semantic","needsNarrative":true,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":true,"ambiguityReason":"Query mentions a company but does not specify what information is needed","confidence":0.5,"retrievalPaths":["semantic"],"suggestedChart":null}

  Query: "What's Apple's profitability profile?"
  → {"tickers":["AAPL"],"rawMetricPhrases":[],"queryType":"hybrid","needsNarrative":true,"needsComparison":false,"needsComputation":true,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"conceptMatch":"profitability","confidence":0.9,"retrievalPaths":["structured","semantic"],"suggestedChart":"table"}

  Query: "AMZN vs GOOGL revenue and operating income last 3 years"
  → {"tickers":["AMZN","GOOGL"],"rawMetricPhrases":["revenue","operating income"],"queryType":"structured","periodStart":"FY2022","periodEnd":"FY2024","needsNarrative":false,"needsComparison":true,"needsComputation":false,"needsTrend":true,"needsPeerComparison":true,"needsClarification":false,"confidence":0.9,"retrievalPaths":["structured"],"suggestedChart":"grouped_bar"}

  Query: "How does Meta's capital allocation compare to its peers?"
  → {"tickers":["META"],"rawMetricPhrases":["capital allocation"],"queryType":"hybrid","needsNarrative":true,"needsComparison":true,"needsComputation":true,"needsTrend":false,"needsPeerComparison":true,"needsClarification":false,"conceptMatch":"capital_allocation","confidence":0.85,"retrievalPaths":["structured","semantic"],"suggestedChart":"grouped_bar"}

  Query: "Show me NVDA's revenue breakdown by segment"
  → {"tickers":["NVDA"],"rawMetricPhrases":["revenue breakdown"],"queryType":"hybrid","needsNarrative":true,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"confidence":0.85,"retrievalPaths":["structured","semantic"],"suggestedChart":"stacked_bar"}

  Query: "What did Apple's CEO say about AI in the latest earnings call?"
  → {"tickers":["AAPL"],"rawMetricPhrases":[],"queryType":"semantic","documentTypes":["earnings_call"],"needsNarrative":true,"needsComparison":false,"needsComputation":false,"needsTrend":false,"needsPeerComparison":false,"needsClarification":false,"confidence":0.85,"retrievalPaths":["semantic"],"suggestedChart":null}

  Query: "MSFT free cash flow and capex trend"
  → {"tickers":["MSFT"],"rawMetricPhrases":["free cash flow","capex"],"queryType":"structured","periodStart":"FY2020","periodEnd":"FY2024","needsNarrative":false,"needsComparison":false,"needsComputation":false,"needsTrend":true,"needsPeerComparison":false,"needsClarification":false,"confidence":0.9,"retrievalPaths":["structured"],"suggestedChart":"line"}

  Query: "How liquid is Tesla compared to Ford?"
  → {"tickers":["TSLA","F"],"rawMetricPhrases":[],"queryType":"hybrid","needsNarrative":true,"needsComparison":true,"needsComputation":true,"needsTrend":false,"needsPeerComparison":true,"needsClarification":false,"conceptMatch":"liquidity","confidence":0.85,"retrievalPaths":["structured","semantic"],"suggestedChart":"grouped_bar"}

  Query: "What's driving AMZN's margin expansion?"
  → {"tickers":["AMZN"],"rawMetricPhrases":["margin"],"queryType":"hybrid","needsNarrative":true,"needsComparison":false,"needsComputation":true,"needsTrend":true,"needsPeerComparison":false,"needsClarification":false,"confidence":0.85,"retrievalPaths":["structured","semantic"],"suggestedChart":"line"}`;
      }

  /**
   * Build the user prompt with the query and optional context ticker.
   */
  private buildUserPrompt(query: string, contextTicker?: string): string {
    let prompt = `Query: "${query}"`;
    if (contextTicker) {
      prompt += `\nContext: The user is currently viewing ${contextTicker.toUpperCase()}`;
    }
    prompt += '\n\nClassify this query. Return ONLY the JSON object, no other text.';
    return prompt;
  }

  /**
   * Get metric display names from MetricRegistryService for the system prompt.
   * Returns a comma-separated list of display names.
   */
  private getMetricDisplayNames(): string {
    try {
      const allMetrics = this.metricRegistry.getAllMetrics();
      const displayNames: string[] = [];
      for (const [, def] of allMetrics) {
        if (def.display_name) {
          displayNames.push(def.display_name);
        }
      }
      // Limit to keep prompt concise and reduce token cost
      return displayNames.slice(0, 200).join(', ');
    } catch (error) {
      this.logger.warn(`Failed to load metric display names: ${error.message}`);
      return '(metric list unavailable)';
    }
  }

  /**
   * Get concept trigger phrases from ConceptRegistryService for the system prompt.
   * Returns a formatted list of concept triggers.
   */
  private getConceptTriggers(): string {
    try {
      const conceptIds = this.conceptRegistry.getAllConceptIds();
      const triggers: string[] = [];
      for (const id of conceptIds) {
        const concept = this.conceptRegistry.getConceptById(id);
        if (concept) {
          triggers.push(`${concept.display_name}: ${concept.triggers.join(', ')}`);
        }
      }
      return triggers.join('\n') || '(no concepts loaded)';
    } catch (error) {
      this.logger.warn(`Failed to load concept triggers: ${error.message}`);
      return '(concept list unavailable)';
    }
  }

  /**
   * Parse the LLM JSON response into a validated LlmClassificationResult.
   *
   * Handles:
   * - Valid JSON → validate schema → return result
   * - JSON embedded in markdown code blocks → extract and parse
   * - Malformed JSON → attempt partial extraction → throw if unrecoverable
   *
   * Requirements: 9.3
   */
  parseResponse(response: string, originalQuery: string): LlmClassificationResult {
    const trimmed = response.trim();

    // Try to extract JSON from the response (may be wrapped in markdown code blocks)
    const jsonStr = this.extractJson(trimmed);

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Attempt partial extraction from malformed response
      const partial = this.attemptPartialExtraction(trimmed, originalQuery);
      if (partial) return partial;
      throw new Error(`Failed to parse LLM response as JSON: ${trimmed.substring(0, 200)}`);
    }

    return this.validateAndNormalize(parsed, originalQuery);
  }

  /**
   * Extract JSON from a response that may be wrapped in markdown code blocks
   * or contain extra text before/after the JSON object.
   */
  private extractJson(response: string): string {
    // Try markdown code block extraction: ```json ... ``` or ``` ... ```
    const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    // Try to find a JSON object in the response
    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      return response.substring(jsonStart, jsonEnd + 1);
    }

    return response;
  }

  /**
   * Validate parsed JSON against the expected schema and normalize field values.
   * Ensures all required fields are present and have correct types.
   */
  private validateAndNormalize(parsed: any, originalQuery: string): LlmClassificationResult {
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('LLM response is not a JSON object');
      }

      // Validate and normalize each field
      const result: LlmClassificationResult = {
        tickers: this.validateStringArray(parsed.tickers, 'tickers'),
        rawMetricPhrases: this.validateStringArray(parsed.rawMetricPhrases, 'rawMetricPhrases'),
        queryType: this.validateQueryType(parsed.queryType),
        needsNarrative: this.validateBoolean(parsed.needsNarrative, 'needsNarrative'),
        needsComparison: this.validateBoolean(parsed.needsComparison, 'needsComparison'),
        needsComputation: this.validateBoolean(parsed.needsComputation, 'needsComputation'),
        needsTrend: this.validateBoolean(parsed.needsTrend, 'needsTrend'),
        needsPeerComparison: this.validateBoolean(parsed.needsPeerComparison, 'needsPeerComparison'),
        needsClarification: this.validateBoolean(parsed.needsClarification, 'needsClarification'),
        confidence: this.validateConfidence(parsed.confidence),
      };

      // Optional fields
      if (parsed.period != null && typeof parsed.period === 'string') {
        result.period = parsed.period;
      }
      if (parsed.periodStart != null && typeof parsed.periodStart === 'string') {
        result.periodStart = parsed.periodStart;
      }
      if (parsed.periodEnd != null && typeof parsed.periodEnd === 'string') {
        result.periodEnd = parsed.periodEnd;
      }
      if (Array.isArray(parsed.documentTypes)) {
        result.documentTypes = parsed.documentTypes.filter((d: any) => typeof d === 'string');
      }
      if (Array.isArray(parsed.sectionTypes)) {
        result.sectionTypes = parsed.sectionTypes.filter(
          (s: any) => typeof s === 'string' && VALID_SECTION_TYPES.has(s),
        );
      }
      if (parsed.subsectionName != null && typeof parsed.subsectionName === 'string') {
        result.subsectionName = parsed.subsectionName;
      }
      if (parsed.ambiguityReason != null && typeof parsed.ambiguityReason === 'string') {
        result.ambiguityReason = parsed.ambiguityReason;
      }
      if (parsed.conceptMatch != null && typeof parsed.conceptMatch === 'string') {
        // Normalize concept IDs: strip _profile suffix if LLM adds it
        result.conceptMatch = parsed.conceptMatch.replace(/_profile$/, '');
      }

      // New field: retrievalPaths (advisory)
      if (Array.isArray(parsed.retrievalPaths)) {
        result.retrievalPaths = parsed.retrievalPaths.filter(
          (p: any) => typeof p === 'string' && VALID_RETRIEVAL_PATHS.has(p),
        );
      }

      // New field: suggestedChart
      if (parsed.suggestedChart === null || parsed.suggestedChart === undefined) {
        result.suggestedChart = null;
      } else if (typeof parsed.suggestedChart === 'string' && VALID_CHART_TYPES.has(parsed.suggestedChart)) {
        result.suggestedChart = parsed.suggestedChart;
      } else {
        result.suggestedChart = null;
      }

      // Normalize tickers to uppercase
      result.tickers = result.tickers.map((t) => t.toUpperCase());

      // Auto-correct: multiple tickers should always imply comparison
      if (result.tickers.length > 1 && !result.needsComparison) {
        this.logger.warn(`Auto-correcting needsComparison to true (${result.tickers.length} tickers detected)`);
        result.needsComparison = true;
      }

      // Auto-correct: comparative queries with multiple tickers should not need clarification
      if (result.tickers.length > 1 && result.needsComparison && result.needsClarification) {
        this.logger.warn(`Auto-correcting needsClarification to false (comparative query with ${result.tickers.length} tickers)`);
        result.needsClarification = false;
        result.ambiguityReason = undefined;
      }

      // Auto-correct: if we have a ticker AND (metrics OR narrative intent) with reasonable confidence,
      // don't trigger clarification — the query is actionable
      if (result.needsClarification && result.tickers.length >= 1 && result.confidence >= 0.5 &&
          (result.rawMetricPhrases.length > 0 || result.needsNarrative || result.conceptMatch)) {
        this.logger.warn(`Auto-correcting needsClarification to false (actionable query: ticker=${result.tickers[0]}, metrics=${result.rawMetricPhrases.length}, narrative=${result.needsNarrative}, confidence=${result.confidence})`);
        result.needsClarification = false;
        result.ambiguityReason = undefined;
      }

      return result;
    }

  /**
   * Attempt to extract partial data from a malformed LLM response.
   * Tries to find individual field values using regex patterns.
   * Returns null if extraction fails completely.
   */
  private attemptPartialExtraction(
    response: string,
    originalQuery: string,
  ): LlmClassificationResult | null {
    try {
      // Try to extract tickers
      const tickerMatch = response.match(/"tickers"\s*:\s*\[([^\]]*)\]/);
      const tickers = tickerMatch
        ? tickerMatch[1]
            .split(',')
            .map((t) => t.trim().replace(/"/g, '').toUpperCase())
            .filter((t) => t.length > 0 && t.length <= 5)
        : [];

      // Try to extract queryType
      const queryTypeMatch = response.match(/"queryType"\s*:\s*"(structured|semantic|hybrid)"/);
      const queryType = queryTypeMatch
        ? (queryTypeMatch[1] as 'structured' | 'semantic' | 'hybrid')
        : 'semantic';

      // Try to extract confidence
      const confidenceMatch = response.match(/"confidence"\s*:\s*([\d.]+)/);
      const confidence = confidenceMatch
        ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1])))
        : 0.5;

      return {
        tickers,
        rawMetricPhrases: [],
        queryType,
        needsNarrative: queryType === 'semantic' || queryType === 'hybrid',
        needsComparison: tickers.length > 1,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        needsClarification: true,
        ambiguityReason: 'LLM response was malformed; partial extraction used',
        confidence: Math.min(confidence, 0.6), // Cap confidence for partial extractions
      };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Validation helpers
  // ---------------------------------------------------------------------------

  private validateStringArray(value: any, fieldName: string): string[] {
      if (!Array.isArray(value)) {
        throw new Error(`Field "${fieldName}" must be an array, got ${typeof value}`);
      }
      const strings = value.filter((item: any) => typeof item === 'string');

      // For tickers field: filter out single-letter codes that are SEC filing type artifacts
      // e.g. "K" from "10-K", "Q" from "10-Q" — unless they are known real tickers
      if (fieldName === 'tickers') {
        const FILING_TYPE_ARTIFACTS = new Set(['K', 'Q', 'X', 'A', 'S', 'D', 'F']);
        const KNOWN_SINGLE_LETTER_TICKERS = new Set(['V', 'X']); // Visa, US Steel
        return strings.filter((t: string) => {
          const upper = t.toUpperCase().trim();
          if (upper.length === 1 && FILING_TYPE_ARTIFACTS.has(upper) && !KNOWN_SINGLE_LETTER_TICKERS.has(upper)) {
            this.logger.warn(`Filtered out single-letter ticker "${upper}" (likely filing type artifact)`);
            return false;
          }
          return true;
        });
      }

      return strings;
    }

  private validateQueryType(value: any): 'structured' | 'semantic' | 'hybrid' {
    if (typeof value !== 'string' || !VALID_QUERY_TYPES.has(value)) {
      throw new Error(
        `Field "queryType" must be one of ${[...VALID_QUERY_TYPES].join(', ')}, got "${value}"`,
      );
    }
    return value as 'structured' | 'semantic' | 'hybrid';
  }

  private validateBoolean(value: any, fieldName: string): boolean {
    if (typeof value === 'boolean') return value;
    // Be lenient: accept truthy/falsy values
    if (value === 'true' || value === 1) return true;
    if (value === 'false' || value === 0 || value === null || value === undefined) return false;
    throw new Error(`Field "${fieldName}" must be a boolean, got ${typeof value}: ${value}`);
  }

  private validateConfidence(value: any): number {
    if (typeof value !== 'number' || isNaN(value)) {
      const parsed = parseFloat(value);
      if (isNaN(parsed)) {
        throw new Error(`Field "confidence" must be a number, got ${typeof value}: ${value}`);
      }
      return Math.min(1, Math.max(0, parsed));
    }
    return Math.min(1, Math.max(0, value));
  }
}
