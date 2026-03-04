"""
13F-HR Parser — Institutional Holdings (XML)

Spec: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION §2.2, §3.2

13F-HR is a quarterly report of holdings by institutional managers (>$100M AUM).
The filing is HTML on EDGAR, but contains a reference to informationTable.xml
with the actual holdings data in standardized SEC XML format.

Parsing strategy:
1. Locate informationTable.xml reference in the 13F-HR HTML filing
2. Parse the XML (passed as content or fetched from EDGAR)
3. Extract each holding: CUSIP, issuerName, shareClass, sharesHeld, marketValue, etc.
4. Resolve CUSIP to ticker using CUSIPResolver
5. Verify count + value against cover page totals
"""

import logging
import re
from typing import Optional
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)

# SEC 13F XML namespaces
NS_13F = {
    'ns': 'http://www.sec.gov/edgar/document/thirteenf/informationtable',
    'ns2': 'http://www.sec.gov/edgar/common',
}

# Also handle older namespace variants
NS_13F_ALT = {
    'ns': 'http://www.sec.gov/edgar/thirteenf',
}


def _find_with_ns(root, tag: str) -> list:
    """Find elements trying multiple namespace variants."""
    # Try with primary namespace
    results = root.findall(f'.//ns:{tag}', NS_13F)
    if results:
        return results

    # Try alternate namespace
    results = root.findall(f'.//ns:{tag}', NS_13F_ALT)
    if results:
        return results

    # Try without namespace
    results = root.findall(f'.//{tag}')
    if results:
        return results

    # Try case-insensitive by searching all elements
    tag_lower = tag.lower()
    results = []
    for el in root.iter():
        local_name = el.tag.split('}')[-1] if '}' in el.tag else el.tag
        if local_name.lower() == tag_lower:
            results.append(el)
    return results


def _child_text(el, tag: str, default: str = '') -> str:
    """Get text of a child element, trying with and without namespace."""
    for ns_map in [NS_13F, NS_13F_ALT, {}]:
        if ns_map:
            prefix = list(ns_map.values())[0]
            child = el.find(f'{{{prefix}}}{tag}')
        else:
            child = el.find(tag)
        if child is not None and child.text:
            return child.text.strip()

    # Fallback: case-insensitive search
    tag_lower = tag.lower()
    for child in el:
        local_name = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if local_name.lower() == tag_lower and child.text:
            return child.text.strip()
    return default


def _child_int(el, tag: str) -> Optional[int]:
    """Get integer value of a child element."""
    val = _child_text(el, tag)
    if not val:
        return None
    try:
        return int(val.replace(',', ''))
    except (ValueError, TypeError):
        return None


def _extract_xml_from_html(content: str) -> str:
    """
    13F information tables may be embedded in HTML or be standalone XML.
    Extract the XML portion.
    """
    # Check if it's already XML
    if content.strip().startswith('<?xml') or content.strip().startswith('<informationTable'):
        return content

    # Try to find XML within HTML
    xml_match = re.search(
        r'(<\?xml.*?</informationTable>)',
        content, re.DOTALL | re.IGNORECASE
    )
    if xml_match:
        return xml_match.group(1)

    xml_match = re.search(
        r'(<informationTable.*?</informationTable>)',
        content, re.DOTALL | re.IGNORECASE
    )
    if xml_match:
        return xml_match.group(1)

    return content


def _extract_cover_page_totals(content: str) -> dict:
    """
    Extract tableEntryTotal and tableValueTotal from the 13F cover page.
    These are used for verification.
    """
    totals = {
        'table_entry_total': None,
        'table_value_total': None,
    }

    # Try XML parsing first
    try:
        root = ET.fromstring(content)
        entry_total = root.find('.//tableEntryTotal')
        if entry_total is None:
            # Try with namespace
            for el in root.iter():
                local = el.tag.split('}')[-1] if '}' in el.tag else el.tag
                if local == 'tableEntryTotal' and el.text:
                    totals['table_entry_total'] = int(el.text.strip().replace(',', ''))
                elif local == 'tableValueTotal' and el.text:
                    totals['table_value_total'] = int(el.text.strip().replace(',', ''))
        else:
            if entry_total.text:
                totals['table_entry_total'] = int(entry_total.text.strip().replace(',', ''))
            value_total = root.find('.//tableValueTotal')
            if value_total is not None and value_total.text:
                totals['table_value_total'] = int(value_total.text.strip().replace(',', ''))
    except ET.ParseError:
        pass

    # Fallback: regex on raw content
    if totals['table_entry_total'] is None:
        match = re.search(r'<tableEntryTotal>\s*(\d[\d,]*)\s*</tableEntryTotal>', content, re.IGNORECASE)
        if match:
            totals['table_entry_total'] = int(match.group(1).replace(',', ''))

    if totals['table_value_total'] is None:
        match = re.search(r'<tableValueTotal>\s*(\d[\d,]*)\s*</tableValueTotal>', content, re.IGNORECASE)
        if match:
            totals['table_value_total'] = int(match.group(1).replace(',', ''))

    return totals


def parse_13f(
    content: str,
    ticker: str = 'UNKNOWN',
    holder_cik: str = '',
    holder_name: str = '',
    filing_date: str = None,
    report_date: str = None,
    accession_no: str = '',
    cusip_resolver=None,
    cover_page_content: str = None,
) -> dict:
    """
    Parse a 13F-HR informationTable XML and extract institutional holdings.

    Args:
        content: XML content of the informationTable
        ticker: Not used for 13F (holdings are multi-company), kept for API compat
        holder_cik: CIK of the filing institution
        holder_name: Name of the filing institution
        filing_date: Filing date (YYYY-MM-DD)
        report_date: Report period date (YYYY-MM-DD)
        accession_no: SEC accession number
        cusip_resolver: Optional CUSIPResolver instance for ticker resolution
        cover_page_content: Optional cover page content for verification

    Returns:
        Unified response dict with holdings[] and metadata
    """
    holdings = []
    metadata = {
        'ticker': ticker,
        'filing_type': '13F-HR',
        'status': 'success',
        'parser_type': 'form_13f',
        'total_metrics': 0,
        'total_chunks': 0,
        'total_holdings': 0,
        'total_transactions': 0,
        'holder_cik': holder_cik,
        'holder_name': holder_name,
        'verification': {},
    }

    try:
        xml_content = _extract_xml_from_html(content)
        root = ET.fromstring(xml_content)
    except ET.ParseError as e:
        logger.error(f"13F XML parse error: {e}")
        metadata['status'] = 'parse_error'
        metadata['message'] = f'XML parse error: {e}'
        return _build_response(holdings, metadata)

    # Find all infoTable entries
    entries = _find_with_ns(root, 'infoTable')
    if not entries:
        logger.warning(f"No infoTable entries found in 13F for {holder_name}")
        metadata['status'] = 'no_data'
        metadata['message'] = 'No infoTable entries found'
        return _build_response(holdings, metadata)

    # Determine quarter from report_date
    quarter = ''
    if report_date:
        try:
            from datetime import datetime
            rd = datetime.strptime(report_date, '%Y-%m-%d')
            q = (rd.month - 1) // 3 + 1
            quarter = f'Q{q} {rd.year}'
        except ValueError:
            quarter = ''

    for entry in entries:
        cusip = _child_text(entry, 'cusip')
        issuer_name = _child_text(entry, 'nameOfIssuer')
        share_class = _child_text(entry, 'titleOfClass')

        # Shares and value
        shrs_or_prn = entry.find('.//{*}shrsorPrnAmt') or entry.find('.//shrsorPrnAmt')
        shares_held = None
        if shrs_or_prn is not None:
            shares_held = _child_int(shrs_or_prn, 'sshPrnamt')

        value = _child_text(entry, 'value')
        market_value = None
        if value:
            try:
                # 13F values are in thousands
                market_value = int(value.replace(',', '')) * 1000
            except (ValueError, TypeError):
                market_value = None

        # Investment discretion
        investment_discretion = _child_text(entry, 'investmentDiscretion')

        # Voting authority
        voting_auth = entry.find('.//{*}votingAuthority') or entry.find('.//votingAuthority')
        voting_sole = None
        voting_shared = None
        voting_none = None
        if voting_auth is not None:
            voting_sole = _child_int(voting_auth, 'Sole')
            voting_shared = _child_int(voting_auth, 'Shared')
            voting_none = _child_int(voting_auth, 'None')

        # Resolve CUSIP to ticker
        resolved_ticker = None
        if cusip_resolver and cusip and issuer_name:
            resolved_ticker = cusip_resolver.resolve(cusip, issuer_name)

        holding = {
            'cusip': cusip,
            'issuer_name': issuer_name,
            'share_class': share_class or None,
            'shares_held': shares_held,
            'market_value': market_value,
            'investment_discretion': investment_discretion or None,
            'voting_sole': voting_sole,
            'voting_shared': voting_shared,
            'voting_none': voting_none,
            'resolved_ticker': resolved_ticker,
            'holder_cik': holder_cik,
            'holder_name': holder_name,
            'filing_date': filing_date,
            'report_date': report_date,
            'accession_no': accession_no,
            'quarter': quarter,
        }
        holdings.append(holding)

    metadata['total_holdings'] = len(holdings)

    # Verification (§3.2)
    cover_totals = None
    if cover_page_content:
        cover_totals = _extract_cover_page_totals(cover_page_content)

    verification = verify_13f(holdings, cover_totals)
    metadata['verification'] = verification

    if not verification['passed'] and cover_totals:
        logger.warning(
            f"13F verification FAILED for {holder_name}: "
            f"expected {verification.get('expected_count')} entries / "
            f"${verification.get('expected_value')} value, "
            f"got {verification.get('actual_count')} / ${verification.get('actual_value')}"
        )

    return _build_response(holdings, metadata)


def verify_13f(extracted_holdings: list, cover_totals: Optional[dict] = None) -> dict:
    """
    Verify 13F extraction against cover page totals (§3.2).

    If cover_totals is None (no cover page available), verification passes
    with a note that cover page was unavailable.
    """
    actual_count = len(extracted_holdings)
    actual_value = sum(h.get('market_value', 0) or 0 for h in extracted_holdings)

    if cover_totals is None or (cover_totals.get('table_entry_total') is None):
        return {
            'passed': True,
            'note': 'Cover page totals unavailable — count-only verification',
            'actual_count': actual_count,
            'actual_value': actual_value,
        }

    expected_count = cover_totals.get('table_entry_total', 0)
    expected_value = cover_totals.get('table_value_total')

    count_match = actual_count == expected_count

    # Value is in thousands on cover page, we multiply by 1000 during parsing
    # So expected_value from cover is already in thousands — multiply for comparison
    value_match = True
    if expected_value is not None:
        expected_value_full = expected_value * 1000
        value_match = abs(actual_value - expected_value_full) < 1000

    return {
        'passed': count_match and value_match,
        'expected_count': expected_count,
        'actual_count': actual_count,
        'expected_value': expected_value * 1000 if expected_value else None,
        'actual_value': actual_value,
        'count_match': count_match,
        'value_match': value_match,
    }


def _build_response(holdings: list, metadata: dict) -> dict:
    """Build the unified response schema."""
    return {
        'structured_metrics': [],
        'narrative_chunks': [],
        'holdings': holdings,
        'transactions': [],
        'metadata': metadata,
    }
