"""
Integration script to evaluate your SVD++ recommendation system.
Run this after training your model with trainer.py
"""

import pandas as pd
import pickle
import os
from evaluator import (
    evaluate_recommendation_system, 
    print_evaluation_report,
)


def load_test_data(test_file_path: str, min_interactions: int = 2) -> pd.DataFrame:
    """Load test data, filtering to users with enough history."""
    df = pd.read_csv(test_file_path)
    df = df[df['rating'] == 1]
    
    # Filter to users with minimum interactions
    user_counts = df.groupby('user_id').size()
    valid_users = user_counts[user_counts >= min_interactions].index
    df = df[df['user_id'].isin(valid_users)]
    
    print(f"Filtered to {len(df)} interactions from {df['user_id'].nunique()} users (min {min_interactions} interactions)")
    
    return df[['user_id', 'item_id']]


def get_catalog_items(data_file_path: str) -> set:
    """
    Extract all unique items from your full dataset.
    This is your catalog for coverage analysis.
    """
    df = pd.read_csv(data_file_path)
    return set(df['item_id'].unique())


class YourRecommenderAdapter:
    """
    Adapter for your existing recommendation system.
    Modify the __init__ and recommend methods to match your loader.py
    """
    
    def __init__(self, svd_model_path: str, popularity_data_paths: dict, 
             all_items: set, current_month: int = None):
        """
        Load your trained models and data.
        
        Args:
            svd_model_path: Path to pickled SVD++ model from trainer.py
            popularity_data_paths: Dict with paths to CSV files:
                {'package': 'path/to/package.csv',
                'addon': 'path/to/addon.csv',
                'cooccurrence': 'path/to/coocc.csv'}
            all_items: Set of all item IDs in catalog
            current_month: Month for popularity fallback (as string 'YYYY-MM')
        """
        # Load your trained SVD++ model
        with open(svd_model_path, 'rb') as f:
            self.svd_model = pickle.load(f)
        
        # Load popularity CSVs (not pickle!)
        self.popularity_data = {}
        
        if os.path.exists(popularity_data_paths.get('package', '')):
            self.popularity_data['package'] = pd.read_csv(popularity_data_paths['package'])
        else:
            self.popularity_data['package'] = pd.DataFrame()
        
        if os.path.exists(popularity_data_paths.get('addon', '')):
            self.popularity_data['addon'] = pd.read_csv(popularity_data_paths['addon'])
        else:
            self.popularity_data['addon'] = pd.DataFrame()
        
        if os.path.exists(popularity_data_paths.get('cooccurrence', '')):
            self.popularity_data['cooccurrence'] = pd.read_csv(popularity_data_paths['cooccurrence'])
        else:
            self.popularity_data['cooccurrence'] = pd.DataFrame()
        
        self.all_items = all_items
        self.current_month = current_month  # Keep as string 'YYYY-MM'
        
        # Get inner_ids from your model
        self.trainset = self.svd_model.trainset
    
    def recommend(self, user_id: str, k: int = 3) -> list:
        """
        Generate top-K package recommendations for a user.
        Uses your loader.py logic.
        """
        try:
            # Call your recommend_for_user function
            from loader import recommend_for_user
            
            result = recommend_for_user(
                algo=self.svd_model,
                user_id=user_id,
                popularity_tables={
                    'package': self.popularity_data.get('package', pd.DataFrame()),
                    'addon': self.popularity_data.get('addon', pd.DataFrame()),
                    'cooccurrence': self.popularity_data.get('cooccurrence', pd.DataFrame())
                },
                month=self.current_month,
                alpha=0.6,
                top_k=k
            )
            
            # Extract just package IDs from recommendations
            # result['recommendations'] is [((pkg_id, [addons]), score), ...]
            package_ids = [pkg_id for ((pkg_id, addons), score) in result['recommendations']]
            
            return package_ids
            
        except Exception as e:
            print(f"Error recommending for {user_id}: {e}")
            return []
    
    def _is_known_user(self, user_id: str) -> bool:
        """Check if user exists in training set."""
        try:
            self.trainset.to_inner_uid(user_id)
            return True
        except:
            return False
    
    def _get_popular_packages(self, k: int) -> list:
        """
        Get top-K popular packages for current month.
        Modify to match your popularity_builder.py structure.
        """
        # Example: assuming popularity_data has structure:
        # {month: {'packages': [(pkg_id, count), ...], ...}}
        
        month_data = self.popularity_data.get(self.current_month, {})
        popular_packages = month_data.get('packages', [])
        
        # Return top-K package IDs
        return [pkg_id for pkg_id, count in popular_packages[:k]]


def run_evaluation(
    model_path: str,
    popularity_data_paths: dict,
    test_data_path: str,
    full_data_path: str,
    output_path: str = None
):
    """
    Complete evaluation pipeline.
    """
    print("Loading data...")
    
    # Load test data
    test_df = load_test_data(test_data_path)
    print(f"✓ Loaded {len(test_df)} test interactions")
    
    # Get catalog
    catalog_items = get_catalog_items(full_data_path)
    print(f"✓ Catalog size: {len(catalog_items)} items")
    
    # Initialize your recommender
    print("\nLoading models...")
    recommender = YourRecommenderAdapter(
        svd_model_path=model_path,
        popularity_data_paths=popularity_data_paths,
        all_items=catalog_items,
        current_month=None
    )
    print("✓ Models loaded")
    
    # Run evaluation
    print("\nEvaluating recommendations...")
    summary, coverage, per_user = evaluate_recommendation_system(
        test_data=test_df,
        recommender_model=recommender,
        catalog_items=catalog_items,
        k_values=[3, 5]
    )
    
    # Print results
    print_evaluation_report(summary, coverage)
    
    # Save detailed results
    if output_path:
        per_user.to_csv(output_path, index=False)
        print(f"\n✓ Detailed results saved to {output_path}")
    
    return summary, coverage, per_user  
    

def compare_models(model_paths: dict, test_data_path: str, 
                   full_data_path: str, popularity_path: str):
    """
    Compare multiple models (e.g., different hyperparameters).
    
    Args:
        model_paths: Dict of {model_name: model_path}
        test_data_path: Path to test data
        full_data_path: Path to full dataset
        popularity_path: Path to popularity data
        
    Example:
        compare_models(
            model_paths={
                'svd_n_factors_50': 'models/svd_f50.pkl',
                'svd_n_factors_100': 'models/svd_f100.pkl',
                'svd_n_factors_200': 'models/svd_f200.pkl'
            },
            test_data_path='data/test.csv',
            full_data_path='data/full.csv',
            popularity_path='artifacts/popularity.pkl'
        )
    """
    test_df = load_test_data(test_data_path)
    catalog_items = get_catalog_items(full_data_path)
    
    results_comparison = []
    
    for model_name, model_path in model_paths.items():
        print(f"\n{'='*60}")
        print(f"Evaluating: {model_name}")
        print('='*60)
        
        recommender = YourRecommenderAdapter(
            svd_model_path=model_path,
            popularity_data_path=popularity_path,
            all_items=catalog_items
        )
        
        summary, coverage, _ = evaluate_recommendation_system(
            test_data=test_df,
            recommender_model=recommender,
            catalog_items=catalog_items,
            k_values=[3, 5]
        )
        
        print_evaluation_report(summary, coverage)
        
        # Store for comparison
        result = {'model': model_name}
        result.update(summary)
        result.update({f'cov_{k}': v for k, v in coverage.items()})
        results_comparison.append(result)
    
    # Print comparison table
    print("\n" + "="*80)
    print("MODEL COMPARISON")
    print("="*80)
    
    comparison_df = pd.DataFrame(results_comparison)
    print(comparison_df[['model', 'ndcg@5', 'ndcg@10', 
                         'hit_rate@5', 'hit_rate@10', 
                         'cov_coverage_percentage']])
    
    return comparison_df


def temporal_split_evaluation(
    full_data_path: str,
    model_path: str,
    popularity_data_paths: str,
    train_end_date: str,
    test_start_date: str
):
    """
    Proper temporal train/test split for time-series data.
    
    Args:
        full_data_path: Path to full dataset with timestamp column
        model_path: Path to trained model
        popularity_path: Path to popularity data
        train_end_date: Last date for training (e.g., '2024-10-31')
        test_start_date: First date for testing (e.g., '2024-11-01')
        
    Important: Your model should be trained ONLY on data before train_end_date
    """
    # Load full data
    df = pd.read_csv(full_data_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Create temporal split
    test_df = df[df['timestamp'] >= test_start_date]
    test_df = test_df[test_df['rating'] == 1]  # Only positive interactions
    
    print(f"Test period: {test_start_date} onwards")
    print(f"Test interactions: {len(test_df)}")
    print(f"Test users: {test_df['user_id'].nunique()}")
    
    # Get catalog
    catalog_items = set(df['item_id'].unique())
    
    # Run evaluation
    # Initialize your recommender
    print("\nLoading models...")
    recommender = YourRecommenderAdapter(
        svd_model_path=model_path,
        popularity_data_paths={
            'package': 'recommender/artifacts/month_package_popularity.csv',
            'addon': 'recommender/artifacts/month_addon_popularity.csv',
            'cooccurrence': 'recommender/artifacts/month_package_addon_cooccurrence.csv'
        },
        all_items=catalog_items,
        current_month=None  # Use string format, adjust to your data
    )
        
    summary, coverage, per_user = evaluate_recommendation_system(
        test_data=test_df[['user_id', 'item_id']],
        recommender_model=recommender,
        catalog_items=catalog_items,
        k_values=[3, 5]
    )
    
    print_evaluation_report(summary, coverage)
    
    return summary, coverage, per_user


if __name__ == "__main__":
    """
    Example usage - modify paths to match your file structure
    """
    
    # Simple evaluation
    print("Running evaluation...")
    summary, coverage, details = run_evaluation(
        model_path='recommender/models/surprise_model.pkl',
        popularity_data_paths={ 
            'package': 'recommender/artifacts/month_package_popularity.csv',
            'addon': 'recommender/artifacts/month_addon_popularity.csv',
            'cooccurrence': 'recommender/artifacts/month_package_addon_cooccurrence.csv'
        },
        test_data_path='recommender/data/test_ratings.csv',
        full_data_path='recommender/data/surprise_ratings_booking.csv',
        output_path='recommender/results/evaluation_results.csv'
    )
    
    # Model comparison (optional)
    # compare_models(
    #     model_paths={
    #         'baseline': 'models/svd_baseline.pkl',
    #         'tuned': 'models/svd_tuned.pkl'
    #     },
    #     test_data_path='data/test_ratings.csv',
    #     full_data_path='data/all_ratings.csv',
    #     popularity_path='artifacts/popularity.pkl'
    # )