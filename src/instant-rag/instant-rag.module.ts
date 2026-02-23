/**
 * Instant RAG Module
 * 
 * Provides real-time document processing and Q&A capabilities
 * without waiting for Bedrock Knowledge Base synchronization.
 */

import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from '../../prisma/prisma.module';
import { RAGModule } from '../rag/rag.module';
import { SessionManagerService } from './session-manager.service';
import { DocumentProcessorService } from './document-processor.service';
import { FileValidatorService } from './file-validator.service';
import { ModelRouterService } from './model-router.service';
import { SyncEnvelopeGeneratorService } from './sync-envelope-generator.service';
import { VisionPipelineService } from './vision-pipeline.service';
import { InstantRAGController } from './instant-rag.controller';
import { InstantRAGService } from './instant-rag.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    forwardRef(() => RAGModule),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    InstantRAGController,
  ],
  providers: [
    SessionManagerService,
    DocumentProcessorService,
    FileValidatorService,
    ModelRouterService,
    SyncEnvelopeGeneratorService,
    VisionPipelineService,
    InstantRAGService,
  ],
  exports: [
    SessionManagerService,
    DocumentProcessorService,
    FileValidatorService,
    ModelRouterService,
    SyncEnvelopeGeneratorService,
    VisionPipelineService,
    InstantRAGService,
  ],
})
export class InstantRAGModule {}
