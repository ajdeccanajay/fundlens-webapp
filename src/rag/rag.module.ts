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
import { MetricRegistryService } from './metric-resolution/metric-registry.service';
import { FormulaResolutionService } from './metric-resolution/formula-resolution.service';
import { ConceptRegistryService } from './metric-resolution/concept-registry.service';
import { MetricCorrectionController } from './metric-resolution/metric-correction.controller';
import { MetricCorrectionService } from './metric-resolution/metric-correction.service';
import { MetricLearningService } from './metric-learning.service';
import { DocumentRAGService } from './document-rag.service';
import { CitationService } from './citation.service';
import { ChunkExporterService } from './chunk-exporter.service';
import { ChunkExportController } from './chunk-export.controller';
import { KBSyncService } from './kb-sync.service';
import { KBSyncController } from './kb-sync.controller';
import { SectionExporterService } from './section-exporter.service';
import { SectionExportController } from './section-export.controller';
import { PerformanceMonitorService } from './performance-monitor.service';
import { PerformanceOptimizerService } from './performance-optimizer.service';
// Phase 3: Advanced Retrieval Techniques
import { RerankerService } from './reranker.service';
import { HyDEService } from './hyde.service';
import { QueryDecompositionService } from './query-decomposition.service';
import { ContextualExpansionService } from './contextual-expansion.service';
import { IterativeRetrievalService } from './iterative-retrieval.service';
import { AdvancedRetrievalService } from './advanced-retrieval.service';
import { ResponseEnrichmentService } from './response-enrichment.service';
import { VisualizationGeneratorService } from './visualization-generator.service';
import { FinancialCalculatorService } from '../deals/financial-calculator.service';
import { HybridSynthesisService } from './hybrid-synthesis.service';
import { QueryDecomposerService } from './query-decomposer.service';
import { PeerComparisonService } from './peer-comparison.service';
import { HaikuIntentParserService } from './haiku-intent-parser.service';
import { IntentValidatorService } from './intent-validator.service';
import { FastPathCache } from './intent-detection/fast-path-cache';
import { CompanyTickerMapService } from './intent-detection/company-ticker-map.service';
import { IntentFeedbackService } from './intent-detection/intent-feedback.service';
import { QueryUnderstandingService } from './query-understanding.service';
import { DocumentMetricExtractorService } from './document-metric-extractor.service';
import { PromptRegistryService as QULPromptRegistryService } from './prompt-registry.service';
import { QULObservabilityService } from './qul-observability.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecModule } from '../dataSources/sec/sec.module';
import { S3Module } from '../s3/s3.module';
import { InstantRAGModule } from '../instant-rag/instant-rag.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [PrismaModule, SecModule, forwardRef(() => S3Module), forwardRef(() => InstantRAGModule), forwardRef(() => DocumentsModule), HttpModule],
  controllers: [RAGController, ChunkExportController, KBSyncController, SectionExportController, MetricCorrectionController],
  providers: [
    RAGService,
    QueryRouterService,
    IntentDetectorService,
    IntentAnalyticsService,
    StructuredRetrieverService,
    SemanticRetrieverService,
    BedrockService,
    PromptLibraryService,
    MetricRegistryService,
    MetricLearningService,
    DocumentRAGService,
    CitationService,
    ChunkExporterService,
    KBSyncService,
    SectionExporterService,
    PerformanceMonitorService,
    PerformanceOptimizerService,
    // Phase 3: Advanced Retrieval Techniques
    RerankerService,
    HyDEService,
    QueryDecompositionService,
    ContextualExpansionService,
    IterativeRetrievalService,
    AdvancedRetrievalService,
    // Phase 4: Multimodal Research Responses
    ResponseEnrichmentService,
    VisualizationGeneratorService,
    FinancialCalculatorService,
    FormulaResolutionService,
    ConceptRegistryService,
    MetricCorrectionService,
    // Intent Detection subsystem
    FastPathCache,
    CompanyTickerMapService,
    IntentFeedbackService,
    // Haiku-first intent detection pipeline
    HaikuIntentParserService,
    IntentValidatorService,
    // Sprint 2: Hybrid Synthesis Intelligence Layer
    HybridSynthesisService,
    // Sprint 3: Query Decomposition
    QueryDecomposerService,
    // Sprint 3: Peer Comparison Engine
    PeerComparisonService,
    // QUL: Query Understanding Layer (replaces regex ticker extraction)
    QueryUnderstandingService,
    // QUL Phase 4: Document Metric Extraction for PE docs
    DocumentMetricExtractorService,
    // QUL Phase 5: Prompt Registry + Observability
    QULPromptRegistryService,
    QULObservabilityService,
  ],
  exports: [
    RAGService,
    QueryRouterService,
    IntentDetectorService,
    IntentAnalyticsService,
    SemanticRetrieverService,
    BedrockService,
    PromptLibraryService,
    MetricRegistryService,
    MetricLearningService,
    DocumentRAGService,
    CitationService,
    ChunkExporterService,
    KBSyncService,
    SectionExporterService,
    PerformanceMonitorService,
    PerformanceOptimizerService,
    // Phase 3: Advanced Retrieval Techniques
    RerankerService,
    HyDEService,
    QueryDecompositionService,
    ContextualExpansionService,
    IterativeRetrievalService,
    AdvancedRetrievalService,
    // Phase 4: Multimodal Research Responses
    ResponseEnrichmentService,
    VisualizationGeneratorService,
    FormulaResolutionService,
    ConceptRegistryService,
    FinancialCalculatorService,
    HybridSynthesisService,
    QueryDecomposerService,
    PeerComparisonService,
    QueryUnderstandingService,
    DocumentMetricExtractorService,
    QULPromptRegistryService,
    QULObservabilityService,
  ],
})
export class RAGModule {}
