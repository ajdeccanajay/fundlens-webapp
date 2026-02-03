/**
 * Tenant Response Sanitization Unit Tests
 * 
 * Tests for API response sanitization and exception filtering.
 * Validates:
 * - Tenant ID removal from responses
 * - Error message sanitization
 * - 403 to 404 conversion for security
 */

import { TenantResponseInterceptor } from '../../src/tenant/tenant-response.interceptor';
import { TenantExceptionFilter } from '../../src/tenant/tenant-exception.filter';
import { ExecutionContext, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';

describe('TenantResponseInterceptor', () => {
  let interceptor: TenantResponseInterceptor;

  beforeEach(() => {
    interceptor = new TenantResponseInterceptor();
  });

  const createMockContext = (): ExecutionContext => ({
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({}),
      getResponse: jest.fn().mockReturnValue({}),
    }),
    getClass: jest.fn(),
    getHandler: jest.fn(),
    getArgs: jest.fn(),
    getArgByIndex: jest.fn(),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
    getType: jest.fn(),
  });

  const createMockCallHandler = (data: any) => ({
    handle: () => of(data),
  });

  describe('response sanitization', () => {
    it('should remove tenant_id from response', (done) => {
      const mockData = {
        id: 'deal-1',
        name: 'Test Deal',
        tenant_id: 'tenant-123',
        status: 'active',
      };

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result).not.toHaveProperty('tenant_id');
          expect(result.id).toBe('deal-1');
          expect(result.name).toBe('Test Deal');
          done();
        });
    });

    it('should remove tenantId from response', (done) => {
      const mockData = {
        id: 'deal-1',
        tenantId: 'tenant-123',
        name: 'Test Deal',
      };

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result).not.toHaveProperty('tenantId');
          expect(result.id).toBe('deal-1');
          done();
        });
    });

    it('should remove owner_tenant_id from response', (done) => {
      const mockData = {
        id: 'ds-1',
        type: 'sec-filing',
        owner_tenant_id: 'tenant-456',
        visibility: 'private',
      };

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result).not.toHaveProperty('owner_tenant_id');
          expect(result.visibility).toBe('private');
          done();
        });
    });

    it('should remove ownerTenantId from response', (done) => {
      const mockData = {
        id: 'ds-1',
        ownerTenantId: 'tenant-456',
      };

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result).not.toHaveProperty('ownerTenantId');
          done();
        });
    });

    it('should sanitize nested objects', (done) => {
      const mockData = {
        id: 'deal-1',
        tenant_id: 'tenant-123',
        owner: {
          id: 'user-1',
          tenant_id: 'tenant-123',
          name: 'John Doe',
        },
      };

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result).not.toHaveProperty('tenant_id');
          expect(result.owner).not.toHaveProperty('tenant_id');
          expect(result.owner.name).toBe('John Doe');
          done();
        });
    });

    it('should sanitize arrays', (done) => {
      const mockData = [
        { id: 'deal-1', tenant_id: 'tenant-123', name: 'Deal 1' },
        { id: 'deal-2', tenant_id: 'tenant-123', name: 'Deal 2' },
      ];

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result).toHaveLength(2);
          expect(result[0]).not.toHaveProperty('tenant_id');
          expect(result[1]).not.toHaveProperty('tenant_id');
          expect(result[0].name).toBe('Deal 1');
          done();
        });
    });

    it('should handle null and undefined', (done) => {
      interceptor
        .intercept(createMockContext(), createMockCallHandler(null))
        .subscribe((result) => {
          expect(result).toBeNull();
          done();
        });
    });

    it('should preserve Date objects', (done) => {
      const date = new Date('2026-01-18');
      const mockData = {
        id: 'deal-1',
        createdAt: date,
        tenant_id: 'tenant-123',
      };

      interceptor
        .intercept(createMockContext(), createMockCallHandler(mockData))
        .subscribe((result) => {
          expect(result.createdAt).toEqual(date);
          expect(result).not.toHaveProperty('tenant_id');
          done();
        });
    });

    it('should preserve primitive values', (done) => {
      interceptor
        .intercept(createMockContext(), createMockCallHandler('simple string'))
        .subscribe((result) => {
          expect(result).toBe('simple string');
          done();
        });
    });

    it('should preserve numbers', (done) => {
      interceptor
        .intercept(createMockContext(), createMockCallHandler(42))
        .subscribe((result) => {
          expect(result).toBe(42);
          done();
        });
    });
  });
});

describe('TenantExceptionFilter', () => {
  let filter: TenantExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new TenantExceptionFilter();
    
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    
    mockRequest = {
      url: '/api/v1/deals/123',
      method: 'GET',
    };
    
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  describe('403 to 404 conversion', () => {
    it('should convert ForbiddenException to 404', () => {
      const exception = new ForbiddenException('Access denied');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Resource not found',
        })
      );
    });

    it('should preserve NotFoundException as 404', () => {
      const exception = new NotFoundException('Deal not found');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Deal not found',
        })
      );
    });

    it('should preserve BadRequestException as 400', () => {
      const exception = new BadRequestException('Invalid input');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'Invalid input',
        })
      );
    });
  });

  describe('error message sanitization', () => {
    it('should remove tenant_id from error messages', () => {
      const exception = new BadRequestException(
        'Error for tenant_id: abc-123-def-456'
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).not.toContain('abc-123-def-456');
      expect(response.message).toContain('[redacted]');
    });

    it('should remove UUID-like tenant IDs', () => {
      const exception = new BadRequestException(
        'Error for tenant 12345678-1234-1234-1234-123456789abc'
      );

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message).not.toContain('12345678-1234-1234-1234-123456789abc');
    });

    it('should handle array messages', () => {
      const exception = new BadRequestException({
        message: ['tenant_id: abc-123 is invalid', 'Another error'],
        error: 'Bad Request',
      });

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.message[0]).toContain('[redacted]');
      expect(response.message[1]).toBe('Another error');
    });
  });

  describe('response format', () => {
    it('should include timestamp', () => {
      const exception = new NotFoundException('Not found');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.timestamp).toBeDefined();
      expect(new Date(response.timestamp)).toBeInstanceOf(Date);
    });

    it('should include request path', () => {
      const exception = new NotFoundException('Not found');

      filter.catch(exception, mockHost);

      const response = mockResponse.json.mock.calls[0][0];
      expect(response.path).toBe('/api/v1/deals/123');
    });
  });

  describe('unknown exceptions', () => {
    it('should handle non-HttpException errors', () => {
      const exception = new Error('Database connection failed');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        })
      );
    });

    it('should handle unknown exception types', () => {
      filter.catch('string exception', mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        })
      );
    });
  });
});

describe('Security Response Consistency', () => {
  let filter: TenantExceptionFilter;
  let mockResponse: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new TenantExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ url: '/test', method: 'GET' }),
      }),
    };
  });

  it('should return same response for non-existent and forbidden resources', () => {
    // Simulate accessing non-existent resource
    const notFoundException = new NotFoundException('Resource not found');
    filter.catch(notFoundException, mockHost);
    const notFoundResponse = mockResponse.json.mock.calls[0][0];

    // Reset mock
    mockResponse.json.mockClear();

    // Simulate accessing forbidden resource
    const forbiddenException = new ForbiddenException('Access denied');
    filter.catch(forbiddenException, mockHost);
    const forbiddenResponse = mockResponse.json.mock.calls[0][0];

    // Both should return 404 with similar message
    expect(notFoundResponse.statusCode).toBe(404);
    expect(forbiddenResponse.statusCode).toBe(404);
    // Messages should not reveal whether resource exists
    expect(forbiddenResponse.message).toBe('Resource not found');
  });
});
