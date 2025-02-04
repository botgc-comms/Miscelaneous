import pandas as pd

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
    # Group by "Membership ID" and sort each group by "Date of change"
    grouped = filtered_data.groupby("Membership ID").apply(lambda group: group.sort_values("Date of change")).reset_index(drop=True)

    # Define keywords and filter out irrelevant categories
    exclude_keywords = ['1894', 'Corporate', 'Staff', 'Professional']
    filtered_data = grouped[
        ~grouped['From Category'].str.contains('|'.join(exclude_keywords), case=False, na=False) &
        ~grouped['To Category'].str.contains('|'.join(exclude_keywords), case=False, na=False)
    ]

    # Logic for identifying cooling-off members
    cooling_off_members = []
    already_rejoined_members = []

    for idx, joiner in joiners_data_subset.iterrows():
        joining_date = joiner['Joining Date']
        membership_id = joiner['Membership ID']

        member_events = filtered_data[filtered_data['Membership ID'] == membership_id]
        member_events = member_events[member_events['Date of change'] >= joining_date]

        if len(member_events) == 0:
            continue

        first_event = member_events.iloc[0]
        last_event = member_events.iloc[-1]

        from_status = first_event['From Status']
        to_status = last_event['To Status']

        if from_status == 'R' and to_status not in ['R', 'D']:
            days_between = (last_event['Date of change'] - joining_date).days
            if days_between <= 50:
                cooling_off_members.append({
                    'Membership ID': membership_id,
                    'Join Date': joining_date,
                    'Date Left': last_event['Date of change'],
                    'Forename': joiner['Forename'],
                    'Surname': joiner['Surname']
                })

        if to_status == 'R' and from_status != 'R':
            already_rejoined_members.append(membership_id)

    # Ensure cooling_off_members_df always has the required structure
    cooling_off_members_df = pd.DataFrame(cooling_off_members, columns=['Membership ID', 'Join Date', 'Date Left', 'Forename', 'Surname'])

    # Assign cooling-off members to the correct period based on their join date
    if cutoff_date:
        cooling_off_members_df['Cutoff Period'] = cooling_off_members_df['Join Date'].apply(
            lambda x: 'Before' if x <= pd.to_datetime(cutoff_date) else 'After'
        )
        cooling_off_members_df = cooling_off_members_df[cooling_off_members_df['Cutoff Period'] == 'Before']

    # Exclude cooling-off members and rejoined members
    filtered_data = filtered_data[~filtered_data['Membership ID'].isin(cooling_off_members_df['Membership ID'])]
    joiners_data_subset = joiners_data_subset[~joiners_data_subset['Membership ID'].isin(cooling_off_members_df['Membership ID'])]
    joiners_data_subset = joiners_data_subset[~joiners_data_subset['Membership ID'].isin(already_rejoined_members)]

    # Define metrics
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
    left_playing_members = left_playing_members[~left_playing_members['Membership ID'].isin(joiners_data_subset['Membership ID'].values)]
    left_playing_members_count = left_playing_members["Membership ID"].nunique()

    playing_to_social_members_count = filtered_data[
        (filtered_data['From Category'].isin(playing_member_categories)) &
	(filtered_data['From Status'] == 'R') &
        (filtered_data['To Category'].str.contains('Social|House', case=False, na=False) & 
	(filtered_data['To Status'] == 'R'))
    ]["Membership ID"].nunique()

    seven_to_six_members_count = filtered_data[
        (filtered_data['From Category'].str.startswith('7')) &
        (filtered_data['From Status'] == 'R') &
        (filtered_data['To Category'].str.startswith('6')) &
        (filtered_data['To Status'] == 'R')
    ]["Membership ID"].nunique()

    seven_to_five_members_count = filtered_data[
        (filtered_data['From Category'].str.startswith('7') | 
         filtered_data['From Category'].str.contains('Intermediate') | 
         filtered_data['From Category'].str.contains('MX')) &
        (filtered_data['From Status'] == 'R') &
        (filtered_data['To Category'].str.startswith('5')) &
        (filtered_data['To Status'] == 'R')
    ]["Membership ID"].nunique()

    six_to_five_members_count = filtered_data[
        (filtered_data['From Category'].str.startswith('6')) &
        (filtered_data['From Status'] == 'R') &
        (filtered_data['To Category'].str.startswith('5')) &
        (filtered_data['To Status'] == 'R')
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
        "seven_to_five_members_count": seven_to_five_members_count,
        "seven_to_six_members_count": seven_to_six_members_count,
        "six_to_five_members_count": six_to_five_members_count,
        "non_playing_to_playing_members_count": non_playing_to_playing_members_count,
        "joiners_count": joiners_data_subset.shape[0],
        "joiners_as_playing_members_count": joiners_as_playing_members_count,
        "cooling_off_members": cooling_off_members_df
    }

# Metrics before and after cutoff
metrics_before = calculate_metrics(data_before, joiners_before, cutoff_date='2024-09-30')
metrics_after = calculate_metrics(data_after, joiners_after, cutoff_date='2024-09-30')

# Output metrics for both periods
print("\nMetrics BEFORE cutoff date (up to and including 30 September 2024):")
for metric, value in metrics_before.items():
    if metric == "cooling_off_members":
        print(f"{metric}:")
        print(value)
    else:
        print(f"{metric}: {value}")

print("\nMetrics AFTER cutoff date (after 30 September 2024):")
for metric, value in metrics_after.items():
    if metric == "cooling_off_members":
        print(f"{metric}:")
        print(value)
    else:
        print(f"{metric}: {value}")
