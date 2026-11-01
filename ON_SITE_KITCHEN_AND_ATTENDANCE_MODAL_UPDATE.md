# On Site, Kitchen Dashboard and Attendance Edit Modal

- On Site wallboard is constrained to the available viewport height and uses compact responsive employee cards for tablet/TV display; scrolling is disabled in the wallboard area.
- Added an `Employees Currently in Kitchen` section below the admin dashboard's Employee Attendance Monitor. It lists active employees with open attendance sessions and their current break/check-in status.
- Admin can hide/show the kitchen section. This preference is saved in the current browser's local storage.
- Replaced browser prompt-based Check-in/Check-out editing with an in-app modal using native date-and-time pickers (`datetime-local`). The correction reason remains required and is saved through the existing audited admin endpoint.
- Check-out can be left blank to keep the attendance session open.

Validation: source updated. `npm run typecheck` and `npm run build` were not run because dependencies (`node_modules`) are not included in the supplied archive.
