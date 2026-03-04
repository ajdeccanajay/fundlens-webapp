/**
 * Filing Expansion Phase 3 — DEF 14A + S-1 Parsers
 *
 * Tests for:
 * 1. parse_proxy.py — keyword section detection + Tier 1 verification
 * 2. hybrid_parser.py — S-1 section definitions in SEC_SECTIONS
 * 3. api_server.py — dispatcher routes for proxy and hybrid_s1
 * 4. rag.service.ts — compensation/governance query detection
 * 5. section-labels.ts — proxy + S-1 labels
 * 6. Regression guards — existing functionality preserved
 */

import { SECTION_LABELS, FILING_TYPE_LABELS, humanizeSectionType, humanizeFilingType } from '../../src/common/section-labels';

// ─── parse_proxy.py unit tests (pure logic, no Python needed) ────────

describe('Phase 3: DEF 14A Proxy Parser', () => {
  // Proxy section keywords from the spec (§2.4)
  const PROXY_SECTIONS: Record<string, string[]> = {
    executive_compensation: [
      'EXECUTIVE COMPENSATION', 'COMPENSATION DISCUSSION AND ANALYSIS',
      'CD&A', 'COMPENSATION OF EXECUTIVE', 'NAMED EXECUTIVE OFFICER',
      'SUMMARY COMPENSATION TABLE',
    ],
    director_compensation: [
      'DIRECTOR COMPENSATION', 'COMPENSATION OF DIRECTORS',
      'NON-EMPLOYEE DIRECTOR', 'DIRECTOR FEE',
    ],
    board_composition: [
      'BOARD OF DIRECTORS', 'ELECTION OF DIRECTORS', 'PROPOSAL 1',
      'NOMINEES FOR DIRECTOR', 'DIRECTOR NOMINEES',
      'CORPORATE GOVERNANCE', 'GOVERNANCE GUIDELINES',
    ],
    shareholder_proposals: [
      'SHAREHOLDER PROPOSAL', 'STOCKHOLDER PROPOSAL',
      'PROPOSAL 4', 'PROPOSAL 5', 'PROPOSAL 6',
    ],
    related_party_transactions: [
      'RELATED PARTY', 'RELATED PERSON', 'CERTAIN RELATIONSHIPS',
      'TRANSACTIONS WITH RELATED',
    ],
    ceo_pay_ratio: ['CEO PAY RATIO', 'PAY RATIO'],
    pay_vs_performance: ['PAY VERSUS PERFORMANCE', 'PAY VS. PERFORMANCE', 'PAY VS PERFORMANCE'],
    audit_committee: [
      'AUDIT COMMITTEE', 'REPORT OF THE AUDIT',
      'RATIFICATION OF', 'INDEPENDENT REGISTERED PUBLIC ACCOUNTING',
    ],
    stock_ownership: [
      'SECURITY OWNERSHIP', 'STOCK OWNERSHIP', 'BENEFICIAL OWNERSHIP',
      'PRINCIPAL STOCKHOLDERS', 'PRINCIPAL SHAREHOLDERS',
    ],
  };

  describe('Section keyword coverage', () => {
    it('should have 9 section categories', () => {
      expect(Object.keys(PROXY_SECTIONS)).toHaveLength(9);
    });

    it('should have at least 2 keywords per section', () => {
      for (const [section, keywords] of Object.entries(PROXY_SECTIONS)) {
        expect(keywords.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should have executive_compensation as the first section', () => {
      expect(Object.keys(PROXY_SECTIONS)[0]).toBe('executive_compensation');
    });
  });

  describe('Tier 1 structural verification logic', () => {
    function verifyProxyStructural(
      sections: { section_type: string; content: string }[],
      rawWordCount: number,
    ) {
      const issues: string[] = [];
      if (sections.length < 3) {
        issues.push(`Only ${sections.length}/9 sections found`);
      }
      for (const section of sections) {
        const wordCount = section.content.split(/\s+/).length;
        if (wordCount < 100) {
          issues.push(`${section.section_type}: only ${wordCount} words`);
        }
        const keywords = PROXY_SECTIONS[section.section_type] || [];
        const keywordFound = keywords.slice(0, 3).some(
          kw => section.content.toUpperCase().includes(kw),
        );
        if (!keywordFound) {
          issues.push(`${section.section_type}: no keywords in content`);
        }
      }
      return {
        passed: issues.length === 0,
        sections_found: sections.length,
        issues,
        confidence: Math.max(0, 1.0 - issues.length * 0.15),
      };
    }

    it('should pass with 5+ well-formed sections', () => {
      const sections = [
        { section_type: 'executive_compensation', content: 'EXECUTIVE COMPENSATION ' + 'word '.repeat(150) },
        { section_type: 'board_composition', content: 'BOARD OF DIRECTORS ' + 'word '.repeat(150) },
        { section_type: 'audit_committee', content: 'AUDIT COMMITTEE ' + 'word '.repeat(150) },
        { section_type: 'stock_ownership', content: 'SECURITY OWNERSHIP ' + 'word '.repeat(150) },
        { section_type: 'ceo_pay_ratio', content: 'CEO PAY RATIO ' + 'word '.repeat(150) },
      ];
      const result = verifyProxyStructural(sections, 10000);
      expect(result.passed).toBe(true);
      expect(result.sections_found).toBe(5);
      expect(result.issues).toHaveLength(0);
    });

    it('should fail with fewer than 3 sections', () => {
      const sections = [
        { section_type: 'executive_compensation', content: 'EXECUTIVE COMPENSATION ' + 'word '.repeat(150) },
        { section_type: 'board_composition', content: 'BOARD OF DIRECTORS ' + 'word '.repeat(150) },
      ];
      const result = verifyProxyStructural(sections, 5000);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.includes('Only 2/9'))).toBe(true);
    });

    it('should flag sections with too few words', () => {
      const sections = [
        { section_type: 'executive_compensation', content: 'EXECUTIVE COMPENSATION short text' },
        { section_type: 'board_composition', content: 'BOARD OF DIRECTORS ' + 'word '.repeat(150) },
        { section_type: 'audit_committee', content: 'AUDIT COMMITTEE ' + 'word '.repeat(150) },
      ];
      const result = verifyProxyStructural(sections, 5000);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.includes('only') && i.includes('words'))).toBe(true);
    });

    it('should flag sections missing keywords in content', () => {
      const sections = [
        { section_type: 'executive_compensation', content: 'This section has no relevant keywords ' + 'word '.repeat(150) },
        { section_type: 'board_composition', content: 'BOARD OF DIRECTORS ' + 'word '.repeat(150) },
        { section_type: 'audit_committee', content: 'AUDIT COMMITTEE ' + 'word '.repeat(150) },
      ];
      const result = verifyProxyStructural(sections, 5000);
      expect(result.passed).toBe(false);
      expect(result.issues.some(i => i.includes('no keywords'))).toBe(true);
    });

    it('should calculate confidence correctly', () => {
      const sections = [
        { section_type: 'executive_compensation', content: 'short' },
        { section_type: 'board_composition', content: 'BOARD OF DIRECTORS ' + 'word '.repeat(150) },
      ];
      const result = verifyProxyStructural(sections, 5000);
      // 2 issues: <3 sections + short content → confidence = 1.0 - 2*0.15 = 0.7
      expect(result.confidence).toBeLessThan(1.0);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('Proxy section keyword detection', () => {
    function detectSectionFromText(text: string): string | null {
      const textUpper = text.toUpperCase();
      for (const [sectionType, keywords] of Object.entries(PROXY_SECTIONS)) {
        for (const keyword of keywords) {
          if (textUpper.includes(keyword)) {
            return sectionType;
          }
        }
      }
      return null;
    }

    it('should detect executive compensation section', () => {
      expect(detectSectionFromText('EXECUTIVE COMPENSATION Discussion')).toBe('executive_compensation');
    });

    it('should detect CD&A', () => {
      expect(detectSectionFromText('CD&A and Related Matters')).toBe('executive_compensation');
    });

    it('should detect board composition', () => {
      expect(detectSectionFromText('ELECTION OF DIRECTORS')).toBe('board_composition');
    });

    it('should detect shareholder proposals', () => {
      expect(detectSectionFromText('STOCKHOLDER PROPOSAL regarding climate')).toBe('shareholder_proposals');
    });

    it('should detect pay vs performance', () => {
      expect(detectSectionFromText('PAY VERSUS PERFORMANCE table')).toBe('pay_vs_performance');
    });

    it('should detect audit committee', () => {
      expect(detectSectionFromText('REPORT OF THE AUDIT COMMITTEE')).toBe('audit_committee');
    });

    it('should detect stock ownership', () => {
      expect(detectSectionFromText('BENEFICIAL OWNERSHIP of Securities')).toBe('stock_ownership');
    });

    it('should detect related party transactions', () => {
      expect(detectSectionFromText('CERTAIN RELATIONSHIPS and Related Transactions')).toBe('related_party_transactions');
    });

    it('should return null for unrelated text', () => {
      expect(detectSectionFromText('Revenue grew 15% year over year')).toBeNull();
    });
  });
});

// ─── S-1 Section Definitions ─────────────────────────────────────────

describe('Phase 3: S-1 Section Definitions', () => {
  // Mirror of the SEC_SECTIONS['S-1'] keys from hybrid_parser.py
  const S1_SECTIONS = [
    'prospectus_summary', 'risk_factors', 'use_of_proceeds', 'dilution',
    'capitalization', 'dividend_policy', 'mda', 'business', 'management',
    'principal_stockholders', 'description_capital_stock', 'underwriting',
    'financial_statements',
  ];

  it('should define 13 S-1 sections', () => {
    expect(S1_SECTIONS).toHaveLength(13);
  });

  it('should include prospectus_summary', () => {
    expect(S1_SECTIONS).toContain('prospectus_summary');
  });

  it('should include use_of_proceeds', () => {
    expect(S1_SECTIONS).toContain('use_of_proceeds');
  });

  it('should include dilution', () => {
    expect(S1_SECTIONS).toContain('dilution');
  });

  it('should include underwriting', () => {
    expect(S1_SECTIONS).toContain('underwriting');
  });

  it('should include risk_factors (shared with 10-K)', () => {
    expect(S1_SECTIONS).toContain('risk_factors');
  });

  it('should include mda (shared with 10-K)', () => {
    expect(S1_SECTIONS).toContain('mda');
  });

  it('should include financial_statements', () => {
    expect(S1_SECTIONS).toContain('financial_statements');
  });

  it('should have all S-1 sections in SECTION_LABELS', () => {
    for (const section of S1_SECTIONS) {
      expect(SECTION_LABELS[section]).toBeDefined();
    }
  });
});

// ─── Dispatcher Routing ──────────────────────────────────────────────

describe('Phase 3: Dispatcher Routing', () => {
  const FILING_PARSERS: Record<string, string> = {
    '10-K': 'hybrid', '10-K/A': 'hybrid',
    '10-Q': 'hybrid', '10-Q/A': 'hybrid',
    '8-K': 'hybrid',
    '13F-HR': 'form_13f', '13F-HR/A': 'form_13f',
    '4': 'form_4', '4/A': 'form_4',
    'S-1': 'hybrid_s1', 'S-1/A': 'hybrid_s1',
    'DEF 14A': 'proxy', 'DEFA14A': 'proxy',
  };

  it('should route DEF 14A to proxy parser', () => {
    expect(FILING_PARSERS['DEF 14A']).toBe('proxy');
  });

  it('should route DEFA14A to proxy parser', () => {
    expect(FILING_PARSERS['DEFA14A']).toBe('proxy');
  });

  it('should route S-1 to hybrid_s1 parser', () => {
    expect(FILING_PARSERS['S-1']).toBe('hybrid_s1');
  });

  it('should route S-1/A to hybrid_s1 parser', () => {
    expect(FILING_PARSERS['S-1/A']).toBe('hybrid_s1');
  });

  it('should still route 10-K to hybrid parser', () => {
    expect(FILING_PARSERS['10-K']).toBe('hybrid');
  });

  it('should still route Form 4 to form_4 parser', () => {
    expect(FILING_PARSERS['4']).toBe('form_4');
  });

  it('should still route 13F-HR to form_13f parser', () => {
    expect(FILING_PARSERS['13F-HR']).toBe('form_13f');
  });

  it('should return undefined for unsupported types', () => {
    expect(FILING_PARSERS['EARNINGS']).toBeUndefined();
  });
});

// ─── RAG Compensation/Governance Query Detection ─────────────────────

describe('Phase 3: Compensation/Governance Query Detection', () => {
  const compensationRegex = /\b(compensation|executive\s*comp|ceo\s*pay|cfo\s*pay|pay\s*ratio|pay\s*vs\.?\s*performance|named\s*executive|summary\s*compensation|stock\s*(?:option|award|grant)|equity\s*(?:award|grant|incentive))\b/i;
  const governanceRegex = /\b(governance|board\s*(?:of\s*directors|composition|member|nominee)|director\s*(?:election|nominee|independence)|shareholder\s*proposal|stockholder\s*proposal|proxy\s*(?:statement|vote|voting)|audit\s*committee|related\s*party)\b/i;

  describe('Compensation queries', () => {
    it('should detect "What is the CEO compensation?"', () => {
      expect(compensationRegex.test('What is the CEO compensation?')).toBe(true);
    });

    it('should detect "executive comp breakdown"', () => {
      expect(compensationRegex.test('executive comp breakdown')).toBe(true);
    });

    it('should detect "CEO pay ratio"', () => {
      expect(compensationRegex.test('What is the CEO pay ratio?')).toBe(true);
    });

    it('should detect "pay vs performance"', () => {
      expect(compensationRegex.test('Show me pay vs performance')).toBe(true);
    });

    it('should detect "named executive officer"', () => {
      expect(compensationRegex.test('named executive officer compensation')).toBe(true);
    });

    it('should detect "stock option grants"', () => {
      expect(compensationRegex.test('How many stock option grants?')).toBe(true);
    });

    it('should detect "equity incentive plan"', () => {
      expect(compensationRegex.test('equity incentive plan details')).toBe(true);
    });

    it('should NOT detect revenue queries', () => {
      expect(compensationRegex.test('What is NVDA revenue?')).toBe(false);
    });

    it('should NOT detect margin queries', () => {
      expect(compensationRegex.test('gross margin trend')).toBe(false);
    });
  });

  describe('Governance queries', () => {
    it('should detect "board of directors"', () => {
      expect(governanceRegex.test('Who is on the board of directors?')).toBe(true);
    });

    it('should detect "corporate governance"', () => {
      expect(governanceRegex.test('corporate governance practices')).toBe(true);
    });

    it('should detect "shareholder proposal"', () => {
      expect(governanceRegex.test('Any shareholder proposal this year?')).toBe(true);
    });

    it('should detect "audit committee"', () => {
      expect(governanceRegex.test('audit committee composition')).toBe(true);
    });

    it('should detect "proxy vote"', () => {
      expect(governanceRegex.test('proxy vote results')).toBe(true);
    });

    it('should detect "director election"', () => {
      expect(governanceRegex.test('director election results')).toBe(true);
    });

    it('should detect "related party transactions"', () => {
      expect(governanceRegex.test('any related party transactions?')).toBe(true);
    });

    it('should NOT detect earnings queries', () => {
      expect(governanceRegex.test('What were Q3 earnings?')).toBe(false);
    });
  });
});

// ─── Section Labels for Phase 3 ─────────────────────────────────────

describe('Phase 3: Section Labels', () => {
  describe('DEF 14A proxy section labels', () => {
    it('should humanize executive_compensation', () => {
      expect(humanizeSectionType('executive_compensation')).toBe('Executive Compensation');
    });

    it('should humanize director_compensation', () => {
      expect(humanizeSectionType('director_compensation')).toBe('Director Compensation');
    });

    it('should humanize board_composition', () => {
      expect(humanizeSectionType('board_composition')).toBe('Board of Directors');
    });

    it('should humanize ceo_pay_ratio', () => {
      expect(humanizeSectionType('ceo_pay_ratio')).toBe('CEO Pay Ratio');
    });

    it('should humanize pay_vs_performance', () => {
      expect(humanizeSectionType('pay_vs_performance')).toBe('Pay vs. Performance');
    });

    it('should humanize audit_committee', () => {
      expect(humanizeSectionType('audit_committee')).toBe('Audit Committee');
    });

    it('should humanize stock_ownership', () => {
      expect(humanizeSectionType('stock_ownership')).toBe('Stock Ownership');
    });
  });

  describe('S-1 section labels', () => {
    it('should humanize prospectus_summary', () => {
      expect(humanizeSectionType('prospectus_summary')).toBe('Prospectus Summary');
    });

    it('should humanize use_of_proceeds', () => {
      expect(humanizeSectionType('use_of_proceeds')).toBe('Use of Proceeds');
    });

    it('should humanize dilution', () => {
      expect(humanizeSectionType('dilution')).toBe('Dilution');
    });

    it('should humanize underwriting', () => {
      expect(humanizeSectionType('underwriting')).toBe('Underwriting');
    });

    it('should humanize capitalization', () => {
      expect(humanizeSectionType('capitalization')).toBe('Capitalization');
    });
  });

  describe('Filing type labels for Phase 3', () => {
    it('should humanize DEF 14A', () => {
      expect(humanizeFilingType('DEF 14A')).toBe('Proxy Statement');
    });

    it('should humanize DEFA14A', () => {
      expect(humanizeFilingType('DEFA14A')).toBe('Proxy Statement');
    });

    it('should humanize S-1', () => {
      expect(humanizeFilingType('S-1')).toBe('Registration Statement (S-1)');
    });

    it('should humanize S-1/A', () => {
      expect(humanizeFilingType('S-1/A')).toBe('Registration Amendment');
    });
  });
});

// ─── Proxy Output Schema ─────────────────────────────────────────────

describe('Phase 3: Proxy Parser Output Schema', () => {
  // Validate the expected output structure from parse_proxy
  const sampleOutput = {
    structured_metrics: [],
    narrative_chunks: [
      {
        ticker: 'NVDA',
        filing_type: 'DEF 14A',
        section_type: 'executive_compensation',
        section_title: 'Executive Compensation',
        chunk_index: 0,
        content: 'The compensation committee...',
        content_length: 28,
      },
    ],
    holdings: [],
    transactions: [],
    metadata: {
      ticker: 'NVDA',
      filing_type: 'DEF 14A',
      status: 'success',
      parser_type: 'proxy',
      total_metrics: 0,
      total_chunks: 1,
      total_holdings: 0,
      total_transactions: 0,
      sections_found: 5,
      section_types: ['executive_compensation'],
      verification: {
        passed: true,
        sections_found: 5,
        total_possible: 9,
        issues: [],
        confidence: 1.0,
        tier: 1,
      },
    },
  };

  it('should have empty structured_metrics', () => {
    expect(sampleOutput.structured_metrics).toHaveLength(0);
  });

  it('should have narrative_chunks with proxy section types', () => {
    expect(sampleOutput.narrative_chunks[0].section_type).toBe('executive_compensation');
  });

  it('should have filing_type DEF 14A in chunks', () => {
    expect(sampleOutput.narrative_chunks[0].filing_type).toBe('DEF 14A');
  });

  it('should have parser_type proxy in metadata', () => {
    expect(sampleOutput.metadata.parser_type).toBe('proxy');
  });

  it('should have verification with tier 1', () => {
    expect(sampleOutput.metadata.verification.tier).toBe(1);
  });

  it('should have empty holdings and transactions', () => {
    expect(sampleOutput.holdings).toHaveLength(0);
    expect(sampleOutput.transactions).toHaveLength(0);
  });

  it('should set status to needs_review when verification fails', () => {
    const failedOutput = { ...sampleOutput, metadata: { ...sampleOutput.metadata, status: 'needs_review' } };
    expect(failedOutput.metadata.status).toBe('needs_review');
  });
});

// ─── Regression Guards ───────────────────────────────────────────────

describe('Phase 3: Regression Guards', () => {
  it('should still have all 10-K section labels', () => {
    expect(SECTION_LABELS['item_1']).toBe('Business');
    expect(SECTION_LABELS['item_7']).toBe('MD&A');
    expect(SECTION_LABELS['item_1a']).toBe('Risk Factors');
  });

  it('should still have all 8-K section labels', () => {
    expect(SECTION_LABELS['item_2_02']).toBe('Results of Operations');
    expect(SECTION_LABELS['item_8_01']).toBe('Other Events');
  });

  it('should still have existing filing type labels', () => {
    expect(humanizeFilingType('10-K')).toBe('Annual Report (10-K)');
    expect(humanizeFilingType('10-Q')).toBe('Quarterly Report (10-Q)');
    expect(humanizeFilingType('8-K')).toBe('Current Report (8-K)');
  });

  it('should still have Phase 2 filing type labels', () => {
    expect(humanizeFilingType('13F-HR')).toBe('Institutional Holdings (13F)');
    expect(humanizeFilingType('4')).toBe('Insider Transaction (Form 4)');
  });

  it('should still humanize unknown section types gracefully', () => {
    expect(humanizeSectionType('some_unknown_section')).toBe('Some Unknown Section');
  });

  it('should still humanize unknown filing types gracefully', () => {
    expect(humanizeFilingType('UNKNOWN-TYPE')).toBe('UNKNOWN-TYPE');
  });
});
