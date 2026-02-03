import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { S3DataLakeService } from './s3-data-lake.service';
import { SECSyncService } from './sec-sync.service';
import { SECProcessingService } from './sec-processing.service';
import { SimpleSyncService } from './simple-sync.service';
import { SimpleProcessingService } from './simple-processing.service';
import { ComprehensiveSECPipelineService } from './comprehensive-sec-pipeline.service';
import { S3Controller } from './s3.controller';
import { SimpleController } from './simple.controller';
import { ComprehensiveSECPipelineController } from './comprehensive-sec-pipeline.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecModule } from '../dataSources/sec/sec.module';
import { RAGModule } from '../rag/rag.module';

@Module({
  imports: [PrismaModule, SecModule, forwardRef(() => RAGModule), HttpModule],
  providers: [
    S3DataLakeService, 
    SECSyncService, 
    SECProcessingService,
    SimpleSyncService,
    SimpleProcessingService,
    ComprehensiveSECPipelineService,
  ],
  controllers: [S3Controller, SimpleController, ComprehensiveSECPipelineController],
  exports: [
    S3DataLakeService, 
    SECSyncService, 
    SECProcessingService,
    SimpleSyncService,
    SimpleProcessingService,
    ComprehensiveSECPipelineService,
  ],
})
export class S3Module {}
