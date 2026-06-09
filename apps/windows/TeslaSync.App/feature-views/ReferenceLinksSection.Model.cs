using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The icon a <see cref="ReferenceLink"/> renders with — the native union of the lucide icon names the web
/// <c>ReferenceLinksSection</c> keys through its <c>ICON_MAP</c>
/// (web/src/features/admin/components/devtools/ReferenceLinksSection.tsx). Each maps onto a Segoe Fluent /
/// MDL2 glyph by <see cref="ReferenceLinksProjection.Glyph(ReferenceLinkIcon)"/> — the platform-idiomatic
/// equivalent of the web SVG icon, never a ported web asset.
/// </summary>
public enum ReferenceLinkIcon
{
    /// <summary>An open book — the Fleet API overview reference (web <c>BookOpen</c>).</summary>
    BookOpen,

    /// <summary>A globe — the partner-endpoints reference (web <c>Globe</c>).</summary>
    Globe,

    /// <summary>An external-link badge — the developer-portal reference (web <c>ExternalLink</c>).</summary>
    ExternalLink,

    /// <summary>A broadcast tower — the Fleet Telemetry reference (web <c>Radio</c>).</summary>
    Radio,
}

/// <summary>
/// The mutually-exclusive surface state of <see cref="ReferenceLinksViewModel"/>. The web
/// <c>ReferenceLinksSection</c> consumes no asynchronous data — it only calls <c>useTranslation</c> and maps a
/// static <c>REFERENCE_LINKS</c> catalog — so it has no fetch/loading/error/offline/stale branches to mirror.
/// The honest native union is therefore the two states the catalog can yield: a populated grid
/// (<see cref="Ready"/>) or, defensively, no links at all (<see cref="Empty"/>) — which renders a friendly
/// empty surface rather than a blank box.
/// </summary>
public enum ReferenceLinkState
{
    /// <summary>The catalog yielded at least one link — render the responsive card grid.</summary>
    Ready,

    /// <summary>The catalog yielded no links — render the friendly empty surface (never a blank box).</summary>
    Empty,
}

/// <summary>
/// One catalog entry backing the surface — the native analogue of an item in the web
/// <c>REFERENCE_LINKS</c> array (web/src/features/admin/components/devtools/constants.ts). It keeps the link's
/// i18n title <see cref="TitleKey"/> (resolved at the display boundary, never a baked English literal), its
/// English <see cref="TitleFallback"/> for the headless / missing-resource path, the verbatim destination
/// <see cref="Url"/> and the <see cref="Icon"/>. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="TitleKey">The i18n key resolved through the localizer (web <c>t(link.title)</c>).</param>
/// <param name="TitleFallback">The English fallback returned when the key is absent (the localizer contract).</param>
/// <param name="Url">The destination, kept byte-for-byte from the web catalog (web <c>link.url</c>).</param>
/// <param name="Icon">The accent icon the card renders with (web <c>link.icon</c>).</param>
public sealed record ReferenceLink(string TitleKey, string TitleFallback, string Url, ReferenceLinkIcon Icon);

/// <summary>
/// A projected, render-ready reference link — the output of <see cref="ReferenceLinksProjection"/>. Carries the
/// localized <see cref="Title"/>, the verbatim <see cref="Url"/> (shown beneath the title and used as the link
/// target), the <see cref="Icon"/> plus its resolved Segoe Fluent <see cref="Glyph"/>, and the composed
/// <see cref="AutomationName"/> a screen reader announces for the link. Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Title">The localized link label (web <c>t(link.title)</c>).</param>
/// <param name="Url">The verbatim destination, shown as the caption and used as the navigation target.</param>
/// <param name="Icon">The accent icon role.</param>
/// <param name="Glyph">The Segoe Fluent / MDL2 glyph for <paramref name="Icon"/>.</param>
/// <param name="AutomationName">The Narrator name for the link (label plus destination).</param>
public sealed record ReferenceLinkItem(
    string Title,
    string Url,
    ReferenceLinkIcon Icon,
    string Glyph,
    string AutomationName);

/// <summary>
/// The static reference-link catalog — the native source-of-truth mirror of the web <c>REFERENCE_LINKS</c>
/// constant (web/src/features/admin/components/devtools/constants.ts). The URLs are reproduced byte-for-byte
/// and the i18n keys verbatim; the English fallbacks supply the label the web catalog leaves to the i18n layer
/// (the keys are anonymous in the shared catalog, so the fallback is the canonical display copy here).
/// </summary>
public static class ReferenceLinkCatalog
{
    private static readonly ReferenceLink[] Entries =
    [
        new("devtools.ref.fleetOverview", "Fleet API Overview", "https://developer.tesla.com/docs/fleet-api", ReferenceLinkIcon.BookOpen),
        new("devtools.ref.partnerEndpoints", "Partner Endpoints", "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register", ReferenceLinkIcon.Globe),
        new("devtools.ref.devPortal", "Developer Portal", "https://developer.tesla.com", ReferenceLinkIcon.ExternalLink),
        new("devtools.ref.telemetryGuide", "Fleet Telemetry Guide", "https://developer.tesla.com/docs/fleet-api/fleet-telemetry", ReferenceLinkIcon.Radio),
    ];

    /// <summary>The four canonical Tesla Fleet API reference links, in web order.</summary>
    public static IReadOnlyList<ReferenceLink> Default => Entries;
}

/// <summary>
/// Canonical metadata for the Reference Links surface — the native mirror of the web
/// <c>ReferenceLinksSection</c>. The web surface is anonymous (it renders no visible heading), so the only
/// keyed copy here is the accessibility region label and the defensive empty-state message; both resolve
/// through the localizer at the display boundary.
/// </summary>
public static class ReferenceLinksRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ReferenceLinksSection";

    /// <summary>The i18n key for the accessibility region label.</summary>
    public const string RegionLabelKey = "devtools.ref.regionLabel";

    /// <summary>The i18n key for the defensive empty-state message.</summary>
    public const string EmptyKey = "devtools.ref.empty";

    /// <summary>The localized Narrator landmark name for the whole section.</summary>
    public static string RegionName(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RegionLabelKey, "Reference links");
    }

    /// <summary>The localized friendly empty-state message (no links available).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, "No reference links available");
    }
}

/// <summary>
/// Pure projection from the static <see cref="ReferenceLink"/> catalog to the render-ready
/// <see cref="ReferenceLinkItem"/> list — the native port of the web component's per-link map
/// (web/src/features/admin/components/devtools/ReferenceLinksSection.tsx). Resolves each title through the
/// localizer, maps the icon to a glyph, and composes the link's Narrator name. WinUI-free so it is unit-tested
/// without a UI host.
/// </summary>
public static class ReferenceLinksProjection
{
    /// <summary>Resolve the Segoe Fluent / MDL2 glyph for <paramref name="icon"/> (web <c>ICON_MAP</c> analogue).</summary>
    public static string Glyph(ReferenceLinkIcon icon) => icon switch
    {
        ReferenceLinkIcon.BookOpen => "\uE8F1",      // Library
        ReferenceLinkIcon.Globe => "\uE774",         // Globe
        ReferenceLinkIcon.ExternalLink => "\uE8A7",  // OpenInNewWindow
        ReferenceLinkIcon.Radio => "\uEC05",         // NetworkTower (broadcast / telemetry)
        _ => "\uE8F1",                               // Library — web falls back to BookOpen
    };

    /// <summary>The Narrator name for a link: its localized label followed by the destination.</summary>
    public static string AutomationName(string title, string url) => $"{title}, {url}";

    /// <summary>
    /// Project <paramref name="catalog"/> into the localized, render-ready item list. A <see langword="null"/>
    /// or empty catalog yields an empty list (the defensive empty state); each entry's title is resolved
    /// through <paramref name="localizer"/> exactly once.
    /// </summary>
    public static IReadOnlyList<ReferenceLinkItem> Project(
        IReadOnlyList<ReferenceLink>? catalog,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (catalog is null || catalog.Count == 0)
        {
            return Array.Empty<ReferenceLinkItem>();
        }

        var items = new List<ReferenceLinkItem>(catalog.Count);
        foreach (var link in catalog)
        {
            string title = localizer.GetString(link.TitleKey, link.TitleFallback);
            items.Add(new ReferenceLinkItem(
                Title: title,
                Url: link.Url,
                Icon: link.Icon,
                Glyph: Glyph(link.Icon),
                AutomationName: AutomationName(title, link.Url)));
        }

        return items;
    }
}

/// <summary>
/// PII-safe diagnostics for the Reference Links surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a URL or label — so a diagnostics line
/// can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class ReferenceLinksDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ReferenceLinksDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ReferenceLinksSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ReferenceLinksRegistration.Slug}");
    }
}
