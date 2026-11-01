# On Site layout update — V8

- Reworked the On Site header into one compact row: title, employee search, branch selector, exit-summary checkbox, clock, TV mode, and Sign out.
- Moved the three counters into a vertical right-hand column on desktop/tablet layouts.
- Employee cards now occupy the upper/left main area and use content-sized grid rows.
- Removed clipping from the employee-card grid. When the roster is larger than the available display area, only the roster panel scrolls; employee cards are no longer hidden by the wallboard's fixed-height overflow rule.
- Checked-out summary remains below the active roster inside the same scrollable roster panel.
- Responsive layout stacks the counters above the roster on narrow/mobile screens.
- Counters are now Check In (active sessions), Check Out (checked-out sessions today), and Break (active break sessions).
