# Admin UI Upgrade

- Employees: add/edit, activate/deactivate, delete where safe, and profile-photo upload through Supabase Storage by clicking the avatar.
- Branch and fixed-shift assignment: named dropdowns in employee dialogs. No manual ID entry.
- Branches: assign an existing employee from the branch card.
- Shifts: dedicated admin page for creating, editing and deleting fixed shifts, plus assignment from the shift card. Blank shift assignment is labelled Flexible schedule.
- Sidebar: collapsible Workspace, Organization and Administration groups with icons. Tapping a destination closes the mobile sidebar.
- Admin actions use icon buttons for edit, activation and deletion.

## Deploy

Upload contents of this project to the existing GitHub repository and redeploy Vercel. Preserve DATABASE_URL, SESSION_SECRET and Supabase server-side storage credentials. No database reset required. Existing database must have the shifts table created by its schema initialization.

## Verification

The archive was inspected, but full npm install/build could not be completed in the execution environment (dependency installation timed out). Run `npm install`, `npm run typecheck`, and `npm run build` before production deployment. Test the photo-upload route and branch/shift assignments with an admin account.
