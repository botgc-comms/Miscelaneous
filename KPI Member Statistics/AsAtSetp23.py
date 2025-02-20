import pandas as pd

# Load the main membership data
file_path = './-generated-2025-01-21-13-55-12.csv'
data = pd.read_csv(file_path)

# Load the joiners data
joiners_file_path = './new-members-01-07-2023-to-30-09-2024-generated-2025-01-21-17-29-59.csv'
joiners_data = pd.read_csv(joiners_file_path, header=None, names=[
    "Forename", "Surname", "Membership ID", "Joining Date", "Category", "Address", "Phone", "Email"
])

# Convert date columns
data["Date of change"] = pd.to_datetime(data["Date of change"])
joiners_data["Joining Date"] = pd.to_datetime(joiners_data["Joining Date"])

# Define the cutoff date
cutoff_date = pd.to_datetime("2023-09-30")

# Filter events up to 30/09/2023
data_before_cutoff = data[data["Date of change"] <= cutoff_date]

# Define playing member categories (unchanged)
playing_member_categories = [
    "5MN - Gent 5 Day (N)", "7MN - Gent 7 Day (N)", "MX - Student", "Intermediate 24",
    "5MA - Gent 5 Day (A)", "6FASC - Lady 6 Day (A)(S)(C)", "6MA - Gent 6 Day (A)", "Intermediate 28",
    "Intermediate 22", "7MA - Gent 7 Day (A)", "Intermediate 26", "5FA - Lady 5 Day (A)",
    "6MN - Gent 6 Day (N)", "Intermediate 29", "Intermediate 23", "6FN - Lady 6 Day (N)",
    "Intermediate 25", "7FN - Lady 7 Day (N)", "Intermediate 27", "6FAC - Lady 6 Day (A)(C)",
    "5FAS - Lady 5 Day (A)(S)"
]

# Track the latest known membership state
latest_membership_state = {}

for _, row in data_before_cutoff.iterrows():
    member_id = row["Membership ID"]
    date_of_change = row["Date of change"]
    to_category = row["To Category"]  # **Fixed column name**
    to_status = row["To Status"]  # **Fixed column name**

    if member_id not in latest_membership_state or date_of_change > latest_membership_state[member_id]["Date of change"]:
        latest_membership_state[member_id] = {
            "Membership ID": member_id,
            "Forename": row["Forename"],
            "Surname": row["Surname"],
            "Category": to_category,  # **Changed to match joiners data**
            "Status": to_status,  # **Changed to match joiners data**
            "Date of change": date_of_change,
        }

# Convert dictionary back into a DataFrame
historical_members_df = pd.DataFrame(latest_membership_state.values())

# Keep joiners who joined before or on 30/09/2023
joiners_before_cutoff = joiners_data[joiners_data["Joining Date"] <= cutoff_date]

# Merge joiners data with historical membership data
final_members_df = pd.concat([historical_members_df, joiners_before_cutoff], ignore_index=True)

# **Ensure column names match**
if "Category" in final_members_df.columns and "Status" in final_members_df.columns:
    playing_members_as_of_cutoff = final_members_df[
        (final_members_df["Category"].isin(playing_member_categories)) &
        (final_members_df["Status"] == "R")  # Active members only
    ]
else:
    raise KeyError("Missing required columns in final_members_df. Check column names.")

# **Export to CSV (Only change)**
output_file = "playing_members_as_of_30_09_2023.csv"
playing_members_as_of_cutoff.to_csv(output_file, index=False)

print(f"✅ CSV file created: {output_file}")
