---
description: "P3 systemic — apply the full theme system app-wide (WinUI 3)"
---

# P3 - systemic - theme system (5 themes x 7 modes, applied app-wide)

> **Severity:** Systemic / highest-impact - **Delegation:** FORBIDDEN - **Target:** windows
> The user's #1 complaint: "themes not working, only 2 themes." The web has **5 color themes
> x 7 modes + custom**; the Windows app only applies light/dark via ElementTheme. Wire the
> EXISTING Windows ThemeProvider so selecting a theme+mode actually re-colors the whole app.

## Targets
| | |
|---|---|
| Web source (parity target) | ``web/src/components/ui/ThemeProvider.tsx`` (THEMES + MODES + ``applyThemeCSS``) and ``ThemePicker.tsx`` |
| Web themes | neon-cyan, tesla-red, matrix-green, royal-purple, solar-amber, custom |
| Web modes | dark, light, oled, midnight, auto, sunset, nord |
| Windows existing | ``apps/windows/TeslaSync.App/shared-surfaces/ThemeProvider*.cs`` (ThemeId/ModeId enums + palette already defined), ``TeslaSync.App.Core/Theme/ThemeResolver.cs``, ``AppSettings.AppThemePreference`` |
| Build | ``dotnet build apps/windows/TeslaSync.sln -c Release`` must end 0 errors |

## Mandatory work
1. **Persist** the selected ``ThemeId`` + ``ModeId`` (and custom primary/accent) in AppSettings/LocalSettings
   (currently only AppThemePreference = System/Light/Dark exists - extend it).
2. **Apply app-wide**: build a theme service that, on selection and on startup, sets the WinUI
   resources from the resolved palette - at minimum the **accent color** (SystemAccentColor + the
   ``ThemeProviderAccentBrush`` and any ``Accent*`` theme brushes) and the **mode** (Light/Dark base
   plus the oled/midnight/sunset/nord background+foreground overrides). Update
   ``Application.Current.Resources`` / merged ThemeDictionaries so EVERY page re-colors live.
3. **Mode mapping**: dark/light -> ElementTheme; oled -> pure-black bg; midnight -> deep blue;
   sunset/nord -> their palettes; auto -> follow system. Match the web ``modes`` values.
4. **UI**: expose the full ``TsThemePicker`` (themes grid + modes grid + custom colors) in the
   Appearance/Settings page (web AppearanceSettings.tsx parity), wired to the service. Each pick
   re-colors the app immediately and persists.
5. **Verify**: switching theme changes accent across pages (buttons, chips, charts, selection);
   switching mode changes the background; the choice survives an app restart.

## Forbidden
- Leaving only light/dark. Hardcoding. Stubs. A picker that doesn't actually re-color the app.

## Gate
``````
cd apps/windows ; dotnet build TeslaSync.sln -c Release   # 0 errors
``````
Log ends with ``EXIT=<int>`` and ``STATUS=<DONE|BLOCKED>``.
