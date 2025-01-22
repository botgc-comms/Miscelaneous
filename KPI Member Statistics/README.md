# Script Logic for Calculating Member Metrics

![Example Output](screenshot.png)


This script processes two datasets:
1. **Events Dataset**: Contains member event records, such as membership changes (e.g., status updates, category changes).
2. **Joiners Dataset**: Contains information about members who joined the club, including their join date.

The script applies several **filters**, **conditions**, and **logic rules** to calculate metrics and classify members into different categories, ensuring accurate reporting based on well-defined criteria.

---

## Reporting from IG

The above data is retrieved by running the Joiners and Category Change reports from within IG. These can be found here:

[Category Changes Report](https://www.botgc.co.uk/membership_reports.php?tab=categorychanges)
[New Members Report](https://www.botgc.co.uk/membership_reports.php?tab=newmembers)

## Key Components of the Script Logic

### 1. **How Event Data is Processed**

The **Events Dataset** is the core of the script, as it tracks all changes to a member's **status** and **category** over time. The following steps are applied to process this data:

1. **Data Filtering**:
   - Unnecessary columns are removed to simplify processing.
   - Rows with certain keywords in the "From Category" or "To Category" (e.g., "1894", "Corporate", "Staff", "Professional") are excluded to focus on relevant membership changes.
     ```python
     filtered_data = grouped[
         ~grouped['From Category'].str.contains('|'.join(exclude_keywords), case=False, na=False) &
         ~grouped['To Category'].str.contains('|'.join(exclude_keywords), case=False, na=False)
     ]
     ```

2. **Sorting by Member ID and Date**:
   - The dataset is grouped by **Membership ID**, and all rows for each member are sorted chronologically based on the **Date of Change** column. This ensures we can identify the earliest and latest events for each member.

3. **Exclusion of Events Before the Join Date**:
   - Any events that occur **before a member's join date** (retrieved from the Joiners Dataset) are excluded. This ensures that pre-join events (e.g., suspensions) do not impact a member's classification as a **joiner** or **leaver**.

   Example:
   ```python
   member_events = member_events[member_events['Date of change'] >= joining_date]
   ```

4. **Grouping by Member**:
   - After filtering and sorting, we group the dataset by **Membership ID** to calculate metrics based on transitions and status changes. For each member:
     - The **earliest event** provides the starting **From Status** and **From Category**.
     - The **latest event** provides the ending **To Status** and **To Category**.

---

### 2. **Cooling-Off Period Logic**

The **cooling-off period** is defined as **1 month (30 days)** after a member joins. Members who leave or transition to a non-"R" status (e.g., suspended or left) within this period are excluded from both the **joiners** and **leavers** counts.

#### How Cooling-Off Period Logic Works:
1. We compare the member's **join date** (from the Joiners Dataset) with their **leave date** (from the Events Dataset).
2. If the difference between the **join date** and the **leave date** is less than 30 days, the member is flagged as having left during the cooling-off period.

#### Handling Members Who Left in the Cooling-Off Period:
- These members are excluded from both the **joiners** and **leavers** metrics to ensure they are not counted in either category.
- Members who leave but later **rejoin** are excluded from the leavers count but may still be counted as joiners.

---

### 3. **Leavers**

A member is considered a **leaver** if:
1. Their **From Status** is "R" (current).
2. Their **To Status** is not "R" or "D" (i.e., they left, were suspended, or transitioned to a non-active status).
3. They are not in the Joiners Dataset (i.e., they are not new members who joined recently).

#### Excluding Joiners from Leavers:
- Members who appear in the Joiners Dataset are **excluded from the leavers count** to ensure that new members who leave shortly after joining are not incorrectly classified as leavers.

---

### 4. **Joiners**

A **joiner** is defined as any member who:
1. Appears in the **Joiners Dataset** with a valid join date.
2. Does not leave within the cooling-off period.

#### Joiners Filtering:
- Members who leave within the cooling-off period are excluded from the joiners count.

---

### 5. **Event-Based Transitions**

The script calculates several metrics based on specific transitions in the **From Category**, **To Category**, **From Status**, and **To Status**:

1. **Playing Members Transitioning to Social Membership**:
   - Members whose **From Category** indicates a playing membership (e.g., "7MN - Gent 7 Day (N)") and whose **To Category** contains "Social" or "House".

2. **7-Day Playing Members Moving to 6-Day Membership**:
   - Members whose **From Category** indicates a 7-day playing membership (e.g., starts with "7" or includes "Intermediate") and whose **To Category** indicates a 6-day playing membership (e.g., starts with "6").

3. **Other Transitions**:
   - Metrics for other specific transitions (e.g., 7-day to 5-day, 6-day to 5-day) are calculated in a similar manner.

---

### 6. **Handling Rejoined Members**

Members who rejoin after leaving are carefully handled:
- If a member leaves and then **rejoins** (indicated by a "From Status" transitioning to "R"), they are:
  - Excluded from the **leavers count**.
  - Included in the **joiners count** if the rejoining occurs after the cooling-off period.

---

## Summary of Exclusions and Filters

1. **Excluding Events Before Join Date**:
   - Events before the join date are excluded from processing.

2. **Excluding Members Who Leave in Cooling-Off Period**:
   - Members who leave within 30 days of joining are excluded from both the joiners and leavers counts.

3. **Handling Rejoined Members**:
   - Members who rejoin are excluded from the leavers count but included in the joiners count.

---

This explanation provides an overview of all relevant aspects of the script logic, ensuring clarity and consistency in how members are classified and metrics are calculated.
