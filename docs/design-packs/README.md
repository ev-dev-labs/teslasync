# Application design packs

The register in [PACKS.md](PACKS.md) is the authoritative list of the 27
persisted IDs, concepts, and review states. `passed-with-notes` is a bounded
review with unresolved or unverified requirements, not an accessibility or
full-application pass. See the individual `REVIEW-<id>.md` files and
[DECISIONS.md](DECISIONS.md) for evidence and coverage gaps.

## Selection and ownership

The verified server and identity scope own the saved pack and the
widget-only/application-wide choice. `AppDesignBridge` applies an opted-in
application profile on layout routes. `designs.ts` defines the navigation,
header, content, controls, data, chart, map, and feedback composition roles;
`appDesignPacks.css` loads the category styles and pack sheets.
`data-app-design-owner` confines rules to the nearest complete profile,
including isolated previews and portals. `data-app-design-preserve` protects
the original Digital Twin widget compositions.
On the initial shell load, the bridge waits for the verified preference and
its presentation modules before revealing the layout. If loading fails, users
can retry or explicitly continue without waiting; later preference refreshes
do not unmount an active layout.

The Appearance gallery renders an isolated, synthetic application thumbnail
for every pack. Its sample sparkline uses the saved chart palette; changing a
preview does not change the active selection or issue vehicle commands.

The existing theme, font, density, semantic-color, and chart-palette settings
remain authoritative. Packs compose their surfaces and treatments from those
preferences rather than replace them. The current bridge does not cover the
standalone routes listed in `DECISIONS.md`.

## Token contract

Pack sheets can supply four elevation roles:
`--app-surface-canvas`, `--app-surface-panel`, `--app-surface-raised`, and
`--app-surface-overlay`. Text, borders, accent, semantic states, and series
colors come from the existing theme and chart palette.
On phones, chart fallback tables use the shared stacked-table presentation
with their original captions, headings, and localized cell labels.

`--app-display-font`, `--app-display-weight`, and `--app-display-tracking`
compose the saved typography preferences. `--app-card-radius`,
`--app-card-shadow`, `--app-control-radius`, `--app-control-surface`,
`--app-content-density`, `--app-interaction-duration`, and
`--app-interaction-easing` describe shared treatments. Grid, chart, and Helix
use `--app-grid-*`, `--app-chart-*`, and `--app-conversation-*` roles.
See each pack sheet for its actual assignments; the role names do not imply
that every component is already tokenized or that chart series differ by pack.
Any new inherited `--app-*` property must also be reset at the preview
boundary in `base.css`.

The composition columns below are the navigation/header/content roles from
`APPLICATION_DESIGNS`; the corresponding stylesheet contains the remaining pack
tokens and component treatments.

| Pack | Concept and signature | Navigation / header / content | Sheet |
| --- | --- | --- | --- |
| Classic (`classic`) | Calm, balanced frame and active underline | rail / banner / cards | `classic.css` |
| Telemetry Studio (`v1`) | Engineering instruments with calibrated rules | rail / instrument / workbench | `studio.css` |
| Horizon Loft (`v2`) | Airy, softly elevated islands | sidebar / split / cards | `elevated.css` |
| Precision Ledger (`v3`) | Compact, aligned figures and fine row rules | rail / compact / ledger | `precision.css` |
| Executive Concierge (`v4`) | Curated decisions with a vertical guide | sidebar / banner / cards | `concierge.css` |
| Iconic Showroom (`v5`) | Spacious automotive canvas and inset captions | hybrid / masthead / canvas | `iconic.css` |
| Expressive Form (`v6`) | Geometric blocks and asymmetric actions | top / split / canvas | `expressive.css` |
| Pixel Cockpit (`v7`) | Squared digital panels and stepped marks | rail / instrument / workbench | `pixel.css` |
| Motorsport (`motorsport`) | Pit-wall instruments and directional readings | hybrid / instrument / workbench | `motorsport.css` |
| Blueprint (`blueprint`) | Drafting-room workbench and construction lines | sidebar / instrument / workbench | `blueprint.css` |
| Editorial (`editorial`) | Automotive journal and strong section rules | top / masthead / editorial | `editorial.css` |
| Ambient (`ambient`) | Quiet floating content and restrained surface wash | sidebar / split / canvas | `ambient.css` |
| Terminal (`terminal`) | Linear operational ledger and prompt markers | rail / compact / ledger | `terminal.css` |
| Atlas (`atlas`) | Route-planning frames and coordinate labels | hybrid / banner / canvas | `atlas.css` |
| Analog (`analog`) | Tactile instrument groupings and inset rings | sidebar / instrument / cards | `analog.css` |
| Observatory (`observatory`) | Scientific plots and crosshair alignment | rail / split / canvas | `observatory.css` |
| Bauhaus (`bauhaus`) | Modernist modular grid and shape-led emphasis | top / split / cards | `bauhaus.css` |
| Quiet Form (`quiet`) | Minimal reading column and delicate separators | rail / compact / editorial | `quiet.css` |
| Warm Modern (`warm`) | Welcoming rounded layers and gentle masthead | sidebar / masthead / editorial | `warm.css` |
| Swiss Grid (`swiss`) | Objective modular baseline and precise rules | top / compact / ledger | `swiss.css` |
| Material Play (`material`) | Tactile elevation and tonal controls | hybrid / banner / cards | `material.css` |
| Glass Current (`glass`) | Fluid transparent layers and reflected edges | sidebar / split / canvas | `glass.css` |
| Deco Grand (`deco`) | Formal symmetry and paired fine rules | top / masthead / editorial | `deco.css` |
| Kinetic Type (`kinetic`) | Typographic workbench and directional header | hybrid / instrument / workbench | `kinetic.css` |
| Neo Brutal (`brutal`) | Direct structural outlines and offset edge | top / banner / workbench | `brutal.css` |
| Cyberdeck (`cyber`) | Segmented instruments and circuit-like framing | rail / instrument / canvas | `cyber.css` |
| Memphis Pop (`memphis`) | Playful geometric groups and patterned accents | hybrid / split / canvas | `memphis.css` |

## Future packs

This redesign retains the existing IDs; adding a pack is a separate change.
For a future addition, register a stable ID, availability, appearance and
appropriate compatibility aliases in `designPacks/types.ts`; add manifest,
layout and localized name/description metadata; and provide the widget
presentations. Add its complete composition and stylesheet mapping in
`app-designs/designs.ts`, import its owner-qualified stylesheet in
`appDesignPacks.css`, and reset any new inherited app token at preview
boundaries. Preserve widget geometry, native controls, saved preferences, and
forced-color/reduced-motion behavior.

Run the relevant component and ownership contracts, TypeScript, lint and
build. Review real phone and desktop states, including touch, contrast,
keyboard and non-default preferences. The bounded screenshot runner requires
an already-running local server and never manages it:

```powershell
Set-Location web
$env:DESIGN_PACK_BROWSER_CHANNEL='msedge'
$env:DESIGN_PACK_FONT_SCALE='1'
$env:DESIGN_PACK_CHECK_CONTRAST='1'
$env:DESIGN_PACK_CAPTURE_BASE_URL='http://127.0.0.1:5173'
node scripts\capture-design-packs.mjs --pack classic --pages dashboard,drives,energy --viewports phone-390,desktop --base-url $env:DESIGN_PACK_CAPTURE_BASE_URL
```

Images are written under `shots\<pack>\<viewport>\<page>.png`. A saved image
does not imply that the associated diagnostics passed. Set the example origin
to the actual already-running server; the runner does not start it. Set
`DESIGN_PACK_SHOTS_ROOT` to a separate absolute directory for a final matrix
when the default paths already contain review evidence. Optionally set
`DESIGN_PACK_DIST_DIR` to a verified production build's absolute `dist` path
to route its index and assets through the same local origin; fixture and
diagnostic checks still run normally. Set `DESIGN_PACK_SKIP_EXISTING=1` to
resume without replacing existing viewport images. Skipped images are not
passing results; retain and inspect their original diagnostics separately.
Use `DESIGN_PACK_CHECK_ONLY=1` to rerun diagnostics without taking, deleting,
or replacing screenshots.
