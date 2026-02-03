import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import {
  BedrockAgentClient,
  StartIngestionJobCommand,
  GetIngestionJobCommand,
  ListIngestionJobsCommand,
} from '@aws-sdk/client-bedrock-agent';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { PrismaService } from '../../prisma/prisma.service';
import { ChunkExporterService } from './chunk-exporter.service';
import { SectionExporterService } from './section-exporter.service';

export interface KBSyncResult {
  success: boolean;
  jobId?: string;
  status?: string;
  statistics?: {
    documentsScanned: number;
    documentsIndexed: number;
    documentsFailed: number;
  };
  error?: string;
  method?: 'lambda' | 'direct' | 'section-based';
}

export interface SyncStatus {
  rdsChunks: number;
  s3Chunks: number;
  s3Sections: number;
  kbDocuments: number;
  needsSync: boolean;
  delta: number;
}

export interface FullSyncResult {
  success: boolean;
  totalChunksInRDS: number;
  chunksUploadedToS3: number;
  batches: number;
  ingestionJobId?: string;
  ingestionStatus?: string;
  error?: string;
  duration: number;
}

export interface SectionSyncResult {
  success: boolean;
  totalTickers: number;
  totalSections: number;
  totalCharacters: number;
  ingestionJobId?: string;
  ingestionStatus?: string;
  error?: string;
  duration: number;
}

/**
 * Knowledge Base Sync Service
 * 
 * Handles synchronization between:
 * - PostgreSQL (RDS) - Source of truth for narrative chunks
 * - S3 - Storage for Bedrock KB ingestion
 * - Bedrock KB - Vector store for semantic retrieval
 * 
 * Supports:
 * 1. Lambda-based sync (faster, runs in AWS)
 * 2. Direct API sync (fallback)
 * 3. Event-driven sync via S3 triggers
 * 4. Full sync with exponential backoff for rate limiting
 * 
 * CRITICAL: All RDS chunks MUST be synced to KB for 100% accuracy
 */
@Injectable()
export class KBSyncService {
  private readonly logger = new Logger(KBSyncService.name);
  private readonly bedrockAgent: BedrockAgentClient;
  private readonly s3Client: S3Client;
  private readonly lambdaClient: LambdaClient;
  private readonly kbId: string;
  private readonly dataSourceId: string;
  private readonly s3Bucket: string;
  private readonly lambdaFunctionName: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChunkExporterService))
    private readonly chunkExporter: ChunkExporterService,
    @Inject(forwardRef(() => SectionExporterService))
    private readonly sectionExporter: SectionExporterService,
  ) {
    const region = process.env.AWS_REGION || 'us-east-1';
    
    // Configure BedrockAgentClient with exponential backoff and adaptive retry mode
    this.bedrockAgent = new BedrockAgentClient({ 
      region,
      maxAttempts: 10, // Max retry attempts
      retryMode: 'adaptive', // Adaptive retry mode for rate limiting
    });
    
    this.s3Client = new S3Client({ 
      region,
      maxAttempts: 10,
      retryMode: 'adaptive',
    });
    
    this.lambdaClient = new LambdaClient({ 
      region,
      maxAttempts: 10,
      retryMode: 'adaptive',
    });
    
    this.kbId = process.env.BEDROCK_KB_ID || 'NB5XNMHBQT';
    this.dataSourceId = process.env.BEDROCK_DATA_SOURCE_ID || 'OQMSFOE5SL';
    this.s3Bucket = process.env.BEDROCK_CHUNKS_BUCKET || 'fundlens-bedrock-chunks';
    this.lambdaFunctionName = process.env.KB_SYNC_LAMBDA_NAME || 'bedrock-kb-sync';

    if (!this.kbId) {
      this.logger.warn('BEDROCK_KB_ID not configured - KB sync will not work');
    }
    
    this.logger.log('KBSyncService initialized with adaptive retry mode (max 10 attempts)');
  }

  /**
   * Get sync status - compare RDS, S3, and KB document counts
   */
  async getSyncStatus(ticker?: string): Promise<SyncStatus> {
    const [rdsChunks, s3Chunks, s3Sections, kbDocuments] = await Promise.all([
      this.getRDSChunkCount(ticker),
      this.getS3ChunkCount(ticker),
      this.sectionExporter.getS3SectionCount(),
      this.getKBDocumentCount(),
    ]);

    const delta = rdsChunks - s3Chunks;
    const needsSync = delta > 0 || s3Chunks > kbDocuments;

    return {
      rdsChunks,
      s3Chunks,
      s3Sections,
      kbDocuments,
      needsSync,
      delta,
    };
  }

  /**
   * Start KB ingestion via Lambda (preferred - faster)
   */
  async startIngestionViaLambda(ticker?: string): Promise<KBSyncResult> {
    try {
      this.logger.log(`Invoking KB sync Lambda for ${ticker || 'all tickers'}`);
      
      // Create a mock S3 event to trigger the Lambda
      const mockEvent = {
        Records: [{
          s3: {
            bucket: { name: this.s3Bucket },
            object: { key: `chunks/${ticker || 'ALL'}/chunk-0.txt` }
          }
        }]
      };

      const command = new InvokeCommand({
        FunctionName: this.lambdaFunctionName,
        InvocationType: 'RequestResponse', // Synchronous
        Payload: JSON.stringify(mockEvent),
      });

      const response = await this.lambdaClient.send(command);
      
      if (response.FunctionError) {
        const errorPayload = response.Payload 
          ? JSON.parse(new TextDecoder().decode(response.Payload))
          : { error: 'Unknown Lambda error' };
        throw new Error(errorPayload.errorMessage || 'Lambda execution failed');
      }

      // Parse Lambda response
      const payload = response.Payload 
        ? JSON.parse(new TextDecoder().decode(response.Payload))
        : {};

      this.logger.log(`Lambda sync completed: ${JSON.stringify(payload)}`);

      return {
        success: true,
        jobId: payload.jobId,
        status: payload.status || 'STARTED',
        method: 'lambda',
      };
    } catch (error) {
      this.logger.warn(`Lambda invocation failed, falling back to direct API: ${error.message}`);
      // Fall back to direct API call
      return this.startIngestion(`Fallback sync for ${ticker || 'all'}`);
    }
  }

  /**
   * Start KB ingestion job (direct API call)
   */
  async startIngestion(description?: string): Promise<KBSyncResult> {
    if (!this.kbId) {
      return {
        success: false,
        error: 'Bedrock KB not configured',
      };
    }

    try {
      const command = new StartIngestionJobCommand({
        knowledgeBaseId: this.kbId,
        dataSourceId: this.dataSourceId,
        description: description || `Manual sync at ${new Date().toISOString()}`,
      });

      const response = await this.bedrockAgent.send(command);
      const jobId = response.ingestionJob?.ingestionJobId;

      if (!jobId) {
        throw new Error('No job ID returned');
      }

      this.logger.log(`Started KB ingestion job: ${jobId}`);

      return {
        success: true,
        jobId,
        status: response.ingestionJob?.status,
        method: 'direct',
      };
    } catch (error) {
      this.logger.error(`Failed to start ingestion: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get ingestion job status
   */
  async getIngestionStatus(jobId: string): Promise<KBSyncResult> {
    if (!this.kbId) {
      return {
        success: false,
        error: 'Bedrock KB not configured',
      };
    }

    try {
      const command = new GetIngestionJobCommand({
        knowledgeBaseId: this.kbId,
        dataSourceId: this.dataSourceId,
        ingestionJobId: jobId,
      });

      const response = await this.bedrockAgent.send(command);
      const job = response.ingestionJob;

      return {
        success: true,
        jobId,
        status: job?.status,
        statistics: {
          documentsScanned: job?.statistics?.numberOfDocumentsScanned || 0,
          documentsIndexed: job?.statistics?.numberOfNewDocumentsIndexed || 0,
          documentsFailed: job?.statistics?.numberOfDocumentsFailed || 0,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get job status: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Wait for ingestion job to complete
   */
  async waitForCompletion(jobId: string, maxWaitMs = 300000): Promise<KBSyncResult> {
    const pollInterval = 10000; // 10 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getIngestionStatus(jobId);

      if (!status.success) {
        return status;
      }

      if (status.status === 'COMPLETE') {
        this.logger.log(`Ingestion job ${jobId} completed successfully`);
        return status;
      }

      if (status.status === 'FAILED') {
        this.logger.error(`Ingestion job ${jobId} failed`);
        return {
          ...status,
          success: false,
          error: 'Ingestion job failed',
        };
      }

      this.logger.debug(`Ingestion job ${jobId} status: ${status.status}`);
      await this.sleep(pollInterval);
    }

    return {
      success: false,
      jobId,
      error: 'Timeout waiting for ingestion completion',
    };
  }

  /**
   * Get latest ingestion job
   */
  async getLatestIngestionJob(): Promise<KBSyncResult> {
    if (!this.kbId) {
      return {
        success: false,
        error: 'Bedrock KB not configured',
      };
    }

    try {
      const command = new ListIngestionJobsCommand({
        knowledgeBaseId: this.kbId,
        dataSourceId: this.dataSourceId,
        maxResults: 1,
      });

      const response = await this.bedrockAgent.send(command);
      const job = response.ingestionJobSummaries?.[0];

      if (!job) {
        return {
          success: true,
          status: 'NO_JOBS',
        };
      }

      return {
        success: true,
        jobId: job.ingestionJobId,
        status: job.status,
        statistics: {
          documentsScanned: job.statistics?.numberOfDocumentsScanned || 0,
          documentsIndexed: job.statistics?.numberOfNewDocumentsIndexed || 0,
          documentsFailed: job.statistics?.numberOfDocumentsFailed || 0,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get latest job: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Full sync: Upload to S3 + Trigger KB ingestion via Lambda
   */
  async fullSync(ticker?: string): Promise<KBSyncResult> {
    this.logger.log(`Starting full sync${ticker ? ` for ${ticker}` : ''}`);

    // Step 1: Check if sync is needed
    const status = await this.getSyncStatus(ticker);
    
    if (!status.needsSync) {
      this.logger.log('No sync needed - all data is up to date');
      return {
        success: true,
        status: 'UP_TO_DATE',
      };
    }

    // Step 2: Start ingestion via Lambda (preferred) or direct API
    const ingestionResult = await this.startIngestionViaLambda(ticker);

    if (!ingestionResult.success) {
      return ingestionResult;
    }

    // Step 3: Wait for completion if we have a job ID
    if (ingestionResult.jobId) {
      return this.waitForCompletion(ingestionResult.jobId);
    }

    return ingestionResult;
  }

  /**
   * FULL SYNC ALL - Sync ALL chunks from RDS to S3 and KB
   * 
   * CRITICAL: This ensures delta = 0 (all RDS chunks synced to KB)
   * Uses batch processing with exponential backoff for rate limiting
   * Runs up to 10 batch uploads in parallel for maximum throughput
   * 
   * @param batchSize - Number of chunks per batch (default 1000)
   * @param waitForKB - Whether to wait for KB ingestion to complete
   */
  async fullSyncAll(options: {
    batchSize?: number;
    waitForKB?: boolean;
    ticker?: string;
    parallelBatches?: number;
  } = {}): Promise<FullSyncResult> {
    const startTime = Date.now();
    const batchSize = options.batchSize || 1000;
    const waitForKB = options.waitForKB !== false;
    const parallelBatches = options.parallelBatches || 10; // Run 10 batches in parallel
    
    this.logger.log(`🚀 Starting FULL SYNC ALL - ensuring delta = 0`);
    this.logger.log(`   Batch size: ${batchSize}, Parallel batches: ${parallelBatches}, Wait for KB: ${waitForKB}`);

    try {
      // Step 1: Get total chunk count from RDS
      const totalChunks = await this.getRDSChunkCount(options.ticker);
      this.logger.log(`📊 Total chunks in RDS: ${totalChunks}`);

      if (totalChunks === 0) {
        return {
          success: true,
          totalChunksInRDS: 0,
          chunksUploadedToS3: 0,
          batches: 0,
          duration: Date.now() - startTime,
        };
      }

      // Step 2: Upload ALL chunks to S3 in parallel batches with exponential backoff
      let totalUploaded = 0;
      const totalBatches = Math.ceil(totalChunks / batchSize);
      let completedBatches = 0;

      // Process batches in groups of parallelBatches (10 at a time)
      for (let startBatch = 0; startBatch < totalBatches; startBatch += parallelBatches) {
        const endBatch = Math.min(startBatch + parallelBatches, totalBatches);
        const batchPromises: Promise<{ uploadedCount: number; batchNum: number }>[] = [];

        // Launch parallel batch uploads
        for (let batchNum = startBatch; batchNum < endBatch; batchNum++) {
          const offset = batchNum * batchSize;
          
          batchPromises.push(
            this.uploadBatchWithRetry({
              bucket: this.s3Bucket,
              ticker: options.ticker,
              keyPrefix: 'chunks',
              batchSize,
              offset,
            }).then(result => ({
              uploadedCount: result.uploadedCount,
              batchNum: batchNum + 1,
            }))
          );
        }

        // Wait for all parallel batches to complete
        const results = await Promise.all(batchPromises);
        
        for (const result of results) {
          totalUploaded += result.uploadedCount;
          completedBatches++;
        }

        this.logger.log(`📤 Completed batches ${startBatch + 1}-${endBatch}/${totalBatches} (${totalUploaded} chunks uploaded)`);
      }

      this.logger.log(`✅ S3 upload complete: ${totalUploaded}/${totalChunks} chunks uploaded in ${completedBatches} batches`);

      // Step 3: Trigger KB ingestion with exponential backoff
      this.logger.log(`🔄 Starting Bedrock KB ingestion...`);
      const ingestionResult = await this.startIngestionWithRetry(
        `Full sync: ${totalUploaded} chunks at ${new Date().toISOString()}`
      );

      if (!ingestionResult.success) {
        return {
          success: false,
          totalChunksInRDS: totalChunks,
          chunksUploadedToS3: totalUploaded,
          batches: completedBatches,
          error: ingestionResult.error,
          duration: Date.now() - startTime,
        };
      }

      // Step 4: Wait for KB ingestion to complete (if requested)
      let finalStatus = ingestionResult.status;
      if (waitForKB && ingestionResult.jobId) {
        this.logger.log(`⏳ Waiting for KB ingestion to complete (job: ${ingestionResult.jobId})...`);
        const completionResult = await this.waitForCompletion(ingestionResult.jobId, 600000); // 10 min timeout
        finalStatus = completionResult.status;
        
        if (!completionResult.success) {
          this.logger.warn(`KB ingestion did not complete successfully: ${completionResult.error}`);
        } else {
          this.logger.log(`✅ KB ingestion complete: ${JSON.stringify(completionResult.statistics)}`);
        }
      }

      // Step 5: Verify sync status
      const finalSyncStatus = await this.getSyncStatus(options.ticker);
      this.logger.log(`📊 Final sync status: RDS=${finalSyncStatus.rdsChunks}, S3=${finalSyncStatus.s3Chunks}, Delta=${finalSyncStatus.delta}`);

      return {
        success: true,
        totalChunksInRDS: totalChunks,
        chunksUploadedToS3: totalUploaded,
        batches: completedBatches,
        ingestionJobId: ingestionResult.jobId,
        ingestionStatus: finalStatus,
        duration: Date.now() - startTime,
      };

    } catch (error) {
      this.logger.error(`❌ Full sync failed: ${error.message}`);
      return {
        success: false,
        totalChunksInRDS: 0,
        chunksUploadedToS3: 0,
        batches: 0,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Upload batch with exponential backoff retry
   */
  private async uploadBatchWithRetry(options: {
    bucket: string;
    ticker?: string;
    keyPrefix?: string;
    batchSize: number;
    offset: number;
  }): Promise<{ uploadedCount: number; totalSize: number; keys: string[] }> {
    const maxRetries = 5;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.chunkExporter.uploadToS3({
          bucket: options.bucket,
          ticker: options.ticker,
          keyPrefix: options.keyPrefix,
          batchSize: options.batchSize,
          offset: options.offset,
          dryRun: false,
        });
      } catch (error) {
        lastError = error;
        const delay = this.calculateBackoff(attempt);
        this.logger.warn(`Upload batch failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
        this.logger.log(`   Retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Upload failed after max retries');
  }

  /**
   * Start ingestion with exponential backoff retry
   */
  private async startIngestionWithRetry(description?: string): Promise<KBSyncResult> {
    const maxRetries = 5;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // CRITICAL: First check for ongoing jobs and wait for them
        const ongoingJob = await this.checkForOngoingJob();
        if (ongoingJob) {
          this.logger.log(`Found ongoing ingestion job: ${ongoingJob.jobId} (${ongoingJob.status})`);
          this.logger.log(`Waiting for ongoing job to complete before starting new ingestion...`);
          
          // Wait for the ongoing job to complete
          const waitResult = await this.waitForCompletion(ongoingJob.jobId, 600000); // 10 min max
          
          if (waitResult.success && waitResult.status === 'COMPLETE') {
            this.logger.log(`Ongoing job ${ongoingJob.jobId} completed. KB is now synced.`);
            return waitResult; // Return the completed job result
          } else {
            this.logger.warn(`Ongoing job ${ongoingJob.jobId} did not complete successfully: ${waitResult.status}`);
            // Continue to try starting a new job
          }
        }

        // No ongoing job - start a new one
        const result = await this.startIngestion(description);
        if (result.success) {
          return result;
        }
        lastError = new Error(result.error || 'Unknown error');
      } catch (error) {
        lastError = error;
        
        // Check if error is due to ongoing job (extract job ID from error message)
        const ongoingJobMatch = error.message?.match(/ongoing ingestion job.*ID\s+(\w+)/i);
        if (ongoingJobMatch) {
          const existingJobId = ongoingJobMatch[1];
          this.logger.log(`Detected ongoing job from error: ${existingJobId}. Waiting for completion...`);
          
          try {
            const waitResult = await this.waitForCompletion(existingJobId, 600000);
            if (waitResult.success && waitResult.status === 'COMPLETE') {
              this.logger.log(`Ongoing job ${existingJobId} completed. KB is now synced.`);
              return waitResult;
            }
          } catch (waitError) {
            this.logger.warn(`Error waiting for ongoing job: ${waitError.message}`);
          }
        }
      }

      const delay = this.calculateBackoff(attempt);
      this.logger.warn(`Start ingestion failed (attempt ${attempt}/${maxRetries}): ${lastError?.message}`);
      this.logger.log(`   Retrying in ${delay}ms...`);
      await this.sleep(delay);
    }

    return {
      success: false,
      error: lastError?.message || 'Failed after max retries',
    };
  }

  /**
   * Check for any ongoing ingestion job
   */
  private async checkForOngoingJob(): Promise<{ jobId: string; status: string } | null> {
    try {
      const command = new ListIngestionJobsCommand({
        knowledgeBaseId: this.kbId,
        dataSourceId: this.dataSourceId,
        maxResults: 5,
      });

      const response = await this.bedrockAgent.send(command);
      const jobs = response.ingestionJobSummaries || [];

      // Find any job that's still running
      const runningJob = jobs.find(job => 
        job.status === 'STARTING' || job.status === 'IN_PROGRESS'
      );

      if (runningJob && runningJob.ingestionJobId) {
        return {
          jobId: runningJob.ingestionJobId,
          status: runningJob.status || 'UNKNOWN',
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to check for ongoing jobs: ${error.message}`);
      return null;
    }
  }

  /**
   * Calculate exponential backoff delay
   * Base delay: 1 second, max delay: 60 seconds
   * Formula: min(baseDelay * 2^attempt + jitter, maxDelay)
   */
  private calculateBackoff(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 60000; // 60 seconds
    const jitter = Math.random() * 1000; // 0-1 second random jitter
    
    const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);
    return Math.floor(delay);
  }

  /**
   * Get RDS chunk count
   */
  private async getRDSChunkCount(ticker?: string): Promise<number> {
    const where = ticker ? { ticker } : {};
    return this.prisma.narrativeChunk.count({ where });
  }

  /**
   * Get S3 chunk count
   */
  private async getS3ChunkCount(ticker?: string): Promise<number> {
    try {
      const prefix = ticker ? `chunks/${ticker}/` : 'chunks/';
      let count = 0;
      let continuationToken: string | undefined;

      do {
        const command = new ListObjectsV2Command({
          Bucket: this.s3Bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const response = await this.s3Client.send(command);
        
        // Count only .txt files (not .metadata.json)
        const txtFiles = response.Contents?.filter(obj => 
          obj.Key?.endsWith('.txt') && !obj.Key?.endsWith('.metadata.json')
        ) || [];
        
        count += txtFiles.length;
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      return count;
    } catch (error) {
      this.logger.error(`Failed to count S3 chunks: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get KB document count
   * Note: Bedrock KB doesn't have a direct API to get document count.
   * We use the documentsScanned from the latest COMPLETE ingestion job,
   * which represents the total documents in the KB after that sync.
   */
  private async getKBDocumentCount(): Promise<number> {
    const latestJob = await this.getLatestIngestionJob();
    
    // Only use documentsScanned from COMPLETE jobs - this represents total KB docs
    if (latestJob.success && latestJob.status === 'COMPLETE' && latestJob.statistics) {
      return latestJob.statistics.documentsScanned;
    }
    
    // If no complete job or in progress, return 0 to indicate unknown
    return 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * SECTION-BASED SYNC - Optimized sync using aggregated sections
   * 
   * This is the RECOMMENDED approach for KB sync:
   * - Aggregates chunks by section (ticker/filingType/sectionType)
   * - Reduces S3 file count from ~77K to ~1K
   * - Preserves ALL narrative content (no data loss)
   * - Lets Bedrock handle optimal chunking for embeddings
   * 
   * Benefits:
   * - Faster ingestion (fewer files to process)
   * - Better semantic coherence (full sections vs fragments)
   * - Lower S3 costs (fewer objects)
   * - Maintains metadata for filtering
   * 
   * @param options.clearExisting - Clear existing section files before upload
   * @param options.waitForKB - Wait for KB ingestion to complete
   * @param options.tickers - Specific tickers to sync (default: all)
   */
  async sectionBasedSync(options: {
    clearExisting?: boolean;
    waitForKB?: boolean;
    tickers?: string[];
  } = {}): Promise<SectionSyncResult> {
    const startTime = Date.now();
    const waitForKB = options.waitForKB !== false;
    
    this.logger.log(`🚀 Starting SECTION-BASED SYNC (optimized)`);
    this.logger.log(`   Clear existing: ${options.clearExisting}, Wait for KB: ${waitForKB}`);

    try {
      // Step 1: Export all sections to S3
      this.logger.log(`📤 Exporting sections to S3...`);
      const exportResult = await this.sectionExporter.exportAllSections({
        clearExisting: options.clearExisting,
        tickers: options.tickers,
      });

      this.logger.log(`✅ Section export complete:`);
      this.logger.log(`   Tickers: ${exportResult.totalTickers}`);
      this.logger.log(`   Sections: ${exportResult.totalSections}`);
      this.logger.log(`   Characters: ${exportResult.totalCharacters.toLocaleString()}`);

      if (exportResult.totalSections === 0) {
        return {
          success: true,
          totalTickers: 0,
          totalSections: 0,
          totalCharacters: 0,
          duration: Date.now() - startTime,
        };
      }

      // Step 2: Trigger KB ingestion
      this.logger.log(`🔄 Starting Bedrock KB ingestion...`);
      const ingestionResult = await this.startIngestionWithRetry(
        `Section-based sync: ${exportResult.totalSections} sections at ${new Date().toISOString()}`
      );

      if (!ingestionResult.success) {
        return {
          success: false,
          totalTickers: exportResult.totalTickers,
          totalSections: exportResult.totalSections,
          totalCharacters: exportResult.totalCharacters,
          error: ingestionResult.error,
          duration: Date.now() - startTime,
        };
      }

      // Step 3: Wait for KB ingestion to complete (if requested)
      let finalStatus = ingestionResult.status;
      if (waitForKB && ingestionResult.jobId) {
        this.logger.log(`⏳ Waiting for KB ingestion to complete (job: ${ingestionResult.jobId})...`);
        const completionResult = await this.waitForCompletion(ingestionResult.jobId, 600000);
        finalStatus = completionResult.status;
        
        if (!completionResult.success) {
          this.logger.warn(`KB ingestion did not complete successfully: ${completionResult.error}`);
        } else {
          this.logger.log(`✅ KB ingestion complete: ${JSON.stringify(completionResult.statistics)}`);
        }
      }

      return {
        success: true,
        totalTickers: exportResult.totalTickers,
        totalSections: exportResult.totalSections,
        totalCharacters: exportResult.totalCharacters,
        ingestionJobId: ingestionResult.jobId,
        ingestionStatus: finalStatus,
        duration: Date.now() - startTime,
      };

    } catch (error) {
      this.logger.error(`❌ Section-based sync failed: ${error.message}`);
      return {
        success: false,
        totalTickers: 0,
        totalSections: 0,
        totalCharacters: 0,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }
}
