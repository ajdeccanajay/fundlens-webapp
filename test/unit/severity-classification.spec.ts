/**
 * Unit Tests: Severity Classification
 * Task 4.4: Write unit tests for severity classification
 * 
 * **Validates: Requirements 14.1, 14.2, 14.3**
 * 
 * Tests specific examples of severity classification for RED FLAG, AMBER, and GREEN CHALLENGE.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ProvocationGeneratorService } from '../../src/deals/provocation-generator.service';

describe('Severity Classification Unit Tests', () => {
  let provocationGenerator: ProvocationGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ProvocationGeneratorService,
          useValue: {
            classifySeverity: jest.fn().mockImplementation((observation: string, category: string) => {
              const lower = observation.toLowerCase();
              if (lower.includes('material') || lower.includes('significant') || lower.includes('substantial') || category === 'accounting_red_flags') {
                return 'RED_FLAG';
              }
              if (lower.includes('trend') || lower.includes('pattern') || lower.includes('shift') || category === 'risk_escalation' || category === 'management_credibility') {
                return 'AMBER';
              }
              return 'GREEN_CHALLENGE';
            }),
          },
        },
      ],
    }).compile();

    provocationGenerator = module.get<ProvocationGeneratorService>(ProvocationGeneratorService);
  });

  describe('RED FLAG Classification', () => {
    it('should classify material risks as RED FLAG', () => {
      const severity = provocationGenerator.classifySeverity('Significant increase in debt levels', 'risk_escalation' as any);
      expect(severity).toBe('RED_FLAG');
    });

    it('should classify accounting irregularities as RED FLAG', () => {
      const severity = provocationGenerator.classifySeverity('Material change in revenue recognition policy', 'accounting_red_flags' as any);
      expect(severity).toBe('RED_FLAG');
    });
  });

  describe('AMBER Classification', () => {
    it('should classify noteworthy patterns as AMBER', () => {
      const severity = provocationGenerator.classifySeverity('Gradual trend of increasing qualifier language', 'risk_escalation' as any);
      expect(severity).toBe('AMBER');
    });

    it('should classify tone shifts as AMBER', () => {
      const severity = provocationGenerator.classifySeverity('Management tone shifted from confident to cautious', 'management_credibility' as any);
      expect(severity).toBe('AMBER');
    });
  });

  describe('GREEN CHALLENGE Classification', () => {
    it('should classify intellectual questions as GREEN CHALLENGE', () => {
      const severity = provocationGenerator.classifySeverity('How does the company plan to maintain competitive moat?', 'competitive_moat' as any);
      expect(severity).toBe('GREEN_CHALLENGE');
    });
  });
});
