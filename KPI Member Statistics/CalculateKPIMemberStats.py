import pandas as pd
import csv

# Load the main data from the CSV file
file_path = './-generated-2025-01-21-13-55-12.csv'
data = pd.read_csv(file_path)

# Load the joiners data from the provided spreadsheet without headers and assign column names
joiners_file_path = './new-members-01-07-2023-to-30-09-2024-generated-2025-01-21-17-29-59.csv'
joiners_data = pd.read_csv(joiners_file_path, header=None, names=["Forename", "Surname", "Membership ID", "Joining Date", "Category", "Address", "Phone", "Email"])

# Convert "Joining Date" and "Date of change" to datetime objects
joiners_data["Joining Date"] = pd.to_datetime(joiners_data["Joining Date"], format='%Y-%m-%d', errors='coerce')
data["Date of change"] = pd.to_datetime(data["Date of change"])

# Define the cutoff date
cutoff_date = '2024-09-30'

# Split the datasets into "before or on the cutoff date" and "after the cutoff date"
data_before = data[data["Date of change"] <= cutoff_date]
data_after = data[data["Date of change"] > cutoff_date]

joiners_before = joiners_data[joiners_data["Joining Date"] <= cutoff_date]
joiners_after = joiners_data[joiners_data["Joining Date"] > cutoff_date]

# Define a function to calculate metrics for a given dataset
def calculate_metrics(filtered_data, joiners_data_subset, cutoff_date=None):
    grouped = filtered_data.groupby("Membership ID").apply(lambda group: group.sort_values("Date of change")).reset_index(drop=True)

    exclude_keywords = ['1894', 'Corporate', 'Staff', 'Professional']
    filtered_data = grouped[
        ~grouped['From Category'].str.contains('|'.join(exclude_keywords), case=False, na=False) &
        ~grouped['To Category'].str.contains('|'.join(exclude_keywords), case=False, na=False)
    ]

    deceased_count = filtered_data[(filtered_data['From Status'] == 'R') & (filtered_data['To Status'] == 'D')]["Membership ID"].nunique()

    playing_member_categories = [
        '5MN - Gent 5 Day (N)', '7MN - Gent 7 Day (N)', 'MX - Student', 'Intermediate 24',
        '5MA - Gent 5 Day (A)', '6FASC - Lady 6 Day (A)(S)(C)', '6MA - Gent 6 Day (A)', 'Intermediate 28',
        'Intermediate 22', '7MA - Gent 7 Day (A)', 'Intermediate 26', '5FA - Lady 5 Day (A)',
        '6MN - Gent 6 Day (N)', 'Intermediate 29', 'Intermediate 23', '6FN - Lady 6 Day (N)',
        'Intermediate 25', '7FN - Lady 7 Day (N)', 'Intermediate 27', '6FAC - Lady 6 Day (A)(C)',
        '5FAS - Lady 5 Day (A)(S)'
    ]

    left_playing_members = filtered_data[
        (filtered_data['From Status'] == 'R') &
        (filtered_data['From Category'].isin(playing_member_categories)) &
        (~filtered_data['To Status'].isin(['R', 'D']))
    ]
    left_playing_members_count = left_playing_members["Membership ID"].nunique()

    playing_to_social_members_count = filtered_data[
        (filtered_data['From Category'].isin(playing_member_categories)) &
        (filtered_data['From Status'] == 'R') &
        (filtered_data['To Category'].str.contains('Social|House', case=False, na=False) & 
        (filtered_data['To Status'] == 'R'))
    ]["Membership ID"].nunique()

    non_playing_to_playing_members_count = filtered_data[
        (~filtered_data['From Category'].isin(playing_member_categories)) &
        (filtered_data['From Status'] == 'R') &
        (filtered_data['To Category'].isin(playing_member_categories)) &
        (filtered_data['To Status'] == 'R')
    ]["Membership ID"].nunique()

    joiners_as_playing_members_count = joiners_data_subset[
        joiners_data_subset['Category'].isin(playing_member_categories)
    ]["Membership ID"].nunique()

    return {
        "deceased_count": deceased_count,
        "left_playing_members_count": left_playing_members_count,
        "playing_to_social_members_count": playing_to_social_members_count,
        "non_playing_to_playing_members_count": non_playing_to_playing_members_count,
        "joiners_as_playing_members_count": joiners_as_playing_members_count
    }

# Metrics before and after cutoff
metrics_before = calculate_metrics(data_before, joiners_before, cutoff_date='2024-09-30')
metrics_after = calculate_metrics(data_after, joiners_after, cutoff_date='2024-09-30')

# Output metrics for both periods
print("\nMetrics BEFORE cutoff date (up to and including 30 September 2024):")
for metric, value in metrics_before.items():
    print(f"{metric}: {value}")

print("\nMetrics AFTER cutoff date (after 30 September 2024):")
for metric, value in metrics_after.items():
    print(f"{metric}: {value}")

# NEW FUNCTION: Generate daily playing member stats
def generate_daily_playing_member_stats(data, joiners_data, output_file):
    unique_dates = sorted(data["Date of change"].dropna().unique())
    records = []
    
    for current_date in unique_dates:
        filtered_data = data[data["Date of change"] <= current_date]
        joiners_data_subset = joiners_data[joiners_data["Joining Date"] <= current_date]
        
        metrics = calculate_metrics(filtered_data, joiners_data_subset)
        
        records.append([
            current_date.strftime('%Y-%m-%d'),
            metrics.get("joiners_as_playing_members_count", 0),
            metrics.get("left_playing_members_count", 0),
            metrics.get("playing_to_social_members_count", 0),
            metrics.get("non_playing_to_playing_members_count", 0)
        ])
    
    with open(output_file, mode='w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(["Date", "Total Playing Members", "Left Playing Members", "Playing to Social", "Non-Playing to Playing"])
        writer.writerows(records)

# Call the function to generate the CSV
generate_daily_playing_member_stats(data, joiners_data, "playing_member_stats.csv")

print("CSV file 'playing_member_stats.csv' has been created with daily playing member statistics.")
