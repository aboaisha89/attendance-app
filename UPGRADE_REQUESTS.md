# Request categories + notifications update

- Request categories saved in Neon and manageable by Admin (add / rename / hide / delete unused).
- Existing request records are preserved; used categories cannot be deleted.
- The employee Dashboard displays **New Request** only with requests page permission.
- Requests navigation is de-duplicated; admin gets Request Categories separately.
- Bell panel closes on outside click.
- Header includes Requests, Notifications and Sign out.
- Fingerprint changes to orange on break.
- Apply the updated source and redeploy Vercel; tables are created by the existing idempotent schema routine when applicable.
- Request category field currently takes a text value (the modal explains valid categories).
