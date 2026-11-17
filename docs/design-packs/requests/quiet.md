# Quiet Form shared requests

- Preserve semantic metric-tile surfaces in the shared table composition.
  `web\src\components\ui\app-designs\feedback.css` applies
  `background: transparent` and `border: 0` to every
  `[data-app-metric="tile"]` in table mode, including warning and danger
  bands in `UsageCard`. Their `data-app-tone` and semantic background/border
  tokens are therefore lost for other table-mode packs. Quiet restores its
  own warning and danger treatments; please fix the shared rule and add
  light/dark regression coverage. This finding is based on the CSS and
  component markup; browser confirmation is still pending.
- Resolve the previously documented protected Digital Twin phone-accessibility
  conflict without changing the preserved subtree or vehicle imagery.
  `DECISIONS.md` records 36 × 36px and 10 × 28px controls and 14.1px text at
  390px, below the requested 44px targets and 16px body minimum.
