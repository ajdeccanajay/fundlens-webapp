/**
 * PromptRegistryService — QUL Phase 5 (Spec §6.3)
 *
 * Manages versioned, externalized prompts for the QUL and other LLM services.
 * Prompts are loaded from the filesystem at startup and can be refreshed
 * without redeployment.
 *
 * MVP: Filesystem-based (src/prompts/).
 * Future: S3-backed with tenant-specific overrides.
 */
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface PromptVersion {
  id: string;
  version: string;
  systemPrompt: string;
  fewShotExamples: any[];
  metadata: {
    loadedAt: Date;
    source: 'filesystem' | 's3';
    promptFile: string;
    examplesFile: string;
  };
}

export interface PromptRegistryStats {
  promptsLoaded: number;
  lastReloadAt: Date | null;
  prompts: Array<{
    id: string;
    version: string;
    promptLength: number;
    exampleCount: number;
  }>;
}

@Injectable()
export class PromptRegistryService {
  private readonly logger = new Logger(PromptRegistryService.name);
  private readonly prompts = new Map<string, PromptVersion>();
  private readonly promptsDir = path.join(process.cwd(), 'src', 'prompts');
  private lastReloadAt: Date | null = null;

  constructor() {
    this.loadAllPrompts();
  }

  /**
   * Get a prompt by ID. Returns null if not found.
   */
  get(promptId: string): PromptVersion | null {
    return this.prompts.get(promptId) || null;
  }

  /**
   * Get the QUL system prompt and examples.
   */
  getQULPrompt(): { systemPrompt: string; examples: any[] } | null {
    const prompt = this.prompts.get('qul-v1');
    if (!prompt) return null;
    return {
      systemPrompt: prompt.systemPrompt,
      examples: prompt.fewShotExamples,
    };
  }

  /**
   * Get the metric extraction prompt.
   */
  getExtractionPrompt(): string | null {
    const prompt = this.prompts.get('metric-extraction-v1');
    return prompt?.systemPrompt || null;
  }

  /**
   * Reload all prompts from filesystem.
   * Can be called on admin signal or hot-reload event.
   */
  reload(): void {
    this.prompts.clear();
    this.loadAllPrompts();
    this.logger.log(`🔄 Prompt registry reloaded: ${this.prompts.size} prompts`);
  }

  /**
   * Get registry statistics for monitoring.
   */
  getStats(): PromptRegistryStats {
    return {
      promptsLoaded: this.prompts.size,
      lastReloadAt: this.lastReloadAt,
      prompts: Array.from(this.prompts.values()).map(p => ({
        id: p.id,
        version: p.version,
        promptLength: p.systemPrompt.length,
        exampleCount: p.fewShotExamples.length,
      })),
    };
  }

  /**
   * Load all known prompts from the filesystem.
   */
  private loadAllPrompts(): void {
    // QUL prompt
    this.loadPrompt('qul-v1', '1.0.0', 'qul-system-prompt.txt', 'qul-examples.json');

    // Metric extraction prompt
    this.loadPrompt('metric-extraction-v1', '1.0.0', 'metric-extraction-prompt.txt');

    this.lastReloadAt = new Date();
    this.logger.log(`📋 Prompt registry loaded: ${this.prompts.size} prompts`);
  }

  /**
   * Load a single prompt from filesystem.
   */
  private loadPrompt(
    id: string,
    version: string,
    promptFile: string,
    examplesFile?: string,
  ): void {
    try {
      const promptPath = path.join(this.promptsDir, promptFile);
      const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

      let fewShotExamples: any[] = [];
      if (examplesFile) {
        try {
          const examplesPath = path.join(this.promptsDir, examplesFile);
          const raw = fs.readFileSync(examplesPath, 'utf-8');
          fewShotExamples = JSON.parse(raw);
        } catch (e) {
          this.logger.warn(`Could not load examples for ${id}: ${e.message}`);
        }
      }

      this.prompts.set(id, {
        id,
        version,
        systemPrompt,
        fewShotExamples,
        metadata: {
          loadedAt: new Date(),
          source: 'filesystem',
          promptFile,
          examplesFile: examplesFile || '',
        },
      });
    } catch (e) {
      this.logger.error(`Failed to load prompt ${id}: ${e.message}`);
    }
  }
}