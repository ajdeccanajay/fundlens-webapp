import { Controller, Get, Put, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { ScratchPadService, type UpdateScratchPadDto } from './scratch-pad.service';

/**
 * Scratch Pad Controller for Investment Memo Management
 */
@Controller('deals/:dealId/scratch-pad')
export class ScratchPadController {
  private readonly logger = new Logger(ScratchPadController.name);

  constructor(private readonly scratchPadService: ScratchPadService) {}

  /**
   * Get scratch pad content
   * GET /api/deals/:dealId/scratch-pad
   */
  @Get()
  async getScratchPad(@Param('dealId') dealId: string) {
    try {
      const scratchPad = await this.scratchPadService.getScratchPad(dealId);

      return {
        success: true,
        data: scratchPad,
        message: scratchPad ? 'Scratch pad retrieved successfully' : 'No scratch pad found',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch scratch pad: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch scratch pad',
      };
    }
  }

  /**
   * Update scratch pad (auto-save)
   * PUT /api/deals/:dealId/scratch-pad
   */
  @Put()
  async updateScratchPad(
    @Param('dealId') dealId: string,
    @Body() updateDto: UpdateScratchPadDto,
  ) {
    try {
      const scratchPad = await this.scratchPadService.updateScratchPad(dealId, updateDto);

      return {
        success: true,
        data: scratchPad,
        message: 'Scratch pad auto-saved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to update scratch pad: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to update scratch pad',
      };
    }
  }

  /**
   * Manually save scratch pad
   * POST /api/deals/:dealId/scratch-pad/save
   */
  @Post('save')
  async manuallySaveScratchPad(@Param('dealId') dealId: string) {
    try {
      const scratchPad = await this.scratchPadService.manuallySaveScratchPad(dealId);

      return {
        success: true,
        data: scratchPad,
        message: 'Scratch pad saved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to save scratch pad: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to save scratch pad',
      };
    }
  }

  /**
   * Generate template
   * POST /api/deals/:dealId/scratch-pad/template
   */
  @Post('template')
  async generateTemplate(
    @Param('dealId') dealId: string,
    @Body() body: { templateType: 'basic' | 'detailed' | 'executive' },
  ) {
    try {
      const template = await this.scratchPadService.generateTemplate(dealId, body.templateType);

      // Update scratch pad with template
      await this.scratchPadService.updateScratchPad(dealId, { content: template });

      return {
        success: true,
        data: { content: template },
        message: `${body.templateType} template generated successfully`,
      };
    } catch (error) {
      this.logger.error(`Failed to generate template: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to generate template',
      };
    }
  }

  /**
   * Export scratch pad
   * GET /api/deals/:dealId/scratch-pad/export
   */
  @Get('export')
  async exportScratchPad(
    @Param('dealId') dealId: string,
    @Query('format') format: 'markdown' | 'html' | 'plain' = 'markdown',
  ) {
    try {
      const exportData = await this.scratchPadService.exportScratchPad(dealId, format);

      return {
        success: true,
        data: exportData,
        message: 'Scratch pad exported successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to export scratch pad: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to export scratch pad',
      };
    }
  }

  /**
   * Get scratch pad history
   * GET /api/deals/:dealId/scratch-pad/history
   */
  @Get('history')
  async getScratchPadHistory(@Param('dealId') dealId: string) {
    try {
      const history = await this.scratchPadService.getScratchPadHistory(dealId);

      return {
        success: true,
        data: history,
        message: 'Scratch pad history retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch scratch pad history: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to fetch scratch pad history',
      };
    }
  }
}