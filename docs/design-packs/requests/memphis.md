# Memphis: shared fixes requested

## Protected Digital Twin phone accessibility

The Memphis 390px dashboard capture measured a 36 × 36px Digital Twin
**Open** control, a 10 × 28px actionable refresh control and 14px widget
title/body text. The 14px “Aurora” was confirmed by a subsequent DOM probe
to be inside the protected subtree. These are failed diagnostics, not
exemptions. The pack must not alter the preserved widget subtrees or the
original vehicle image.

Please have the widget owners provide independent, non-overlapping 44 × 44px
phone targets for the Open and actionable freshness controls and at least 16px
phone text, respecting saved font scaling. Preserve names, focus, refresh
behavior, status, image source and interaction. Resolve the protected-geometry
constraint explicitly in the shared design decision.

Verify actual Digital Twin and Mini widgets at 360/390/430px with saved scales
0.85/1/1.35, both themes, keyboard and forced-color focus, no clipping or
horizontal page scroll and unchanged vehicle imagery.

## Dashboard layout-switcher accessible name

The selected layout appears in the trigger visually, but its fixed accessible
name is “Switch dashboard layout” and does not include that selection.
Please expose the currently selected layout in the control's accessible name
or associated accessible description, while retaining the switcher's existing
keyboard and menu behavior. Check long names and updates after selection.
