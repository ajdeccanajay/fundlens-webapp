import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGModule } from '../rag/rag.module';
import { TenantModule } from '../tenant';
import { S3Module } from '../s3/s3.module';

// Services
import { DealService } from './deal.service';
import { ChatService } from './chat.service';
import { ScratchPadService } from './scratch-pad.service';
import { MarketDataService } from './market-data.service';
import { FinancialCalculatorService } from './financial-calculator.service';
import { DocumentGenerationService } from './document-generation.service';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';
import { QualitativePrecomputeService } from './qualitative-precompute.service';
import { ExportService } from './export.service';
import { StatementMapper } from './statement-mapper';
import { XLSXGenerator } from './xlsx-generator';
import { MetricHierarchyService } from './metric-hierarchy.service';
import { FootnoteLinkingService } from './footnote-linking.service';
import { MDAIntelligenceService } from './mda-intelligence.service';

// Controllers
import { DealController } from './deal.controller';
import { ChatController } from './chat.controller';
import { ScratchPadController } from './scratch-pad.controller';
import { MarketDataController } from './market-data.controller';
import { FinancialCalculatorController } from './financial-calculator.controller';
import { DocumentGenerationController } from './document-generation.controller';
import { DealsTestController } from './deals-test.controller';
import { ExportController } from './export.controller';

/**
 * Deals Module
 * Financial Analyst Workflow System with Tenant Isolation
 * 
 * NOTE: Insights tab features moved to FUTURE/insights-tab for future development
 * NOTE: ContextController and HierarchyController removed with insights tab
 */
@Module({
  imports: [
    HttpModule,
    RAGModule,
    TenantModule,
    forwardRef(() => S3Module),
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    DealsTestController,
    DealController,
    ChatController,
    ScratchPadController,
    MarketDataController,
    FinancialCalculatorController,
    DocumentGenerationController,
    ExportController,
  ],
  providers: [
    PrismaService,
    StatementMapper,
    XLSXGenerator,
    ExportService,
    DealService,
    ChatService,
    ScratchPadService,
    MarketDataService,
    FinancialCalculatorService,
    DocumentGenerationService,
    PipelineOrchestrationService,
    QualitativePrecomputeService,
    MetricHierarchyService,
    FootnoteLinkingService,
    MDAIntelligenceService,
  ],
  exports: [
    DealService,
    ChatService,
    ScratchPadService,
    MarketDataService,
    FinancialCalculatorService,
    DocumentGenerationService,
    PipelineOrchestrationService,
    QualitativePrecomputeService,
    ExportService,
  ],
})
export class DealsModule {}
