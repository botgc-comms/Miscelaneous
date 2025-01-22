import pandas as pd

# Load the main data from the CSV file
file_path = './-generated-2025-01-21-13-55-12.csv'
data = pd.read_csv(file_path)

# Load the joiners data from the provided spreadsheet without headers and assign column names
joiners_file_path = './new-members-01-07-2023-to-30-09-2024-generated-2025-01-21-17-29-59.csv'
joiners_data = pd.read_csv(joiners_file_path, header=None, names=["Forename", "Surname", "Membership ID", "Joining Date", "Category", "Address", "Phone", "Email"])

# Convert "Joining Date" to a datetime object using the known format YYYY-MM-DD
joiners_data["Joining Date"] = pd.to_datetime(joiners_data["Joining Date"], format='%Y-%m-%d', errors='coerce')

# Drop any rows with invalid dates in the "Joining Date" column
joiners_data = joiners_data.dropna(subset=["Joining Date"])

# Remove unnecessary columns for clarity and processing
data = data[["Date of change", "Forename", "Surname", "Membership ID", 
             "From Category", "From Status", "To Category", "To Status"]]

# Convert "Date of change" to a datetime object for sorting
data["Date of change"] = pd.to_datetime(data["Date of change"])

# Group by "Membership ID" and sort each group by "Date of change"
grouped = data.groupby("Membership ID").apply(lambda group: group.sort_values("Date of change")).reset_index(drop=True)

# Define the list of keywords to filter out
exclude_keywords = ['1894', 'Corporate', 'Staff', 'Professional']

# Filter out rows where "From Category" or "To Category" contains any of the keywords
filtered_data = grouped[~grouped['From Category'].str.contains('|'.join(exclude_keywords), case=False, na=False) &
                        ~grouped['To Category'].str.contains('|'.join(exclude_keywords), case=False, na=False)]

# Identify cooling-off members who joined and transitioned within 1 month
cooling_off_members = []
already_rejoined_members = []  # Track rejoined members

# Iterate over the joiners to process each one
for idx, joiner in joiners_data.iterrows():
    joining_date = joiner['Joining Date']
    membership_id = joiner['Membership ID']
    
    # Filter the events for this member and exclude any events before the joining date
    member_events = filtered_data[filtered_data['Membership ID'] == membership_id]
    member_events = member_events[member_events['Date of change'] >= joining_date]
    
    # Check if the member has at least one event (must have left)
    if len(member_events) == 0:
        continue
    
    # Get the earliest and latest events for the member
    first_event = member_events.iloc[0]
    last_event = member_events.iloc[-1]
    
    # Take the From Status from the first record and To Status from the last record
    from_status = first_event['From Status']
    to_status = last_event['To Status']
    
    # If the From Status is 'R' and the To Status is neither 'R' nor 'D', it means they left
    if from_status == 'R' and to_status not in ['R', 'D']:
        # Check if the leave date (last_event date) is within 1 month of the joining date
        days_between = (last_event['Date of change'] - joining_date).days
        
        # This ensures we only flag someone as leaving within the cooling-off period if the leave event happened within 1 month
        if days_between <= 50:
            cooling_off_members.append({
                'Membership ID': membership_id,
                'Join Date': joining_date,
                'Date Left': last_event['Date of change'],
                'Forename': joiner['Forename'],
                'Surname': joiner['Surname']
            })
    
    # If the member rejoined, mark them as rejoined
    if to_status == 'R' and from_status != 'R':  # If they rejoined (transition from any status to R)
        already_rejoined_members.append(membership_id)

# Create a DataFrame for cooling-off members with the details
cooling_off_members_df = pd.DataFrame(cooling_off_members)

# Exclude cooling-off members and rejoined members from both datasets
filtered_data = filtered_data[~filtered_data['Membership ID'].isin(cooling_off_members_df['Membership ID'])]
filtered_data = filtered_data[~filtered_data['Membership ID'].isin(already_rejoined_members)]
joiners_data = joiners_data[~joiners_data['Membership ID'].isin(cooling_off_members_df['Membership ID'])]
joiners_data = joiners_data[~joiners_data['Membership ID'].isin(already_rejoined_members)]

# Count the remaining joiners (excluding those who left within the cooling-off period)
joiners_after_filter = joiners_data[~joiners_data['Membership ID'].isin(already_rejoined_members)]
print(f"Number of joiners after filtering those who left within cooling-off period: {joiners_after_filter.shape[0]}")

# Define a filter for members who were "R" (current) and transitioned to "D" (deceased)
deceased_transitions = filtered_data[(filtered_data['From Status'] == 'R') & (filtered_data['To Status'] == 'D')]

# Count how many unique membership IDs were part of this transition
deceased_count = deceased_transitions["Membership ID"].nunique()

# Define the list of playing member categories
playing_member_categories = [
    '5MN - Gent 5 Day (N)', '7MN - Gent 7 Day (N)', 'MX - Student', 'Intermediate 24', 
    '5MA - Gent 5 Day (A)', '6FASC - Lady 6 Day (A)(S)(C)', '6MA - Gent 6 Day (A)', 'Intermediate 28',
    'Intermediate 22', '7MA - Gent 7 Day (A)', 'Intermediate 26', '5FA - Lady 5 Day (A)', 
    '6MN - Gent 6 Day (N)', 'Intermediate 29', 'Intermediate 23', '6FN - Lady 6 Day (N)', 
    'Intermediate 25', '7FN - Lady 7 Day (N)', 'Intermediate 27', '6FAC - Lady 6 Day (A)(C)', 
    '5FAS - Lady 5 Day (A)(S)'
]

# Filter for "playing members" who were "R" (current) and transitioned to any status other than "R" or "D"
left_playing_members = filtered_data[
    (filtered_data['From Status'] == 'R') & 
    (filtered_data['From Category'].isin(playing_member_categories)) & 
    (~filtered_data['To Status'].isin(['R', 'D']))
]

# Exclude anyone who is in the joiners dataset from the "left playing members" calculation
left_playing_members = left_playing_members[~left_playing_members['Membership ID'].isin(joiners_data['Membership ID'].values)]

# Count how many unique membership IDs were part of this transition
left_playing_members_count = left_playing_members["Membership ID"].nunique()

# Filter for playing members who moved to social membership
social_membership_keywords = ["Social", "House"]
playing_to_social_members = filtered_data[
    (filtered_data['From Category'].isin(playing_member_categories)) & 
    (filtered_data['From Status'] == 'R') & 
    (filtered_data['To Category'].str.contains('|'.join(social_membership_keywords), case=False, na=False)) & 
    (filtered_data['To Status'] == 'R')
]

# Count how many unique membership IDs moved to social membership
playing_to_social_members_count = playing_to_social_members["Membership ID"].nunique()

# Filter for 7-day playing members transitioning to 6-day membership
seven_to_six_members = filtered_data[
    (filtered_data['From Category'].str.startswith('7')) &
    (filtered_data['From Status'] == 'R') &
    (filtered_data['To Category'].str.startswith('6')) &
    (filtered_data['To Status'] == 'R')
]

# Count how many unique membership IDs transitioned from 7-day to 6-day
seven_to_six_members_count = seven_to_six_members["Membership ID"].nunique()

# Filter for 7-day playing members transitioning to 5-day membership
seven_to_five_members = filtered_data[
    (filtered_data['From Category'].str.startswith('7') | 
     filtered_data['From Category'].str.contains('Intermediate') | 
     filtered_data['From Category'].str.contains('MX')) &
    (filtered_data['From Status'] == 'R') &
    (filtered_data['To Category'].str.startswith('5')) &
    (filtered_data['To Status'] == 'R')
]

# Count how many unique membership IDs transitioned from 7-day to 5-day
seven_to_five_members_count = seven_to_five_members["Membership ID"].nunique()

# Filter for 6-day playing members transitioning to 5-day membership
six_to_five_members = filtered_data[
    (filtered_data['From Category'].str.startswith('6')) &
    (filtered_data['From Status'] == 'R') &
    (filtered_data['To Category'].str.startswith('5')) &
    (filtered_data['To Status'] == 'R')
]

# Count how many unique membership IDs transitioned from 6-day to 5-day
six_to_five_members_count = six_to_five_members["Membership ID"].nunique()

# Filter for non-playing members transitioning to playing membership
non_playing_to_playing_members = filtered_data[
    (~filtered_data['From Category'].isin(playing_member_categories)) &
    (filtered_data['From Status'] == 'R') &
    (filtered_data['To Category'].isin(playing_member_categories)) &
    (filtered_data['To Status'] == 'R')
]

# Count how many unique membership IDs transitioned from non-playing to playing membership
non_playing_to_playing_members_count = non_playing_to_playing_members["Membership ID"].nunique()

# Additional Metric: Count the joiners who joined as playing members
joiners_as_playing_members = joiners_data[
    joiners_data['Category'].isin(playing_member_categories)
]

# Count how many unique membership IDs joined as playing members
joiners_as_playing_members_count = joiners_as_playing_members["Membership ID"].nunique()

# Output the metrics
print(f"Number of members who transitioned from 'R' (current) to 'D' (deceased): {deceased_count}")
print(f"Number of playing members who transitioned from 'R' (current) to 'left' (any non-'R' or 'D' status): {left_playing_members_count}")
print(f"Number of playing members who moved to social membership: {playing_to_social_members_count}")
print(f"Number of 7-day playing members who transitioned to 5-day membership: {seven_to_five_members_count}")
print(f"Number of 7-day playing members who transitioned to 6-day membership: {seven_to_six_members_count}")
print(f"Number of 6-day playing members who transitioned to 5-day membership: {six_to_five_members_count}")
print(f"Number of non-playing members who transitioned to playing membership: {non_playing_to_playing_members_count}")
print(f"Number of joiners (excluding those in the cooling-off period): {joiners_data.shape[0]}")
print(f"Members ignored due to joining and leaving within cooling-off period:")
print(f"Number of joiners who joined as playing members: {joiners_as_playing_members_count}")
print(f"Members ignored due to joining and leaving within cooling-off period:")

# Output the members ignored due to joining and leaving within cooling-off period, with Join Date and Date Left
print(cooling_off_members_df[['Forename', 'Surname', 'Membership ID', 'Join Date', 'Date Left']])