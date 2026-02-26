import { EarningsCallExtractorService } from '../../src/documents/earnings-call-extractor.service';

describe('EarningsCallExtractorService', () => {
  let service: EarningsCallExtractorService;
  let mockBedrock: any;

  const MOCK_LLM_RESPONSE = JSON.stringify({
    call_metadata: {
      company: 'Apple Inc.',
      ticker: 'AAPL',
      quarter: 'Q1 FY2025',
      date: '2025-01-30',
      participants: {
        management: [
          { name: 'Tim Cook', title: 'CEO' },
          { name: 'Luca Maestri', title: 'CFO' },
        ],
        analysts: [
          { name: 'Samik Chatterjee', firm: 'JPMorgan' },
          { name: 'Erik Woodring', firm: 'Morgan Stanley' },
        ],
      },
    },
    prepared_remarks: [
      {
        speaker: 'Tim Cook',
        role: 'CEO',
        topics_covered: ['revenue growth', 'services'],
        key_statements: [
          {
            statement: 'We achieved record revenue of $124.3 billion this quarter.',
            category: 'financial_results',
            sentiment: 'positive',
            forward_looking: false,
          },
          {
            statement: 'We expect continued momentum in our services business.',
            category: 'guidance',
            sentiment: 'cautiously_optimistic',
            forward_looking: true,
          },
        ],
        notable_language: ['record revenue'],
      },
    ],
    qa_exchanges: [
      {
        analyst_name: 'Samik Chatterjee',
        analyst_firm: 'JPMorgan',
        question_topic: 'China revenue',
        question_text: 'Can you provide more color on the China revenue decline?',
        question_sharpness: 'probing',
        responder: 'Tim Cook',
        response_summary: 'Cook acknowledged the decline but pointed to strong iPhone demand in other markets.',
        response_directness: 'partial',
        was_question_fully_answered: false,
        notable_moments: 'Cook deflected to global iPhone numbers instead of addressing China specifically.',
      },
    ],
    guidance_summary: {
      guidance_changed: true,
      direction: 'raised',
      items: [
        {
          metric: 'Revenue',
          current_guidance: '$128-132B',
          prior_guidance: '$125-130B',
          change_description: 'Raised by ~$2B at midpoint',
        },
      ],
      qualitative_outlook: 'Management expressed confidence in continued growth driven by services and emerging markets.',
    },
    tone_analysis: {
      overall_confidence: 7,
      confidence_rationale: 'Strong results but hedging on China outlook',
      hedging_instances: ['we believe', 'in the current environment'],
      superlatives_used: ['record revenue', 'best quarter ever for services'],
      topics_avoided: ['AI spending ROI'],
      new_terminology: ['spatial computing ecosystem'],
    },
    red_flags: [
      {
        flag: 'China revenue decline not directly addressed',
        evidence: 'CEO deflected China-specific question to global numbers',
        severity: 'medium',
      },
    ],
    all_metrics_mentioned: [
      {
        metric_name: 'Revenue',
        canonical_hint: 'revenue',
        value: 124300000000,
        unit: 'USD',
        period: 'Q1 FY2025',
        context: 'as-reported',
        speaker: 'Tim Cook',
      },
      {
        metric_name: 'Services Revenue',
        canonical_hint: 'services_revenue',
        value: 26300000000,
        unit: 'USD',
        period: 'Q1 FY2025',
        context: 'as-reported',
        speaker: 'Luca Maestri',
      },
    ],
  });

  beforeEach(() => {
    mockBedrock = {
      invokeClaude: jest.fn().mockResolvedValue(MOCK_LLM_RESPONSE),
    };
    service = new EarningsCallExtractorService(mockBedrock);
  });

  describe('extract()', () => {
    it('should extract structured data from a transcript', async () => {
      const result = await service.extract(
        'Fake transcript text...',
        'Apple Inc.',
        'AAPL',
        'Q1 FY2025',
      );

      expect(mockBedrock.invokeClaude).toHaveBeenCalledTimes(1);
      expect(result.callMetadata.company).toBe('Apple Inc.');
      expect(result.callMetadata.ticker).toBe('AAPL');
      expect(result.callMetadata.quarter).toBe('Q1 FY2025');
      expect(result.callMetadata.managementParticipants).toHaveLength(2);
      expect(result.callMetadata.analystParticipants).toHaveLength(2);
    });

    it('should extract prepared remarks with speaker attribution', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.preparedRemarks).toHaveLength(1);
      expect(result.preparedRemarks[0].speaker).toBe('Tim Cook');
      expect(result.preparedRemarks[0].role).toBe('CEO');
      expect(result.preparedRemarks[0].keyStatements).toHaveLength(2);
      expect(result.preparedRemarks[0].keyStatements[1].forwardLooking).toBe(true);
    });

    it('should extract Q&A exchanges with evasion detection', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.qaExchanges).toHaveLength(1);
      const qa = result.qaExchanges[0];
      expect(qa.analystName).toBe('Samik Chatterjee');
      expect(qa.questionSharpness).toBe('probing');
      expect(qa.responseDirectness).toBe('partial');
      expect(qa.wasFullyAnswered).toBe(false);
    });

    it('should extract guidance summary', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.guidanceSummary.guidanceChanged).toBe(true);
      expect(result.guidanceSummary.direction).toBe('raised');
      expect(result.guidanceSummary.items).toHaveLength(1);
      expect(result.guidanceSummary.items[0].metric).toBe('Revenue');
    });

    it('should extract tone analysis', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.toneAnalysis.overallConfidence).toBe(7);
      expect(result.toneAnalysis.hedgingInstances).toContain('we believe');
      expect(result.toneAnalysis.topicsAvoided).toContain('AI spending ROI');
    });

    it('should extract red flags', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.redFlags).toHaveLength(1);
      expect(result.redFlags[0].severity).toBe('medium');
    });

    it('should extract all metrics with canonical hints', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.allMetrics).toHaveLength(2);
      expect(result.allMetrics[0].canonicalHint).toBe('revenue');
      expect(result.allMetrics[0].value).toBe(124300000000);
      expect(result.allMetrics[0].speaker).toBe('Tim Cook');
    });

    it('should handle LLM failure gracefully', async () => {
      mockBedrock.invokeClaude.mockRejectedValue(new Error('Bedrock timeout'));

      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.callMetadata.company).toBe('Apple Inc.');
      expect(result.qaExchanges).toHaveLength(0);
      expect(result.allMetrics).toHaveLength(0);
    });

    it('should handle malformed JSON response', async () => {
      mockBedrock.invokeClaude.mockResolvedValue('not valid json {{{');

      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      // Should return empty result, not throw
      expect(result.callMetadata.ticker).toBe('AAPL');
      expect(result.qaExchanges).toHaveLength(0);
    });

    it('should handle markdown-fenced JSON response', async () => {
      mockBedrock.invokeClaude.mockResolvedValue('```json\n' + MOCK_LLM_RESPONSE + '\n```');

      const result = await service.extract('...', 'Apple Inc.', 'AAPL');

      expect(result.callMetadata.company).toBe('Apple Inc.');
      expect(result.allMetrics).toHaveLength(2);
    });
  });

  describe('toChunks()', () => {
    it('should generate atomic Q&A chunks (Spec §7.2 Rule 5)', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');
      const chunks = service.toChunks(result);

      const qaChunks = chunks.filter(c => c.sectionType === 'qa_exchange');
      expect(qaChunks.length).toBe(1);
      expect(qaChunks[0].isQA).toBe(true);
      expect(qaChunks[0].content).toContain('Samik Chatterjee');
      expect(qaChunks[0].content).toContain('JPMorgan');
    });

    it('should generate prepared remarks chunks by speaker', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');
      const chunks = service.toChunks(result);

      const remarkChunks = chunks.filter(c => c.sectionType === 'prepared_remarks');
      expect(remarkChunks.length).toBe(1);
      expect(remarkChunks[0].speakerName).toBe('Tim Cook');
      expect(remarkChunks[0].speakerRole).toBe('CEO');
    });

    it('should generate guidance summary chunk', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');
      const chunks = service.toChunks(result);

      const guidanceChunks = chunks.filter(c => c.sectionType === 'guidance');
      expect(guidanceChunks.length).toBe(1);
      expect(guidanceChunks[0].content).toContain('raised');
      expect(guidanceChunks[0].content).toContain('Revenue');
    });

    it('should generate tone analysis chunk', async () => {
      const result = await service.extract('...', 'Apple Inc.', 'AAPL');
      const chunks = service.toChunks(result);

      const toneChunks = chunks.filter(c => c.sectionType === 'tone_analysis');
      expect(toneChunks.length).toBe(1);
      expect(toneChunks[0].content).toContain('7/10');
    });
  });
});
