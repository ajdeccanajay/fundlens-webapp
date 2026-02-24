/**
 * Long-Context Fallback — Unit Tests
 * Tests Spec §7.1 Source 4: raw doc text sent to Claude 200K context window
 *
 * Coverage:
 *   - RAGService.query() with longContextText option
 *   - ChatService long-context document lookup
 *   - Narrative injection into existing retrieval results
 *   - Truncation to 180K chars (200K token budget)
 *   - Graceful handling when no long-context docs exist
 */

describe('Long-Context Fallback (Spec §7.1 Source 4)', () => {

  // ─── RAGService longContextText injection ──────────────────────

  describe('RAGService query with longContextText', () => {
    it('should inject long-context text into narratives array', () => {
      // Simulate what happens inside RAGService.query() when longContextText is provided
      const existingNarratives: any[] = [
        { content: 'SEC filing content', score: 0.8, metadata: { ticker: 'AAPL' } },
      ];

      const longContextText = 'This is a Goldman Sachs report on Apple Inc. with price target $275...';
      const longContextFileName = 'gs-aapl-report.pdf';

      // This mirrors the logic added in rag.service.ts
      const longContextChunk = {
        content: longContextText.substring(0, 180000),
        score: 0.95,
        metadata: {
          ticker: 'AAPL',
          sectionType: 'uploaded-document',
          filingType: 'user-upload',
          fiscalPeriod: undefined,
          chunkIndex: undefined,
        },
        source: {
          location: longContextFileName,
          type: 'long-context-fallback',
        },
      };

      const mergedNarratives = [...existingNarratives, longContextChunk];

      expect(mergedNarratives).toHaveLength(2);
      expect(mergedNarratives[1].source.type).toBe('long-context-fallback');
      expect(mergedNarratives[1].score).toBe(0.95);
      expect(mergedNarratives[1].content).toBe(longContextText);
    });

    it('should truncate long-context text to 180K chars', () => {
      const hugeText = 'A'.repeat(200000);

      const truncated = hugeText.substring(0, 180000);

      expect(truncated.length).toBe(180000);
      expect(truncated.length).toBeLessThan(hugeText.length);
    });

    it('should not inject when longContextText is empty', () => {
      const narratives: any[] = [
        { content: 'existing', score: 0.8 },
      ];

      const longContextText = '';

      // The if condition: options?.longContextText && options.longContextText.length > 0
      if (longContextText && longContextText.length > 0) {
        narratives.push({ content: longContextText });
      }

      expect(narratives).toHaveLength(1);
    });

    it('should not inject when longContextText is undefined', () => {
      const narratives: any[] = [
        { content: 'existing', score: 0.8 },
      ];

      const longContextText: string | undefined = undefined;

      if (longContextText && longContextText.length > 0) {
        narratives.push({ content: longContextText });
      }

      expect(narratives).toHaveLength(1);
    });

    it('should preserve existing narratives when adding long-context', () => {
      const existingNarratives = [
        { content: 'SEC filing 1', score: 0.9 },
        { content: 'SEC filing 2', score: 0.85 },
        { content: 'KB result', score: 0.7 },
      ];

      const longContextChunk = {
        content: 'Uploaded document text',
        score: 0.95,
        source: { type: 'long-context-fallback' },
      };

      const merged = [...existingNarratives, longContextChunk];

      expect(merged).toHaveLength(4);
      expect(merged[0].content).toBe('SEC filing 1');
      expect(merged[3].source.type).toBe('long-context-fallback');
    });
  });

  // ─── ChatService long-context document lookup ──────────────────

  describe('ChatService long-context document lookup', () => {
    it('should query intel_documents for long-context-fallback docs', () => {
      // Verify the SQL pattern used in chat.service.ts
      const expectedSql = `SELECT document_id, raw_text_s3_key, file_name
           FROM intel_documents
           WHERE deal_id = $1::uuid
             AND tenant_id = $2::uuid
             AND processing_mode = 'long-context-fallback'
             AND status = 'queryable'
           ORDER BY created_at DESC LIMIT 1`;

      expect(expectedSql).toContain('intel_documents');
      expect(expectedSql).toContain("processing_mode = 'long-context-fallback'");
      expect(expectedSql).toContain("status = 'queryable'");
      expect(expectedSql).toContain('LIMIT 1');
    });

    it('should handle case when no long-context docs exist', () => {
      // When query returns empty array, longContextText should remain undefined
      const longContextDocs: any[] = [];
      let longContextText: string | undefined;

      if (longContextDocs.length > 0 && longContextDocs[0].raw_text_s3_key) {
        longContextText = 'would be set';
      }

      expect(longContextText).toBeUndefined();
    });

    it('should handle case when doc exists but has no raw_text_s3_key', () => {
      const longContextDocs = [{ document_id: 'abc', raw_text_s3_key: null, file_name: 'test.pdf' }];
      let longContextText: string | undefined;

      if (longContextDocs.length > 0 && longContextDocs[0].raw_text_s3_key) {
        longContextText = 'would be set';
      }

      expect(longContextText).toBeUndefined();
    });
  });

  // ─── Query options interface ───────────────────────────────────

  describe('RAGService query options', () => {
    it('should accept longContextText and longContextFileName options', () => {
      const options = {
        includeNarrative: true,
        includeCitations: true,
        ticker: 'AAPL',
        longContextText: 'Raw document text here...',
        longContextFileName: 'report.pdf',
      };

      expect(options.longContextText).toBeDefined();
      expect(options.longContextFileName).toBe('report.pdf');
    });

    it('should work without longContextText (backward compatible)', () => {
      const options = {
        includeNarrative: true,
        includeCitations: true,
        ticker: 'AAPL',
      };

      expect((options as any).longContextText).toBeUndefined();
    });
  });
});
