# Employees Currently in Kitchen – empty list fix

The snapshot endpoint already filters the kitchen dataset to active employees with an open attendance session (`check_out IS NULL`). The UI then incorrectly filtered the mapped rows again using `p.status === 'active'`, although the API intentionally omitted the employee `status` field from the UI payload. This made every valid row disappear.

Updated `KitchenStaffActivity` to render and sort all rows supplied by the snapshot endpoint. The database query remains responsible for filtering active employees with open check-in sessions.
