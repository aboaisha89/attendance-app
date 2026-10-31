# Missed Check Out / overnight eligibility fix

- Non-overnight employees with a session still open after the Doha calendar day ends are expired in the API, freeing them to Check In again.
- Those sessions are preserved with `missed_checkout = true`; the synthetic zero-length `check_out = check_in` is a technical closure **not** a genuine checkout. It must not count toward worked hours, overtime, or Present. Admin should reconcile actual hours separately if needed.
- Employees with Variable / Overnight Shift enabled are exempt from automatic expiration, so cross-midnight work still supports normal Check Out.
- The snapshot, punch and break APIs each apply expiration. History shows `Missed Check Out`, not a fabricated Check Out time. Calendar and summary classify the missed day as Absent.
- The database change is additive (`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS missed_checkout BOOLEAN NOT NULL DEFAULT false`).
- The cutoff is midnight in `Asia/Qatar`, not the server's UTC date; adjust policy if shifts with non-midnight contractual deadlines are required.
- This update has not been verified against the live Neon database or a full Next.js build.
