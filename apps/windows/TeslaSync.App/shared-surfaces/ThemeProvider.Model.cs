using System.Globalization;

namespace TeslaSync.App.SharedSurfaces.ThemeProviderSurface;

/// <summary>
/// The colour-theme identity (web <c>ThemeId</c> string union in
/// <c>web/src/components/ui/ThemeProvider.tsx</c>). The persisted / broadcast wire value is the
/// kebab-case string id (e.g. <c>neon-cyan</c>); <see cref="ThemeCatalog.ToWireId"/> /
/// <see cref="ThemeCatalog.TryParseId"/> map between the two and reproduce the web
/// <c>saved in themes</c> validation (an unknown wire id parses to <c>null</c>, falling back to the
/// default rather than applying a bogus theme).
/// </summary>
public enum ThemeId
{
    /// <summary>The default cyan theme (web <c>neon-cyan</c>).</summary>
    NeonCyan,

    /// <summary>The Tesla-red theme (web <c>tesla-red</c>).</summary>
    TeslaRed,

    /// <summary>The matrix-green theme (web <c>matrix-green</c>).</summary>
    MatrixGreen,

    /// <summary>The royal-purple theme (web <c>royal-purple</c>).</summary>
    RoyalPurple,

    /// <summary>The solar-amber theme (web <c>solar-amber</c>).</summary>
    SolarAmber,

    /// <summary>The user-defined theme built from custom primary/accent colours (web <c>custom</c>).</summary>
    Custom,
}

/// <summary>
/// The display-mode identity (web <c>ModeId</c> string union). The persisted / broadcast wire value
/// is the lower-case string id (e.g. <c>midnight</c>). <see cref="ModeId.Auto"/> is special: it never
/// renders its own palette — <see cref="ModeCatalog.Resolve"/> folds it to <see cref="ModeId.Dark"/>
/// or <see cref="ModeId.Light"/> from the OS colour-scheme preference (web
/// <c>modeId === 'auto' ? (systemDark ? modes.dark : modes.light) : modes[modeId]</c>).
/// </summary>
public enum ModeId
{
    /// <summary>The default dark mode.</summary>
    Dark,

    /// <summary>The light mode.</summary>
    Light,

    /// <summary>The pure-black OLED mode.</summary>
    Oled,

    /// <summary>The midnight-blue mode.</summary>
    Midnight,

    /// <summary>Follow the OS colour-scheme preference (resolves to dark or light).</summary>
    Auto,

    /// <summary>The warm sunset mode.</summary>
    Sunset,

    /// <summary>The Nord mode.</summary>
    Nord,
}

/// <summary>The light/dark intent a <see cref="ModeTheme"/> declares (web <c>colorScheme</c>).</summary>
public enum ColorScheme
{
    /// <summary>A dark palette (web <c>'dark'</c>).</summary>
    Dark,

    /// <summary>A light palette (web <c>'light'</c>).</summary>
    Light,
}

/// <summary>
/// A colour theme — the native port of the web <c>ColorTheme</c> interface. Colours are kept as the
/// source CSS strings (a <c>#rrggbb</c> hex plus the pre-computed <c>"r, g, b"</c> channel triple the
/// web stores alongside it for <c>rgba()</c> composition) so the headless model stays free of any
/// <c>Windows.UI</c> / <c>Microsoft.UI</c> type; the WinUI view converts them to brushes at the render
/// boundary.
/// </summary>
/// <param name="Id">The theme identity.</param>
/// <param name="Name">The human label (web <c>name</c>; not an i18n key — the web source hard-codes it).</param>
/// <param name="Primary">The primary colour as a <c>#rrggbb</c> hex string (web <c>primary</c>).</param>
/// <param name="PrimaryRgb">The primary colour as a <c>"r, g, b"</c> channel triple (web <c>primaryRGB</c>).</param>
/// <param name="Accent">The accent colour as a <c>#rrggbb</c> hex string (web <c>accent</c>).</param>
/// <param name="AccentRgb">The accent colour as a <c>"r, g, b"</c> channel triple (web <c>accentRGB</c>).</param>
public sealed record ColorTheme(
    ThemeId Id,
    string Name,
    string Primary,
    string PrimaryRgb,
    string Accent,
    string AccentRgb);

/// <summary>
/// A display mode — the native port of the web <c>ModeTheme</c> interface. Every field is a CSS colour
/// string (hex or <c>rgba()</c>), kept verbatim from the web source so the model is UI-free and the
/// applied palette is an exact parity artifact.
/// </summary>
/// <param name="Id">The mode identity.</param>
/// <param name="Name">The human label (web <c>name</c>; the web source hard-codes it).</param>
/// <param name="Background">The page background (web <c>bg</c>).</param>
/// <param name="Surface1">The first elevated surface (web <c>surface1</c>).</param>
/// <param name="Surface2">The second elevated surface (web <c>surface2</c>).</param>
/// <param name="Surface3">The third elevated surface (web <c>surface3</c>).</param>
/// <param name="GlassBackground">The translucent glass fill (web <c>glassBg</c>).</param>
/// <param name="GlassBorder">The translucent glass border (web <c>glassBorder</c>).</param>
/// <param name="TextPrimary">The primary text colour (web <c>textPrimary</c>).</param>
/// <param name="TextSecondary">The secondary text colour (web <c>textSecondary</c>).</param>
/// <param name="TextMuted">The muted text colour (web <c>textMuted</c>).</param>
/// <param name="ColorScheme">The light/dark intent (web <c>colorScheme</c>).</param>
public sealed record ModeTheme(
    ModeId Id,
    string Name,
    string Background,
    string Surface1,
    string Surface2,
    string Surface3,
    string GlassBackground,
    string GlassBorder,
    string TextPrimary,
    string TextSecondary,
    string TextMuted,
    ColorScheme ColorScheme);

/// <summary>
/// Pure colour helpers — the native port of the web module-level <c>hexToRGB</c>
/// (<c>web/src/components/ui/ThemeProvider.tsx</c>). Kept side-effect-free and UI-free so the channel
/// maths is unit-testable without a render host.
/// </summary>
public static class ThemeColor
{
    /// <summary>
    /// Convert a <c>#rrggbb</c> hex string to the web <c>"r, g, b"</c> channel triple (web
    /// <c>hexToRGB</c>: <c>parseInt(hex.slice(1,3),16)</c> …). Unlike the web helper — which returns
    /// <c>"NaN, NaN, NaN"</c> for a malformed value — this is null-safe: a value that is not a valid
    /// 7-character <c>#rrggbb</c> string yields <c>"0, 0, 0"</c>, so a hand-edited or corrupt custom
    /// colour can never emit a broken CSS triple.
    /// </summary>
    /// <param name="hex">The colour as a <c>#rrggbb</c> hex string.</param>
    public static string HexToRgb(string hex)
    {
        ArgumentNullException.ThrowIfNull(hex);
        return TryParseHex(hex, out byte r, out byte g, out byte b)
            ? string.Create(CultureInfo.InvariantCulture, $"{r}, {g}, {b}")
            : "0, 0, 0";
    }

    /// <summary>
    /// Parse a <c>#rrggbb</c> hex string into its three byte channels. Returns <c>false</c> (with zeroed
    /// channels) for any value that is not exactly a leading <c>#</c> followed by six hex digits.
    /// </summary>
    /// <param name="hex">The colour string to parse.</param>
    /// <param name="r">The red channel on success.</param>
    /// <param name="g">The green channel on success.</param>
    /// <param name="b">The blue channel on success.</param>
    public static bool TryParseHex(string? hex, out byte r, out byte g, out byte b)
    {
        r = g = b = 0;
        if (string.IsNullOrEmpty(hex) || hex.Length != 7 || hex[0] != '#')
        {
            return false;
        }

        return byte.TryParse(hex.AsSpan(1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out r)
            && byte.TryParse(hex.AsSpan(3, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out g)
            && byte.TryParse(hex.AsSpan(5, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out b);
    }
}

/// <summary>
/// The colour-theme catalog — the native port of the web module-level <c>themes</c> record plus its
/// <c>buildCustomTheme</c> / <c>defaultCustomPrimary|Accent</c> constants. Exposes the five fixed themes,
/// builds the sixth (<see cref="ThemeId.Custom"/>) from a primary/accent pair, maps to/from the persisted
/// wire ids, and resolves the effective <see cref="ColorTheme"/> for a selection (folding the live custom
/// colours in, web <c>currentThemes = {{ ...themes, custom: buildCustomTheme(...) }}</c>).
/// </summary>
public static class ThemeCatalog
{
    /// <summary>The default custom primary colour (web <c>defaultCustomPrimary</c>).</summary>
    public const string DefaultCustomPrimary = "#00b4d8";

    /// <summary>The default custom accent colour (web <c>defaultCustomAccent</c>).</summary>
    public const string DefaultCustomAccent = "#e63946";

    /// <summary>The default theme applied when nothing valid is persisted (web fallback <c>'neon-cyan'</c>).</summary>
    public const ThemeId DefaultId = ThemeId.NeonCyan;

    private static readonly Dictionary<ThemeId, ColorTheme> FixedThemes = new()
    {
        [ThemeId.NeonCyan] = new(ThemeId.NeonCyan, "Neon Cyan", "#00f0ff", "0, 240, 255", "#4f46e5", "79, 70, 229"),
        [ThemeId.TeslaRed] = new(ThemeId.TeslaRed, "Tesla Red", "#e31937", "227, 25, 55", "#ff4060", "255, 64, 96"),
        [ThemeId.MatrixGreen] = new(ThemeId.MatrixGreen, "Matrix Green", "#00ff41", "0, 255, 65", "#10b981", "16, 185, 129"),
        [ThemeId.RoyalPurple] = new(ThemeId.RoyalPurple, "Royal Purple", "#a855f7", "168, 85, 247", "#7c3aed", "124, 58, 237"),
        [ThemeId.SolarAmber] = new(ThemeId.SolarAmber, "Solar Amber", "#f59e0b", "245, 158, 11", "#d97706", "217, 119, 6"),
    };

    private static readonly IReadOnlyList<ThemeId> OrderedIds = new[]
    {
        ThemeId.NeonCyan,
        ThemeId.TeslaRed,
        ThemeId.MatrixGreen,
        ThemeId.RoyalPurple,
        ThemeId.SolarAmber,
        ThemeId.Custom,
    };

    /// <summary>The selectable theme ids in the web declaration order (the five fixed themes plus custom).</summary>
    public static IReadOnlyList<ThemeId> Ids => OrderedIds;

    /// <summary>
    /// Build the custom theme from a primary/accent hex pair (web <c>buildCustomTheme</c>), computing the
    /// channel triples with <see cref="ThemeColor.HexToRgb"/>.
    /// </summary>
    /// <param name="primary">The custom primary colour (<c>#rrggbb</c>).</param>
    /// <param name="accent">The custom accent colour (<c>#rrggbb</c>).</param>
    public static ColorTheme BuildCustom(string primary, string accent)
    {
        ArgumentNullException.ThrowIfNull(primary);
        ArgumentNullException.ThrowIfNull(accent);
        return new ColorTheme(
            ThemeId.Custom,
            "Custom",
            primary,
            ThemeColor.HexToRgb(primary),
            accent,
            ThemeColor.HexToRgb(accent));
    }

    /// <summary>
    /// Resolve the effective <see cref="ColorTheme"/> for <paramref name="themeId"/>, folding the live
    /// custom colours in for <see cref="ThemeId.Custom"/> (web <c>currentThemes[themeId]</c>).
    /// </summary>
    /// <param name="themeId">The selected theme id.</param>
    /// <param name="customPrimary">The current custom primary colour.</param>
    /// <param name="customAccent">The current custom accent colour.</param>
    public static ColorTheme Resolve(ThemeId themeId, string customPrimary, string customAccent)
    {
        if (themeId == ThemeId.Custom)
        {
            return BuildCustom(customPrimary, customAccent);
        }

        return FixedThemes.TryGetValue(themeId, out ColorTheme? theme) ? theme : FixedThemes[DefaultId];
    }

    /// <summary>The persisted / broadcast wire id for a theme (web <c>ThemeId</c> string).</summary>
    /// <param name="id">The theme id.</param>
    public static string ToWireId(ThemeId id) => id switch
    {
        ThemeId.NeonCyan => "neon-cyan",
        ThemeId.TeslaRed => "tesla-red",
        ThemeId.MatrixGreen => "matrix-green",
        ThemeId.RoyalPurple => "royal-purple",
        ThemeId.SolarAmber => "solar-amber",
        ThemeId.Custom => "custom",
        _ => "neon-cyan",
    };

    /// <summary>
    /// Parse a persisted / broadcast wire id back to a <see cref="ThemeId"/>, returning <c>null</c> for an
    /// unknown value (web <c>saved in themes</c> guard — the caller then keeps the default).
    /// </summary>
    /// <param name="wireId">The wire id, or null.</param>
    public static ThemeId? TryParseId(string? wireId) => wireId switch
    {
        "neon-cyan" => ThemeId.NeonCyan,
        "tesla-red" => ThemeId.TeslaRed,
        "matrix-green" => ThemeId.MatrixGreen,
        "royal-purple" => ThemeId.RoyalPurple,
        "solar-amber" => ThemeId.SolarAmber,
        "custom" => ThemeId.Custom,
        _ => null,
    };
}

/// <summary>
/// The display-mode catalog — the native port of the web module-level <c>modes</c> record. Exposes the
/// seven modes verbatim, maps to/from the persisted wire ids, and resolves the effective
/// <see cref="ModeTheme"/> for a selection (folding <see cref="ModeId.Auto"/> to dark/light from the OS
/// colour-scheme preference, web <c>resolvedMode</c>).
/// </summary>
public static class ModeCatalog
{
    /// <summary>The default mode applied when nothing valid is persisted (web fallback <c>'dark'</c>).</summary>
    public const ModeId DefaultId = ModeId.Dark;

    private static readonly Dictionary<ModeId, ModeTheme> AllModes = new()
    {
        [ModeId.Dark] = new(ModeId.Dark, "Dark", "#0a0a0f", "#0f1019", "#151621", "#1a1b2e", "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.08)", "#ffffff", "#9ca3af", "#6b7280", ColorScheme.Dark),
        [ModeId.Light] = new(ModeId.Light, "Light", "#f8fafc", "#ffffff", "#f1f5f9", "#e2e8f0", "rgba(255, 255, 255, 0.8)", "rgba(0, 0, 0, 0.08)", "#0f172a", "#475569", "#94a3b8", ColorScheme.Light),
        [ModeId.Oled] = new(ModeId.Oled, "OLED Black", "#000000", "#050505", "#0a0a0a", "#111111", "rgba(255, 255, 255, 0.03)", "rgba(255, 255, 255, 0.05)", "#ffffff", "#9ca3af", "#6b7280", ColorScheme.Dark),
        [ModeId.Midnight] = new(ModeId.Midnight, "Midnight Blue", "#0a0e1a", "#0f1425", "#141a30", "#1a2240", "rgba(100, 150, 255, 0.04)", "rgba(100, 150, 255, 0.08)", "#e0e7ff", "#94a3c8", "#6875a0", ColorScheme.Dark),
        [ModeId.Auto] = new(ModeId.Auto, "Auto (System)", "#0a0a0f", "#0f1019", "#151621", "#1a1b2e", "rgba(255, 255, 255, 0.04)", "rgba(255, 255, 255, 0.08)", "#ffffff", "#9ca3af", "#6b7280", ColorScheme.Dark),
        [ModeId.Sunset] = new(ModeId.Sunset, "Sunset", "#1a0e0a", "#241410", "#2e1a14", "#3a221a", "rgba(255, 160, 100, 0.04)", "rgba(255, 160, 100, 0.10)", "#fff0e0", "#c8a894", "#a07860", ColorScheme.Dark),
        [ModeId.Nord] = new(ModeId.Nord, "Nord", "#2e3440", "#3b4252", "#434c5e", "#4c566a", "rgba(136, 192, 208, 0.04)", "rgba(136, 192, 208, 0.10)", "#eceff4", "#d8dee9", "#81a1c1", ColorScheme.Dark),
    };

    private static readonly IReadOnlyList<ModeId> OrderedIds = new[]
    {
        ModeId.Dark,
        ModeId.Light,
        ModeId.Oled,
        ModeId.Midnight,
        ModeId.Auto,
        ModeId.Sunset,
        ModeId.Nord,
    };

    /// <summary>The selectable mode ids in the web declaration order.</summary>
    public static IReadOnlyList<ModeId> Ids => OrderedIds;

    /// <summary>The raw mode palette for <paramref name="id"/> (web <c>modes[id]</c>); <see cref="ModeId.Auto"/> returns its own catalog entry, which <see cref="Resolve"/> normally folds to dark/light.</summary>
    /// <param name="id">The mode id.</param>
    public static ModeTheme Get(ModeId id) => AllModes.TryGetValue(id, out ModeTheme? mode) ? mode : AllModes[DefaultId];

    /// <summary>
    /// Resolve the effective <see cref="ModeTheme"/> for <paramref name="modeId"/>. <see cref="ModeId.Auto"/>
    /// folds to <see cref="ModeId.Dark"/> when <paramref name="systemDark"/> is set, otherwise
    /// <see cref="ModeId.Light"/> (web <c>modeId === 'auto' ? (systemDark ? modes.dark : modes.light) : modes[modeId]</c>).
    /// </summary>
    /// <param name="modeId">The selected mode id.</param>
    /// <param name="systemDark">Whether the OS colour-scheme preference is dark.</param>
    public static ModeTheme Resolve(ModeId modeId, bool systemDark)
    {
        if (modeId == ModeId.Auto)
        {
            return systemDark ? AllModes[ModeId.Dark] : AllModes[ModeId.Light];
        }

        return Get(modeId);
    }

    /// <summary>The persisted / broadcast wire id for a mode (web <c>ModeId</c> string).</summary>
    /// <param name="id">The mode id.</param>
    public static string ToWireId(ModeId id) => id switch
    {
        ModeId.Dark => "dark",
        ModeId.Light => "light",
        ModeId.Oled => "oled",
        ModeId.Midnight => "midnight",
        ModeId.Auto => "auto",
        ModeId.Sunset => "sunset",
        ModeId.Nord => "nord",
        _ => "dark",
    };

    /// <summary>
    /// Parse a persisted / broadcast wire id back to a <see cref="ModeId"/>, returning <c>null</c> for an
    /// unknown value (web <c>saved in modes</c> guard).
    /// </summary>
    /// <param name="wireId">The wire id, or null.</param>
    public static ModeId? TryParseId(string? wireId) => wireId switch
    {
        "dark" => ModeId.Dark,
        "light" => ModeId.Light,
        "oled" => ModeId.Oled,
        "midnight" => ModeId.Midnight,
        "auto" => ModeId.Auto,
        "sunset" => ModeId.Sunset,
        "nord" => ModeId.Nord,
        _ => null,
    };
}

/// <summary>A single applied CSS custom property (name + value) — one entry of the web <c>applyThemeCSS</c> output.</summary>
/// <param name="Name">The CSS custom-property name, verbatim from the web source (e.g. <c>--theme-primary</c>).</param>
/// <param name="Value">The colour value applied to it.</param>
public sealed record ThemeCssVariable(string Name, string Value);

/// <summary>
/// The fully-resolved palette a <see cref="ThemeProviderSurface.ThemeProvider"/> applies — the native port of the
/// web <c>applyThemeCSS(theme, mode)</c> side effect. It is a pure projection of a resolved
/// <see cref="ColorTheme"/> + <see cref="ModeTheme"/>: <see cref="CssVariables"/> is the ordered set of the
/// thirteen <c>--*</c> custom properties the web sets on <c>document.documentElement</c> (the exact parity
/// artifact the tests assert), while the strongly-typed hex / triple members let the WinUI view build brushes
/// without re-parsing names. <see cref="ColorScheme"/> mirrors the web <c>color-scheme</c> property and the
/// <c>dark</c> / <c>light-mode</c> class toggle.
/// </summary>
public sealed record AppliedThemeTokens
{
    private AppliedThemeTokens(
        ThemeId themeId,
        ModeId requestedModeId,
        ColorScheme colorScheme,
        ColorTheme theme,
        ModeTheme mode,
        IReadOnlyList<ThemeCssVariable> cssVariables)
    {
        ThemeId = themeId;
        RequestedModeId = requestedModeId;
        ColorScheme = colorScheme;
        PrimaryHex = theme.Primary;
        PrimaryRgb = theme.PrimaryRgb;
        AccentHex = theme.Accent;
        AccentRgb = theme.AccentRgb;
        BackgroundHex = mode.Background;
        Surface1Hex = mode.Surface1;
        Surface2Hex = mode.Surface2;
        Surface3Hex = mode.Surface3;
        GlassBackground = mode.GlassBackground;
        GlassBorder = mode.GlassBorder;
        TextPrimaryHex = mode.TextPrimary;
        TextSecondaryHex = mode.TextSecondary;
        TextMutedHex = mode.TextMuted;
        CssVariables = cssVariables;
    }

    /// <summary>The selected theme id (web <c>themeId</c>).</summary>
    public ThemeId ThemeId { get; }

    /// <summary>The selected mode id (web <c>modeId</c> — may be <see cref="ModeId.Auto"/>, before resolution).</summary>
    public ModeId RequestedModeId { get; }

    /// <summary>The resolved light/dark scheme (web <c>mode.colorScheme</c>).</summary>
    public ColorScheme ColorScheme { get; }

    /// <summary>The primary colour hex (web <c>--theme-primary</c>).</summary>
    public string PrimaryHex { get; }

    /// <summary>The primary colour channel triple (web <c>--theme-primary-rgb</c>).</summary>
    public string PrimaryRgb { get; }

    /// <summary>The accent colour hex (web <c>--theme-accent</c>).</summary>
    public string AccentHex { get; }

    /// <summary>The accent colour channel triple (web <c>--theme-accent-rgb</c>).</summary>
    public string AccentRgb { get; }

    /// <summary>The page background hex (web <c>--bg</c>).</summary>
    public string BackgroundHex { get; }

    /// <summary>The first surface hex (web <c>--surface-1</c>).</summary>
    public string Surface1Hex { get; }

    /// <summary>The second surface hex (web <c>--surface-2</c>).</summary>
    public string Surface2Hex { get; }

    /// <summary>The third surface hex (web <c>--surface-3</c>).</summary>
    public string Surface3Hex { get; }

    /// <summary>The translucent glass fill (web <c>--glass-bg</c>).</summary>
    public string GlassBackground { get; }

    /// <summary>The translucent glass border (web <c>--glass-border</c>).</summary>
    public string GlassBorder { get; }

    /// <summary>The primary text hex (web <c>--text-primary</c>).</summary>
    public string TextPrimaryHex { get; }

    /// <summary>The secondary text hex (web <c>--text-secondary</c>).</summary>
    public string TextSecondaryHex { get; }

    /// <summary>The muted text hex (web <c>--text-muted</c>).</summary>
    public string TextMutedHex { get; }

    /// <summary>The ordered CSS custom properties the web <c>applyThemeCSS</c> sets on the document root.</summary>
    public IReadOnlyList<ThemeCssVariable> CssVariables { get; }

    /// <summary>Whether the dark class is applied (web <c>colorScheme === 'dark'</c>).</summary>
    public bool IsDark => ColorScheme == ColorScheme.Dark;

    /// <summary>The web <c>color-scheme</c> property value (<c>dark</c> / <c>light</c>).</summary>
    public string ColorSchemeToken => ColorScheme == ColorScheme.Light ? "light" : "dark";

    /// <summary>
    /// Compute the applied palette for a resolved theme + mode — the native port of <c>applyThemeCSS</c>. The
    /// <paramref name="requestedModeId"/> is preserved verbatim (so <see cref="ModeId.Auto"/> round-trips for
    /// diagnostics), while every colour is read from the already-resolved <paramref name="mode"/>.
    /// </summary>
    /// <param name="themeId">The selected theme id.</param>
    /// <param name="requestedModeId">The selected mode id (pre-resolution; may be <see cref="ModeId.Auto"/>).</param>
    /// <param name="theme">The resolved colour theme.</param>
    /// <param name="mode">The resolved display mode.</param>
    public static AppliedThemeTokens Compute(ThemeId themeId, ModeId requestedModeId, ColorTheme theme, ModeTheme mode)
    {
        ArgumentNullException.ThrowIfNull(theme);
        ArgumentNullException.ThrowIfNull(mode);

        // Order mirrors the web applyThemeCSS setProperty(...) sequence exactly.
        var variables = new[]
        {
            new ThemeCssVariable("--theme-primary", theme.Primary),
            new ThemeCssVariable("--theme-primary-rgb", theme.PrimaryRgb),
            new ThemeCssVariable("--theme-accent", theme.Accent),
            new ThemeCssVariable("--theme-accent-rgb", theme.AccentRgb),
            new ThemeCssVariable("--bg", mode.Background),
            new ThemeCssVariable("--surface-1", mode.Surface1),
            new ThemeCssVariable("--surface-2", mode.Surface2),
            new ThemeCssVariable("--surface-3", mode.Surface3),
            new ThemeCssVariable("--glass-bg", mode.GlassBackground),
            new ThemeCssVariable("--glass-border", mode.GlassBorder),
            new ThemeCssVariable("--text-primary", mode.TextPrimary),
            new ThemeCssVariable("--text-secondary", mode.TextSecondary),
            new ThemeCssVariable("--text-muted", mode.TextMuted),
        };

        return new AppliedThemeTokens(themeId, requestedModeId, mode.ColorScheme, theme, mode, variables);
    }
}

/// <summary>
/// The persisted theme settings shape exchanged with the backend (the native projection of the web
/// <c>/api/v1/settings</c> fields <c>theme</c> / <c>mode</c> / <c>custom_primary</c> / <c>custom_accent</c>).
/// All fields are nullable because the backend may omit any of them — the controller validates each through
/// <see cref="ThemeCatalog.TryParseId"/> / <see cref="ModeCatalog.TryParseId"/> before applying it (web
/// <c>settings.theme &amp;&amp; settings.theme in themes</c>).
/// </summary>
/// <param name="Theme">The persisted theme wire id, or null.</param>
/// <param name="Mode">The persisted mode wire id, or null.</param>
/// <param name="CustomPrimary">The persisted custom primary colour, or null.</param>
/// <param name="CustomAccent">The persisted custom accent colour, or null.</param>
public sealed record ThemeSettingsSnapshot(
    string? Theme,
    string? Mode,
    string? CustomPrimary,
    string? CustomAccent);

/// <summary>
/// A cross-instance theme broadcast — the native port of the web <c>broadcast(...)</c> / <c>subscribe(...)</c>
/// messages (<c>web/src/lib/broadcast.ts</c>) the provider uses to mirror a change made in another window
/// without re-persisting or re-broadcasting (which would loop).
/// </summary>
public abstract record ThemeBroadcast
{
    private ThemeBroadcast()
    {
    }

    /// <summary>A theme and/or mode change (web <c>{{ type: 'theme.changed', themeId, modeId }}</c>).</summary>
    /// <param name="ThemeId">The new theme id.</param>
    /// <param name="ModeId">The new mode id.</param>
    public sealed record ThemeChanged(ThemeId ThemeId, ModeId ModeId) : ThemeBroadcast;

    /// <summary>A custom-colour change (web <c>{{ type: 'theme.customColors', primary, accent }}</c>).</summary>
    /// <param name="Primary">The new custom primary colour.</param>
    /// <param name="Accent">The new custom accent colour.</param>
    public sealed record CustomColors(string Primary, string Accent) : ThemeBroadcast;
}

/// <summary>
/// The async lifecycle phase of the one-shot backend-settings load the provider runs on mount (web
/// <c>initialized</c> flag). The provider renders its children immediately with the cached / default theme;
/// this phase only gates the backend fold-in and the fire-and-forget persistence (web
/// <c>if (!initialized) return</c>), so there is never a blocking loading surface.
/// </summary>
public enum ThemeLoadPhase
{
    /// <summary>The settings load is in flight; the cached / default theme is already applied (web <c>initialized === false</c>).</summary>
    Initializing,

    /// <summary>The settings load has resolved (success or failure); persistence is now enabled (web <c>initialized === true</c>).</summary>
    Ready,
}

/// <summary>
/// How the one-shot backend-settings load resolved. This makes the web source's otherwise-invisible
/// loading / empty / error / offline branches observable and testable. The web <c>ThemeProvider</c> swallows a
/// failed fetch (<c>.catch(() =&gt; {{}})</c>) and always renders, so error and offline collapse to the same
/// graceful "keep the cached / default theme" outcome — there is no error chrome and no freshness/stale window.
/// </summary>
public enum ThemeSettingsLoadOutcome
{
    /// <summary>The load has not completed yet (the <see cref="ThemeLoadPhase.Initializing"/> state).</summary>
    Pending,

    /// <summary>The backend returned settings and at least one valid field was applied.</summary>
    AppliedFromBackend,

    /// <summary>The backend resolved with no usable settings; the cached / default theme stands (the empty state).</summary>
    NoBackendSettings,

    /// <summary>The backend load failed or was unreachable; the cached / default theme stands (the error / offline state).</summary>
    DegradedToCache,
}

/// <summary>
/// Canonical metadata for the <c>ThemeProvider</c> shared surface — the native mirror of the web module's
/// identity (<c>web/src/components/ui/ThemeProvider.tsx</c>). The web source is an anonymous context provider:
/// it renders a bare children wrapper with no titles, labels or static copy, so there are no i18n keys to
/// resolve and no interactive elements of its own — only the diagnostics slug.
/// </summary>
public static class ThemeProviderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ThemeProvider";
}

/// <summary>
/// The accessibility contract for the <c>ThemeProvider</c> view — the native expression of the web source
/// rendering a bare fragment (<c>&lt;ThemeContext.Provider&gt;{children}&lt;/&gt;</c>). A theme provider has no
/// visible chrome and no interactive affordance of its own; it only supplies palette context and applies it to
/// the subtree. So the provider contributes no accessible node — the WinUI view maps this to
/// <c>AccessibilityView.Raw</c> so Narrator traverses straight through to the hosted content. Exposed as a
/// constant so the headless accessibility test can assert the contract the WinUI view consumes.
/// </summary>
public static class ThemeProviderAccessibility
{
    /// <summary>
    /// Whether the provider contributes an accessible node of its own. Always <c>false</c>: the web source is a
    /// transparent wrapper, so the native provider is an accessibility-raw structural element.
    /// </summary>
    public const bool ProviderContributesAccessibleNode = false;
}

/// <summary>
/// PII-safe diagnostics for the <c>ThemeProvider</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters and non-identifying theme/mode ids and load outcomes with the surface slug — never a
/// custom colour value (a user-chosen hex is not an identifier but is still user content, so it is deliberately
/// excluded from the line sink). Thread-safe because the load completes off the UI thread.
/// </summary>
public sealed class ThemeProviderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _themesApplied;
    private long _settingsLoads;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no custom colour value is ever passed).</param>
    public ThemeProviderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of palette applications recorded.</summary>
    public long ThemesApplied => Interlocked.Read(ref _themesApplied);

    /// <summary>Number of backend settings-load completions recorded.</summary>
    public long SettingsLoads => Interlocked.Read(ref _settingsLoads);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ThemeProvider</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ThemeProviderRegistration.Slug}");
    }

    /// <summary>Record a palette application, emitting the theme + mode wire ids (never a custom colour value).</summary>
    /// <param name="themeId">The applied theme id.</param>
    /// <param name="modeId">The applied (requested) mode id.</param>
    public void RecordThemeApplied(ThemeId themeId, ModeId modeId)
    {
        Interlocked.Increment(ref _themesApplied);
        _sink?.Invoke($"theme.applied slug={ThemeProviderRegistration.Slug} theme={ThemeCatalog.ToWireId(themeId)} mode={ModeCatalog.ToWireId(modeId)}");
    }

    /// <summary>Record the backend settings-load completion, emitting the resolved <paramref name="outcome"/>.</summary>
    /// <param name="outcome">How the load resolved.</param>
    public void RecordSettingsLoaded(ThemeSettingsLoadOutcome outcome)
    {
        Interlocked.Increment(ref _settingsLoads);
        _sink?.Invoke($"theme.settings_loaded slug={ThemeProviderRegistration.Slug} outcome={outcome}");
    }
}
