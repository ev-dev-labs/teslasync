# Cyberdeck shared follow-up request

The first 390px dashboard capture (default font scale, Cyberdeck) failed
touch-target and body-text diagnostics inside the protected Digital Twin:

- Its `Open` link measured 36×36px.
- Its freshness button measured 10×28px.
- Its heading, body, and name included computed text sizes below 16px.

The pack worker cannot target `[data-app-design-preserve]` or change the
Digital Twin subtree. Please inspect and fix these controls and text in their
owning shared/widget layer, maintaining behavior, imagery, keyboard focus,
minimum 44px targets, and the shared phone text-size floor. Re-run the
390px dashboard diagnostic afterward; these findings are not a pass. The
final capture still measured the controls at those dimensions and the
`Digital twin`, `—`, and `Aurora` text at 14px.

The separately owned Cyberdeck widget scanline treatments also leave some
text backgrounds indeterminate to Axe. Please manually evaluate those
foreground/background combinations and change the widget layer only if
needed. The application canvas was corrected after the final capture, so the
full-route contrast results need to be rerun before drawing conclusions.
