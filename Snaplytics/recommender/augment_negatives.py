import pandas as pd
import random
from tqdm import tqdm


RATINGS_CSV = "recommender/data/surprise_ratings_booking.csv"
OUT_CSV = "recommender/data/train_ratings_with_neg.csv"
NEG_PER_USER = 2


# Load positives
df = pd.read_csv(RATINGS_CSV)


users = df['user_id'].unique().tolist()
items = df['item_id'].unique().tolist()


# Only sample package negatives
packages = [i for i in items if not i.startswith('addon::')]


pos = set(zip(df['user_id'], df['item_id']))


neg_rows = []
for u in tqdm(users):
    trials = 0
    negs = 0
    while negs < NEG_PER_USER and trials < 50:
        trials += 1
        item = random.choice(packages)
        if (u, item) not in pos:
            neg_rows.append({'user_id': u, 'item_id': item, 'rating': 0})
            negs += 1


neg_df = pd.DataFrame(neg_rows)
out = pd.concat([df, neg_df], ignore_index=True)
out = out.sample(frac=1, random_state=42).reset_index(drop=True)
out.to_csv(OUT_CSV, index=False)


print("WROTE", OUT_CSV, "rows:", len(out))