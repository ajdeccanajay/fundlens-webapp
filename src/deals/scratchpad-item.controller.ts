/**
 * Scratchpad Item Controller
 * Feature: research-scratchpad-redesign
 * Requirements: 2.1, 2.2, 2.3, 2.4, 12.2, 12.3, 12.4
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ScratchpadItemService } from './scratchpad-item.service';
import type {
  SaveItemRequest,
  GetItemsResponse,
  ExportRequest,
  ExportResponse,
} from './scratchpad-item.types';

@Controller('research/scratchpad')
export class ScratchpadItemController {
  constructor(private readonly scratchpadItemService: ScratchpadItemService) {}

  /**
   * GET /api/research/scratchpad/:workspaceId
   * Fetch all saved items for a workspace
   * Requirements: 2.1
   */
  @Get(':workspaceId')
  async getItems(
    @Param('workspaceId') workspaceId: string,
  ): Promise<GetItemsResponse> {
    const items = await this.scratchpadItemService.getItems(workspaceId);
    return {
      items,
      totalCount: items.length,
    };
  }

  /**
   * POST /api/research/scratchpad/save
   * Save a new research item to the scratchpad
   * Requirements: 2.1
   */
  @Post('save')
  @HttpCode(HttpStatus.CREATED)
  async saveItem(@Body() request: SaveItemRequest) {
    const item = await this.scratchpadItemService.saveItem(request);
    return { item };
  }

  /**
   * DELETE /api/research/scratchpad/:itemId
   * Delete a saved item
   * Requirements: 2.3, 2.4
   */
  @Delete(':itemId')
  @HttpCode(HttpStatus.OK)
  async deleteItem(@Param('itemId') itemId: string) {
    await this.scratchpadItemService.deleteItem(itemId);
    return { success: true };
  }

  /**
   * POST /api/research/scratchpad/export
   * Export scratchpad items in various formats
   * Requirements: 12.2, 12.3
   */
  @Post('export')
  @HttpCode(HttpStatus.OK)
  async exportItems(@Body() request: ExportRequest): Promise<ExportResponse> {
    return await this.scratchpadItemService.exportItems(request);
  }
}
