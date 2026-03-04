"""
Form 4 Parser — Insider Transaction Disclosure (XML)

Spec: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION §2.3, §3.3

Form 4 is strictly XML. SEC-defined schema with:
- Reporting person (name, relationship: officer/director/10%+ owner)
- Issuer (ticker, CIK)
- Non-derivative transactions (date, code P/S/A/D/M, shares, price, shares_owned_after)
- Derivative transactions (options, warrants — exercise price, expiration, underlying shares)
"""

import logging
import re
from datetime import datetime
from typing import Optional
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)


def _text(el, tag: str, default: str = '') -> str:
    """Safely extract text from an XML sub-element."""
    child = el.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return default


def _decimal(el, tag: str) -> Optional[float]:
    """Safely extract a decimal value from an XML sub-element."""
    val = _text(el, tag)
    if not val:
        return None
    try:
        return float(val.replace(',', ''))
    except (ValueError, TypeError):
        return None


def _date(el, tag: str) -> Optional[str]:
    """Safely extract a date string (YYYY-MM-DD) from an XML sub-element."""
    val = _text(el, tag)
    if not val:
        return None
    # Validate date format
    try:
        datetime.strptime(val, '%Y-%m-%d')
        return val
    except ValueError:
        return None


def _bool(el, tag: str) -> bool:
    """Safely extract a boolean from an XML sub-element (0/1 or true/false)."""
    val = _text(el, tag).lower()
    return val in ('1', 'true', 'yes')


def _extract_xml_from_html(content: str) -> str:
    """
    Form 4 filings on EDGAR are sometimes wrapped in HTML.
    Extract the XML portion if present.
    """
    # Try to find XML declaration or ownershipDocument root
    xml_match = re.search(r'(<\?xml.*?\?>.*?</ownershipDocument>)', content, re.DOTALL)
    if xml_match:
        return xml_match.group(1)

    # Try without XML declaration
    xml_match = re.search(r'(<ownershipDocument.*?</ownershipDocument>)', content, re.DOTALL)
    if xml_match:
        return xml_match.group(1)

    # Return as-is and let ET handle it
    return content


def parse_form4(content: str, ticker: str = 'UNKNOWN', filing_date: str = None) -> dict:
    """
    Parse a Form 4 XML filing and extract insider transactions.

    Args:
        content: Raw HTML/XML content of the Form 4 filing
        ticker: Ticker symbol of the issuer
        filing_date: Filing date string (YYYY-MM-DD)

    Returns:
        Unified response dict with transactions[] and metadata
    """
    transactions = []
    metadata = {
        'ticker': ticker,
        'filing_type': '4',
        'status': 'success',
        'parser_type': 'form_4',
        'total_metrics': 0,
        'total_chunks': 0,
        'total_holdings': 0,
        'total_transactions': 0,
        'verification': {},
    }

    try:
        xml_content = _extract_xml_from_html(content)
        root = ET.fromstring(xml_content)
    except ET.ParseError as e:
        logger.error(f"Form 4 XML parse error for {ticker}: {e}")
        metadata['status'] = 'parse_error'
        metadata['message'] = f'XML parse error: {e}'
        return _build_response(transactions, metadata)

    # Extract issuer info
    issuer = root.find('.//issuer')
    issuer_ticker = _text(issuer, 'issuerTradingSymbol') if issuer is not None else ticker
    if issuer_ticker:
        ticker = issuer_ticker.upper()
        metadata['ticker'] = ticker

    # Extract reporting owner info
    reporting_owner = root.find('.//reportingOwner')
    insider_name = ''
    insider_title = ''
    relationship = ''

    if reporting_owner is not None:
        owner_id = reporting_owner.find('reportingOwnerId')
        if owner_id is not None:
            insider_name = _text(owner_id, 'rptOwnerName')

        rel = reporting_owner.find('reportingOwnerRelationship')
        if rel is not None:
            is_director = _bool(rel, 'isDirector')
            is_officer = _bool(rel, 'isOfficer')
            is_ten_pct = _bool(rel, 'isTenPercentOwner')
            is_other = _bool(rel, 'isOther')
            insider_title = _text(rel, 'officerTitle')

            parts = []
            if is_officer:
                parts.append('Officer')
            if is_director:
                parts.append('Director')
            if is_ten_pct:
                parts.append('10% Owner')
            if is_other:
                parts.append('Other')
            relationship = ', '.join(parts) if parts else 'Unknown'

    # Parse non-derivative transactions
    for txn in root.findall('.//nonDerivativeTransaction'):
        t = _parse_non_derivative_transaction(txn, ticker, insider_name, insider_title, relationship, filing_date)
        if t:
            transactions.append(t)

    # Parse derivative transactions
    for txn in root.findall('.//derivativeTransaction'):
        t = _parse_derivative_transaction(txn, ticker, insider_name, insider_title, relationship, filing_date)
        if t:
            transactions.append(t)

    metadata['total_transactions'] = len(transactions)

    # Verification (§3.3)
    verification = verify_form4(transactions, root)
    metadata['verification'] = verification

    if not verification['passed']:
        logger.warning(
            f"Form 4 verification FAILED for {ticker}: "
            f"expected {verification['expected_non_derivative']} non-deriv + "
            f"{verification['expected_derivative']} deriv, "
            f"got {verification['actual_non_derivative']} + {verification['actual_derivative']}"
        )

    return _build_response(transactions, metadata)


def _parse_non_derivative_transaction(txn, ticker, insider_name, insider_title, relationship, filing_date):
    """Parse a single non-derivative transaction element."""
    security = txn.find('securityTitle')
    security_title = _text(security, 'value') if security is not None else None

    txn_date_el = txn.find('.//transactionDate')
    txn_date = _text(txn_date_el, 'value') if txn_date_el is not None else None

    coding = txn.find('.//transactionCoding')
    txn_code = _text(coding, 'transactionCode') if coding is not None else ''
    equity_swap = _bool(coding, 'equitySwapInvolved') if coding is not None else False

    amounts = txn.find('.//transactionAmounts')
    shares = _decimal(amounts, './/transactionShares/value') if amounts is not None else None
    price = _decimal(amounts, './/transactionPricePerShare/value') if amounts is not None else None

    post_txn = txn.find('.//postTransactionAmounts')
    shares_after = _decimal(post_txn, './/sharesOwnedFollowingTransaction/value') if post_txn is not None else None

    if not txn_date and not shares:
        return None

    return {
        'ticker': ticker,
        'insider_name': insider_name,
        'insider_title': insider_title or None,
        'relationship': relationship,
        'transaction_date': txn_date,
        'transaction_code': txn_code,
        'equity_swap': equity_swap,
        'shares_transacted': shares,
        'price_per_share': price,
        'shares_owned_after': shares_after,
        'is_derivative': False,
        'derivative_title': None,
        'exercise_price': None,
        'expiration_date': None,
        'underlying_shares': None,
        'filing_date': filing_date,
        'security_title': security_title,
    }


def _parse_derivative_transaction(txn, ticker, insider_name, insider_title, relationship, filing_date):
    """Parse a single derivative transaction element."""
    security = txn.find('securityTitle')
    derivative_title = _text(security, 'value') if security is not None else None

    txn_date_el = txn.find('.//transactionDate')
    txn_date = _text(txn_date_el, 'value') if txn_date_el is not None else None

    coding = txn.find('.//transactionCoding')
    txn_code = _text(coding, 'transactionCode') if coding is not None else ''
    equity_swap = _bool(coding, 'equitySwapInvolved') if coding is not None else False

    amounts = txn.find('.//transactionAmounts')
    shares = _decimal(amounts, './/transactionShares/value') if amounts is not None else None
    price = _decimal(amounts, './/transactionPricePerShare/value') if amounts is not None else None

    # Derivative-specific fields
    exercise_price_el = txn.find('.//conversionOrExercisePrice')
    exercise_price = _decimal(exercise_price_el, 'value') if exercise_price_el is not None else None

    expiration_el = txn.find('.//expirationDate')
    expiration_date = _text(expiration_el, 'value') if expiration_el is not None else None

    underlying = txn.find('.//underlyingSecurity')
    underlying_shares = _decimal(underlying, './/underlyingSecurityShares/value') if underlying is not None else None

    post_txn = txn.find('.//postTransactionAmounts')
    shares_after = _decimal(post_txn, './/sharesOwnedFollowingTransaction/value') if post_txn is not None else None

    if not txn_date and not shares:
        return None

    return {
        'ticker': ticker,
        'insider_name': insider_name,
        'insider_title': insider_title or None,
        'relationship': relationship,
        'transaction_date': txn_date,
        'transaction_code': txn_code,
        'equity_swap': equity_swap,
        'shares_transacted': shares,
        'price_per_share': price,
        'shares_owned_after': shares_after,
        'is_derivative': True,
        'derivative_title': derivative_title,
        'exercise_price': exercise_price,
        'expiration_date': expiration_date,
        'underlying_shares': underlying_shares,
        'filing_date': filing_date,
        'security_title': derivative_title,
    }


def verify_form4(extracted_transactions: list, root: ET.Element) -> dict:
    """
    Verify Form 4 extraction by counting XML elements (§3.3).
    Count entries in <nonDerivativeTransaction> and <derivativeTransaction>.
    """
    expected_non_deriv = len(root.findall('.//nonDerivativeTransaction'))
    expected_deriv = len(root.findall('.//derivativeTransaction'))

    actual_non_deriv = sum(1 for t in extracted_transactions if not t.get('is_derivative'))
    actual_deriv = sum(1 for t in extracted_transactions if t.get('is_derivative'))

    passed = (actual_non_deriv == expected_non_deriv and actual_deriv == expected_deriv)

    return {
        'passed': passed,
        'expected_non_derivative': expected_non_deriv,
        'actual_non_derivative': actual_non_deriv,
        'expected_derivative': expected_deriv,
        'actual_derivative': actual_deriv,
    }


def _build_response(transactions: list, metadata: dict) -> dict:
    """Build the unified response schema."""
    return {
        'structured_metrics': [],
        'narrative_chunks': [],
        'holdings': [],
        'transactions': transactions,
        'metadata': metadata,
    }
