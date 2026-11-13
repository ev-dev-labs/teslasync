# Editorial shared follow-up

The final 390px capture failed on all three pages. Do not waive these checks or
change the protected widgets through pack CSS.

1. The bottom-navigation labels render at 16px, but their parent
   `.sidenav-phone-tab` buttons compute to 11px after the late-loaded sidenav
   stylesheet. The body-text diagnostic flags all five buttons on dashboard,
   drives and energy. Set the shared button's inherited font size to the
   existing phone body-size token and verify its two-row geometry, label
   wrapping, forced colors and saved font scales without weakening the check.
2. The dashboard also reported 12px “All drives” and “Open vehicle” links, a
   14px recent-drive context, and a 12px metric unit. Inspect the existing
   app-owned WidgetShell footer and recent-drive text roles and apply the phone
   text floor where these are body content, without touching widget-only
   previews or protected subtrees.
3. The protected Digital Twin composition still reports a 36×36 “Open” target,
   a 10×28 refresh target, and 14px heading/content. Resolve these through an
   approved protected-widget approach that preserves its geometry and imagery;
   this worker did not alter it.
4. Axe reported no violations but could not determine contrast for one
   overlapping phone Drives node, four desktop Drives nodes and 19 desktop
   Energy nodes. Manually verify the indicated chart/legend and overlap cases;
   incomplete findings are not contrast passes.
