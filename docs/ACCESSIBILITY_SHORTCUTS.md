# Keyboard Shortcuts Reference

Every action in TeslaSync is reachable by keyboard. This page is the
canonical list; the in-app cheat sheet (press <kbd>?</kbd>) renders the same
data from `web/src/hooks/useKeyboardShortcuts.ts` and
`web/src/hooks/useShortcutRegistry.ts`.

> **Modifier convention.** <kbd>Ctrl</kbd> on Windows and Linux,
> <kbd>⌘</kbd> on macOS. Where a shortcut is written <kbd>Ctrl</kbd>+<kbd>K</kbd>,
> both are accepted on both platforms.

> **Shortcuts never fire while you are typing.** The global handler ignores
> every key press whose target is an `<input>`, `<textarea>`, `<select>`, or
> a `contenteditable` region, so <kbd>/</kbd> in a search box types a slash.

---

## Global

| Shortcut | Action |
|---|---|
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Move forward / backward through interactive elements |
| <kbd>Tab</kbd> (first press on a page) | Reveal and focus **Skip to main content** |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Open the command palette |
| <kbd>/</kbd> | Open the command palette (when no field is focused) |
| <kbd>?</kbd> | Toggle the keyboard cheat sheet |
| <kbd>Esc</kbd> | Close the topmost dialog, drawer, popover, or palette |

## Navigation — press <kbd>G</kbd>, then a target key

The <kbd>G</kbd> prefix arms *goto* mode for 1.5 seconds. A status indicator
appears while it is armed; pressing any unlisted key cancels it.

| Sequence | Destination |
|---|---|
| <kbd>G</kbd> <kbd>D</kbd> | Dashboard |
| <kbd>G</kbd> <kbd>V</kbd> | Vehicles |
| <kbd>G</kbd> <kbd>C</kbd> | Charging |
| <kbd>G</kbd> <kbd>R</kbd> | Drives |
| <kbd>G</kbd> <kbd>T</kbd> | Trips |
| <kbd>G</kbd> <kbd>B</kbd> | Battery & Energy |
| <kbd>G</kbd> <kbd>A</kbd> | Analytics |
| <kbd>G</kbd> <kbd>E</kbd> | Efficiency |
| <kbd>G</kbd> <kbd>I</kbd> | Climate |
| <kbd>G</kbd> <kbd>L</kbd> | Live Signals |
| <kbd>G</kbd> <kbd>O</kbd> | Automations |
| <kbd>G</kbd> <kbd>X</kbd> | Commands |
| <kbd>G</kbd> <kbd>N</kbd> | Notifications |
| <kbd>G</kbd> <kbd>S</kbd> | Settings |

## Dialogs, drawers, and popovers

All of these come from the shared `useDialogFocus` primitive, so every
dialog surface in the app behaves identically.

| Shortcut | Action |
|---|---|
| <kbd>Tab</kbd> | Cycle forward inside the dialog; wraps at the last control |
| <kbd>Shift</kbd>+<kbd>Tab</kbd> | Cycle backward; wraps at the first control |
| <kbd>Esc</kbd> | Close the dialog |

On open, focus moves to the dialog's designated first control (or the first
focusable element, or the dialog container when it has none). On close,
focus returns to the control that opened it — or, when that control has been
removed in the meantime, to the page heading or the `<main>` landmark, never
to `<body>`.

## Tabs

| Shortcut | Action |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> | Move to the previous / next tab (skipping disabled tabs) |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to the first / last enabled tab |

Only the active tab is in the tab order (roving `tabindex`), so <kbd>Tab</kbd>
moves from the tab list straight into the panel.

## Tables

| Shortcut | Action |
|---|---|
| <kbd>Tab</kbd> | Move to the next row or control |
| <kbd>Space</kbd> | Toggle selection of the focused row |
| <kbd>Enter</kbd> | Expand / collapse the focused row (expandable tables) |
| <kbd>Enter</kbd> on a column header | Sort by that column |

Sort state is exposed on the header as `aria-sort` — including `none` for
sortable-but-unsorted columns, so a sortable column is distinguishable from a
static one. Selection and sort changes are also announced (see below).

## Route playback (map and media replay)

Handled by the shared `PlaybackControls` component. The global handler
ignores these keys while a text field is focused.

| Shortcut | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause playback |
| <kbd>←</kbd> / <kbd>→</kbd> | Seek backward / forward 5 seconds |
| <kbd>Shift</kbd>+<kbd>←</kbd> / <kbd>Shift</kbd>+<kbd>→</kbd> | Seek backward / forward 30 seconds |
| <kbd>,</kbd> / <kbd>.</kbd> | Step one frame backward / forward (where frame stepping is supported) |

The route map itself uses `role="application"`, which suspends
screen-reader browse mode inside the widget so these keys reach it
directly. A visually-hidden summary immediately before the map states the
route's endpoints, distance, duration, and recorded point count — that
summary is the non-visual representation of the drive.

---

## What gets announced (and what deliberately does not)

Screen-reader announcements are governed to avoid chatter — see
[`ACCESSIBILITY_CONFORMANCE.md` § 2](./ACCESSIBILITY_CONFORMANCE.md#2-live-region-policy-sc-413).

**Announced:**

- the new page title after a navigation;
- "loaded" / "no items" once a page's data settles;
- refresh failures, save results, and bulk-action outcomes;
- table selection counts and sort changes;
- live-connection drops and recoveries.

**Deliberately not announced:**

- background refetches that never showed a loading state;
- every frame of a telemetry stream (rate-limited to at most one message per
  10 s per channel);
- an identical message repeated inside its dedupe window;
- the live-connection state at page load — you are told when it *changes*,
  not what it was when you arrived.

## Focus behaviour on navigation

After a client-side navigation, focus moves to the new page's `<h1>` so the
next <kbd>Tab</kbd> continues from the content rather than from the top of
the shell.

Focus is **not** moved when:

- you pressed Back or Forward (the browser restores your reading position);
- only the query string changed (filters, sorting, saved views);
- you were typing in a field;
- a dialog was open;
- the tab was in the background.
