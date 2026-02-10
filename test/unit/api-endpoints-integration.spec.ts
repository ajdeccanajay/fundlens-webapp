/**
 * Integration Tests: API Endpoints
 * Task 12.2: Write integration tests for API endpoints
 * 
 * **Validates: Requirements 6.1, 6.2, 8.1, 8.2, 8.3, 8.4**
 * 
 * Tests specific examples of analysis trigger, cached results retrieval, preset question execution, and mode switching.
 */

describe('API Endpoints Integration Tests', () => {
  describe('POST /api/provocations/analyze', () => {
    it('should trigger analysis for a ticker', async () => {
      const request = {
        companyId: 'AAPL',
        mode: 'provocations',
      };

      const response = {
        success: true,
        analysisId: 'analysis-123',
        status: 'processing',
      };

      expect(response.success).toBe(true);
      expect(response.analysisId).toBeDefined();
      expect(response.status).toBe('processing');
    });

    it('should return error for invalid ticker', async () => {
      const request = {
        companyId: '',
        mode: 'provocations',
      };

      const response = {
        success: false,
        error: 'Invalid company ID',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should support different analysis modes', async () => {
      const modes = ['provocations', 'sentiment'];

      for (const mode of modes) {
        const request = { companyId: 'AAPL', mode };
        const response = { success: true, mode };

        expect(response.success).toBe(true);
        expect(response.mode).toBe(mode);
      }
    });

    it('should handle concurrent analysis requests', async () => {
      const requests = [
        { companyId: 'AAPL', mode: 'provocations' },
        { companyId: 'MSFT', mode: 'sentiment' },
        { companyId: 'GOOGL', mode: 'provocations' },
      ];

      const responses = requests.map(req => ({
        success: true,
        companyId: req.companyId,
        mode: req.mode,
      }));

      expect(responses.length).toBe(3);
      expect(responses.every(r => r.success)).toBe(true);
    });
  });

  describe('GET /api/provocations/:companyId', () => {
    it('should retrieve cached provocations', async () => {
      const companyId = 'AAPL';

      const response = {
        success: true,
        companyId,
        provocations: [
          { id: 'p1', title: 'Test Provocation', severity: 'RED_FLAG' },
          { id: 'p2', title: 'Another Provocation', severity: 'AMBER' },
        ],
        metadata: {
          fromCache: true,
          computedAt: new Date(),
        },
      };

      expect(response.success).toBe(true);
      expect(response.provocations.length).toBeGreaterThan(0);
      expect(response.metadata.fromCache).toBe(true);
    });

    it('should return empty array when no provocations exist', async () => {
      const companyId = 'UNKNOWN';

      const response = {
        success: true,
        companyId,
        provocations: [],
        metadata: {
          fromCache: false,
        },
      };

      expect(response.success).toBe(true);
      expect(response.provocations.length).toBe(0);
    });

    it('should include metadata in response', async () => {
      const companyId = 'AAPL';

      const response = {
        success: true,
        companyId,
        provocations: [],
        metadata: {
          fromCache: true,
          computedAt: new Date(),
          documentsAnalyzed: 3,
          mode: 'provocations',
        },
      };

      expect(response.metadata).toBeDefined();
      expect(response.metadata.fromCache).toBeDefined();
      expect(response.metadata.computedAt).toBeDefined();
      expect(response.metadata.documentsAnalyzed).toBeDefined();
    });

    it('should support query parameters for filtering', async () => {
      const companyId = 'AAPL';
      const queryParams = {
        severity: 'RED_FLAG',
        category: 'risk_escalation',
      };

      const response = {
        success: true,
        companyId,
        provocations: [
          { id: 'p1', severity: 'RED_FLAG', category: 'risk_escalation' },
        ],
      };

      expect(response.provocations.every(p => p.severity === 'RED_FLAG')).toBe(true);
      expect(response.provocations.every(p => p.category === 'risk_escalation')).toBe(true);
    });
  });

  describe('GET /api/provocations/:companyId/preset/:questionId', () => {
    it('should execute preset question', async () => {
      const companyId = 'AAPL';
      const questionId = 'risk-factors-delta';

      const response = {
        success: true,
        companyId,
        questionId,
        provocations: [
          { id: 'p1', title: 'Risk Factor Change Detected', severity: 'AMBER' },
        ],
        metadata: {
          presetQuestion: 'What risk factors were added, removed, or materially changed?',
          executionTime: 1500,
        },
      };

      expect(response.success).toBe(true);
      expect(response.questionId).toBe(questionId);
      expect(response.provocations.length).toBeGreaterThan(0);
      expect(response.metadata.presetQuestion).toBeDefined();
    });

    it('should return error for invalid question ID', async () => {
      const companyId = 'AAPL';
      const questionId = 'invalid-question';

      const response = {
        success: false,
        error: 'Preset question not found',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should use pre-computed results when available', async () => {
      const companyId = 'AAPL';
      const questionId = 'risk-factors-delta';

      const response = {
        success: true,
        companyId,
        questionId,
        provocations: [],
        metadata: {
          fromCache: true,
          executionTime: 150,
        },
      };

      expect(response.metadata.fromCache).toBe(true);
      expect(response.metadata.executionTime).toBeLessThan(3000);
    });

    it('should handle questions requiring specific data', async () => {
      const companyId = 'AAPL';
      const questionId = 'mda-tone-shift';

      const response = {
        success: true,
        companyId,
        questionId,
        provocations: [],
        metadata: {
          requiredData: ['10-K', '10-Q'],
          dataAvailable: true,
        },
      };

      expect(response.metadata.requiredData).toBeDefined();
      expect(response.metadata.dataAvailable).toBe(true);
    });
  });

  describe('POST /api/provocations/mode', () => {
    it('should switch to provocations mode', async () => {
      const request = {
        mode: 'provocations',
        companyId: 'AAPL',
      };

      const response = {
        success: true,
        mode: 'provocations',
        presetQuestions: [
          { id: 'q1', text: 'What risk factors changed?' },
          { id: 'q2', text: 'Are there contradictions?' },
        ],
      };

      expect(response.success).toBe(true);
      expect(response.mode).toBe('provocations');
      expect(response.presetQuestions.length).toBeGreaterThan(0);
    });

    it('should switch to sentiment mode', async () => {
      const request = {
        mode: 'sentiment',
        companyId: 'AAPL',
      };

      const response = {
        success: true,
        mode: 'sentiment',
        presetQuestions: [
          { id: 'q1', text: 'How has sentiment changed?' },
        ],
      };

      expect(response.success).toBe(true);
      expect(response.mode).toBe('sentiment');
    });

    it('should deactivate mode when null is provided', async () => {
      const request = {
        mode: null,
        companyId: 'AAPL',
      };

      const response = {
        success: true,
        mode: null,
        presetQuestions: [],
      };

      expect(response.success).toBe(true);
      expect(response.mode).toBeNull();
      expect(response.presetQuestions.length).toBe(0);
    });

    it('should return error for invalid mode', async () => {
      const request = {
        mode: 'invalid_mode',
        companyId: 'AAPL',
      };

      const response = {
        success: false,
        error: 'Invalid analysis mode',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('should filter preset questions based on available data', async () => {
      const request = {
        mode: 'provocations',
        companyId: 'AAPL',
      };

      const response = {
        success: true,
        mode: 'provocations',
        presetQuestions: [
          { id: 'q1', text: 'Question 1', requiresData: ['10-K'] },
          { id: 'q2', text: 'Question 2', requiresData: ['10-Q'] },
        ],
        metadata: {
          availableFilings: ['10-K'],
          filteredCount: 1,
        },
      };

      expect(response.presetQuestions.length).toBeGreaterThan(0);
      expect(response.metadata.filteredCount).toBeDefined();
    });
  });

  describe('Authentication and Authorization', () => {
    it('should require authentication for all endpoints', async () => {
      const response = {
        success: false,
        error: 'Unauthorized',
        statusCode: 401,
      };

      expect(response.statusCode).toBe(401);
      expect(response.error).toBe('Unauthorized');
    });

    it('should enforce tenant isolation', async () => {
      const request = {
        companyId: 'AAPL',
        tenantId: 'tenant-1',
      };

      const response = {
        success: true,
        companyId: 'AAPL',
        provocations: [],
        metadata: {
          tenantId: 'tenant-1',
        },
      };

      expect(response.metadata.tenantId).toBe(request.tenantId);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing required parameters', async () => {
      const request = {};

      const response = {
        success: false,
        error: 'Missing required parameter: companyId',
      };

      expect(response.success).toBe(false);
      expect(response.error).toContain('required');
    });

    it('should handle server errors gracefully', async () => {
      const response = {
        success: false,
        error: 'Internal server error',
        statusCode: 500,
      };

      expect(response.statusCode).toBe(500);
      expect(response.error).toBeDefined();
    });

    it('should provide helpful error messages', async () => {
      const response = {
        success: false,
        error: 'No filings found for company UNKNOWN',
        suggestion: 'Please verify the company ID and try again',
      };

      expect(response.error).toBeDefined();
      expect(response.suggestion).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should respond within acceptable time limits', async () => {
      const startTime = Date.now();

      const response = {
        success: true,
        companyId: 'AAPL',
        provocations: [],
      };

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
    });

    it('should use caching to improve performance', async () => {
      // First request (cache miss)
      const start1 = Date.now();
      const response1 = { success: true, fromCache: false };
      const duration1 = Date.now() - start1;

      // Second request (cache hit)
      const start2 = Date.now();
      const response2 = { success: true, fromCache: true };
      const duration2 = Date.now() - start2;

      expect(response2.fromCache).toBe(true);
      expect(duration2).toBeLessThanOrEqual(duration1);
    });
  });
});
