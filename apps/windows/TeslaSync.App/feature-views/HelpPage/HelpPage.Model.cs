using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive surface state of the <c>HelpPage</c> — the native mirror of the data states the web
/// page renders (web/src/features/system/pages/HelpPage.tsx). The web page consumes no asynchronous data: it
/// only calls <c>useTranslation</c> + <c>usePageTitle</c> and maps a static, intentionally short curated link
/// catalog, so it has no fetch/loading/error/offline branch to mirror — the manifest declares the single
/// <see cref="Success"/> state. The honest native union adds a defensive <see cref="Empty"/> branch (the curated
/// catalog yielded no links) so the link grid renders a friendly empty surface rather than a blank region
/// (ADR-011). The intro panel is always visible.
/// </summary>
public enum HelpState
{
    /// <summary>The curated catalog yielded at least one link — render the intro panel + the responsive card grid.</summary>
    Success,

    /// <summary>Defensively, the curated catalog yielded no links — render the intro panel + a friendly empty surface.</summary>
    Empty,
}

/// <summary>
/// The accent icon a curated <see cref="HelpLink"/> renders with — the native union of the lucide icons the web
/// page keys each card through (web/src/features/system/pages/HelpPage.tsx <c>HELP_LINKS[].Icon</c>). Each maps
/// onto a Segoe Fluent / MDL2 glyph by <see cref="HelpProjection.Glyph(HelpLinkIcon)"/> — the platform-idiomatic
/// equivalent of the web SVG icon, never a ported web asset.
/// </summary>
public enum HelpLinkIcon
{
    /// <summary>An open book — the documentation card (web <c>BookOpen</c>).</summary>
    Documentation,

    /// <summary>A launch spark — the onboarding card (web <c>Rocket</c>).</summary>
    Onboarding,

    /// <summary>A server — the system-status card (web <c>ServerCog</c>).</summary>
    SystemStatus,

    /// <summary>A magnifier — the search card (web <c>Search</c>).</summary>
    Search,

    /// <summary>A chat bubble — the chatbot card (web <c>MessagesSquare</c>).</summary>
    Chatbot,
}

/// <summary>
/// One curated catalog entry backing the page — the native analogue of a single item in the web
/// <c>HELP_LINKS</c> array (web/src/features/system/pages/HelpPage.tsx). It keeps the link's stable
/// <see cref="Id"/> (the web React key + test marker), the internal app <see cref="Route"/> it navigates to
/// (an existing canonical destination only), its accent <see cref="Icon"/>, and the i18n title / description
/// keys with their English fallbacks (resolved at the display boundary, never baked English literals). Pure data
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">Stable id (web <c>link.id</c>) — the React key / test marker.</param>
/// <param name="Route">The internal app route the card navigates to (web <c>link.to</c>).</param>
/// <param name="Icon">The accent icon the card renders with (web <c>link.Icon</c>).</param>
/// <param name="TitleKey">The i18n key for the card title (web <c>link.titleKey</c>).</param>
/// <param name="TitleFallback">The English fallback title (web <c>link.titleFallback</c>).</param>
/// <param name="DescKey">The i18n key for the one-line description (web <c>link.descKey</c>).</param>
/// <param name="DescFallback">The English fallback description (web <c>link.descFallback</c>).</param>
public sealed record HelpLink(
    string Id,
    string Route,
    HelpLinkIcon Icon,
    string TitleKey,
    string TitleFallback,
    string DescKey,
    string DescFallback);

/// <summary>
/// A projected, render-ready curated link — the output of <see cref="HelpProjection"/>. Carries the stable
/// <see cref="Id"/>, the navigation <see cref="Route"/>, the accent <see cref="Icon"/> plus its resolved Segoe
/// Fluent <see cref="Glyph"/>, the localized <see cref="Title"/> and <see cref="Description"/>, and the composed
/// <see cref="AutomationName"/> a screen reader announces for the card. Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Id">Stable id (web <c>link.id</c>).</param>
/// <param name="Route">The internal app route the card navigates to (web <c>link.to</c>).</param>
/// <param name="Icon">The accent icon role.</param>
/// <param name="Glyph">The Segoe Fluent / MDL2 glyph for <paramref name="Icon"/>.</param>
/// <param name="Title">The localized card title.</param>
/// <param name="Description">The localized one-line card description.</param>
/// <param name="AutomationName">The Narrator name for the card (title plus description).</param>
public sealed record HelpLinkItem(
    string Id,
    string Route,
    HelpLinkIcon Icon,
    string Glyph,
    string Title,
    string Description,
    string AutomationName);

/// <summary>
/// The immutable input the <see cref="HelpProjection"/> reads — the curated catalog plus whether the surface has
/// resolved. The web page renders from navigation params / local state only (no async data source), so the
/// surface is always resolved; the flag exists for symmetry with the sibling feature-view projections and is
/// reserved for a future live source. Pure data so the whole projection is unit-tested headless.
/// </summary>
/// <param name="Catalog">The curated link catalog (web <c>HELP_LINKS</c>).</param>
/// <param name="Resolved">Whether the surface has resolved (always true for the local-state page).</param>
public sealed record HelpModel(IReadOnlyList<HelpLink> Catalog, bool Resolved = true);

/// <summary>
/// The render-ready projection the <c>HelpPage</c> view binds to. Every visible literal is resolved here through
/// the <see cref="ILocalizer"/> (web key names preserved verbatim) so the view stays a thin renderer with zero
/// hardcoded text. <see cref="Title"/> backs both the page header (web <c>PageContainer title</c>) and the window
/// title (web <c>usePageTitle</c>); <see cref="Intro"/> is the framing paragraph inside GlassPanel1; the
/// <see cref="Links"/> are the curated cards (GlassPanel2). <see cref="State"/> drives the link region between the
/// populated grid and the defensive empty surface.
/// </summary>
public sealed record HelpDisplay(
    HelpState State,
    string Title,
    string DocumentTitle,
    string Intro,
    IReadOnlyList<HelpLinkItem> Links);

/// <summary>
/// The static curated-link catalog — the native source-of-truth mirror of the web <c>HELP_LINKS</c> constant
/// (web/src/features/system/pages/HelpPage.tsx). The order is intentional (documentation, onboarding, system
/// status, search, chatbot); every route is reproduced byte-for-byte and the i18n keys verbatim. Each route
/// targets an existing canonical destination already mounted in the app — this page introduces no new surface.
/// The set is duplicated in the off-mode web test (<c>TestRagHelpAIOffHidesAssistantAndDocsLinksWork</c>);
/// updating one MUST update the other.
/// </summary>
public static class HelpLinkCatalog
{
    private static readonly HelpLink[] Entries =
    [
        new(
            "docs-status-api",
            "/docs/status-api",
            HelpLinkIcon.Documentation,
            "help.baseline.links.docsStatusApi.title",
            "Documentation",
            "help.baseline.links.docsStatusApi.description",
            "Browse the public API documentation including endpoints, schemas, and example requests."),
        new(
            "onboarding",
            "/onboarding",
            HelpLinkIcon.Onboarding,
            "help.baseline.links.onboarding.title",
            "Onboarding",
            "help.baseline.links.onboarding.description",
            "Walk through the first-time setup wizard to connect a Tesla account and configure live telemetry."),
        new(
            "system-status",
            "/system-status",
            HelpLinkIcon.SystemStatus,
            "help.baseline.links.systemStatus.title",
            "System status",
            "help.baseline.links.systemStatus.description",
            "Inspect the live health of every backend service: database, MQTT, Redis, and the Tesla API."),
        new(
            "search",
            "/search",
            HelpLinkIcon.Search,
            "help.baseline.links.search.title",
            "Search",
            "help.baseline.links.search.description",
            "Find drives, charging sessions, alerts, and other records using typed filters."),
        new(
            "chatbot",
            "/chatbot",
            HelpLinkIcon.Chatbot,
            "help.baseline.links.chatbot.title",
            "Chatbot",
            "help.baseline.links.chatbot.description",
            "Talk to the in-app assistant. Available in deterministic mode or LLM mode when Helix is enabled."),
    ];

    /// <summary>The five canonical curated help links, in web declaration order.</summary>
    public static IReadOnlyList<HelpLink> Default => Entries;
}

/// <summary>
/// Pure projection from the static <see cref="HelpLink"/> catalog (and the page's framing copy) to the
/// render-ready <see cref="HelpDisplay"/> — the native port of the web page's render (the title, the intro
/// paragraph and the per-link card map). Resolves every literal through the localizer with the web English
/// defaults, maps each icon to a glyph, composes each card's Narrator name, and derives the link region state
/// (<see cref="HelpState.Success"/> vs the defensive <see cref="HelpState.Empty"/>). WinUI-free so it is
/// unit-tested without a XAML runtime.
/// </summary>
public static class HelpProjection
{
    /// <summary>Resolve the Segoe Fluent / MDL2 glyph for <paramref name="icon"/> (web lucide-icon analogue).</summary>
    public static string Glyph(HelpLinkIcon icon) => icon switch
    {
        HelpLinkIcon.Documentation => "\uE8F1",  // Library (web BookOpen)
        HelpLinkIcon.Onboarding => "\uE945",     // Sparkle (web Rocket — "get started")
        HelpLinkIcon.SystemStatus => "\uE950",   // StorageNetworkWireless (web ServerCog; matches the SystemStatus route glyph)
        HelpLinkIcon.Search => "\uE721",         // Search (web Search)
        HelpLinkIcon.Chatbot => "\uE8F2",        // Chat (web MessagesSquare)
        _ => "\uE897",                           // Help — defensive fallback
    };

    /// <summary>The Narrator name for a card: its localized title followed by the description.</summary>
    public static string AutomationName(string title, string description) => $"{title}. {description}";

    /// <summary>Resolve the page title (web <c>help.title</c>) — backs the header and the window title.</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("help.title", "Help");
    }

    /// <summary>Resolve the framing intro paragraph (web <c>help.intro</c>).</summary>
    public static string Intro(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "help.intro",
            "Get started with TeslaSync. The links below cover the most common questions; for anything else, ask the in-app assistant or open the documentation.");
    }

    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    public static HelpDisplay Project(HelpModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = Title(localizer);
        var intro = Intro(localizer);
        var links = ProjectLinks(model.Catalog, localizer);
        var state = links.Count > 0 ? HelpState.Success : HelpState.Empty;

        return new HelpDisplay(
            State: state,
            Title: title,
            DocumentTitle: title,
            Intro: intro,
            Links: links);
    }

    /// <summary>
    /// Project <paramref name="catalog"/> into the localized, render-ready card list. A <see langword="null"/>
    /// or empty catalog yields an empty list (the defensive empty state); each entry's title and description are
    /// resolved through <paramref name="localizer"/> exactly once.
    /// </summary>
    public static IReadOnlyList<HelpLinkItem> ProjectLinks(
        IReadOnlyList<HelpLink>? catalog,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (catalog is null || catalog.Count == 0)
        {
            return Array.Empty<HelpLinkItem>();
        }

        var items = new List<HelpLinkItem>(catalog.Count);
        foreach (var link in catalog)
        {
            var title = localizer.GetString(link.TitleKey, link.TitleFallback);
            var description = localizer.GetString(link.DescKey, link.DescFallback);
            items.Add(new HelpLinkItem(
                Id: link.Id,
                Route: link.Route,
                Icon: link.Icon,
                Glyph: Glyph(link.Icon),
                Title: title,
                Description: description,
                AutomationName: AutomationName(title, description)));
        }

        return items;
    }
}

/// <summary>
/// Canonical metadata for the <c>HelpPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/HelpPage.tsx</c>. The web page is unrouted in <c>App.tsx</c> (the component
/// exists but is not yet wired into a visible nav route); the Windows shell registers it under the
/// <see cref="RouteName"/> as a hidden deep-link destination (RouteTable path <c>help</c>, not shown in nav),
/// matching the web's not-in-nav status. The page title resolves here so the registration and the projection
/// share one key, and the curated routes the cards navigate to live here so the view never hardcodes a path.
/// </summary>
public static class HelpRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "HelpPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>Help</c>, path <c>help</c>).</summary>
    public const string RouteName = "Help";

    /// <summary>The internal app route of the documentation card (web <c>/docs/status-api</c>).</summary>
    public const string DocsStatusApiRoute = "/docs/status-api";

    /// <summary>The internal app route of the onboarding card (web <c>/onboarding</c>).</summary>
    public const string OnboardingRoute = "/onboarding";

    /// <summary>The internal app route of the system-status card (web <c>/system-status</c>).</summary>
    public const string SystemStatusRoute = "/system-status";

    /// <summary>The internal app route of the search card (web <c>/search</c>).</summary>
    public const string SearchRoute = "/search";

    /// <summary>The internal app route of the chatbot card (web <c>/chatbot</c>).</summary>
    public const string ChatbotRoute = "/chatbot";

    /// <summary>The i18n key for the defensive empty-state message (no curated links available).</summary>
    public const string EmptyKey = "help.empty";

    /// <summary>The localized page title (web <c>help.title</c>).</summary>
    public static string Title(ILocalizer localizer) => HelpProjection.Title(localizer);

    /// <summary>
    /// The localized friendly empty-state message — defensive only (the curated catalog is static and non-empty,
    /// so the empty surface is never normally shown). Routed through the localizer so it is never a hardcoded
    /// literal, mirroring the sibling link-grid surfaces.
    /// </summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, "No help links available");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>HelpPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a route or label — so a diagnostics line
/// can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class HelpDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public HelpDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HelpPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HelpRegistration.Slug}");
    }
}
