import os
import pickle
import pandas as pd
from surprise import Dataset, Reader, SVDpp

RATINGS_CSV = "recommender/data/train_ratings.csv"
MODEL_PATH = "recommender/models/surprise_model.pkl"

def train_and_save(ratings_csv, model_path, n_factors=50, n_epochs=20):
    df = pd.read_csv(ratings_csv)
    if df.empty:
        raise RuntimeError("Ratings CSV is empty — cannot train.")
    reader = Reader(rating_scale=(0, 1))
    data = Dataset.load_from_df(df[['user_id', 'item_id', 'rating']], reader)
    trainset = data.build_full_trainset()
    algo = SVDpp(n_factors=n_factors, n_epochs=n_epochs, verbose=True)
    algo.fit(trainset)
    with open(model_path, "wb") as f:
        pickle.dump(algo, f)
    print("Saved model:", model_path)
    return algo

if __name__ == "__main__":
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    train_and_save(RATINGS_CSV, MODEL_PATH)