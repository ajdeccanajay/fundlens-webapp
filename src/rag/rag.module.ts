import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RAGController } from './rag.controller';
import { RAGService } from './rag.service';
import { QueryRouterService } from './query-router.service';
import { IntentDetectorService } from './intent-detector.service';
import { IntentAnalyticsService } from './intent-analytics.service';
import { StructuredRetrieverService } from './structured-retriever.service';
import { SemanticRetrieverService } from './semantic-retriever.service';
import { BedrockService } from './bedrock.service';
import { PromptLibraryService } from './prompt-library.service';
import { DocumentRAGService } from './document-rag.service';
import { CitationService } from './citation.service';
import { ChunkExporterService } from './chunk-exporter.service';
import { ChunkExportController } from './chunk-export.controller';
import { KBSyncService } from './kb-sync.service';
import { KBSyncController } from './kb-sync.controller';
import { SectionExporterService } from './section-exporter.service';
import { SectionExportController } from './section-export.controller';
// Phase 3: Advanced Retrieval Techniques
import { RerankerService } from './reranker.service';
import { HyDEService } from './hyde.service';
import { QueryDecompositionService } from './query-decomposition.service';
import { ContextualExpansionService } from './contextual-expansion.service';
import { IterativeRetrievalService } from './iterative-retrieval.service';
import { AdvancedRetrievalService } from './advanced-retrieval.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecModule } from '../dataSources/sec/sec.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [PrismaModule, SecModule, forwardRef(() => S3Module), HttpModule],
  controllers: [RAGController, ChunkExportController, KBSyncController, SectionExportController],
  providers: [
    RAGService,
    QueryRouterService,
    IntentDetectorService,
    IntentAnalyticsService,
    StructuredRetrieverService,
    SemanticRetrieverService,
    BedrockService,
    PromptLibraryService,
    DocumentRAGService,
    CitationService,
    ChunkExporterService,
    KBSyncService,
    SectionExporterService,
    // Phase 3: Advanced Retrieval Techniques
    RerankerService,
    HyDEService,
    QueryDecompositionService,
    ContextualExpansionService,
    IterativeRetrievalService,
    AdvancedRetrievalService,
  ],
  exports: [
    RAGService,
    QueryRouterService,
    IntentDetectorService,
    IntentAnalyticsService,
    SemanticRetrieverService,
    BedrockService,
    PromptLibraryService,
    DocumentRAGService,
    CitationService,
    ChunkExporterService,
    KBSyncService,
    SectionExporterService,
    // Phase 3: Advanced Retrieval Techniques
    RerankerService,
    HyDEService,
    QueryDecompositionService,
    ContextualExpansionService,
    IterativeRetrievalService,
    AdvancedRetrievalService,
  ],
})
export class RAGModule {}
