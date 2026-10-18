# Side navigation review artifacts

The original coverage contract is `nav-coverage.json` (22 sections, 199 destinations). The design, decisions, commands, results and legacy-test limitation are recorded in [the plan](../sidenav-redesign-plan.md).

## Screenshot matrix

Screenshots use the actual application with the existing populated API fixture, Microsoft Edge (`msedge`) and the isolated development server on port 3100. Each viewport is 900px tall.

| Width | Dark | Light |
| --- | --- | --- |
| 375px | [phone-tabs](dark-375-phone-tabs.png) · [more-sheet](dark-375-more-sheet.png) · [section-sheet](dark-375-section-sheet.png) | [phone-tabs](light-375-phone-tabs.png) · [more-sheet](light-375-more-sheet.png) · [section-sheet](light-375-section-sheet.png) |
| 768px | [tablet-drawer](dark-768-tablet-drawer.png) · [rail-collapsed](dark-768-rail-collapsed.png) · [rail-scrolled](dark-768-rail-scrolled.png) | [tablet-drawer](light-768-tablet-drawer.png) · [rail-collapsed](light-768-rail-collapsed.png) · [rail-scrolled](light-768-rail-scrolled.png) |
| 1280px | [panel-open](dark-1280-panel-open.png) · [rail-collapsed](dark-1280-rail-collapsed.png) · [rail-scrolled](dark-1280-rail-scrolled.png) | [panel-open](light-1280-panel-open.png) · [rail-collapsed](light-1280-rail-collapsed.png) · [rail-scrolled](light-1280-rail-scrolled.png) |
| 1920px | [panel-open](dark-1920-panel-open.png) · [rail-collapsed](dark-1920-rail-collapsed.png) · [rail-scrolled](dark-1920-rail-scrolled.png) | [panel-open](light-1920-panel-open.png) · [rail-collapsed](light-1920-rail-collapsed.png) · [rail-scrolled](light-1920-rail-scrolled.png) |

Phone views intentionally have no rail. Tablet views show the rail with an overlay drawer. At 1280px and 1920px the panel docks beside the rail.
