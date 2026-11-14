# Design packs: baseline audit

The 27 stable IDs and aliases live in `designPacks/types.ts`. A verified,
server-scoped preference selects widget styling and, when opted in, an
application profile. `AppDesignBridge` installs that profile; `designs.ts`
chooses shell, header, control, data, chart, map and feedback compositions.
Category styles and the individual pack sheet style owner-qualified shared
parts; nested previews and preserved Digital Twins have separate ownership.
Theme, font, density and chart preferences remain independently authoritative.

The designs lack a coherent pack-level token set for surface elevation, type,
spacing, motion and component treatments. Similar accent washes, borders and
repeated metric rules make several profiles feel like recolors. Default 14px
body copy and uneven control sizes are weak on phones; the two-row navigation
can also consume too much content space. Mixed surfaces and text still need
rendered contrast checks, not assumptions from their source colors.

The settings grid previews a widget rather than the whole application, and
the asynchronous verified preference can produce a theme transition at load.
The existing mobile grid, safe-area navigation, original vehicle images and
protected twins must be retained. Earlier targeted checks and screenshots are
recorded in `REVIEW-classic.md`; they are not acceptance of the other packs.
