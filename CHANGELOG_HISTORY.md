# History and calendar update
- Attendance History is an unfiltered chronological list of Check In, Check Out, Break In and Break Out events; no month selector or completion labels.
- Calendar dates without configured required hours are neutral grey, not green. Red indicates an open/incomplete session; early departure is amber.
- User-facing `Working` wording replaced with alternatives.
- Punch In runtime failure cannot be diagnosed from the generic UI message. Check the newest `/api/attendance` runtime `API error` for its SQL code and message.
- This does not alter Neon data or fabricate past break event times.
