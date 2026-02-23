import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';

// Mock PrismaService
const mockPrisma = {
  narrativeChunk: { count: jest.fn() },
  calculatedMetric: { findMany: jest.fn(), upsert: jest.fn() },
  secFiling: { findMany: jest.fn() },
} as any;

describe('FinancialCalculatorService.evaluateFormula', () => {
  let service: FinancialCalculatorService;

  beforeEach(() => {
    service = new FinancialCalculatorService(mockPrisma);
    jest.restoreAllMocks();
  });

  it('should call Python /calculate and return result with audit trail', async () => {
    const mockResponse = {
      result: 41.6667,
      audit_trail: {
        formula: 'gross_profit / revenue * 100',
        inputs: { gross_profit: 50000000, revenue: 120000000 },
        intermediate_steps: ['Formula: gross_profit / revenue * 100', 'Result: 41.6667'],
        result: 41.6667,
        execution_time_ms: 0.5,
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    }) as any;

    const result = await service.evaluateFormula(
      'gross_profit / revenue * 100',
      { gross_profit: 50000000, revenue: 120000000 },
    );

    expect(result.result).toBe(41.6667);
    expect('audit_trail' in result).toBe(true);
    expect((result as any).audit_trail.formula).toBe('gross_profit / revenue * 100');
  });

  it('should return null with error when Python returns an error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: 'Division by zero in formula evaluation' }),
    }) as any;

    const result = await service.evaluateFormula('a / b', { a: 10, b: 0 });

    expect(result.result).toBeNull();
    expect('error' in result).toBe(true);
    expect((result as any).error).toContain('Division by zero');
  });

  it('should return null with error when Python is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    const result = await service.evaluateFormula('a + b', { a: 1, b: 2 });

    expect(result.result).toBeNull();
    expect('error' in result).toBe(true);
    expect((result as any).error).toContain('unreachable');
  });

  it('should pass formula and inputs to fetch correctly', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ result: 30, audit_trail: {} }),
    }) as any;

    await service.evaluateFormula('a * b', { a: 5, b: 6 });

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toContain('/calculate');
    const body = JSON.parse(fetchCall[1].body);
    expect(body.formula).toBe('a * b');
    expect(body.inputs).toEqual({ a: 5, b: 6 });
  });

  it('should handle negative results', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({
        result: -50,
        audit_trail: { formula: 'a + b', inputs: { a: -100, b: 50 }, result: -50 },
      }),
    }) as any;

    const result = await service.evaluateFormula('a + b', { a: -100, b: 50 });
    expect(result.result).toBe(-50);
  });
});
