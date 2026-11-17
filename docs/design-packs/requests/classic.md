# Classic: shared decisions requested

## Protected Digital Twin phone accessibility

The app-wide pack must not style or resize the preserved Digital Twin and
Digital Twin Mini subtrees. The previous 390px dashboard diagnostic at font
scale 1.01 nevertheless measured their **Open** links at 36 × 36px, actionable
freshness controls at 10 × 28px, and widget title/body text at about 14.1px.
The interrupted default-scale round independently measured 36 × 36px and
10 × 28px targets and 14px Digital Twin title/body text.
These are unresolved failures, not exemptions from the 44px touch and 16px
phone-text requirements.

Please coordinate a fix with the widget/shared-component owners rather than
removing the preserve boundary. `DigitalTwinWidget.tsx` and
`DigitalTwinMiniWidget.tsx` supply the Open `IconButton`; `WidgetShell.tsx`
supplies the actionable `FreshnessDot`. Give each interactive target an
independent, non-overlapping 44 × 44px hit area on phones, without enlarging
noninteractive freshness indicators. Make the applicable widget text readable
at 16px or greater while respecting saved font scale. Preserve accessible
names, focus, refresh behavior, status meaning and the original vehicle image.
The conflicting requirement to preserve the widgets' existing geometry needs
an explicit shared decision before changing their internal layout.

Acceptance should exercise both actual widgets with app-wide Classic on and
off at 360, 390 and 430px, both themes and saved scales 0.85, 1 and 1.35.
Check keyboard and forced-color focus, no overlap or clipping, image source
and geometry, touch target sizes, text sizes and no page-level horizontal
scroll. Do not waive failed diagnostics or treat incomplete contrast checks as
passes.

## Dashboard setup footprint

The previously captured dismissed **Get started** widget occupies a large
reserved grid area ahead of vehicle information, especially on the phone.
Please assess a compact dismissed state in the dashboard/widget layout owner
without hiding its restart action, silently changing a saved grid, or changing
protected twins. The pack cannot safely resize the shared grid or reorder
widgets. This is a layout-owner decision, not a Classic-only workaround.

## Shared two-row phone navigation

The final Classic 390px images show the second navigation row cut by the
bottom viewport edge. Another pack's real-route diagnostic measured an
11px overlap between the rows and the second row extending 13px beyond the
viewport when 60px tabs were placed in a 97px reservation. Please have the
shared shell owner verify and correct the reservation, row geometry and safe
area rather than hiding or shrinking actions in a pack. Check all labels and
44 × 44px targets at 360/390/430px, saved font scales and both themes, with
no row overlap, clipping or page-level horizontal scroll.
