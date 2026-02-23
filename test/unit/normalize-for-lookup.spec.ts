import { normalizeForLookup } from 'src/rag/metric-resolution/normalize-for-lookup';

describe('normalizeForLookup', () => {
  // Requirement 2.1: lowercase + strip non-alphanumeric
  describe('basic normalization', () => {
    it('should convert to lowercase and strip non-alphanumeric characters', () => {
      expect(normalizeForLookup('Hello World')).toBe('helloworld');
    });

    it('should preserve digits', () => {
      expect(normalizeForLookup('Rule of 40')).toBe('ruleof40');
    });

    it('should handle already-normalized input (idempotence)', () => {
      const normalized = normalizeForLookup('cashandcashequivalents');
      expect(normalizeForLookup(normalized)).toBe(normalized);
    });
  });

  // Requirement 2.2: "Cash & Cash Equivalents" — strips & and spaces
  // Note: The & symbol is non-alphanumeric and gets stripped, so "Cash & Cash Equivalents"
  // normalizes to "cashcashequivalents". The synonym "Cash and Cash Equivalents" (with literal "and")
  // normalizes to "cashandcashequivalents". Both are indexed as synonyms in the registry.
  it('should normalize "Cash & Cash Equivalents" by stripping the ampersand', () => {
    expect(normalizeForLookup('Cash & Cash Equivalents')).toBe('cashcashequivalents');
  });

  it('should normalize "Cash and Cash Equivalents" to "cashandcashequivalents"', () => {
    expect(normalizeForLookup('Cash and Cash Equivalents')).toBe('cashandcashequivalents');
  });

  // Requirement 2.3: "Cash_and_Cash_Equivalents" → "cashandcashequivalents"
  it('should normalize "Cash_and_Cash_Equivalents" to "cashandcashequivalents"', () => {
    expect(normalizeForLookup('Cash_and_Cash_Equivalents')).toBe('cashandcashequivalents');
  });

  // Requirement 2.4: "SG&A" → "sga"
  it('should normalize "SG&A" to "sga"', () => {
    expect(normalizeForLookup('SG&A')).toBe('sga');
  });

  // Requirement 2.5: "Net Debt / EBITDA" → "netdebtebitda"
  it('should normalize "Net Debt / EBITDA" to "netdebtebitda"', () => {
    expect(normalizeForLookup('Net Debt / EBITDA')).toBe('netdebtebitda');
  });

  // Requirement 2.6: empty string and whitespace-only → empty string
  describe('edge cases', () => {
    it('should return empty string for empty input', () => {
      expect(normalizeForLookup('')).toBe('');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(normalizeForLookup('   ')).toBe('');
    });

    it('should return empty string for tab/newline whitespace', () => {
      expect(normalizeForLookup('\t\n\r')).toBe('');
    });

    it('should return empty string for null input', () => {
      expect(normalizeForLookup(null as unknown as string)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(normalizeForLookup(undefined as unknown as string)).toBe('');
    });
  });

  // Additional edge cases: special characters and Unicode
  describe('special characters', () => {
    it('should strip parentheses', () => {
      expect(normalizeForLookup('EBITDA (Adjusted)')).toBe('ebitdaadjusted');
    });

    it('should strip hyphens and dashes', () => {
      expect(normalizeForLookup('Price-to-Earnings')).toBe('pricetoearnings');
    });

    it('should strip periods and commas', () => {
      expect(normalizeForLookup('R.O.E.')).toBe('roe');
    });

    it('should strip colons and semicolons', () => {
      expect(normalizeForLookup('LTV:CAC')).toBe('ltvcac');
    });

    it('should handle Unicode characters by stripping them', () => {
      expect(normalizeForLookup('Résumé')).toBe('rsum');
    });

    it('should handle emoji by stripping them', () => {
      expect(normalizeForLookup('Revenue 📈')).toBe('revenue');
    });

    it('should handle only special characters', () => {
      expect(normalizeForLookup('!@#$%^&*()')).toBe('');
    });
  });
});
