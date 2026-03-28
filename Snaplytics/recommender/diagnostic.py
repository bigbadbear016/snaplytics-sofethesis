"""
Split-aware diagnostic script for recommender system data.

This script explicitly distinguishes between:
1. Full dataset statistics (descriptive only)
2. Train split statistics (what the model can learn)
3. Test split statistics (what can actually be evaluated)

This avoids the common mistake of assuming full-dataset interaction counts
carry over to evaluation after temporal splitting.
"""

import pandas as pd
import numpy as np

# -----------------------------------------------------------------------------
# Utility functions
# -----------------------------------------------------------------------------

def interaction_stats(df: pd.DataFrame, label: str):
    print("\n" + "=" * 70)
    print(f"{label.upper()} USER INTERACTION DISTRIBUTION")
    print("=" * 70)

    user_counts = df.groupby('user_id').size()

    print(f"Total interactions: {len(df)}")
    print(f"Total users: {user_counts.shape[0]}")
    print(f"Min interactions per user: {user_counts.min()}")
    print(f"Max interactions per user: {user_counts.max()}")
    print(f"Mean interactions per user: {user_counts.mean():.2f}")
    print(f"Median interactions per user: {user_counts.median():.0f}")

    print("\nUsers by number of interactions:")
    for i in [1, 2, 3, 4, 5]:
        count = (user_counts == i).sum()
        pct = count / len(user_counts) * 100
        print(f"  {i} interaction(s): {count:4d} users ({pct:5.1f}%)")

    count_6plus = (user_counts >= 6).sum()
    pct_6plus = count_6plus / len(user_counts) * 100
    print(f"  6+ interactions: {count_6plus:4d} users ({pct_6plus:5.1f}%)")

    # 🔹 ADD THIS BLOCK
    if 'booking_id' in df.columns:
        booking_counts = df.groupby('user_id')['booking_id'].nunique()
        print("\nBOOKING-LEVEL DIAGNOSTIC")
        print(f"  Min bookings per user: {booking_counts.min()}")
        print(f"  Max bookings per user: {booking_counts.max()}")
        print(f"  Mean bookings per user: {booking_counts.mean():.2f}")
        print(f"  Median bookings per user: {booking_counts.median():.0f}")

    return user_counts



def evaluation_eligibility(user_counts: pd.Series, label: str):
    """Report how many users are eligible for evaluation under common filters."""
    print("\n" + "-" * 70)
    print(f"{label.upper()} USERS ELIGIBLE FOR EVALUATION")
    print("-" * 70)

    total_users = len(user_counts)
    for k in [1, 2, 3, 4, 5]:
        eligible = (user_counts >= k).sum()
        pct = eligible / total_users * 100
        status = "✓ Enough" if eligible >= 50 else "✗ Too few"
        print(f"  ≥{k} interactions: {eligible:4d} users ({pct:5.1f}%) - {status}")


def cold_start_assessment(user_counts: pd.Series, label: str):
    """Assess cold-start severity based on interaction counts."""
    print("\n" + "=" * 70)
    print(f"{label.upper()} COLD-START ASSESSMENT")
    print("=" * 70)

    total = len(user_counts)
    u1 = (user_counts == 1).sum()
    u2 = (user_counts == 2).sum()
    u3p = (user_counts >= 3).sum()

    print(f"1 interaction only:  {u1:4d} ({u1/total*100:5.1f}%)")
    print(f"2 interactions:      {u2:4d} ({u2/total*100:5.1f}%)")
    print(f"3+ interactions:     {u3p:4d} ({u3p/total*100:5.1f}%)")

    if u1 / total > 0.7:
        print("\n🔴 SEVERE COLD-START")
        print("   Most users have only one interaction")
        print("   Evaluation metrics will be unstable")
    elif u1 / total > 0.5:
        print("\n🟡 MODERATE COLD-START")
        print("   Many users have minimal signal")
    else:
        print("\n🟢 MANAGEABLE COLD-START")
        print("   Sufficient interaction history for most users")


# -----------------------------------------------------------------------------
# Main diagnostic logic
# -----------------------------------------------------------------------------

def split_aware_diagnostics(full_file: str, train_file: str, test_file: str):
    print("\n🔍 SPLIT-AWARE DATA DIAGNOSTIC")
    print("=" * 70)

    # --------------------
    # Load data
    # --------------------
    full_df = pd.read_csv(full_file)
    train_df = pd.read_csv(train_file)
    test_df = pd.read_csv(test_file)

    # --------------------
    # Full dataset (descriptive only)
    # --------------------
    full_user_counts = interaction_stats(full_df, "Full dataset")

    # --------------------
    # Train split (learning capacity)
    # --------------------
    train_user_counts = interaction_stats(train_df, "Train split")
    cold_start_assessment(train_user_counts, "Train split")

    # --------------------
    # Test split (evaluation reality)
    # --------------------
    test_user_counts = interaction_stats(test_df, "Test split")
    cold_start_assessment(test_user_counts, "Test split")
    evaluation_eligibility(test_user_counts, "Test split")

    # --------------------
    # Key takeaway
    # --------------------
    print("\n" + "=" * 70)
    print("KEY INTERPRETATION")
    print("=" * 70)
    print("• Full dataset density does NOT reflect evaluation conditions")
    print("• Train split determines what the model can learn")
    print("• Test split determines how many users can be fairly evaluated")
    print("• Always report interaction thresholds on the TEST split")


# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------

if __name__ == "__main__":
    split_aware_diagnostics(
        full_file="recommender/data/train_ratings_with_neg.csv",
        train_file="recommender/data/train_ratings.csv",
        test_file="recommender/data/test_ratings.csv",
    )
