import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface PromptTemplate {
  id: string;
  version: number;
  intentType: string;
  systemPrompt: string;
  userPromptTemplate?: string;
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
  performanceMetrics?: {
    avgConfidence?: number;
    successRate?: number;
    avgLatency?: number;
    totalUsage?: number;
  };
}

export interface PromptPerformanceMetrics {
  avgConfidence: number;
  successRate: number;
  avgLatency: number;
  totalUsage: number;
}

@Injectable()
export class PromptLibraryService {
  private readonly logger = new Logger(PromptLibraryService.name);
  private readonly promptCache = new Map<string, PromptTemplate>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get the active prompt for a given intent type
   * @param intentType - The intent type (general, competitive_intelligence, mda_intelligence, footnote)
   * @param version - Optional specific version to retrieve
   * @returns The prompt template
   */
  async getPrompt(
    intentType: string,
    version?: number,
  ): Promise<PromptTemplate> {
    try {
      // Check cache first (only for active prompts without specific version)
      if (!version) {
        const cacheKey = `${intentType}:active`;
        const cached = this.promptCache.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache hit for prompt: ${intentType}`);
          return cached;
        }
      }

      // Query database
      const whereClause: any = { intent_type: intentType };
      if (version) {
        whereClause.version = version;
      } else {
        whereClause.active = true;
      }

      const prompt = await this.prisma.$queryRaw<any[]>`
        SELECT 
          id,
          version,
          intent_type as "intentType",
          system_prompt as "systemPrompt",
          user_prompt_template as "userPromptTemplate",
          created_at as "createdAt",
          updated_at as "updatedAt",
          active,
          performance_metrics as "performanceMetrics"
        FROM prompt_templates
        WHERE intent_type = ${intentType}
          ${version ? this.prisma.$queryRaw`AND version = ${version}` : this.prisma.$queryRaw`AND active = true`}
        ORDER BY version DESC
        LIMIT 1
      `;

      if (!prompt || prompt.length === 0) {
        this.logger.warn(
          `No prompt found for intent type: ${intentType}, version: ${version || 'active'}`,
        );
        // Fallback to general prompt
        return this.getPrompt('general');
      }

      const promptTemplate = prompt[0] as PromptTemplate;

      // Cache active prompts
      if (!version && promptTemplate.active) {
        const cacheKey = `${intentType}:active`;
        this.promptCache.set(cacheKey, promptTemplate);
      }

      this.logger.log(
        `Retrieved prompt: ${intentType} v${promptTemplate.version}`,
      );
      return promptTemplate;
    } catch (error) {
      this.logger.error(
        `Error retrieving prompt for ${intentType}:`,
        error.stack,
      );
      // Return default fallback prompt
      return this.getDefaultPrompt(intentType);
    }
  }

  /**
   * Create a new prompt version
   * @param intentType - The intent type
   * @param systemPrompt - The system prompt text
   * @param userPromptTemplate - Optional user prompt template
   * @returns The created prompt template
   */
  async createPrompt(
    intentType: string,
    systemPrompt: string,
    userPromptTemplate?: string,
  ): Promise<PromptTemplate> {
    try {
      // Get the latest version for this intent type
      const latestVersion = await this.prisma.$queryRaw<any[]>`
        SELECT MAX(version) as "maxVersion"
        FROM prompt_templates
        WHERE intent_type = ${intentType}
      `;

      const newVersion = (latestVersion[0]?.maxVersion || 0) + 1;

      // Deactivate all previous versions
      await this.prisma.$executeRaw`
        UPDATE prompt_templates
        SET active = false, updated_at = NOW()
        WHERE intent_type = ${intentType}
      `;

      // Insert new version
      const result = await this.prisma.$queryRaw<any[]>`
        INSERT INTO prompt_templates (
          version, intent_type, system_prompt, user_prompt_template, active
        ) VALUES (
          ${newVersion}, ${intentType}, ${systemPrompt}, ${userPromptTemplate || null}, true
        )
        RETURNING 
          id,
          version,
          intent_type as "intentType",
          system_prompt as "systemPrompt",
          user_prompt_template as "userPromptTemplate",
          created_at as "createdAt",
          updated_at as "updatedAt",
          active,
          performance_metrics as "performanceMetrics"
      `;

      const newPrompt = result[0] as PromptTemplate;

      // Clear cache for this intent type
      this.promptCache.delete(`${intentType}:active`);

      this.logger.log(
        `Created new prompt: ${intentType} v${newVersion}`,
      );

      return newPrompt;
    } catch (error) {
      this.logger.error(
        `Error creating prompt for ${intentType}:`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Update an existing prompt (creates a new version)
   * @param intentType - The intent type
   * @param newPrompt - The new prompt text
   * @returns The created prompt template
   */
  async updatePrompt(
    intentType: string,
    newPrompt: string,
  ): Promise<PromptTemplate> {
    return this.createPrompt(intentType, newPrompt);
  }

  /**
   * Rollback to a previous prompt version
   * @param intentType - The intent type
   * @param toVersion - The version to rollback to
   */
  async rollbackPrompt(
    intentType: string,
    toVersion: number,
  ): Promise<void> {
    try {
      // Verify the target version exists
      const targetPrompt = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM prompt_templates
        WHERE intent_type = ${intentType} AND version = ${toVersion}
      `;

      if (!targetPrompt || targetPrompt.length === 0) {
        throw new Error(
          `Prompt version ${toVersion} not found for ${intentType}`,
        );
      }

      // Deactivate all versions
      await this.prisma.$executeRaw`
        UPDATE prompt_templates
        SET active = false, updated_at = NOW()
        WHERE intent_type = ${intentType}
      `;

      // Activate the target version
      await this.prisma.$executeRaw`
        UPDATE prompt_templates
        SET active = true, updated_at = NOW()
        WHERE intent_type = ${intentType} AND version = ${toVersion}
      `;

      // Clear cache
      this.promptCache.delete(`${intentType}:active`);

      this.logger.log(
        `Rolled back prompt ${intentType} to version ${toVersion}`,
      );
    } catch (error) {
      this.logger.error(
        `Error rolling back prompt ${intentType} to v${toVersion}:`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Track performance metrics for a prompt
   * @param promptId - The prompt ID
   * @param metrics - The performance metrics
   */
  async trackPerformance(
    promptId: string,
    metrics: Partial<PromptPerformanceMetrics>,
  ): Promise<void> {
    try {
      // Get current metrics
      const current = await this.prisma.$queryRaw<any[]>`
        SELECT performance_metrics as "performanceMetrics"
        FROM prompt_templates
        WHERE id = ${promptId}
      `;

      if (!current || current.length === 0) {
        this.logger.warn(`Prompt not found for tracking: ${promptId}`);
        return;
      }

      const currentMetrics = (current[0].performanceMetrics || {}) as PromptPerformanceMetrics;
      const totalUsage = (currentMetrics.totalUsage || 0) + 1;

      // Calculate running averages
      const updatedMetrics: PromptPerformanceMetrics = {
        avgConfidence:
          metrics.avgConfidence !== undefined
            ? ((currentMetrics.avgConfidence || 0) * (totalUsage - 1) +
                metrics.avgConfidence) /
              totalUsage
            : currentMetrics.avgConfidence || 0,
        successRate:
          metrics.successRate !== undefined
            ? ((currentMetrics.successRate || 0) * (totalUsage - 1) +
                metrics.successRate) /
              totalUsage
            : currentMetrics.successRate || 0,
        avgLatency:
          metrics.avgLatency !== undefined
            ? ((currentMetrics.avgLatency || 0) * (totalUsage - 1) +
                metrics.avgLatency) /
              totalUsage
            : currentMetrics.avgLatency || 0,
        totalUsage,
      };

      // Update metrics
      await this.prisma.$executeRaw`
        UPDATE prompt_templates
        SET performance_metrics = ${JSON.stringify(updatedMetrics)}::jsonb,
            updated_at = NOW()
        WHERE id = ${promptId}
      `;

      this.logger.debug(
        `Updated performance metrics for prompt ${promptId}`,
      );
    } catch (error) {
      this.logger.error(
        `Error tracking performance for prompt ${promptId}:`,
        error.stack,
      );
      // Don't throw - tracking failures shouldn't break the system
    }
  }

  /**
   * Get all versions of a prompt
   * @param intentType - The intent type
   * @returns Array of prompt templates
   */
  async getPromptHistory(intentType: string): Promise<PromptTemplate[]> {
    try {
      const prompts = await this.prisma.$queryRaw<any[]>`
        SELECT 
          id,
          version,
          intent_type as "intentType",
          system_prompt as "systemPrompt",
          user_prompt_template as "userPromptTemplate",
          created_at as "createdAt",
          updated_at as "updatedAt",
          active,
          performance_metrics as "performanceMetrics"
        FROM prompt_templates
        WHERE intent_type = ${intentType}
        ORDER BY version DESC
      `;

      return prompts as PromptTemplate[];
    } catch (error) {
      this.logger.error(
        `Error retrieving prompt history for ${intentType}:`,
        error.stack,
      );
      return [];
    }
  }

  /**
   * Get default fallback prompt
   * @param intentType - The intent type
   * @returns A default prompt template
   */
  private getDefaultPrompt(intentType: string): PromptTemplate {
    const defaultPrompt = `You are a financial analyst assistant specializing in SEC filings analysis.

Your role:
- Provide accurate, data-driven answers to financial questions
- Cite specific metrics and narrative context from SEC filings
- Explain financial trends and relationships clearly
- Maintain professional, objective tone

CRITICAL ACCURACY RULES:
1. ONLY use information from the provided context - never mix companies
2. If information is not in the context, say "I don't have that information in the provided filings"
3. Always cite the specific section and filing date for your information`;

    return {
      id: 'default',
      version: 0,
      intentType,
      systemPrompt: defaultPrompt,
      createdAt: new Date(),
      updatedAt: new Date(),
      active: true,
    };
  }

  /**
   * Clear the prompt cache (useful for testing or manual refresh)
   */
  clearCache(): void {
    this.promptCache.clear();
    this.logger.log('Prompt cache cleared');
  }
}
