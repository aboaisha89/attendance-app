# Custom roles, faster refresh, refreshed design

## Custom roles (Admin > Permissions > Add role)
- Create any number of roles. Each has an access level:
  - **Staff**: sees/punches own attendance only (page set is configurable).
  - **Manager**: sees all employees; can be granted Employees, Branches, Shifts, Geofences, Requests, Announcements, Settings, Reports. Cannot punch.
- The Employee form now lists all roles. Permissions are enforced on the server per page (not just hidden in the UI).
- Only an Administrator can: create/edit/delete roles, assign or modify Administrator accounts.
- A role in use cannot be deleted. Built-in roles (admin, employee, display) cannot be deleted.
- Database: the old role CHECK constraint is dropped automatically; `role_access` gains `label` and `scope` columns (additive migration, runs on first request).

## Speed
- The page no longer reloads ~10 endpoints every 3 seconds. It polls one tiny `GET /api/version` every 4 s (only while the tab is visible) and reloads data only when something changed.
- Announcements poll every 30 s (plus immediately on change/focus).
- Session + role lookups merged into one query; snapshot queries run in parallel; stale-session sweep throttled to once per minute for polling.
- New DB indexes on attendance_sessions / requests / employees.
- Fonts/Leaflet CSS no longer block first paint (Leaflet CSS loads only with the map).

## Design
- New `src/app/theme.css` (design tokens, buttons, inputs, cards, sticky table headers, modal as bottom-sheet on phones, wider layout on tablets/desktops, reduced-motion support).

## Deploy
Replace repository contents, push to main, check the Vercel build log (the build was NOT run in the authoring environment). Then test: admin, employee, a new Manager role, a new Staff role.

## Round 2 fixes
1. Dialogs are centred on all screen sizes.
2. Attendance history and recent activity list newest first.
3. Monthly attendance matrix: coloured per-day marks P / EL / OT / IN / A (absent) / L (approved leave), with legend. Days = present days only.
4. Notifications disappear once read (tap one, or Mark all read).
5. While on break the big punch button ends the break; the server also refuses check-out during a break (HTTP 409).
6. Approved requests (employee_leaves + approved requests) show as leave dots on the calendar and matrix; rejected/pending do not. Admin can edit dates/status and delete a request; the employee is notified of changes.
