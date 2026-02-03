/**
 * Research Assistant Module
 * 
 * Provides tenant-wide research capabilities:
 * - Cross-company/cross-deal conversations
 * - Streaming AI responses
 * - Research notebooks
 * - IC memo generation
 * 
 * All operations enforce tenant isolation.
 */

import { Module } from '@nestjs/common';
import { ResearchAssistantService } from './research-assistant.service';
import { ResearchAssistantController } from './research-assistant.controller';
import { NotebookService } from './notebook.service';
import { NotebookController } from './notebook.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RAGModule } from '../rag/rag.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    PrismaModule,
    RAGModule,
    TenantModule,
  ],
  controllers: [
    ResearchAssistantController,
    NotebookController,
  ],
  providers: [
    ResearchAssistantService,
    NotebookService,
  ],
  exports: [
    ResearchAssistantService,
    NotebookService,
  ],
})
export class ResearchAssistantModule {}
