/**
 * Consolidated Section & Filing Type Labels
 *
 * Single source of truth for humanizing section_type and filing_type values
 * across the entire codebase. Replaces:
 *   - section-exporter.service.ts → getSectionTitle()
 *   - rag.service.ts → formatSectionName()
 *
 * Spec: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION §8.1
 */

export const SECTION_LABELS: Record<string, string> = {
  // 10-K
  'item_1': 'Business',
  'item_1a': 'Risk Factors',
  'item_1b': 'Unresolved Staff Comments',
  'item_1c': 'Cybersecurity',
  'item_2': 'Properties',
  'item_3': 'Legal Proceedings',
  'item_4': 'Mine Safety Disclosures',
  'item_5': 'Market for Common Equity',
  'item_6': 'Reserved',
  'item_7': 'MD&A',
  'item_7a': 'Market Risk Disclosures',
  'item_8': 'Financial Statements',
  'item_9': 'Accountant Changes',
  'item_9a': 'Controls & Procedures',
  'item_9b': 'Other Information',
  'item_9c': 'Foreign Jurisdictions',
  'item_10': 'Directors & Officers',
  'item_11': 'Executive Compensation',
  'item_12': 'Security Ownership',
  'item_13': 'Related Party Transactions',
  'item_14': 'Accountant Fees',
  'item_15': 'Exhibits',
  'item_16': 'Form 10-K Summary',
  // 10-Q Part II
  'item_1_p2': 'Legal Proceedings (Part II)',
  'item_1a_p2': 'Risk Factors (Part II)',
  'item_2_p2': 'Unregistered Sales',
  'item_5_p2': 'Other Information (Part II)',
  'item_6_p2': 'Exhibits (Part II)',
  // 8-K
  'item_1_01': 'Material Definitive Agreement',
  'item_2_02': 'Results of Operations',
  'item_5_02': 'Director/Officer Changes',
  'item_5_07': 'Shareholder Vote',
  'item_7_01': 'Regulation FD Disclosure',
  'item_8_01': 'Other Events',
  'item_9_01': 'Financial Statements & Exhibits',
  // DEF 14A (Proxy)
  'executive_compensation': 'Executive Compensation',
  'director_compensation': 'Director Compensation',
  'board_composition': 'Board of Directors',
  'shareholder_proposals': 'Shareholder Proposals',
  'corporate_governance': 'Corporate Governance',
  'related_party_transactions': 'Related Party Transactions',
  'ceo_pay_ratio': 'CEO Pay Ratio',
  'pay_vs_performance': 'Pay vs. Performance',
  'audit_committee': 'Audit Committee',
  'stock_ownership': 'Stock Ownership',
  // S-1
  'prospectus_summary': 'Prospectus Summary',
  'use_of_proceeds': 'Use of Proceeds',
  'dilution': 'Dilution',
  'capitalization': 'Capitalization',
  'dividend_policy': 'Dividend Policy',
  'principal_stockholders': 'Principal Stockholders',
  'description_capital_stock': 'Capital Stock',
  'underwriting': 'Underwriting',
  // Earnings Transcripts
  'earnings_participants': 'Call Participants',
  'earnings_prepared_remarks': 'Prepared Remarks',
  'earnings_qa': 'Q&A Session',
  'earnings_full_transcript': 'Earnings Call Transcript',
  // Common / shared
  'risk_factors': 'Risk Factors',
  'business': 'Business Overview',
  'mda': 'Management Discussion & Analysis',
  'management': 'Management',
  'financial_statements': 'Financial Statements',
  'properties': 'Properties',
  'legal_proceedings': 'Legal Proceedings',
  'directors_officers': 'Directors & Officers',
  'controls_procedures': 'Controls & Procedures',
  'general': 'General Information',
  'preamble': 'Filing Preamble',
  'uploaded_document': 'Uploaded Documents',
};

export const FILING_TYPE_LABELS: Record<string, string> = {
  '10-K': 'Annual Report (10-K)',
  '10-Q': 'Quarterly Report (10-Q)',
  '8-K': 'Current Report (8-K)',
  '13F-HR': 'Institutional Holdings (13F)',
  'DEF 14A': 'Proxy Statement',
  'DEFA14A': 'Proxy Statement',
  '4': 'Insider Transaction (Form 4)',
  'S-1': 'Registration Statement (S-1)',
  'EARNINGS': 'Earnings Call Transcript',
  '10-K/A': 'Annual Report Amendment',
  '10-Q/A': 'Quarterly Report Amendment',
  '13F-HR/A': 'Holdings Amendment',
  '4/A': 'Form 4 Amendment',
  'S-1/A': 'Registration Amendment',
};

/**
 * Humanize a section_type value for display.
 * Falls back to title-casing the raw value if not in the map.
 */
export function humanizeSectionType(s: string): string {
  return SECTION_LABELS[s] || s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Humanize a filing_type value for display.
 * Falls back to the raw value if not in the map.
 */
export function humanizeFilingType(f: string): string {
  return FILING_TYPE_LABELS[f] || f;
}
