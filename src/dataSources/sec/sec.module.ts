import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SecService } from './sec.service';
import { SecParserService } from './sec-parser.service';
import { MetricsService } from './metrics.service';
import { IngestionService } from './ingestion.service';
import { SecQueryService } from './sec-query.service';
import { ComputedMetricsService } from './computed-metrics.service';
import { BatchIngestionService } from './batch-ingestion.service';
import { HistoricalHydrationService } from './historical-hydration.service';
import { SecController } from './sec.controller';

@Module({
  imports: [HttpModule],
  providers: [
    SecService,
    SecParserService,
    MetricsService,
    IngestionService,
    SecQueryService,
    ComputedMetricsService,
    BatchIngestionService,
    HistoricalHydrationService,
  ],
  controllers: [SecController],
  exports: [ComputedMetricsService, SecService, HistoricalHydrationService, IngestionService], // Export for RAG module and S3 sync
})
export class SecModule {}
