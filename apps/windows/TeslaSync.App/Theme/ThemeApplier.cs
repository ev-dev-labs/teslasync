using System;
using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.SharedSurfaces.ThemeProviderSurface;
using Color = Windows.UI.Color;

namespace TeslaSync.App.Theme;

/// <summary>
/// Applies a selected accent <see cref="ColorTheme"/> + display <see cref="ModeTheme"/> across the whole
/// app — the WinUI analogue of the web <c>applyThemeCSS</c> side-effect. Where the web writes CSS custom
/// properties on <c>document.documentElement</c>, this republishes the generated <c>TsColor*</c> token
/// brushes (and the Fluent <c>SystemAccentColor</c> family) into <see cref="Application.Resources"/> so every
/// surface that resolves a token brush — directly via <c>DisplayTokens.Brush</c> or via <c>{ThemeResource}</c>
/// — recolours to the chosen palette. Pure colour maths is delegated to the shared
/// <see cref="ThemeCatalog"/>/<see cref="ModeCatalog"/> so this layer only does the resource publish.
/// </summary>
public static class ThemeApplier
{
    /// <summary>
    /// Resolve <paramref name="accentThemeId"/> + <paramref name="colorModeId"/> (web ids) against the shared
    /// catalog, publish the resulting palette to the application resources, and — when a <paramref name="root"/>
    /// is supplied — set its <see cref="FrameworkElement.RequestedTheme"/> from the mode's light/dark scheme.
    /// Returns the effective <see cref="ElementTheme"/> so the caller can keep its persisted window state in sync.
    /// </summary>
    public static ElementTheme Apply(string? accentThemeId, string? colorModeId, bool systemDark, FrameworkElement? root)
    {
        ColorTheme theme = ThemeCatalog.Resolve(
            ParseTheme(accentThemeId),
            ThemeCatalog.DefaultCustomPrimary,
            ThemeCatalog.DefaultCustomAccent);
        ModeTheme mode = ModeCatalog.Resolve(ParseMode(colorModeId), systemDark);

        Publish(theme, mode);

        ElementTheme element = mode.ColorScheme == ColorScheme.Light ? ElementTheme.Light : ElementTheme.Dark;
        if (root is not null)
        {
            root.RequestedTheme = element;
        }

        return element;
    }

    /// <summary>The effective <see cref="ElementTheme"/> a mode id maps to (without touching resources).</summary>
    public static ElementTheme ElementThemeFor(string? colorModeId, bool systemDark) =>
        ModeCatalog.Resolve(ParseMode(colorModeId), systemDark).ColorScheme == ColorScheme.Light
            ? ElementTheme.Light
            : ElementTheme.Dark;

    private static void Publish(ColorTheme theme, ModeTheme mode)
    {
        if (Application.Current?.Resources is not { } res)
        {
            return;
        }

        Color accent = ParseColor(theme.Primary);
        Color bg = ParseColor(mode.Background);
        Color surface = ParseColor(mode.Surface1);
        Color textPrimary = ParseColor(mode.TextPrimary);

        // ── Generated TsColor* tokens (consumed by DisplayTokens.Brush + {ThemeResource}) ──────────────
        SetColorAndBrush(res, "TsColorAccent", accent);
        SetColorAndBrush(res, "TsColorInfo", accent);
        SetColorAndBrush(res, "TsColorBg", bg);
        SetColorAndBrush(res, "TsColorSurface", surface);
        SetColorAndBrush(res, "TsColorSurfaceGlass", ParseColor(mode.GlassBackground));
        SetColorAndBrush(res, "TsColorTextPrimary", textPrimary);
        SetColorAndBrush(res, "TsColorTextSecondary", ParseColor(mode.TextSecondary));
        SetColorAndBrush(res, "TsColorTextMuted", ParseColor(mode.TextMuted));
        SetColorAndBrush(res, "TsColorBorder", ParseColor(mode.GlassBorder));

        // ── Fluent surface/elevation brushes (Themes/Dark.xaml + Themes/Tokens.xaml material roles) ─────
        res["TsAppRootBackgroundBrush"] = new SolidColorBrush(bg);
        res["TsAppContentForegroundBrush"] = new SolidColorBrush(textPrimary);
        res["TsSurfaceRaisedBrush"] = Acrylic(surface, 0.4);
        res["TsSurfaceOverlayBrush"] = Acrylic(surface, 0.7);
        res["TsMaterialOverlayBrush"] = Acrylic(surface, 0.6);
        res["TsMaterialModalBrush"] = Acrylic(surface, 0.8);

        // ── Fluent system accent family (Buttons, ToggleSwitch, NavigationView selection, etc.) ─────────
        res["SystemAccentColor"] = accent;
        res["SystemAccentColorLight1"] = accent;
        res["SystemAccentColorLight2"] = accent;
        res["SystemAccentColorLight3"] = accent;
        res["SystemAccentColorDark1"] = accent;
        res["SystemAccentColorDark2"] = accent;
        res["SystemAccentColorDark3"] = accent;
        res["AccentFillColorDefaultBrush"] = new SolidColorBrush(accent);
        res["AccentFillColorSecondaryBrush"] = new SolidColorBrush(WithAlpha(accent, 0.9));
        res["AccentFillColorTertiaryBrush"] = new SolidColorBrush(WithAlpha(accent, 0.8));
    }

    private static void SetColorAndBrush(ResourceDictionary res, string baseKey, Color color)
    {
        res[baseKey + "Color"] = color;
        res[baseKey + "Brush"] = new SolidColorBrush(color);
    }

    private static AcrylicBrush Acrylic(Color tint, double opacity) => new()
    {
        TintColor = tint,
        TintOpacity = opacity,
        FallbackColor = tint,
    };

    private static Color WithAlpha(Color color, double alpha) =>
        Color.FromArgb((byte)Math.Clamp(Math.Round(alpha * 255), 0, 255), color.R, color.G, color.B);

    private static ThemeId ParseTheme(string? id) => (id ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "neon-cyan" => ThemeId.NeonCyan,
        "tesla-red" => ThemeId.TeslaRed,
        "matrix-green" => ThemeId.MatrixGreen,
        "royal-purple" => ThemeId.RoyalPurple,
        "solar-amber" => ThemeId.SolarAmber,
        "custom" => ThemeId.Custom,
        _ => ThemeId.NeonCyan,
    };

    private static ModeId ParseMode(string? id) => (id ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "dark" => ModeId.Dark,
        "light" => ModeId.Light,
        "oled" => ModeId.Oled,
        "midnight" => ModeId.Midnight,
        "auto" => ModeId.Auto,
        "sunset" => ModeId.Sunset,
        "nord" => ModeId.Nord,
        _ => ModeId.Dark,
    };

    /// <summary>Parses a CSS colour string — <c>#RGB</c>/<c>#RRGGBB</c>/<c>#AARRGGBB</c> or <c>rgba(r,g,b,a)</c>.</summary>
    private static Color ParseColor(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return Microsoft.UI.Colors.Transparent;
        }

        string s = value.Trim();
        if (s.StartsWith("rgb", StringComparison.OrdinalIgnoreCase))
        {
            return ParseRgba(s);
        }

        s = s.TrimStart('#');
        if (s.Length == 3)
        {
            s = string.Concat(s[0], s[0], s[1], s[1], s[2], s[2]);
        }

        if (s.Length == 6)
        {
            s = "FF" + s;
        }

        if (s.Length == 8 &&
            byte.TryParse(s.AsSpan(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte a) &&
            byte.TryParse(s.AsSpan(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte r) &&
            byte.TryParse(s.AsSpan(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte g) &&
            byte.TryParse(s.AsSpan(6, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte b))
        {
            return Color.FromArgb(a, r, g, b);
        }

        return Microsoft.UI.Colors.Transparent;
    }

    private static Color ParseRgba(string value)
    {
        int open = value.IndexOf('(');
        int close = value.IndexOf(')');
        if (open < 0 || close <= open)
        {
            return Microsoft.UI.Colors.Transparent;
        }

        string[] parts = value.Substring(open + 1, close - open - 1).Split(',');
        if (parts.Length < 3)
        {
            return Microsoft.UI.Colors.Transparent;
        }

        byte r = ClampByte(parts[0]);
        byte g = ClampByte(parts[1]);
        byte b = ClampByte(parts[2]);
        byte a = 255;
        if (parts.Length >= 4 &&
            double.TryParse(parts[3].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double alpha))
        {
            a = (byte)Math.Clamp(Math.Round(alpha * 255), 0, 255);
        }

        return Color.FromArgb(a, r, g, b);
    }

    private static byte ClampByte(string component) =>
        double.TryParse(component.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double v)
            ? (byte)Math.Clamp(v, 0, 255)
            : (byte)0;
}
