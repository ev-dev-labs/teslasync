# Material Play shared-fix request

## Protected Digital Twin phone accessibility

`DECISIONS.md` records a 390px dashboard diagnostic with the protected twin's
Open control at 36×36px, Refresh at 10×28px, and body text around 14px.
Material has not independently captured these controls. The
`data-app-design-preserve` boundary prevents a pack-only fix.

Please provide 44×44px hit areas and at least 16px phone body text in the
shared twin/widget owners, while retaining the vehicle imagery, data and
interactions. Coordinate the protected-geometry requirement before changing
the existing composition, and verify both twin variants on phones.

The Material 390px capture independently reproduced 36×36px Open, 10×28px
Refresh, and 14px “Digital twin”, “—”, and “Aurora” text. It also reported a
12px `km` metric unit without enough ancestry in the diagnostic to identify
its owner. After the Material phone metric-unit adjustment, the second
capture no longer reported the `km` text; the protected twin findings remain.

## Dashboard layout accessible name

`LayoutSwitcher` sets a static accessible name (“Switch dashboard layout”)
on the trigger, masking the visible selected layout name. Include the current
layout in the localized accessible name or description without changing the
menu interaction.

## Capture fixture timing, observed once

The first desktop dashboard capture failed because the mocked same-origin
`GET /api/v1/pinned` remained pending. The second desktop dashboard capture
passed, including the routing assertion, so this is not a confirmed
persistent failure. If it recurs, make the fixture settle without weakening
the assertion.
