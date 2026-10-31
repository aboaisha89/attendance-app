# Build and map editing fix

- Fix TS build failure by aliasing the Lucide `Map` icon as `MapIcon` (avoids shadowing built-in Map constructor).
- Added Draw points / Move points modes in the geofence editor, with 44px drag handles and safer map click handling.
- Editing still requires clicking **Save boundary** to persist to Neon; no database schema changes.
- Existing geofences load into edit mode. Right-click a handle to remove it, or Undo/Clear.
- Re-test touch dragging on actual iOS/Android devices and geofence validation before production deployment.
