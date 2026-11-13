# Atlas shared-owner requests

## Protected Digital Twin mobile accessibility

The 390px dashboard review found the **Open** action at 36×36 CSS px and the
edge-aligned **Refresh data** target at 10×28 CSS px. The protected
`vehicle-twin` / `digital-twin-mini` subtrees intentionally receive no
application-pack owner, so Atlas cannot safely enlarge them. Please update the
Digital Twin/shared widget owners (`DigitalTwinMiniWidget`, `WidgetShell`,
`FreshnessDot`/`IconButton`) to provide at least 44×44px hit areas at phone
widths, and verify both twins with real pointer and keyboard interaction.
Several protected body/readout strings, including “Digital twin”, “Aurora”
and the unknown-state dash, were reported at 14px in the synthetic review;
please check the 16px phone body-text requirement without changing imagery,
status meaning, or the protected scene geometry.

## Native metric context on phones

The Recent drives widget's native `WidgetBigNumber` subtitle, for example
“Today … · 30 min”, is 14px at 390px. Shared mobile typography excludes
headline-metric descendants, and native composition preservation tests
explicitly keep pack sheets from styling those slots. Please make the shared
metric-context typography readable at 16px on phones, retaining native
numeric paint, sizing, readings, layout and protected-widget boundaries, and
add a shared regression. This is not a pack-level accessibility pass.

## Capture harness pending request

The final desktop dashboard capture timed out at `assertMockApiComplete` with
`GET /api/v1/pinned` still pending after five seconds. Please investigate the
shared mock-routing/request lifecycle and repeat that contract when a fresh
capture is authorized. The failure does not establish that the request
escaped the mocks, and it prevented the desktop dashboard contrast audit.
