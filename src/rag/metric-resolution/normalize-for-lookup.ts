/**
 * Aggressively normalizes a metric string for lookup in the inverted synonym index.
 * Converts to lowercase and strips all non-alphanumeric characters.
 *
 * Examples:
 *   "Cash & Cash Equivalents" → "cashandcashequivalents"
 *   "SG&A"                    → "sga"
 *   "Net Debt / EBITDA"       → "netdebtebitda"
 *
 * @param text - The raw metric string to normalize
 * @returns The normalized string containing only lowercase a-z and digits 0-9
 */
export function normalizeForLookup(text: string): string {
  if (text == null) {
    return '';
  }
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}
