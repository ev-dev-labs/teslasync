using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive surface state of the <c>ApiPlaygroundPage</c> — the native mirror of the four data states
/// the web page renders (web/src/features/admin/pages/ApiPlaygroundPage.tsx). The web page loads the OpenAPI spec
/// through a <c>useQuery</c> and surfaces <see cref="Loading"/> (the sidebar skeleton while the spec resolves),
/// <see cref="Error"/> (the <c>PageContainer error</c> branch when the fetch fails), <see cref="Empty"/> (no endpoint
/// rows to list — the spec yielded nothing or the search matched none) and <see cref="Success"/> (the grouped
/// endpoint list). The manifest models the page as rendering from local / navigation state (the generated client
/// exposes no endpoint catalog), so the page is driven by an injected <see cref="IApiPlaygroundFeed"/>; the default
/// <see cref="CatalogApiPlaygroundFeed"/> resolves the static endpoint catalog so the populated success state renders
/// without a network round-trip, while a host can inject a live-spec feed without touching the view.
/// </summary>
public enum ApiPlaygroundState
{
    /// <summary>The endpoint catalog is still resolving — the sidebar renders its loading skeleton.</summary>
    Loading,

    /// <summary>The catalog (or the active search) yielded no endpoint rows — the sidebar renders a friendly empty surface.</summary>
    Empty,

    /// <summary>The catalog feed failed — the sidebar renders an inline error surface with a retry affordance.</summary>
    Error,

    /// <summary>At least one endpoint row is listed — the sidebar renders the grouped, selectable endpoint list.</summary>
    Success,
}

/// <summary>
/// One request parameter on a documented endpoint — the native analogue of a single web <c>ParsedParam</c>
/// (web/src/features/admin/components/EndpointSidebar). Pure data so the projection is unit-tested without a XAML
/// host.
/// </summary>
/// <param name="Name">The parameter name (web <c>name</c>).</param>
/// <param name="In">Where the parameter is supplied — <c>path</c> or <c>query</c> (web <c>in</c>).</param>
/// <param name="Required">True when the parameter is required (web <c>required</c>).</param>
/// <param name="Type">The schema type rendered beside the name (web <c>type</c>).</param>
public sealed record ApiEndpointParam(string Name, string In, bool Required, string Type);

/// <summary>
/// One documented API endpoint backing the page — the native analogue of a single web <c>ParsedEndpoint</c>
/// (web/src/features/admin/pages/ApiPlaygroundPage.tsx). It keeps the endpoint's stable <see cref="Id"/> (the
/// selection key / test marker), the HTTP <see cref="Method"/> and <see cref="Path"/> (the endpoint identity), the
/// OpenAPI <see cref="Tag"/> the sidebar groups by, the human <see cref="Summary"/> and <see cref="Description"/>,
/// and its <see cref="Parameters"/>. Pure data so the whole projection is unit-tested headless.
/// </summary>
/// <param name="Id">Stable id (the selection key / web React key).</param>
/// <param name="Method">The HTTP method (web <c>method</c>).</param>
/// <param name="Path">The endpoint path, relative to <c>/api/v1</c> (web <c>path</c>).</param>
/// <param name="Tag">The OpenAPI tag the sidebar groups under (web <c>tag</c>).</param>
/// <param name="Summary">The one-line endpoint summary (web <c>summary</c>).</param>
/// <param name="Description">The longer endpoint description (web <c>description</c>).</param>
/// <param name="Parameters">The endpoint's path / query parameters (web <c>parameters</c>).</param>
public sealed record ApiEndpoint(
    string Id,
    string Method,
    string Path,
    string Tag,
    string Summary,
    string Description,
    IReadOnlyList<ApiEndpointParam> Parameters);

/// <summary>
/// A projected, render-ready endpoint row in the sidebar list (GlassPanel1) — the output of
/// <see cref="ApiPlaygroundProjection"/>. Carries the stable <see cref="Id"/>, the <see cref="Method"/> /
/// <see cref="Path"/> identity, the grouping <see cref="Tag"/>, the <see cref="Summary"/> tooltip, the
/// token-backed <see cref="MethodStatus"/> the method badge tints with, the composed <see cref="AutomationName"/>
/// a screen reader announces and whether the row is currently <see cref="IsSelected"/>. Immutable so the view is a
/// thin renderer.
/// </summary>
/// <param name="Id">Stable id (the selection key).</param>
/// <param name="Method">The HTTP method shown in the badge (web <c>method</c>).</param>
/// <param name="Path">The endpoint path shown as the row label (web <c>path</c>).</param>
/// <param name="Tag">The OpenAPI tag this row groups under.</param>
/// <param name="Summary">The one-line summary surfaced as the row tooltip.</param>
/// <param name="MethodStatus">The semantic status the method badge tints with.</param>
/// <param name="AutomationName">The Narrator name for the row (method + path).</param>
/// <param name="IsSelected">True when this row is the selected endpoint.</param>
public sealed record ApiEndpointItem(
    string Id,
    string Method,
    string Path,
    string Tag,
    string Summary,
    StatusKind MethodStatus,
    string AutomationName,
    bool IsSelected);

/// <summary>
/// A tag-grouped block of endpoint rows in the sidebar (GlassPanel1) — the native analogue of one tag section in
/// the web <c>EndpointSidebar</c>. The web sorts endpoints by tag, then method weight, then path; this projection
/// reproduces that order and renders one group header per <see cref="Tag"/>.
/// </summary>
/// <param name="Tag">The OpenAPI tag header (web the tag section label).</param>
/// <param name="Endpoints">The ordered endpoint rows under this tag.</param>
public sealed record ApiEndpointGroup(string Tag, IReadOnlyList<ApiEndpointItem> Endpoints);

/// <summary>
/// A projected, render-ready parameter row inside the selected-endpoint detail (GlassPanel2) — the localized
/// analogue of a web <c>ParsedParam</c> row. Carries the parameter <see cref="Name"/>, its schema <see cref="Type"/>,
/// whether it <see cref="Required"/> and the localized <see cref="RequirementLabel"/> (Required / Optional).
/// </summary>
/// <param name="Name">The parameter name.</param>
/// <param name="Type">The schema type.</param>
/// <param name="Required">True when the parameter is required.</param>
/// <param name="RequirementLabel">The localized required / optional label.</param>
public sealed record ApiEndpointParamItem(string Name, string Type, bool Required, string RequirementLabel);

/// <summary>
/// A localized section of parameters in the selected-endpoint detail (GlassPanel2) — either the path-parameter
/// group (web <c>playground.pathParams</c>) or the query-parameter group (web <c>playground.queryParams</c>). The
/// section is omitted entirely when it has no rows.
/// </summary>
/// <param name="Heading">The localized section heading (Path Parameters / Query Parameters).</param>
/// <param name="Items">The parameter rows in this section.</param>
public sealed record ApiEndpointParamSection(string Heading, IReadOnlyList<ApiEndpointParamItem> Items);

/// <summary>
/// The render-ready detail for the selected endpoint shown in the main panel (GlassPanel2) when a row is selected —
/// the native analogue of the web <c>RequestBuilder</c> header (the method badge, the code path, the summary, the
/// description and the grouped parameter list). Immutable so the view is a thin renderer.
/// </summary>
/// <param name="Method">The HTTP method shown in the badge.</param>
/// <param name="Path">The endpoint path shown as code.</param>
/// <param name="Tag">The OpenAPI tag chip.</param>
/// <param name="Summary">The one-line summary.</param>
/// <param name="Description">The longer description (may be empty).</param>
/// <param name="MethodStatus">The semantic status the method badge tints with.</param>
/// <param name="ParameterSections">The path / query parameter sections (empty when the endpoint takes no parameters).</param>
/// <param name="HasParameters">True when the endpoint declares at least one parameter.</param>
/// <param name="AutomationName">The Narrator name for the detail panel (method + path + summary).</param>
public sealed record ApiEndpointDetail(
    string Method,
    string Path,
    string Tag,
    string Summary,
    string Description,
    StatusKind MethodStatus,
    IReadOnlyList<ApiEndpointParamSection> ParameterSections,
    bool HasParameters,
    string AutomationName);

/// <summary>
/// One resolved catalog of documented endpoints — the payload an <see cref="IApiPlaygroundFeed"/> answers a fetch
/// with (the native analogue of the parsed OpenAPI endpoint list the web page derives from <c>/system/openapi</c>).
/// </summary>
/// <param name="Endpoints">The documented endpoint catalog (unordered; the projection sorts and groups it).</param>
public sealed record ApiPlaygroundSnapshot(IReadOnlyList<ApiEndpoint> Endpoints)
{
    /// <summary>An empty, resolved snapshot (no endpoints) — the defensive empty-state feed result.</summary>
    public static ApiPlaygroundSnapshot Empty { get; } = new(Array.Empty<ApiEndpoint>());
}

/// <summary>
/// The data port the <see cref="ApiPlaygroundPageViewModel"/> reads its endpoint catalog through. The manifest
/// models this page as rendering from local / navigation state (there is no generated client endpoint that returns
/// a parsed OpenAPI catalog), so the page is driven by an injected feed: the default
/// <see cref="CatalogApiPlaygroundFeed"/> resolves the static documented catalog (the populated success state), the
/// <see cref="EmptyApiPlaygroundFeed"/> resolves the defensive empty state, and a host can supply a feed that
/// answers from a live-spec payload without touching the view.
/// </summary>
public interface IApiPlaygroundFeed
{
    /// <summary>Resolve the documented endpoint catalog.</summary>
    /// <param name="cancellationToken">Cancels the (potentially async) resolve.</param>
    Task<ApiPlaygroundSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves the static documented endpoint catalog (the populated success state).</summary>
public sealed class CatalogApiPlaygroundFeed : IApiPlaygroundFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static CatalogApiPlaygroundFeed Instance { get; } = new();

    private CatalogApiPlaygroundFeed()
    {
    }

    /// <inheritdoc />
    public Task<ApiPlaygroundSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ApiPlaygroundSnapshot(ApiPlaygroundCatalog.Default));
    }
}

/// <summary>The defensive feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptyApiPlaygroundFeed : IApiPlaygroundFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyApiPlaygroundFeed Instance { get; } = new();

    private EmptyApiPlaygroundFeed()
    {
    }

    /// <inheritdoc />
    public Task<ApiPlaygroundSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ApiPlaygroundSnapshot.Empty);
    }
}

/// <summary>
/// The immutable input the <see cref="ApiPlaygroundProjection"/> reads — the resolved endpoint catalog plus the
/// page's URL-equivalent local state (the search <see cref="Query"/>, the <see cref="SelectedId"/>, and the
/// <see cref="Loading"/> / <see cref="HasError"/> flags). Pure data so the whole projection is unit-tested headless.
/// </summary>
/// <param name="Endpoints">The resolved endpoint catalog (web the parsed OpenAPI endpoint list).</param>
/// <param name="Query">The active sidebar search text (web <c>EndpointSidebar</c> search).</param>
/// <param name="SelectedId">The selected endpoint id (web <c>selected</c>), or null when none is selected.</param>
/// <param name="Loading">True while the catalog feed is in flight (web <c>specLoading</c>).</param>
/// <param name="HasError">True when the catalog feed failed (web <c>specError</c>).</param>
/// <param name="ErrorDetail">The optional error detail surfaced beside the error message.</param>
public sealed record ApiPlaygroundModel(
    IReadOnlyList<ApiEndpoint> Endpoints,
    string Query,
    string? SelectedId,
    bool Loading,
    bool HasError,
    string? ErrorDetail);

/// <summary>
/// The render-ready projection the <c>ApiPlaygroundPage</c> view binds to. Every visible literal is resolved here
/// through the <see cref="ILocalizer"/> (with the web English copy as the fallback) so the view stays a thin
/// renderer with zero hardcoded text. <see cref="Title"/> / <see cref="Subtitle"/> back the page header (web
/// <c>PageContainer title</c> / <c>subtitle</c>); <see cref="Groups"/> are the grouped, selectable endpoint rows in
/// the sidebar (GlassPanel1); <see cref="SelectEndpointMessage"/> + <see cref="EndpointCountLabel"/> are the
/// select-an-endpoint prompt in the main panel (GlassPanel2); <see cref="SelectedDetail"/> is the selected-endpoint
/// detail that replaces that prompt once a row is chosen. <see cref="State"/> drives the sidebar between the
/// skeleton, the error surface, the empty surface and the populated list.
/// </summary>
/// <param name="State">The top-level data state (loading / empty / error / success).</param>
/// <param name="Title">The localized page title (web <c>playground.title</c>).</param>
/// <param name="Subtitle">The localized page subtitle (web <c>playground.subtitle</c>).</param>
/// <param name="Groups">The tag-grouped, selectable endpoint rows for the sidebar.</param>
/// <param name="TotalCount">The total endpoint count in the catalog (unfiltered — backs the count caption).</param>
/// <param name="VisibleCount">The endpoint count after the active search filter (drives the empty / success split).</param>
/// <param name="EndpointCountLabel">The localized "{n} endpoints available" caption, or null when the catalog is empty.</param>
/// <param name="SelectEndpointMessage">The localized select-an-endpoint prompt (web <c>playground.selectEndpoint</c>).</param>
/// <param name="SidebarEmptyMessage">The localized sidebar empty / no-match message (web <c>playground.noResults</c>).</param>
/// <param name="SearchHint">The localized sidebar search hint (web <c>playground.search</c>).</param>
/// <param name="ErrorMessage">The localized catalog-load error message.</param>
/// <param name="RetryLabel">The localized retry-button label on the error surface.</param>
/// <param name="SelectedId">The selected endpoint id, or null when none is selected.</param>
/// <param name="SelectedDetail">The selected-endpoint detail, or null when none is selected.</param>
public sealed record ApiPlaygroundDisplay(
    ApiPlaygroundState State,
    string Title,
    string Subtitle,
    IReadOnlyList<ApiEndpointGroup> Groups,
    int TotalCount,
    int VisibleCount,
    string? EndpointCountLabel,
    string SelectEndpointMessage,
    string SidebarEmptyMessage,
    string SearchHint,
    string ErrorMessage,
    string RetryLabel,
    string? SelectedId,
    ApiEndpointDetail? SelectedDetail);

/// <summary>
/// Pure projection from the resolved endpoint catalog (and the page's local state) to the render-ready
/// <see cref="ApiPlaygroundDisplay"/> — the native port of the web page's render (the header, the grouped sidebar
/// list and the main select-prompt / endpoint-detail panel). Resolves every literal through the localizer with the
/// web English defaults, applies the search filter, sorts and groups the endpoints (by tag, then method weight,
/// then path — the web order), composes each row's Narrator name and derives the top-level state. WinUI-free so it
/// is unit-tested without a XAML runtime.
/// </summary>
public static class ApiPlaygroundProjection
{
    /// <summary>The i18n key for the page title (web <c>playground.title</c>).</summary>
    public const string TitleKey = "playground.title";

    /// <summary>The i18n key for the page subtitle (web <c>playground.subtitle</c>).</summary>
    public const string SubtitleKey = "playground.subtitle";

    /// <summary>The i18n key for the select-an-endpoint prompt (web <c>playground.selectEndpoint</c>).</summary>
    public const string SelectEndpointKey = "playground.selectEndpoint";

    /// <summary>The i18n key for the "{n} endpoints available" caption (web <c>playground.endpointCount</c>).</summary>
    public const string EndpointCountKey = "playground.endpointCount";

    /// <summary>The i18n key for the sidebar empty / no-match message (web <c>playground.noResults</c>).</summary>
    public const string NoResultsKey = "playground.noResults";

    /// <summary>The i18n key for the sidebar search hint (web <c>playground.search</c>).</summary>
    public const string SearchKey = "playground.search";

    /// <summary>The i18n key for the path-parameters section heading (web <c>playground.pathParams</c>).</summary>
    public const string PathParamsKey = "playground.pathParams";

    /// <summary>The i18n key for the query-parameters section heading (web <c>playground.queryParams</c>).</summary>
    public const string QueryParamsKey = "playground.queryParams";

    /// <summary>The i18n key for the catalog-load error message (introduced; the web routes the spec error to PageContainer).</summary>
    public const string ErrorKey = "playground.loadError";

    /// <summary>The i18n key for the error-surface retry-button label (introduced).</summary>
    public const string RetryKey = "playground.retry";

    /// <summary>The i18n key for the "required" parameter marker (introduced).</summary>
    public const string RequiredKey = "playground.required";

    /// <summary>The i18n key for the "optional" parameter marker (introduced).</summary>
    public const string OptionalKey = "playground.optional";

    /// <summary>Resolve the page title (web <c>playground.title</c>) — backs the header and the window title.</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, "API Playground");
    }

    /// <summary>Resolve the page subtitle (web <c>playground.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, "Explore and test TeslaSync API endpoints");
    }

    /// <summary>Format the "{n} endpoints available" caption (web <c>playground.endpointCount</c>) for a count.</summary>
    public static string FormatEndpointCount(ILocalizer localizer, int count)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var template = localizer.GetString(EndpointCountKey, "{0} endpoints available");
        return string.Format(CultureInfo.CurrentCulture, template, count);
    }

    /// <summary>The semantic status the method badge tints with (GET info, POST success, mutate warning, delete danger).</summary>
    public static StatusKind MethodStatus(string method) => Normalize(method) switch
    {
        "GET" => StatusKind.Info,
        "POST" => StatusKind.Success,
        "PUT" => StatusKind.Warning,
        "PATCH" => StatusKind.Warning,
        "DELETE" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>The web sort weight for a method (GET first, then POST, PUT, PATCH, DELETE).</summary>
    public static int MethodWeight(string method) => Normalize(method) switch
    {
        "GET" => 0,
        "POST" => 1,
        "PUT" => 2,
        "PATCH" => 3,
        "DELETE" => 4,
        _ => 9,
    };

    /// <summary>The Narrator name for an endpoint row: its method followed by its path.</summary>
    public static string RowAutomationName(string method, string path) => $"{Normalize(method)} {path}";

    /// <summary>The Narrator name for the detail panel: the method, the path and the summary.</summary>
    public static string DetailAutomationName(string method, string path, string summary) =>
        string.IsNullOrEmpty(summary) ? $"{Normalize(method)} {path}" : $"{Normalize(method)} {path}. {summary}";

    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    public static ApiPlaygroundDisplay Project(ApiPlaygroundModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var catalog = model.Endpoints ?? Array.Empty<ApiEndpoint>();
        var total = catalog.Count;

        var filtered = Filter(catalog, model.Query);
        var groups = GroupByTag(filtered, model.SelectedId);
        var visible = filtered.Count;

        var selectedDetail = ResolveDetail(catalog, model.SelectedId, localizer);

        var state = ResolveState(model.Loading, model.HasError, total, visible);

        return new ApiPlaygroundDisplay(
            State: state,
            Title: Title(localizer),
            Subtitle: Subtitle(localizer),
            Groups: groups,
            TotalCount: total,
            VisibleCount: visible,
            EndpointCountLabel: total > 0 ? FormatEndpointCount(localizer, total) : null,
            SelectEndpointMessage: localizer.GetString(SelectEndpointKey, "Select an endpoint from the sidebar to start testing"),
            SidebarEmptyMessage: localizer.GetString(NoResultsKey, "No matching endpoints"),
            SearchHint: localizer.GetString(SearchKey, "Search endpoints..."),
            ErrorMessage: localizer.GetString(ErrorKey, "Failed to load API endpoints"),
            RetryLabel: localizer.GetString(RetryKey, "Retry"),
            SelectedId: model.SelectedId,
            SelectedDetail: selectedDetail);
    }

    private static ApiPlaygroundState ResolveState(bool loading, bool hasError, int total, int visible)
    {
        if (hasError)
        {
            return ApiPlaygroundState.Error;
        }

        if (loading && total == 0)
        {
            return ApiPlaygroundState.Loading;
        }

        return visible > 0 ? ApiPlaygroundState.Success : ApiPlaygroundState.Empty;
    }

    private static IReadOnlyList<ApiEndpoint> Filter(IReadOnlyList<ApiEndpoint> catalog, string? query)
    {
        var trimmed = (query ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return catalog;
        }

        var matches = new List<ApiEndpoint>(catalog.Count);
        foreach (var endpoint in catalog)
        {
            if (endpoint.Path.Contains(trimmed, StringComparison.OrdinalIgnoreCase)
                || endpoint.Method.Contains(trimmed, StringComparison.OrdinalIgnoreCase)
                || endpoint.Tag.Contains(trimmed, StringComparison.OrdinalIgnoreCase)
                || endpoint.Summary.Contains(trimmed, StringComparison.OrdinalIgnoreCase))
            {
                matches.Add(endpoint);
            }
        }

        return matches;
    }

    private static IReadOnlyList<ApiEndpointGroup> GroupByTag(IReadOnlyList<ApiEndpoint> endpoints, string? selectedId)
    {
        if (endpoints.Count == 0)
        {
            return Array.Empty<ApiEndpointGroup>();
        }

        var ordered = endpoints
            .OrderBy(e => e.Tag, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => MethodWeight(e.Method))
            .ThenBy(e => e.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var groups = new List<ApiEndpointGroup>();
        var currentTag = (string?)null;
        var currentRows = new List<ApiEndpointItem>();

        foreach (var endpoint in ordered)
        {
            if (!string.Equals(currentTag, endpoint.Tag, StringComparison.Ordinal))
            {
                if (currentTag is not null)
                {
                    groups.Add(new ApiEndpointGroup(currentTag, currentRows));
                }

                currentTag = endpoint.Tag;
                currentRows = new List<ApiEndpointItem>();
            }

            currentRows.Add(new ApiEndpointItem(
                Id: endpoint.Id,
                Method: Normalize(endpoint.Method),
                Path: endpoint.Path,
                Tag: endpoint.Tag,
                Summary: endpoint.Summary,
                MethodStatus: MethodStatus(endpoint.Method),
                AutomationName: RowAutomationName(endpoint.Method, endpoint.Path),
                IsSelected: string.Equals(endpoint.Id, selectedId, StringComparison.Ordinal)));
        }

        if (currentTag is not null)
        {
            groups.Add(new ApiEndpointGroup(currentTag, currentRows));
        }

        return groups;
    }

    private static ApiEndpointDetail? ResolveDetail(IReadOnlyList<ApiEndpoint> catalog, string? selectedId, ILocalizer localizer)
    {
        if (string.IsNullOrEmpty(selectedId))
        {
            return null;
        }

        ApiEndpoint? selected = null;
        foreach (var endpoint in catalog)
        {
            if (string.Equals(endpoint.Id, selectedId, StringComparison.Ordinal))
            {
                selected = endpoint;
                break;
            }
        }

        if (selected is null)
        {
            return null;
        }

        var sections = ProjectParameterSections(selected.Parameters, localizer);

        return new ApiEndpointDetail(
            Method: Normalize(selected.Method),
            Path: selected.Path,
            Tag: selected.Tag,
            Summary: selected.Summary,
            Description: selected.Description,
            MethodStatus: MethodStatus(selected.Method),
            ParameterSections: sections,
            HasParameters: sections.Count > 0,
            AutomationName: DetailAutomationName(selected.Method, selected.Path, selected.Summary));
    }

    private static IReadOnlyList<ApiEndpointParamSection> ProjectParameterSections(
        IReadOnlyList<ApiEndpointParam> parameters,
        ILocalizer localizer)
    {
        if (parameters is null || parameters.Count == 0)
        {
            return Array.Empty<ApiEndpointParamSection>();
        }

        var pathItems = new List<ApiEndpointParamItem>();
        var queryItems = new List<ApiEndpointParamItem>();

        foreach (var parameter in parameters)
        {
            var label = parameter.Required
                ? localizer.GetString(RequiredKey, "Required")
                : localizer.GetString(OptionalKey, "Optional");
            var item = new ApiEndpointParamItem(parameter.Name, parameter.Type, parameter.Required, label);

            if (string.Equals(parameter.In, "path", StringComparison.OrdinalIgnoreCase))
            {
                pathItems.Add(item);
            }
            else
            {
                queryItems.Add(item);
            }
        }

        var sections = new List<ApiEndpointParamSection>(2);
        if (pathItems.Count > 0)
        {
            sections.Add(new ApiEndpointParamSection(localizer.GetString(PathParamsKey, "Path Parameters"), pathItems));
        }

        if (queryItems.Count > 0)
        {
            sections.Add(new ApiEndpointParamSection(localizer.GetString(QueryParamsKey, "Query Parameters"), queryItems));
        }

        return sections;
    }

    private static string Normalize(string method) =>
        string.IsNullOrEmpty(method) ? string.Empty : method.Trim().ToUpperInvariant();
}

/// <summary>
/// The static catalog of documented TeslaSync API endpoints — the native source-of-truth mirror of the parsed
/// OpenAPI endpoint list the web page derives from <c>/system/openapi</c> (web/src/features/admin/pages/
/// ApiPlaygroundPage.tsx). Each entry targets a real backend route mounted under <c>/api/v1</c> (see
/// <c>internal/api/router.go</c>); the catalog reproduces the stable, documented contract this playground explores
/// and introduces no new surface. A host can replace it by injecting a live-spec <see cref="IApiPlaygroundFeed"/>.
/// </summary>
public static class ApiPlaygroundCatalog
{
    private const string Vehicles = "Vehicles";
    private const string Drives = "Drives";
    private const string Charging = "Charging";
    private const string Analytics = "Analytics";
    private const string Signals = "Signals";
    private const string Alerts = "Alerts";
    private const string Notifications = "Notifications";
    private const string System = "System";

    private static readonly ApiEndpoint[] Entries =
    [
        new("vehicles-list", "GET", "/vehicles", Vehicles, "List all registered vehicles",
            "Returns every vehicle registered with this TeslaSync instance, including display name, VIN and current online state.",
            Array.Empty<ApiEndpointParam>()),
        new("vehicle-state", "GET", "/vehicles/{vehicleID}/state", Vehicles, "Get the latest vehicle state",
            "Returns the most recent live state for a vehicle (drive / charge / park, climate, doors and locks) from the layered signal store.",
            [new ApiEndpointParam("vehicleID", "path", true, "integer")]),
        new("vehicle-battery", "GET", "/vehicles/{vehicleID}/battery", Vehicles, "Get battery status and range",
            "Returns the current state of charge, usable and rated range and charge limit for a vehicle.",
            [new ApiEndpointParam("vehicleID", "path", true, "integer")]),
        new("vehicle-energy", "GET", "/vehicles/{vehicleID}/energy", Vehicles, "Get energy consumption summary",
            "Returns the rolling energy consumption and efficiency summary for a vehicle.",
            [new ApiEndpointParam("vehicleID", "path", true, "integer")]),

        new("drives-list", "GET", "/drives", Drives, "List drives",
            "Returns a paginated list of completed drives, newest first.",
            [new ApiEndpointParam("limit", "query", false, "integer"), new ApiEndpointParam("offset", "query", false, "integer")]),
        new("drive-detail", "GET", "/drives/{driveID}", Drives, "Get a single drive",
            "Returns the summary for one drive: distance, duration, energy used and start / end locations.",
            [new ApiEndpointParam("driveID", "path", true, "integer")]),
        new("drive-telemetry", "GET", "/drives/{driveID}/telemetry", Drives, "Get per-point drive telemetry",
            "Returns the ordered telemetry samples for a drive (position, speed, power and battery level) for charting and replay.",
            [new ApiEndpointParam("driveID", "path", true, "integer")]),

        new("charging-list", "GET", "/charging", Charging, "List charging sessions",
            "Returns a paginated list of charging sessions, newest first.",
            [new ApiEndpointParam("limit", "query", false, "integer"), new ApiEndpointParam("offset", "query", false, "integer")]),
        new("charging-telemetry", "GET", "/charging/{sessionID}/telemetry", Charging, "Get charging session telemetry",
            "Returns the ordered telemetry samples for a charging session (power, voltage, current and battery level).",
            [new ApiEndpointParam("sessionID", "path", true, "integer")]),

        new("analytics-fleet", "GET", "/analytics/fleet", Analytics, "Fleet-wide statistics",
            "Returns aggregate fleet statistics: total distance, energy, drives and charging sessions over the selected window.",
            Array.Empty<ApiEndpointParam>()),
        new("analytics-tco", "GET", "/analytics/tco", Analytics, "Total cost of ownership",
            "Returns the modelled total cost of ownership, breaking energy, depreciation and maintenance apart.",
            Array.Empty<ApiEndpointParam>()),
        new("analytics-degradation", "GET", "/analytics/battery-degradation", Analytics, "Battery degradation trend",
            "Returns the estimated battery-capacity degradation trend derived from full-charge range over time.",
            Array.Empty<ApiEndpointParam>()),
        new("analytics-regen", "GET", "/analytics/regen", Analytics, "Regenerative braking analytics",
            "Returns the regenerative-braking energy-recovery summary across recent drives.",
            Array.Empty<ApiEndpointParam>()),

        new("signals-available", "GET", "/signals/{vehicleID}/available", Signals, "List available signals",
            "Returns the set of telemetry signals currently available for a vehicle.",
            [new ApiEndpointParam("vehicleID", "path", true, "integer")]),
        new("signals-live", "GET", "/signals/{vehicleID}/live", Signals, "Current live signal values",
            "Returns the current value of every live signal for a vehicle from the layered live-state store.",
            [new ApiEndpointParam("vehicleID", "path", true, "integer")]),
        new("signal-history", "GET", "/signals/{vehicleID}/{signalName}/history", Signals, "Historical values for a signal",
            "Returns the time-series history for one signal over the requested window from the durable signal log.",
            [
                new ApiEndpointParam("vehicleID", "path", true, "integer"),
                new ApiEndpointParam("signalName", "path", true, "string"),
                new ApiEndpointParam("start", "query", false, "string"),
                new ApiEndpointParam("end", "query", false, "string"),
            ]),

        new("alerts-list", "GET", "/alerts", Alerts, "List triggered alerts",
            "Returns the list of alerts that have fired, newest first.",
            Array.Empty<ApiEndpointParam>()),
        new("alerts-rules", "GET", "/alerts/rules", Alerts, "List alert rules",
            "Returns every configured alert rule with its trigger condition and notification channels.",
            Array.Empty<ApiEndpointParam>()),
        new("alerts-test", "POST", "/alerts/test", Alerts, "Evaluate an alert rule",
            "Evaluates a candidate alert rule against the current data and returns whether it would fire, without persisting it.",
            Array.Empty<ApiEndpointParam>()),

        new("notifications-list", "GET", "/notifications", Notifications, "List notifications",
            "Returns the delivered notification history, newest first.",
            Array.Empty<ApiEndpointParam>()),
        new("notifications-stats", "GET", "/notifications/stats", Notifications, "Notification delivery statistics",
            "Returns aggregate delivery statistics across configured notification channels.",
            Array.Empty<ApiEndpointParam>()),

        new("system-status", "GET", "/system/status", System, "Overall system status",
            "Returns the overall health snapshot: component states, version, resources and active incidents.",
            Array.Empty<ApiEndpointParam>()),
        new("system-health", "GET", "/system/health", System, "Dependency health check",
            "Returns the readiness of each backing dependency (database, Redis, MQTT and the Tesla API).",
            Array.Empty<ApiEndpointParam>()),
        new("system-version", "GET", "/system/version", System, "Build and version info",
            "Returns the running build, version and commit metadata.",
            Array.Empty<ApiEndpointParam>()),
    ];

    /// <summary>The documented endpoint catalog, in declaration order (the projection sorts and groups it).</summary>
    public static IReadOnlyList<ApiEndpoint> Default => Entries;
}

/// <summary>
/// Canonical metadata for the <c>ApiPlaygroundPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/ApiPlaygroundPage.tsx</c> (web route <c>/api-playground</c>). The Windows shell
/// registers it under <see cref="RouteName"/> (RouteTable path <c>api-playground</c>, RouteGroup.AdminDevTools); the
/// page title resolves here so the registration and the projection share one key.
/// </summary>
public static class ApiPlaygroundRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ApiPlaygroundPage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>ApiPlayground</c>, path <c>api-playground</c>).</summary>
    public const string RouteName = "ApiPlayground";

    /// <summary>The localized page title (web <c>playground.title</c>).</summary>
    public static string Title(ILocalizer localizer) => ApiPlaygroundProjection.Title(localizer);

    /// <summary>The localized sidebar empty / no-match message (web <c>playground.noResults</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ApiPlaygroundProjection.NoResultsKey, "No matching endpoints");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ApiPlaygroundPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a route, label or endpoint path — so a
/// diagnostics line can never leak anything user-specific. Thread-safe.
/// </summary>
public sealed class ApiPlaygroundDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The optional diagnostics line sink; null disables emission.</param>
    public ApiPlaygroundDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ApiPlaygroundPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ApiPlaygroundRegistration.Slug}");
    }
}
