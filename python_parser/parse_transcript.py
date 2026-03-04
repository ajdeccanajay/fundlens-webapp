"""
Earnings Call Transcript Parser

Confidence-scored speaker diarization and section extraction.
Phase 4 of Filing Expansion spec (§2.6).

Sections: earnings_participants, earnings_prepared_remarks, earnings_qa, earnings_full_transcript
Speaker attribution via regex patterns with confidence scores.
"""

import re
import logging
from typing import Dict, List, Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Speaker diarization patterns (§2.6) — ordered by confidence
SPEAKER_PATTERNS: List[Tuple[str, float]] = [
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[—–-]\s*(.+)', 0.95),   # Name — Title
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*\((.+)\)', 0.90),        # Name (Title)
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*:', 0.75),               # Name:
    (r'^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*(.+)', 0.70),           # Name, Title
]

# Q&A divider patterns (§2.6)
QA_DIVIDER_PATTERNS: List[Tuple[str, float]] = [
    (r'question.and.answer\s*session', 0.99),
    (r'q\s*&\s*a\s*session', 0.95),
    (r'operator\s*instructions', 0.90),
    (r'we.(?:ll|will)\s*now\s*(?:open|take)\s*(?:the\s*)?(?:line|floor|questions)', 0.95),
    (r'open\s*(?:it|the\s*line)\s*(?:up\s*)?for\s*questions', 0.90),
]

# Minimum confidence for Q&A split
QA_CONFIDENCE_THRESHOLD = 0.7
# Minimum confidence for speaker attribution
SPEAKER_CONFIDENCE_THRESHOLD = 0.7


def parse_transcript(
    content: str,
    ticker: str,
    quarter: str = '',
    year: str = '',
    call_date: Optional[str] = None,
    source: str = 'ir_page',
) -> Dict[str, Any]:
    """
    Parse an earnings call transcript into narrative chunks with speaker attribution.
    """
    logger.info(f"Parsing earnings transcript for {ticker} {quarter} {year}")

    # Clean content
    text = _clean_transcript(content)
    total_words = len(text.split())

    # Extract participant list
    participants = _extract_participants(text)

    # Find Q&A divider
    qa_split = _find_qa_divider(text)

    # Split into sections based on Q&A divider confidence
    if qa_split and qa_split['confidence'] >= QA_CONFIDENCE_THRESHOLD:
        prepared_text = text[:qa_split['position']]
        qa_text = text[qa_split['position']:]
        sections = [
            {'section_type': 'earnings_prepared_remarks', 'content': prepared_text},
            {'section_type': 'earnings_qa', 'content': qa_text},
        ]
    else:
        # Fallback: single section (§2.6 CRITICAL RULE)
        sections = [
            {'section_type': 'earnings_full_transcript', 'content': text},
        ]
        if qa_split:
            logger.warning(
                f"Q&A divider confidence {qa_split['confidence']:.2f} < {QA_CONFIDENCE_THRESHOLD}, "
                f"falling back to earnings_full_transcript"
            )

    # Chunk each section with speaker attribution
    narrative_chunks = []
    chunk_idx = 0

    # Add participants chunk if found
    if participants:
        participant_text = _format_participants(participants)
        narrative_chunks.append({
            'ticker': ticker,
            'filing_type': 'EARNINGS',
            'section_type': 'earnings_participants',
            'section_title': 'Call Participants',
            'subsection_name': None,
            'chunk_index': 0,
            'content': participant_text,
            'content_length': len(participant_text),
            'speaker': None,
            'speaker_confidence': None,
        })
        chunk_idx = 1

    for section in sections:
        speaker_chunks = _split_by_speaker(section['content'])
        for sc in speaker_chunks:
            if len(sc['content'].split()) < 15:
                continue

            # Sub-chunk if too long
            sub_chunks = _chunk_text(sc['content'], max_words=500, overlap_words=50)
            for sub_idx, sub_content in enumerate(sub_chunks):
                if len(sub_content.split()) < 15:
                    continue

                # Set subsection_name only if confidence meets threshold
                subsection_name = None
                if sc['speaker'] and sc['speaker_confidence'] >= SPEAKER_CONFIDENCE_THRESHOLD:
                    subsection_name = sc['speaker']
                    if sc.get('title'):
                        subsection_name = f"{sc['speaker']}, {sc['title']}"

                narrative_chunks.append({
                    'ticker': ticker,
                    'filing_type': 'EARNINGS',
                    'section_type': section['section_type'],
                    'section_title': _humanize_section(section['section_type']),
                    'subsection_name': subsection_name,
                    'chunk_index': chunk_idx,
                    'content': sub_content,
                    'content_length': len(sub_content),
                    'speaker': sc.get('speaker'),
                    'speaker_confidence': sc.get('speaker_confidence'),
                })
                chunk_idx += 1

    # Verification
    extracted_words = sum(len(c['content'].split()) for c in narrative_chunks)
    word_ratio = extracted_words / total_words if total_words > 0 else 0
    attributed_count = sum(1 for c in narrative_chunks if c.get('subsection_name'))
    attribution_rate = attributed_count / len(narrative_chunks) if narrative_chunks else 0

    verification = {
        'word_preservation': round(word_ratio, 4),
        'word_preservation_ok': 0.85 <= word_ratio <= 1.15,
        'attribution_rate': round(attribution_rate, 4),
        'chunk_count': len(narrative_chunks),
        'has_prepared': any(c['section_type'] == 'earnings_prepared_remarks' for c in narrative_chunks),
        'has_qa': any(c['section_type'] == 'earnings_qa' for c in narrative_chunks),
        'passed': word_ratio >= 0.85 and attribution_rate >= 0.3,
        'participants_found': len(participants),
    }

    status = 'success' if verification['passed'] else 'needs_review'

    logger.info(
        f"Transcript parse complete: {len(narrative_chunks)} chunks, "
        f"word_ratio={word_ratio:.2f}, attribution={attribution_rate:.2f}, status={status}"
    )

    return {
        'structured_metrics': [],
        'narrative_chunks': narrative_chunks,
        'holdings': [],
        'transactions': [],
        'metadata': {
            'ticker': ticker,
            'filing_type': 'EARNINGS',
            'status': status,
            'parser_type': 'transcript',
            'total_metrics': 0,
            'total_chunks': len(narrative_chunks),
            'total_holdings': 0,
            'total_transactions': 0,
            'high_confidence_metrics': 0,
            'quarter': quarter,
            'year': year,
            'call_date': call_date,
            'source': source,
            'participants': participants,
            'verification': verification,
        },
    }


def _clean_transcript(content: str) -> str:
    """Clean and normalize transcript text."""
    # Remove HTML tags if present
    text = re.sub(r'<[^>]+>', ' ', content)
    # Normalize whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    # Remove common boilerplate
    text = re.sub(r'(?i)copyright\s*©.*?\n', '', text)
    text = re.sub(r'(?i)all\s*rights\s*reserved.*?\n', '', text)
    return text.strip()


def _extract_participants(text: str) -> List[Dict[str, str]]:
    """
    Extract participant list from the beginning of the transcript.
    Looks for a participants section with Name — Title or Name, Title patterns.
    """
    participants = []

    # Look for a participants/attendees section in the first 3000 chars
    header_text = text[:3000]
    header_lower = header_text.lower()

    # Find participant section markers
    markers = [
        'call participants', 'conference call participants',
        'participants', 'attendees', 'speakers',
        'company participants', 'corporate participants',
    ]

    start_pos = -1
    for marker in markers:
        idx = header_lower.find(marker)
        if idx != -1:
            start_pos = idx
            break

    if start_pos == -1:
        return participants

    # Extract lines after the marker until we hit a section break
    section_text = header_text[start_pos:start_pos + 2000]
    lines = section_text.split('\n')

    for line in lines[1:]:  # Skip the header line
        line = line.strip()
        if not line:
            continue
        # Stop at next section header
        if any(kw in line.lower() for kw in [
            'prepared remarks', 'presentation', 'opening remarks',
            'good morning', 'good afternoon', 'good evening',
            'thank you', 'welcome to',
        ]):
            break

        # Try to parse as participant
        for pattern, confidence in SPEAKER_PATTERNS:
            match = re.match(pattern, line)
            if match:
                name = match.group(1).strip()
                title = match.group(2).strip() if match.lastindex >= 2 else ''
                role = 'executive' if any(t in title.lower() for t in [
                    'ceo', 'cfo', 'coo', 'cto', 'president', 'chief',
                    'vp', 'vice president', 'director', 'officer',
                ]) else 'analyst'
                participants.append({
                    'name': name,
                    'title': title,
                    'role': role,
                })
                break

    return participants


def _find_qa_divider(text: str) -> Optional[Dict[str, Any]]:
    """Find the Q&A section divider with confidence score."""
    text_lower = text.lower()
    best_match = None

    for pattern, confidence in QA_DIVIDER_PATTERNS:
        match = re.search(pattern, text_lower)
        if match:
            if best_match is None or confidence > best_match['confidence']:
                best_match = {
                    'position': match.start(),
                    'confidence': confidence,
                    'matched_text': match.group(0),
                }

    return best_match


def _split_by_speaker(text: str) -> List[Dict[str, Any]]:
    """
    Split text into speaker-attributed segments.
    Returns list of {speaker, title, content, speaker_confidence}.
    """
    lines = text.split('\n')
    segments: List[Dict[str, Any]] = []
    current_speaker = None
    current_title = None
    current_confidence = 0.0
    current_lines: List[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current_lines:
                current_lines.append('')
            continue

        # Check if this line is a speaker boundary
        speaker_match = _match_speaker(stripped)
        if speaker_match:
            # Save previous segment
            if current_lines:
                content = '\n'.join(current_lines).strip()
                if content:
                    segments.append({
                        'speaker': current_speaker,
                        'title': current_title,
                        'content': content,
                        'speaker_confidence': current_confidence,
                    })

            current_speaker = speaker_match['name']
            current_title = speaker_match.get('title')
            current_confidence = speaker_match['confidence']
            # Include any text after the speaker marker on the same line
            remainder = speaker_match.get('remainder', '').strip()
            current_lines = [remainder] if remainder else []
        else:
            current_lines.append(stripped)

    # Save last segment
    if current_lines:
        content = '\n'.join(current_lines).strip()
        if content:
            segments.append({
                'speaker': current_speaker,
                'title': current_title,
                'content': content,
                'speaker_confidence': current_confidence,
            })

    return segments


def _match_speaker(line: str) -> Optional[Dict[str, Any]]:
    """Try to match a speaker pattern on a line."""
    for pattern, confidence in SPEAKER_PATTERNS:
        match = re.match(pattern, line)
        if match:
            name = match.group(1).strip()
            title = match.group(2).strip() if match.lastindex >= 2 else None
            # Get remainder of line after the match
            remainder = line[match.end():].strip()
            # Clean up title — remove trailing punctuation
            if title:
                title = title.rstrip(':').strip()
            return {
                'name': name,
                'title': title,
                'confidence': confidence,
                'remainder': remainder,
            }
    return None


def _format_participants(participants: List[Dict[str, str]]) -> str:
    """Format participant list as readable text."""
    lines = ['Call Participants:\n']
    executives = [p for p in participants if p['role'] == 'executive']
    analysts = [p for p in participants if p['role'] == 'analyst']

    if executives:
        lines.append('Company Executives:')
        for p in executives:
            lines.append(f"  {p['name']} — {p['title']}")
        lines.append('')

    if analysts:
        lines.append('Analysts:')
        for p in analysts:
            title_str = f" — {p['title']}" if p['title'] else ''
            lines.append(f"  {p['name']}{title_str}")

    return '\n'.join(lines)


def _humanize_section(section_type: str) -> str:
    """Convert section_type to human-readable title."""
    titles = {
        'earnings_participants': 'Call Participants',
        'earnings_prepared_remarks': 'Prepared Remarks',
        'earnings_qa': 'Q&A Session',
        'earnings_full_transcript': 'Earnings Call Transcript',
    }
    return titles.get(section_type, section_type.replace('_', ' ').title())


def _chunk_text(text: str, max_words: int = 500, overlap_words: int = 50) -> List[str]:
    """Split text into chunks at ~max_words boundaries with overlap."""
    words = text.split()
    if len(words) <= max_words:
        return [text]

    chunks = []
    start = 0
    while start < len(words):
        end = min(start + max_words, len(words))
        chunk = ' '.join(words[start:end])
        chunks.append(chunk)
        start = end - overlap_words if end < len(words) else end

    return chunks
