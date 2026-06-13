using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The five DevTools sections, in the exact order the web page lists them in its <c>TABS</c> array
/// (web/src/features/admin/pages/DevToolsPage.tsx). The string key is the stable tab identity used for
/// selection and deep-link state (web the <c>?tab=</c> URL param).
/// </summary>
public enum DevToolsTabKey
{
    /// <summary>web <c>fleet-api</c> — the Fleet API onboarding wizard + tool grid (default tab).</summary>
    FleetApi,

    /// <summary>web <c>telemetry</c> — Fleet Telemetry health.</summary>
    Telemetry,

    /// <summary>web <c>infrastructure</c> — backend infrastructure diagnostics.</summary>
    Infrastructure,

    /// <summary>web <c>utilities</c> — client-side developer utilities.</summary>
    Utilities,

    /// <summary>web <c>reference</c> — Tesla Fleet API reference links.</summary>
    Reference,
}

/// <summary>
/// One DevTools tab descriptor — the native analogue of one entry in the web <c>TABS</c> array. Carries the
/// stable <see cref="Key"/>, the Segoe Fluent glyph mirroring the web lucide icon, and the i18n key + English
/// fallback for the visible label (the web hardcodes the label text; the native port routes it through the
/// localizer so no literal ships in the view, ADR-014).
/// </summary>
/// <param name="Key">The stable tab identity (web the <c>?tab=</c> value).</param>
/// <param name="Glyph">The Segoe Fluent Icons code point shown beside the label.</param>
/// <param name="LabelKey">The i18n resource key for the tab label.</param>
/// <param name="LabelFallback">The English fallback (verbatim from the web <c>TABS</c> label).</param>
public sealed record DevToolsTab(DevToolsTabKey Key, string Glyph, string LabelKey, string LabelFallback)
{
    /// <summary>Resolve the localized tab label (web the literal <c>TABS[].label</c>).</summary>
    public string Label(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LabelKey, LabelFallback);
    }
}

/// <summary>
/// The DevTools page projection — the WinUI-free port of the web page's render data. It resolves the page
/// title + subtitle (the two parity strings) and the ordered tab catalog through the localizer, so the view
/// is a thin renderer and the copy is unit-tested without a XAML runtime.
/// </summary>
public static class DevToolsCatalog
{
    /// <summary>The i18n key for the page title (web <c>devtools.title</c>).</summary>
    public const string TitleKey = "devtools.title";

    /// <summary>The i18n key for the page subtitle (web <c>devtools.subtitle</c>).</summary>
    public const string SubtitleKey = "devtools.subtitle";

    // Segoe Fluent glyphs chosen to mirror the web lucide icons (Globe, Radio, Server, Wrench, BookOpen).
    private const string GlobeGlyph = "\uE774";   // web Globe
    private const string SignalGlyph = "\uE701";  // web Radio (signal / broadcast)
    private const string ServerGlyph = "\uE968";  // web Server (storage)
    private const string WrenchGlyph = "\uEC7A";  // web Wrench (repair)
    private const string BookGlyph = "\uE82D";    // web BookOpen (library)

    /// <summary>The ordered tab catalog (web <c>TABS</c>, same order: Fleet API → Telemetry → … → Reference).</summary>
    public static IReadOnlyList<DevToolsTab> Tabs { get; } =
    [
        new(DevToolsTabKey.FleetApi, GlobeGlyph, "devtools.tab.fleetApi", "Fleet API"),
        new(DevToolsTabKey.Telemetry, SignalGlyph, "devtools.tab.telemetry", "Telemetry"),
        new(DevToolsTabKey.Infrastructure, ServerGlyph, "devtools.tab.infrastructure", "Infrastructure"),
        new(DevToolsTabKey.Utilities, WrenchGlyph, "devtools.tab.utilities", "Utilities"),
        new(DevToolsTabKey.Reference, BookGlyph, "devtools.tab.reference", "Reference"),
    ];

    /// <summary>The default tab the page opens on (web <c>DEFAULT_TAB = 'fleet-api'</c>).</summary>
    public static DevToolsTabKey DefaultTab => DevToolsTabKey.FleetApi;

    /// <summary>Resolve the page title (web <c>t('devtools.title', 'Developer Tools')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, "Developer Tools");
    }

    /// <summary>Resolve the page subtitle (web <c>t('devtools.subtitle', '…')</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, "Fleet API, telemetry, infrastructure & utilities");
    }
}
