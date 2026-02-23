/**
 * Deal Management Controller
 * 
 * REST API for financial analysis deals.
 * All endpoints are protected by TenantGuard to ensure tenant isolation.
 * 
 * SECURITY: 
 * - TenantGuard extracts tenant context from JWT/API key
 * - DealService enforces tenant isolation at the data layer
 * - Cross-tenant access attempts return 404 (not 403) to prevent info leakage
 * 
 * Requirements: 2.6 - API-level tenant isolation
 */

import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Delete, 
  Body, 
  Param,
  Query,
  Logger, 
  HttpCode, 
  HttpStatus, 
  HttpException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { DealService, type CreateDealDto, type UpdateDealDto } from './deal.service';
import { PipelineOrchestrationService } from './pipeline-orchestration.service';
import { TenantGuard, Public } from '../tenant';

/**
 * Deal Management Controller with Tenant Isolation
 * 
 * All endpoints require authentication via TenantGuard.
 * Use @Public() decorator to opt-out specific endpoints if needed.
 */
@Controller('deals')
@UseGuards(TenantGuard)
export class DealController {
  private readonly logger = new Logger(DealController.name);

  constructor(
    private readonly dealService: DealService,
    private readonly pipelineService: PipelineOrchestrationService,
  ) {}

  /**
   * Create a new deal
   * POST /api/deals
   * 
   * The deal is automatically associated with the authenticated tenant.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createDeal(@Body() createDealDto: CreateDealDto) {
    this.logger.log(`Creating deal: ${createDealDto.name}`);
    
    try {
      const deal = await this.dealService.createDeal(createDealDto);
      
      return {
        success: true,
        data: deal,
        message: 'Deal created successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to create deal: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create deal',
      };
    }
  }

  /**
   * Get all deals for the authenticated tenant
   * GET /api/deals
   * 
   * Only returns deals belonging to the current tenant.
   */
  @Get()
  async getAllDeals() {
    try {
      const deals = await this.dealService.getAllDeals();
      const stats = await this.dealService.getDealStats();
      
      return {
        success: true,
        data: deals,
        stats,
        message: `Retrieved ${deals.length} deals`,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch deals: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch deals',
      };
    }
  }
  /**
   * Get deal by ticker
   * GET /api/deals/by-ticker/:ticker
   *
   * Returns the deal for the given ticker within the current tenant.
   * Also aliased as GET /api/deals/info?ticker=:ticker for backwards compatibility.
   */
  @Get('by-ticker/:ticker')
  async getDealByTicker(@Param('ticker') ticker: string) {
    try {
      const deal = await this.dealService.getDealByTicker(ticker);
      return {
        success: true,
        data: deal,
        message: `Retrieved deal for ticker ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch deal by ticker: ${error.message}`);
      if (error instanceof HttpException) {
        throw error;
      }
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch deal',
      };
    }
  }

  /**
   * Get deal info by ticker (alias for by-ticker endpoint)
   * GET /api/deals/info?ticker=:ticker
   */
  @Get('info')
  async getDealInfo(@Query('ticker') ticker: string) {
    if (!ticker) {
      throw new BadRequestException('ticker query parameter is required');
    }
    const deal = await this.dealService.getDealByTicker(ticker);
    // Return the deal directly (not wrapped) for backwards compatibility
    return deal;
  }



  /**
   * Get deal statistics for the authenticated tenant
   * GET /api/deals/stats/summary
   */
  @Get('stats/summary')
  async getDealStats() {
    try {
      const stats = await this.dealService.getDealStats();
      
      return {
        success: true,
        data: stats,
        message: 'Statistics retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch stats: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch statistics',
      };
    }
  }

  /**
   * Get deal processing status
   * GET /api/deals/:id/status
   * 
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   */
  @Get(':id/status')
  async getDealStatus(@Param('id') id: string) {
    try {
      const deal = await this.dealService.getDealById(id);
      
      return {
        success: true,
        data: {
          id: deal.id,
          status: deal.status,
          processingMessage: deal.processingMessage,
          ticker: deal.ticker,
          years: deal.years,
          newsData: deal.newsData,
          updatedAt: deal.updatedAt
        },
        message: `Status retrieved for deal ${id}`,
      };
    } catch (error) {
      this.logger.error(`Failed to get deal status: ${error.message}`);
      
      // Preserve 404 status for not found errors
      if (error instanceof HttpException) {
        throw error;
      }
      
      return {
        success: false,
        error: error.message,
        message: `Failed to get deal status`,
      };
    }
  }

  /**
   * Get deal by ID
   * GET /api/deals/:id
   * 
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   * This prevents information leakage about deal existence.
   */
  @Get(':id')
  async getDealById(@Param('id') id: string) {
    try {
      const deal = await this.dealService.getDealById(id);
      
      return {
        success: true,
        data: deal,
        message: 'Deal retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch deal ${id}: ${error.message}`);
      
      // Preserve 404 status for not found errors
      if (error instanceof HttpException) {
        throw error;
      }
      
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch deal',
      };
    }
  }

  /**
   * Update deal
   * PUT /api/deals/:id
   * 
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   */
  @Put(':id')
  async updateDeal(@Param('id') id: string, @Body() updateDealDto: UpdateDealDto) {
    this.logger.log(`Updating deal: ${id}`);
    
    try {
      const deal = await this.dealService.updateDeal(id, updateDealDto);
      
      return {
        success: true,
        data: deal,
        message: 'Deal updated successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to update deal ${id}: ${error.message}`);
      
      // Preserve 404 status for not found errors
      if (error instanceof HttpException) {
        throw error;
      }
      
      return {
        success: false,
        error: error.message,
        message: 'Failed to update deal',
      };
    }
  }

  /**
   * Delete deal
   * DELETE /api/deals/:id
   * 
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   * Only deletes the deal record - preserves downloaded filings, metrics, and KB data.
   */
  @Delete(':id')
  async deleteDeal(@Param('id') id: string) {
    this.logger.log(`Deleting deal: ${id}`);
    
    try {
      await this.dealService.deleteDeal(id);
      
      return {
        success: true,
        message: 'Deal deleted successfully. Financial data preserved.',
      };
    } catch (error) {
      this.logger.error(`Failed to delete deal ${id}: ${error.message}`);
      
      // Preserve 404 status for not found errors
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new HttpException(
        {
          success: false,
          error: error.message,
          message: 'Failed to delete deal',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Start analysis pipeline for a deal
   * POST /api/deals/:id/analyze
   * 
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   */
  @Post(':id/analyze')
  async startAnalysisPipeline(
    @Param('id') id: string,
    @Body() body: { years?: number } = {},
  ) {
    this.logger.log(`Starting analysis pipeline for deal: ${id}`);
    
    try {
      // This will throw 404 if deal doesn't belong to current tenant
      const deal = await this.dealService.getDealById(id);
      
      if (!deal.ticker) {
        return {
          success: false,
          error: 'No ticker specified for this deal',
          message: 'Cannot start analysis without a ticker',
        };
      }

      // Check if already processing
      if (deal.status === 'processing') {
        const pipelineStatus = this.pipelineService.getPipelineStatus(id);
        return {
          success: true,
          data: pipelineStatus,
          message: 'Pipeline already running',
        };
      }

      // Start the pipeline
      const pipelineStatus = await this.pipelineService.startPipeline(
        id,
        deal.ticker,
        body.years || deal.years || 5,
      );
      
      return {
        success: true,
        data: pipelineStatus,
        message: 'Analysis pipeline started',
      };
    } catch (error) {
      this.logger.error(`Failed to start pipeline for deal ${id}: ${error.message}`);
      
      // Preserve 404 status for not found errors
      if (error instanceof HttpException) {
        throw error;
      }
      
      return {
        success: false,
        error: error.message,
        message: 'Failed to start analysis pipeline',
      };
    }
  }

  /**
   * Get pipeline status for a deal
   * GET /api/deals/:id/pipeline-status
   * 
   * Returns 404 if deal doesn't exist or belongs to another tenant.
   * 
   * HARDENING: Reconstructs pipeline status from DB if in-memory status is lost (server restart)
   */
  @Get(':id/pipeline-status')
  async getPipelineStatus(@Param('id') id: string) {
    try {
      // This will throw 404 if deal doesn't belong to current tenant
      const deal = await this.dealService.getDealById(id);
      
      // Try to get in-memory status first
      let pipelineStatus = this.pipelineService.getPipelineStatus(id);
      
      // If in-memory status is lost (server restart), reconstruct from DB
      if (!pipelineStatus && deal.ticker) {
        this.logger.log(`Reconstructing pipeline status for deal ${id} (${deal.ticker}) from database`);
        pipelineStatus = await this.pipelineService.reconstructPipelineStatus(id, {
          ticker: deal.ticker,
          status: deal.status,
        });
      }
      
      return {
        success: true,
        data: {
          pipeline: pipelineStatus,
          deal: {
            id: deal.id,
            status: deal.status,
            processingMessage: deal.processingMessage,
            ticker: deal.ticker,
            newsData: deal.newsData,
          },
        },
        message: 'Pipeline status retrieved',
      };
    } catch (error) {
      this.logger.error(`Failed to get pipeline status for deal ${id}: ${error.message}`);
      
      // Preserve 404 status for not found errors
      if (error instanceof HttpException) {
        throw error;
      }
      
      return {
        success: false,
        error: error.message,
        message: 'Failed to get pipeline status',
      };
    }
  }
}
