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

## Round 3
- After sign-in (and sign-out) the app always opens the Dashboard (display accounts open On Site).
- Dashboard > Attendance Overview (last 6 days, today highlighted): green ✓ on time, orange EL left early, blue OT overtime, purple L leave (approved), red ✕ absent, yellow • in progress / no target, grey − no record. Same rules as the History calendar. Legend added.

## Round 4
- New admin page **Failed Attempts** (Organization group; grant to manager roles in Permissions): every rejected check-in/check-out (outside area, weak GPS, no geofence) with employee, branch, time, distance, GPS accuracy and a map link. Admin can delete entries / clear all. Table `attendance_failures` is created automatically.
- Out-of-zone message: "You are outside the allowed areas. You are X m away from the nearest allowed location."
- Toasts no longer have a close button; they show "Check in completed · HH:MM", "Check out completed · HH:MM", "Break started/ended · HH:MM".
- Reports > **Session Locations**: every session on its own row with separate check-in and check-out coordinates, each opening Google Maps.
- Camera (Employees) and pencil (Profile) badges moved below the avatar circle and both open the photo picker.
- Permissions: new "Punch Page > Start / End Break button" switch. Server also refuses starting a break when disabled; ending a running break is always allowed.

## Round 5 — Device lock
- At first sign-in an employee's device receives a random httpOnly cookie (`attendance_device`, 400 days); only its SHA-256 hash is stored in `employee_devices`.
- Sign-in or punching from any other device is refused, an alert is stored in `device_alerts`, and every admin gets a bell notification, a red badge on **Device Security** and a banner on the Dashboard.
- Admin page **Device Security**: alerts (Allow device / Dismiss), registered devices (Reset device), and a global Device lock on/off switch (admin only).
- Exempt: Administrator, Display accounts and Manager-level custom roles. Employees already signed in before the update must sign out and in once to register.
- Limits: it is browser-based. Clearing cookies, private mode or another browser looks like a new device (blocked until an admin resets). It does not prove hardware identity; for stronger binding use a native/PWA app.

## Round 6 — Device details
- Every request carries a small `X-Device-Info` header (model and OS version from Client Hints where the browser allows, screen size, time zone, language). The server combines it with the User-Agent into: type (Mobile/Tablet/Desktop), model, OS + version, browser + version.
- Stored on the registered device and on every alert (`info` JSONB). Device Security now shows the attempted device next to the registered one, with type, screen and time zone under each name.
- Matching still uses only the secret device cookie (details can legitimately change with browser/OS updates, IP changes freely); the details are for the admin to judge an alert.
- Android Chrome hides the model unless Client Hints are available (HTTPS); iPhone/Safari never exposes the exact model, so it shows "iPhone" plus screen size.

## Round 7 — Sign out unregistered devices
- Every authenticated request (including the 4-second `version` poll and page load) now verifies that the browser's device cookie matches the registered device. Otherwise the session cookie is deleted and the API returns 401; the app returns to the sign-in screen with a message.
- Allow device / Reset device therefore signs the old device out within seconds. Any other signed-in browser that is not the registered device is signed out too (this includes a copied session).
- Punch/break from an unregistered device is refused, ends that session and still raises the admin alert.
- Employees with no registered device (e.g. right after Reset, or when Device lock is switched on) are signed out once and register on their next sign-in.
