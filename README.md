# AttendPro — Next.js + Firebase attendance starter

A responsive attendance-management foundation with employee signup/approval, role-aware admin area, geofence polygon editor, schedule configuration, request review, CSV report export and server-side attendance actions.

## Stack
- Next.js App Router + TypeScript + Tailwind CSS
- Firebase Authentication + Cloud Firestore
- Firebase Cloud Functions v2 + Admin SDK
- React Leaflet + OpenStreetMap tiles

## Setup
1. Create a Firebase project and enable **Email/Password** under Authentication.
2. Create a Cloud Firestore database.
3. Copy `.env.example` to `.env.local` and populate the Firebase web app values.
4. Install dependencies: `npm install`
5. Run locally: `npm run dev`
6. Install Functions dependencies: `cd functions && npm install && npm run build`
7. Deploy rules and functions from the project root: `firebase deploy --only firestore:rules,functions`
8. Enable Firebase App Check and configure the web provider before production use.

## First administrator
Create an employee account through `/signup`. Then, from a trusted machine with a Firebase service-account JSON file (never put it in the browser or repository), run:
```bash
GOOGLE_APPLICATION_CREDENTIALS=/secure/service-account.json node scripts/set-super-admin.mjs admin@company.com
```
Sign out and back in. Only a super admin can assign privileged roles through the `setEmployeeRole` callable function.

## Geofencing
Open Admin → Geofences. Enter a zone name and click at least three points on the map to draw a polygon. Save the zone. Employees must be inside an enabled polygon for check-in/out.

The callable Cloud Function checks the polygon on the server, requires an active employee, checks GPS accuracy and prevents multiple open sessions. Firestore rules prohibit clients from writing attendance records directly.

## Important production hardening
- Configure App Check enforcement and monitor rejected requests.
- Set Cloud Functions region and business timezone consistently. The sample uses `Asia/Qatar` for date keys.
- GPS is not cryptographic proof of physical presence. Mock-location tools, rooted devices and compromised devices can still spoof coordinates. Consider managed-device policies, anomaly detection, impossible-travel checks, periodic re-verification and supervisor review.
- Add polygon assignment UI, employee-to-schedule assignment, holiday calendars, overtime/late rules, pagination, audit logs, notifications and PDF/XLSX reports before production rollout.
- The starter uses client-side route guards for UX; Firestore Rules and server-side authorization are the actual security boundary.
- Admin approval in the starter changes the employee status. Privileged role assignment must use the trusted callable function or Admin SDK.
- Never expose service-account credentials. Firebase web API keys are identifiers, not authorization secrets; protect data with Rules and App Check.

## Firebase services
The provided web configuration is read from environment variables. The Firebase Realtime Database URL is retained in `.env.example`, but this starter uses **Cloud Firestore** for app data.
