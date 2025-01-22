# Script Logic for Calculating Member Metrics

This script processes two datasets:
1. **Events Dataset**: Contains member event records, such as membership changes.
2. **Joiners Dataset**: Contains information about members who joined the club, including their join date.

The script applies filters, conditions, and logic to identify and process members based on their events and transitions. The following is a breakdown of the logic used in the script, specifically around **cooling-off periods** and the exclusion of members who joined and left within this period.

## Key Logic Details

### 1. Cooling-Off Period Definition
A **cooling-off period** is defined as **1 month (30 days)** after a member joins. If a member joins and leaves (or transitions to a non-"R" status) within this 30-day period, they are considered to have **left within the cooling-off period** and should **not** be counted as either a **joiner** or a **leaver**.

#### How Cooling-Off Period Logic is Handled:
1. **Join Date**: We retrieve the member’s **join date** from the **joiners dataset**.
2. **Leave Date**: We use the **event records** from the **events dataset** to determine if a member transitioned from "R" (current) to any status other than "R" or "D" (i.e., leaving or suspended).
3. **Date Comparison**: The **leave date** is compared with the **join date**. If the **leave date** is within 30 days of the **join date**, the member is flagged as having left within the cooling-off period and excluded from both the **joiners** and **leavers** counts.

This logic ensures that members who leave within the cooling-off period do not appear in either the **joiners count** or the **leavers count**.

---

### 2. Exclusion of Events Before the Join Date
To prevent members from being incorrectly identified as **leavers** or **joiners**, we exclude any event that occurred **before** the member’s **join date**.

#### Why This is Important:
- **Suspensions Before Join Date**: If a member was suspended before their **join date**, that event should not impact their classification as a leaver or joiner.
- **Event Filtering**: The script ensures that any **event** that occurs **before** the **join date** is excluded from processing:
  ```python
  member_events = member_events[member_events['Date of change'] >= joining_date]
  ```
  This means that if a member was suspended before officially joining, this suspension event is ignored in subsequent logic, ensuring they are only classified as **leavers** or **joiners** based on events **after their join date**.

This filtering effectively **mitigates** the issue where a member may have been suspended before joining and then incorrectly counted as a **leaver** or **joiner** based on earlier events.

---

### 3. Leavers (After Cooling-Off Period)
A member is considered a **leaver** if:
- They had a **From Status** of "R" (current).
- They transitioned to a **To Status** that is **not** "R" or "D" (i.e., they are no longer current or deceased).
- The member has not rejoined after leaving within the cooling-off period.

#### Leavers Logic:
1. **Leaver Identification**: We filter the event records to include only those members whose **From Status** is "R" (current) and whose **To Status** is neither "R" nor "D" (i.e., they left the membership).
2. **Excluding Joiners**: If the member appears in the **joiners dataset** after they left, they are excluded from the leavers count, as this indicates they rejoined after leaving.

---

### 4. Joiners (Excluding Those Who Left Within Cooling-Off Period)
A **joiner** is defined as any member who:
- Appears in the **joiners dataset** with a valid **join date**.
- Has not left within the cooling-off period (i.e., within 30 days after joining).

#### Joiners Logic:
1. **Joiners Filtering**: After applying the cooling-off period logic, members who **left within 30 days of joining** are excluded from the joiners count:
   ```python
   joiners_after_filter = joiners_data[~joiners_data['Membership ID'].isin(already_rejoined_members)]
   ```

2. **Counting Joiners**: Only members who did **not** leave within the cooling-off period are counted as joiners.

---

### 5. Handling Leavers Who Rejoined
Members who **leave** (during the cooling-off period or after) but later **rejoin** are handled carefully:
- If a member leaves but **rejoins** (indicated by a "From Status" transitioning to "R" again), they are **excluded from the leavers count** but may still appear as a **joiner** (if they rejoin after the cooling-off period).
- This prevents counting a member as a leaver if they came back soon after leaving.

---

### 6. Other Metrics:
The script also calculates other metrics based on specific **membership category transitions**, such as:
- **Playing members transitioning to social membership**.
- **7-day playing members moving to 6-day**.
- **7-day playing members moving to 5-day**.
- **6-day playing members moving to 5-day**.
- **Non-playing members transitioning to playing membership**.
- **Joiners who joined as playing members**.

These metrics are calculated by checking the **From Category** and **To Category** of the event records, filtering members based on their transitions, and counting the unique membership IDs for each transition.

---

### **Summary**:

- **Cooling-Off Period**: Members who leave within **30 days** of joining are excluded from both the **joiners count** and the **leavers count**.
- **Excluding Events Before the Join Date**: Any event that occurs before a member's **join date** is excluded from processing. This prevents any pre-join events (e.g., suspensions) from incorrectly affecting their status as a leaver or joiner.
- **Joiners**: Only members who joined and did **not** leave within the cooling-off period are counted as joiners.
- **Leavers**: Members who transition from "R" to a status other than "R" or "D" are counted as leavers, unless they rejoin after leaving within the cooling-off period.
- **Rejoined Members**: Members who rejoin after leaving within the cooling-off period are excluded from the leavers count but included in the joiners count.

---

This logic ensures that the **cooling-off period** and **member status transitions** are handled correctly and consistently, ensuring accurate reporting of joiners and leavers based on the defined criteria.
