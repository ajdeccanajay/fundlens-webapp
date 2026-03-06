import { Injectable, Logger } from '@nestjs/common';

export interface PresetQuestion {
  id: string;
  category: string;
  text: string;
  requiresData: string[]; // e.g., ['10-K', '10-Q']
}

export interface AnalysisMode {
  name: string;
  description: string;
  systemPrompt: string;
  presetQuestions: PresetQuestion[];
}

@Injectable()
export class AnalysisModeRegistryService {
  private readonly logger = new Logger(AnalysisModeRegistryService.name);
  private readonly modes = new Map<string, AnalysisMode>();

  constructor() {
    this.registerBuiltInModes();
  }

  registerMode(mode: AnalysisMode): void {
    this.modes.set(mode.name, mode);
    this.logger.log(`Registered analysis mode: ${mode.name}`);
  }

  getMode(name: string): AnalysisMode | undefined {
    return this.modes.get(name);
  }

  listModes(): AnalysisMode[] {
    return Array.from(this.modes.values());
  }

  getPresetQuestions(modeName: string, availableFilingTypes: string[]): PresetQuestion[] {
    const mode = this.modes.get(modeName);
    if (!mode) return [];
    return mode.presetQuestions.filter(q =>
      q.requiresData.some(r => availableFilingTypes.includes(r)),
    );
  }

  private registerBuiltInModes(): void {
    // Provocations Mode
    this.registerMode({
      name: 'provocations',
      description: 'Adversarial research analysis that stress-tests investment theses',
      systemPrompt: `You are the FundLens Provocations Engine — a senior adversarial research analyst. Your job is to stress-test investment theses by surfacing risks, contradictions, and inconvenient truths hidden in SEC filings. Be direct, evidence-based, and challenging. Every finding must reference specific filing sections.`,
      presetQuestions: [
        {
          id: 'risk-factors-delta',
          category: 'Cross-Filing Language Analysis',
          text: 'What risk factors were added, removed, or materially changed between the last two 10-Ks?',
          requiresData: ['10-K'],
        },
        {
          id: 'mda-tone-shift',
          category: 'Cross-Filing Language Analysis',
          text: "How has management's tone in the MD&A section shifted over recent filings?",
          requiresData: ['10-Q', '10-K'],
        },
        {
          id: 'accounting-policy-changes',
          category: 'Financial Red Flags',
          text: 'Were there any accounting policy changes or restatements in recent filings?',
          requiresData: ['10-K'],
        },
        {
          id: 'guidance-vs-results',
          category: 'Management Credibility',
          text: 'How does management guidance compare to actual reported results?',
          requiresData: ['10-K', '10-Q'],
        },
        {
          id: 'related-party-transactions',
          category: 'Financial Red Flags',
          text: 'Are there any notable related-party transactions or off-balance-sheet arrangements?',
          requiresData: ['10-K'],
        },
        {
          id: 'competitive-moat-erosion',
          category: 'Thesis Stress Testing',
          text: 'What evidence suggests the competitive moat is strengthening or eroding?',
          requiresData: ['10-K', '10-Q'],
        },
      ],
    });

    // Sentiment Mode
    this.registerMode({
      name: 'sentiment',
      description: 'Track management tone and confidence shifts across filings',
      systemPrompt: `You are a sentiment analysis engine tracking management tone, confidence, and language patterns across SEC filings. Focus on confidence indicators, tone shifts, hedging language, commitment levels, and defensive language. Output sentiment scores (-1 to +1) and highlight material tone shifts.`,
      presetQuestions: [
        {
          id: 'mda-sentiment-trend',
          category: 'Sentiment Tracking',
          text: 'How has management sentiment in MD&A changed over recent filings?',
          requiresData: ['10-Q', '10-K'],
        },
        {
          id: 'confidence-shift',
          category: 'Sentiment Tracking',
          text: 'Has management confidence language strengthened or weakened?',
          requiresData: ['10-K'],
        },
        {
          id: 'defensive-language',
          category: 'Sentiment Tracking',
          text: 'Is management using more defensive or hedging language?',
          requiresData: ['10-K', '10-Q'],
        },
        {
          id: 'commitment-tracking',
          category: 'Sentiment Tracking',
          text: 'Track commitment language strength across filings',
          requiresData: ['10-K', '10-Q'],
        },
      ],
    });

    // Governance Mode — provocation templates for governance concerns (Phase 3 §9.3 item 6)
    this.registerMode({
      name: 'governance',
      description: 'Governance-focused provocations from proxy statements and board disclosures',
      systemPrompt: `You are a governance-focused adversarial analyst. Your job is to surface governance red flags, compensation misalignment, board independence concerns, and shareholder rights issues from DEF 14A proxy statements and related filings. Be specific, cite proxy sections, and challenge management entrenchment.`,
      presetQuestions: [
        {
          id: 'ceo-pay-vs-performance',
          category: 'Compensation Alignment',
          text: 'Has CEO total compensation increased while operating margins compressed or TSR underperformed peers?',
          requiresData: ['DEF 14A', '10-K'],
        },
        {
          id: 'board-independence',
          category: 'Board Composition',
          text: 'What is the board independence ratio and how does it compare to peer median?',
          requiresData: ['DEF 14A'],
        },
        {
          id: 'director-tenure-entrenchment',
          category: 'Board Composition',
          text: 'Are there directors with tenure exceeding 15 years who may lack independence despite classification?',
          requiresData: ['DEF 14A'],
        },
        {
          id: 'related-party-governance',
          category: 'Governance Red Flags',
          text: 'Are there related-party transactions involving board members or executives that raise conflict-of-interest concerns?',
          requiresData: ['DEF 14A', '10-K'],
        },
        {
          id: 'shareholder-proposal-outcomes',
          category: 'Shareholder Rights',
          text: 'Were any shareholder proposals approved by majority vote but not implemented by the board?',
          requiresData: ['DEF 14A'],
        },
        {
          id: 'equity-dilution-insiders',
          category: 'Compensation Alignment',
          text: 'What percentage of equity awards went to named executives vs. total share-based compensation expense?',
          requiresData: ['DEF 14A', '10-K'],
        },
        {
          id: 'audit-committee-concerns',
          category: 'Governance Red Flags',
          text: 'Has the audit committee flagged any material weaknesses or changed auditors recently?',
          requiresData: ['DEF 14A', '10-K'],
        },
        {
          id: 'pay-ratio-trend',
          category: 'Compensation Alignment',
          text: 'How has the CEO-to-median-employee pay ratio trended over the last 3 proxy filings?',
          requiresData: ['DEF 14A'],
        },
      ],
    });

    // Insider & Institutional Activity Mode — provocation templates for Form 4 + 13F data (Phase 2 §9.2 item 8)
    this.registerMode({
      name: 'insider_activity',
      description: 'Insider transaction and institutional ownership analysis from Form 4 and 13F filings',
      systemPrompt: `You are an insider activity analyst. Your job is to surface patterns in insider buying/selling (Form 4) and institutional ownership changes (13F-HR) that may signal management confidence, information asymmetry, or smart money positioning. Be specific about transaction sizes, timing relative to earnings, and cluster patterns. Every finding must reference specific Form 4 or 13F data.`,
      presetQuestions: [
        {
          id: 'insider-selling-cluster',
          category: 'Insider Transactions',
          text: 'Have multiple insiders been selling shares in the same period? Is there a cluster pattern that suggests coordinated exits?',
          requiresData: ['4'],
        },
        {
          id: 'insider-buying-signal',
          category: 'Insider Transactions',
          text: 'Has any insider made open-market purchases recently? What was the size relative to their existing holdings?',
          requiresData: ['4'],
        },
        {
          id: 'cfo-selling-before-earnings',
          category: 'Insider Transactions',
          text: 'Did the CFO or CEO sell shares within 60 days before an earnings miss or guidance cut?',
          requiresData: ['4', '10-Q'],
        },
        {
          id: 'insider-options-exercise',
          category: 'Insider Transactions',
          text: 'Are insiders exercising options and immediately selling, or holding the shares? What does the exercise-and-sell ratio suggest?',
          requiresData: ['4'],
        },
        {
          id: 'institutional-concentration',
          category: 'Institutional Holdings',
          text: 'What is the institutional ownership concentration? Are the top 10 holders increasing or decreasing positions?',
          requiresData: ['13F-HR'],
        },
        {
          id: 'hedge-fund-exits',
          category: 'Institutional Holdings',
          text: 'Have any major hedge funds significantly reduced or exited their position in the last quarter?',
          requiresData: ['13F-HR'],
        },
        {
          id: 'smart-money-divergence',
          category: 'Cross-Signal Analysis',
          text: 'Is there a divergence between insider buying/selling and institutional positioning? What might that signal?',
          requiresData: ['4', '13F-HR'],
        },
        {
          id: 'insider-vs-guidance',
          category: 'Cross-Signal Analysis',
          text: 'How do insider transaction patterns correlate with management guidance changes in recent 10-Q/10-K filings?',
          requiresData: ['4', '10-K', '10-Q'],
        },
      ],
    });

    // Transcript Analysis Mode — deep analyst-grade earnings call dissection
    this.registerMode({
      name: 'transcript_analysis',
      description: 'Deep analyst-grade earnings call dissection: management credibility signals, tone forensics, guidance drift, deflection patterns, and cross-quarter narrative evolution',
      systemPrompt: `You are a forensic earnings call analyst with 20 years of buy-side experience. You read transcripts the way a detective reads interrogation transcripts — every word choice, every hedge, every deflection is a data point.

Your analytical framework:
1. TONE FORENSICS: Separate prepared remarks (scripted, PR-approved) from Q&A (spontaneous, revealing). The delta between these two sections is where truth lives. Score sentiment -1 to +1 for each section independently. Flag any quarter where the gap widens materially (>0.3 delta).

2. GUIDANCE ARCHAEOLOGY: Track every numerical target, range, and qualitative projection across quarters. Build a ledger: what was promised → what was delivered → what was quietly revised. Management that narrows ranges is gaining visibility. Management that widens ranges or drops specificity is losing control.

3. DEFLECTION MAPPING: Catalog every analyst question where management (a) answered a different question than was asked, (b) deferred to "we'll provide more color next quarter", (c) used filler phrases like "as we've said before" to avoid new information, (d) handed off to a subordinate to dilute accountability. The topics they avoid are the topics that matter.

4. LANGUAGE MIGRATION: Track how key phrases evolve. "Strong demand" becoming "healthy demand" becoming "resilient demand" is a three-quarter deterioration arc. "We expect" becoming "we anticipate" becoming "we believe" is a confidence downgrade. Map these migrations with exact quotes and dates.

5. CROSS-SOURCE VERIFICATION: Compare what the CEO says on the call against what the 10-K/10-Q actually discloses. Management will emphasize adjusted metrics on calls while GAAP tells a different story. Flag every material divergence.

6. ANALYST BEHAVIOR SIGNALS: When multiple analysts ask about the same topic, it signals street-wide concern. When an analyst follows up after a non-answer, they're signaling the answer was inadequate. Track these patterns.

Be ruthlessly specific. Quote exact phrases. Name the quarter. Quantify the delta. An analyst reading your output should be able to make a trading decision.`,
      presetQuestions: [
        // ─── Tone & Sentiment Forensics ───
        {
          id: 'tone-forensics-yoy',
          category: 'Tone Forensics',
          text: 'Score management sentiment (-1 to +1) separately for prepared remarks and Q&A across the last 4 earnings calls. Where is the gap between scripted optimism and spontaneous candor widening? Quote the exact phrases that reveal the shift.',
          requiresData: ['EARNINGS', '10-Q'],
        },
        {
          id: 'confidence-language-migration',
          category: 'Tone Forensics',
          text: 'Map the evolution of management confidence language across recent calls. Track specific phrase migrations: "will" → "expect to" → "anticipate" → "believe" → "hope". Which business segments show the steepest confidence downgrade?',
          requiresData: ['EARNINGS'],
        },
        {
          id: 'hedging-escalation',
          category: 'Tone Forensics',
          text: 'Quantify the increase or decrease in hedging language (may, could, might, potential, uncertain) across the last 4 calls. Is management inserting more qualifiers around specific topics? Which topics are getting hedged that weren\'t before?',
          requiresData: ['EARNINGS'],
        },
        // ─── Guidance Drift & Forecast Accuracy ───
        {
          id: 'guidance-ledger',
          category: 'Guidance Drift',
          text: 'Build a guidance ledger: for each of the last 4 quarters, list every numerical target management gave (revenue, margins, EPS, capex, FCF), then compare to actual reported results. Calculate the miss rate and directional bias (consistently over-promising or sandbagging?).',
          requiresData: ['EARNINGS', '10-Q', '10-K'],
        },
        {
          id: 'guidance-specificity-decay',
          category: 'Guidance Drift',
          text: 'Has management guidance become less specific over time? Track the precision of forward targets: exact numbers → ranges → directional language → no guidance. A company that stops giving specific guidance is either losing visibility or hiding deterioration.',
          requiresData: ['EARNINGS'],
        },
        {
          id: 'quiet-revision-detection',
          category: 'Guidance Drift',
          text: 'Identify any guidance that was quietly revised without explicit acknowledgment. Compare the guidance given in Q1 call to what was referenced in Q3 call — did the goalposts move without management flagging the change?',
          requiresData: ['EARNINGS'],
        },
        // ─── Deflection & Avoidance Patterns ───
        {
          id: 'deflection-catalog',
          category: 'Deflection Patterns',
          text: 'Catalog every analyst question in the last 2 earnings calls where management deflected, gave a non-answer, or pivoted to a different topic. Group by theme — what subjects is management systematically avoiding? These are your highest-signal areas for further diligence.',
          requiresData: ['EARNINGS'],
        },
        {
          id: 'follow-up-signal',
          category: 'Deflection Patterns',
          text: 'Identify instances where analysts followed up or rephrased after an initial non-answer. When multiple analysts probe the same topic, it signals street-wide concern. What are the consensus worry areas based on analyst questioning patterns?',
          requiresData: ['EARNINGS'],
        },
        {
          id: 'ceo-vs-cfo-divergence',
          category: 'Deflection Patterns',
          text: 'Compare how the CEO and CFO characterize the same business trends on the call. Does the CFO use more cautious language than the CEO? When the CEO hands off tough questions to the CFO, what topics trigger the handoff?',
          requiresData: ['EARNINGS'],
        },
        // ─── Strategic Narrative Evolution ───
        {
          id: 'narrative-pivot-detection',
          category: 'Strategic Narrative',
          text: 'What strategic themes has management introduced, emphasized, or quietly dropped across the last 4 calls? A new buzzword appearing (AI, efficiency, platform) or an old one disappearing (growth, expansion, investment) signals a strategic pivot. Map the narrative arc.',
          requiresData: ['EARNINGS'],
        },
        {
          id: 'capex-narrative-vs-reality',
          category: 'Strategic Narrative',
          text: 'Compare how management frames capital expenditure on calls (growth investment, strategic positioning) versus what the actual capex numbers and returns show in filings. Is the narrative justified by the math?',
          requiresData: ['EARNINGS', '10-K', '10-Q'],
        },
        {
          id: 'competitive-threat-acknowledgment',
          category: 'Strategic Narrative',
          text: 'How has management language about competition evolved? Track mentions of specific competitors, market share language, and competitive positioning claims. When management stops naming competitors or shifts from "leading" to "well-positioned", it often signals share loss.',
          requiresData: ['EARNINGS'],
        },
        // ─── Cross-Source Verification ───
        {
          id: 'call-vs-filing-divergence',
          category: 'Cross-Source Verification',
          text: 'Compare the top 3 themes management emphasized on the most recent earnings call against what the corresponding 10-Q/10-K actually discloses. Where is management cherry-picking the narrative? What material information in the filing was not discussed on the call?',
          requiresData: ['EARNINGS', '10-Q', '10-K'],
        },
        {
          id: 'adjusted-vs-gaap-emphasis',
          category: 'Cross-Source Verification',
          text: 'On the earnings call, does management primarily reference adjusted/non-GAAP metrics while the filing tells a different GAAP story? Quantify the gap between the adjusted metrics management highlights and the GAAP reality. Is the gap widening?',
          requiresData: ['EARNINGS', '10-Q', '10-K'],
        },
      ],
    });
  }
}
