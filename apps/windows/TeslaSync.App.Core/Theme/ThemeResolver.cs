using TeslaSync.App.Core.Settings;

namespace TeslaSync.App.Core.Theme;

/// <summary>
/// The effective, rendered theme a surface resolves to after folding the user's persisted
/// <see cref="AppThemePreference"/> together with the OS accessibility state. Unlike the stored
/// preference (System/Light/Dark), this also models <see cref="HighContrast"/>, because Windows
/// drives high contrast from a system accessibility setting rather than an in-app toggle.
/// </summary>
public enum ThemeVariant
{
    /// <summary>Follow the OS app-theme (light/dark) palette.</summary>
    System,

    /// <summary>The light token dictionary.</summary>
    Light,

    /// <summary>The dark token dictionary.</summary>
    Dark,

    /// <summary>The OS high-contrast palette, which overrides any light/dark preference.</summary>
    HighContrast,
}

/// <summary>
/// Pure, headless resolution of the effective <see cref="ThemeVariant"/> (port of the web
/// <c>useTheme</c> high-contrast handling). The WinUI shell reads the OS high-contrast flag and the
/// persisted <see cref="AppThemePreference"/> and passes them here, so the "high contrast overrides
/// the user's light/dark choice, and both high-contrast and system defer to the OS palette" policy
/// lives in one unit-tested place instead of being implicit in the render boundary.
/// </summary>
public static class ThemeResolver
{
    /// <summary>
    /// Resolves the effective theme. When <paramref name="systemHighContrast"/> is set the result is
    /// always <see cref="ThemeVariant.HighContrast"/> regardless of <paramref name="preference"/>;
    /// otherwise the persisted preference maps straight through.
    /// </summary>
    public static ThemeVariant Resolve(AppThemePreference preference, bool systemHighContrast)
    {
        if (systemHighContrast)
        {
            return ThemeVariant.HighContrast;
        }

        return preference switch
        {
            AppThemePreference.Light => ThemeVariant.Light,
            AppThemePreference.Dark => ThemeVariant.Dark,
            _ => ThemeVariant.System,
        };
    }

    /// <summary>
    /// Whether the variant should defer to the OS palette rather than forcing an explicit light or
    /// dark theme. True for <see cref="ThemeVariant.System"/> and <see cref="ThemeVariant.HighContrast"/> —
    /// under high contrast an app must not override the system-chosen colours.
    /// </summary>
    public static bool DefersToSystemPalette(ThemeVariant variant) =>
        variant is ThemeVariant.System or ThemeVariant.HighContrast;
}
