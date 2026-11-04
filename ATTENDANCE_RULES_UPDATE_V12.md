# Update V12 — Weekly off days, Day Control, table tools

## Weekly off days
- Add/Edit Employee has a "Weekly Off Days" card (Saturday → Friday, any combination).
- On an off day with no check-in the employee is NOT absent; it shows as "Off day" (grey) in the calendar, week strip and the monthly report (code O). If the employee does check in, the day is a normal working day.
- Changing off days from the employee page applies from today only. Past days keep the schedule that was valid then (history in employee_off_days).

## Day Control page (Organization → Day Control, administrators / roles with permission)
- Per employee and month: every day with its sessions and status (Worked / Off Day / Leave / Sick Leave / Absent).
- Select days and set: Off Day, Leave, Sick Leave, Working Day, or Reset. Leave and Sick Leave are saved as normal leave records, so existing leave logic and reports use them.
- Weekly off days can be re-applied from a past date ("Apply from") to correct earlier days.
- Days inside a multi-day leave must be edited from Employee Leaves. Every change is written to the Activity Log.
- New tables (created automatically): employee_off_days, employee_day_overrides.

## Tables
Every table now has a search box, a column filter (column + value), a rows-per-page dropdown (10 / 25 / 50 / 100 / All, default 10) and paging.

## Follow-up
- An Off day is shown only after that day has ended without any check-in. Today and upcoming off days are not marked (calendar, week strip, monthly report).
- The calendar legend (status colours) is now a permission: Permissions → role → Attendance History → "Calendar legend (status colours)". Visible by default.

## Follow-up 2
- Admin monthly attendance calendar now always shows Off days (including today and upcoming days). Employees still see an off day only after it has ended without a check-in.
- Day Control → "Bulk update": select any number of employees (search, select all/filtered) and either
  1) set weekly off days (Saturday → Friday) from a chosen date, or
  2) set a date range as Off Day / Leave / Sick Leave / Working Day / Reset.
  Employees with a multi-day leave inside the chosen period are skipped and reported. One Activity Log entry per bulk action.
- "Apply from" for weekly off days may now also be a future date.

## Profile permissions (Permissions → role → "Profile — what the employee can edit")
- Change / remove own profile photo (on by default)
- Change own password (on by default; the forced change at first sign-in is always allowed)
- Edit own name (off by default) / Edit own email (off by default; must be unique)
Enforced on the server too (/profile, /avatar-upload, /avatar-remove, /password), not just hidden in the UI. Administrators are never restricted.

## Device recognition fix ("linked to another device" on the same phone)
Cause: a device was recognised only by one cookie. If the cookie is lost (site data cleared, private tab, opened from another domain/URL, browser storage cleanup) the same phone looked like a new device.
- Backup identity: the browser keeps a random ID (localStorage) and sends it as X-Device-Id; if the cookie is lost but the backup matches, the device is recognised and the cookie is re-issued.
- Recognition mode (Devices page, administrators): Flexible (default) also accepts the same phone profile (model, OS, browser, screen, time zone, CPU/memory, touch) when both identities were lost; Strict = same browser only.
- Trade-off: Flexible could accept a different phone with an identical model and settings. Use Strict if buddy punching is a concern.
- New columns (automatic): employee_devices.alt_hash, app_settings.device_match_mode.

## Announcements page (rebuilt)
- Messages table sorted by date / send time (newest first) with search, column filter and rows-per-page.
- Types with icon + colour: Notice, Warning, Urgent, Emergency (also shown in the employee pop-up; Emergency/Urgent appear first).
- Compose: all employees or a chosen list (search, select all), Send now or Schedule (Qatar time). Scheduled messages are sent automatically by the first request after their time (any open session polls every 30 s), with an atomic claim so nothing is sent twice. "Send now" is available on scheduled rows.
- Log per message (eye icon): every recipient with Read / Not read yet and the read time.
- Edit: scheduled messages can change everything; sent messages can correct title/text/type (unread recipients see the new text).
- Resend: remind unread only, or resend to everyone (everyone must confirm again). Delete removes the message, its log and its bell notifications.
- New columns (automatic): admin_messages.kind/status/scheduled_for/sent_at/audience/updated_at/resend_count/last_resent_at, notifications.ref_id. Every action is in the Activity Log.

## Forgotten check-out (second session)
A session that was never closed (missed check-out, or past its Maximum Check-in Duration) is voided on its own. The day is now calculated from the remaining valid sessions (net hours vs required hours, early left / overtime / on time with the grace rules) in the calendar, week strip, monthly report and analytics. The day is Absent only when it has no valid session at all. The voided session is still listed in the log and counted in the report's "Abs. Sessions" column.

## Sidebar
- Fixed while the page scrolls; long menus scroll inside the sidebar.
- "Dashboard" and "On Site" are separate links at the top; the other items stay in the Workspace / Organization / Administration groups.
- Collapsed sidebar: clicking a group icon opens its menu beside it; clicking another icon switches to that group; clicking the same icon, anywhere else, an item, or pressing Esc closes it.

## Dashboard layout
"Employees Currently in Kitchen" is a left column beside the charts and reports on the admin dashboard (below them on narrow screens).

## Layout update
- Admin dashboard: Workforce Overview on top (full width); below it Attendance Analytics on the left and "Employees Currently in Kitchen" on the right; Employee Attendance Monitor underneath.
- Sidebar: Dashboard, On Site and Punch are standalone links at the top. Groups: **Employees** (Employees, Shifts, Day Control, Requests, Announcements, Device Security, Failed Attempts), **Reports** (Reports, History, Activity Log), **Settings** (Settings, Permissions, Branches, Geofences, Request Categories). For non-admin users Requests is a standalone link. Groups with no permitted pages are hidden.
- Profile: removed from the menu list; opened from the header chip (photo + name) and from the bottom of the sidebar, above Sign out.

## Navigation follow-up
- Opening any page opens the sidebar section that contains it (others close); standalone pages close all sections. (Previous logic used outdated section names.)
- Header account menu: clicking the photo + name opens a menu with Profile and Sign out; it closes on any outside click, Esc, opening notifications or navigating. Sign out was removed from the sidebar.
- Permission "Header → Show profile photo and name in the header" (Permissions → role). If hidden for a role, a Sign out button replaces the chip so users can always sign out. Administrators always see it.
- Sidebar is now position: fixed (does not move with the page). The header is pinned in admin mode. A global body overflow rule that blocked sticky positioning was overridden.
