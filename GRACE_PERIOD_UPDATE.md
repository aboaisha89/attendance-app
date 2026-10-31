# Grace Period Settings

Admin → Settings → Early Leave Grace (minutes) and Overtime Grace (minutes). Both default to 0 and allow values 0–240. Saving persists them in Neon app_settings.

The app uses required daily hours minus break time. A net day between (required - early grace) and (required + overtime grace), inclusive, is considered Present/On Time. Outside the tolerance, Early Left or Overtime applies. Only fully checked-out days are eligible. Overtime and early differences in admin reports show only minutes beyond the grace threshold (e.g., 9h31m with 30m overtime grace = 1m extra).

Rules are applied to My Attendance calendar colors, This Month Summary, admin monitor, daily Session Details and monthly matrix report. Overnight shifts are associated with the check-in date.

Database: additive columns early_grace_minutes and overtime_grace_minutes are created by the existing compatibility migration and initial schema; no attendance rows are deleted or backfilled. Changing settings affects historical status calculations because these are global settings, not time-stamped policy snapshots.

Not included: grace for late arrival / individual shift starts (the current system evaluates daily total net work duration). If late arrival penalties are required, a separate schedule-specific attendance policy is needed.

Build not verified against installed Next.js dependencies. Test preview before deploying to production.
