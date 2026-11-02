# Update V11 — Employee rules, session limits, requests, permanent delete

## Database (automatic, additive — runs on next sign-in, no data lost)
- employees: allow_outside_geofence, allow_multiple_devices, max_checkin_enabled, max_checkin_hours
- attendance_sessions: expired_absent, max_hours_snapshot (+ missed_checkout guaranteed)
- Audit tables guaranteed: attendance_change_audit, attendance_manual_audit

## 1. Employees page
Stat cards (Total / Active / Pending) are now counted on the server, so they stay correct above 100 employees.
Administrator and Display accounts are excluded.

## 2. Per-employee settings (Add / Edit employee)
- Allow Check-in/Check-out Outside Geofence
- Allow Multiple Devices (off = one device only)
- Enable Maximum Check-in Duration + Maximum Check-in Duration (Hours)
Quick Activate/Deactivate does not reset these settings.

## 3. Maximum Check-in Duration
- Each check-in stores its own limit (snapshot), applied to every new session.
- An open session older than its limit is closed as Absent: no hours counted, employee notified.
- Only that session is Absent; other sessions that day keep their hours; a new check-in/check-out counts normally.
- Shown in: attendance log ("Absent"), history timeline, monthly report (new "Abs. Sessions" column + CSV), calendar.

## 4 & 5. Overtime / Early Left grace
Verified against the examples: once the grace is exceeded, ALL minutes are counted
(10:30 → 0, 10:31 → 31, 11:00 → 60; early 30 → 0, 31 → 31, 45 → 45). No change needed.

## 6. Requests
Statuses: Pending / Approved / Rejected / Cancelled. Employees can cancel their own pending request.
Admin approves/rejects pending requests, edits/deletes, creates only for a selected employee (never for self).
Status filter added.

## 7. Delete Employee (permanent)
Works even with history. Deletes attendance sessions, breaks, requests, leaves, devices, notifications,
schedule history and audit rows tied to the employee, in one transaction.
Warning text + Cancel / Confirm Permanent Delete. Logged in Activity (Audit) Log as "Permanently deleted employee".
Safeguards: cannot delete your own account or the last administrator.

## 8. Admin-viewable passwords (owner's request)
- Column employees.password_view stores the password AES-256-GCM encrypted (not plain text). Key: PASSWORD_VIEW_KEY (optional) or SESSION_SECRET.
- Saved on registration, employee creation, password reset/change, and backfilled on the next successful login for existing users.
- Edit employee shows the password with a hide/show eye; only role "admin" can read it, and each view is written to the Activity Log.
- Changing SESSION_SECRET (without PASSWORD_VIEW_KEY) makes stored passwords unreadable until users log in again.
