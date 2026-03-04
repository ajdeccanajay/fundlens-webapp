/**
 * Agents Module — Phase 4: Agentic Transcript Acquisition
 *
 * Registers the orchestrator, IR page finder, and transcript acquisition agents.
 * Imported by DealsModule so PipelineOrchestrationService can use OrchestratorAgent.
 */

import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RAGModule } from '../rag/rag.module';
import { OrchestratorAgent } from './orchestrator.agent';
import { IrPageFinderAgent } from './ir-page-finder.agent';
import { TranscriptAcquisitionAgent } from './transcript-acquisition.agent';

@Module({
  imports: [PrismaModule, forwardRef(() => RAGModule)],
  providers: [
    OrchestratorAgent,
    IrPageFinderAgent,
    TranscriptAcquisitionAgent,
  ],
  exports: [
    OrchestratorAgent,
    IrPageFinderAgent,
    TranscriptAcquisitionAgent,
  ],
})
export class AgentsModule {}
