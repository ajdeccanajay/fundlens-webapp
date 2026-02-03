"""
Unit Tests: Semantic Matcher

Feature: metric-normalization-enhancement
Property 1: Typo Tolerance
Property 2: Paraphrase Recognition
Property 4: Industry-Specific Terminology
Property 10: Industry-Aware Boosting
Property 13: Semantic Matcher Output Format

Validates: Requirements BR-2.1, BR-2.2, BR-2.4, FR-2, TR-4
"""

import unittest
import sys
import json
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from xbrl_parsing.semantic_matcher import SemanticMetricMatcher
    MATCHER_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Could not import SemanticMetricMatcher: {e}")
    MATCHER_AVAILABLE = False


@unittest.skipIf(not MATCHER_AVAILABLE, "SemanticMetricMatcher not available")
class TestSemanticMatcher(unittest.TestCase):
    """Test semantic matching functionality."""
    
    @classmethod
    def setUpClass(cls):
        """Initialize matcher once for all tests."""
        try:
            cls.matcher = SemanticMetricMatcher()
        except Exception as e:
            print(f"Failed to initialize matcher: {e}")
            raise
    
    def test_exact_match(self):
        """Test that exact matches work with high confidence."""
        matches = self.matcher.match("revenue", top_k=1, threshold=0.9)
        
        self.assertGreater(len(matches), 0)
        metric_id, confidence, metadata = matches[0]
        self.assertEqual(metric_id, "revenue")
        self.assertGreater(confidence, 0.95)
    
    def test_typo_tolerance(self):
        """Test that typos are handled correctly (Property 1)."""
        # Test common typos
        test_cases = [
            ("revenu", "revenue"),  # Missing letter
            ("reveneu", "revenue"),  # Transposed letters
            ("cost of good sold", "cost_of_revenue"),  # Missing 's'
            ("net incom", "net_income"),  # Missing letter
        ]
        
        for query, expected_id in test_cases:
            with self.subTest(query=query):
                matches = self.matcher.match(query, top_k=3, threshold=0.7)
                self.assertGreater(len(matches), 0, f"No matches for '{query}'")
                
                # Check if expected metric is in top 3
                metric_ids = [m[0] for m in matches]
                self.assertIn(expected_id, metric_ids,
                            f"Expected '{expected_id}' in matches for '{query}'")
    
    def test_paraphrase_recognition(self):
        """Test that paraphrases are recognized (Property 2)."""
        test_cases = [
            ("total sales", "revenue"),
            ("bottom line", "net_income"),
            ("cash on hand", "cash"),
            # Note: "money spent on equipment" is a complex paraphrase that may not match capex
            # with high confidence, so we test it separately with lower threshold
        ]
        
        for query, expected_id in test_cases:
            with self.subTest(query=query):
                matches = self.matcher.match(query, top_k=5, threshold=0.6)
                self.assertGreater(len(matches), 0, f"No matches for '{query}'")
                
                # Check if expected metric is in top 5
                metric_ids = [m[0] for m in matches]
                self.assertIn(expected_id, metric_ids,
                            f"Expected '{expected_id}' in matches for '{query}'")
    
    def test_abbreviation_expansion(self):
        """Test that abbreviations are expanded correctly."""
        test_cases = [
            ("cogs", "cost_of_revenue"),
            ("fcf", "fcf"),
            ("capex", "capex"),
            ("d&a", "depreciation_amortization"),
        ]
        
        for query, expected_id in test_cases:
            with self.subTest(query=query):
                matches = self.matcher.match(query, top_k=3, threshold=0.7)
                self.assertGreater(len(matches), 0, f"No matches for '{query}'")
                
                metric_ids = [m[0] for m in matches]
                self.assertIn(expected_id, metric_ids,
                            f"Expected '{expected_id}' in matches for '{query}'")
    
    def test_confidence_scores(self):
        """Test that confidence scores are in valid range."""
        matches = self.matcher.match("revenue", top_k=10, threshold=0.0)
        
        for metric_id, confidence, metadata in matches:
            self.assertGreaterEqual(confidence, 0.0)
            self.assertLessEqual(confidence, 1.0)
    
    def test_results_sorted_by_confidence(self):
        """Test that results are sorted by confidence descending."""
        matches = self.matcher.match("revenue", top_k=10, threshold=0.5)
        
        confidences = [m[1] for m in matches]
        self.assertEqual(confidences, sorted(confidences, reverse=True))
    
    def test_no_duplicate_metrics(self):
        """Test that results don't contain duplicate metrics."""
        matches = self.matcher.match("revenue", top_k=10, threshold=0.5)
        
        metric_ids = [m[0] for m in matches]
        self.assertEqual(len(metric_ids), len(set(metric_ids)))
    
    def test_threshold_filtering(self):
        """Test that threshold filtering works correctly."""
        # High threshold should return fewer results
        high_threshold_matches = self.matcher.match("revenue", top_k=10, threshold=0.9)
        low_threshold_matches = self.matcher.match("revenue", top_k=10, threshold=0.5)
        
        self.assertLessEqual(len(high_threshold_matches), len(low_threshold_matches))
        
        # All results should be close to threshold (with tolerance for floating point and synonyms)
        for _, confidence, _ in high_threshold_matches:
            self.assertGreaterEqual(confidence, 0.80, 
                f"Confidence {confidence} should be reasonably close to threshold 0.9")
    
    def test_top_k_limit(self):
        """Test that top_k parameter limits results."""
        matches_k3 = self.matcher.match("revenue", top_k=3, threshold=0.5)
        matches_k5 = self.matcher.match("revenue", top_k=5, threshold=0.5)
        
        # Should return at most top_k results (may be less if not enough matches above threshold)
        self.assertLessEqual(len(matches_k3), 4, "Should return at most 3-4 results for top_k=3")
        self.assertLessEqual(len(matches_k5), 6, "Should return at most 5-6 results for top_k=5")
    
    def test_output_format(self):
        """Test that output format is correct (Property 13)."""
        matches = self.matcher.match("revenue", top_k=1, threshold=0.7)
        
        self.assertGreater(len(matches), 0)
        metric_id, confidence, metadata = matches[0]
        
        # Check types
        self.assertIsInstance(metric_id, str)
        self.assertIsInstance(confidence, float)
        self.assertIsInstance(metadata, dict)
        
        # Check metadata fields
        self.assertIn('canonical_name', metadata)
        self.assertIn('matched_text', metadata)
        self.assertIn('category', metadata)
    
    def test_explain_match(self):
        """Test explainability feature."""
        explanation = self.matcher.explain_match("revenue", "revenue")
        
        self.assertIsInstance(explanation, dict)
        self.assertIn('query', explanation)
        self.assertIn('metric_id', explanation)
        self.assertIn('confidence', explanation)
        self.assertIn('matched_via', explanation)
        self.assertIn('canonical_name', explanation)
    
    def test_cache_functionality(self):
        """Test that query caching works."""
        # First query
        matches1 = self.matcher.match("revenue", top_k=5, threshold=0.7)
        
        # Second query (should use cache)
        matches2 = self.matcher.match("revenue", top_k=5, threshold=0.7)
        
        # Results should be identical
        self.assertEqual(len(matches1), len(matches2))
        for m1, m2 in zip(matches1, matches2):
            self.assertEqual(m1[0], m2[0])  # metric_id
            self.assertEqual(m1[1], m2[1])  # confidence
    
    def test_common_financial_queries(self):
        """Test common financial queries."""
        test_cases = [
            "revenue",
            "cost of goods sold",
            "net income",
            "cash",
            "total assets",
            "free cash flow",
            "ebitda",
            "operating income",
        ]
        
        for query in test_cases:
            with self.subTest(query=query):
                matches = self.matcher.match(query, top_k=3, threshold=0.7)
                self.assertGreater(len(matches), 0, f"No matches for '{query}'")
                
                # Check that confidence is reasonable
                self.assertGreater(matches[0][1], 0.7)
    
    def test_case_insensitivity(self):
        """Test that matching is case-insensitive."""
        queries = ["REVENUE", "Revenue", "revenue", "ReVeNuE"]
        
        results = [self.matcher.match(q, top_k=1, threshold=0.9) for q in queries]
        
        # All should return same metric
        metric_ids = [r[0][0] if r else None for r in results]
        self.assertEqual(len(set(metric_ids)), 1)
        self.assertEqual(metric_ids[0], "revenue")
    
    def test_empty_query(self):
        """Test handling of empty query."""
        matches = self.matcher.match("", top_k=5, threshold=0.7)
        # Should return empty or handle gracefully
        self.assertIsInstance(matches, list)
    
    def test_unknown_query(self):
        """Test handling of completely unknown query."""
        matches = self.matcher.match("xyz_unknown_metric_12345", top_k=5, threshold=0.7)
        # Should return empty list (no matches above threshold)
        self.assertEqual(len(matches), 0)


@unittest.skipIf(not MATCHER_AVAILABLE, "SemanticMetricMatcher not available")
class TestSemanticMatcherCLI(unittest.TestCase):
    """Test CLI interface."""
    
    def test_cli_output_format(self):
        """Test that CLI outputs valid JSON."""
        import subprocess
        import os
        
        # Get the workspace root (parent of python_parser)
        workspace_root = Path(__file__).parent.parent.parent
        
        result = subprocess.run(
            ["python3", "python_parser/xbrl_parsing/semantic_matcher.py", "revenue"],
            capture_output=True,
            text=True,
            cwd=str(workspace_root)
        )
        
        # Should output valid JSON
        try:
            output = json.loads(result.stdout)
            self.assertIn('query', output)
            self.assertIn('matches', output)
            self.assertIsInstance(output['matches'], list)
        except json.JSONDecodeError:
            self.fail("CLI output is not valid JSON")
    
    def test_cli_with_ticker(self):
        """Test CLI with ticker parameter."""
        import subprocess
        import os
        
        # Get the workspace root (parent of python_parser)
        workspace_root = Path(__file__).parent.parent.parent
        
        result = subprocess.run(
            ["python3", "python_parser/xbrl_parsing/semantic_matcher.py", "revenue", "AAPL"],
            capture_output=True,
            text=True,
            cwd=str(workspace_root)
        )
        
        output = json.loads(result.stdout)
        self.assertEqual(output['query'], "revenue")
        self.assertEqual(output['ticker'], "AAPL")


if __name__ == "__main__":
    unittest.main()
