"""
Enterprise-Grade Semantic Metric Matcher
Uses Small Language Model (SLM) for fuzzy matching of financial metrics.

Model: all-MiniLM-L6-v2 (22M parameters, 80MB, <10ms inference)
Purpose: Handle typos, natural language queries, and semantic similarity
"""

from sentence_transformers import SentenceTransformer
import numpy as np
from typing import List, Tuple, Dict, Optional
import yaml
import pickle
import json
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SemanticMetricMatcher:
    """
    Enterprise-grade semantic matching for financial metrics.
    Uses SLM embeddings for fuzzy matching with fallback to exact match.
    """
    
    def __init__(self, config_path: str = None):
        logger.info("Initializing Semantic Metric Matcher...")
        
        # Load lightweight model (80MB, <10ms inference)
        try:
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
            logger.info("✅ Loaded SentenceTransformer model")
        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            raise
        
        # Load metric mappings - try multiple paths
        if config_path is None:
            possible_paths = [
                "xbrl_parsing/metric_mapping_enhanced.yaml",  # From python_parser dir
                "python_parser/xbrl_parsing/metric_mapping_enhanced.yaml",  # From workspace root
            ]
            config_path_obj = None
            for path in possible_paths:
                p = Path(path)
                if p.exists():
                    config_path_obj = p
                    break
            if config_path_obj is None:
                raise FileNotFoundError(f"Config file not found in any of: {possible_paths}")
        else:
            config_path_obj = Path(config_path)
            if not config_path_obj.exists():
                raise FileNotFoundError(f"Config file not found: {config_path}")
        
        with open(config_path_obj) as f:
            self.config = yaml.safe_load(f)
        
        logger.info(f"✅ Loaded {len(self.config.get('metrics', []))} metrics from {config_path_obj}")
        
        # Build embedding index
        self.metric_index = self._build_index()
        
        # Cache for performance
        self.query_cache = {}
        
        logger.info("✅ Semantic Metric Matcher initialized")
        
    def _build_index(self) -> Dict:
        """
        Pre-compute embeddings for all metrics and synonyms.
        Run once at startup, cache to disk.
        """
        # Try multiple cache paths
        possible_cache_paths = [
            Path("xbrl_parsing/metric_embeddings.pkl"),  # From python_parser dir
            Path("python_parser/xbrl_parsing/metric_embeddings.pkl"),  # From workspace root
        ]
        
        cache_path = None
        for p in possible_cache_paths:
            if p.exists():
                cache_path = p
                break
        
        # If no cache exists, use the first path (relative to current dir)
        if cache_path is None:
            cache_path = possible_cache_paths[0]
        
        if cache_path.exists():
            logger.info(f"Loading cached embeddings from {cache_path}...")
            with open(cache_path, 'rb') as f:
                return pickle.load(f)
        
        logger.info("Building embedding index (this may take a minute)...")
        
        index = {
            'metric_ids': [],
            'texts': [],
            'embeddings': [],
            'metadata': []
        }
        
        for metric in self.config.get('metrics', []):
            metric_id = metric['id']
            canonical_name = metric.get('canonical_name', metric.get('name', ''))
            
            # Index canonical name
            texts = [canonical_name.lower()]
            
            # Index all synonyms
            if 'synonyms' in metric:
                if isinstance(metric['synonyms'], dict):
                    # New format with primary + industry_specific
                    texts.extend([s.lower() for s in metric['synonyms'].get('primary', [])])
                    for industry_syns in metric['synonyms'].get('industry_specific', {}).values():
                        texts.extend([s.lower() for s in industry_syns])
                else:
                    # Old format (list)
                    texts.extend([s.lower() for s in metric['synonyms']])
            
            # Index semantic hints
            if 'semantic_hints' in metric:
                texts.extend([h.lower() for h in metric['semantic_hints']])
            
            # Index fuzzy matches
            if 'fuzzy_matches' in metric:
                texts.extend([f.lower() for f in metric['fuzzy_matches']])
            
            # Compute embeddings in batch
            embeddings = self.model.encode(texts, show_progress_bar=False)
            
            for text, embedding in zip(texts, embeddings):
                index['metric_ids'].append(metric_id)
                index['texts'].append(text)
                index['embeddings'].append(embedding)
                index['metadata'].append({
                    'canonical_name': canonical_name,
                    'category': metric.get('statement_type', 'general'),
                    'industry': metric.get('industry', None)
                })
        
        # Convert to numpy for fast similarity search
        index['embeddings'] = np.array(index['embeddings'])
        
        logger.info(f"✅ Built index with {len(index['metric_ids'])} entries")
        
        # Cache to disk
        with open(cache_path, 'wb') as f:
            pickle.dump(index, f)
        
        logger.info(f"✅ Cached embeddings to {cache_path}")
        
        return index
    
    def match(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.7,
        industry: Optional[str] = None
    ) -> List[Tuple[str, float, Dict]]:
        """
        Match user query to metrics using semantic similarity.
        
        Args:
            query: User's natural language query
            top_k: Return top K matches
            threshold: Minimum similarity score (0-1)
            industry: Optional industry filter
        
        Returns:
            List of (metric_id, confidence, metadata) tuples
        """
        # Check cache
        cache_key = f"{query.lower()}:{industry}"
        if cache_key in self.query_cache:
            return self.query_cache[cache_key]
        
        # Encode query
        query_embedding = self.model.encode([query.lower()])[0]
        
        # Compute cosine similarity
        similarities = np.dot(
            self.metric_index['embeddings'],
            query_embedding
        ) / (
            np.linalg.norm(self.metric_index['embeddings'], axis=1) *
            np.linalg.norm(query_embedding)
        )
        
        # Get top K indices
        top_indices = np.argsort(similarities)[::-1][:top_k * 3]  # Get extra for filtering and deduplication
        
        # Build results
        results = []
        seen_metrics = set()
        
        for idx in top_indices:
            if len(results) >= top_k:
                break
            
            similarity = similarities[idx]
            if similarity < threshold:
                continue
            
            metric_id = self.metric_index['metric_ids'][idx]
            
            # Avoid duplicate metrics
            if metric_id in seen_metrics:
                continue
            seen_metrics.add(metric_id)
            
            metadata = self.metric_index['metadata'][idx].copy()
            metadata['matched_text'] = self.metric_index['texts'][idx]
            
            results.append((metric_id, float(similarity), metadata))
        
        # Cache result
        self.query_cache[cache_key] = results
        
        return results
    
    def explain_match(self, query: str, metric_id: str) -> Dict:
        """
        Explain why a query matched a metric (for debugging/transparency).
        """
        matches = self.match(query, top_k=10, threshold=0.0)
        
        for mid, score, metadata in matches:
            if mid == metric_id:
                return {
                    'query': query,
                    'metric_id': metric_id,
                    'confidence': score,
                    'matched_via': metadata['matched_text'],
                    'canonical_name': metadata['canonical_name']
                }
        
        return {'error': 'No match found'}


# CLI Interface for testing and integration
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python semantic_matcher.py <query> [ticker]")
        sys.exit(1)
    
    query = sys.argv[1]
    ticker = sys.argv[2] if len(sys.argv) > 2 else None
    
    try:
        matcher = SemanticMetricMatcher()
        matches = matcher.match(query, top_k=5, threshold=0.7)
        
        # Output as JSON for easy parsing
        result = {
            'query': query,
            'ticker': ticker,
            'matches': [
                {
                    'metric_id': metric_id,
                    'confidence': confidence,
                    'canonical_name': metadata['canonical_name'],
                    'matched_via': metadata['matched_text']
                }
                for metric_id, confidence, metadata in matches
            ]
        }
        
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'query': query
        }
        print(json.dumps(error_result, indent=2))
        sys.exit(1)
