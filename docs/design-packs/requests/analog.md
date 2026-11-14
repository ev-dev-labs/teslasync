# Analog shared-fix requests

1. **Protected Digital Twin phone controls and text.** The Dashboard 390px
   capture reports the Digital Twin Open link at 36×36px and Refresh data at
   10×28px, plus body text at 14px. The subtree opts into
   `[data-app-design-preserve]`, so the Analog pack cannot change it. Please
   give both controls independent visible 44×44px hit areas and make its body
   copy (including the “Digital twin” heading, “—”, and “Aurora”) at least
   16px on phones without changing the vehicle image or its interaction.
   Sources include `DigitalTwinWidget.tsx`,
   `DigitalTwinMiniWidget.tsx`, `WidgetShell.tsx`, and `FreshnessDot.tsx`.
2. **Phone navigation computed button size.** `sidenav.css` sets
   `.sidenav-phone-tab` to 11px while `mobile.css` enlarges only the child
   label. All five buttons fail the current computed-font mobile diagnostic on
   every Analog route, though the visible labels are 16px. Apply the existing
   `--app-body-size` to the phone button in the shared mobile rule as well,
   retaining its existing geometry, safe insets, and wrapping. The Analog
   stylesheet contains a scoped workaround; other packs still need the fix.
3. **Instrument data-mode semantic/embedded surfaces.** The shared instrument
   rule in `web\src\components\ui\app-designs\feedback.css` applies a neutral
   background, border, and padding to all metric cards/tiles, including
   `[data-app-tone="warning"]`/`"danger"` and
   `[data-surface-variant="embedded"]`. For example, `UsageCard` assigns
   semantic warning/danger backgrounds to its tiles. Please exclude semantic
   and embedded surfaces from that generic paint rule (and preserve their
   component-defined geometry) so status and embedded variants are not
   neutralized. The frozen shared file is outside this worker's ownership.
4. **Capture artifact hygiene.** The final capture's unique runner output child
   was cleaned, but redirecting browser temporary output to the allowed shots
   root left `shots\analog\playwright-transform-cache`. It is not a screenshot
   or deliverable; exclude it from staging. It was not recursively removed.
