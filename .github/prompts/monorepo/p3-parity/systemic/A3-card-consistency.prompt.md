---
description: "P3 systemic — consistent card/panel surfaces (WinUI 3)"
---

# P3 - systemic - card / surface consistency

> **Severity:** Systemic / high-visible - **Delegation:** FORBIDDEN - **Target:** windows
> User complaint: "cards are non consistent." Audit the shared surface components and their usage
> so every card/panel across the app has consistent padding, corner radius, border, background,
> header style, and spacing - matching the web ``GlassPanel`` / ``Card`` look.

## Targets
| | |
|---|---|
| Web source (parity target) | ``web/src/components/ui/GlassPanel.tsx``, ``Card.tsx`` (radius, border, bg, padding, header) |
| Windows shared components | ``apps/windows/TeslaSync.App/Components/**`` (``TsGlassPanel``, ``TsCard``, ``TsCardHeader``, ``PageContainer``, ``Styles.xaml``) |
| Build | ``dotnet build apps/windows/TeslaSync.sln -c Release`` must end 0 errors |

## Mandatory work
1. **Define the canonical surface** in the shared components: one set of tokens for corner radius,
   border thickness/color, background (theme brush, NOT hardcoded), padding, and header typography -
   matching the web GlassPanel/Card.
2. **Audit usages**: grep the feature-views for ad-hoc ``Border``/``Grid`` cards, hardcoded colors,
   inconsistent ``Padding``/``CornerRadius``/``Margin``, and neon body text. Replace them with the
   shared ``TsGlassPanel`` / ``TsCard``.
3. All surfaces must use **theme brushes / DisplayTokens** (so they re-color with the theme) and a
   single consistent radius + padding. No hardcoded hex. No inconsistent one-off card styling.
4. Verify a few representative pages (Drives, Dashboard, Battery, Settings) render visually
   consistent cards in both light and dark.

## Gate
``````
cd apps/windows ; dotnet build TeslaSync.sln -c Release   # 0 errors
``````
Log ends with ``EXIT=<int>`` and ``STATUS=<DONE|BLOCKED>``.
