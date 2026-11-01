# Role visibility and pending account approval

- Added `dashboard.kitchen` to the role-based dashboard visibility controls. Administrators can enable or hide the Employees Currently in Kitchen card for each role from Permissions.
- The card is now rendered only when the signed-in role has that visibility permission. Full administrators retain access.
- Registration keeps new accounts in `pending` status. The login API verifies the password and returns a distinct pending status without issuing a session.
- The UI displays an Account Pending Approval screen after registration and when a pending user tries to sign in.
- Pending accounts cannot access protected application APIs until an administrator or authorized manager activates the account.
