# V10 – Employee overview and employee requests

- Replaced the Employee Leave Management card on the Employees page with three summary cards: Total Employees, Active Employees, and Pending Employees.
- Employee counts exclude Administrator and Display accounts.
- Requests is now an employee self-service workflow: employees can submit and track their own requests; administrators receive the employee requests and can approve, reject, edit, or delete them.
- Administrators can create a request on behalf of a selected employee, but cannot create a personal request. Employees can only submit requests for themselves. The API validates the target employee and prevents requests for administrator or display accounts.
- The employee leave records API remains available for existing attendance/calendar functionality; only the old leave-management card was removed from the Employees page.
