/**
 * ConceptRegistryService — Maps analytical questions to metric bundles.
 *
 * Loads concept definitions from S3 (or local filesystem for dev),
 * builds a trigger index for O(1) exact-match concept detection,
 * and supports sector/asset-class-filtered metric bundle retrieval.
 *
 * Phase 4: Concept → Metric Bundle mapping.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import * as stringSimilarity from 'string-similarity';
import { normalizeForLookup } from './normalize-for-lookup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConceptDefinition {
  concept_id: string;
  display_name: string;
  description: string;
  triggers: string[];
  primary_metrics: Record<string, string[]>;
  secondary_metrics: Record<string, string[]>;
  context_prompt: string;
  presentation: {
    layout: string;
    include_peer_comparison: boolean;
    include_historical_trend: boolean;
  };
}

export interface ConceptMatch {
  concept_id: string;
  display_name: string;
  confidence: 'exact' | 'fuzzy';
  fuzzy_score: number | null;
  matched_trigger: string;
}

export interface MetricBundle {
  concept_id: string;
  display_name: string;
  primary_metrics: string[];
  secondary_metrics: string[];
  context_prompt: string;
  presentation: ConceptDefinition['presentation'];
}

@Injectable()
export class ConceptRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ConceptRegistryService.name);

  private conceptsById = new Map<string, ConceptDefinition>();
  private triggerIndex = new Map<string, string>(); // normalized trigger → concept_id
  private originalTriggers = new Map<string, string>(); // normalized → original text

  private readonly s3Bucket: string;
  private readonly s3Prefix: string;
  private readonly useMockS3: boolean;
  private readonly localStoragePath: string;
  private readonly s3Client: S3Client;

  constructor() {
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
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing ConceptRegistryService — loading concept YAML...');
    try {
      await this.loadConcepts();
      this.logger.log(
        `Concept registry loaded: ${this.conceptsById.size} concepts, ${this.triggerIndex.size} triggers indexed`,
      );
    } catch (err) {
      this.logger.error('Failed to load concept registry at startup', err);
      // Non-fatal — concept matching degrades gracefully
    }
  }

  // ---------------------------------------------------------------------------
  // Concept Matching
  // ---------------------------------------------------------------------------

  /**
   * Match a query against concept triggers.
   * Returns null if no concept matches.
   */
  matchConcept(query: string): ConceptMatch | null {
    const normalized = normalizeForLookup(query);
    if (!normalized) return null;

    // Exact match on trigger index
    const conceptId = this.triggerIndex.get(normalized);
    if (conceptId) {
      const concept = this.conceptsById.get(conceptId);
      if (concept) {
        return {
          concept_id: conceptId,
          display_name: concept.display_name,
          confidence: 'exact',
          fuzzy_score: null,
          matched_trigger: this.originalTriggers.get(normalized) || normalized,
        };
      }
    }

    // Fuzzy match against all trigger keys
    const allKeys = Array.from(this.triggerIndex.keys());
    if (allKeys.length === 0) return null;

    const matches = stringSimilarity.findBestMatch(normalized, allKeys);
    const best = matches.bestMatch;

    if (best.rating >= 0.80) {
      const matchedConceptId = this.triggerIndex.get(best.target);
      if (matchedConceptId) {
        const concept = this.conceptsById.get(matchedConceptId);
        if (concept) {
          return {
            concept_id: matchedConceptId,
            display_name: concept.display_name,
            confidence: 'fuzzy',
            fuzzy_score: best.rating,
            matched_trigger: this.originalTriggers.get(best.target) || best.target,
          };
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Metric Bundle Retrieval
  // ---------------------------------------------------------------------------

  /**
   * Get the metric bundle for a concept, filtered by sector and asset class.
   * Collects primary_metrics from "all" + sector key, secondary_metrics from "all" + asset_class key.
   * Deduplicates the result.
   */
  getMetricBundle(conceptId: string, sector?: string, assetClass?: string): MetricBundle | null {
    const concept = this.conceptsById.get(conceptId);
    if (!concept) return null;

    const primaryMetrics = this.collectMetrics(concept.primary_metrics, sector, assetClass);
    const secondaryMetrics = this.collectMetrics(concept.secondary_metrics, sector, assetClass);

    // Remove any secondary metrics that are already in primary
    const primarySet = new Set(primaryMetrics);
    const dedupedSecondary = secondaryMetrics.filter((m) => !primarySet.has(m));

    return {
      concept_id: conceptId,
      display_name: concept.display_name,
      primary_metrics: primaryMetrics,
      secondary_metrics: dedupedSecondary,
      context_prompt: concept.context_prompt,
      presentation: concept.presentation,
    };
  }

  /**
   * Get a concept definition by ID.
   */
  getConceptById(conceptId: string): ConceptDefinition | undefined {
    return this.conceptsById.get(conceptId);
  }

  /**
   * Get all loaded concept IDs.
   */
  getAllConceptIds(): string[] {
    return Array.from(this.conceptsById.keys());
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private collectMetrics(
    metricsMap: Record<string, string[]>,
    sector?: string,
    assetClass?: string,
  ): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    // Always include "all" metrics
    const allMetrics = metricsMap['all'] || [];
    for (const m of allMetrics) {
      if (!seen.has(m)) {
        seen.add(m);
        result.push(m);
      }
    }

    // Add sector-specific metrics
    if (sector && metricsMap[sector]) {
      for (const m of metricsMap[sector]) {
        if (!seen.has(m)) {
          seen.add(m);
          result.push(m);
        }
      }
    }

    // Add asset-class-specific metrics
    if (assetClass && metricsMap[assetClass]) {
      for (const m of metricsMap[assetClass]) {
        if (!seen.has(m)) {
          seen.add(m);
          result.push(m);
        }
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // YAML Loading
  // ---------------------------------------------------------------------------

  private async loadConcepts(): Promise<void> {
    const content = await this.loadConceptYaml();
    if (!content) {
      this.logger.warn('No concept YAML found — concept matching disabled');
      return;
    }

    const parsed = yaml.load(content) as Record<string, any>;
    if (!parsed || typeof parsed !== 'object') {
      this.logger.warn('Concept YAML is empty or invalid');
      return;
    }

    const newConceptsById = new Map<string, ConceptDefinition>();
    const newTriggerIndex = new Map<string, string>();
    const newOriginalTriggers = new Map<string, string>();

    for (const [conceptId, rawDef] of Object.entries(parsed)) {
      if (!rawDef || typeof rawDef !== 'object') continue;
      const def = rawDef as Record<string, any>;

      if (!def.display_name || !def.triggers) {
        this.logger.warn(`Skipping invalid concept "${conceptId}": missing display_name or triggers`);
        continue;
      }

      const concept: ConceptDefinition = {
        concept_id: conceptId,
        display_name: def.display_name,
        description: def.description || '',
        triggers: def.triggers || [],
        primary_metrics: def.primary_metrics || {},
        secondary_metrics: def.secondary_metrics || {},
        context_prompt: def.context_prompt || '',
        presentation: def.presentation || {
          layout: 'profile',
          include_peer_comparison: false,
          include_historical_trend: false,
        },
      };

      newConceptsById.set(conceptId, concept);

      // Index concept_id itself as a trigger
      const normId = normalizeForLookup(conceptId);
      if (normId && !newTriggerIndex.has(normId)) {
        newTriggerIndex.set(normId, conceptId);
        newOriginalTriggers.set(normId, conceptId);
      }

      // Index display_name as a trigger
      const normDisplay = normalizeForLookup(concept.display_name);
      if (normDisplay && !newTriggerIndex.has(normDisplay)) {
        newTriggerIndex.set(normDisplay, conceptId);
        newOriginalTriggers.set(normDisplay, concept.display_name);
      }

      // Index all explicit triggers
      for (const trigger of concept.triggers) {
        const normTrigger = normalizeForLookup(trigger);
        if (!normTrigger) continue;
        if (newTriggerIndex.has(normTrigger) && newTriggerIndex.get(normTrigger) !== conceptId) {
          this.logger.warn(
            `Trigger collision: "${trigger}" (${normTrigger}) → existing "${newTriggerIndex.get(normTrigger)}", skipping for "${conceptId}"`,
          );
        } else if (!newTriggerIndex.has(normTrigger)) {
          newTriggerIndex.set(normTrigger, conceptId);
          newOriginalTriggers.set(normTrigger, trigger);
        }
      }
    }

    this.conceptsById = newConceptsById;
    this.triggerIndex = newTriggerIndex;
    this.originalTriggers = newOriginalTriggers;
  }

  private async loadConceptYaml(): Promise<string | null> {
    const conceptKey = 'concepts/analytical_concepts.yaml';

    if (this.useMockS3) {
      const filePath = path.join(this.localStoragePath, conceptKey);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return null;
    }

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: `${this.s3Prefix}${conceptKey}`,
        }),
      );
      return (await response.Body?.transformToString()) || null;
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }
}
