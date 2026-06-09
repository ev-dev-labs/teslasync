namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Resolves a <see cref="ToolCard"/> accent name to a generated design-token brush
/// resource key (see <c>apps/design/generated/windows/Tokens.xaml</c>). Mirrors the
/// web source's <c>ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan</c>
/// (web/src/features/admin/components/devtools/constants.ts): five accents with a cyan
/// fallback for any unknown, empty or null name. Kept UI-free so the mapping is
/// unit-testable without a XAML runtime.
/// </summary>
public static class ToolCardAccent
{
    /// <summary>The accent used when a name is unknown or missing (the web cyan fallback).</summary>
    public const string Default = "cyan";

    private static readonly string[] KnownAccents = ["cyan", "green", "purple", "amber", "red"];

    /// <summary>The five canonical accent names, in web declaration order.</summary>
    public static IReadOnlyList<string> KnownColors => KnownAccents;

    /// <summary>
    /// Canonicalise <paramref name="color"/> to one of <see cref="KnownColors"/>,
    /// falling back to <see cref="Default"/> for an unknown, empty or null name.
    /// Matching is case- and surrounding-whitespace-insensitive.
    /// </summary>
    public static string Resolve(string? color)
    {
        var trimmed = (color ?? string.Empty).Trim();
        foreach (var known in KnownAccents)
        {
            if (string.Equals(known, trimmed, StringComparison.OrdinalIgnoreCase))
            {
                return known;
            }
        }

        return Default;
    }

    /// <summary>True when <paramref name="color"/> names one of the known accents.</summary>
    public static bool IsKnown(string? color)
    {
        var trimmed = (color ?? string.Empty).Trim();
        foreach (var known in KnownAccents)
        {
            if (string.Equals(known, trimmed, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>The theme-aware token brush key backing <paramref name="color"/>'s accent.</summary>
    public static string BrushKey(string? color) => Resolve(color) switch
    {
        "green" => "TsColorSuccessBrush",
        "purple" => "TsChartPowerBrush",
        "amber" => "TsColorWarningBrush",
        "red" => "TsColorDangerBrush",
        _ => "TsColorAccentBrush",
    };
}

/// <summary>
/// The render-ready projection of the <see cref="ToolCard"/> inputs (icon glyph,
/// accent, title, description) — the WinUI-free model the view binds to. Trims the
/// caller-supplied (already-localized) title and description exactly as the web source
/// flows its <c>title</c>/<c>description</c> props, resolves the accent and composes the
/// Narrator name. Kept UI-free so it is unit-testable without a XAML runtime.
/// </summary>
/// <param name="Title">The trimmed title (may be empty).</param>
/// <param name="Description">The trimmed description (may be empty).</param>
/// <param name="IconGlyph">The Segoe Fluent Icons glyph shown in the badge.</param>
/// <param name="AccentColor">The resolved canonical accent name.</param>
/// <param name="AccentBrushKey">The token brush key backing the accent.</param>
/// <param name="AccessibilityName">The composed Narrator name (title and description).</param>
public sealed record ToolCardModel(
    string Title,
    string Description,
    string IconGlyph,
    string AccentColor,
    string AccentBrushKey,
    string AccessibilityName)
{
    /// <summary>Default badge glyph (Segoe Fluent Icons "Repair") used when none is supplied.</summary>
    public const string DefaultGlyph = "\uE90F";

    /// <summary>True when a non-empty title should be shown.</summary>
    public bool HasTitle => Title.Length > 0;

    /// <summary>True when a non-empty description should be shown beneath the title.</summary>
    public bool HasDescription => Description.Length > 0;

    /// <summary>Project the raw inputs into a render-ready model.</summary>
    public static ToolCardModel Create(string? title, string? description, string? iconGlyph, string? accent)
    {
        var trimmedTitle = (title ?? string.Empty).Trim();
        var trimmedDescription = (description ?? string.Empty).Trim();
        var glyph = string.IsNullOrEmpty(iconGlyph) ? DefaultGlyph : iconGlyph;

        return new ToolCardModel(
            trimmedTitle,
            trimmedDescription,
            glyph,
            ToolCardAccent.Resolve(accent),
            ToolCardAccent.BrushKey(accent),
            ComposeName(trimmedTitle, trimmedDescription));
    }

    private static string ComposeName(string title, string description)
    {
        if (title.Length == 0)
        {
            return description;
        }

        return description.Length == 0 ? title : $"{title}. {description}";
    }
}

/// <summary>
/// PII-safe diagnostics for the <see cref="ToolCard"/> surface (P1/S11 diagnostics
/// contract). Records only the operational <c>view.opened</c> event with the surface
/// slug — never the title, description or any caller content — so a diagnostics line can
/// never leak data. Thread-safe.
/// </summary>
public sealed class ToolCardDiagnostics
{
    /// <summary>The diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ToolCard";

    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ToolCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ToolCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Slug}");
    }
}
