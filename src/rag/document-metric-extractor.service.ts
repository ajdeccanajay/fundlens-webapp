/**
 * DocumentMetricExtractorService — QUL Phase 4 (Spec §8.4)
 *
 * Bridges uploaded PE/analyst documents into the deterministic metric engine.
 * When the QUL resolves an entity as `uploaded_entity` and a metric is requested,
 * this service extracts atomic metric values from document chunks via LLM,
 * then feeds them into FormulaResolutionService for computed metrics.
 *
 * Key design: uses the SAME MetricRegistry and FormulaResolutionService as
 * public equity. The only difference is the source of atomic inputs
 * (uploaded doc vs PostgreSQL).
 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BedrockService } from './bedrock.service';
import { DocumentIndexingService } from '../documents/document-indexing.service';
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { FormulaResolutionService } from './metric-resolution/formula-resolution.service';
import { MetricDefinition, ComputedMetricResult, ResolvedValue } from './metric-resolution/types';
import { TemporalScope } from './types/query-understanding.types';

// ── Extracted Metric Types ───────────────────────────────────────────

export interface ExtractedMetricValue {
  value: number | null;
  period: string;
  pageReference: string;
  confidence: number;
  notes: string;
}

export interface ExtractedMetricResult {
  source: 'uploaded_document';
  documentId: string;
  metrics: Record<string, ExtractedMetricValue>;
  currency: string;
  documentPeriod: string;
}

export interface DocumentComputedResult {
  canonical_id: string;
  display_name: string;
  value: number | null;
  formula: string;
  source: 'uploaded_document';
  documentId: string;
  resolved_inputs: Record<string, ResolvedValue>;
  explanation: string | null;
  caveats: string[];
}

// ── Session Cache ────────────────────────────────────────────────────

interface CacheEntry {
  result: ExtractedMetricResult;
  timestamp: number;
}

@Injectable()
export class DocumentMetricExtractorService {
  private readonly logger = new Logger(DocumentMetricExtractorService.name);
  private extractionPromptTemplate: string = '';

  // Session cache: documentId -> metricId -> extraction
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CACHE_SIZE = 100;

  constructor(
    private readonly bedrock: BedrockService,
    private readonly documentIndexing: DocumentIndexingService,
    private readonly metricRegistry: MetricRegistryService,
    private readonly formulaResolution: FormulaResolutionService,
  ) {
    this.loadPromptTemplate();
  }

  private loadPromptTemplate(): void {
    try {
      const promptPath = path.join(process.cwd(), 'src', 'prompts', 'metric-extraction-prompt.txt');
      this.extractionPromptTemplate = fs.readFileSync(promptPath, 'utf-8');
      this.logger.log('Loaded metric extraction prompt template');
    } catch (e) {
      this.logger.warn(`Could not load extraction prompt: ${e.message}`);
      this.extractionPromptTemplate = 'Extract the requested financial metrics from the document. Return JSON only.';
    }
  }

  /**
   * Extract specific metrics from an uploaded document.
   * Returns structured values that can be fed into FormulaResolutionService.
   *
   * Spec §8.4: "Extract exact values as stated in the document."
   */
  async extract(
    documentId: string,
    metricIds: string[],
    tenantId: string,
    temporalScope?: TemporalScope,
  ): Promise<ExtractedMetricResult> {
    // Check cache first
    const cacheKey = this.buildCacheKey(documentId, metricIds, temporalScope);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.log(`📦 Cache hit for doc ${documentId.slice(0, 8)}, metrics: [${metricIds.join(', ')}]`);
      return cached;
    }

    this.logger.log(`🔍 Extracting metrics [${metricIds.join(', ')}] from document ${documentId.slice(0, 8)}...`);

    // 1. Get relevant chunks from the uploaded document
    //    Prioritize financial statement tables, summary pages
    const chunks = await this.getFinancialChunks(documentId, tenantId, metricIds);

    if (chunks.length === 0) {
      this.logger.warn(`No chunks found for document ${documentId.slice(0, 8)}`);
      return this.buildEmptyResult(documentId, metricIds);
    }

    // 2. Build metric definitions from registry
    const metricDefs = this.getMetricDefinitions(metricIds);

    // 3. Build extraction prompt
    const systemPrompt = this.buildExtractionPrompt(metricDefs, temporalScope);
    const userMessage = this.formatChunksForExtraction(chunks);

    // 4. LLM extraction with Haiku (fast, cheap) for simple extractions
    try {
      const response = await this.bedrock.invokeClaude({
        prompt: userMessage,
        systemPrompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        max_tokens: 1024,
        temperature: 0.0,
      });

      const parsed = this.parseExtractionResponse(response, metricIds);
      const result: ExtractedMetricResult = {
        source: 'uploaded_document',
        documentId,
        metrics: parsed.metrics,
        currency: parsed.currency || 'USD',
        documentPeriod: parsed.documentPeriod || 'Unknown',
      };

      // Cache the result
      this.setCache(cacheKey, result);

      const extractedCount = Object.values(result.metrics).filter(m => m.value !== null).length;
      this.logger.log(`✅ Extracted ${extractedCount}/${metricIds.length} metrics from doc ${documentId.slice(0, 8)}`);

      return result;
    } catch (error) {
      this.logger.error(`Extraction failed for doc ${documentId.slice(0, 8)}: ${error.message}`);
      return this.buildEmptyResult(documentId, metricIds);
    }
  }

  /**
   * Extract metrics and compute a formula result using the existing formula engine.
   * This is the key bridge: uploaded doc atomic values → FormulaResolutionService.
   *
   * Spec §8.5: "The DocumentMetricExtractor uses the SAME MetricRegistry and
   * FormulaResolutionService as public equity metrics."
   */
  async extractAndCompute(
    documentId: string,
    metricId: string,
    tenantId: string,
    temporalScope?: TemporalScope,
  ): Promise<DocumentComputedResult> {
    // Resolve the metric through the registry
    const resolution = this.metricRegistry.resolve(metricId);

    if (resolution.confidence === 'unresolved') {
      return {
        canonical_id: metricId,
        display_name: metricId,
        value: null,
        formula: '',
        source: 'uploaded_document',
        documentId,
        resolved_inputs: {},
        explanation: `Metric "${metricId}" not found in registry`,
        caveats: [],
      };
    }

    const metricDef = this.metricRegistry.getMetricById(resolution.canonical_id);

    // For atomic metrics, extract directly
    if (!metricDef || metricDef.type === 'atomic') {
      const extracted = await this.extract(documentId, [resolution.canonical_id], tenantId, temporalScope);
      const value = extracted.metrics[resolution.canonical_id];

      return {
        canonical_id: resolution.canonical_id,
        display_name: resolution.display_name,
        value: value?.value ?? null,
        formula: '',
        source: 'uploaded_document',
        documentId,
        resolved_inputs: value?.value != null ? {
          [resolution.canonical_id]: {
            metric_id: resolution.canonical_id,
            display_name: resolution.display_name,
            value: value.value,
            source: `uploaded_document (${value.pageReference})`,
            period: value.period,
          },
        } : {},
        explanation: value?.value == null ? `Could not extract ${resolution.display_name} from document` : null,
        caveats: value?.notes ? [value.notes] : [],
      };
    }

    // For computed metrics, extract all dependencies then compute
    if (metricDef.type === 'computed' && metricDef.dependencies && metricDef.formula) {
      return this.extractAndComputeFormula(documentId, metricDef, tenantId, temporalScope);
    }

    return {
      canonical_id: resolution.canonical_id,
      display_name: resolution.display_name,
      value: null,
      formula: '',
      source: 'uploaded_document',
      documentId,
      resolved_inputs: {},
      explanation: `Metric "${resolution.display_name}" has no formula or dependencies`,
      caveats: [],
    };
  }

  /**
   * Extract dependency metrics from document, then compute the formula.
   * Uses the Python /calculate endpoint via FormulaResolutionService pattern.
   */
  private async extractAndComputeFormula(
    documentId: string,
    metricDef: MetricDefinition,
    tenantId: string,
    temporalScope?: TemporalScope,
  ): Promise<DocumentComputedResult> {
    // Collect all atomic dependencies (flatten the DAG)
    const atomicDeps = this.collectAtomicDependencies(metricDef.canonical_id);

    this.logger.log(`📐 Computing ${metricDef.display_name}: formula="${metricDef.formula}", deps=[${atomicDeps.join(', ')}]`);

    // Extract all atomic dependencies from the document in one LLM call
    const extracted = await this.extract(documentId, atomicDeps, tenantId, temporalScope);

    // Build resolved inputs map
    const resolvedInputs: Record<string, ResolvedValue> = {};
    const missingDeps: string[] = [];
    const caveats: string[] = [];

    for (const depId of metricDef.dependencies!) {
      const depDef = this.metricRegistry.getMetricById(depId);
      const depName = depDef?.display_name || depId;

      if (depDef?.type === 'computed' && depDef.dependencies) {
        // Nested computed dependency — compute from extracted atomics
        const nestedResult = await this.computeFromExtracted(depDef, extracted);
        resolvedInputs[depId] = {
          metric_id: depId,
          display_name: depName,
          value: nestedResult.value,
          source: 'uploaded_document (computed)',
          period: extracted.documentPeriod,
        };
        if (nestedResult.value === null) missingDeps.push(depId);
        if (nestedResult.notes) caveats.push(nestedResult.notes);
      } else {
        // Atomic dependency — use extracted value directly
        const extractedValue = extracted.metrics[depId];
        resolvedInputs[depId] = {
          metric_id: depId,
          display_name: depName,
          value: extractedValue?.value ?? null,
          source: extractedValue?.value != null
            ? `uploaded_document (${extractedValue.pageReference})`
            : 'not_found',
          period: extractedValue?.period || extracted.documentPeriod,
        };
        if (extractedValue?.value == null) missingDeps.push(depId);
        if (extractedValue?.notes) caveats.push(extractedValue.notes);
      }
    }

    // If any dependency is missing, can't compute
    if (missingDeps.length > 0) {
      const missingNames = missingDeps.map(id => {
        const def = this.metricRegistry.getMetricById(id);
        return def?.display_name || id;
      }).join(', ');

      return {
        canonical_id: metricDef.canonical_id,
        display_name: metricDef.display_name,
        value: null,
        formula: metricDef.formula!,
        source: 'uploaded_document',
        documentId,
        resolved_inputs: resolvedInputs,
        explanation: `Cannot compute ${metricDef.display_name}: missing ${missingNames} from document`,
        caveats,
      };
    }

    // Compute using the formula
    const numericInputs: Record<string, number> = {};
    for (const [depId, rv] of Object.entries(resolvedInputs)) {
      if (rv.value != null) numericInputs[depId] = rv.value;
    }

    try {
      // Use the formula resolution service's calculator for consistency
      const calcResult = await (this.formulaResolution as any).calculator?.evaluateFormula?.(
        metricDef.formula!,
        numericInputs,
        metricDef.output_format || 'ratio',
      );

      if (calcResult && calcResult.result != null) {
        return {
          canonical_id: metricDef.canonical_id,
          display_name: metricDef.display_name,
          value: calcResult.result,
          formula: metricDef.formula!,
          source: 'uploaded_document',
          documentId,
          resolved_inputs: resolvedInputs,
          explanation: null,
          caveats,
        };
      }
    } catch (e) {
      this.logger.warn(`Formula computation failed for ${metricDef.canonical_id}: ${e.message}`);
    }

    // Fallback: simple eval for basic formulas (a / b * 100, a - b, etc.)
    const simpleResult = this.simpleFormulaEval(metricDef.formula!, numericInputs);

    return {
      canonical_id: metricDef.canonical_id,
      display_name: metricDef.display_name,
      value: simpleResult,
      formula: metricDef.formula!,
      source: 'uploaded_document',
      documentId,
      resolved_inputs: resolvedInputs,
      explanation: simpleResult === null ? `Formula evaluation failed for ${metricDef.display_name}` : null,
      caveats,
    };
  }

  /**
   * Compute a nested computed metric from already-extracted values.
   */
  private computeFromExtracted(
    metricDef: MetricDefinition,
    extracted: ExtractedMetricResult,
  ): { value: number | null; notes: string | null } {
    if (!metricDef.formula || !metricDef.dependencies) {
      return { value: null, notes: 'No formula defined' };
    }

    const inputs: Record<string, number> = {};
    for (const depId of metricDef.dependencies) {
      const val = extracted.metrics[depId]?.value;
      if (val == null) return { value: null, notes: `Missing dependency: ${depId}` };
      inputs[depId] = val;
    }

    const result = this.simpleFormulaEval(metricDef.formula, inputs);
    return { value: result, notes: null };
  }

  /**
   * Simple formula evaluator for basic arithmetic.
   * Handles: a / b * 100, a - b, a + b, (a + b) / c
   * Falls back to null for complex formulas that need Python.
   */
  private simpleFormulaEval(formula: string, inputs: Record<string, number>): number | null {
    try {
      let expr = formula;
      // Replace variable names with values, longest first to avoid partial matches
      const sortedKeys = Object.keys(inputs).sort((a, b) => b.length - a.length);
      for (const key of sortedKeys) {
        expr = expr.replace(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), String(inputs[key]));
      }

      // Safety: only allow numbers, operators, parentheses, spaces
      if (!/^[\d\s+\-*/().]+$/.test(expr)) {
        return null;
      }

      // Check for division by zero
      if (/\/\s*0(?:\.\d+)?(?:\s|$|\))/.test(expr)) {
        return null;
      }

      const result = Function(`"use strict"; return (${expr})`)();
      if (typeof result !== 'number' || !isFinite(result)) return null;
      return Math.round(result * 10000) / 10000; // 4 decimal places
    } catch {
      return null;
    }
  }

  /**
   * Get financial-relevant chunks from an uploaded document.
   * Prioritizes chunks with financial data, tables, and metric mentions.
   */
  private async getFinancialChunks(
    documentId: string,
    tenantId: string,
    metricIds: string[],
  ): Promise<{ content: string; sectionType: string; pageNumber: number | null }[]> {
    // Build a search query that targets the requested metrics
    const metricNames = metricIds.map(id => {
      const def = this.metricRegistry.getMetricById(id);
      return def ? [def.display_name, ...def.synonyms.slice(0, 3)] : [id];
    }).flat();

    const searchQuery = `financial metrics: ${metricNames.join(', ')}`;

    // Use vector search to find relevant chunks
    const results = await this.documentIndexing.searchChunks(
      searchQuery,
      tenantId,
      '', // dealId not needed for tenant-scoped search
      { topK: 8, minScore: 0.3 },
    );

    // Filter to only chunks from this specific document
    const docChunks = results.filter(r => r.documentId === documentId);

    if (docChunks.length === 0) {
      // Fallback: get ALL chunks from this document (no vector filter)
      this.logger.log(`No vector matches for doc ${documentId.slice(0, 8)}, fetching all chunks`);
      return this.getAllDocumentChunks(documentId, tenantId);
    }

    return docChunks.map(c => ({
      content: c.content,
      sectionType: c.sectionType,
      pageNumber: c.pageNumber,
    }));
  }

  /**
   * Fallback: get all chunks from a document when vector search doesn't match.
   */
  private async getAllDocumentChunks(
    documentId: string,
    tenantId: string,
  ): Promise<{ content: string; sectionType: string; pageNumber: number | null }[]> {
    try {
      const chunks: any[] = await (this.documentIndexing as any).prisma.$queryRawUnsafe(
        `SELECT content, section_type AS "sectionType", page_number AS "pageNumber"
         FROM intel_document_chunks
         WHERE document_id = $1::uuid AND tenant_id = $2::uuid
         ORDER BY chunk_index ASC
         LIMIT 15`,
        documentId, tenantId,
      );
      return chunks;
    } catch (e) {
      this.logger.error(`Failed to fetch all chunks: ${e.message}`);
      return [];
    }
  }

  /**
   * Get metric definitions from the registry for the extraction prompt.
   */
  private getMetricDefinitions(metricIds: string[]): Array<{ id: string; def: MetricDefinition | undefined }> {
    return metricIds.map(id => ({
      id,
      def: this.metricRegistry.getMetricById(id),
    }));
  }

  /**
   * Collect all atomic dependencies for a computed metric (flatten the DAG).
   */
  private collectAtomicDependencies(metricId: string, visited = new Set<string>()): string[] {
    if (visited.has(metricId)) return [];
    visited.add(metricId);

    const def = this.metricRegistry.getMetricById(metricId);
    if (!def) return [metricId]; // Unknown metric, treat as atomic

    if (def.type === 'atomic') return [metricId];

    if (def.type === 'computed' && def.dependencies) {
      const atomics: string[] = [];
      for (const depId of def.dependencies) {
        atomics.push(...this.collectAtomicDependencies(depId, visited));
      }
      return [...new Set(atomics)];
    }

    return [metricId];
  }

  /**
   * Build the extraction system prompt with metric definitions.
   */
  private buildExtractionPrompt(
    metricDefs: Array<{ id: string; def: MetricDefinition | undefined }>,
    temporalScope?: TemporalScope,
  ): string {
    const metricDefsStr = metricDefs.map(({ id, def }) => {
      if (!def) return `- ${id}: (unknown metric)`;
      const synonyms = def.synonyms.slice(0, 5).join(', ');
      return `- ${def.canonical_id}: ${def.display_name}\n  Synonyms: ${synonyms}\n  Statement: ${def.statement || 'any'}\n  ${def.calculation_notes || ''}`;
    }).join('\n');

    const temporalStr = temporalScope?.type === 'latest'
      ? 'Most recent period available'
      : temporalScope?.type === 'specific_period'
        ? `Specific period: ${temporalScope.periods?.join(', ')}`
        : temporalScope?.type === 'range'
          ? `Range: ${temporalScope.rangeStart} to ${temporalScope.rangeEnd}`
          : 'Most recent period available';

    return this.extractionPromptTemplate
      .replace('{{METRIC_DEFINITIONS}}', metricDefsStr)
      .replace('{{TEMPORAL_SCOPE}}', temporalStr);
  }

  /**
   * Format document chunks for the extraction LLM call.
   */
  private formatChunksForExtraction(
    chunks: { content: string; sectionType: string; pageNumber: number | null }[],
  ): string {
    return chunks.map((c, i) => {
      const header = `--- Document Section ${i + 1} (${c.sectionType}${c.pageNumber ? `, page ${c.pageNumber}` : ''}) ---`;
      return `${header}\n${c.content}`;
    }).join('\n\n');
  }

  /**
   * Parse the LLM extraction response into structured metrics.
   */
  private parseExtractionResponse(
    response: string,
    requestedMetricIds: string[],
  ): { metrics: Record<string, ExtractedMetricValue>; currency: string; documentPeriod: string } {
    try {
      // Clean response — remove markdown fences if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(cleaned);

      const metrics: Record<string, ExtractedMetricValue> = {};

      for (const metricId of requestedMetricIds) {
        const raw = parsed.metrics?.[metricId];
        if (raw && raw.value != null) {
          metrics[metricId] = {
            value: typeof raw.value === 'number' ? raw.value : parseFloat(raw.value),
            period: raw.period || 'Unknown',
            pageReference: raw.page_reference || 'Unknown',
            confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
            notes: raw.notes || '',
          };
          // Validate: NaN check
          if (isNaN(metrics[metricId].value!)) {
            metrics[metricId].value = null;
            metrics[metricId].notes = `Could not parse value: ${raw.value}`;
          }
        } else {
          metrics[metricId] = {
            value: null,
            period: '',
            pageReference: '',
            confidence: 0,
            notes: raw?.notes || 'Not found in document',
          };
        }
      }

      return {
        metrics,
        currency: parsed.currency || 'USD',
        documentPeriod: parsed.document_period || 'Unknown',
      };
    } catch (e) {
      this.logger.error(`Failed to parse extraction response: ${e.message}`);
      // Return empty results for all requested metrics
      const metrics: Record<string, ExtractedMetricValue> = {};
      for (const id of requestedMetricIds) {
        metrics[id] = { value: null, period: '', pageReference: '', confidence: 0, notes: 'Parse error' };
      }
      return { metrics, currency: 'USD', documentPeriod: 'Unknown' };
    }
  }

  /**
   * Build an empty result when no chunks are found.
   */
  private buildEmptyResult(documentId: string, metricIds: string[]): ExtractedMetricResult {
    const metrics: Record<string, ExtractedMetricValue> = {};
    for (const id of metricIds) {
      metrics[id] = { value: null, period: '', pageReference: '', confidence: 0, notes: 'No document content available' };
    }
    return { source: 'uploaded_document', documentId, metrics, currency: 'USD', documentPeriod: 'Unknown' };
  }

  // ── Cache Management ─────────────────────────────────────────────

  private buildCacheKey(documentId: string, metricIds: string[], temporal?: TemporalScope): string {
    return `${documentId}|${metricIds.sort().join(',')}|${temporal?.type || 'latest'}`;
  }

  private getFromCache(key: string): ExtractedMetricResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private setCache(key: string, result: ExtractedMetricResult): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  /**
   * Invalidate cache for a specific document (e.g., when re-uploaded).
   */
  invalidateDocument(documentId: string): void {
    for (const [key] of this.cache) {
      if (key.startsWith(documentId)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}