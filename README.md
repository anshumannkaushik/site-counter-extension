# Site Counter — All Tabs

A Firefox extension that counts the mapped site rows (BOOKING, BOOKING APP, XP, and other sources) on **every open hotel-search tab** and gives a per-property total across all tabs.

## How it works

- Clicking the toolbar button injects the counting logic into each open tab on demand (`scripting.executeScript`, with a content-script message fallback) — tabs opened *before* the extension was installed are counted too, no reload needed.
- The counter finds the results table, identifies each property row by its record ID, and reads the source from the cells before the hotel-name column (whole-cell matches first, so `BOOKING APP` is never misread as `BOOKING`).
- Results come out as a clean 2-column CSV — `site count, sites` — via Copy or a Download CSV button, ready to paste into Excel/WPS.

Built for high-volume record-matching work where a single property's mapped sites have to be tallied across hundreds of open tabs.
