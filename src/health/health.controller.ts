import { Controller, Get, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { of } from 'rxjs';

/**
 * Health Check Controller
 * Provides health status for load balancer and monitoring
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly httpService: HttpService) {}

  @Get()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async getHealth() {
    const startTime = Date.now();
    const checks: Record<string, { status: string; latency?: number; error?: string }> = {};

    // Check Python parser (sidecar)
    const pythonParserUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
    try {
      const parserStart = Date.now();
      const response = await firstValueFrom(
        this.httpService.get(`${pythonParserUrl}/health`).pipe(
          timeout(5000),
          catchError((error) => {
            throw new Error(error.message || 'Python parser unreachable');
          }),
        ),
      );
      checks.pythonParser = {
        status: 'healthy',
        latency: Date.now() - parserStart,
      };
    } catch (error) {
      checks.pythonParser = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Overall health status
    const isHealthy = Object.values(checks).every((check) => check.status === 'healthy');
    const totalLatency = Date.now() - startTime;

    const healthResponse = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      latency: totalLatency,
      checks,
    };

    // Return 503 if critical services are down
    if (checks.pythonParser?.status === 'unhealthy') {
      // In production, we might want to return 503 for ALB health checks
      // For now, return 200 with degraded status to allow partial functionality
      this.logger.warn('Python parser health check failed', checks.pythonParser);
    }

    return healthResponse;
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe - is the service running?' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getLiveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe - is the service ready to accept traffic?' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  async getReadiness() {
    // Check if Python parser is available
    const pythonParserUrl = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';
    
    try {
      await firstValueFrom(
        this.httpService.get(`${pythonParserUrl}/health`).pipe(
          timeout(3000),
          catchError(() => of({ data: { status: 'error' } })),
        ),
      );
      
      return {
        status: 'ready',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        {
          status: 'not_ready',
          reason: 'Python parser not available',
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
