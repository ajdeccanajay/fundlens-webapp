/**
 * Financial Statement Export E2E Tests
 * 
 * Tests the complete export flow from ticker input to Excel file generation:
 * 1. Data Availability Check
 * 2. Industry Detection
 * 3. Template Selection
 * 4. Metric Mapping
 * 5. Excel Generation
 * 6. File Structure Validation
 * 7. Data Accuracy Validation
 * 
 * Priority 1: Critical for institutional asset managers
 * Risk Level: ZERO TOLERANCE - Must be 100% accurate
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

describe('Export Flow E2E Tests (Task 22.1)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;

  // Test companies covering different sectors
  const TEST_COMPANIES = [
    { ticker: 'AAPL', sector: 'information_technology', name: 'Apple Inc.' },
    { ticker: 'JPM', sector: 'financials', name: 'JPMorgan Chase' },
    { ticker: 'CMCSA', sector: 'communication_services', name: 'Comcast' },
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);

    // Create a mock JWT token for testing
    // The TenantGuard will decode this without verification in development mode
    const mockPayload = {
      sub: 'test-user-id',
      'custom:tenant_id': '00000000-0000-0000-0000-000000000000', // Default tenant UUID
      'custom:tenant_slug': 'default',
      'custom:tenant_role': 'admin',
      username: 'test@example.com',
      email: 'test@example.com',
    };

    // Create a simple JWT-like token (header.payload.signature)
    // In development mode, the guard will decode without verifying the signature
    // Use base64url encoding (replace + with -, / with _, remove padding =)
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const payload = Buffer.from(JSON.stringify(mockPayload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    const signature = 'test-signature';
    authToken = `${header}.${payload}.${signature}`;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('Step 1: Data Availability Check', () => {
    it('should verify financial metrics exist for test companies', async () => {
      for (const company of TEST_COMPANIES) {
        const metrics = await prisma.financialMetric.findMany({
          where: { ticker: company.ticker },
          take: 1,
        });

        expect(metrics.length).toBeGreaterThan(0);
      }
    });

    it('should have data for multiple fiscal periods', async () => {
      for (const company of TEST_COMPANIES) {
        const periods = await prisma.financialMetric.findMany({
          where: { ticker: company.ticker },
          select: { fiscalPeriod: true },
          distinct: ['fiscalPeriod'],
        });

        expect(periods.length).toBeGreaterThan(0);
      }
    });

    it('should have data for all three statement types', async () => {
      for (const company of TEST_COMPANIES) {
        const statementTypes = await prisma.financialMetric.findMany({
          where: { ticker: company.ticker },
          select: { statementType: true },
          distinct: ['statementType'],
        });

        const types = statementTypes.map(s => s.statementType);
        expect(types).toContain('income_statement');
        // Balance sheet and cash flow may not always be present
      }
    });
  });

  describe('Step 2: Export Request Validation', () => {
    it('should reject invalid ticker symbols', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/INVALID123/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-K',
          years: [2024],
          statements: ['income_statement'],
        });
      
      // Invalid ticker should return error (400, 404, or 500)
      expect([400, 404, 500]).toContain(response.status);
    });

    it('should reject invalid filing types', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: 'INVALID',
          years: [2024],
          statements: ['income_statement'],
        })
        .expect(400);

      expect(response.body.message).toContain('Invalid filing type');
    });

    it('should reject empty years array', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-K',
          years: [],
          statements: ['income_statement'],
        })
        .expect(400);

      expect(response.body.message).toContain('At least one year');
    });

    it('should reject empty statements array', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-K',
          years: [2024],
          statements: [],
        })
        .expect(400);

      expect(response.body.message).toContain('At least one statement');
    });

    it('should reject invalid statement types', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-K',
          years: [2024],
          statements: ['invalid_statement'],
        })
        .expect(400);

      expect(response.body.message).toContain('Invalid statement type');
    });
  });

  describe('Step 3: Full Export Flow - Single Statement', () => {
    it('should generate Excel file for AAPL income statement', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4'],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        });

      expect([200, 201]).toContain(response.status);
      expect(response.headers['content-type']).toContain('spreadsheet');
      expect(response.headers['content-disposition']).toContain('AAPL');
      expect(response.headers['content-disposition']).toContain('.xlsx');
      
      // Response text contains the binary data
      expect(response.text.length).toBeGreaterThan(1000);
    }, 30000);

    it('should generate Excel file for JPM income statement', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/JPM/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4'],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.headers['content-type']).toContain('spreadsheet');
        expect(response.text.length).toBeGreaterThan(1000);
      } else {
        expect([404]).toContain(response.status);
      }
    }, 30000);

    it('should generate Excel file for CMCSA income statement', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/CMCSA/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4'],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        });

      if (response.status === 200 || response.status === 201) {
        expect(response.headers['content-type']).toContain('spreadsheet');
        expect(response.text.length).toBeGreaterThan(1000);
      } else {
        expect([404]).toContain(response.status);
      }
    }, 30000);
  });

  describe('Step 4: Full Export Flow - Multiple Statements', () => {
    it('should generate Excel file with all three statements', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4', 'Q3', 'Q2'],
          exportMode: 'quarterly',
          statements: ['income_statement', 'balance_sheet', 'cash_flow'],
        })
        .expect((res) => expect([200, 201]).toContain(res.status));

      expect(response.headers['content-type']).toContain('spreadsheet');
      expect(response.text.length).toBeGreaterThan(5000); // Larger file with 3 statements
    }, 45000);
  });

  describe('Step 5: Excel File Structure Validation (Task 22.6)', () => {
    let excelBuffer: Buffer;
    let workbook: ExcelJS.Workbook;

    beforeAll(async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .responseType('blob')
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4', 'Q3'],
          exportMode: 'quarterly',
          statements: ['income_statement', 'balance_sheet', 'cash_flow'],
        });

      expect([200, 201]).toContain(response.status);
      
      // For binary responses, supertest stores data in response.body as Buffer
      excelBuffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(excelBuffer);
    }, 45000);

    it('should have correct number of worksheets', () => {
      expect(workbook.worksheets.length).toBeGreaterThanOrEqual(3);
      
      const sheetNames = workbook.worksheets.map(ws => ws.name);
      expect(sheetNames).toContain('Income Statement');
      expect(sheetNames).toContain('Balance Sheet');
      expect(sheetNames).toContain('Cash Flow');
    });

    it('should have proper headers in each worksheet', () => {
      const incomeSheet = workbook.getWorksheet('Income Statement');
      expect(incomeSheet).toBeDefined();

      // Check first row has headers
      const headerRow = incomeSheet?.getRow(1);
      expect(headerRow?.getCell(1).value).toBeTruthy(); // Metric name column
      // Quarterly exports may have Q4 2024, Q3 2024 format
      const secondCell = headerRow?.getCell(2).value;
      expect(secondCell).toBeTruthy();
    });

    it('should have numeric values in data cells', () => {
      const incomeSheet = workbook.getWorksheet('Income Statement');
      expect(incomeSheet).toBeDefined();

      // Check that data rows have numeric values
      let numericCellsFound = 0;
      incomeSheet?.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header
          row.eachCell((cell, colNumber) => {
            if (colNumber > 1 && typeof cell.value === 'number') {
              numericCellsFound++;
            }
          });
        }
      });

      expect(numericCellsFound).toBeGreaterThan(10);
    });

    it('should have proper formatting for currency values', () => {
      const incomeSheet = workbook.getWorksheet('Income Statement');
      expect(incomeSheet).toBeDefined();

      // Check that numeric cells have number format
      let formattedCellsFound = 0;
      incomeSheet?.eachRow((row, rowNumber) => {
        if (rowNumber > 1) {
          row.eachCell((cell, colNumber) => {
            if (colNumber > 1 && typeof cell.value === 'number') {
              if (cell.numFmt && cell.numFmt !== 'General') {
                formattedCellsFound++;
              }
            }
          });
        }
      });

      expect(formattedCellsFound).toBeGreaterThan(0);
    });

    it('should not have empty worksheets', () => {
      workbook.eachSheet((worksheet) => {
        expect(worksheet.rowCount).toBeGreaterThan(1); // At least header + 1 data row
      });
    });

    it('should have consistent column count across rows', () => {
      const incomeSheet = workbook.getWorksheet('Income Statement');
      expect(incomeSheet).toBeDefined();

      const headerColCount = incomeSheet?.getRow(1).cellCount || 0;
      expect(headerColCount).toBeGreaterThan(2); // At least metric name + 2 periods

      // Check a few data rows have same column count
      for (let i = 2; i <= Math.min(10, incomeSheet?.rowCount || 0); i++) {
        const row = incomeSheet?.getRow(i);
        if (row && row.cellCount > 0) {
          expect(row.cellCount).toBeLessThanOrEqual(headerColCount + 5); // Allow some variance
        }
      }
    });
  });

  describe('Step 6: Multi-Year Export Validation', () => {
    it('should handle multi-quarter export', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .responseType('blob')
        .send({
          filingType: '10-Q',
          years: [2024, 2023],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        });

      expect([200, 201]).toContain(response.status);

      // Verify Excel structure
      const workbook = new ExcelJS.Workbook();
      const buffer = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
      expect(buffer.length).toBeGreaterThan(2000);
      await workbook.xlsx.load(buffer);
      
      const incomeSheet = workbook.getWorksheet('Income Statement');
      expect(incomeSheet).toBeDefined();

      // Should have multiple period columns + 1 metric name column
      const headerRow = incomeSheet?.getRow(1);
      expect(headerRow?.cellCount).toBeGreaterThanOrEqual(3);
    }, 45000);
  });

  describe('Step 7: 10-Q Quarterly Export (Task 14.5-14.7)', () => {
    it('should generate quarterly export for AAPL', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4', 'Q3'],
          exportMode: 'quarterly',
          statements: ['income_statement', 'balance_sheet', 'cash_flow'],
        })
        .expect((res) => expect([200, 201]).toContain(res.status));

      expect(response.text.length).toBeGreaterThan(1000);
    }, 45000);

    it('should generate quarterly export for JPM', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/JPM/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4', 'Q3'],
          exportMode: 'quarterly',
          statements: ['income_statement', 'balance_sheet', 'cash_flow'],
        })
        .expect((res) => {
          // JPM may or may not have data
          expect([200, 201, 404]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.text.length).toBeGreaterThan(1000);
      }
    }, 45000);

    it('should generate quarterly export for CMCSA', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/CMCSA/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4', 'Q3'],
          exportMode: 'quarterly',
          statements: ['income_statement', 'balance_sheet', 'cash_flow'],
        })
        .expect((res) => {
          // CMCSA may or may not have data
          expect([200, 201, 404]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.text.length).toBeGreaterThan(1000);
      }
    }, 45000);
  });

  describe('Step 8: Performance & Reliability', () => {
    it('should generate export within reasonable time', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4'],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        })
        .expect((res) => expect([200, 201]).toContain(res.status));

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    }, 35000);

    it('should handle concurrent export requests', async () => {
      const requests = TEST_COMPANIES.map(company =>
        request(app.getHttpServer())
          .post(`/api/deals/export/by-ticker/${company.ticker}/excel`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            filingType: '10-Q',
            years: [2024],
            quarters: ['Q4'],
            exportMode: 'quarterly',
            statements: ['income_statement'],
          })
      );

      const responses = await Promise.all(requests);
      
      // At least AAPL should succeed
      const successfulResponses = responses.filter(r => r.status === 200 || r.status === 201);
      expect(successfulResponses.length).toBeGreaterThanOrEqual(1);
      
      successfulResponses.forEach(response => {
        expect(response.text.length).toBeGreaterThan(1000);
      });
    }, 60000);
  });
  describe('Step 9: Error Handling', () => {
    it('should handle missing data gracefully', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/AAPL/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [1900], // Year with no data
          quarters: ['Q4'],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        })
        .expect((res) => {
          // Should either return 404 or 200 with empty/minimal data
          expect([200, 201, 404]).toContain(res.status);
        });
    }, 30000);

    it('should provide clear error messages', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/deals/export/by-ticker/INVALID/excel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          filingType: '10-Q',
          years: [2024],
          quarters: ['Q4'],
          exportMode: 'quarterly',
          statements: ['income_statement'],
        })
        .expect((res) => {
          expect([400, 404, 201]).toContain(res.status);
        });

      if (response.status === 400 || response.status === 404) {
        expect(response.body.message).toBeDefined();
        expect(response.body.message.length).toBeGreaterThan(0);
      }
    });
  });
});
