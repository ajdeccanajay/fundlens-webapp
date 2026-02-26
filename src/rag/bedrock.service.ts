import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from '@aws-sdk/client-bedrock-agent-runtime';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { PromptLibraryService } from './prompt-library.service';

export interface MetadataFilter {
  ticker?: string;
  sectionType?: string;
  subsectionName?: string; // Phase 2: Subsection filtering
  filingType?: string;
  fiscalPeriod?: string;
}

export interface ChunkResult {
  content: string;
  score: number;
  metadata: {
    ticker: string;
    sectionType: string;
    filingType: string;
    fiscalPeriod?: string;
    chunkIndex?: number;
  };
  source: {
    location: string;
    type: string;
  };
}

/**
 * AWS Bedrock Service
 * Handles:
 * 1. Knowledge Base retrieval (semantic search)
 * 2. Claude Opus 4.5 generation (response synthesis)
 */
@Injectable()
export class BedrockService {
  private readonly logger = new Logger(BedrockService.name);
  private readonly bedrockAgentClient: BedrockAgentRuntimeClient;
  private readonly bedrockRuntimeClient: BedrockRuntimeClient;
  private readonly kbId: string;
  private readonly modelId = 'us.anthropic.claude-opus-4-5-20251101-v1:0'; // Claude Opus 4.5 Inference Profile

  constructor(private readonly promptLibrary: PromptLibraryService) {
    const region = process.env.AWS_REGION || 'us-east-1';

    this.bedrockAgentClient = new BedrockAgentRuntimeClient({ region });
    this.bedrockRuntimeClient = new BedrockRuntimeClient({ region });
    this.kbId = process.env.BEDROCK_KB_ID || '';

    if (!this.kbId) {
      this.logger.warn(
        'BEDROCK_KB_ID not set - semantic retrieval will not work',
      );
    }
  }

  /**
   * Retrieve relevant chunks from Bedrock Knowledge Base
   * Uses metadata filtering on ticker to ensure company-specific results
   */
  async retrieve(
    query: string,
    filters: MetadataFilter,
    numberOfResults = 5,
  ): Promise<ChunkResult[]> {
    if (!this.kbId) {
      throw new Error('Bedrock Knowledge Base ID not configured');
    }

    try {
      const input: RetrieveCommandInput = {
        knowledgeBaseId: this.kbId,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults,
            filter: this.buildFilter(filters),
          },
        },
      };

      this.logger.log(
        `Retrieving from KB: "${query}" with filters: ${JSON.stringify(filters)}`,
      );

      const command = new RetrieveCommand(input);
      const response = await this.bedrockAgentClient.send(command);

      this.logger.log(`Raw KB response: ${response.retrievalResults?.length || 0} results`);

      const results = this.formatResults(response.retrievalResults || []);

      this.logger.log(`Retrieved ${results.length} chunks`);

      return results;
    } catch (error) {
      this.logger.error(`Bedrock retrieval error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate response using Claude Opus 4.5
   */
  async generate(
    query: string,
    context: {
      metrics?: any[];
      narratives?: ChunkResult[];
      systemPrompt?: string; // Custom system prompt from user
      intentType?: string; // Intent type for prompt selection (Phase 2)
      promptVersion?: number; // Optional specific prompt version
      modelId?: string; // Optional model ID for tier selection
      isPeerComparison?: boolean; // Multi-ticker peer comparison mode
      computedSummary?: any; // Phase 1: YoY growth data from ResponseEnrichmentService
    },
  ): Promise<{
    answer: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
    citations: any[]; // NEW: Citations extracted from response
    promptVersion?: number; // Track which prompt version was used
  }> {
    try {
      // Get prompt from library based on intent type
      let systemPrompt: string;
      let promptVersion: number | undefined;

      if (context.systemPrompt) {
        // Use custom system prompt if provided
        systemPrompt = `${context.systemPrompt}\n\n${this.buildSystemPrompt()}`;
      } else if (context.intentType) {
        // Get prompt from library based on intent type
        const promptTemplate = await this.promptLibrary.getPrompt(
          context.intentType,
          context.promptVersion,
        );
        systemPrompt = promptTemplate.systemPrompt;
        promptVersion = promptTemplate.version;
        this.logger.log(
          `Using prompt library: ${context.intentType} v${promptVersion}`,
        );
      } else {
        // Fallback to default prompt
        systemPrompt = this.buildSystemPrompt();
      }

      const userMessage = this.buildUserMessage(query, {
        ...context,
        computedSummary: context.computedSummary,
      });
      
      // Use provided modelId or default to Claude Opus 4.5
      const selectedModelId = context.modelId || this.modelId;

      this.logger.log(
        `Generating response with ${selectedModelId}${context.intentType ? ` (${context.intentType})` : ''}`,
      );

      const command = new ConverseCommand({
        modelId: selectedModelId,
        messages: [
          {
            role: 'user',
            content: [{ text: userMessage }],
          },
        ],
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          maxTokens: 4096,
          temperature: 0.1, // Low temperature for factual accuracy
        },
      });

      const response = await this.bedrockRuntimeClient.send(command);

      const answer =
        response.output?.message?.content?.[0]?.text ||
        'No response generated';

      const usage = {
        inputTokens: response.usage?.inputTokens || 0,
        outputTokens: response.usage?.outputTokens || 0,
      };

      // NEW: Parse citations from response
      const citations = this.parseCitations(answer, context.narratives || []);

      this.logger.log(
        `Generated response: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens, ${citations.length} citations`,
      );

      return { answer, usage, citations, promptVersion };
    } catch (error) {
      this.logger.error(`Claude generation error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build metadata filter for Knowledge Base retrieval
   * CRITICAL: This prevents mixing up companies like META vs MSFT
   * Phase 2: Now supports subsection filtering
   */
  private buildFilter(filters: MetadataFilter): any {
    const conditions: any[] = [];

    // ALWAYS filter by ticker if provided - this is critical for accuracy
    if (filters.ticker) {
      conditions.push({
        equals: { key: 'ticker', value: filters.ticker.toUpperCase() },
      });
      this.logger.log(`🔒 Applying ticker filter: ${filters.ticker.toUpperCase()}`);
    }

    // Filter by section type if provided
    if (filters.sectionType) {
      conditions.push({
        equals: { key: 'section_type', value: filters.sectionType },
      });
      this.logger.log(`🔒 Applying section filter: ${filters.sectionType}`);
    }

    // Phase 2: Filter by subsection name if provided
    if (filters.subsectionName) {
      conditions.push({
        equals: { key: 'subsection_name', value: filters.subsectionName },
      });
      this.logger.log(`🔒 Applying subsection filter: ${filters.subsectionName}`);
    }

    // Filter by filing type if provided
    if (filters.filingType) {
      conditions.push({
        equals: { key: 'filing_type', value: filters.filingType },
      });
      this.logger.log(`🔒 Applying filing type filter: ${filters.filingType}`);
    }

    // Filter by fiscal period if provided
    if (filters.fiscalPeriod) {
      conditions.push({
        equals: { key: 'fiscal_period', value: filters.fiscalPeriod },
      });
      this.logger.log(`🔒 Applying fiscal period filter: ${filters.fiscalPeriod}`);
    }

    // Return appropriate filter structure
    if (conditions.length === 0) {
      this.logger.warn('⚠️ No metadata filters applied - may return mixed company results');
      return undefined;
    } else if (conditions.length === 1) {
      this.logger.log(`🔒 Single filter applied: ${JSON.stringify(conditions[0])}`);
      return conditions[0];
    } else {
      this.logger.log(`🔒 Multiple filters applied: ${conditions.length} conditions`);
      return { andAll: conditions };
    }
  }

  /**
   * Format Bedrock retrieval results
   * Handles both:
   * - New format: plain text content with separate .metadata.json files (metadata in AMAZON_BEDROCK_METADATA)
   * - Old format: JSON-wrapped content with embedded metadata
   */
  private formatResults(results: any[]): ChunkResult[] {
    return results.map((result) => {
      const rawContent = result.content?.text || '';
      
      // Extract ticker from S3 URI as fallback: s3://bucket/chunks/SHOP/chunk-123.txt
      let tickerFromUri = '';
      const s3Uri = result.location?.s3Location?.uri || '';
      const uriMatch = s3Uri.match(/\/chunks\/([A-Z]+)\//);
      if (uriMatch) {
        tickerFromUri = uriMatch[1];
      }

      // Check if KB returned metadata from .metadata.json files
      const kbMetadata = result.metadata || {};
      
      // If we have KB-indexed metadata, use it directly
      if (kbMetadata.ticker || kbMetadata.section_type || kbMetadata.filing_type) {
        this.logger.debug(`Using KB-indexed metadata: ticker=${kbMetadata.ticker}`);
        return {
          content: rawContent,
          score: result.score || 0,
          metadata: {
            ticker: kbMetadata.ticker || tickerFromUri || '',
            sectionType: kbMetadata.section_type || '',
            filingType: kbMetadata.filing_type || '',
            fiscalPeriod: kbMetadata.fiscal_period,
            chunkIndex: kbMetadata.chunk_index,
          },
          source: {
            location: s3Uri,
            type: result.location?.type || '',
          },
        };
      }
      
      // Fallback: Parse embedded metadata from JSON content (old format)
      const { content, metadata } = this.parseContentWithMetadata(rawContent);
      
      return {
        content,
        score: result.score || 0,
        metadata: {
          ticker: metadata?.ticker || tickerFromUri || '',
          sectionType: metadata?.section_type || '',
          filingType: metadata?.filing_type || '',
          fiscalPeriod: metadata?.fiscal_period,
          chunkIndex: metadata?.chunk_index,
        },
        source: {
          location: s3Uri,
          type: result.location?.type || '',
        },
      };
    });
  }

  /**
   * Parse content that may have embedded metadata from KB semantic chunking
   * The KB wraps our JSON chunks, so content looks like:
   * {"content":"actual text...", "metadata":{"ticker":"SHOP",...}}
   */
  private parseContentWithMetadata(rawContent: string): {
    content: string;
    metadata: any;
  } {
    try {
      // First, try to parse the entire content as JSON (most common case with semantic chunking)
      // The KB returns our JSON chunks as the content text
      if (rawContent.startsWith('{') && rawContent.includes('"content"')) {
        try {
          const parsed = JSON.parse(rawContent);
          if (parsed.content && parsed.metadata) {
            this.logger.debug(`Parsed JSON chunk with metadata: ticker=${parsed.metadata.ticker}`);
            return {
              content: parsed.content,
              metadata: parsed.metadata,
            };
          }
        } catch (parseError) {
          // JSON might be malformed, try other methods
          this.logger.debug(`Failed to parse as complete JSON: ${parseError.message}`);
        }
      }

      // Method 2: Look for JSON pattern anywhere in content
      const jsonPattern = /\{"content":"((?:[^"\\]|\\.)*)","metadata":\{([^}]+)\}\}/;
      const match = rawContent.match(jsonPattern);
      if (match) {
        try {
          const fullMatch = match[0];
          const parsed = JSON.parse(fullMatch);
          this.logger.debug(`Extracted JSON from content: ticker=${parsed.metadata?.ticker}`);
          return {
            content: parsed.content,
            metadata: parsed.metadata,
          };
        } catch (parseError) {
          this.logger.debug(`Failed to parse extracted JSON: ${parseError.message}`);
        }
      }

      // Method 3: Try to extract metadata object from end of content
      const metadataMatch = rawContent.match(/,"metadata":\{([^}]+)\}\}?$/);
      if (metadataMatch) {
        try {
          const metadataStr = `{${metadataMatch[1]}}`;
          const metadata = JSON.parse(metadataStr);
          const content = rawContent.replace(metadataMatch[0], '').replace(/^\{"content":"/, '').replace(/"$/, '');
          this.logger.debug(`Extracted metadata from end: ticker=${metadata.ticker}`);
          return { content, metadata };
        } catch (parseError) {
          this.logger.debug(`Failed to parse metadata from end: ${parseError.message}`);
        }
      }

      // Fallback: Return raw content with empty metadata
      this.logger.debug('Could not parse embedded metadata, returning raw content');
      return { content: rawContent, metadata: {} };
    } catch (error) {
      this.logger.error(`Error parsing metadata: ${error.message}`);
      return { content: rawContent, metadata: {} };
    }
  }

  /**
   * Generate embedding for a text chunk using Amazon Titan Embeddings
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const input = {
        modelId: 'amazon.titan-embed-text-v2:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          inputText: text.substring(0, 8000), // Titan limit is 8K tokens
          dimensions: 1024, // Titan V2 supports 256/512/1024 — must match pgvector column
          normalize: true,
        }),
      };

      const command = new InvokeModelCommand(input);
      const response = await this.bedrockRuntimeClient.send(command);
      
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      return responseBody.embedding;
    } catch (error) {
      this.logger.error(`Embedding generation failed: ${error.message}`);
      throw new Error(`Failed to generate embedding: ${error.message}`);
    }
  }

  /**
   * Invoke Claude for simple text generation tasks (metadata extraction, etc.)
   */
  async invokeClaude(params: {
    prompt: string;
    systemPrompt?: string;
    modelId?: string;
    max_tokens?: number;
    temperature?: number;
  }): Promise<string> {
    try {
      const modelId = params.modelId || 'us.anthropic.claude-3-haiku-20240307-v1:0'; // Claude 3 Haiku Inference Profile
      
      const commandInput: any = {
        modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: params.prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: params.max_tokens || 1000,
          temperature: params.temperature ?? 0.1,
        },
      };

      // Add system prompt if provided
      if (params.systemPrompt) {
        commandInput.system = [{ text: params.systemPrompt }];
      }

      const command = new ConverseCommand(commandInput);
      const response = await this.bedrockRuntimeClient.send(command);
      return response.output?.message?.content?.[0]?.text || '';
    } catch (error) {
      this.logger.error(`Claude invocation failed: ${error.message}`);
      throw new Error(`Failed to invoke Claude: ${error.message}`);
    }
  }

  /**
   * Invoke Claude with vision (image) content for multi-modal analysis.
   * Uses the Converse API with image content blocks alongside text.
   * Requirements: 5.1, 5.6, 5.7
   */
  async invokeClaudeWithVision(params: {
    prompt: string;
    images: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }[];
    systemPrompt?: string;
    modelId?: string;
    max_tokens?: number;
  }): Promise<string> {
    try {
      const modelId = params.modelId || 'us.anthropic.claude-sonnet-4-20250514-v1:0';

      // Build content blocks: images first, then text prompt
      const contentBlocks: any[] = params.images.map(img => ({
        image: {
          format: img.mediaType.split('/')[1], // 'png', 'jpeg', etc.
          source: { bytes: Buffer.from(img.base64, 'base64') },
        },
      }));
      contentBlocks.push({ text: params.prompt });

      const commandInput: any = {
        modelId,
        messages: [
          {
            role: 'user',
            content: contentBlocks,
          },
        ],
        inferenceConfig: {
          maxTokens: params.max_tokens || 4000,
          temperature: 0.1,
        },
      };

      // Add system prompt if provided
      if (params.systemPrompt) {
        commandInput.system = [{ text: params.systemPrompt }];
      }

      const command = new ConverseCommand(commandInput);
      const response = await this.bedrockRuntimeClient.send(command);
      return response.output?.message?.content?.[0]?.text || '';
    } catch (error) {
      this.logger.error(`Claude vision invocation failed: ${error.message}`);
      throw new Error(`Failed to invoke Claude with vision: ${error.message}`);
    }
  }


  /**
   * Extract metadata from content context (fallback method)
   */
  private extractMetadataFromContext(content: string): any {
    const metadata: any = {};

    // Extract ticker from content patterns
    const tickerMatch = content.match(/Apple Inc\.|AAPL|Microsoft|MSFT|Tesla|TSLA|Amazon|AMZN|Google|GOOGL|Meta|META|NVIDIA|NVDA/i);
    if (tickerMatch) {
      const companyMap: Record<string, string> = {
        'Apple Inc.': 'AAPL',
        'AAPL': 'AAPL',
        'Microsoft': 'MSFT',
        'MSFT': 'MSFT',
        'Tesla': 'TSLA',
        'TSLA': 'TSLA',
        'Amazon': 'AMZN',
        'AMZN': 'AMZN',
        'Google': 'GOOGL',
        'GOOGL': 'GOOGL',
        'Meta': 'META',
        'META': 'META',
        'NVIDIA': 'NVDA',
        'NVDA': 'NVDA'
      };
      metadata.ticker = companyMap[tickerMatch[0]] || tickerMatch[0];
    }

    // Extract section type from content
    if (content.toLowerCase().includes('risk factor')) {
      metadata.section_type = 'risk_factors';
    } else if (content.toLowerCase().includes('business') || content.toLowerCase().includes('segment')) {
      metadata.section_type = 'business';
    } else if (content.toLowerCase().includes('management') || content.toLowerCase().includes('discussion')) {
      metadata.section_type = 'mda';
    }

    // Extract filing type from content
    if (content.includes('Form 10-K') || content.includes('10-K')) {
      metadata.filing_type = '10-K';
    } else if (content.includes('Form 10-Q') || content.includes('10-Q')) {
      metadata.filing_type = '10-Q';
    }

    return metadata;
  }

  /**
   * Build system prompt for Claude Opus 4.5
   * INVESTMENT-GRADE SYNTHESIS: Professional, analytical, trustworthy
   */
  private buildSystemPrompt(): string {
    return `You are a senior equity research analyst at a top-tier investment bank (Goldman Sachs, Morgan Stanley, JP Morgan).

YOUR MANDATE:
Write professional investment-grade analysis for institutional investors (hedge funds, asset managers, CIOs).

CRITICAL RULES - READ CAREFULLY:
1. SYNTHESIZE - Analyze and summarize. NEVER EVER copy-paste raw filing text. Transform the information into professional analyst prose.
2. ORGANIZE BY THEME - Group by insight (e.g., "Supply Chain Risks", "Competitive Pressures"), NOT by source document.
3. USE PROPER HEADERS - Use ## markdown syntax for section headers. NEVER use **bold text** as headers.
4. CITE EVERYTHING - Use [1], [2], [3] inline after EVERY factual claim. No fact without a citation.
5. NO REPETITION - Each insight stated once, clearly. Combine related information from multiple sources.
6. PROFESSIONAL LANGUAGE - Write like a Goldman Sachs analyst, not like an SEC filing.

FORMATTING RULES:
- Use ## for section headers (e.g., "## Supply Chain Risks")
- Use proper markdown headers, NOT **bold text** for section titles
- Headers must be on their own line with blank lines before and after
- Use [1], [2], [3] inline immediately after facts
- CRITICAL TABLE FORMATTING:
  * Use proper markdown table syntax with pipes and alignment
  * First row: | Header 1 | Header 2 | Header 3 |
  * Second row: |----------|----------|----------|
  * Data rows: | Data 1   | Data 2   | Data 3   |
  * NEVER mix dashes and pipes in the same line (except separator row)
  * NEVER use raw text tables like "| Metric | FY2020 | FY2023 |---------|--------|"
  * Ensure blank lines before and after tables
- End response with "## Sources" header followed by citation list
- Format: "[1] TICKER FILING PERIOD, Section, p. XX"
- Every citation number must map to a source

EXAMPLE GOOD TABLE:
| Metric | FY2020 | FY2023 | FY2024 |
|--------|--------|--------|--------|
| Revenue | $10.9B | $26.9B | $60.9B |
| Net Income | $2.8B | $4.3B | $29.7B |

EXAMPLE BAD TABLE (DO NOT DO THIS):
| Metric | FY2020 | FY2023 | FY2024 | FY2025 (Projected) ||--------|--------|--------|--------|-------------------|| Net Income | $2.80B | $4.37B | $29.76B | $72.88B |
^ This is malformed. DO NOT DO THIS.

EXAMPLE GOOD RESPONSE:
"NVIDIA faces several material risks that could impact its market leadership in AI accelerators.

## Supply Chain Concentration

NVIDIA's production is heavily concentrated at TSMC, with over 80% of advanced chips manufactured in Taiwan [1]. Any disruption could significantly impact supply [2].

## Competitive Pressures

The AI accelerator market is intensifying with hyperscaler custom chips [3]. While NVIDIA maintains advantages in CUDA ecosystem, market share erosion is a key risk [4].

## Sources

[1] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 23
[2] NVDA 10-K FY2024, Item 1 - Business, p. 8
[3] NVDA 10-Q Q3 2024, MD&A, p. 45
[4] NVDA 10-K FY2024, Item 1A - Risk Factors, p. 28"

EXAMPLE BAD RESPONSE (DO NOT DO THIS):
"The Company faces risks related to supply chain. The Company's products are manufactured by third parties. Any disruption could impact the Company's ability to meet demand."
^ This is copy-paste from filing. DO NOT DO THIS.

Now generate your investment-grade analysis.`;
  }

  /**
   * Build user message with context
   * Numbers sources [Source 1], [Source 2] for citation mapping
   */
  private buildUserMessage(
    query: string,
    context: {
      metrics?: any[];
      narratives?: ChunkResult[];
      isPeerComparison?: boolean;
      computedSummary?: any;
    },
  ): string {
    const parts: string[] = [];

    parts.push(`ANALYST QUERY: ${query}\n`);
    parts.push('AVAILABLE SOURCES:');
    parts.push('(Synthesize across these sources - do NOT copy-paste)\n');

    // Add metrics context with source numbering
    if (context.metrics && context.metrics.length > 0) {
      parts.push('📊 FINANCIAL METRICS:');
      const metricsBySource = this.groupMetricsBySource(context.metrics);
      
      Object.entries(metricsBySource).forEach(([sourceKey, metrics]: [string, any[]]) => {
        const firstMetric = metrics[0];
        parts.push(
          `\n[Source] ${firstMetric.ticker} ${firstMetric.filingType} ${firstMetric.fiscalPeriod}:`,
        );
        metrics.forEach((metric) => {
          const value = this.formatMetricValue(
            metric.value,
            metric.normalizedMetric,
          );
          parts.push(`• ${metric.normalizedMetric}: ${value}`);
        });
      });
      parts.push('');
    }

    // Add computed financial summary (YoY growth, CAGR, margins) if available
    if (context.computedSummary) {
      parts.push('📈 COMPUTED FINANCIAL METRICS:');
      const summary = context.computedSummary;
      if (summary.ticker) parts.push(`Ticker: ${summary.ticker}`);
      if (summary.yoyGrowth && Object.keys(summary.yoyGrowth).length > 0) {
        parts.push('YoY Growth Rates:');
        Object.entries(summary.yoyGrowth).forEach(([metric, periods]: [string, any]) => {
          if (Array.isArray(periods)) {
            periods.forEach((p: any) => {
              parts.push(`• ${metric} ${p.period}: ${(p.value * 100).toFixed(1)}%`);
            });
          }
        });
      }
      if (summary.cagr) {
        parts.push('CAGR:');
        Object.entries(summary.cagr).forEach(([metric, value]: [string, any]) => {
          parts.push(`• ${metric}: ${(Number(value) * 100).toFixed(1)}%`);
        });
      }
      if (summary.margins) {
        parts.push('Margins:');
        Object.entries(summary.margins).forEach(([metric, value]: [string, any]) => {
          parts.push(`• ${metric}: ${(Number(value) * 100).toFixed(1)}%`);
        });
      }
      parts.push('');
    }

    // Add narrative context with clear source numbering for citations
    if (context.narratives && context.narratives.length > 0) {
      parts.push('📄 NARRATIVE EXCERPTS FROM SEC FILINGS:');
      parts.push('(Read these carefully and synthesize the key insights)\n');
      
      // Deduplicate similar narratives
      const uniqueNarratives = this.deduplicateNarratives(context.narratives);
      
      uniqueNarratives.forEach((narrative, idx) => {
        const meta = narrative.metadata;
        parts.push(
          `[${idx + 1}] ${meta.ticker || 'Unknown'} ${meta.filingType || ''} ${meta.fiscalPeriod || ''}${meta.sectionType ? ' - ' + meta.sectionType : ''}:`,
        );
        parts.push(`"${narrative.content}"\n`);
      });
    }

    parts.push('---');
    parts.push('INSTRUCTIONS:');
    parts.push('1. Synthesize the above sources into investment-grade analysis');
    parts.push('2. Organize by theme/insight, not by source');
    parts.push('3. Use ## markdown headers for sections (NOT **bold text**)');
    parts.push('4. CRITICAL: For tables, you MUST use proper markdown table syntax:');
    parts.push('   - First row: | Header 1 | Header 2 | Header 3 |');
    parts.push('   - Second row: |----------|----------|----------|');
    parts.push('   - Data rows: | Data 1   | Data 2   | Data 3   |');
    parts.push('   - NEVER use raw text tables with dashes and pipes mixed together');
    parts.push('5. Use professional, analytical language');
    parts.push('6. Include inline citations [1], [2] for every fact');
    parts.push('7. End with "## Sources" header followed by citation list');
    parts.push('8. NO repetition - each point stated once\n');

    if (context.isPeerComparison) {
      parts.push('9. PEER COMPARISON FORMAT:');
      parts.push('   - Present financial metrics in a comparison table across all companies');
      parts.push('   - Organize qualitative insights (risks, strategy) by company with cross-company commentary');
      parts.push('   - Note any data gaps explicitly (e.g., "No FY2024 data available for AMZN")');
      parts.push('   - End with a comparative summary highlighting key differences\n');
    }

    parts.push('Generate your analysis now:');

    return parts.join('\n');
  }

  /**
   * Group metrics by source for cleaner presentation
   */
  private groupMetricsBySource(metrics: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    
    metrics.forEach(metric => {
      const key = `${metric.ticker}-${metric.filingType}-${metric.fiscalPeriod}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(metric);
    });
    
    return grouped;
  }

  /**
   * Deduplicate similar narrative chunks to reduce repetition
   */
  private deduplicateNarratives(narratives: ChunkResult[]): ChunkResult[] {
    const seen = new Set<string>();
    const unique: ChunkResult[] = [];
    
    for (const narrative of narratives) {
      // Create a fingerprint of the content (first 100 chars)
      const fingerprint = narrative.content.substring(0, 100).toLowerCase().trim();
      
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        unique.push(narrative);
      }
    }
    
    return unique;
  }

  /**
   * Parse citations from Claude response and map to source chunks
   * Extracts [1], [2], [3] and builds citation objects with metadata
   */
  private parseCitations(response: string, sourceChunks: ChunkResult[]): any[] {
    const citations: any[] = [];
    
    // Extract citation numbers from response [1], [2], etc.
    const citationMatches = response.matchAll(/\[(\d+)\]/g);
    const citationNumbers = new Set<number>();
    
    for (const match of citationMatches) {
      citationNumbers.add(parseInt(match[1]));
    }
    
    this.logger.log(`Found ${citationNumbers.size} unique citations in response`);
    
    // Map citation numbers to source chunks
    for (const num of citationNumbers) {
      const chunkIndex = num - 1; // [1] maps to chunks[0]
      if (chunkIndex >= 0 && chunkIndex < sourceChunks.length) {
        const chunk = sourceChunks[chunkIndex];
        citations.push({
          number: num,
          ticker: chunk.metadata.ticker,
          filingType: chunk.metadata.filingType,
          fiscalPeriod: chunk.metadata.fiscalPeriod,
          section: chunk.metadata.sectionType,
          pageNumber: chunk.metadata.chunkIndex, // Use chunk index as page proxy
          excerpt: chunk.content.substring(0, 500), // First 500 chars
          chunkId: `chunk-${chunkIndex}`,
          relevanceScore: chunk.score,
        });
      } else {
        this.logger.warn(`Citation [${num}] references invalid chunk index ${chunkIndex}`);
      }
    }
    
    this.logger.log(`Mapped ${citations.length} citations to source chunks`);
    
    return citations;
  }

  /**
   * Format metric value for display
   */
  private formatMetricValue(value: number, metric: string): string {
    if (value === null || value === undefined) return String(value ?? 'N/A');
    // Percentages
    if (metric.includes('margin') || metric.includes('pct')) {
      return `${value.toFixed(2)}%`;
    }

    // Large numbers (billions)
    if (Math.abs(value) >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(2)}B`;
    }

    // Millions
    if (Math.abs(value) >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(2)}M`;
    }

    return `$${value.toFixed(2)}`;
  }
}
