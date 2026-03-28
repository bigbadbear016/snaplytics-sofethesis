import pandas as pd
from sklearn.model_selection import train_test_split


SRC = "recommender/data/surprise_ratings_booking.csv"
TRAIN = "recommender/data/train_ratings.csv"
TEST = "recommender/data/test_ratings.csv"


# Load interactions
df = pd.read_csv(SRC, parse_dates=['session_date'])


# Unique bookings
booking_ids = df['booking_id'].unique()


train_b, test_b = train_test_split(booking_ids, test_size=0.2, random_state=42)


train_df = df[df['booking_id'].isin(train_b)]
test_df = df[df['booking_id'].isin(test_b)]


# Drop booking_id + time for Surprise
train_df = train_df[['user_id', 'item_id', 'rating']]
test_df = test_df[['user_id', 'item_id', 'rating']]


train_df.to_csv(TRAIN, index=False)
test_df.to_csv(TEST, index=False)


print("Train rows:", len(train_df))
print("Test rows:", len(test_df))