import { Controller, Get, Post, Body, Logger } from '@nestjs/common';

/**
 * Test Controller for Deals Module
 * Simple endpoints to verify the module is working
 */
@Controller('deals-test')
export class DealsTestController {
  private readonly logger = new Logger(DealsTestController.name);

  @Get('health')
  getHealth() {
    return {
      success: true,
      message: 'Deals module is working!',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('echo')
  echo(@Body() body: any) {
    this.logger.log('Echo endpoint called');
    return {
      success: true,
      message: 'Echo successful',
      data: body,
    };
  }
}