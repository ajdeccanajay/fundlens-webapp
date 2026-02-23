/**
 * MetricRegistryService — Core service for the Canonical Metric Registry.
 *
 * Loads YAML metric definitions from S3 (or local filesystem for dev),
 * builds an inverted synonym index for O(1) exact-match resolution,
 * and wraps the pipeline with an LRU cache.
 *
 * Phase 1: Exact match only. Fuzzy matching added in Phase 2 (Task 3.1).
 */
import { Injectable, Logger, OnModuleInit, Optional, Inject } from '@nestjs/common';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { LRUCache } from 'lru-cache';

import * as stringSimilarity from 'string-similarity';
import { normalizeForLookup } from './normalize-for-lookup';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  MetricDefinition,
  MetricResolution,
  IndexBuildResult,
  RegistryStats,
} from './types';

/** Directories within the S3 prefix that contain metric definitions. */
const METRIC_DIRECTORIES = ['universal/', 'sector/', 'pe_specific/', 'computed/'];

/** Directories to skip — different schema, not metric definitions. */
const SKIP_DIRECTORIES = ['concepts/', 'clients/'];

/** Statements whose metrics get db_column derived from canonical_id. */
const UNIVERSAL_STATEMENTS = new Set([
  'income_statement',
  'balance_sheet',
  'cash_flow',
  'equity_statement',
]);

@Injectable()
export class MetricRegistryService implements OnModuleInit {
  private readonly logger = new Logger(MetricRegistryService.name);

  // In-memory structures
  private synonymIndex = new Map<string, string>();
  private metricsById = new Map<string, MetricDefinition>();
  private originalSynonyms = new Map<string, string>();
  private dependencyGraph = new Map<string, string[]>();
  private topologicalOrder: string[] = [];
  private lruCache: LRUCache<string, MetricResolution>;

  // Client overlay cache: tenantId → Map<normalizedSynonym, canonicalId>
  private clientOverlayCache = new Map<string, Map<string, string>>();

  // Build stats
  private collisions = 0;
  private lastBuildTimeMs = 0;

  // S3 configuration
  private readonly s3Bucket: string;
  private readonly s3Prefix: string;
  private readonly useMockS3: boolean;
  private readonly localStoragePath: string;
  private readonly s3Client: S3Client;

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {
    this.s3Bucket = process.env.S3_BUCKET_NAME || 'fundlens-documents-dev';
    this.s3Prefix = process.env.METRIC_REGISTRY_S3_PREFIX || 'metrics/';
    this.useMockS3 = process.env.USE_MOCK_S3 === 'true';
    this.localStoragePath = path.join(
      process.cwd(),
      'local-s3-storage',
      this.s3Bucket,
      this.s3Prefix,
    );

    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    this.lruCache = new LRUCache<string, MetricResolution>({ max: 10_000 });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
      this.logger.log('Initializing MetricRegistryService — loading YAML registry...');
      try {
        const result = await this.rebuildIndex();
        this.logger.log(
          `Registry loaded: ${result.metricsLoaded} metrics, ${result.synonymsIndexed} synonyms, ` +
            `${result.collisions} collisions in ${result.loadTimeMs}ms`,
        );
      } catch (err) {
        this.logger.warn('Failed to load metric registry at startup — continuing with empty registry. ' +
          'This is expected in local dev without S3. Error: ' + (err as Error).message);
      }
    }

  // ---------------------------------------------------------------------------
  // Core Resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve a single metric query to a MetricResolution.
   * Supports tenant-scoped resolution via client overlay synonyms.
   */
  resolve(query: string, tenantId?: string): MetricResolution {
    const normalized = normalizeForLookup(query);

    // Empty query → unresolved
    if (!normalized) {
      const unresolved = this.buildUnresolved(query);
      this.logResolution(unresolved, tenantId, true);
      return unresolved;
    }

    // Build a cache key that includes tenantId for tenant-scoped resolution
    const cacheKey = tenantId ? `${tenantId}:${normalized}` : normalized;

    // LRU cache check — skip logging for cache hits to reduce write volume
    const cached = this.lruCache.get(cacheKey);
    if (cached) {
      return { ...cached, original_query: query };
    }

    // If tenantId provided, check client overlay first (overlay extends, never replaces)
    if (tenantId) {
      const overlay = this.getClientOverlay(tenantId);
      if (overlay) {
        const overlayCanonicalId = overlay.get(normalized);
        if (overlayCanonicalId) {
          const metric = this.metricsById.get(overlayCanonicalId);
          if (metric) {
            const resolution = this.buildExactResolution(query, metric, normalized);
            resolution.match_source = `client_overlay:${tenantId}:${this.originalSynonyms.get(normalized) || normalized}`;
            this.lruCache.set(cacheKey, resolution);
            this.logResolution(resolution, tenantId, true);
            return resolution;
          }
        }
      }
    }

    // Exact match in universal inverted index
    const canonicalId = this.synonymIndex.get(normalized);
    if (canonicalId) {
      const metric = this.metricsById.get(canonicalId);
      if (metric) {
        const resolution = this.buildExactResolution(query, metric, normalized);
        this.lruCache.set(cacheKey, resolution);
        this.logResolution(resolution, tenantId, true);
        return resolution;
      }
    }

    // Fuzzy matching — compare against all synonym keys (universal + tenant overlay)
    const allKeys = Array.from(this.synonymIndex.keys());

    // Merge tenant overlay keys for fuzzy matching too
    if (tenantId) {
      const overlay = this.getClientOverlay(tenantId);
      if (overlay) {
        for (const key of overlay.keys()) {
          if (!this.synonymIndex.has(key)) {
            allKeys.push(key);
          }
        }
      }
    }

    if (allKeys.length === 0) {
      this.logger.warn(`Unresolved metric "${query}" — empty synonym index`);
      const unresolved = this.buildUnresolved(query);
      this.lruCache.set(cacheKey, unresolved);
      this.logResolution(unresolved, tenantId, true);
      return unresolved;
    }

    const matches = stringSimilarity.findBestMatch(normalized, allKeys);
    const bestMatch = matches.bestMatch;

    if (bestMatch.rating >= 0.85) {
      // Auto-resolve via fuzzy match — check overlay first, then universal
      const matchedCanonicalId = this.lookupCanonicalId(bestMatch.target, tenantId);
      if (matchedCanonicalId) {
        const metric = this.metricsById.get(matchedCanonicalId);
        if (metric) {
          const resolution = this.buildFuzzyAutoResolution(
            query,
            metric,
            bestMatch.target,
            bestMatch.rating,
          );
          this.lruCache.set(cacheKey, resolution);
          this.logResolution(resolution, tenantId, true);
          return resolution;
        }
      }
    }

    if (bestMatch.rating >= 0.70) {
      // Suggestions — top 3 candidates above 0.70
      const topCandidates = matches.ratings
        .filter((r) => r.rating >= 0.70)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 3);

      const suggestions = topCandidates.map((c) => {
        const cId = this.lookupCanonicalId(c.target, tenantId)!;
        const m = this.metricsById.get(cId)!;
        return {
          canonical_id: cId,
          display_name: m.display_name,
          fuzzy_score: c.rating,
        };
      }).filter((s) => s.canonical_id && s.display_name);

      // Deduplicate by canonical_id (different synonyms may point to same metric)
      const seen = new Set<string>();
      const uniqueSuggestions = suggestions
        .filter((s) => {
          if (seen.has(s.canonical_id)) return false;
          seen.add(s.canonical_id);
          return true;
        })
        .slice(0, 3);

      const unresolved = this.buildUnresolved(query);
      unresolved.suggestions = uniqueSuggestions;
      this.lruCache.set(cacheKey, unresolved);
      // Req 22.2: Log unresolved query with YAML synonym suggestions
      const yamlHint = uniqueSuggestions.length > 0
        ? `Consider adding "${normalized}" as a synonym under: ${uniqueSuggestions.map((s) => `${s.canonical_id} (${s.display_name})`).join(', ')}`
        : `No close YAML candidates — may need a new metric definition for "${normalized}"`;
      this.logger.warn(
        `[MetricRegistry:unresolved] "${query}" (tenantId: ${tenantId || 'none'}) — suggestions: ${uniqueSuggestions.map((s) => s.display_name).join(', ')}. YAML action: ${yamlHint}`,
      );
      this.logResolution(unresolved, tenantId, true);
      return unresolved;
    }

    // No good matches — score < 0.70
    // Req 22.2: Log unresolved query with YAML synonym suggestion
    this.logger.warn(
      `[MetricRegistry:unresolved] "${query}" (tenantId: ${tenantId || 'none'}) — no fuzzy matches above 0.70. YAML action: May need a new metric definition for "${normalized}"`,
    );
    const unresolved = this.buildUnresolved(query);
    this.lruCache.set(cacheKey, unresolved);
    this.logResolution(unresolved, tenantId, true);
    return unresolved;
  }

  /**
   * Resolve multiple metric queries.
   */
  resolveMultiple(queries: string[], tenantId?: string): MetricResolution[] {
    return queries.map((q) => this.resolve(q, tenantId));
  }

  // ---------------------------------------------------------------------------
  // Index Management
  // ---------------------------------------------------------------------------

  /**
   * Reload all YAML files from S3 (or local filesystem) and rebuild all maps.
   */
  async rebuildIndex(): Promise<IndexBuildResult> {
    const startTime = Date.now();

    // Reset state
    const newSynonymIndex = new Map<string, string>();
    const newMetricsById = new Map<string, MetricDefinition>();
    const newOriginalSynonyms = new Map<string, string>();
    const newDependencyGraph = new Map<string, string[]>();
    let collisions = 0;

    // Load YAML files
    const yamlFiles = this.useMockS3
      ? await this.loadYamlFromFilesystem()
      : await this.loadYamlFromS3();

    // Parse each file
    for (const { key, content } of yamlFiles) {
      try {
        const parsed = yaml.load(content) as Record<string, any>;
        if (!parsed || typeof parsed !== 'object') {
          this.logger.warn(`Skipping empty or invalid YAML: ${key}`);
          continue;
        }

        for (const [canonicalId, rawDef] of Object.entries(parsed)) {
          if (!rawDef || typeof rawDef !== 'object') continue;

          // Validate minimum schema
          const def = rawDef as Record<string, any>;
          if (!def.display_name || !def.type) {
            this.logger.warn(
              `Skipping invalid metric entry "${canonicalId}" in ${key}: missing display_name or type`,
            );
            continue;
          }

          // Handle duplicate canonical_ids — merge synonyms
          if (newMetricsById.has(canonicalId)) {
            const existing = newMetricsById.get(canonicalId)!;
            const newSynonyms: string[] = def.synonyms || [];
            const merged = new Set([...existing.synonyms, ...newSynonyms]);
            existing.synonyms = Array.from(merged);

            // Index only the new synonyms
            for (const syn of newSynonyms) {
              const normSyn = normalizeForLookup(syn);
              if (!normSyn) continue;
              if (newSynonymIndex.has(normSyn) && newSynonymIndex.get(normSyn) !== canonicalId) {
                this.logger.warn(
                  `Synonym collision: "${syn}" (${normSyn}) → existing "${newSynonymIndex.get(normSyn)}", skipping for "${canonicalId}"`,
                );
                collisions++;
              } else if (!newSynonymIndex.has(normSyn)) {
                newSynonymIndex.set(normSyn, canonicalId);
                newOriginalSynonyms.set(normSyn, syn);
              }
            }
            this.logger.debug(
              `Merged duplicate canonical_id "${canonicalId}" from ${key} — added ${newSynonyms.length} synonyms`,
            );
            continue;
          }

          // Build MetricDefinition
          const metric: MetricDefinition = {
            canonical_id: canonicalId,
            display_name: def.display_name,
            type: def.type,
            statement: def.statement || null,
            category: def.category || '',
            asset_class: def.asset_class || [],
            industry: def.industry || 'all',
            synonyms: def.synonyms || [],
            xbrl_tags: def.xbrl_tags || [],
            formula: def.formula || undefined,
            dependencies: def.dependencies || undefined,
            output_format: def.output_format || undefined,
            output_suffix: def.output_suffix || undefined,
            interpretation: def.interpretation || undefined,
            calculation_notes: def.calculation_notes || undefined,
          };

          // Derive db_column for atomic metrics (respect explicit YAML value if present)
          if (metric.type === 'atomic') {
            if (def.db_column) {
              metric.db_column = def.db_column;
            } else if (metric.statement && UNIVERSAL_STATEMENTS.has(metric.statement)) {
              metric.db_column = canonicalId;
            } else {
              // Sector/PE/supplemental metrics — no db_column
              this.logger.debug(
                `Metric "${canonicalId}" (${metric.statement || 'supplemental'}) has no db_column — supplemental KPI`,
              );
            }
          }

          newMetricsById.set(canonicalId, metric);

          // Build dependency graph for computed metrics
          if (metric.type === 'computed' && metric.dependencies) {
            newDependencyGraph.set(canonicalId, metric.dependencies);
          }

          // Index all synonyms for this metric
          const termsToIndex: Array<{ original: string; normalized: string }> = [];

          // 1. canonical_id itself
          termsToIndex.push({
            original: canonicalId,
            normalized: normalizeForLookup(canonicalId),
          });

          // 2. display_name
          termsToIndex.push({
            original: metric.display_name,
            normalized: normalizeForLookup(metric.display_name),
          });

          // 3. All synonyms
          for (const syn of metric.synonyms) {
            termsToIndex.push({
              original: syn,
              normalized: normalizeForLookup(syn),
            });
          }

          // 4. XBRL tag labels (strip namespace prefix)
          for (const tag of metric.xbrl_tags) {
            const label = tag.includes(':') ? tag.split(':').pop()! : tag;
            termsToIndex.push({
              original: label,
              normalized: normalizeForLookup(label),
            });
          }

          // Add to index
          for (const { original, normalized } of termsToIndex) {
            if (!normalized) continue;
            if (newSynonymIndex.has(normalized) && newSynonymIndex.get(normalized) !== canonicalId) {
              this.logger.warn(
                `Synonym collision: "${original}" (${normalized}) → existing "${newSynonymIndex.get(normalized)}", skipping for "${canonicalId}"`,
              );
              collisions++;
            } else {
              newSynonymIndex.set(normalized, canonicalId);
              newOriginalSynonyms.set(normalized, original);
            }
          }
        }
      } catch (err) {
        this.logger.error(`Failed to parse YAML file: ${key}`, err);
      }
    }

    // Validate atomic metrics have db_column
    let missingDbColumn = 0;
    for (const [id, metric] of newMetricsById) {
      if (metric.type === 'atomic' && !metric.db_column) {
        missingDbColumn++;
      }
    }
    if (missingDbColumn > 0) {
      this.logger.warn(
        `${missingDbColumn} atomic metrics lack db_column (sector/PE supplemental KPIs — expected)`,
      );
    }

    // Swap in new state
    this.synonymIndex = newSynonymIndex;
    this.metricsById = newMetricsById;
    this.originalSynonyms = newOriginalSynonyms;
    this.dependencyGraph = newDependencyGraph;
    this.collisions = collisions;
    this.lruCache.clear();
    this.clientOverlayCache.clear();

    // Validate dependency DAG and compute topological order
    this.topologicalOrder = this.validateAndSortDAG();

    const loadTimeMs = Date.now() - startTime;
    this.lastBuildTimeMs = loadTimeMs;

    return {
      metricsLoaded: newMetricsById.size,
      synonymsIndexed: newSynonymIndex.size,
      collisions,
      loadTimeMs,
    };
  }

  // ---------------------------------------------------------------------------
  // Monitoring
  // ---------------------------------------------------------------------------

  getStats(): RegistryStats {
    return {
      metricsLoaded: this.metricsById.size,
      synonymsIndexed: this.synonymIndex.size,
      collisions: this.collisions,
      cacheSize: this.lruCache.size,
      lastBuildTimeMs: this.lastBuildTimeMs,
    };
  }

  /**
   * Get a metric definition by canonical_id. Used by FormulaResolutionService.
   */
  getMetricById(canonicalId: string): MetricDefinition | undefined {
    return this.metricsById.get(canonicalId);
  }
  /**
   * Returns all known storage synonyms for a canonical metric ID.
   * Used by StructuredRetriever to build the IN clause for DB queries.
   * Includes canonical_id + db_column + all synonyms from YAML definition.
   */
  getSynonymsForDbColumn(canonicalId: string): string[] {
    if (!canonicalId) return [];
    const definition = this.getMetricById(canonicalId);
    if (!definition) return [canonicalId];

    const synonymSet = new Set<string>();
    // Always include canonical_id and db_column
    synonymSet.add(canonicalId);
    if (definition.db_column) synonymSet.add(definition.db_column);
    // Include both original YAML synonyms AND their storage-normalized forms.
    // The DB stores metrics via normalizeForStorage() which lowercases and replaces
    // non-alphanumeric chars with underscores (e.g. "Net Revenue" → "net_revenue").
    // Prisma's mode:'insensitive' only handles case, not space→underscore mapping,
    // so we must include both forms to match DB rows correctly.
    for (const syn of definition.synonyms ?? []) {
      synonymSet.add(syn);
      // Apply same normalization as IngestionValidationService.normalizeForStorage()
      const storageNormalized = syn
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if (storageNormalized) {
        synonymSet.add(storageNormalized);
      }
    }
    return Array.from(synonymSet);
  }

  /**
   * Get all loaded metric definitions. Useful for testing and admin endpoints.
   */
  getAllMetrics(): Map<string, MetricDefinition> {
    return this.metricsById;
  }

  /**
   * Returns the topological order of computed metrics.
   * Metrics earlier in the array have no unresolved dependencies on later ones.
   * Used by FormulaResolutionService to resolve dependencies bottom-up.
   */
  getTopologicalOrder(): string[] {
    return this.topologicalOrder;
  }

  /**
   * Returns the dependency graph for computed metrics.
   * Map of canonical_id → array of dependency canonical_ids.
   */
  getDependencyGraph(): Map<string, string[]> {
    return this.dependencyGraph;
  }

  /**
   * Validates the computed metric dependency graph is a DAG (no cycles)
   * using Kahn's algorithm (BFS topological sort).
   *
   * If cycles are detected:
   * - Logs the full cycle path
   * - Removes cycled metrics from the registry
   * - Returns topological order of valid metrics only
   */
  private validateAndSortDAG(): string[] {
    if (this.dependencyGraph.size === 0) return [];

    // Build in-degree map and adjacency list for computed metrics only
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>(); // dependency → dependents

    // Initialize all computed metrics
    for (const [metricId] of this.dependencyGraph) {
      inDegree.set(metricId, 0);
      if (!adjacency.has(metricId)) {
        adjacency.set(metricId, []);
      }
    }

    // Build edges: for each computed metric, each dependency points to it
    for (const [metricId, deps] of this.dependencyGraph) {
      for (const dep of deps) {
        // Only count edges between computed metrics (atomic deps have in-degree 0 implicitly)
        if (this.dependencyGraph.has(dep)) {
          adjacency.get(dep)!.push(metricId);
          inDegree.set(metricId, (inDegree.get(metricId) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm: start with nodes that have in-degree 0
    const queue: string[] = [];
    for (const [metricId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(metricId);
      }
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const dependent of adjacency.get(current) || []) {
        const newDegree = (inDegree.get(dependent) || 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          queue.push(dependent);
        }
      }
    }

    // Check for cycles: any node not in sorted has a cycle
    const cycledMetrics: string[] = [];
    for (const [metricId] of this.dependencyGraph) {
      if (!sorted.includes(metricId)) {
        cycledMetrics.push(metricId);
      }
    }

    if (cycledMetrics.length > 0) {
      // Trace the cycle path for logging
      const cyclePath = this.traceCyclePath(cycledMetrics);
      this.logger.error(
        `Circular dependency detected: ${cyclePath}. Excluding ${cycledMetrics.length} metric(s) from registry: [${cycledMetrics.join(', ')}]`,
      );

      // Remove cycled metrics from registry
      for (const metricId of cycledMetrics) {
        this.metricsById.delete(metricId);
        this.dependencyGraph.delete(metricId);

        // Remove from synonym index
        const normId = normalizeForLookup(metricId);
        if (normId && this.synonymIndex.get(normId) === metricId) {
          this.synonymIndex.delete(normId);
          this.originalSynonyms.delete(normId);
        }
      }
    } else {
      this.logger.log(
        `DAG validation passed: ${sorted.length} computed metrics in valid topological order`,
      );
    }

    return sorted;
  }

  /**
   * Traces a cycle path from the set of cycled metrics for human-readable logging.
   * Follows dependency edges from the first cycled metric until it loops back.
   */
  private traceCyclePath(cycledMetrics: string[]): string {
    const cycledSet = new Set(cycledMetrics);
    const start = cycledMetrics[0];
    const path: string[] = [start];
    const visited = new Set<string>([start]);

    let current = start;
    while (true) {
      const deps = this.dependencyGraph.get(current) || [];
      const nextInCycle = deps.find((d) => cycledSet.has(d));
      if (!nextInCycle) break;

      path.push(nextInCycle);
      if (visited.has(nextInCycle)) break; // Found the loop-back
      visited.add(nextInCycle);
      current = nextInCycle;
    }

    return path.join(' → ');
  }


  // ---------------------------------------------------------------------------
  // Client Overlay Loading
  // ---------------------------------------------------------------------------

  /**
   * Look up a canonical_id from a normalized key, checking tenant overlay first,
   * then falling back to the universal synonym index.
   */
  private lookupCanonicalId(normalizedKey: string, tenantId?: string): string | undefined {
    if (tenantId) {
      const overlay = this.getClientOverlay(tenantId);
      if (overlay) {
        const overlayId = overlay.get(normalizedKey);
        if (overlayId) return overlayId;
      }
    }
    return this.synonymIndex.get(normalizedKey);
  }

  /**
   * Get the cached client overlay for a tenant. Loads from S3/filesystem on first access.
   * Returns null if no overlay exists for this tenant.
   */
  private getClientOverlay(tenantId: string): Map<string, string> | null {
    if (this.clientOverlayCache.has(tenantId)) {
      return this.clientOverlayCache.get(tenantId) || null;
    }

    // Synchronously return null — trigger async load for next call
    this.loadClientOverlayAsync(tenantId);
    return null;
  }

  /**
   * Asynchronously load a client overlay from S3 (or filesystem) and cache it.
   * If the overlay file doesn't exist, caches an empty map (no error).
   */
  private async loadClientOverlayAsync(tenantId: string): Promise<void> {
    try {
      const overlayMap = await this.loadClientOverlay(tenantId);
      this.clientOverlayCache.set(tenantId, overlayMap);
      if (overlayMap.size > 0) {
        this.logger.log(
          `Loaded client overlay for "${tenantId}": ${overlayMap.size} additional synonyms`,
        );
      }
    } catch (err) {
      // Cache empty map so we don't retry on every request
      this.clientOverlayCache.set(tenantId, new Map());
      this.logger.debug(`No client overlay found for "${tenantId}" — using universal registry`);
    }
  }

  /**
   * Load a client overlay YAML from S3 or filesystem.
   * Returns a Map<normalizedSynonym, canonicalId> of additional synonyms.
   */
  private async loadClientOverlay(tenantId: string): Promise<Map<string, string>> {
    const overlayMap = new Map<string, string>();
    let content: string | null = null;

    if (this.useMockS3) {
      // Load from local filesystem
      const overlayPath = path.join(this.localStoragePath, 'clients', `${tenantId}.yaml`);
      if (fs.existsSync(overlayPath)) {
        content = fs.readFileSync(overlayPath, 'utf-8');
      }
    } else {
      // Load from S3
      try {
        const key = `${this.s3Prefix}clients/${tenantId}.yaml`;
        const response = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.s3Bucket,
            Key: key,
          }),
        );
        content = (await response.Body?.transformToString()) || null;
      } catch (err: any) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
          // File doesn't exist — not an error
          return overlayMap;
        }
        throw err;
      }
    }

    if (!content) return overlayMap;

    // Parse overlay YAML
    const parsed = yaml.load(content) as Record<string, any>;
    if (!parsed || !parsed.overrides || typeof parsed.overrides !== 'object') {
      return overlayMap;
    }

    // Build synonym map from overrides
    for (const [canonicalId, override] of Object.entries(parsed.overrides)) {
      if (!override || typeof override !== 'object') continue;
      const additionalSynonyms: string[] = (override as any).additional_synonyms || [];

      // Only add synonyms for metrics that exist in the universal registry
      if (!this.metricsById.has(canonicalId)) {
        this.logger.warn(
          `Client overlay "${tenantId}": metric "${canonicalId}" not found in universal registry — skipping`,
        );
        continue;
      }

      for (const syn of additionalSynonyms) {
        const normalized = normalizeForLookup(syn);
        if (!normalized) continue;

        // Don't override universal synonyms — overlay extends only
        if (this.synonymIndex.has(normalized)) {
          this.logger.debug(
            `Client overlay "${tenantId}": synonym "${syn}" already in universal index — skipping`,
          );
          continue;
        }

        overlayMap.set(normalized, canonicalId);
      }
    }

    return overlayMap;
  }

  /**
   * Return all known metric names (canonical IDs + synonyms).
   * Used by IntentDetectorService for metric detection in natural language.
   */
  getKnownMetricNames(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [alias, canonicalId] of this.synonymIndex.entries()) {
      result.set(alias, canonicalId);
    }
    for (const [id, def] of this.metricsById.entries()) {
      result.set(id, id);
      if (def.display_name) {
        const normalized = def.display_name.toLowerCase().trim();
        if (!result.has(normalized)) {
          result.set(normalized, id);
        }
      }
    }
    return result;
  }

  /**
   * Normalize a metric name to its canonical ID.
   * Returns the original name if no match found.
   * Drop-in replacement for MetricMappingService.normalizeMetricName().
   */
  normalizeMetricName(name: string): string {
    const resolution = this.resolve(name);
    if (resolution.confidence !== 'unresolved') {
      return resolution.canonical_id;
    }
    return name;
  }

  /**
   * Pre-load a client overlay synchronously (for use in tests or startup).
   * After calling this, resolve() with the tenantId will use the overlay immediately.
   */
  async preloadClientOverlay(tenantId: string): Promise<void> {
    await this.loadClientOverlayAsync(tenantId);
  }

  // ---------------------------------------------------------------------------
  // S3 Loading
  // ---------------------------------------------------------------------------

  private async loadYamlFromS3(): Promise<Array<{ key: string; content: string }>> {
    const results: Array<{ key: string; content: string }> = [];

    try {
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.s3Bucket,
          Prefix: this.s3Prefix,
        }),
      );

      const objects = listResponse.Contents || [];
      this.logger.log(`Found ${objects.length} objects in s3://${this.s3Bucket}/${this.s3Prefix}`);

      for (const obj of objects) {
        if (!obj.Key || !obj.Key.endsWith('.yaml')) continue;

        // Check if this file is in a directory we should skip
        const relativePath = obj.Key.replace(this.s3Prefix, '');
        if (this.shouldSkipFile(relativePath)) {
          this.logger.debug(`Skipping non-metric file: ${obj.Key}`);
          continue;
        }

        try {
          const getResponse = await this.s3Client.send(
            new GetObjectCommand({
              Bucket: this.s3Bucket,
              Key: obj.Key,
            }),
          );

          const body = await getResponse.Body?.transformToString();
          if (body) {
            results.push({ key: obj.Key, content: body });
          }
        } catch (err) {
          this.logger.error(`Failed to download ${obj.Key}`, err);
        }
      }
    } catch (err) {
      this.logger.error(`Failed to list S3 objects in ${this.s3Bucket}/${this.s3Prefix}`, err);
      throw err;
    }

    return results;
  }

  private async loadYamlFromFilesystem(): Promise<Array<{ key: string; content: string }>> {
    const results: Array<{ key: string; content: string }> = [];

    if (!fs.existsSync(this.localStoragePath)) {
      this.logger.error(`Local storage path does not exist: ${this.localStoragePath}`);
      throw new Error(`Local metric registry path not found: ${this.localStoragePath}`);
    }

    this.logger.log(`Loading YAML from local filesystem: ${this.localStoragePath}`);
    this.readYamlFilesRecursive(this.localStoragePath, '', results);
    this.logger.log(`Found ${results.length} YAML files locally`);

    return results;
  }

  private readYamlFilesRecursive(
    basePath: string,
    relativePath: string,
    results: Array<{ key: string; content: string }>,
  ): void {
    const fullPath = path.join(basePath, relativePath);
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        this.readYamlFilesRecursive(basePath, entryRelative, results);
      } else if (entry.name.endsWith('.yaml')) {
        // Check if this file should be skipped
        if (this.shouldSkipFile(entryRelative)) {
          this.logger.debug(`Skipping non-metric file: ${entryRelative}`);
          continue;
        }

        const content = fs.readFileSync(path.join(fullPath, entry.name), 'utf-8');
        results.push({ key: `${this.s3Prefix}${entryRelative}`, content });
      }
    }
  }

  /**
   * Determine if a file should be skipped based on its relative path.
   * We skip concepts/ and clients/ directories — different schema.
   */
  private shouldSkipFile(relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return SKIP_DIRECTORIES.some((dir) => normalizedPath.startsWith(dir));
  }

  // ---------------------------------------------------------------------------
  // Resolution Builders
  // ---------------------------------------------------------------------------

  private buildExactResolution(
    originalQuery: string,
    metric: MetricDefinition,
    normalizedKey: string,
  ): MetricResolution {
    const matchSource = this.originalSynonyms.get(normalizedKey) || normalizedKey;

    return {
      canonical_id: metric.canonical_id,
      display_name: metric.display_name,
      type: metric.type,
      confidence: 'exact',
      fuzzy_score: null,
      original_query: originalQuery,
      match_source: matchSource,
      suggestions: null,
      db_column: metric.db_column,
      formula: metric.formula,
      dependencies: metric.dependencies,
    };
  }

  private buildUnresolved(originalQuery: string): MetricResolution {
    return {
      canonical_id: '',
      display_name: '',
      type: 'atomic',
      confidence: 'unresolved',
      fuzzy_score: null,
      original_query: originalQuery,
      match_source: 'none',
      suggestions: null,
    };
  }

  private buildFuzzyAutoResolution(
    originalQuery: string,
    metric: MetricDefinition,
    matchedKey: string,
    score: number,
  ): MetricResolution {
    const matchSource = this.originalSynonyms.get(matchedKey) || matchedKey;
    return {
      canonical_id: metric.canonical_id,
      display_name: metric.display_name,
      type: metric.type,
      confidence: 'fuzzy_auto',
      fuzzy_score: score,
      original_query: originalQuery,
      match_source: `fuzzy: ${matchSource} (${score.toFixed(2)})`,
      suggestions: null,
      db_column: metric.db_column,
      formula: metric.formula,
      dependencies: metric.dependencies,
    };
  }

  // ---------------------------------------------------------------------------
  // Resolution Logging (Task 9.2)
  // ---------------------------------------------------------------------------

  /**
   * Fire-and-forget: log every resolution to MetricResolutionLog for analytics.
   * Uses async void pattern — never awaited, never blocks the resolve() path.
   * For cache misses, isCacheMiss=true is logged for analytics.
   */
  private logResolution(
    resolution: MetricResolution,
    tenantId: string | undefined,
    isCacheMiss: boolean,
  ): void {
    if (!this.prisma) return; // No PrismaService available (e.g., in unit tests)

    const logEntry = {
      tenantId: tenantId || 'unknown',
      rawQuery: resolution.original_query,
      confidence: isCacheMiss
        ? `${resolution.confidence}:cache_miss`
        : resolution.confidence,
      resolvedTo:
        resolution.confidence !== 'unresolved'
          ? resolution.canonical_id
          : null,
      suggestions: resolution.suggestions
        ? resolution.suggestions.map((s) => s.canonical_id)
        : [],
    };

    // Fire-and-forget — don't await, don't block resolution
    this.prisma.metricResolutionLog
      .create({ data: logEntry })
      .catch((err: Error) => {
        this.logger.warn(
          `Failed to log metric resolution for "${resolution.original_query}": ${err.message}`,
        );
      });
  }
}
