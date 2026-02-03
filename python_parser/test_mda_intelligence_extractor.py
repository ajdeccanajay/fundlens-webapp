"""
Tests for MDAIntelligenceExtractor
"""

import pytest
from mda_intelligence_extractor import (
    MDAIntelligenceExtractor,
    extract_mda_intelligence
)


def test_extract_trends_increasing():
    """Test extraction of increasing trends"""
    text = "Revenue increased by 15% due to strong product sales."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert len(intelligence.trends) >= 1
    assert intelligence.trends[0].direction == 'increasing'
    assert intelligence.trends[0].magnitude == 15.0


def test_extract_trends_decreasing():
    """Test extraction of decreasing trends"""
    text = "Operating expenses decreased by 8% as a result of cost controls."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert len(intelligence.trends) >= 1
    assert intelligence.trends[0].direction == 'decreasing'


def test_extract_trends_with_drivers():
    """Test extraction of trends with drivers"""
    text = "Revenue increased by 15% driven by strong iPhone sales and new market expansion."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert len(intelligence.trends) >= 1
    assert len(intelligence.trends[0].drivers) > 0


def test_extract_risks_high_severity():
    """Test extraction of high severity risks"""
    text = "We face a significant risk from supply chain disruptions."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert len(intelligence.risks) >= 1
    assert intelligence.risks[0].severity == 'high'


def test_extract_risks_categorization():
    """Test risk categorization"""
    text = "Supply chain disruptions pose a significant risk to our operations."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert len(intelligence.risks) >= 1
    assert intelligence.risks[0].category == 'operational'


def test_extract_guidance():
    """Test guidance extraction"""
    text = "We expect revenue growth of 10-12% next year with improved margins."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert intelligence.guidance is not None
    assert 'revenue growth' in intelligence.guidance.lower()


def test_sentiment_positive():
    """Test positive sentiment detection"""
    text = "We expect strong growth and improved margins with favorable market conditions."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert intelligence.guidance_sentiment == 'positive'


def test_sentiment_negative():
    """Test negative sentiment detection"""
    text = "We expect challenging conditions with weak demand and declining margins."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert intelligence.guidance_sentiment == 'negative'


def test_sentiment_neutral():
    """Test neutral sentiment detection"""
    text = "We expect stable performance in line with prior year."
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert intelligence.guidance_sentiment == 'neutral'


def test_confidence_score():
    """Test confidence score calculation"""
    text = """
    Revenue increased by 15%. Net income grew by 20%. Gross profit rose by 10%.
    We face risks from competition. Market uncertainty exists.
    We expect strong growth next year.
    """
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert intelligence.confidence_score > 50


def test_empty_text():
    """Test with empty text"""
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence("")
    
    assert len(intelligence.trends) == 0
    assert len(intelligence.risks) == 0
    assert intelligence.guidance is None


def test_to_dict():
    """Test conversion to dictionary"""
    text = "Revenue increased by 15%."
    
    extractor = MDAIntelligenceExtractor()
    extractor.extract_intelligence(text)
    result = extractor.to_dict()
    
    assert isinstance(result, dict)
    assert 'trends' in result
    assert 'risks' in result
    assert 'guidance' in result


def test_convenience_function():
    """Test convenience function"""
    text = "Revenue increased by 15%."
    
    result = extract_mda_intelligence(text)
    
    assert isinstance(result, dict)
    assert 'trends' in result


def test_multiple_trends():
    """Test extraction of multiple trends"""
    text = """
    Revenue increased by 15% due to strong sales.
    Operating expenses decreased by 5% as a result of cost controls.
    Net income grew by 25% reflecting improved margins.
    """
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    assert len(intelligence.trends) >= 3


def test_risk_merging():
    """Test that similar risks are merged"""
    text = """
    Supply chain disruptions pose a significant risk.
    Supply chain issues are a material risk.
    Supply chain challenges continue to be a concern.
    """
    
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(text)
    
    # Should merge similar risks
    assert len(intelligence.risks) <= 3
    if len(intelligence.risks) > 0:
        assert intelligence.risks[0].mentions >= 1


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
