import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RAGController } from './rag.controller';
import { RAGService } from './rag.service';
import { QueryRouterService } from './query-router.service';
import { IntentDetectorService } from './intent-detector.service';
import { StructuredRetrieverService } from './structured-retriever.service';
import { SemanticRetrieverService } from './semantic-retriever.service';
import { BedrockService } from './bedrock.service';
import { DocumentRAGService } from './document-rag.service';
import { CitationService } from './citation.service';
import { ChunkExporterService } from './chunk-exporter.service';
import { ChunkExportController } from './chunk-export.controller';
import { KBSyncService } from './kb-sync.service';
import { KBSyncController } from './kb-sync.controller';
import { SectionExporterService } from './section-exporter.service';
import { SectionExportController } from './section-export.controller';
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
    StructuredRetrieverService,
    SemanticRetrieverService,
    BedrockService,
    DocumentRAGService,
    CitationService,
    ChunkExporterService,
    KBSyncService,
    SectionExporterService,
  ],
  exports: [
    RAGService,
    QueryRouterService,
    IntentDetectorService,
    SemanticRetrieverService,
    BedrockService,
    DocumentRAGService,
    CitationService,
    ChunkExporterService,
    KBSyncService,
    SectionExporterService,
  ],
})
export class RAGModule {}
