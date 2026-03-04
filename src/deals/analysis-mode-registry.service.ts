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
  }
}
