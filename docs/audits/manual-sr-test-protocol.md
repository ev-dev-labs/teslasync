# Manual Screen-Reader Test Protocol (NVDA / VoiceOver)

**Purpose:** produce the human-verified evidence that automated tooling
cannot. axe measures markup; Vitest measures behaviour. Neither can tell you
whether an announcement is *intelligible*, whether a reading order makes
*sense*, or whether a summary sentence actually answers the question the user
had. This protocol is what closes that gap.

**Who runs it:** anyone shipping a change to a shared component in
`web/src/components/**`, and once per release for the full pass.

**Output:** a filled copy of [§ 7 Result template](#7-result-template),
attached to the release checklist. A run with no recorded observations is not
a pass — it is an unrun test.

---

## 1. Environment

Run at least one Windows and one macOS combination. Screen readers differ
enough in live-region handling and heading navigation that a pass on one
proves little about the other.

| Platform | Screen reader | Browser | Notes |
|---|---|---|---|
| Windows 11 | NVDA (latest stable) | Firefox | The reference pairing — most widely used, strictest about `aria-live`. |
| Windows 11 | NVDA | Chrome | Catches Chromium-specific accessibility-tree differences. |
| macOS | VoiceOver | Safari | The reference pairing on macOS; the only combination Apple tests. |
| iOS 17+ | VoiceOver | Safari | Optional; run when the change touches the mobile layout or `BottomTabBar`. |

**Before you start**

1. Build and serve a production build (`npm run build && npm run preview`).
   Dev-mode React adds DOM that changes the reading order.
2. Seed the environment with at least one vehicle that has drives, charging
   sessions, and live telemetry. Empty states hide most of what this protocol
   tests.
3. Turn the sound up and turn the monitor **off**, or use NVDA's speech
   viewer with the screen covered. Reading the screen while testing defeats
   the exercise — you will unconsciously supply context the AT never gave you.

**Essential commands**

| Task | NVDA | VoiceOver |
|---|---|---|
| Toggle screen reader | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> | <kbd>⌘</kbd>+<kbd>F5</kbd> |
| Stop speech | <kbd>Ctrl</kbd> | <kbd>Ctrl</kbd> |
| Next heading | <kbd>H</kbd> | <kbd>VO</kbd>+<kbd>⌘</kbd>+<kbd>H</kbd> |
| List headings | <kbd>NVDA</kbd>+<kbd>F7</kbd> | <kbd>VO</kbd>+<kbd>U</kbd> → Headings |
| List landmarks | <kbd>NVDA</kbd>+<kbd>F7</kbd> → Landmarks | <kbd>VO</kbd>+<kbd>U</kbd> → Landmarks |
| Next landmark | <kbd>D</kbd> | <kbd>VO</kbd>+<kbd>⌘</kbd>+<kbd>D</kbd> |
| Next table | <kbd>T</kbd> | <kbd>VO</kbd>+<kbd>⌘</kbd>+<kbd>T</kbd> |
| Next form field | <kbd>F</kbd> | <kbd>VO</kbd>+<kbd>⌘</kbd>+<kbd>J</kbd> |
| Read current line | <kbd>NVDA</kbd>+<kbd>↑</kbd> | <kbd>VO</kbd>+<kbd>L</kbd> |
| Speech viewer / log | NVDA menu → Tools → Speech Viewer | VoiceOver Utility → captions panel |

Keep the speech viewer open. Several checks below depend on what was
announced *and on what was not* — you cannot verify an absence from memory.

---

## 2. Keyboard-only pass (no screen reader)

Do this first, with the screen reader **off** and the mouse physically
unplugged or otherwise unavailable. It isolates focus bugs from
announcement bugs.

| # | Step | Pass criteria |
|---|---|---|
| 2.1 | Load `/`, press <kbd>Tab</kbd> once | "Skip to main content" becomes visible and is focused |
| 2.2 | Press <kbd>Enter</kbd> on it | Focus lands inside `<main>`; the next <kbd>Tab</kbd> reaches page content, not the sidebar |
| 2.3 | <kbd>Tab</kbd> through the entire page | Every stop shows a visible focus ring; the visual order matches the tab order; focus never disappears |
| 2.4 | Open any modal (e.g. Settings → a confirm dialog) | Focus moves into the dialog immediately |
| 2.5 | <kbd>Tab</kbd> repeatedly inside the dialog | Focus cycles inside the dialog and never reaches the page behind it |
| 2.6 | Press <kbd>Esc</kbd> | The dialog closes and focus returns to the control that opened it |
| 2.7 | Open a drawer from a table row, then delete that row's record | On close, focus lands on the page heading or `<main>` — **never** on `<body>` (press <kbd>Tab</kbd>: it must not restart at "Skip to main content") |
| 2.8 | Press <kbd>G</kbd> then <kbd>V</kbd> | Navigates to Vehicles; focus is on the "Vehicles" heading |
| 2.9 | Press <kbd>Alt</kbd>+<kbd>←</kbd> (Back) | Returns to the previous page **without** yanking focus to its heading; the scroll position is restored |
| 2.10 | Focus a filter/search field and type | Focus stays in the field for the entire word — the URL updates but focus does not jump |
| 2.11 | On a data table, <kbd>Tab</kbd> to a row and press <kbd>Space</kbd> | The row's checkbox toggles |
| 2.12 | <kbd>Tab</kbd> to a sortable column header, press <kbd>Enter</kbd> | The table re-sorts |

---

## 3. Structure pass

| # | Step | Pass criteria |
|---|---|---|
| 3.1 | Open the landmark list on `/`, `/vehicles`, `/drives`, `/charging`, `/settings` | Exactly one `main`; `banner` and `navigation` are present and **named** — no bare "navigation, navigation" |
| 3.2 | Open the heading list on the same pages | Exactly one level-1 heading, and it matches the page title; no level is skipped (no h2 → h4) |
| 3.3 | Navigate by heading (<kbd>H</kbd>) top to bottom | Every heading describes the section beneath it; none are placeholders like "Section" or a bare unit |
| 3.4 | Find a data table (<kbd>T</kbd>) | The table announces a name ("Drives, table"), not just "table" |
| 3.5 | Enter the table and move across the header row | Each header announces its column name; sortable columns announce their sort state, including "not sorted" for unsorted ones |
| 3.6 | Move down a selection column | Each checkbox announces something row-identifying ("Select Morning commute"), not forty repetitions of "Select row" |

---

## 4. Announcement pass

Watch the speech viewer for every step. Record the **exact** text.

| # | Step | Pass criteria |
|---|---|---|
| 4.1 | Navigate from `/` to `/drives` via the sidebar | The new page title is announced once — not twice, not the old title |
| 4.2 | Wait for the drives list to load | One "loaded" message with a count. Nothing further while the page idles |
| 4.3 | Leave the page open for two refetch intervals | **Silence.** A background refetch must never announce |
| 4.4 | Stop the API (`docker stop teslasync-api`) and trigger a refresh | One assertive failure message. Sibling panels failing the same request must not produce a chorus |
| 4.5 | Restart the API and let live data reconnect | At most one connection message per 10 s, even if the socket flaps |
| 4.6 | Reload the page with the API healthy | **No** connection announcement on arrival — you are told when it changes, not what it was |
| 4.7 | Select three table rows quickly with <kbd>Space</kbd> | You hear the final count, not one message per row |
| 4.8 | Sort a table column | One message naming the column and direction |
| 4.9 | Save a settings change | One confirmation. If a toast also appears, confirm it is not announced twice |
| 4.10 | Submit a form with two invalid fields | Focus moves to the error summary; it announces how many problems there are and names each; activating an entry moves focus to that field |
| 4.11 | Re-render the same invalid form (change an unrelated control) | Focus is **not** re-stolen by the summary |

---

## 5. Visualisation pass

| # | Step | Pass criteria |
|---|---|---|
| 5.1 | Open a drive detail page and reach the route map | A summary is read: endpoints (when known), distance, duration, recorded point count. "No location data recorded" when the drive has no GPS |
| 5.2 | Reach a gauge (battery health, efficiency) | You hear the label, the value **with its unit**, the qualitative status when one is shown, and the scale — not a bare number |
| 5.3 | Reach a chart | The fallback data table is reachable and its numbers match the visible chart |
| 5.4 | Open the FSM state diagram (`/system` → state machine) | You hear the current state and which states it can move to |
| 5.5 | Reach a timeline | You hear how many entries there are and the span they cover before the individual entries |
| 5.6 | Confirm every visualisation summary agrees with the visible numbers | Turn the monitor back on for this check only. A summary that disagrees with the printed value is a **fail**, not a rounding difference |

---

## 6. Preference pass

| # | Step | Pass criteria |
|---|---|---|
| 6.1 | Enable OS reduce-motion (Windows: Settings → Accessibility → Visual effects → Animation effects off; macOS: System Settings → Accessibility → Display → Reduce motion) and reload | Loading skeletons are flat — no shimmer, no lopsided highlight parked to one side |
| 6.2 | Load a page with charts | Series appear immediately; no sweep, grow, or wipe |
| 6.3 | Open a drive route map | The camera **jumps** to the route; it does not glide or zoom across |
| 6.4 | Open a vehicle detail page (`VehicleTwin` scene) | No pulsing glows, no looping shimmer on the car graphic |
| 6.5 | Toggle the OS preference back off without reloading | Motion resumes — the preference is live, not read once at boot |
| 6.6 | Enable Windows High Contrast (<kbd>Left Alt</kbd>+<kbd>Left Shift</kbd>+<kbd>PrtScn</kbd>) | Panels have visible borders; text is legible; nothing renders as a borderless dark slab in a light contrast theme |
| 6.7 | <kbd>Tab</kbd> through a page in High Contrast | The focus indicator is clearly visible on every stop |
| 6.8 | Check charts and maps in High Contrast | Axes, gridlines, labels, and route polylines are all perceivable |
| 6.9 | Zoom the browser to 200 % | No content is lost or clipped; no horizontal scrolling of the whole page |
| 6.10 | Switch to the light theme and repeat 6.6–6.8 | Same results — the token fallbacks are theme-independent |

---

## 7. Result template

Copy this into the release checklist and fill it in. "Pass" with no
observations recorded is not accepted.

```
Screen-reader test run
======================
Date:            YYYY-MM-DD
Build / commit:  <sha>
Tester:
Environment:     [ ] NVDA + Firefox / Windows 11
                 [ ] NVDA + Chrome   / Windows 11
                 [ ] VoiceOver + Safari / macOS
                 [ ] VoiceOver + Safari / iOS

Section results
---------------
 2. Keyboard-only ....... PASS / FAIL / PARTIAL
 3. Structure ........... PASS / FAIL / PARTIAL
 4. Announcements ....... PASS / FAIL / PARTIAL
 5. Visualisations ...... PASS / FAIL / PARTIAL
 6. Preferences ......... PASS / FAIL / PARTIAL

Verbatim announcements captured (§4)
------------------------------------
 4.1  "<exact text>"
 4.2  "<exact text>"
 4.4  "<exact text>"
 ...

Defects found
-------------
 | # | Step | Severity | What happened | What should happen |
 |---|------|----------|---------------|--------------------|

Notes / judgement calls
-----------------------
 <anything that was technically conformant but confusing to listen to>
```

**Severity guidance**

- **Blocker** — a task cannot be completed with the screen reader at all
  (unreachable control, focus trap with no exit, unnamed submit button).
- **Major** — the task is possible but requires guessing (an unnamed table,
  a number with no unit, a silent failure).
- **Minor** — the task is achievable and understandable but the phrasing is
  awkward or redundant.

Blockers and majors are release-gating. Minors are logged and scheduled.

---

## 8. Relationship to the automated gates

Do **not** re-test by hand what CI already proves. These run on every build:

| Gate | Command |
|---|---|
| All static a11y gates at once | `npm run audit:a11y-static` |
| Accessible names | `npm run audit:accessible-name` |
| Landmarks & headings | `npm run audit:landmarks` |
| Reduced motion | `npm run audit:reduced-motion` |
| Forced-colour cascade | `npm run audit:forced-colors` |
| Visually-hidden discipline | `npm run audit:sr-only` |
| Touch targets | `npm run audit:touch-target` |
| Runtime axe (WCAG 2.2 AA, including explicit target-size) | `npm run e2e:a11y` |
| Component contracts | `npx vitest run src/components/a11y src/hooks/useDialogFocus.test.tsx src/lib/__tests__/routeFocus.test.ts` |

All of the above are chained from `npm run lint`, which
`.github/workflows/ci.yml` runs on every push — so they are enforced, not
aspirational.

This protocol exists for what those cannot measure: intelligibility,
reading order, and whether the thing a user is told is the thing they needed
to know.
