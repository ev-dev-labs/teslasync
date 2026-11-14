# Terminal capture-output request

The shared capture runner currently creates its Playwright output with
`mkdtemp(os.tmpdir())`. Please use a deterministic project-owned location
outside the Vite watch root, isolated per pack, and ensure the Edge/Playwright
child's scratch/profile files also stay in the project. Preserve the runner's
existing checks, per-run isolation and cleanup; do not change the server.

The first Terminal round was interrupted after only the phone dashboard image.
The five other images and its diagnostics are missing. Terminal's remaining
bounded round is blocked until project-owned capture output is available.

## Update and remaining shared requests

The output-root request was resolved. The final permitted round ran and its six
images were inspected; its phone cases failed, so it is not a passing capture.

1. **Protected Digital Twin mobile accessibility:** the dashboard capture
   measured its “Open” action at 36×36px and a freshness refresh action at
   10×28px, with its heading at 14px. Please have the widget/shared-component
   owner make visible actions at least 44×44px and body copy at least 16px on
   phones, without altering the vehicle image or breaking the preserved-widget
   contract. `DigitalTwinWidget.tsx`, `WidgetShell.tsx`, and
   `components/data-display/FreshnessDot.tsx` are relevant. The capture log
   does not itself identify the refresh action's nearest widget.
2. **Other dashboard body text:** the capture reported the Recent Drives
   context at 14px and its “All drives” link, a metric unit, and “Open vehicle”
   at 12px. Please review their shared/widget mobile typography with the
   16px body requirement, retaining real metric and link content. Relevant
   sources include `RecentDrivesWidget.tsx`, `shared/WidgetBigNumber.tsx`, and
   `FleetPostureWidget.tsx`. The ordinary headline context and unit now have
   a pack-owned phone treatment and focused regression; the links still need
   independent verification.
3. **Bottom navigation diagnostic:** all five parent buttons were reported
   at 11px, while shared `mobile.css` sets the child `.sidenav-tab-label` to
   `--app-body-size` (at least 16px). Please reconcile the parent and rendered
   label sizes, or make the diagnostic measure the element actually painting
   text without weakening the readability check. Preserve the existing shared
   navigation geometry, safe insets and hit-target tests.

The runner cleaned its own output child. Edge/Playwright also left
`playwright-transform-cache`, `playwright_chromiumdev_profile-Uxaz0C`,
`playwright-artifacts-J2X7Se`, and `cv_debug.log` under the Terminal shot
directory; they were not recursively deleted by this worker.
