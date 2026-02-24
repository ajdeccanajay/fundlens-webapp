/**
 * Deterministic Verification Service — Spec §3.5
 *
 * Every number extracted by Vision LLM is verified against raw text.
 * If the number (or a scaled variant) exists in the raw text → confidence 1.0.
 * If not found → confidence 0.7, flagged as potential hallucination.
 *
 * Cost: $0 (pure string matching). Speed: < 100ms total.
 */
import { Injectable, Logger } from '@nestjs/common';

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  foundAt?: number;
  matchedRepresentation?: string;
  flag?: string;
}

export interface ExtractedNumber {
  value: number;
  rawDisplay: string;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  /**
   * Verify a single extracted number against raw text.
   */
  verifyExtractedNumber(
    extracted: ExtractedNumber,
    rawText: string,
    tableUnits?: string,
  ): VerificationResult {
    const candidates = this.generateNumberCandidates(extracted.value, tableUnits);

    for (const candidate of candidates) {
      const index = rawText.indexOf(candidate);
      if (index !== -1) {
        return {
          verified: true,
          confidence: 1.0,
          foundAt: index,
          matchedRepresentation: candidate,
        };
      }
    }

    // Also try the rawDisplay string directly
    if (extracted.rawDisplay) {
      const cleaned = extracted.rawDisplay.replace(/[$,]/g, '').trim();
      const idx = rawText.indexOf(cleaned);
      if (idx !== -1) {
        return { verified: true, confidence: 1.0, foundAt: idx, matchedRepresentation: cleaned };
      }
      // Try the raw display as-is
      const rawIdx = rawText.indexOf(extracted.rawDisplay);
      if (rawIdx !== -1) {
        return { verified: true, confidence: 1.0, foundAt: rawIdx, matchedRepresentation: extracted.rawDisplay };
      }
    }

    return {
      verified: false,
      confidence: 0.7,
      flag: 'NUMBER_NOT_IN_RAW_TEXT',
    };
  }

  /**
   * Verify all extractions from a vision result against raw text.
   * Returns the same structure with confidence scores added.
   */
  verifyVisionExtractions(
    visionResult: any,
    rawText: string,
  ): { metrics: any[]; tables: any[]; narratives: any[]; footnotes: any[]; entities: any } {
    const verified = {
      metrics: [] as any[],
      tables: [] as any[],
      narratives: visionResult.narratives || [],
      footnotes: visionResult.footnotes || [],
      entities: visionResult.entities || {},
    };

    // Verify metrics
    for (const metric of visionResult.metrics || []) {
      if (metric.numericValue != null) {
        const result = this.verifyExtractedNumber(
          { value: metric.numericValue, rawDisplay: metric.rawValue || metric.raw_value || '' },
          rawText,
          metric.units,
        );
        verified.metrics.push({
          ...metric,
          confidence: result.confidence,
          verified: result.verified,
          verificationMatch: result.matchedRepresentation,
        });
      } else {
        // Non-numeric metrics (e.g., "Overweight" rating) — check raw text for the string
        const rawVal = metric.rawValue || metric.raw_value || '';
        const found = rawVal && rawText.includes(rawVal);
        verified.metrics.push({
          ...metric,
          confidence: found ? 1.0 : 0.7,
          verified: found,
        });
      }
    }

    // Verify table cells
    for (const table of visionResult.tables || []) {
      const verifiedRows = (table.rows || []).map((row: any) => ({
        ...row,
        cells: (row.cells || []).map((cell: any) => {
          if (cell.numericValue != null) {
            const result = this.verifyExtractedNumber(
              { value: cell.numericValue, rawDisplay: cell.value || '' },
              rawText,
              table.units,
            );
            return { ...cell, confidence: result.confidence, verified: result.verified };
          }
          return { ...cell, confidence: 1.0, verified: true };
        }),
      }));
      verified.tables.push({ ...table, rows: verifiedRows });
    }

    return verified;
  }

  /**
   * Generate all plausible text representations of a number.
   * Spec §3.5 — handles millions/billions/thousands scaling + formatting variants.
   */
  generateNumberCandidates(value: number, units?: string): string[] {
    const candidates: string[] = [];
    const abs = Math.abs(value);

    // Raw number formats
    const rawFormats = [
      abs.toFixed(0),
      abs.toLocaleString('en-US'),
      abs.toFixed(1),
      abs.toFixed(2),
    ];

    // Scaled representations
    if (units === 'millions' || abs >= 1_000_000) {
      const inM = abs / 1_000_000;
      rawFormats.push(inM.toFixed(0), inM.toFixed(1), inM.toFixed(2), inM.toLocaleString('en-US'));
    }
    if (units === 'billions' || abs >= 1_000_000_000) {
      const inB = abs / 1_000_000_000;
      rawFormats.push(inB.toFixed(0), inB.toFixed(1), inB.toFixed(2), inB.toLocaleString('en-US'));
    }
    if (units === 'thousands' || abs >= 1_000) {
      const inK = abs / 1_000;
      rawFormats.push(inK.toFixed(0), inK.toFixed(1), inK.toFixed(2), inK.toLocaleString('en-US'));
    }

    // Deduplicate base formats
    const uniqueFormats = [...new Set(rawFormats)];

    // With currency, negative indicators, and suffixes
    for (const fmt of uniqueFormats) {
      candidates.push(fmt);
      candidates.push(`(${fmt})`);       // Negative in parens
      candidates.push(`-${fmt}`);
      candidates.push(`${fmt}%`);
      candidates.push(`${fmt}x`);        // Multiples: 12.3x
      candidates.push(`$${fmt}`);
      candidates.push(`$(${fmt})`);
    }

    return candidates;
  }
}
