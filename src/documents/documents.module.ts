/**
 * Documents Module with Tenant Isolation
 * 
 * Provides document management with tenant-aware services.
 * Uses TenantAwareS3Service for S3 operations with prefix enforcement.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentProcessorService } from './document-processor.service';
import { DocumentUploadController } from './document-upload.controller';
import { DocumentProcessingService } from './document-processing.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { TenantModule } from '../tenant/tenant.module';
import { S3Service } from '../services/s3.service';
import { BedrockService } from '../rag/bedrock.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    TenantModule, // Provides TenantAwareS3Service
    HttpModule.register({ timeout: 120000, maxRedirects: 5 }),
  ],
  controllers: [DocumentsController, DocumentUploadController],
  providers: [
    DocumentsService,
    DocumentProcessorService,
    DocumentProcessingService,
    S3Service,
    BedrockService,
  ],
  exports: [DocumentsService, DocumentProcessorService, DocumentProcessingService],
})
export class DocumentsModule {}
