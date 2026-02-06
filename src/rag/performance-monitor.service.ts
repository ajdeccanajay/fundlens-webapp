import { Injectable, Logger } from '@nestjs/common';

/**
 * Performance Monitoring Service
 * 
 * Tracks query latencies and provides p95 calculations and warnings.
 * Used to monitor RAG system performance against the <5s target.
 */

export interface PerformanceMetrics {
  totalQueries: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  maxLatency: number;
  minLatency: number;
  queriesOver5s: number;
  queriesOver10s: number;
  queriesOver30s: number;
  timeouts: number;
}

export interface QueryPerformanceLog {
  query: string;
  latency: number;
  timestamp: Date;
  queryType: string;
  ticker?: string;
  metricsCount: number;
  narrativesCount: number;
}

@Injectable()
export class PerformanceMonitorService {
  private readonly logger = new Logger(PerformanceMonitorService.name);
  
  // Circular buffer to store last N query latencies
  private readonly maxBufferSize = 1000;
  private latencies: number[] = [];
  private queryLogs: QueryPerformanceLog[] = [];
  
  // Performance thresholds (in milliseconds)
  private readonly TARGET_LATENCY = 5000; // 5 seconds
  private readonly WARNING_LATENCY = 10000; // 10 seconds
  private readonly CRITICAL_LATENCY = 30000; // 30 seconds
  
  /**
   * Record a query's performance
   */
  recordQuery(log: QueryPerformanceLog): void {
    // Add to latency buffer
    this.latencies.push(log.latency);
    if (this.latencies.length > this.maxBufferSize) {
      this.latencies.shift(); // Remove oldest
    }
    
    // Add to query logs
    this.queryLogs.push(log);
    if (this.queryLogs.length > this.maxBufferSize) {
      this.queryLogs.shift(); // Remove oldest
    }
    
    // Log warnings for slow queries
    if (log.latency > this.CRITICAL_LATENCY) {
      this.logger.error(
        `🚨 CRITICAL: Query took ${(log.latency / 1000).toFixed(2)}s (>${this.CRITICAL_LATENCY / 1000}s threshold): "${log.query.substring(0, 100)}..."`,
      );
    } else if (log.latency > this.WARNING_LATENCY) {
      this.logger.warn(
        `⚠️  WARNING: Query took ${(log.latency / 1000).toFixed(2)}s (>${this.WARNING_LATENCY / 1000}s threshold): "${log.query.substring(0, 100)}..."`,
      );
    } else if (log.latency > this.TARGET_LATENCY) {
      this.logger.log(
        `⏱️  SLOW: Query took ${(log.latency / 1000).toFixed(2)}s (>${this.TARGET_LATENCY / 1000}s target): "${log.query.substring(0, 100)}..."`,
      );
    }
  }
  
  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }
  
  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    if (this.latencies.length === 0) {
      return {
        totalQueries: 0,
        avgLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
        maxLatency: 0,
        minLatency: 0,
        queriesOver5s: 0,
        queriesOver10s: 0,
        queriesOver30s: 0,
        timeouts: 0,
      };
    }
    
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, val) => acc + val, 0);
    
    return {
      totalQueries: this.latencies.length,
      avgLatency: sum / this.latencies.length,
      p50Latency: this.calculatePercentile(sorted, 50),
      p95Latency: this.calculatePercentile(sorted, 95),
      p99Latency: this.calculatePercentile(sorted, 99),
      maxLatency: sorted[sorted.length - 1],
      minLatency: sorted[0],
      queriesOver5s: this.latencies.filter(l => l > 5000).length,
      queriesOver10s: this.latencies.filter(l => l > 10000).length,
      queriesOver30s: this.latencies.filter(l => l > 30000).length,
      timeouts: this.latencies.filter(l => l > 120000).length,
    };
  }
  
  /**
   * Get performance summary as formatted string
   */
  getSummary(): string {
    const metrics = this.getMetrics();
    
    if (metrics.totalQueries === 0) {
      return 'No queries recorded yet';
    }
    
    const p95Status = metrics.p95Latency <= this.TARGET_LATENCY ? '✅' : '❌';
    const p95Color = metrics.p95Latency <= this.TARGET_LATENCY ? 'green' : 'red';
    
    return `
Performance Summary (last ${metrics.totalQueries} queries):
  Average Latency: ${(metrics.avgLatency / 1000).toFixed(2)}s
  P50 Latency: ${(metrics.p50Latency / 1000).toFixed(2)}s
  P95 Latency: ${(metrics.p95Latency / 1000).toFixed(2)}s ${p95Status} (target: <5s)
  P99 Latency: ${(metrics.p99Latency / 1000).toFixed(2)}s
  Max Latency: ${(metrics.maxLatency / 1000).toFixed(2)}s
  Min Latency: ${(metrics.minLatency / 1000).toFixed(2)}s
  
  Queries > 5s: ${metrics.queriesOver5s} (${((metrics.queriesOver5s / metrics.totalQueries) * 100).toFixed(1)}%)
  Queries > 10s: ${metrics.queriesOver10s} (${((metrics.queriesOver10s / metrics.totalQueries) * 100).toFixed(1)}%)
  Queries > 30s: ${metrics.queriesOver30s} (${((metrics.queriesOver30s / metrics.totalQueries) * 100).toFixed(1)}%)
  Timeouts (>120s): ${metrics.timeouts}
    `.trim();
  }
  
  /**
   * Get slowest queries
   */
  getSlowestQueries(limit: number = 10): QueryPerformanceLog[] {
    return [...this.queryLogs]
      .sort((a, b) => b.latency - a.latency)
      .slice(0, limit);
  }
  
  /**
   * Export metrics for dashboard/monitoring
   */
  exportMetrics(): {
    metrics: PerformanceMetrics;
    slowestQueries: QueryPerformanceLog[];
    summary: string;
  } {
    return {
      metrics: this.getMetrics(),
      slowestQueries: this.getSlowestQueries(20),
      summary: this.getSummary(),
    };
  }
  
  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.latencies = [];
    this.queryLogs = [];
    this.logger.log('Performance metrics reset');
  }
  
  /**
   * Check if system is meeting performance targets
   */
  isHealthy(): boolean {
    const metrics = this.getMetrics();
    
    if (metrics.totalQueries < 10) {
      return true; // Not enough data yet
    }
    
    // System is healthy if:
    // 1. P95 latency < 5s
    // 2. No timeouts
    // 3. < 20% of queries over 10s
    return (
      metrics.p95Latency <= this.TARGET_LATENCY &&
      metrics.timeouts === 0 &&
      (metrics.queriesOver10s / metrics.totalQueries) < 0.2
    );
  }
  
  /**
   * Get health status with details
   */
  getHealthStatus(): {
    healthy: boolean;
    issues: string[];
    metrics: PerformanceMetrics;
  } {
    const metrics = this.getMetrics();
    const issues: string[] = [];
    
    if (metrics.totalQueries < 10) {
      return {
        healthy: true,
        issues: ['Not enough data yet (< 10 queries)'],
        metrics,
      };
    }
    
    if (metrics.p95Latency > this.TARGET_LATENCY) {
      issues.push(
        `P95 latency ${(metrics.p95Latency / 1000).toFixed(2)}s exceeds target of ${this.TARGET_LATENCY / 1000}s`,
      );
    }
    
    if (metrics.timeouts > 0) {
      issues.push(`${metrics.timeouts} queries timed out (>120s)`);
    }
    
    const slowQueryRate = metrics.queriesOver10s / metrics.totalQueries;
    if (slowQueryRate >= 0.2) {
      issues.push(
        `${(slowQueryRate * 100).toFixed(1)}% of queries exceed 10s (threshold: 20%)`,
      );
    }
    
    return {
      healthy: issues.length === 0,
      issues,
      metrics,
    };
  }
}
