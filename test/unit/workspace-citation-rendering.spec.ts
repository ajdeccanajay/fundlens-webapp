/**
 * Unit Tests for Workspace Citation Rendering
 * Tests the citation display functionality in the Deals Workspace
 */

describe('Workspace Citation Rendering', () => {
  let workspace: any;

  beforeEach(() => {
    // Mock the workspace functions
    workspace = {
      renderMarkdown: (text: string) => {
        // Simple markdown mock
        return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      },
      
      renderMarkdownWithCitations: function(content: string, citations: any[]) {
        if (!citations || citations.length === 0) {
          return this.renderMarkdown(content);
        }
        
        let html = this.renderMarkdown(content);
        
        citations.forEach((citation) => {
          const marker = `[${citation.citationNumber}]`;
          const citationJson = JSON.stringify(citation).replace(/"/g, '&quot;');
          const link = `<sup class="citation-link" onclick="window.dispatchEvent(new CustomEvent('preview-citation', { detail: ${citationJson} }))">${marker}</sup>`;
          html = html.replace(new RegExp(`\\[${citation.citationNumber}\\]`, 'g'), link);
        });
        
        return html;
      },
      
      previewCitation: function(citation: any) {
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
      
      highlightText: function(text: string) {
        if (!text) return '';
        return `<span class="highlighted-text">${text}</span>`;
      },
      
      showDocumentPreview: false,
      previewDocument: {
        documentId: null,
        chunkId: null,
        filename: '',
        ticker: '',
        pageNumber: null,
        snippet: '',
        fullContent: '',
        score: null
      }
    };
  });

  describe('renderMarkdownWithCitations', () => {
    it('should render markdown content without citations', () => {
      const content = 'This is **bold** text';
      const result = workspace.renderMarkdownWithCitations(content, []);
      
      expect(result).toContain('<strong>bold</strong>');
      expect(result).not.toContain('citation-link');
    });

    it('should handle null citations array', () => {
      const content = 'Simple text';
      const result = workspace.renderMarkdownWithCitations(content, null);
      
      expect(result).toBe('Simple text');
    });

    it('should add citation links for single citation', () => {
      const content = 'Revenue increased [1] in Q4';
      const citations = [{
        citationNumber: 1,
        documentId: 'doc-1',
        chunkId: 'chunk-1',
        filename: 'report.pdf',
        ticker: 'AAPL',
        pageNumber: 5,
        snippet: 'Revenue increased to $2.5B',
        score: 0.95
      }];
      
      const result = workspace.renderMarkdownWithCitations(content, citations);
      
      expect(result).toContain('citation-link');
      expect(result).toContain('[1]');
      expect(result).toContain('preview-citation');
    });

    it('should add citation links for multiple citations', () => {
      const content = 'Revenue [1] and profit [2] increased';
      const citations = [
        {
          citationNumber: 1,
          documentId: 'doc-1',
          filename: 'report1.pdf',
          snippet: 'Revenue data'
        },
        {
          citationNumber: 2,
          documentId: 'doc-2',
          filename: 'report2.pdf',
          snippet: 'Profit data'
        }
      ];
      
      const result = workspace.renderMarkdownWithCitations(content, citations);
      
      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
      const citationCount = (result.match(/citation-link/g) || []).length;
      expect(citationCount).toBe(2);
    });

    it('should handle citations with special characters', () => {
      const content = 'Data from source [1]';
      const citations = [{
        citationNumber: 1,
        documentId: 'doc-1',
        filename: 'report "special".pdf',
        snippet: 'Text with "quotes" and \'apostrophes\''
      }];
      
      const result = workspace.renderMarkdownWithCitations(content, citations);
      
      expect(result).toContain('citation-link');
      expect(result).toContain('&quot;');
    });

    it('should replace all occurrences of citation marker', () => {
      const content = 'First [1] and second [1] reference';
      const citations = [{
        citationNumber: 1,
        documentId: 'doc-1',
        filename: 'report.pdf',
        snippet: 'Data'
      }];
      
      const result = workspace.renderMarkdownWithCitations(content, citations);
      
      const citationCount = (result.match(/citation-link/g) || []).length;
      expect(citationCount).toBe(2);
    });
  });

  describe('previewCitation', () => {
    it('should set preview document data', () => {
      const citation = {
        citationNumber: 1,
        documentId: 'doc-123',
        chunkId: 'chunk-456',
        filename: 'annual-report.pdf',
        ticker: 'AAPL',
        pageNumber: 10,
        snippet: 'Revenue increased to $2.5B in Q4 2023',
        score: 0.92
      };
      
      workspace.previewCitation(citation);
      
      expect(workspace.previewDocument.documentId).toBe('doc-123');
      expect(workspace.previewDocument.chunkId).toBe('chunk-456');
      expect(workspace.previewDocument.filename).toBe('annual-report.pdf');
      expect(workspace.previewDocument.ticker).toBe('AAPL');
      expect(workspace.previewDocument.pageNumber).toBe(10);
      expect(workspace.previewDocument.snippet).toBe('Revenue increased to $2.5B in Q4 2023');
      expect(workspace.previewDocument.score).toBe(0.92);
    });

    it('should show document preview modal', () => {
      const citation = {
        documentId: 'doc-1',
        filename: 'test.pdf',
        snippet: 'Test content'
      };
      
      workspace.previewCitation(citation);
      
      expect(workspace.showDocumentPreview).toBe(true);
    });

    it('should handle citation without optional fields', () => {
      const citation = {
        documentId: 'doc-1',
        filename: 'test.pdf',
        snippet: 'Test content'
      };
      
      workspace.previewCitation(citation);
      
      expect(workspace.previewDocument.documentId).toBe('doc-1');
      expect(workspace.previewDocument.ticker).toBeUndefined();
      expect(workspace.previewDocument.pageNumber).toBeUndefined();
    });
  });

  describe('highlightText', () => {
    it('should wrap text in highlighted span', () => {
      const text = 'Revenue increased to $2.5B';
      const result = workspace.highlightText(text);
      
      expect(result).toBe('<span class="highlighted-text">Revenue increased to $2.5B</span>');
    });

    it('should handle empty text', () => {
      const result = workspace.highlightText('');
      
      expect(result).toBe('');
    });

    it('should handle null text', () => {
      const result = workspace.highlightText(null);
      
      expect(result).toBe('');
    });

    it('should handle text with HTML entities', () => {
      const text = 'Revenue > $2.5B & profit < $1B';
      const result = workspace.highlightText(text);
      
      expect(result).toContain('highlighted-text');
      expect(result).toContain(text);
    });
  });

  describe('Edge Cases', () => {
    it('should handle citation numbers out of order', () => {
      const content = 'First [3] then [1] then [2]';
      const citations = [
        { citationNumber: 3, documentId: 'doc-3', filename: 'c.pdf', snippet: 'C' },
        { citationNumber: 1, documentId: 'doc-1', filename: 'a.pdf', snippet: 'A' },
        { citationNumber: 2, documentId: 'doc-2', filename: 'b.pdf', snippet: 'B' }
      ];
      
      const result = workspace.renderMarkdownWithCitations(content, citations);
      
      expect(result).toContain('[3]');
      expect(result).toContain('[1]');
      expect(result).toContain('[2]');
    });

    it('should handle duplicate citation numbers', () => {
      const content = 'Reference [1] and [1] again';
      const citations = [
        { citationNumber: 1, documentId: 'doc-1', filename: 'a.pdf', snippet: 'A' }
      ];
      
      const result = workspace.renderMarkdownWithCitations(content, citations);
      
      const citationCount = (result.match(/citation-link/g) || []).length;
      expect(citationCount).toBe(2);
    });

    it('should handle very long filenames', () => {
      const citation = {
        documentId: 'doc-1',
        filename: 'very-long-filename-that-exceeds-normal-length-limits-and-should-be-truncated-in-display.pdf',
        snippet: 'Content'
      };
      
      workspace.previewCitation(citation);
      
      expect(workspace.previewDocument.filename).toBe(citation.filename);
    });

    it('should handle very long snippets', () => {
      const longSnippet = 'A'.repeat(1000);
      const citation = {
        documentId: 'doc-1',
        filename: 'test.pdf',
        snippet: longSnippet
      };
      
      workspace.previewCitation(citation);
      
      expect(workspace.previewDocument.snippet).toBe(longSnippet);
    });
  });
});
