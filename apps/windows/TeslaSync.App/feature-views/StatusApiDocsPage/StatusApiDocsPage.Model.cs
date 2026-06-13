using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The mutually-exclusive surface state of the <c>StatusApiDocsPage</c> — the native mirror of the data states the
/// web page renders (web/src/features/system/pages/StatusApiDocsPage.tsx). The web page consumes no asynchronous
/// data: it is intentionally static documentation ("Static content — no backend round-trip"), so it has no
/// fetch / loading / error branch to mirror — the manifest declares the single <see cref="Success"/> state. The
/// honest native union adds a defensive <see cref="Empty"/> branch (the endpoint catalog yielded nothing) so the
/// endpoint region renders a friendly empty surface rather than a blank region (ADR-011). The overview and footer
/// panels are always visible.
/// </summary>
public enum StatusApiDocsState
{
    /// <summary>The endpoint catalog yielded at least one endpoint — render the overview + the endpoint cards + the footer.</summary>
    Success,

    /// <summary>Defensively, the endpoint catalog yielded nothing — render the overview + a friendly empty surface + the footer.</summary>
    Empty,
}

/// <summary>
/// One paragraph inside the overview panel (web GlassPanel2, the first <c>GlassPanel</c> in source order) — the
/// native analogue of a single <c>&lt;p&gt;</c> in the web overview block. The web renders two prose paragraphs
/// (mounting / auth, then the integration list) followed by an amber "additive-only" note flagged by
/// <see cref="IsNote"/>; the note carries a leading code glyph and the warning accent (web
/// <c>text-amber-200/80</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Text">The localized paragraph copy.</param>
/// <param name="IsNote">True for the amber "additive-only" note (web the <c>Code</c>-iconed amber paragraph).</param>
public sealed record StatusOverviewParagraph(string Text, bool IsNote);

/// <summary>
/// One documented endpoint backing the page — the native analogue of a single <c>&lt;Endpoint&gt;</c> instance in
/// the web source (web/src/features/system/pages/StatusApiDocsPage.tsx). It keeps the endpoint's stable
/// <see cref="Id"/> (the React key / test marker), the HTTP <see cref="Method"/> and <see cref="Path"/> (the
/// endpoint identity, rendered as code), the optional query-string hint <see cref="Query"/>, the description i18n
/// key with its English fallback (resolved at the display boundary, never a baked English literal) and the verbatim
/// pretty-printed <see cref="ExampleJson"/> the disclosure reveals. Pure data so the projection is unit-tested
/// without a XAML host.
/// </summary>
/// <param name="Id">Stable id (web React key) — the test marker.</param>
/// <param name="Method">The HTTP method (web <c>method</c>; always <c>GET</c> for the status API).</param>
/// <param name="Path">The endpoint path rendered as code (web <c>path</c>).</param>
/// <param name="Query">The optional query-string hint (web <c>query</c>); null when the endpoint takes no query.</param>
/// <param name="DescriptionKey">The i18n key for the endpoint description (introduced; the web hardcodes the copy).</param>
/// <param name="DescriptionFallback">The English fallback description (web <c>description</c>), resolved at the boundary.</param>
/// <param name="ExampleJson">The verbatim example response body (web <c>JSON.stringify(example, null, 2)</c>).</param>
public sealed record StatusEndpoint(
    string Id,
    string Method,
    string Path,
    string? Query,
    string DescriptionKey,
    string DescriptionFallback,
    string ExampleJson);

/// <summary>
/// A projected, render-ready endpoint — the output of <see cref="StatusApiDocsProjection"/>. Carries the stable
/// <see cref="Id"/>, the <see cref="Method"/> / <see cref="Path"/> identity, the optional <see cref="Query"/> hint,
/// the localized <see cref="Description"/>, the verbatim <see cref="ExampleJson"/> and the composed
/// <see cref="AutomationName"/> a screen reader announces for the card. Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Id">Stable id (web React key).</param>
/// <param name="Method">The HTTP method (web <c>method</c>).</param>
/// <param name="Path">The endpoint path (web <c>path</c>).</param>
/// <param name="Query">The optional query-string hint (web <c>query</c>); null when absent.</param>
/// <param name="Description">The localized endpoint description.</param>
/// <param name="ExampleJson">The verbatim example response body.</param>
/// <param name="AutomationName">The Narrator name for the card (method, path and description).</param>
public sealed record StatusEndpointItem(
    string Id,
    string Method,
    string Path,
    string? Query,
    string Description,
    string ExampleJson,
    string AutomationName);

/// <summary>
/// The immutable input the <see cref="StatusApiDocsProjection"/> reads — the endpoint catalog. The web page renders
/// from static local content only (no async data source), so the surface is always resolved; the catalog is the
/// single source of truth for the documented endpoints. Pure data so the whole projection is unit-tested headless.
/// </summary>
/// <param name="Endpoints">The documented endpoint catalog (web the ordered <c>&lt;Endpoint&gt;</c> instances).</param>
public sealed record StatusApiDocsModel(IReadOnlyList<StatusEndpoint> Endpoints);

/// <summary>
/// The render-ready projection the <c>StatusApiDocsPage</c> view binds to. Every visible literal is resolved here
/// through the <see cref="ILocalizer"/> (with the web English copy as the fallback) so the view stays a thin
/// renderer with zero hardcoded text. <see cref="Title"/> / <see cref="Subtitle"/> back the page header (web
/// <c>PageContainer title</c> / <c>subtitle</c>); <see cref="BackLabel"/> is the header back-link (web the
/// <c>ArrowLeft</c> "Back to System Status" link); <see cref="OverviewHeading"/> + <see cref="OverviewParagraphs"/>
/// are the overview panel (GlassPanel2); <see cref="Endpoints"/> are the endpoint cards (GlassPanel1, one each);
/// <see cref="Footer"/> is the closing muted panel (GlassPanel3). <see cref="State"/> drives the endpoint region
/// between the populated cards and the defensive empty surface.
/// </summary>
public sealed record StatusApiDocsDisplay(
    StatusApiDocsState State,
    string Title,
    string Subtitle,
    string BackLabel,
    string OverviewHeading,
    IReadOnlyList<StatusOverviewParagraph> OverviewParagraphs,
    string ExampleResponseLabel,
    IReadOnlyList<StatusEndpointItem> Endpoints,
    string Footer);

/// <summary>
/// The static endpoint catalog — the native source-of-truth mirror of the ordered <c>&lt;Endpoint&gt;</c>
/// instances in the web page (web/src/features/system/pages/StatusApiDocsPage.tsx). The order is intentional
/// (snapshot, components, resources, uptime, incidents, live); every method / path / query is reproduced
/// byte-for-byte and every example payload is the verbatim <see cref="StatusApiExamples"/> JSON. Each path targets
/// the real backend status surface mounted under <c>/api/v1/status</c> — this page documents an existing contract
/// and introduces no new surface.
/// </summary>
public static class StatusApiEndpointCatalog
{
    private static readonly StatusEndpoint[] Entries =
    [
        new(
            "snapshot",
            "GET",
            "/api/v1/status",
            null,
            "statusApiDocs.endpoints.snapshot.description",
            "Overall snapshot — answers 'is it healthy right now?' in a single round-trip. Includes counts, version, resources, maintenance, and a list of active incidents.",
            StatusApiExamples.Snapshot),
        new(
            "components",
            "GET",
            "/api/v1/status/components",
            null,
            "statusApiDocs.endpoints.components.description",
            "Per-component health array — useful for surfacing individual subsystem status (database, mqtt, tesla, telemetry, etc.) in your own dashboard.",
            StatusApiExamples.Components),
        new(
            "resources",
            "GET",
            "/api/v1/status/resources",
            null,
            "statusApiDocs.endpoints.resources.description",
            "Runtime resources only (goroutines, uptime, Go version). Light enough to poll at high frequency.",
            StatusApiExamples.Resources),
        new(
            "uptime",
            "GET",
            "/api/v1/status/uptime",
            "window=24h | 7d | 30d | 90d | 1y",
            "statusApiDocs.endpoints.uptime.description",
            "Uptime percentage over the requested window. Until per-component heartbeat history is wired, the percentage is derived from the current snapshot — the historical_source field signals which is in play.",
            StatusApiExamples.Uptime),
        new(
            "incidents",
            "GET",
            "/api/v1/status/incidents",
            "active=1 | limit=N",
            "statusApiDocs.endpoints.incidents.description",
            "Active incidents list. Pass active=1 to filter to incidents whose resolved_at is NULL.",
            StatusApiExamples.Incidents),
        new(
            "live",
            "GET",
            "/api/v1/status/live",
            null,
            "statusApiDocs.endpoints.live.description",
            "Server-Sent Events stream. Pushes a `status` event with the full snapshot every 30 seconds. Heartbeat events emitted every 25s so reverse proxies don't garbage-collect the connection mid-flight. Browsers consume this via EventSource(). For curl: -N --no-buffer.",
            StatusApiExamples.Live),
    ];

    /// <summary>The six canonical documented endpoints, in web declaration order.</summary>
    public static IReadOnlyList<StatusEndpoint> Default => Entries;
}

/// <summary>
/// Pure projection from the static <see cref="StatusEndpoint"/> catalog (and the page's framing copy) to the
/// render-ready <see cref="StatusApiDocsDisplay"/> — the native port of the web page's render (the header, the
/// overview block, the per-endpoint card map and the footer). Resolves every literal through the localizer with
/// the web English defaults, composes each card's Narrator name and derives the endpoint region state
/// (<see cref="StatusApiDocsState.Success"/> vs the defensive <see cref="StatusApiDocsState.Empty"/>). WinUI-free
/// so it is unit-tested without a XAML runtime.
/// </summary>
public static class StatusApiDocsProjection
{
    /// <summary>The i18n key for the page title (web <c>PageContainer title</c>).</summary>
    public const string TitleKey = "statusApiDocs.title";

    /// <summary>The i18n key for the page subtitle (web <c>PageContainer subtitle</c>).</summary>
    public const string SubtitleKey = "statusApiDocs.subtitle";

    /// <summary>The i18n key for the header back-link label (web the <c>ArrowLeft</c> "Back to System Status" link).</summary>
    public const string BackKey = "statusApiDocs.back";

    /// <summary>The i18n key for the overview panel heading (web the <c>Server</c>-iconed "Overview" h2).</summary>
    public const string OverviewTitleKey = "statusApiDocs.overview.title";

    /// <summary>The i18n key for the first overview paragraph (web the mounting / auth paragraph).</summary>
    public const string OverviewParagraph1Key = "statusApiDocs.overview.p1";

    /// <summary>The i18n key for the second overview paragraph (web the "Designed for" integration paragraph).</summary>
    public const string OverviewParagraph2Key = "statusApiDocs.overview.p2";

    /// <summary>The i18n key for the amber additive-only note (web the <c>Code</c>-iconed amber paragraph).</summary>
    public const string OverviewNoteKey = "statusApiDocs.overview.note";

    /// <summary>The i18n key for the per-endpoint disclosure summary (web <c>&lt;summary&gt;Example response&lt;/summary&gt;</c>).</summary>
    public const string ExampleResponseKey = "statusApiDocs.exampleResponse";

    /// <summary>The i18n key for the closing footer panel (web GlassPanel3 muted text).</summary>
    public const string FooterKey = "statusApiDocs.footer";

    /// <summary>Resolve the page title (web <c>PageContainer title</c>) — backs the header and the window title.</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, "Status API");
    }

    /// <summary>The Narrator name for an endpoint card: its method and path followed by the description.</summary>
    public static string AutomationName(string method, string path, string description) =>
        $"{method} {path}. {description}";

    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    public static StatusApiDocsDisplay Project(StatusApiDocsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var endpoints = ProjectEndpoints(model.Endpoints, localizer);

        return new StatusApiDocsDisplay(
            State: endpoints.Count > 0 ? StatusApiDocsState.Success : StatusApiDocsState.Empty,
            Title: Title(localizer),
            Subtitle: localizer.GetString(SubtitleKey, "Stable contract for external integrations"),
            BackLabel: localizer.GetString(BackKey, "Back to System Status"),
            OverviewHeading: localizer.GetString(OverviewTitleKey, "Overview"),
            OverviewParagraphs: ProjectOverview(localizer),
            ExampleResponseLabel: localizer.GetString(ExampleResponseKey, "Example response"),
            Endpoints: endpoints,
            Footer: localizer.GetString(
                FooterKey,
                "Need an additional endpoint or field? Open an issue on the project repo — the API surface is intentionally small, but additive changes are welcome."));
    }

    /// <summary>Resolve the three overview paragraphs (web the two prose paragraphs plus the amber note).</summary>
    public static IReadOnlyList<StatusOverviewParagraph> ProjectOverview(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return
        [
            new StatusOverviewParagraph(
                localizer.GetString(
                    OverviewParagraph1Key,
                    "All endpoints are mounted under /api/v1/status and inherit the same authentication as the rest of the API. If you proxy this with ForwardAuth (Authelia, Authentik, Tinyauth, etc.), the proxy handles auth — otherwise pass an API key in the standard Authorization: Bearer … header."),
                IsNote: false),
            new StatusOverviewParagraph(
                localizer.GetString(
                    OverviewParagraph2Key,
                    "Designed for: Grafana (JSON datasource), Uptime Kuma (HTTP(s) JSON Query monitor), Home Assistant (REST sensor), Healthchecks.io (synthetic monitor), or any other system that consumes JSON over HTTP."),
                IsNote: false),
            new StatusOverviewParagraph(
                localizer.GetString(
                    OverviewNoteKey,
                    "The shape is additive-only — new fields may appear, but existing field types and names won't change without a major version bump."),
                IsNote: true),
        ];
    }

    /// <summary>
    /// Project <paramref name="catalog"/> into the localized, render-ready card list. A <see langword="null"/> or
    /// empty catalog yields an empty list (the defensive empty state); each endpoint's description is resolved
    /// through <paramref name="localizer"/> exactly once and its Narrator name composed.
    /// </summary>
    public static IReadOnlyList<StatusEndpointItem> ProjectEndpoints(
        IReadOnlyList<StatusEndpoint>? catalog,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (catalog is null || catalog.Count == 0)
        {
            return Array.Empty<StatusEndpointItem>();
        }

        var items = new List<StatusEndpointItem>(catalog.Count);
        foreach (var endpoint in catalog)
        {
            var description = localizer.GetString(endpoint.DescriptionKey, endpoint.DescriptionFallback);
            items.Add(new StatusEndpointItem(
                Id: endpoint.Id,
                Method: endpoint.Method,
                Path: endpoint.Path,
                Query: endpoint.Query,
                Description: description,
                ExampleJson: endpoint.ExampleJson,
                AutomationName: AutomationName(endpoint.Method, endpoint.Path, description)));
        }

        return items;
    }
}

/// <summary>
/// Canonical metadata for the <c>StatusApiDocsPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/system/pages/StatusApiDocsPage.tsx</c> (web route <c>/docs/status-api</c>). The Windows
/// shell registers it under <see cref="RouteName"/> (RouteTable path <c>docs/status-api</c>, RouteGroup.SystemOps);
/// the header back-link navigates to the existing <see cref="SystemStatusRoute"/> destination (web
/// <c>Link to="/system-status"</c>). The page title resolves here so the registration and the projection share one
/// key, and the back route lives here so the view never hardcodes a path.
/// </summary>
public static class StatusApiDocsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "StatusApiDocsPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>StatusApiDocs</c>, path <c>docs/status-api</c>).</summary>
    public const string RouteName = "StatusApiDocs";

    /// <summary>The internal app route the header back-link navigates to (web <c>/system-status</c>).</summary>
    public const string SystemStatusRoute = "/system-status";

    /// <summary>The i18n key for the defensive empty-state message (no endpoints documented).</summary>
    public const string EmptyKey = "statusApiDocs.empty";

    /// <summary>The localized page title (web <c>PageContainer title</c>).</summary>
    public static string Title(ILocalizer localizer) => StatusApiDocsProjection.Title(localizer);

    /// <summary>
    /// The localized friendly empty-state message — defensive only (the endpoint catalog is static and non-empty,
    /// so the empty surface is never normally shown). Routed through the localizer so it is never a hardcoded
    /// literal, mirroring the sibling feature-view surfaces.
    /// </summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, "No endpoints documented");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>StatusApiDocsPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a route or label — so a diagnostics line can
/// never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class StatusApiDocsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public StatusApiDocsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatusApiDocsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatusApiDocsRegistration.Slug}");
    }
}
