/**
 * Earnings Call Transcript Extractor — Spec §6
 *
 * Specialized extraction for earnings call transcripts.
 * Uses a single Sonnet call with the full transcript to produce:
 *   - Structured Q&A exchanges
 *   - Guidance summary
 *   - Tone analysis
 *   - Speaker-attributed metrics
 *   - Red flags and notable items
 *
 * NOT vision-based — transcripts are text documents.
 */
import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';

export interface EarningsCallResult {
  callMetadata: CallMetadata;
  preparedRemarks: PreparedRemark[];
  qaExchanges: QAExchange[];
  guidanceSummary: GuidanceSummary;
  toneAnalysis: ToneAnalysis;
  redFlags: RedFlag[];
  allMetrics: EarningsMetric[];
  textChunks: EarningsChunk[];
}

export interface CallMetadata {
  company: string;
  ticker: string;
  quarter: string;
  date: string;
  managementParticipants: { name: string; title: string }[];
  analystParticipants: { name: string; firm: string }[];
}

export interface PreparedRemark {
  speaker: string;
  role: string;
  topicsCovered: string[];
  keyStatements: {
    statement: string;
    category: string;
    sentiment: string;
    forwardLooking: boolean;
  }[];
  notableLanguage: string[];
}

export interface QAExchange {
  analystName: string;
  analystFirm: string;
  questionTopic: string;
  questionText: string;
  questionSharpness: string;
  responder: string;
  responseSummary: string;
  responseDirectness: string;
  wasFullyAnswered: boolean;
  notableMoments: string;
}

export interface GuidanceSummary {
  guidanceChanged: boolean;
  direction: string;
  items: { metric: string; currentGuidance: string; priorGuidance: string; changeDescription: string }[];
  qualitativeOutlook: string;
}

export interface ToneAnalysis {
  overallConfidence: number;
  confidenceRationale: string;
  hedgingInstances: string[];
  superlativesUsed: string[];
  topicsAvoided: string[];
  newTerminology: string[];
}

export interface RedFlag {
  flag: string;
  evidence: string;
  severity: 'low' | 'medium' | 'high';
}

export interface EarningsMetric {
  metricName: string;
  canonicalHint: string;
  value: number | null;
  unit: string;
  period: string;
  context: string;
  speaker: string;
}

export interface EarningsChunk {
  content: string;
  sectionType: string;
  sectionHeading: string;
  speakerName?: string;
  speakerRole?: string;
  isQA?: boolean;
}

const EARNINGS_CALL_SYSTEM_PROMPT = `You are a financial analyst AI processing earnings call transcripts for FundLens. Transform this raw transcript into structured data.

OUTPUT FORMAT (JSON only, no markdown):
{
  "call_metadata": {
    "company": "<company name>",
    "ticker": "<ticker>",
    "quarter": "<e.g., Q3 2025>",
    "date": "<call date>",
    "participants": {
      "management": [{ "name": "<name>", "title": "<title>" }],
      "analysts": [{ "name": "<name>", "firm": "<firm>" }]
    }
  },
  "prepared_remarks": [{
    "speaker": "<name>",
    "role": "<CEO|CFO|COO|VP|IR|other>",
    "topics_covered": ["<topic>"],
    "key_statements": [{
      "statement": "<exact or near-exact quote>",
      "category": "<financial_results|guidance|strategy|operational_update|market_commentary|product_update|capital_allocation>",
      "sentiment": "<positive|negative|neutral|cautiously_optimistic|defensive|evasive>",
      "forward_looking": true|false
    }],
    "notable_language": ["<unusual phrases, hedging, tone shifts>"]
  }],
  "qa_exchanges": [{
    "analyst_name": "<name>",
    "analyst_firm": "<firm>",
    "question_topic": "<brief topic>",
    "question_text": "<the question>",
    "question_sharpness": "<routine|probing|confrontational>",
    "responder": "<who answered>",
    "response_summary": "<2-3 sentence summary>",
    "response_directness": "<direct|partial|evasive|defensive|deflective>",
    "was_question_fully_answered": true|false,
    "notable_moments": "<tension, non-answers, redirections>"
  }],
  "guidance_summary": {
    "guidance_changed": true|false,
    "direction": "<raised|lowered|maintained|narrowed|withdrew>",
    "items": [{ "metric": "<name>", "current_guidance": "<value>", "prior_guidance": "<if mentioned>", "change_description": "<what changed>" }],
    "qualitative_outlook": "<management's overall characterization>"
  },
  "tone_analysis": {
    "overall_confidence": <1-10>,
    "confidence_rationale": "<why this score>",
    "hedging_instances": ["<specific hedging phrases>"],
    "superlatives_used": ["<'best quarter ever', 'record', etc.>"],
    "topics_avoided": ["<topics not addressed>"],
    "new_terminology": ["<new buzzwords>"]
  },
  "red_flags": [{ "flag": "<description>", "evidence": "<what was said>", "severity": "<low|medium|high>" }],
  "all_metrics_mentioned": [{
    "metric_name": "<standardized name>",
    "canonical_hint": "<FundLens canonical metric>",
    "value": null,
    "unit": "<USD|%|etc>",
    "period": "<quarter/year>",
    "context": "<as-reported|guidance|comparison>",
    "speaker": "<who stated it>"
  }]
}

EXTRACTION RULES:
1. SPEAKER ATTRIBUTION MATTERS. If CEO says something optimistic but CFO hedges, capture both.
2. TRACK WHAT'S NOT SAID. If a company previously discussed a product line and it's absent, flag it.
3. HEDGING LANGUAGE. Flag: "subject to", "we believe", "cautiously", "going forward", "we'll see", "it's early days".
4. EVASION DETECTION. If analyst asks X and management pivots to Y, mark was_question_fully_answered: false.
5. GUIDANCE IS SACRED. Extract exact numbers, ranges, qualifiers.
6. SENTIMENT SCORING — BE CONSERVATIVE. 7/10 means notably confident, not just "things are fine."`;

@Injectable()
export class EarningsCallExtractorService {
  private readonly logger = new Logger(EarningsCallExtractorService.name);

  constructor(private readonly bedrock: BedrockService) {}

  /**
   * Extract structured data from an earnings call transcript.
   */
  async extract(
    rawText: string,
    companyName: string,
    ticker: string,
    filingPeriod?: string,
  ): Promise<EarningsCallResult> {
    const startTime = Date.now();
    this.logger.log(`Extracting earnings call: ${ticker} ${filingPeriod || ''}`);

    const userPrompt = `Process this earnings call transcript:\n\n` +
      `Company: ${companyName}\n` +
      `Ticker: ${ticker}\n` +
      `Quarter: ${filingPeriod || 'Unknown'}\n\n` +
      rawText;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt: userPrompt,
        systemPrompt: EARNINGS_CALL_SYSTEM_PROMPT,
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        max_tokens: 8192,
        temperature: 0.0,
      });

      const parsed = this.parseResponse(response);
      const result = this.toResult(parsed, ticker);

      this.logger.log(
        `Earnings call extraction complete: ${result.qaExchanges.length} Q&A, ` +
        `${result.allMetrics.length} metrics, ${result.redFlags.length} red flags ` +
        `(${Date.now() - startTime}ms)`,
      );

      return result;
    } catch (err) {
      this.logger.error(`Earnings call extraction failed: ${err.message}`);
      return this.emptyResult(ticker, companyName, filingPeriod);
    }
  }

  /**
   * Convert extracted data into text chunks for semantic search.
   * Each Q&A exchange = one atomic chunk. Prepared remarks split by speaker+topic.
   */
  toChunks(result: EarningsCallResult): EarningsChunk[] {
    const chunks: EarningsChunk[] = [];

    // Prepared remarks: one chunk per speaker
    for (const remark of result.preparedRemarks) {
      const statements = remark.keyStatements.map(s => s.statement).join('\n\n');
      if (statements.length > 50) {
        chunks.push({
          content: `${remark.speaker} (${remark.role}) — ${remark.topicsCovered.join(', ')}:\n\n${statements}`,
          sectionType: 'prepared_remarks',
          sectionHeading: `${remark.speaker} Prepared Remarks`,
          speakerName: remark.speaker,
          speakerRole: remark.role,
          isQA: false,
        });
      }
    }

    // Q&A: each exchange is one atomic chunk (Spec §7.2 Rule 5)
    for (const qa of result.qaExchanges) {
      chunks.push({
        content: `Q (${qa.analystName}, ${qa.analystFirm}): ${qa.questionText}\n\n` +
          `A (${qa.responder}): ${qa.responseSummary}`,
        sectionType: 'qa_exchange',
        sectionHeading: `Q&A: ${qa.questionTopic}`,
        speakerName: qa.analystName,
        isQA: true,
      });
    }

    // Guidance summary as a chunk
    if (result.guidanceSummary.items.length > 0) {
      const guidanceText = result.guidanceSummary.items
        .map(g => `${g.metric}: ${g.currentGuidance}${g.changeDescription ? ` (${g.changeDescription})` : ''}`)
        .join('\n');
      chunks.push({
        content: `Guidance Summary (${result.guidanceSummary.direction}):\n${guidanceText}\n\nOutlook: ${result.guidanceSummary.qualitativeOutlook}`,
        sectionType: 'guidance',
        sectionHeading: 'Guidance Summary',
      });
    }

    // Tone analysis as a chunk
    if (result.toneAnalysis.overallConfidence > 0) {
      chunks.push({
        content: `Management Tone Analysis:\nConfidence: ${result.toneAnalysis.overallConfidence}/10 — ${result.toneAnalysis.confidenceRationale}\n` +
          (result.toneAnalysis.hedgingInstances.length > 0 ? `Hedging: ${result.toneAnalysis.hedgingInstances.join('; ')}\n` : '') +
          (result.toneAnalysis.topicsAvoided.length > 0 ? `Topics Avoided: ${result.toneAnalysis.topicsAvoided.join('; ')}` : ''),
        sectionType: 'tone_analysis',
        sectionHeading: 'Tone Analysis',
      });
    }

    return chunks;
  }

  private parseResponse(response: string): any {
    let json = response.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    return JSON.parse(json);
  }

  private toResult(parsed: any, ticker: string): EarningsCallResult {
    const meta = parsed.call_metadata || {};
    return {
      callMetadata: {
        company: meta.company || '',
        ticker: meta.ticker || ticker,
        quarter: meta.quarter || '',
        date: meta.date || '',
        managementParticipants: (meta.participants?.management || []).map((p: any) => ({
          name: p.name, title: p.title,
        })),
        analystParticipants: (meta.participants?.analysts || []).map((p: any) => ({
          name: p.name, firm: p.firm,
        })),
      },
      preparedRemarks: (parsed.prepared_remarks || []).map((r: any) => ({
        speaker: r.speaker || '',
        role: r.role || '',
        topicsCovered: r.topics_covered || [],
        keyStatements: (r.key_statements || []).map((s: any) => ({
          statement: s.statement || '',
          category: s.category || '',
          sentiment: s.sentiment || 'neutral',
          forwardLooking: s.forward_looking || false,
        })),
        notableLanguage: r.notable_language || [],
      })),
      qaExchanges: (parsed.qa_exchanges || []).map((q: any) => ({
        analystName: q.analyst_name || '',
        analystFirm: q.analyst_firm || '',
        questionTopic: q.question_topic || '',
        questionText: q.question_text || '',
        questionSharpness: q.question_sharpness || 'routine',
        responder: q.responder || '',
        responseSummary: q.response_summary || '',
        responseDirectness: q.response_directness || 'direct',
        wasFullyAnswered: q.was_question_fully_answered ?? true,
        notableMoments: q.notable_moments || '',
      })),
      guidanceSummary: {
        guidanceChanged: parsed.guidance_summary?.guidance_changed || false,
        direction: parsed.guidance_summary?.direction || 'maintained',
        items: (parsed.guidance_summary?.items || []).map((g: any) => ({
          metric: g.metric || '',
          currentGuidance: g.current_guidance || '',
          priorGuidance: g.prior_guidance || '',
          changeDescription: g.change_description || '',
        })),
        qualitativeOutlook: parsed.guidance_summary?.qualitative_outlook || '',
      },
      toneAnalysis: {
        overallConfidence: parsed.tone_analysis?.overall_confidence || 0,
        confidenceRationale: parsed.tone_analysis?.confidence_rationale || '',
        hedgingInstances: parsed.tone_analysis?.hedging_instances || [],
        superlativesUsed: parsed.tone_analysis?.superlatives_used || [],
        topicsAvoided: parsed.tone_analysis?.topics_avoided || [],
        newTerminology: parsed.tone_analysis?.new_terminology || [],
      },
      redFlags: (parsed.red_flags || []).map((f: any) => ({
        flag: f.flag || '',
        evidence: f.evidence || '',
        severity: f.severity || 'low',
      })),
      allMetrics: (parsed.all_metrics_mentioned || []).map((m: any) => ({
        metricName: m.metric_name || '',
        canonicalHint: m.canonical_hint || '',
        value: m.value,
        unit: m.unit || '',
        period: m.period || '',
        context: m.context || 'as-reported',
        speaker: m.speaker || '',
      })),
      textChunks: [],
    };
  }

  private emptyResult(ticker: string, company: string, period?: string): EarningsCallResult {
    return {
      callMetadata: {
        company, ticker, quarter: period || '', date: '',
        managementParticipants: [], analystParticipants: [],
      },
      preparedRemarks: [],
      qaExchanges: [],
      guidanceSummary: { guidanceChanged: false, direction: 'unknown', items: [], qualitativeOutlook: '' },
      toneAnalysis: { overallConfidence: 0, confidenceRationale: '', hedgingInstances: [], superlativesUsed: [], topicsAvoided: [], newTerminology: [] },
      redFlags: [],
      allMetrics: [],
      textChunks: [],
    };
  }
}
