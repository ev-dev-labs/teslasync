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

## Native metric context on phones — addressed for Atlas

The ordinary Recent drives subtitle was 14px at the default scale and 11.9px
at scale 0.85. Atlas now applies the body-size token to owned headline context
and units on phones, excluding protected twins, native gauges, specialized
metrics, and report/kiosk presentations. Real-route mocked-data checks cover
360/390/430px, both themes, forced colors and three font scales; selector
tests cover the exclusions and ownership. This is not a pack-level
accessibility pass or a change to the shared metric component.

## Capture harness pending request

The final desktop dashboard capture timed out at `assertMockApiComplete` with
`GET /api/v1/pinned` still pending after five seconds. Please investigate the
shared mock-routing/request lifecycle and repeat that contract when a fresh
capture is authorized. The failure does not establish that the request
escaped the mocks, and it prevented the desktop dashboard contrast audit.
