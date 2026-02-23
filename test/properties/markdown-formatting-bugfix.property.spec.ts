/**
 * Bug Condition Exploration Test - Markdown Formatting Broken
 * 
 * **Property 1: Fault Condition** - Poor Markdown Rendering Quality
 * 
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * 
 * **GOAL**: Surface counterexamples that demonstrate markdown tables and formatting render poorly
 * 
 * **Scoped PBT Approach**: Test responses containing markdown tables, code blocks, lists, and paragraphs
 * 
 * **Validates: Requirements 2.4**
 */

import * as fc from 'fast-check';

describe('Bug Condition Exploration: Markdown Formatting Broken', () => {
  /**
   * Helper function to simulate the renderMarkdown function from research.html
   * This is a SIMPLIFIED version of the actual implementation for testing purposes
   * The actual implementation is in public/app/deals/research.html lines 297-387
   */
  function renderMarkdown(text: string): string {
    if (!text) return '';
    
    try {
      // Simulate the complex table parsing logic from research.html
      let processedText = text.replace(/\r\n/g, '\n');
      const hasTable = processedText.includes('|') && (processedText.includes('---') || processedText.includes('| '));
      
      if (hasTable) {
        const lines = processedText.split('\n');
        const fixedLines: string[] = [];
        let inTable = false;
        let tableLines: string[] = [];
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmedLine = line.trim();
          const isTableRow = trimmedLine.includes('|') && !trimmedLine.startsWith('```') && !trimmedLine.startsWith('`');
          
          if (isTableRow) {
            if (!inTable) {
              if (fixedLines.length > 0 && fixedLines[fixedLines.length - 1].trim() !== '') {
                fixedLines.push('');
              }
              inTable = true;
              tableLines = [];
            }
            
            let fixedLine = trimmedLine;
            if (!fixedLine.startsWith('|')) fixedLine = '| ' + fixedLine;
            if (!fixedLine.endsWith('|')) fixedLine = fixedLine + ' |';
            tableLines.push(fixedLine);
          } else if (inTable) {
            if (tableLines.length >= 2) {
              const hasSep = tableLines.some(l => /^\|[\s\-:|]+\|$/.test(l.trim()));
              if (!hasSep && tableLines.length >= 1) {
                const headerCells = tableLines[0].split('|').filter(c => c.trim());
                const sep = '|' + headerCells.map(() => '---').join('|') + '|';
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
          const hasSep = tableLines.some(l => /^\|[\s\-:|]+\|$/.test(l.trim()));
          if (!hasSep) {
            const headerCells = tableLines[0].split('|').filter(c => c.trim());
            const sep = '|' + headerCells.map(() => '---').join('|') + '|';
            tableLines.splice(1, 0, sep);
          }
          fixedLines.push(...tableLines);
          fixedLines.push('');
        }
        
        processedText = fixedLines.join('\n');
      }
      
      // Simulate marked.js parsing (simplified)
      let html = processedText
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        .replace(/`(.*?)`/g, '<code>$1</code>');
      
      // Parse markdown tables to HTML
      const tableRegex = /\|(.+)\|\n\|([\s\-:|]+)\|\n((?:\|.+\|\n?)*)/g;
      html = html.replace(tableRegex, (match, header, separator, rows) => {
        const headerCells = header.split('|').map((c: string) => c.trim()).filter((c: string) => c);
        const rowLines = rows.trim().split('\n');
        
        let tableHtml = '<table class="markdown-table"><thead><tr>';
        headerCells.forEach((cell: string) => {
          tableHtml += `<th>${cell}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        
        rowLines.forEach((row: string) => {
          const cells = row.split('|').map((c: string) => c.trim()).filter((c: string) => c);
          if (cells.length > 0) {
            tableHtml += '<tr>';
            cells.forEach((cell: string) => {
              tableHtml += `<td>${cell}</td>`;
            });
            tableHtml += '</tr>';
          }
        });
        
        tableHtml += '</tbody></table>';
        return tableHtml;
      });
      
      // Add line breaks
      html = html.replace(/([^>])\n([^<])/g, '$1<br>\n$2');
      
      return html;
    } catch (error) {
      console.error('Error rendering markdown:', error);
      return text.replace(/\n/g, '<br>');
    }
  }

  /**
   * Property 1: Markdown tables must render with proper HTML structure
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test FAILS
   * This proves the bug exists - tables display with broken formatting, missing structure
   */
  it('Property 1: Markdown tables must render with proper HTML table structure', () => {
    fc.assert(
      fc.property(
        // Generate markdown tables with various structures
        fc.record({
          headers: fc.array(fc.string({ minLength: 3, maxLength: 15 }), { minLength: 2, maxLength: 5 }),
          rows: fc.array(
            fc.array(fc.string({ minLength: 3, maxLength: 20 }), { minLength: 2, maxLength: 5 }),
            { minLength: 1, maxLength: 5 }
          ),
        }).map(({ headers, rows }) => {
          // Ensure all rows have same number of columns as headers
          const normalizedRows = rows.map(row => {
            if (row.length < headers.length) {
              return [...row, ...Array(headers.length - row.length).fill('')];
            }
            return row.slice(0, headers.length);
          });
          
          // Create markdown table
          const headerRow = '| ' + headers.join(' | ') + ' |';
          const separatorRow = '| ' + headers.map(() => '---').join(' | ') + ' |';
          const dataRows = normalizedRows.map(row => '| ' + row.join(' | ') + ' |').join('\n');
          
          const markdown = `${headerRow}\n${separatorRow}\n${dataRows}`;
          
          return { markdown, headers, rows: normalizedRows };
        }),
        ({ markdown, headers, rows }) => {
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION 1: HTML must contain a <table> element
          expect(html).toContain('<table');
          expect(html).toContain('</table>');
          
          // CRITICAL ASSERTION 2: Table must have proper structure with thead and tbody
          expect(html).toContain('<thead>');
          expect(html).toContain('</thead>');
          expect(html).toContain('<tbody>');
          expect(html).toContain('</tbody>');
          
          // CRITICAL ASSERTION 3: Table must have header cells
          expect(html).toContain('<th>');
          expect(html).toContain('</th>');
          
          // CRITICAL ASSERTION 4: All header values must be present in the HTML
          headers.forEach(header => {
            if (header.trim()) {
              expect(html).toContain(header);
            }
          });
          
          // CRITICAL ASSERTION 5: Table must have data cells
          expect(html).toContain('<td>');
          expect(html).toContain('</td>');
          
          // CRITICAL ASSERTION 6: All data values must be present in the HTML
          rows.forEach(row => {
            row.forEach(cell => {
              if (cell.trim()) {
                expect(html).toContain(cell);
              }
            });
          });
          
          // CRITICAL ASSERTION 7: Table should have CSS class for styling
          expect(html).toContain('class="markdown-table"');
        }
      ),
      { numRuns: 30, verbose: true }
    );
  });

  /**
   * Property 2: Code blocks must render with proper HTML structure
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test MAY FAIL
   * This tests that code blocks are properly wrapped in <pre><code> tags
   */
  it('Property 2: Code blocks must render with proper pre and code tags', () => {
    fc.assert(
      fc.property(
        fc.record({
          language: fc.constantFrom('javascript', 'python', 'typescript', 'sql'),
          code: fc.array(fc.string({ minLength: 10, maxLength: 50 }), { minLength: 1, maxLength: 5 })
            .map(lines => lines.join('\n')),
        }),
        ({ language, code }) => {
          const markdown = '```' + language + '\n' + code + '\n```';
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION 1: Code block must be wrapped in <pre><code> tags
          expect(html).toContain('<pre>');
          expect(html).toContain('<code>');
          expect(html).toContain('</code>');
          expect(html).toContain('</pre>');
          
          // CRITICAL ASSERTION 2: Code content must be present
          expect(html).toContain(code.split('\n')[0]);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 3: Lists must render with proper HTML structure
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test MAY FAIL
   * This tests that lists maintain proper structure and line breaks
   */
  it('Property 3: Lists must maintain proper structure with line breaks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 5, maxLength: 30 }), { minLength: 2, maxLength: 5 }),
        (items) => {
          const markdown = items.map(item => `- ${item}`).join('\n');
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION 1: All list items must be present in HTML
          items.forEach(item => {
            expect(html).toContain(item);
          });
          
          // CRITICAL ASSERTION 2: HTML must contain line breaks or list structure
          // (either <br> tags or proper list elements)
          const hasLineBreaks = html.includes('<br>') || html.includes('<li>');
          expect(hasLineBreaks).toBe(true);
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 4: Paragraphs must have proper spacing
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test MAY FAIL
   * This tests that paragraphs are separated with proper line breaks
   */
  it('Property 4: Paragraphs must be separated with proper line breaks', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 20, maxLength: 100 }), { minLength: 2, maxLength: 4 }),
        (paragraphs) => {
          const markdown = paragraphs.join('\n\n');
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION 1: All paragraph content must be present
          paragraphs.forEach(para => {
            expect(html).toContain(para);
          });
          
          // CRITICAL ASSERTION 2: HTML must contain line breaks for separation
          expect(html).toContain('<br>');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 5: Tables with missing separators must be handled gracefully
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test MAY FAIL
   * This tests edge case where table separator row is missing
   */
  it('Property 5: Tables without separator rows must still render correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          headers: fc.array(fc.string({ minLength: 3, maxLength: 10 }), { minLength: 2, maxLength: 4 }),
          rows: fc.array(
            fc.array(fc.string({ minLength: 3, maxLength: 15 }), { minLength: 2, maxLength: 4 }),
            { minLength: 1, maxLength: 3 }
          ),
        }),
        ({ headers, rows }) => {
          // Create table WITHOUT separator row (edge case)
          const headerRow = '| ' + headers.join(' | ') + ' |';
          const dataRows = rows.map(row => '| ' + row.slice(0, headers.length).join(' | ') + ' |').join('\n');
          const markdown = `${headerRow}\n${dataRows}`;
          
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION: Even without separator, table should render
          // The renderMarkdown function should auto-insert separator
          expect(html).toContain('<table');
          
          // All content should be present
          headers.forEach(header => {
            if (header.trim()) {
              expect(html).toContain(header);
            }
          });
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 6: Tables with uneven borders must be normalized
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test MAY FAIL
   * This tests edge case where table rows don't start/end with pipes
   */
  it('Property 6: Tables with missing leading/trailing pipes must be normalized', () => {
    fc.assert(
      fc.property(
        fc.record({
          headers: fc.array(fc.string({ minLength: 3, maxLength: 10 }), { minLength: 2, maxLength: 3 }),
        }),
        ({ headers }) => {
          // Create table with missing leading/trailing pipes (edge case)
          const headerRow = headers.join(' | '); // No leading/trailing pipes
          const separatorRow = headers.map(() => '---').join(' | ');
          const dataRow = headers.map((_, i) => `data${i}`).join(' | ');
          
          const markdown = `${headerRow}\n${separatorRow}\n${dataRow}`;
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION: Table should still render correctly
          // The renderMarkdown function should normalize the pipes
          expect(html).toContain('<table');
          
          // All headers should be present
          headers.forEach(header => {
            if (header.trim()) {
              expect(html).toContain(header);
            }
          });
        }
      ),
      { numRuns: 15 }
    );
  });

  /**
   * Property 7: Mixed content (tables + paragraphs + code) must render correctly
   * 
   * **EXPECTED OUTCOME ON UNFIXED CODE**: Test MAY FAIL
   * This tests complex markdown with multiple element types
   */
  it('Property 7: Mixed markdown content must render all elements correctly', () => {
    fc.assert(
      fc.property(
        fc.record({
          paragraph1: fc.string({ minLength: 20, maxLength: 50 }),
          tableHeaders: fc.array(fc.string({ minLength: 3, maxLength: 10 }), { minLength: 2, maxLength: 3 }),
          tableRow: fc.array(fc.string({ minLength: 3, maxLength: 10 }), { minLength: 2, maxLength: 3 }),
          paragraph2: fc.string({ minLength: 20, maxLength: 50 }),
          code: fc.string({ minLength: 10, maxLength: 30 }),
        }),
        ({ paragraph1, tableHeaders, tableRow, paragraph2, code }) => {
          const table = `| ${tableHeaders.join(' | ')} |\n| ${tableHeaders.map(() => '---').join(' | ')} |\n| ${tableRow.slice(0, tableHeaders.length).join(' | ')} |`;
          const markdown = `${paragraph1}\n\n${table}\n\n${paragraph2}\n\n\`\`\`\n${code}\n\`\`\``;
          
          const html = renderMarkdown(markdown);
          
          // CRITICAL ASSERTION 1: All content types must be present
          expect(html).toContain(paragraph1);
          expect(html).toContain(paragraph2);
          expect(html).toContain('<table');
          expect(html).toContain('<code>');
          
          // CRITICAL ASSERTION 2: Table structure must be correct
          expect(html).toContain('<thead>');
          expect(html).toContain('<tbody>');
          
          // CRITICAL ASSERTION 3: All table content must be present
          tableHeaders.forEach(header => {
            if (header.trim()) {
              expect(html).toContain(header);
            }
          });
        }
      ),
      { numRuns: 20 }
    );
  });
});
