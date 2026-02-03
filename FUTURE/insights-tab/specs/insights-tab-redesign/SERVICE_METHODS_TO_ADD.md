# Service Methods to Add - Quick Reference

**File:** `src/deals/insights.service.ts`  
**Location:** Before the final closing brace `}`  
**Estimated Time:** 1 hour

---

## Instructions

1. Open `src/deals/insights.service.ts`
2. Scroll to the end of the file (line ~309)
3. Find the last method `formatMetricName()`
4. After that method's closing brace, add the following methods
5. Keep the final closing brace `}` at the very end
6. Run `npm run build` to verify

---

## Methods to Add

Copy and paste the following code before the final `}`:

```typescript
  /**
   * Get comprehensive context for a metric (footnotes, MD&A, breakdowns)
   */
  async getMetricContext(
    dealId: string,
    metricId: string,
    period?: string,
  ): Promise<{
    metricId: string;
    metricName: string;
    period: string;
    footnotes: Array<{
      number: string;
      title: string;
      text: string;
      contextType: string;
      extractedData?: any;
    }>;
    mdaQuotes: Array<{
      text: string;
      section: string;
      relevance: 'high' | 'medium' | 'low';
      keywords: string[];
    }>;
    breakdowns: {
      segments?: Array<{
        segmentName: string;
        value: number;
        percentage: number;
        yoyChange?: number;
      }>;
    };
    sourceDocument: {
      url: string;
      section: string;
    };
  }> {
    // 1. Get metric details
    const metric = await this.prisma.financialMetric.findUnique({
      where: { id: metricId },
      include: {
        deal: true,
      },
    });

    if (!metric) {
      throw new Error('Metric not found');
    }

    const metricPeriod = period || metric.fiscalPeriod;

    // 2. Get footnote references
    const footnoteRefs = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        footnote_number as "footnoteNumber",
        footnote_section as "footnoteSection",
        footnote_text as "footnoteText",
        context_type as "contextType",
        extracted_data as "extractedData"
      FROM footnote_references
      WHERE metric_id = $1::uuid
      ORDER BY footnote_number
    `, metricId);

    const footnotes = footnoteRefs.map(f => ({
      number: f.footnoteNumber,
      title: f.footnoteSection || `Footnote ${f.footnoteNumber}`,
      text: f.footnoteText || '',
      contextType: f.contextType || 'other',
      extractedData: f.extractedData,
    }));

    // 3. Get MD&A context
    const mdaQuotes = await this.extractMDAContext(
      dealId,
      metric.normalizedMetric || metric.rawLabel,
      metricPeriod,
    );

    // 4. Get segment breakdowns (if applicable)
    const breakdowns = await this.extractSegmentBreakdowns(
      dealId,
      metricId,
      metricPeriod,
    );

    // 5. Get source document info
    const sourceDocument = await this.getSourceDocument(
      dealId,
      metricPeriod,
    );

    return {
      metricId,
      metricName: metric.normalizedMetric || metric.rawLabel,
      period: metricPeriod,
      footnotes,
      mdaQuotes,
      breakdowns,
      sourceDocument,
    };
  }

  /**
   * Extract MD&A context for a metric
   */
  private async extractMDAContext(
    dealId: string,
    metricName: string,
    period?: string,
  ): Promise<Array<{
    text: string;
    section: string;
    relevance: 'high' | 'medium' | 'low';
    keywords: string[];
  }>> {
    try {
      // Search narrative_chunks for mentions of the metric
      const whereClause: any = {
        deal_id: dealId,
        section_type: {
          in: ['MD&A', 'Management Discussion', 'Results of Operations'],
        },
      };

      if (period) {
        whereClause.filing_period = period;
      }

      // Get all chunks for the deal/period
      const chunks = await this.prisma.narrative_chunk.findMany({
        where: whereClause,
        take: 20, // Get more chunks to search through
      });

      // Filter chunks that mention the metric
      const relevantChunks = chunks.filter(chunk => 
        chunk.content.toLowerCase().includes(metricName.toLowerCase())
      );

      // Extract relevant sentences and create quotes
      const quotes = relevantChunks.slice(0, 5).map(chunk => {
        // Extract sentences containing the metric
        const sentences = chunk.content.split(/[.!?]+/);
        const relevantSentences = sentences.filter(s => 
          s.toLowerCase().includes(metricName.toLowerCase())
        );

        const text = relevantSentences.slice(0, 2).join('. ').trim();
        const keywords = this.extractKeywords(text);

        return {
          text: text || chunk.content.substring(0, 200),
          section: chunk.section_type,
          relevance: this.calculateRelevance(relevantSentences, metricName),
          keywords,
        };
      });

      return quotes;
    } catch (error) {
      this.logger.error(`Failed to extract MD&A context: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract segment breakdowns for a metric
   */
  private async extractSegmentBreakdowns(
    dealId: string,
    metricId: string,
    period?: string,
  ): Promise<{
    segments?: Array<{
      segmentName: string;
      value: number;
      percentage: number;
      yoyChange?: number;
    }>;
  }> {
    try {
      // Get child metrics from hierarchy
      const hierarchy = await this.metricHierarchyService.getHierarchyForDeal(dealId);
      const children = this.metricHierarchyService.getChildren(metricId, hierarchy);

      if (children.length === 0) {
        return {};
      }

      const total = children.reduce((sum, c) => sum + (c.value || 0), 0);

      if (total === 0) {
        return {};
      }

      return {
        segments: children.map(child => ({
          segmentName: child.label,
          value: child.value || 0,
          percentage: ((child.value || 0) / total) * 100,
          yoyChange: undefined, // TODO: Calculate YoY change
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to extract segment breakdowns: ${error.message}`);
      return {};
    }
  }

  /**
   * Get source document URL
   */
  private async getSourceDocument(
    dealId: string,
    period?: string,
  ): Promise<{ url: string; section: string }> {
    try {
      const deal = await this.prisma.deal.findUnique({
        where: { id: dealId },
        select: { ticker: true },
      });

      if (!deal) {
        throw new Error('Deal not found');
      }

      // Extract year from period (e.g., "FY2024" -> "2024")
      let year = new Date().getFullYear();
      if (period) {
        const yearMatch = period.match(/\d{4}/);
        if (yearMatch) {
          year = parseInt(yearMatch[0]);
        }
      }

      // Construct SEC EDGAR URL
      const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${deal.ticker}&type=10-K&dateb=${year}1231&owner=exclude&count=1`;

      return {
        url,
        section: 'Financial Statements',
      };
    } catch (error) {
      this.logger.error(`Failed to get source document: ${error.message}`);
      return {
        url: 'https://www.sec.gov',
        section: 'SEC EDGAR',
      };
    }
  }

  /**
   * Calculate relevance of MD&A text to metric
   */
  private calculateRelevance(
    sentences: string[],
    metricName: string,
  ): 'high' | 'medium' | 'low' {
    const text = sentences.join(' ').toLowerCase();
    const metric = metricName.toLowerCase();

    // High relevance: metric + financial keywords
    const financialKeywords = [
      'increase', 'decrease', 'growth', 'decline', 'improved', 'declined',
      'higher', 'lower', 'driven by', 'primarily due to',
    ];
    const hasFinancialContext = financialKeywords.some(k => text.includes(k));

    if (hasFinancialContext && text.split(metric).length > 2) {
      return 'high';
    }

    // Medium relevance: metric mentioned multiple times
    if (text.split(metric).length > 1) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const keywords = [
      'increase', 'decrease', 'growth', 'decline', 'improved', 'declined',
      'higher', 'lower', 'driven by', 'primarily due to', 'resulted from',
      'headwinds', 'tailwinds', 'pressure', 'favorable', 'unfavorable',
      'strong', 'weak', 'robust', 'challenging',
    ];

    return keywords.filter(k => text.toLowerCase().includes(k));
  }
```

---

## Verification

After adding the methods, run:

```bash
npm run build
```

Expected output:
```
✔ Successfully compiled
```

If you see errors, check:
1. All opening braces `{` have matching closing braces `}`
2. The final closing brace `}` of the class is still at the end
3. No syntax errors in the pasted code

---

## What These Methods Do

### `getMetricContext()`
- Main method called by the API endpoint
- Aggregates all context data
- Returns comprehensive context object

### `extractMDAContext()`
- Searches narrative_chunks for metric mentions
- Extracts relevant sentences
- Scores relevance (high/medium/low)
- Returns top 5 quotes

### `extractSegmentBreakdowns()`
- Gets child metrics from hierarchy
- Calculates percentages
- Returns segment breakdown

### `getSourceDocument()`
- Constructs SEC EDGAR URL
- Returns URL and section name

### `calculateRelevance()`
- Scores MD&A quote relevance
- Checks for financial keywords
- Returns 'high', 'medium', or 'low'

### `extractKeywords()`
- Extracts financial keywords from text
- Returns array of matching keywords

---

## After Completion

Once the build succeeds:

1. ✅ Backend API is complete
2. ✅ Service methods are complete
3. ⏳ Move to frontend integration
4. ⏳ Write E2E tests
5. ⏳ Complete documentation

---

**Status:** Ready to implement  
**Time:** ~1 hour  
**Difficulty:** Easy (copy/paste + verify)
