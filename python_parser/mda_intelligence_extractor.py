"""
MD&A Intelligence Extractor for SEC Filings
Extracts trends, risks, and guidance from MD&A sections
Integrates with MDAIntelligenceService
"""

from typing import List, Dict, Optional
from dataclasses import dataclass, asdict, field
import re


@dataclass
class TrendInsight:
    """Extracted trend information"""
    metric: str
    direction: str  # 'increasing', 'decreasing', 'stable'
    magnitude: Optional[float] = None
    drivers: List[str] = field(default_factory=list)
    context: str = ""


@dataclass
class RiskInsight:
    """Identified risk from MD&A"""
    title: str
    severity: str  # 'high', 'medium', 'low'
    description: str
    mentions: int = 1
    category: str = 'other'  # 'operational', 'financial', 'market', 'regulatory', 'other'


@dataclass
class MDAIntelligence:
    """Complete MD&A intelligence extraction"""
    trends: List[TrendInsight] = field(default_factory=list)
    risks: List[RiskInsight] = field(default_factory=list)
    guidance: Optional[str] = None
    guidance_sentiment: str = 'neutral'  # 'positive', 'negative', 'neutral'
    extraction_method: str = 'pattern_based'
    confidence_score: float = 0.0


class MDAIntelligenceExtractor:
    """
    Extract structured insights from MD&A sections
    Pattern-based extraction (deterministic, $0 cost)
    """
    
    # Trend detection patterns
    TREND_PATTERNS = [
        # Increase patterns
        {'pattern': r'(\w+(?:\s+\w+)?)\s+(?:increased|rose|grew|improved)\s+(?:by\s+)?(\d+(?:\.\d+)?)%', 
         'direction': 'increasing'},
        {'pattern': r'(\w+(?:\s+\w+)?)\s+(?:increased|rose|grew)\s+\$?([\d,\.]+)\s+(?:million|billion)', 
         'direction': 'increasing'},
        
        # Decrease patterns
        {'pattern': r'(\w+(?:\s+\w+)?)\s+(?:decreased|declined|fell|dropped)\s+(?:by\s+)?(\d+(?:\.\d+)?)%', 
         'direction': 'decreasing'},
        {'pattern': r'(\w+(?:\s+\w+)?)\s+(?:decreased|declined|fell)\s+\$?([\d,\.]+)\s+(?:million|billion)', 
         'direction': 'decreasing'},
        
        # Stable patterns
        {'pattern': r'(\w+(?:\s+\w+)?)\s+(?:remained stable|was flat|unchanged)', 
         'direction': 'stable'}
    ]
    
    # Driver extraction patterns
    DRIVER_PATTERNS = [
        r'(?:due to|driven by|primarily from|as a result of|attributable to|reflecting)\s+([^\.;]+)',
        r'(?:because of|owing to|resulting from)\s+([^\.;]+)'
    ]
    
    # Risk keywords by severity
    RISK_KEYWORDS = {
        'high': ['significant risk', 'material risk', 'substantial risk', 'critical', 'severe'],
        'medium': ['risk', 'challenge', 'uncertainty', 'concern', 'potential issue'],
        'low': ['may impact', 'could affect', 'possible']
    }
    
    # Risk categories
    RISK_CATEGORIES = {
        'operational': ['supply chain', 'operations', 'production', 'manufacturing', 'logistics'],
        'financial': ['liquidity', 'debt', 'credit', 'cash flow', 'financing'],
        'market': ['competition', 'market share', 'demand', 'pricing', 'customer'],
        'regulatory': ['regulation', 'compliance', 'legal', 'government', 'policy']
    }
    
    # Guidance patterns
    GUIDANCE_PATTERNS = [
        r'(?:we expect|expect|guidance|outlook|forecast|anticipate|project)\s+([^\.]+)',
        r'(?:for\s+(?:fiscal\s+)?(?:year\s+)?\d{4})[,\s]+(?:we expect|expect)\s+([^\.]+)'
    ]
    
    # Sentiment keywords
    SENTIMENT_KEYWORDS = {
        'positive': ['strong', 'growth', 'improved', 'increased', 'favorable', 'positive', 'optimistic', 'confident'],
        'negative': ['weak', 'decline', 'decreased', 'unfavorable', 'negative', 'challenging', 'difficult', 'concern']
    }
    
    def __init__(self):
        self.intelligence: Optional[MDAIntelligence] = None
    
    def extract_intelligence(self, mda_text: str) -> MDAIntelligence:
        """
        Extract intelligence from MD&A text
        
        Args:
            mda_text: MD&A section text
            
        Returns:
            MDAIntelligence object with extracted insights
        """
        if not mda_text or len(mda_text.strip()) == 0:
            return MDAIntelligence()
        
        # Extract trends
        trends = self._extract_trends(mda_text)
        
        # Extract risks
        risks = self._extract_risks(mda_text)
        
        # Extract guidance
        guidance, sentiment = self._extract_guidance(mda_text)
        
        # Calculate confidence score
        confidence = self._calculate_confidence(trends, risks, guidance)
        
        intelligence = MDAIntelligence(
            trends=trends,
            risks=risks,
            guidance=guidance,
            guidance_sentiment=sentiment,
            extraction_method='pattern_based',
            confidence_score=confidence
        )
        
        self.intelligence = intelligence
        return intelligence
    
    def _extract_trends(self, text: str) -> List[TrendInsight]:
        """Extract trend insights"""
        trends = []
        seen_metrics = set()
        
        for pattern_info in self.TREND_PATTERNS:
            pattern = pattern_info['pattern']
            direction = pattern_info['direction']
            
            for match in re.finditer(pattern, text, re.IGNORECASE):
                metric = self._normalize_metric_name(match.group(1))
                magnitude = None
                
                if len(match.groups()) > 1:
                    try:
                        magnitude = float(match.group(2).replace(',', ''))
                    except (ValueError, AttributeError):
                        pass
                
                # Skip duplicates
                if metric in seen_metrics:
                    continue
                seen_metrics.add(metric)
                
                # Extract context
                start = max(0, match.start() - 100)
                end = min(len(text), match.end() + 100)
                context = text[start:end].strip()
                
                # Extract drivers
                drivers = self._extract_drivers(context)
                
                trend = TrendInsight(
                    metric=metric,
                    direction=direction,
                    magnitude=magnitude,
                    drivers=drivers,
                    context=self._clean_text(context)
                )
                
                trends.append(trend)
        
        return trends
    
    def _extract_drivers(self, text: str) -> List[str]:
        """Extract drivers from text"""
        drivers = []
        
        for pattern in self.DRIVER_PATTERNS:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                driver = self._clean_text(match.group(1))
                if 10 < len(driver) < 200:
                    drivers.append(driver)
        
        return list(set(drivers))  # Remove duplicates
    
    def _extract_risks(self, text: str) -> List[RiskInsight]:
        """Extract risk insights"""
        risks = []
        sentences = self._split_into_sentences(text)
        
        for sentence in sentences:
            lower_sentence = sentence.lower()
            
            # Determine severity
            severity = None
            for sev, keywords in self.RISK_KEYWORDS.items():
                if any(kw in lower_sentence for kw in keywords):
                    severity = sev
                    break
            
            if severity:
                # Categorize risk
                category = self._categorize_risk(lower_sentence)
                
                # Extract title (first few words)
                words = sentence.split()
                title = ' '.join(words[:min(8, len(words))])
                
                risk = RiskInsight(
                    title=self._clean_text(title),
                    severity=severity,
                    description=self._clean_text(sentence),
                    mentions=1,
                    category=category
                )
                
                risks.append(risk)
        
        # Merge similar risks
        return self._merge_risks(risks)
    
    def _categorize_risk(self, text: str) -> str:
        """Categorize risk based on keywords"""
        for category, keywords in self.RISK_CATEGORIES.items():
            if any(kw in text for kw in keywords):
                return category
        return 'other'
    
    def _merge_risks(self, risks: List[RiskInsight]) -> List[RiskInsight]:
        """Merge similar risks and count mentions"""
        merged = {}
        
        for risk in risks:
            key = risk.title.lower()[:50]
            
            if key in merged:
                merged[key].mentions += 1
                # Keep higher severity
                if self._severity_score(risk.severity) > self._severity_score(merged[key].severity):
                    merged[key].severity = risk.severity
            else:
                merged[key] = risk
        
        # Sort by severity
        return sorted(
            merged.values(),
            key=lambda r: self._severity_score(r.severity),
            reverse=True
        )
    
    def _severity_score(self, severity: str) -> int:
        """Get numeric severity score"""
        scores = {'high': 3, 'medium': 2, 'low': 1}
        return scores.get(severity, 0)
    
    def _extract_guidance(self, text: str) -> tuple[Optional[str], str]:
        """Extract forward guidance and sentiment"""
        guidance = None
        
        # Extract guidance text
        for pattern in self.GUIDANCE_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                guidance = self._clean_text(match.group(1))
                break
        
        # Determine sentiment
        sentiment = self._analyze_sentiment(guidance or text)
        
        return guidance, sentiment
    
    def _analyze_sentiment(self, text: str) -> str:
        """Analyze sentiment of text"""
        lower_text = text.lower()
        
        positive_count = sum(
            len(re.findall(kw, lower_text))
            for kw in self.SENTIMENT_KEYWORDS['positive']
        )
        
        negative_count = sum(
            len(re.findall(kw, lower_text))
            for kw in self.SENTIMENT_KEYWORDS['negative']
        )
        
        if positive_count > negative_count * 1.5:
            return 'positive'
        elif negative_count > positive_count * 1.5:
            return 'negative'
        return 'neutral'
    
    def _calculate_confidence(
        self,
        trends: List[TrendInsight],
        risks: List[RiskInsight],
        guidance: Optional[str]
    ) -> float:
        """Calculate confidence score"""
        score = 0.0
        
        # Trends contribute up to 40 points
        score += min(40, len(trends) * 10)
        
        # Risks contribute up to 30 points
        score += min(30, len(risks) * 5)
        
        # Guidance contributes up to 30 points
        if guidance and len(guidance) > 20:
            score += 30
        
        return min(100, score)
    
    def _normalize_metric_name(self, name: str) -> str:
        """Normalize metric name"""
        return name.lower().strip().replace(' ', '_').replace('-', '_')
    
    def _clean_text(self, text: str) -> str:
        """Clean text"""
        return re.sub(r'\s+', ' ', text).strip()
    
    def _split_into_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        sentences = re.split(r'[.!?]+', text)
        return [s.strip() for s in sentences if len(s.strip()) > 20]
    
    def to_dict(self) -> Dict:
        """Convert intelligence to dictionary"""
        if not self.intelligence:
            return {}
        
        return {
            'trends': [asdict(t) for t in self.intelligence.trends],
            'risks': [asdict(r) for r in self.intelligence.risks],
            'guidance': self.intelligence.guidance,
            'guidance_sentiment': self.intelligence.guidance_sentiment,
            'extraction_method': self.intelligence.extraction_method,
            'confidence_score': self.intelligence.confidence_score
        }


def extract_mda_intelligence(mda_text: str) -> Dict:
    """
    Convenience function to extract MD&A intelligence
    
    Args:
        mda_text: MD&A section text
        
    Returns:
        Dictionary with extracted intelligence
    """
    extractor = MDAIntelligenceExtractor()
    intelligence = extractor.extract_intelligence(mda_text)
    return extractor.to_dict()


# Singleton instance
_extractor_instance = None


def get_mda_extractor() -> MDAIntelligenceExtractor:
    """Get singleton MD&A extractor instance"""
    global _extractor_instance
    if _extractor_instance is None:
        _extractor_instance = MDAIntelligenceExtractor()
    return _extractor_instance
