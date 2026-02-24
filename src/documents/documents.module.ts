/**
 * Documents Module with Tenant Isolation
 * 
 * Provides document management with tenant-aware services.
 * Uses TenantAwareS3Service for S3 operations with prefix enforcement.
 */

import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentProcessorService } from './document-processor.service';
import { DocumentUploadController } from './document-upload.controller';
import { DocumentProcessingService } from './document-processing.service';
import { DocumentIntelligenceService } from './document-intelligence.service';
import { DocumentIntelligenceController } from './document-intelligence.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { RAGModule } from '../rag/rag.module';
import { S3Service } from '../services/s3.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    TenantModule, // Provides TenantAwareS3Service
    forwardRef(() => RAGModule), // Provides BedrockService
    HttpModule.register({ timeout: 120000, maxRedirects: 5 }),
  ],
  controllers: [DocumentsController, DocumentUploadController, DocumentIntelligenceController],
  providers: [
    DocumentsService,
    DocumentProcessorService,
    DocumentProcessingService,
    DocumentIntelligenceService,
    S3Service,
  ],
  exports: [DocumentsService, DocumentProcessorService, DocumentProcessingService, DocumentIntelligenceService],
})
export class DocumentsModule {}
