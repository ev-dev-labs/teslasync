# Design pack decisions

## Identity and existing preferences

Keep all 27 persisted IDs, names and aliases. The existing verified,
server-scoped preference remains authoritative: do not introduce a browser
cache that can apply another identity's choice. Pack presentation must compose
with the saved mode, accent, fonts, density and accessibility preferences
rather than overwrite them. Keep the existing Card, GlassPanel, DataTable and
ChartContainer APIs and owner isolation; add presentation roles at their
existing token boundary where necessary.

Use restrained, accessible depth and outlines rather than decorative colored
glows. The design contract requires semantic colors, focus visibility, reduced
motion and forced-color support regardless of the pack.

## Visual evidence

Use isolated synthetic API fixtures and block external requests for screenshot
reviews. The capture matrix uses 390 x 844, 768 x 1024 and 1440 x 900, plus
360 x 800 and 430 x 932 for the requested phone-width extremes. Include
production routes and known detail fixtures; missing fixtures, runtime errors,
overflow and incomplete captures are failures, not visual passes. Do not mark
a pack passed until its screenshots have been inspected and all requested
gates have actually run.

## Protected surfaces

Keep the Digital Twin and Digital Twin Mini layouts and existing Tesla vehicle
images. Pack changes may affect their existing presentation tokens, not their
data, geometry, interactions or image assets.
