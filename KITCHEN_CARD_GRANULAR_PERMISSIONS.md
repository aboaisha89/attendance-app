# Kitchen card granular permissions and admin layout

- Added individual role visibility permissions for the Employees Currently in Kitchen card: title, current headcount, employee photo, employee name, branch, attendance status, check-in label, check-in time, and empty-state message.
- The parent `dashboard.kitchen` permission still controls the whole card.
- The API omits hidden card fields from the `kitchen` response for non-admin roles, in addition to the UI hiding those elements.
- Replaced the separate admin kitchen table with the same `KitchenStaffActivity` card used on the employee dashboard, including employee photos and the same layout.
- Admin dashboard receives the live `kitchen` snapshot data from the existing API.
