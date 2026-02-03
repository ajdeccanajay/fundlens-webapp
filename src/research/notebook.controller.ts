/**
 * Notebook Controller
 * 
 * REST API endpoints for research notebooks and insights.
 * 
 * All endpoints require authentication and enforce tenant isolation.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TenantGuard } from '../tenant/tenant.guard';
import { NotebookService } from './notebook.service';
import type {
  CreateNotebookDto,
  UpdateNotebookDto,
  CreateInsightDto,
  UpdateInsightDto,
} from './notebook.service';

@Controller('research/notebooks')
@UseGuards(TenantGuard)
export class NotebookController {
  constructor(private readonly notebookService: NotebookService) {}

  /**
   * Create a new notebook
   * POST /research/notebooks
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createNotebook(@Body() body: CreateNotebookDto) {
    const notebook = await this.notebookService.createNotebook(body);
    return {
      success: true,
      data: notebook,
    };
  }

  /**
   * List notebooks
   * GET /research/notebooks?archived=false&limit=50&offset=0
   */
  @Get()
  async listNotebooks(
    @Query('archived') archived?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.notebookService.listNotebooks({
      archived: archived === 'true' ? true : archived === 'false' ? false : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      data: result.data,
      pagination: result.pagination,
    };
  }

  /**
   * Get notebook by ID with insights
   * GET /research/notebooks/:id
   */
  @Get(':id')
  async getNotebook(@Param('id') id: string) {
    const result = await this.notebookService.getNotebook(id);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Update notebook
   * PATCH /research/notebooks/:id
   */
  @Patch(':id')
  async updateNotebook(
    @Param('id') id: string,
    @Body() body: UpdateNotebookDto,
  ) {
    const notebook = await this.notebookService.updateNotebook(id, body);
    return {
      success: true,
      data: notebook,
    };
  }

  /**
   * Delete notebook
   * DELETE /research/notebooks/:id
   */
  @Delete(':id')
  async deleteNotebook(@Param('id') id: string) {
    await this.notebookService.deleteNotebook(id);
    return {
      success: true,
      message: 'Notebook deleted successfully',
    };
  }

  /**
   * Add insight to notebook
   * POST /research/notebooks/:id/insights
   */
  @Post(':id/insights')
  @HttpCode(HttpStatus.CREATED)
  async addInsight(
    @Param('id') notebookId: string,
    @Body() body: CreateInsightDto,
  ) {
    const insight = await this.notebookService.addInsight(notebookId, body);
    return {
      success: true,
      data: insight,
    };
  }

  /**
   * Update insight
   * PATCH /research/notebooks/:notebookId/insights/:insightId
   */
  @Patch(':notebookId/insights/:insightId')
  async updateInsight(
    @Param('notebookId') notebookId: string,
    @Param('insightId') insightId: string,
    @Body() body: UpdateInsightDto,
  ) {
    const insight = await this.notebookService.updateInsight(
      notebookId,
      insightId,
      body,
    );
    return {
      success: true,
      data: insight,
    };
  }

  /**
   * Delete insight
   * DELETE /research/notebooks/:notebookId/insights/:insightId
   */
  @Delete(':notebookId/insights/:insightId')
  async deleteInsight(
    @Param('notebookId') notebookId: string,
    @Param('insightId') insightId: string,
  ) {
    await this.notebookService.deleteInsight(notebookId, insightId);
    return {
      success: true,
      message: 'Insight deleted successfully',
    };
  }

  /**
   * Reorder insights
   * POST /research/notebooks/:id/insights/reorder
   * Body: { insightIds: string[] }
   */
  @Post(':id/insights/reorder')
  async reorderInsights(
    @Param('id') notebookId: string,
    @Body() body: { insightIds: string[] },
  ) {
    await this.notebookService.reorderInsights(notebookId, body.insightIds);
    return {
      success: true,
      message: 'Insights reordered successfully',
    };
  }

  /**
   * Export notebook
   * GET /research/notebooks/:id/export?format=markdown
   */
  @Get(':id/export')
  async exportNotebook(
    @Param('id') notebookId: string,
    @Query('format') format: string = 'markdown',
    @Res() res: Response,
  ) {
    if (format === 'markdown') {
      const markdown = await this.notebookService.exportMarkdown(notebookId);
      
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="notebook-${notebookId}.md"`);
      res.send(markdown);
    } else {
      res.status(400).json({
        success: false,
        error: 'Unsupported export format. Currently only "markdown" is supported.',
      });
    }
  }
}
