/**
 * Research Assistant Controller
 * 
 * REST API endpoints for tenant-wide research conversations.
 * Supports Server-Sent Events (SSE) for streaming responses.
 * 
 * All endpoints protected by TenantGuard for isolation.
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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { TenantGuard } from '../tenant/tenant.guard';
import {
  ResearchAssistantService,
  type CreateConversationDto,
  type SendMessageDto,
} from './research-assistant.service';

@Controller('research')
@UseGuards(TenantGuard)
export class ResearchAssistantController {
  constructor(
    private readonly researchService: ResearchAssistantService,
  ) {}

  /**
   * Create new conversation
   * POST /api/research/conversations
   */
  @Post('conversations')
  async createConversation(@Body() dto: CreateConversationDto) {
    const conversation = await this.researchService.createConversation(dto);
    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * List conversations
   * GET /api/research/conversations
   */
  @Get('conversations')
  async getConversations(
    @Query('archived') archived?: string,
    @Query('pinned') pinned?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.researchService.getConversations({
      archived: archived === 'true',
      pinned: pinned === 'true',
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    return {
      success: true,
      data: result.conversations,
      pagination: {
        total: result.total,
        hasMore: result.hasMore,
        limit: limit ? parseInt(limit) : 50,
        offset: offset ? parseInt(offset) : 0,
      },
    };
  }

  /**
   * Get conversation by ID
   * GET /api/research/conversations/:id
   */
  @Get('conversations/:id')
  async getConversation(@Param('id') id: string) {
    const result = await this.researchService.getConversation(id);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Get messages for a conversation
   * GET /api/research/conversations/:id/messages
   */
  @Get('conversations/:id/messages')
  async getConversationMessages(@Param('id') conversationId: string) {
    const messages = await this.researchService.getConversationMessages(conversationId);
    return {
      success: true,
      data: messages,
    };
  }

  /**
   * Update conversation
   * PATCH /api/research/conversations/:id
   */
  @Patch('conversations/:id')
  async updateConversation(
    @Param('id') id: string,
    @Body() updates: {
      title?: string;
      isPinned?: boolean;
      isArchived?: boolean;
    },
  ) {
    const conversation = await this.researchService.updateConversation(id, updates);
    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * Delete conversation
   * DELETE /api/research/conversations/:id
   */
  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string) {
    await this.researchService.deleteConversation(id);
    return {
      success: true,
      message: 'Conversation deleted successfully',
    };
  }

  /**
   * Send message with streaming response
   * POST /api/research/conversations/:id/messages
   * 
   * Returns Server-Sent Events stream:
   * - event: token, data: { text: "..." }
   * - event: source, data: { title: "...", type: "..." }
   * - event: citations, data: { citations: [...] }
   * - event: visualization, data: { chartType: "...", ... }
   * - event: done, data: { complete: true }
   * - event: error, data: { message: "..." }
   */
  @Post('conversations/:id/messages')
  async sendMessage(
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // Set SSE headers manually (matching working instant-rag pattern)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    try {
      const stream = this.researchService.sendMessage(conversationId, dto);

      for await (const chunk of stream) {
        // Write proper SSE format: event + data + double newline
        res.write(`event: ${chunk.type}\ndata: ${JSON.stringify(chunk.data)}\n\n`);
      }

      // Send done event
      res.write(`event: done\ndata: ${JSON.stringify({ complete: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error('❌ SSE Error:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    }
  }

  /**
   * Search conversations
   * GET /api/research/conversations/search
   */
  @Get('conversations/search')
  async searchConversations(
    @Query('q') query: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // TODO: Implement full-text search
    // For now, return empty results
    return {
      success: true,
      data: {
        results: [],
        total: 0,
      },
    };
  }
}
