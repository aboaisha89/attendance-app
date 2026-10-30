# On-site directory update

- On Site page in side navigation, with employee profile photos, search by name and branch filter.
- Presence is derived from active (`check_out IS NULL`) attendance sessions, refreshed approximately every 3 seconds.
- Staff can see only coworkers assigned to their branch; admins can see all branches.
- This is a record of employees currently checked in, **not continuous GPS location tracking**.
- Punch button uses the same fingerprint icon for both Check In and Check Out; only its color and caption change.
- Includes TypeScript modal field typing fix (`type?: string`).

Keep existing Vercel environment variables. No schema migration or data deletion required.
