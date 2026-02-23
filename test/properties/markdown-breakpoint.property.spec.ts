/**
 * Property-Based Tests: Markdown Breakpoint Detection & Table Rendering
 * Feature: research-response-formatting-fix, Property 4 & 5
 *
 * Property 4: Markdown breakpoint detection
 * Property 5: Table markdown produces HTML tables
 *
 * Validates: Requirements 3.1, 3.2
 */

import * as fc from 'fast-check';

// marked is ESM-only; use the UMD build for Jest/CJS compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const markedModule = require(require('path').resolve(__dirname, '../../node_modules/marked/lib/marked.umd.js'));
const markedParse: (src: string) => string = markedModule.marked?.parse ?? markedModule.parse;
const markedUse: (options: any) => void = markedModule.marked?.use ?? markedModule.use;

// ---------------------------------------------------------------------------
// Extracted frontend functions (from public/app/deals/research.html)
// ---------------------------------------------------------------------------

/**
 * isMarkdownBreakpoint — extracted from the Alpine.js component.
 * Detects natural breakpoints in streaming markdown content.
 *
 * The `_lastMarkdownFlush` state is passed in via a context object
 * so we can test the 200-char safety valve statelessly.
 */
function isMarkdownBreakpoint(
  text: string,
  context: { _lastMarkdownFlush: number } = { _lastMarkdownFlush: 0 },
): boolean {
  if (!text) return false;
  // Flush at double newline (paragraph boundary)
  if (text.endsWith('\n\n')) return true;
  // Flush at end of table row
  if (text.endsWith('|\n')) return true;
  // Flush at sentence boundary: period followed by capital letter or newline.
  if (/\.\s+[A-Z]/.test(text.slice(-20)) || text.endsWith('.\n')) return true;
  // A bare trailing period does NOT flush — wait for lookahead.
  // Flush every 200 chars as a safety valve
  const lastFlush = context._lastMarkdownFlush || 0;
  if (text.length - lastFlush > 200) {
    context._lastMarkdownFlush = text.length;
    return true;
  }
  return false;
}

/**
 * renderMarkdown — simplified extraction of the core markdown rendering logic
 * from the Alpine.js component. Uses marked.js with GFM tables enabled and
 * includes the table fixup logic from the frontend.
 */
function renderMarkdown(text: string): string {
  if (!text) return '';
  try {
    let processedText = text.replace(/\r\n/g, '\n');

    const hasTable =
      processedText.includes('|') &&
      (processedText.includes('---') || processedText.includes('| '));

    if (hasTable) {
      const lines = processedText.split('\n');
      const fixedLines: string[] = [];
      let inTable = false;
      let tableLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        const isTableRow =
          trimmedLine.includes('|') &&
          !trimmedLine.startsWith('```') &&
          !trimmedLine.startsWith('`');

        if (isTableRow) {
          if (!inTable) {
            if (fixedLines.length > 0 && fixedLines[fixedLines.length - 1].trim() !== '')
              fixedLines.push('');
            inTable = true;
            tableLines = [];
          }
          let fixedLine = trimmedLine;
          if (!fixedLine.startsWith('|')) fixedLine = '| ' + fixedLine;
          if (!fixedLine.endsWith('|')) fixedLine = fixedLine + ' |';
          tableLines.push(fixedLine);
        } else if (inTable) {
          if (tableLines.length >= 2) {
            const hasSep = tableLines.some((l) =>
              /^\|[\s\-:|]+\|$/.test(l.trim()),
            );
            if (!hasSep && tableLines.length >= 1) {
              const hc = tableLines[0].split('|').filter((c) => c.trim());
              const sep =
                '|' + hc.map(() => '---').join('|') + '|';
              tableLines.splice(1, 0, sep);
            }
            fixedLines.push(...tableLines);
          }
          fixedLines.push('');
          inTable = false;
          tableLines = [];
          if (trimmedLine !== '') fixedLines.push(line);
        } else {
          fixedLines.push(line);
        }
      }

      if (inTable && tableLines.length >= 2) {
        const hasSep2 = tableLines.some((l) =>
          /^\|[\s\-:|]+\|$/.test(l.trim()),
        );
        if (!hasSep2) {
          const hc2 = tableLines[0].split('|').filter((c) => c.trim());
          const sep2 =
            '|' + hc2.map(() => '---').join('|') + '|';
          tableLines.splice(1, 0, sep2);
        }
        fixedLines.push(...tableLines);
        fixedLines.push('');
      }

      processedText = fixedLines.join('\n');
    }

    markedUse({ breaks: false, gfm: true });
    const html = markedParse(processedText);
    return html;
  } catch (error) {
    return text.replace(/\n/g, '<br>');
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA'];

/** Generate a non-empty base string (no trailing breakpoint chars) */
const baseTextArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z0-9 ,;:]{1,80}$/)
  .filter((s) => s.trim().length > 0);

/** Generate a string ending in double newline */
const doubleNewlineArb: fc.Arbitrary<string> = baseTextArb.map((s) => s + '\n\n');

/** Generate a string ending in table row end (|\n) */
const tableRowEndArb: fc.Arbitrary<string> = baseTextArb.map(
  (s) => s + '|\n',
);

/** Generate a string ending in period + newline */
const periodNewlineArb: fc.Arbitrary<string> = baseTextArb.map(
  (s) => s + '.\n',
);

/** Generate a string ending in period + space(s) + capital letter (within last 20 chars) */
const periodCapitalArb: fc.Arbitrary<string> = fc
  .tuple(
    baseTextArb,
    fc.constantFrom(' ', '  ', ' \n'),
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  )
  .map(([base, space, cap]) => base + '.' + space + cap);

/** Generate abbreviation-like patterns NOT followed by a capital letter */
const abbreviationArb: fc.Arbitrary<string> = fc
  .tuple(
    baseTextArb,
    fc.constantFrom('Inc.', 'Corp.', 'vs.', 'Ltd.', 'Dr.', 'Mr.', 'etc.'),
  )
  .map(([base, abbr]) => base + ' ' + abbr)
  .filter((s) => s.length <= 200); // Ensure safety valve doesn't trigger

/** Generate a valid pipe-delimited markdown table */
const markdownTableArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(fc.stringMatching(/^[a-z ]{1,15}$/).filter((s) => s.trim().length > 0), {
      minLength: 2,
      maxLength: 5,
    }),
    fc.array(
      fc.array(fc.stringMatching(/^[a-z0-9 $.,% ]{1,15}$/).filter((s) => s.trim().length > 0), {
        minLength: 2,
        maxLength: 5,
      }),
      { minLength: 1, maxLength: 5 },
    ),
  )
  .map(([headers, rows]) => {
    // Normalize row lengths to match header count
    const colCount = headers.length;
    const headerRow = '| ' + headers.join(' | ') + ' |';
    const sepRow = '|' + headers.map(() => '---').join('|') + '|';
    const dataRows = rows.map((row) => {
      // Pad or trim row to match column count
      const normalizedRow = headers.map((_, i) => (row[i] || 'N/A').trim() || 'N/A');
      return '| ' + normalizedRow.join(' | ') + ' |';
    });
    return [headerRow, sepRow, ...dataRows].join('\n');
  });

// ---------------------------------------------------------------------------
// Test Suite — Property 4: Markdown breakpoint detection
// ---------------------------------------------------------------------------

describe('Feature: research-response-formatting-fix, Property 4: Markdown breakpoint detection', () => {
  /**
   * **Validates: Requirements 3.1**
   *
   * For any string ending in \n\n (double newline), isMarkdownBreakpoint() SHALL return true.
   */
  it('should return true for strings ending in double newline', () => {
    fc.assert(
      fc.property(doubleNewlineArb, (text) => {
        expect(isMarkdownBreakpoint(text)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any string ending in |\n (table row end), isMarkdownBreakpoint() SHALL return true.
   */
  it('should return true for strings ending in table row end (|\\n)', () => {
    fc.assert(
      fc.property(tableRowEndArb, (text) => {
        expect(isMarkdownBreakpoint(text)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any string ending in .\n (period + newline), isMarkdownBreakpoint() SHALL return true.
   */
  it('should return true for strings ending in period + newline', () => {
    fc.assert(
      fc.property(periodNewlineArb, (text) => {
        expect(isMarkdownBreakpoint(text)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For any string ending in a period followed by a capital letter within the last 20 characters,
   * isMarkdownBreakpoint() SHALL return true.
   */
  it('should return true for strings ending in period + space + capital letter', () => {
    fc.assert(
      fc.property(periodCapitalArb, (text) => {
        expect(isMarkdownBreakpoint(text)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * For strings ending in abbreviation-like patterns (e.g., "Inc.", "Corp.", "vs.")
   * not followed by a capital letter, isMarkdownBreakpoint() SHALL return false
   * (unless the 200-char safety valve triggers).
   */
  it('should return false for abbreviation-like patterns not followed by a capital letter', () => {
    fc.assert(
      fc.property(abbreviationArb, (text) => {
        // Use a fresh context with _lastMarkdownFlush = 0
        // The abbreviation generator ensures text.length <= 200 so safety valve won't trigger
        const result = isMarkdownBreakpoint(text, { _lastMarkdownFlush: 0 });
        expect(result).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * The 200-char safety valve: for any string longer than 200 chars from last flush,
   * isMarkdownBreakpoint() SHALL return true regardless of content.
   */
  it('should return true when text exceeds 200 chars from last flush (safety valve)', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z ]{201,400}$/),
        (text) => {
          const context = { _lastMarkdownFlush: 0 };
          const result = isMarkdownBreakpoint(text, context);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Test Suite — Property 5: Table markdown produces HTML tables
// ---------------------------------------------------------------------------

describe('Feature: research-response-formatting-fix, Property 5: Table markdown produces HTML tables', () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any valid pipe-delimited markdown table string (with header row, separator row,
   * and at least one data row), renderMarkdown() SHALL produce output containing
   * an HTML <table> element.
   */
  it('should produce HTML containing <table> for valid pipe-delimited markdown tables', () => {
    fc.assert(
      fc.property(markdownTableArb, (tableMarkdown) => {
        const html = renderMarkdown(tableMarkdown);
        expect(html).toContain('<table');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * For any valid markdown table, the rendered HTML SHALL contain <th> elements
   * (table headers) and <td> elements (table data cells).
   */
  it('should produce HTML with <th> and <td> elements for valid markdown tables', () => {
    fc.assert(
      fc.property(markdownTableArb, (tableMarkdown) => {
        const html = renderMarkdown(tableMarkdown);
        expect(html).toContain('<th');
        expect(html).toContain('<td');
      }),
      { numRuns: 100 },
    );
  });
});
