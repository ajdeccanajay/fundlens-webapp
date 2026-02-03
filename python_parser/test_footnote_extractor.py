"""
Tests for FootnoteExtractor
"""

import pytest
from footnote_extractor import FootnoteExtractor, extract_footnotes_from_filing


def test_extract_footnotes_basic():
    """Test basic footnote extraction"""
    html = """
    <div>
        <h2>NOTES TO FINANCIAL STATEMENTS</h2>
        <p>Note 1: Revenue Recognition</p>
        <p>The Company recognizes revenue when control transfers to the customer.</p>
        <p>Note 2: Inventory</p>
        <p>Inventory is valued at lower of cost or market.</p>
    </div>
    """
    
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html)
    
    assert len(footnotes) >= 2
    assert any(fn.footnote_number == '1' for fn in footnotes)
    assert any(fn.footnote_number == '2' for fn in footnotes)


def test_extract_footnotes_with_tables():
    """Test footnote extraction with tables"""
    html = """
    <div>
        <h2>NOTES TO FINANCIAL STATEMENTS</h2>
        <p>Note 1: Revenue by Segment</p>
        <table>
            <tr><th>Segment</th><th>Revenue</th></tr>
            <tr><td>Americas</td><td>$100M</td></tr>
            <tr><td>Europe</td><td>$50M</td></tr>
        </table>
    </div>
    """
    
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html)
    
    assert len(footnotes) >= 1
    assert len(footnotes[0].tables) > 0
    assert footnotes[0].tables[0]['headers'] == ['Segment', 'Revenue']


def test_extract_footnotes_with_lists():
    """Test footnote extraction with lists"""
    html = """
    <div>
        <h2>NOTES TO FINANCIAL STATEMENTS</h2>
        <p>Note 1: Accounting Policies</p>
        <p>The Company follows these policies:</p>
        <p>• Revenue recognition</p>
        <p>• Inventory valuation</p>
        <p>• Depreciation methods</p>
    </div>
    """
    
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html)
    
    assert len(footnotes) >= 1
    # Lists are extracted from text, not HTML structure
    assert len(footnotes[0].content) > 0


def test_extract_footnotes_no_section():
    """Test when no footnote section found"""
    html = "<div><p>Some random content</p></div>"
    
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html)
    
    assert len(footnotes) == 0


def test_extract_footnotes_numbered_format():
    """Test numbered footnote format"""
    html = """
    <div>
        <h2>NOTES TO CONSOLIDATED FINANCIAL STATEMENTS</h2>
        <p>1. Summary of Significant Accounting Policies</p>
        <p>The Company prepares its financial statements...</p>
        <p>2. Revenue Recognition</p>
        <p>Revenue is recognized when...</p>
    </div>
    """
    
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html)
    
    assert len(footnotes) >= 2


def test_extract_footnotes_parentheses_format():
    """Test parentheses footnote format"""
    html = """
    <div>
        <h2>FINANCIAL STATEMENT NOTES</h2>
        <p>(1) Basis of Presentation</p>
        <p>These financial statements are prepared...</p>
        <p>(2) Cash and Cash Equivalents</p>
        <p>Cash includes currency and demand deposits...</p>
    </div>
    """
    
    extractor = FootnoteExtractor()
    footnotes = extractor.extract_footnotes(html)
    
    assert len(footnotes) >= 2


def test_to_dict():
    """Test conversion to dictionary"""
    html = """
    <div>
        <h2>NOTES TO FINANCIAL STATEMENTS</h2>
        <p>Note 1: Revenue</p>
        <p>Revenue is $100M.</p>
    </div>
    """
    
    extractor = FootnoteExtractor()
    extractor.extract_footnotes(html)
    result = extractor.to_dict()
    
    assert isinstance(result, list)
    assert len(result) >= 1
    assert 'footnote_number' in result[0]
    assert 'section_title' in result[0]


def test_convenience_function():
    """Test convenience function"""
    html = """
    <div>
        <h2>NOTES TO FINANCIAL STATEMENTS</h2>
        <p>Note 1: Test</p>
        <p>Test content.</p>
    </div>
    """
    
    result = extract_footnotes_from_filing(html)
    
    assert isinstance(result, list)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
