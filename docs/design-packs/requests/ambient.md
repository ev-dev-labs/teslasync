# Ambient shared-fix request

## Dashboard layout selector does not announce the selected layout

`web/src/features/dashboard/components/LayoutSwitcher.tsx` renders the
selected layout name inside the menu button, but its `aria-label` is only
“Switch dashboard layout”. The explicit label replaces the visible button
contents in its accessible name, so a screen-reader user cannot discover the
current selection from the control.

Include the current layout name in the localized accessible name or associate
an accessible description with it. Preserve the existing menu behavior,
phone touch size, wrapping, and vehicle-pinning information. Add an
accessibility test for a named active layout.

## Phone navigation text and widget accessibility

The final captures reported computed 11px text on the five phone navigation
buttons on all three pages, even though their child labels render at the
shared 16px floor. Align the button's own font with that floor in the shared
phone rules and retain the existing target, wrapping and safe-area contracts.
Ambient added a local override after capture, but it has not been recaptured.

The phone dashboard also reported an `Open` target of 36×36 and a `Refresh
data` target of 10×28, plus 12–14px text. Digital Twin is protected from pack
CSS; investigate and fix its source controls and text without altering its
vehicle image or data. Check the refresh control's actual ancestry as well.
The unprotected Recent Drives and Fleet Posture footer links and metric
context/unit text also need shared mobile readability across packs. Ambient
added local text overrides after capture, without a subsequent visual run.

## Capture fixture completion

Desktop dashboard and drives each timed out with a same-origin GET
`/api/v1/pinned` still pending in `web\e2e\mockApi.ts`'s routing completion
check. Ensure the fixture settles deterministically without suppressing the
assertion; contrast diagnostics did not run for those two captures.
