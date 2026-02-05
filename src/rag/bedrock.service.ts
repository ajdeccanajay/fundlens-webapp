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
    },
  ): Promise<{
    answer: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
    };
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

      const userMessage = this.buildUserMessage(query, context);

      this.logger.log(
        `Generating response with Claude Opus 4.5${context.intentType ? ` (${context.intentType})` : ''}`,
      );

      const command = new ConverseCommand({
        modelId: this.modelId,
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

      this.logger.log(
        `Generated response: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens`,
      );

      return { answer, usage, promptVersion };
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
    modelId?: string;
    max_tokens?: number;
  }): Promise<string> {
    try {
      const modelId = params.modelId || 'us.anthropic.claude-3-haiku-20240307-v1:0'; // Claude 3 Haiku Inference Profile
      
      const command = new ConverseCommand({
        modelId,
        messages: [
          {
            role: 'user',
            content: [{ text: params.prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: params.max_tokens || 1000,
          temperature: 0.1,
        },
      });

      const response = await this.bedrockRuntimeClient.send(command);
      return response.output?.message?.content?.[0]?.text || '';
    } catch (error) {
      this.logger.error(`Claude invocation failed: ${error.message}`);
      throw new Error(`Failed to invoke Claude: ${error.message}`);
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
   */
  private buildSystemPrompt(): string {
    return `You are a financial analyst assistant specializing in SEC filings analysis.

Your role:
- Provide accurate, data-driven answers to financial questions
- Cite specific metrics and narrative context from SEC filings
- Explain financial trends and relationships clearly
- Maintain professional, objective tone

CRITICAL ACCURACY RULES:
1. ONLY use information from the provided context - never mix companies
2. If asked about Apple (AAPL), ONLY use AAPL data - never include Microsoft, Meta, etc.
3. If asked about Microsoft (MSFT), ONLY use MSFT data - never include Apple, Google, etc.
4. VERIFY ticker symbols in all data before using it in your response
5. If context contains mixed company data, explicitly filter to only the requested company

Guidelines:
1. ACCURACY: Only use information from provided context for the specific company requested
2. CITATIONS: Reference specific filings and sections with ticker symbols
3. CLARITY: Explain complex financial concepts simply
4. COMPLETENESS: Address all parts of the question for the requested company only
5. HONESTY: Say "I don't have that information" if context is insufficient for the specific company

Format:
- Start with direct answer for the specific company requested
- Support with specific data points from that company only
- Provide relevant context from narratives for that company only
- End with sources/citations including ticker symbols`;
  }

  /**
   * Build user message with context
   */
  private buildUserMessage(
    query: string,
    context: {
      metrics?: any[];
      narratives?: ChunkResult[];
    },
  ): string {
    const parts: string[] = [];

    parts.push(`Question: ${query}\n`);

    // Add metrics context
    if (context.metrics && context.metrics.length > 0) {
      parts.push('\n=== STRUCTURED METRICS ===');
      for (const metric of context.metrics) {
        const value = this.formatMetricValue(
          metric.value,
          metric.normalizedMetric,
        );
        parts.push(
          `${metric.ticker} - ${metric.normalizedMetric}: ${value} (${metric.fiscalPeriod}, ${metric.filingType})`,
        );
        if (metric.formula) {
          parts.push(`  Formula: ${metric.formula}`);
        }
      }
    }

    // Add narrative context
    if (context.narratives && context.narratives.length > 0) {
      parts.push('\n=== NARRATIVE CONTEXT ===');
      for (let i = 0; i < context.narratives.length; i++) {
        const narrative = context.narratives[i];
        parts.push(
          `\n[Source ${i + 1}: ${narrative.metadata.ticker} ${narrative.metadata.filingType} - ${narrative.metadata.sectionType}]`,
        );
        parts.push(narrative.content);
      }
    }

    parts.push(
      '\n\nBased on the above context, please provide a comprehensive answer to the question.',
    );

    return parts.join('\n');
  }

  /**
   * Format metric value for display
   */
  private formatMetricValue(value: number, metric: string): string {
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
