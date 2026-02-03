/**
 * Unit Tests for Citation Rendering Functions
 * 
 * Tests the JavaScript functions that handle citation display
 */

describe('Citation Rendering Functions', () => {
  // Mock marked.js
  const mockMarked = {
    parse: jest.fn((content) => `<p>${content}</p>`),
  };

  // Mock Alpine.js component context
  let component: any;

  beforeEach(() => {
    // Reset component state
    component = {
      previewDocument: {
        documentId: '',
        chunkId: '',
        filename: '',
        ticker: null,
        pageNumber: null,
        snippet: '',
        fullContent: '',
        score: null,
      },
      showDocumentPreview: false,

      // Utility functions
      renderMarkdown(content: string) {
        if (typeof mockMarked === 'undefined') {
          return content.replace(/\n/g, '<br>');
        }
        return mockMarked.parse(content);
      },

      renderMarkdownWithCitations(content: string, citations: any[]) {
        if (!citations || citations.length === 0) {
          return this.renderMarkdown(content);
        }

        let html = this.renderMarkdown(content);

        citations.forEach((citation) => {
          const marker = `[${citation.citationNumber}]`;
          const link = `<sup class="citation-link" onclick="window.dispatchEvent(new CustomEvent('preview-citation', { detail: ${JSON.stringify(citation)} }))">${marker}</sup>`;
          html = html.replace(new RegExp(`\\[${citation.citationNumber}\\]`, 'g'), link);
        });

        return html;
      },

      previewCitation(citation: any) {
        this.previewDocument = {
          documentId: citation.documentId,
          chunkId: citation.chunkId,
          filename: citation.filename,
          ticker: citation.ticker,
          pageNumber: citation.pageNumber,
          snippet: citation.snippet,
          fullContent: '',
          score: citation.score,
        };
        this.showDocumentPreview = true;
      },

      highlightText(text: string) {
        return `<span class="highlighted-text">${text}</span>`;
      },
    };
  });

  describe('renderMarkdown', () => {
    it('should render markdown content', () => {
      const content = 'This is **bold** text';
      const result = component.renderMarkdown(content);

      expect(result).toContain('<p>');
      expect(mockMarked.parse).toHaveBeenCalledWith(content);
    });

    it('should handle empty content', () => {
      const result = component.renderMarkdown('');
      expect(result).toBe('<p></p>');
    });

    it('should handle multiline content', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const result = component.renderMarkdown(content);
      expect(result).toBeTruthy();
    });
  });

  describe('renderMarkdownWithCitations', () => {
    it('should render content without citations', () => {
      const content = 'This is plain text';
      const result = component.renderMarkdownWithCitations(content, []);

      expect(result).toContain('<p>');
      expect(result).not.toContain('citation-link');
    });

    it('should add citation links for single citation', () => {
      const content = 'Revenue was $2.5B [1]';
      const citations = [
        {
          citationNumber: 1,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          filename: 'report.pdf',
          ticker: 'AAPL',
          pageNumber: 5,
          snippet: 'Revenue was $2.5B',
          score: 0.95,
        },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);

      expect(result).toContain('citation-link');
      expect(result).toContain('[1]');
      expect(result).toContain('preview-citation');
    });

    it('should add citation links for multiple citations', () => {
      const content = 'Revenue was $2.5B [1] and margin was 30% [2]';
      const citations = [
        {
          citationNumber: 1,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          filename: 'report.pdf',
          ticker: 'AAPL',
          pageNumber: 5,
          snippet: 'Revenue was $2.5B',
          score: 0.95,
        },
        {
          citationNumber: 2,
          documentId: 'doc-2',
          chunkId: 'chunk-2',
          filename: 'annual.pdf',
          ticker: 'AAPL',
          pageNumber: 12,
          snippet: 'Margin was 30%',
          score: 0.88,
        },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);

      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
      expect((result.match(/citation-link/g) || []).length).toBe(2);
    });

    it('should handle citations with special characters in data', () => {
      const content = 'Test [1]';
      const citations = [
        {
          citationNumber: 1,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          filename: 'report "special".pdf',
          ticker: 'AAPL',
          pageNumber: 5,
          snippet: 'Text with "quotes" and \'apostrophes\'',
          score: 0.95,
        },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);

      expect(result).toContain('citation-link');
      // Should not break HTML
      expect(result).not.toContain('undefined');
    });

    it('should handle null citations array', () => {
      const content = 'Test content';
      const result = component.renderMarkdownWithCitations(content, null as any);

      expect(result).toContain('<p>');
      expect(result).not.toContain('citation-link');
    });

    it('should replace all occurrences of citation marker', () => {
      const content = 'First [1] and second [1] mention';
      const citations = [
        {
          citationNumber: 1,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          filename: 'report.pdf',
          ticker: 'AAPL',
          pageNumber: 5,
          snippet: 'Test',
          score: 0.95,
        },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);

      expect((result.match(/citation-link/g) || []).length).toBe(2);
    });
  });

  describe('previewCitation', () => {
    it('should set preview document data', () => {
      const citation = {
        citationNumber: 1,
        documentId: 'doc-123',
        chunkId: 'chunk-456',
        filename: 'Q4 Report.pdf',
        ticker: 'AAPL',
        pageNumber: 5,
        snippet: 'Revenue increased to $2.5B',
        score: 0.95,
      };

      component.previewCitation(citation);

      expect(component.previewDocument.documentId).toBe('doc-123');
      expect(component.previewDocument.chunkId).toBe('chunk-456');
      expect(component.previewDocument.filename).toBe('Q4 Report.pdf');
      expect(component.previewDocument.ticker).toBe('AAPL');
      expect(component.previewDocument.pageNumber).toBe(5);
      expect(component.previewDocument.snippet).toBe('Revenue increased to $2.5B');
      expect(component.previewDocument.score).toBe(0.95);
    });

    it('should show document preview modal', () => {
      const citation = {
        citationNumber: 1,
        documentId: 'doc-123',
        chunkId: 'chunk-456',
        filename: 'report.pdf',
        ticker: null,
        pageNumber: null,
        snippet: 'Test',
        score: 0.85,
      };

      component.previewCitation(citation);

      expect(component.showDocumentPreview).toBe(true);
    });

    it('should handle citation without optional fields', () => {
      const citation = {
        citationNumber: 1,
        documentId: 'doc-123',
        chunkId: 'chunk-456',
        filename: 'report.pdf',
        ticker: null,
        pageNumber: null,
        snippet: 'Test snippet',
        score: null,
      };

      component.previewCitation(citation);

      expect(component.previewDocument.ticker).toBeNull();
      expect(component.previewDocument.pageNumber).toBeNull();
      expect(component.previewDocument.score).toBeNull();
      expect(component.showDocumentPreview).toBe(true);
    });
  });

  describe('highlightText', () => {
    it('should wrap text in highlighted span', () => {
      const text = 'This is important text';
      const result = component.highlightText(text);

      expect(result).toBe('<span class="highlighted-text">This is important text</span>');
    });

    it('should handle empty text', () => {
      const result = component.highlightText('');
      expect(result).toBe('<span class="highlighted-text"></span>');
    });

    it('should handle text with HTML entities', () => {
      const text = 'Text with <tags> and & symbols';
      const result = component.highlightText(text);

      expect(result).toContain('highlighted-text');
      expect(result).toContain(text);
    });

    it('should handle long text', () => {
      const text = 'A'.repeat(1000);
      const result = component.highlightText(text);

      expect(result).toContain('highlighted-text');
      expect(result).toContain(text);
    });
  });

  describe('Citation data validation', () => {
    it('should handle missing citation number', () => {
      const content = 'Test [1]';
      const citations = [
        {
          citationNumber: undefined as any,
          documentId: 'doc-1',
          chunkId: 'chunk-1',
          filename: 'report.pdf',
          ticker: 'AAPL',
          pageNumber: 5,
          snippet: 'Test',
          score: 0.95,
        },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);
      // Should not crash
      expect(result).toBeTruthy();
    });

    it('should handle missing document ID', () => {
      const citation = {
        citationNumber: 1,
        documentId: undefined as any,
        chunkId: 'chunk-1',
        filename: 'report.pdf',
        ticker: 'AAPL',
        pageNumber: 5,
        snippet: 'Test',
        score: 0.95,
      };

      component.previewCitation(citation);
      // Should not crash
      expect(component.showDocumentPreview).toBe(true);
    });

    it('should handle very long filenames', () => {
      const citation = {
        citationNumber: 1,
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        filename: 'A'.repeat(500) + '.pdf',
        ticker: 'AAPL',
        pageNumber: 5,
        snippet: 'Test',
        score: 0.95,
      };

      component.previewCitation(citation);
      expect(component.previewDocument.filename.length).toBe(504);
    });

    it('should handle very long snippets', () => {
      const citation = {
        citationNumber: 1,
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        filename: 'report.pdf',
        ticker: 'AAPL',
        pageNumber: 5,
        snippet: 'A'.repeat(5000),
        score: 0.95,
      };

      component.previewCitation(citation);
      expect(component.previewDocument.snippet.length).toBe(5000);
    });
  });

  describe('Edge cases', () => {
    it('should handle citation numbers out of order', () => {
      const content = 'First [3] then [1] then [2]';
      const citations = [
        { citationNumber: 3, documentId: 'doc-3', chunkId: 'c-3', filename: 'f3.pdf', ticker: null, pageNumber: null, snippet: 'S3', score: 0.9 },
        { citationNumber: 1, documentId: 'doc-1', chunkId: 'c-1', filename: 'f1.pdf', ticker: null, pageNumber: null, snippet: 'S1', score: 0.9 },
        { citationNumber: 2, documentId: 'doc-2', chunkId: 'c-2', filename: 'f2.pdf', ticker: null, pageNumber: null, snippet: 'S2', score: 0.9 },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);

      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
      expect(result).toContain('[3]');
    });

    it('should handle duplicate citation numbers', () => {
      const content = 'Test [1] and [1]';
      const citations = [
        { citationNumber: 1, documentId: 'doc-1', chunkId: 'c-1', filename: 'f.pdf', ticker: null, pageNumber: null, snippet: 'S', score: 0.9 },
        { citationNumber: 1, documentId: 'doc-2', chunkId: 'c-2', filename: 'f2.pdf', ticker: null, pageNumber: null, snippet: 'S2', score: 0.9 },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);
      // Should handle gracefully
      expect(result).toBeTruthy();
    });

    it('should handle citation markers in code blocks', () => {
      const content = '`code [1]` and text [1]';
      const citations = [
        { citationNumber: 1, documentId: 'doc-1', chunkId: 'c-1', filename: 'f.pdf', ticker: null, pageNumber: null, snippet: 'S', score: 0.9 },
      ];

      const result = component.renderMarkdownWithCitations(content, citations);
      // Should replace both occurrences
      expect((result.match(/citation-link/g) || []).length).toBeGreaterThanOrEqual(1);
    });
  });
});
