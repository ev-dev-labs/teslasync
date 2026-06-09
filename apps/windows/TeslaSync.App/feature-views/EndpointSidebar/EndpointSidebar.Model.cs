using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Endpoints;

/// <summary>
/// The HTTP verb of a parsed endpoint — the native union of the web method type
/// (<c>'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'</c> in
/// web/src/features/admin/components/EndpointSidebar.tsx). <see cref="Other"/> is the safe fallback for any
/// verb outside that closed set, mirroring the web <c>METHOD_COLORS[method] ?? gray</c> default so an
/// unexpected method still renders with the muted badge rather than crashing.
/// </summary>
public enum EndpointMethod
{
    /// <summary>HTTP GET (web green badge).</summary>
    Get,

    /// <summary>HTTP POST (web blue badge).</summary>
    Post,

    /// <summary>HTTP PUT (web amber badge).</summary>
    Put,

    /// <summary>HTTP DELETE (web red badge).</summary>
    Delete,

    /// <summary>HTTP PATCH (web purple badge).</summary>
    Patch,

    /// <summary>Any verb outside the closed set (web gray fallback badge).</summary>
    Other,
}

/// <summary>
/// Where a parameter is carried — the native union of the web <c>ParsedParam.in</c> field
/// (<c>'path' | 'query'</c>). Part of the shared <see cref="ParsedEndpoint"/> contract exported from the web
/// source file; the sidebar itself does not render parameters, but the type is reproduced so the native
/// shape is faithful to the source's public surface (no scope narrowing).
/// </summary>
public enum ParamLocation
{
    /// <summary>A path parameter (web <c>'path'</c>).</summary>
    Path,

    /// <summary>A query parameter (web <c>'query'</c>).</summary>
    Query,
}

/// <summary>
/// One parsed request parameter — the native mirror of the web <c>ParsedParam</c> interface
/// (web/src/features/admin/components/EndpointSidebar.tsx). Reproduced in full (the source exports it) even
/// though the sidebar list does not render parameters, so the shared endpoint contract is preserved.
/// </summary>
/// <param name="Name">The parameter name (web <c>name</c>).</param>
/// <param name="In">Where the parameter is carried (web <c>in</c>).</param>
/// <param name="Required">Whether the parameter is required (web <c>required</c>).</param>
/// <param name="Type">The schema type (web <c>type</c>).</param>
/// <param name="Description">The human description (web <c>description</c>).</param>
/// <param name="Default">The optional default value (web <c>default?</c>).</param>
public sealed record ParsedParam(
    string Name,
    ParamLocation In,
    bool Required,
    string Type,
    string Description,
    string? Default = null);

/// <summary>
/// A parsed request body — the native mirror of the web <c>ParsedBody</c> interface. Part of the shared
/// endpoint contract; the sidebar does not render it, but it is reproduced so the native
/// <see cref="ParsedEndpoint"/> matches the source's exported shape.
/// </summary>
/// <param name="ContentType">The body media type (web <c>contentType</c>).</param>
/// <param name="Example">An optional example payload (web <c>example?</c>).</param>
/// <param name="Schema">An optional JSON schema map (web <c>schema?</c>).</param>
public sealed record ParsedBody(
    string ContentType,
    object? Example = null,
    IReadOnlyDictionary<string, object?>? Schema = null);

/// <summary>
/// One declared response — the native mirror of a web <c>responses</c> value
/// (<c>Record&lt;string, { description: string }&gt;</c>). Reproduced for contract fidelity; not rendered by
/// the sidebar.
/// </summary>
/// <param name="Description">The response description (web <c>description</c>).</param>
public sealed record ParsedResponse(string Description);

/// <summary>
/// One parsed API endpoint — the native port of the web <c>ParsedEndpoint</c> interface exported from
/// web/src/features/admin/components/EndpointSidebar.tsx. The sidebar reads <see cref="Method"/>,
/// <see cref="Path"/>, <see cref="Tag"/>, <see cref="Summary"/> and <see cref="OperationId"/> for grouping,
/// filtering, badges and tooltips; the remaining fields (<see cref="Description"/>,
/// <see cref="Parameters"/>, <see cref="RequestBody"/>, <see cref="Responses"/>) round out the shared
/// contract the parent page and detail surface consume. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Method">The HTTP verb (web <c>method</c>).</param>
/// <param name="Path">The endpoint path (web <c>path</c>).</param>
/// <param name="Tag">The grouping tag (web <c>tag</c>); empty falls back to "Other".</param>
/// <param name="Summary">The one-line summary shown as the row tooltip (web <c>summary</c>).</param>
/// <param name="Description">The long description (web <c>description</c>).</param>
/// <param name="OperationId">The operation id, also matched by search (web <c>operationId</c>).</param>
/// <param name="Parameters">The declared parameters (web <c>parameters</c>).</param>
/// <param name="RequestBody">The optional request body (web <c>requestBody?</c>).</param>
/// <param name="Responses">The declared responses keyed by status (web <c>responses</c>).</param>
public sealed record ParsedEndpoint(
    EndpointMethod Method,
    string Path,
    string Tag,
    string Summary,
    string Description,
    string OperationId,
    IReadOnlyList<ParsedParam> Parameters,
    ParsedBody? RequestBody,
    IReadOnlyDictionary<string, ParsedResponse> Responses)
{
    /// <summary>
    /// Convenience factory for the fields the sidebar actually renders, defaulting the rest of the shared
    /// contract to empty. Keeps test fixtures and the parent's projection terse without losing the full
    /// <see cref="ParsedEndpoint"/> shape.
    /// </summary>
    /// <param name="method">The HTTP verb.</param>
    /// <param name="path">The endpoint path.</param>
    /// <param name="tag">The grouping tag.</param>
    /// <param name="summary">The one-line summary.</param>
    /// <param name="operationId">The operation id (defaults to empty).</param>
    public static ParsedEndpoint ForList(
        EndpointMethod method,
        string path,
        string tag,
        string summary = "",
        string operationId = "") =>
        new(
            method,
            path,
            tag,
            summary,
            string.Empty,
            operationId,
            Array.Empty<ParsedParam>(),
            null,
            new Dictionary<string, ParsedResponse>(StringComparer.Ordinal));
}

/// <summary>
/// Pure helpers over <see cref="EndpointMethod"/> — the native analogue of the web <c>METHOD_COLORS</c> map
/// and the <c>MethodBadge</c> label (web/src/features/admin/components/EndpointSidebar.tsx). UI-free: colours
/// are returned as theme-token brush <em>keys</em>, so the WinUI badge resolves them through the design-token
/// pipeline (light / dark / high-contrast all flow from the token layer) without any hard-coded hex.
/// </summary>
public static class EndpointMethods
{
    /// <summary>Token brush key for the GET badge (web green).</summary>
    public const string GetBrushKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the POST badge (web blue).</summary>
    public const string PostBrushKey = "TsColorInfoBrush";

    /// <summary>Token brush key for the PUT badge (web amber).</summary>
    public const string PutBrushKey = "TsColorWarningBrush";

    /// <summary>Token brush key for the DELETE badge (web red).</summary>
    public const string DeleteBrushKey = "TsColorDangerBrush";

    /// <summary>Token brush key for the PATCH badge (web purple → app accent, per ClientUtilitiesSection).</summary>
    public const string PatchBrushKey = "TsColorAccentBrush";

    /// <summary>Token brush key for the fallback badge (web gray → muted text token).</summary>
    public const string OtherBrushKey = "TsColorTextMutedBrush";

    /// <summary>Parse a wire method string into the closed <see cref="EndpointMethod"/> set (unknown → <see cref="EndpointMethod.Other"/>).</summary>
    /// <param name="method">The raw method string (case-insensitive), e.g. from an OpenAPI document.</param>
    public static EndpointMethod Parse(string? method) =>
        (method ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "GET" => EndpointMethod.Get,
            "POST" => EndpointMethod.Post,
            "PUT" => EndpointMethod.Put,
            "DELETE" => EndpointMethod.Delete,
            "PATCH" => EndpointMethod.Patch,
            _ => EndpointMethod.Other,
        };

    /// <summary>The uppercase wire label shown in the badge (web renders the verb verbatim).</summary>
    /// <param name="method">The verb to label.</param>
    public static string Label(EndpointMethod method) => method switch
    {
        EndpointMethod.Get => "GET",
        EndpointMethod.Post => "POST",
        EndpointMethod.Put => "PUT",
        EndpointMethod.Delete => "DELETE",
        EndpointMethod.Patch => "PATCH",
        _ => "ANY",
    };

    /// <summary>The design-token brush key tinting the badge for <paramref name="method"/> (web <c>METHOD_COLORS</c>).</summary>
    /// <param name="method">The verb whose accent to resolve.</param>
    public static string BrushKey(EndpointMethod method) => method switch
    {
        EndpointMethod.Get => GetBrushKey,
        EndpointMethod.Post => PostBrushKey,
        EndpointMethod.Put => PutBrushKey,
        EndpointMethod.Delete => DeleteBrushKey,
        EndpointMethod.Patch => PatchBrushKey,
        _ => OtherBrushKey,
    };
}

/// <summary>
/// The render-ready view of one endpoint row — the native projection of a web sidebar
/// <c>&lt;UiButton&gt;…&lt;MethodBadge/&gt;…{ep.path}&lt;/UiButton&gt;</c>. Carries the source
/// <see cref="Endpoint"/> so the view can echo selection back through the <c>onSelect</c> callback exactly
/// as the web row's <c>onClick={() =&gt; onSelect(ep)}</c>. Pure data (no WinUI types) so it is asserted
/// headlessly.
/// </summary>
/// <param name="Endpoint">The source endpoint, echoed to the callback on click (web <c>ep</c>).</param>
/// <param name="RowKey">The stable list key (web <c>`${ep.method}-${ep.path}`</c>).</param>
/// <param name="MethodLabel">The uppercase verb label for the badge (web <c>{method}</c>).</param>
/// <param name="MethodBrushKey">The design-token brush key tinting the badge.</param>
/// <param name="Path">The endpoint path shown in the row (web <c>{ep.path}</c>).</param>
/// <param name="Summary">The one-line summary shown as the row tooltip (web <c>title={ep.summary}</c>).</param>
/// <param name="IsSelected">Whether this row is the selected endpoint (web <c>isSelected</c>).</param>
/// <param name="AutomationName">The Narrator name for the row, e.g. "GET /vehicles".</param>
public sealed record EndpointRowDisplay(
    ParsedEndpoint Endpoint,
    string RowKey,
    string MethodLabel,
    string MethodBrushKey,
    string Path,
    string Summary,
    bool IsSelected,
    string AutomationName);

/// <summary>
/// The render-ready view of one collapsible tag group — the native projection of a web <c>TagGroup</c>
/// (web/src/features/admin/components/EndpointSidebar.tsx). Carries the header, the row count, the effective
/// open state and the projected rows. Pure data — no WinUI types.
/// </summary>
/// <param name="Tag">The group tag, shown in the header (web <c>{tag}</c>).</param>
/// <param name="Count">The number of endpoints in the group (web <c>{endpoints.length}</c>).</param>
/// <param name="IsOpen">Whether the group is expanded (web per-group <c>open</c> state).</param>
/// <param name="Rows">The endpoint rows in declaration order.</param>
/// <param name="HeaderAutomationName">The Narrator name for the header, e.g. "Vehicles, 12 endpoints".</param>
public sealed record EndpointTagGroupDisplay(
    string Tag,
    int Count,
    bool IsOpen,
    IReadOnlyList<EndpointRowDisplay> Rows,
    string HeaderAutomationName);

/// <summary>
/// The fully projected, render-ready view of the whole sidebar — the native analogue of the web
/// <c>EndpointSidebar</c> render output. Carries the localized search hint, the endpoint-count line,
/// the ordered tag groups, and the mutually-exclusive empty branch (web <c>filtered.length === 0</c>). Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="SearchHint">The localized search field hint (web <c>t('playground.search')</c>).</param>
/// <param name="SearchAutomationName">The Narrator name for the search field (the hint).</param>
/// <param name="FilteredCount">The number of endpoints after the search filter (web <c>filtered.length</c>).</param>
/// <param name="CountLabel">The localized count line, e.g. "12 endpoints" (web <c>{n} {t('playground.endpoints')}</c>).</param>
/// <param name="Groups">The ordered, projected tag groups.</param>
/// <param name="IsEmpty">Whether the filtered result is empty (web <c>filtered.length === 0</c>).</param>
/// <param name="EmptyMessage">The localized empty message (web <c>t('playground.noResults')</c>).</param>
/// <param name="AutomationName">The Narrator name for the sidebar region (the count line).</param>
public sealed record EndpointSidebarDisplay(
    string SearchHint,
    string SearchAutomationName,
    int FilteredCount,
    string CountLabel,
    IReadOnlyList<EndpointTagGroupDisplay> Groups,
    bool IsEmpty,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// An ordered tag bucket produced by <see cref="EndpointSidebarProjection.Group"/> — the native analogue of
/// one entry in the web <c>grouped</c> map (a tag plus its endpoints, in declaration order). Kept WinUI-free.
/// </summary>
/// <param name="Tag">The group tag.</param>
/// <param name="Endpoints">The endpoints carrying that tag, in first-seen order.</param>
public sealed record EndpointTagGroup(string Tag, IReadOnlyList<ParsedEndpoint> Endpoints);

/// <summary>
/// The pure projection from the sidebar inputs (the endpoint list, the current selection, the search text
/// and the per-group open resolver) to the render-ready <see cref="EndpointSidebarDisplay"/> — the native
/// port of the web <c>EndpointSidebar</c> body (the <c>filtered</c> + <c>grouped</c> memos and the row /
/// group render) in web/src/features/admin/components/EndpointSidebar.tsx. Every owned string resolves
/// through the i18n facade using the web's exact keys; the search filter, tag grouping and default-open
/// logic mirror the web branch-for-branch. No SI conversion applies — the surface carries no measurements.
/// </summary>
public static class EndpointSidebarProjection
{
    /// <summary>i18n key for the search hint (web <c>t('playground.search', 'Search endpoints...')</c>).</summary>
    public const string SearchKey = "translation.playground.search";

    /// <summary>English fallback for <see cref="SearchKey"/>.</summary>
    public const string SearchFallback = "Search endpoints...";

    /// <summary>i18n key for the count noun (web <c>t('playground.endpoints', 'endpoints')</c>).</summary>
    public const string EndpointsKey = "translation.playground.endpoints";

    /// <summary>English fallback for <see cref="EndpointsKey"/>.</summary>
    public const string EndpointsFallback = "endpoints";

    /// <summary>i18n key for the empty message (web <c>t('playground.noResults', 'No matching endpoints')</c>).</summary>
    public const string NoResultsKey = "translation.playground.noResults";

    /// <summary>English fallback for <see cref="NoResultsKey"/>.</summary>
    public const string NoResultsFallback = "No matching endpoints";

    /// <summary>The literal fallback tag for an endpoint with no tag (web <c>ep.tag || 'Other'</c>).</summary>
    public const string OtherTag = "Other";

    /// <summary>The group-count threshold at or below which every group is open by default (web <c>grouped.size &lt;= 5</c>).</summary>
    public const int DefaultOpenGroupThreshold = 5;

    /// <summary>
    /// Filter the endpoints by the search text — the native port of the web <c>filtered</c> memo. An empty /
    /// whitespace query returns the list unchanged; otherwise an endpoint matches when its path, summary or
    /// operationId contains the query (case-insensitive), each read null-safely (web <c>(e.path ?? '')</c>).
    /// </summary>
    /// <param name="endpoints">The full endpoint list.</param>
    /// <param name="search">The current search text.</param>
    public static IReadOnlyList<ParsedEndpoint> Filter(IReadOnlyList<ParsedEndpoint> endpoints, string? search)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        string query = (search ?? string.Empty).Trim();
        if (query.Length == 0)
        {
            return endpoints;
        }

        var matched = new List<ParsedEndpoint>(endpoints.Count);
        foreach (var endpoint in endpoints)
        {
            if (Contains(endpoint.Path, query) ||
                Contains(endpoint.Summary, query) ||
                Contains(endpoint.OperationId, query))
            {
                matched.Add(endpoint);
            }
        }

        return matched;
    }

    /// <summary>
    /// Group the (already filtered) endpoints by tag, preserving first-seen tag order — the native port of
    /// the web <c>grouped</c> memo (an insertion-ordered <c>Map</c>). An empty tag falls back to
    /// <see cref="OtherTag"/> (web <c>ep.tag || 'Other'</c>).
    /// </summary>
    /// <param name="endpoints">The filtered endpoint list.</param>
    public static IReadOnlyList<EndpointTagGroup> Group(IReadOnlyList<ParsedEndpoint> endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        var order = new List<string>();
        var byTag = new Dictionary<string, List<ParsedEndpoint>>(StringComparer.Ordinal);

        foreach (var endpoint in endpoints)
        {
            string tag = string.IsNullOrEmpty(endpoint.Tag) ? OtherTag : endpoint.Tag;
            if (!byTag.TryGetValue(tag, out var list))
            {
                list = new List<ParsedEndpoint>();
                byTag[tag] = list;
                order.Add(tag);
            }

            list.Add(endpoint);
        }

        var groups = new List<EndpointTagGroup>(order.Count);
        foreach (var tag in order)
        {
            groups.Add(new EndpointTagGroup(tag, byTag[tag]));
        }

        return groups;
    }

    /// <summary>
    /// Whether a group is open by default — the native port of the web
    /// <c>defaultOpen={selected?.tag === tag || grouped.size &lt;= 5}</c>: open when it holds the selected
    /// endpoint's tag, or when there are at most <see cref="DefaultOpenGroupThreshold"/> groups in total.
    /// </summary>
    /// <param name="tag">The group's tag.</param>
    /// <param name="selectedTag">The selected endpoint's tag, or null when nothing is selected.</param>
    /// <param name="groupCount">The total number of groups currently shown.</param>
    public static bool DefaultOpen(string tag, string? selectedTag, int groupCount) =>
        string.Equals(tag, selectedTag, StringComparison.Ordinal) || groupCount <= DefaultOpenGroupThreshold;

    /// <summary>
    /// Project the sidebar inputs into the render-ready <see cref="EndpointSidebarDisplay"/>, resolving every
    /// owned string through <paramref name="localizer"/> and resolving each group's effective open state
    /// through <paramref name="resolveOpen"/> (the view-model's "user override on top of the default").
    /// </summary>
    /// <param name="endpoints">The full endpoint list.</param>
    /// <param name="selected">The currently selected endpoint, or null.</param>
    /// <param name="search">The current search text.</param>
    /// <param name="resolveOpen">Maps (tag, defaultOpen) to the effective open state — the override seam.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static EndpointSidebarDisplay Project(
        IReadOnlyList<ParsedEndpoint> endpoints,
        ParsedEndpoint? selected,
        string? search,
        Func<string, bool, bool> resolveOpen,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        ArgumentNullException.ThrowIfNull(resolveOpen);
        ArgumentNullException.ThrowIfNull(localizer);

        string searchHint = localizer.GetString(SearchKey, SearchFallback);
        string endpointsWord = localizer.GetString(EndpointsKey, EndpointsFallback);
        string emptyMessage = localizer.GetString(NoResultsKey, NoResultsFallback);

        var filtered = Filter(endpoints, search);
        var grouped = Group(filtered);
        string? selectedTag = SelectedTag(selected);

        var groups = new List<EndpointTagGroupDisplay>(grouped.Count);
        foreach (var group in grouped)
        {
            bool defaultOpen = DefaultOpen(group.Tag, selectedTag, grouped.Count);
            bool isOpen = resolveOpen(group.Tag, defaultOpen);

            var rows = new List<EndpointRowDisplay>(group.Endpoints.Count);
            foreach (var endpoint in group.Endpoints)
            {
                rows.Add(ProjectRow(endpoint, selected));
            }

            string headerName = string.Create(
                CultureInfo.InvariantCulture,
                $"{group.Tag}, {group.Endpoints.Count} {endpointsWord}");
            groups.Add(new EndpointTagGroupDisplay(group.Tag, group.Endpoints.Count, isOpen, rows, headerName));
        }

        string countLabel = string.Create(
            CultureInfo.InvariantCulture,
            $"{filtered.Count} {endpointsWord}");

        return new EndpointSidebarDisplay(
            SearchHint: searchHint,
            SearchAutomationName: searchHint,
            FilteredCount: filtered.Count,
            CountLabel: countLabel,
            Groups: groups,
            IsEmpty: filtered.Count == 0,
            EmptyMessage: emptyMessage,
            AutomationName: countLabel);
    }

    /// <summary>Project one endpoint into its row view, resolving the selected highlight (web <c>isSelected</c>).</summary>
    /// <param name="endpoint">The endpoint to project.</param>
    /// <param name="selected">The currently selected endpoint, or null.</param>
    public static EndpointRowDisplay ProjectRow(ParsedEndpoint endpoint, ParsedEndpoint? selected)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        bool isSelected = IsSameEndpoint(selected, endpoint);
        string label = EndpointMethods.Label(endpoint.Method);
        string rowKey = string.Create(CultureInfo.InvariantCulture, $"{label}-{endpoint.Path}");
        string automationName = string.Create(CultureInfo.InvariantCulture, $"{label} {endpoint.Path}");

        return new EndpointRowDisplay(
            Endpoint: endpoint,
            RowKey: rowKey,
            MethodLabel: label,
            MethodBrushKey: EndpointMethods.BrushKey(endpoint.Method),
            Path: endpoint.Path,
            Summary: endpoint.Summary ?? string.Empty,
            IsSelected: isSelected,
            AutomationName: automationName);
    }

    /// <summary>
    /// The tag the selected endpoint is grouped under — its <see cref="ParsedEndpoint.Tag"/>, or
    /// <see cref="OtherTag"/> when the selected endpoint has no tag (matching <see cref="Group"/>), or null
    /// when nothing is selected.
    /// </summary>
    /// <param name="selected">The selected endpoint, or null.</param>
    public static string? SelectedTag(ParsedEndpoint? selected)
    {
        if (selected is null)
        {
            return null;
        }

        return string.IsNullOrEmpty(selected.Tag) ? OtherTag : selected.Tag;
    }

    /// <summary>
    /// Whether two endpoints are the same selection — the native port of the web equality
    /// <c>selected?.path === ep.path &amp;&amp; selected?.method === ep.method</c>.
    /// </summary>
    /// <param name="a">The first endpoint, or null.</param>
    /// <param name="b">The second endpoint, or null.</param>
    public static bool IsSameEndpoint(ParsedEndpoint? a, ParsedEndpoint? b)
    {
        if (a is null || b is null)
        {
            return false;
        }

        return string.Equals(a.Path, b.Path, StringComparison.Ordinal) && a.Method == b.Method;
    }

    private static bool Contains(string? haystack, string needle) =>
        !string.IsNullOrEmpty(haystack) &&
        haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Canonical metadata for the EndpointSidebar surface — the native anchor for the web component at
/// web/src/features/admin/components/EndpointSidebar.tsx. The diagnostics <see cref="Slug"/> is the stable
/// surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class EndpointSidebarRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EndpointSidebar";
}

/// <summary>
/// PII-safe diagnostics for the EndpointSidebar surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a path, summary, operationId or any
/// endpoint field — so a diagnostics line can never leak an API surface detail. Thread-safe.
/// </summary>
public sealed class EndpointSidebarDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public EndpointSidebarDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EndpointSidebar</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EndpointSidebarRegistration.Slug}");
    }
}
