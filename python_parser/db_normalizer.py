"""
Metric normalizer that fetches mappings from PostgreSQL
"""

import requests
from typing import Dict, Tuple, Optional

class DatabaseMetricNormalizer:
    """Fetches metric mappings from NestJS API"""
    
    def __init__(self, api_url: str = 'http://localhost:3000'):
        self.api_url = api_url
        self.synonym_map = {}
        self._load_mappings()
    
    def _load_mappings(self):
        """Load mappings from API"""
        try:
            response = requests.get(f'{self.api_url}/api/sec/mappings')
            mappings = response.json()
            
            for mapping in mappings:
                normalized_metric = mapping['normalizedMetric']
                synonyms = mapping.get('synonyms', [])
                
                for synonym in synonyms:
                    self.synonym_map[synonym.lower()] = normalized_metric
            
            print(f"✅ Loaded {len(self.synonym_map)} metric synonyms from database")
        except Exception as e:
            print(f"⚠️  Warning: Could not load mappings from API: {e}")
            # Fallback mappings
            self.synonym_map = {
                'accounts payable': 'accounts_payable',
                'trade payables': 'accounts_payable',
                'revenue': 'revenue',
                'revenues': 'revenue',
                'net sales': 'revenue',
                'net income': 'net_income',
            }
    
    def normalize(self, raw_label: str) -> Tuple[Optional[str], float]:
        """
        Normalize a raw label to standard metric ID
        
        Returns:
            (normalized_metric, confidence_score)
        """
        raw_lower = raw_label.lower().strip()
        
        # Direct match
        if raw_lower in self.synonym_map:
            return self.synonym_map[raw_lower], 1.0
        
        # Fuzzy match
        for synonym, metric_id in self.synonym_map.items():
            if synonym in raw_lower or raw_lower in synonym:
                return metric_id, 0.9
        
        return None, 0.0
