import numpy as np
import pandas as pd
from collections import defaultdict
from typing import List, Dict, Tuple, Set


class RecommendationEvaluator:
    """Evaluate recommendation quality with minimal essential metrics."""
    
    def __init__(self, k_values: List[int] = [3, 5]):
        """
        Args:
            k_values: Top-K values to evaluate (e.g., [5, 10])
        """
        self.k_values = k_values
        self.results = defaultdict(list)
        
    def ndcg_at_k(self, actual_items: List[str], 
                  recommended_items: List[str], k: int) -> float:
        """
        Calculate NDCG@K for a single user.
        
        Args:
            actual_items: List of items user actually interacted with
            recommended_items: List of recommended items (ordered by score)
            k: Number of recommendations to consider
            
        Returns:
            NDCG score between 0 and 1
            
        Example:
            actual = ['beach_pkg', 'mountain_pkg']
            recommended = ['city_pkg', 'beach_pkg', 'safari_pkg', 'mountain_pkg', 'cruise_pkg']
            ndcg = ndcg_at_k(actual, recommended, k=5)
            # DCG: 0 + 1/log2(3) + 0 + 1/log2(5) + 0 = 1.06
            # IDCG: 1/log2(2) + 1/log2(3) = 1.63
            # NDCG: 1.06/1.63 = 0.65
        """
        if not actual_items or not recommended_items:
            return 0.0
            
        # Limit to top-k recommendations
        recommended_items = recommended_items[:k]
        actual_set = set(actual_items)
        
        # Calculate DCG (Discounted Cumulative Gain)
        dcg = 0.0
        for i, item in enumerate(recommended_items):
            if item in actual_set:
                # rel = 1 for implicit feedback (binary: relevant or not)
                # position i+1 (1-indexed), discount by log2(i+2)
                dcg += 1.0 / np.log2(i + 2)
        
        # Calculate IDCG (Ideal DCG - if all relevant items were ranked first)
        idcg = 0.0
        for i in range(min(len(actual_items), k)):
            idcg += 1.0 / np.log2(i + 2)
        
        # Avoid division by zero
        if idcg == 0:
            return 0.0
            
        return dcg / idcg
    
    def hit_rate_at_k(self, actual_items: List[str], 
                      recommended_items: List[str], k: int) -> int:
        """
        Check if at least one actual item is in top-K recommendations.
        
        Returns:
            1 if hit, 0 if miss
            
        Example:
            actual = ['beach_pkg']
            recommended = ['city_pkg', 'beach_pkg', 'mountain_pkg']
            hit = hit_rate_at_k(actual, recommended, k=5)  # Returns 1 (hit)
        """
        if not actual_items or not recommended_items:
            return 0
            
        recommended_set = set(recommended_items[:k])
        actual_set = set(actual_items)
        
        return 1 if len(recommended_set & actual_set) > 0 else 0
    
    def evaluate_user(self, user_id: str, actual_items: List[str], 
                      recommended_items: List[str]) -> Dict[str, float]:
        """
        Evaluate recommendations for a single user.
        
        Args:
            user_id: User identifier
            actual_items: Items user actually interacted with
            recommended_items: Your model's recommendations (ordered)
            
        Returns:
            Dictionary of metrics for this user
        """
        user_metrics = {'user_id': user_id}
        
        for k in self.k_values:
            # NDCG@K
            ndcg = self.ndcg_at_k(actual_items, recommended_items, k)
            user_metrics[f'ndcg@{k}'] = ndcg
            self.results[f'ndcg@{k}'].append(ndcg)
            
            # Hit Rate@K
            hit = self.hit_rate_at_k(actual_items, recommended_items, k)
            user_metrics[f'hit@{k}'] = hit
            self.results[f'hit@{k}'].append(hit)
        
        return user_metrics
    
    def get_summary(self) -> Dict[str, float]:
        """
        Get aggregated metrics across all evaluated users.
        
        Returns:
            Dictionary with mean NDCG@K and Hit Rate@K values
        """
        summary = {}
        
        for k in self.k_values:
            # Average NDCG@K
            ndcg_scores = self.results[f'ndcg@{k}']
            summary[f'ndcg@{k}'] = np.mean(ndcg_scores) if ndcg_scores else 0.0
            summary[f'ndcg@{k}_std'] = np.std(ndcg_scores) if ndcg_scores else 0.0
            
            # Hit Rate@K (percentage)
            hit_scores = self.results[f'hit@{k}']
            summary[f'hit_rate@{k}'] = np.mean(hit_scores) * 100 if hit_scores else 0.0
        
        summary['num_users'] = len(self.results[f'ndcg@{self.k_values[0]}'])
        
        return summary
    
    def reset(self):
        """Clear all stored results."""
        self.results = defaultdict(list)


class CatalogCoverageAnalyzer:
    """Analyze diversity of recommendations."""
    
    def __init__(self):
        self.recommended_items = []
        self.total_catalog = set()
        
    def add_recommendations(self, recommended_items: List[str]):
        """Add a user's recommendations to the analyzer."""
        self.recommended_items.extend(recommended_items)
    
    def set_catalog(self, all_items: Set[str]):
        """Set the full catalog of available items."""
        self.total_catalog = all_items
    
    def get_coverage(self) -> Dict[str, float]:
        """
        Calculate catalog coverage metrics.
        
        Returns:
            Dictionary with coverage statistics
        """
        unique_recommended = set(self.recommended_items)
        
        coverage = {
            'unique_items_recommended': len(unique_recommended),
            'total_catalog_size': len(self.total_catalog),
            'coverage_percentage': (len(unique_recommended) / len(self.total_catalog) * 100) 
                                   if self.total_catalog else 0.0,
            'total_recommendations': len(self.recommended_items)
        }
        
        # Most recommended items (potential popularity bias)
        from collections import Counter
        item_counts = Counter(self.recommended_items)
        coverage['top_5_most_recommended'] = item_counts.most_common(5)
        
        return coverage
    
    def reset(self):
        """Clear stored data."""
        self.recommended_items = []
        self.total_catalog = set()


def evaluate_recommendation_system(
    test_data: pd.DataFrame,
    recommender_model,
    catalog_items: Set[str],
    k_values: List[int] = [5, 10]
) -> Tuple[Dict, Dict, pd.DataFrame]:
    """
    Complete evaluation pipeline for recommendation system.
    
    Args:
        test_data: DataFrame with columns ['user_id', 'item_id']
                   Each row is an actual interaction
        recommender_model: Your model with .recommend(user_id, k) method
        catalog_items: Set of all possible items in catalog
        k_values: Top-K values to evaluate
        
    Returns:
        Tuple of (summary_metrics, coverage_metrics, per_user_results)
        
    Example usage:
        # Prepare test data
        test_df = pd.DataFrame({
            'user_id': ['user1', 'user1', 'user2', 'user3'],
            'item_id': ['beach_pkg', 'scuba_addon', 'mountain_pkg', 'city_pkg']
        })
        
        # Your recommender must have this interface:
        class YourRecommender:
            def recommend(self, user_id, k):
                # Returns list of recommended item_ids
                return ['item1', 'item2', 'item3', ...]
        
        summary, coverage, details = evaluate_recommendation_system(
            test_data=test_df,
            recommender_model=YourRecommender(),
            catalog_items=set(['beach_pkg', 'mountain_pkg', 'city_pkg', ...]),
            k_values=[5, 10]
        )
        
        print(f"NDCG@5: {summary['ndcg@5']:.3f}")
        print(f"Hit Rate@5: {summary['hit_rate@5']:.1f}%")
        print(f"Coverage: {coverage['coverage_percentage']:.1f}%")
    """
    evaluator = RecommendationEvaluator(k_values=k_values)
    coverage_analyzer = CatalogCoverageAnalyzer()
    coverage_analyzer.set_catalog(catalog_items)
    
    # Group test data by user
    user_actual_items = test_data.groupby('user_id')['item_id'].apply(list).to_dict()
    
    per_user_results = []
    
    print(f"Evaluating {len(user_actual_items)} users...")
    
    for user_id, actual_items in user_actual_items.items():
        # Get recommendations from your model
        try:
            recommended_items = recommender_model.recommend(user_id, k=max(k_values))
        except Exception as e:
            print(f"Warning: Could not get recommendations for {user_id}: {e}")
            continue
        
        # Evaluate this user
        user_metrics = evaluator.evaluate_user(user_id, actual_items, recommended_items)
        per_user_results.append(user_metrics)
        
        # Track for coverage analysis
        coverage_analyzer.add_recommendations(recommended_items)
    
    # Get aggregated results
    summary_metrics = evaluator.get_summary()
    coverage_metrics = coverage_analyzer.get_coverage()
    per_user_df = pd.DataFrame(per_user_results)
    
    return summary_metrics, coverage_metrics, per_user_df


def print_evaluation_report(summary: Dict, coverage: Dict):
    """
    Print a formatted evaluation report.
    
    Args:
        summary: Summary metrics from evaluate_recommendation_system
        coverage: Coverage metrics from evaluate_recommendation_system
    """
    print("\n" + "="*60)
    print("RECOMMENDATION SYSTEM EVALUATION REPORT")
    print("="*60)
    
    print("\n📊 RANKING QUALITY (Primary Metric)")
    print("-" * 60)
    for k in [3, 5]:
        if f'ndcg@{k}' in summary:
            ndcg = summary[f'ndcg@{k}']
            std = summary.get(f'ndcg@{k}_std', 0)
            print(f"  NDCG@{k:2d}: {ndcg:.4f} (±{std:.4f})")
            
            # Interpretation
            if ndcg >= 0.3:
                quality = "✓ Good"
            elif ndcg >= 0.15:
                quality = "⚠ Fair"
            else:
                quality = "✗ Poor"
            print(f"           {quality}")
    
    print("\n🎯 HIT RATE (User Satisfaction)")
    print("-" * 60)
    for k in [3, 5]:
        if f'hit_rate@{k}' in summary:
            hit_rate = summary[f'hit_rate@{k}']
            print(f"  Hit Rate@{k:2d}: {hit_rate:.1f}% of users had ≥1 relevant item")
            
            # Interpretation
            if hit_rate >= 70:
                quality = "✓ Good"
            elif hit_rate >= 50:
                quality = "⚠ Fair"
            else:
                quality = "✗ Poor"
            print(f"                {quality}")
    
    print("\n📚 CATALOG COVERAGE (Diversity)")
    print("-" * 60)
    print(f"  Items Recommended: {coverage['unique_items_recommended']}")
    print(f"  Total Catalog:     {coverage['total_catalog_size']}")
    print(f"  Coverage:          {coverage['coverage_percentage']:.1f}%")
    
    cov_pct = coverage['coverage_percentage']
    if cov_pct >= 60:
        quality = "✓ Good diversity"
    elif cov_pct >= 30:
        quality = "⚠ Limited diversity"
    else:
        quality = "✗ Popularity bias detected"
    print(f"                     {quality}")
    
    print("\n  Top 5 Most Recommended Items:")
    for item, count in coverage['top_5_most_recommended']:
        pct = count / coverage['total_recommendations'] * 100
        print(f"    - {item}: {count} times ({pct:.1f}%)")
    
    print("\n" + "="*60)
    print(f"Evaluated {summary['num_users']} users")
    print("="*60 + "\n")