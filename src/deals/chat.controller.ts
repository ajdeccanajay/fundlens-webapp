/**
 * Chat Controller with Tenant Isolation
 * 
 * Handles chat interactions within deals with complete tenant isolation.
 * All endpoints are protected by TenantGuard and verify ownership through
 * the ChatService.
 * 
 * SECURITY: Returns 404 for cross-tenant access attempts to prevent
 * information leakage about resource existence.
 * 
 * Requirements: 3.6
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Logger,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ChatService, type SendMessageDto } from './chat.service';
import { TenantGuard } from '../tenant/tenant.guard';

/**
 * Chat Controller for AI Financial Analysis
 * All endpoints protected by TenantGuard
 */
@Controller('deals/:dealId/chat')
@UseGuards(TenantGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  /**
   * Send a message to AI
   * POST /api/deals/:dealId/chat/message
   * 
   * Session ownership is verified by ChatService
   */
  @Post('message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('dealId') dealId: string,
    @Body() body: { content: string; sessionId: string },
  ) {
    this.logger.log(`Sending message for deal: ${dealId}`);

    try {
      const result = await this.chatService.sendMessage({
        content: body.content,
        sessionId: body.sessionId,
      });

      return {
        success: true,
        data: result,
        message: 'Message processed successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to process message: ${error.message}`);
      // Let NestJS exception filters handle NotFoundException -> 404
      throw error;
    }
  }

  /**
   * Get conversation history
   * GET /api/deals/:dealId/chat/history
   * 
   * Deal ownership is verified by ChatService
   */
  @Get('history')
  async getConversationHistory(@Param('dealId') dealId: string) {
    try {
      const messages = await this.chatService.getConversationHistory(dealId);

      return {
        success: true,
        data: messages,
        message: `Retrieved ${messages.length} messages`,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch conversation history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get session details
   * GET /api/deals/:dealId/chat/session/:sessionId
   * 
   * Session ownership is verified by ChatService
   */
  @Get('session/:sessionId')
  async getSession(
    @Param('dealId') dealId: string,
    @Param('sessionId') sessionId: string,
  ) {
    try {
      const session = await this.chatService.getSessionById(sessionId);

      if (!session) {
        return {
          success: false,
          message: 'Session not found',
        };
      }

      return {
        success: true,
        data: session,
        message: 'Session retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update system prompt
   * PUT /api/deals/:dealId/chat/system-prompt
   * 
   * Session ownership is verified by ChatService
   */
  @Put('system-prompt')
  async updateSystemPrompt(
    @Param('dealId') dealId: string,
    @Body() body: { sessionId: string; systemPrompt: string },
  ) {
    this.logger.log(`Updating system prompt for deal: ${dealId}`);

    try {
      await this.chatService.updateSystemPrompt(body.sessionId, body.systemPrompt);

      return {
        success: true,
        message: 'System prompt updated successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to update system prompt: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clear conversation history
   * DELETE /api/deals/:dealId/chat/history
   * 
   * Session ownership is verified by ChatService
   */
  @Delete('history')
  async clearConversationHistory(
    @Param('dealId') dealId: string,
    @Body() body: { sessionId: string },
  ) {
    this.logger.log(`Clearing conversation history for deal: ${dealId}`);

    try {
      await this.chatService.clearConversationHistory(body.sessionId);

      return {
        success: true,
        message: 'Conversation history cleared successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to clear conversation history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get chat statistics
   * GET /api/deals/:dealId/chat/stats
   * 
   * Deal ownership is verified by ChatService
   */
  @Get('stats')
  async getChatStats(@Param('dealId') dealId: string) {
    try {
      const stats = await this.chatService.getChatStats(dealId);

      return {
        success: true,
        data: stats,
        message: 'Chat statistics retrieved successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to fetch chat stats: ${error.message}`);
      throw error;
    }
  }
}
