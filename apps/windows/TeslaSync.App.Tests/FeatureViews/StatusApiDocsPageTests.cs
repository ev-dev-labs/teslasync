using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StatusApiDocsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/StatusApiDocsPage.tsx), the static six-endpoint catalog, the single success data
/// state (plus the defensive empty branch), the per-endpoint description / example / Narrator composition, and the
/// view-model's local-state load flow. The WinUI view is exercised by the app build; its per-region content
/// (GlassPanel1 endpoint cards, GlassPanel2 overview, GlassPanel3 footer) is driven entirely by the
/// <see cref="StatusApiDocsDisplay"/> projection asserted here.
/// </summary>
public sealed class StatusApiDocsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The framing string keys the page resolves (the GlassPanel2 overview + header + GlassPanel3 footer).
    private static readonly string[] FramingStringKeys =
    [
        "statusApiDocs.title",
        "statusApiDocs.subtitle",
        "statusApiDocs.back",
        "statusApiDocs.overview.title",
        "statusApiDocs.overview.p1",
        "statusApiDocs.overview.p2",
        "statusApiDocs.overview.note",
        "statusApiDocs.exampleResponse",
        "statusApiDocs.footer",
    ];

    // The per-endpoint description keys the page resolves (one per GlassPanel1 endpoint card).
    private static readonly string[] EndpointStringKeys =
    [
        "statusApiDocs.endpoints.snapshot.description",
        "statusApiDocs.endpoints.components.description",
        "statusApiDocs.endpoints.resources.description",
        "statusApiDocs.endpoints.uptime.description",
        "statusApiDocs.endpoints.incidents.description",
        "statusApiDocs.endpoints.live.description",
    ];

    private static StatusApiDocsModel Model(IReadOnlyList<StatusEndpoint>? catalog = null) =>
        new(catalog ?? StatusApiEndpointCatalog.Default);

    // ---- i18n key coverage ---------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_framing_string()
    {
        var recorder = new RecordingLocalizer();

        _ = StatusApiDocsProjection.Project(Model(), recorder);

        foreach (var key in FramingStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_endpoint_description_string()
    {
        var recorder = new RecordingLocalizer();

        _ = StatusApiDocsProjection.Project(Model(), recorder);

        foreach (var key in EndpointStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Framing_strings_resolve_the_web_defaults()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);

        Assert.Equal("Status API", display.Title);
        Assert.Equal("Stable contract for external integrations", display.Subtitle);
        Assert.Equal("Back to System Status", display.BackLabel);
        Assert.Equal("Overview", display.OverviewHeading);
        Assert.Equal("Example response", display.ExampleResponseLabel);
        Assert.StartsWith("Need an additional endpoint or field?", display.Footer);
    }

    // ---- success data state (PARITY: state) ----------------------------------------

    [Fact]
    public void Default_catalog_projects_success_state()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);
        Assert.Equal(StatusApiDocsState.Success, display.State);
    }

    [Fact]
    public void Empty_catalog_projects_the_defensive_empty_state()
    {
        var display = StatusApiDocsProjection.Project(Model(Array.Empty<StatusEndpoint>()), Localizer);

        Assert.Equal(StatusApiDocsState.Empty, display.State);
        Assert.Empty(display.Endpoints);
    }

    // ---- overview panel (PARITY: GlassPanel2) --------------------------------------

    [Fact]
    public void Overview_renders_two_paragraphs_then_the_amber_note()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);

        Assert.Collection(
            display.OverviewParagraphs,
            p => Assert.False(p.IsNote),
            p => Assert.False(p.IsNote),
            p => Assert.True(p.IsNote));
    }

    [Fact]
    public void Overview_paragraphs_resolve_the_web_copy()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);

        Assert.StartsWith("All endpoints are mounted under /api/v1/status", display.OverviewParagraphs[0].Text);
        Assert.StartsWith("Designed for: Grafana", display.OverviewParagraphs[1].Text);
        Assert.StartsWith("The shape is additive-only", display.OverviewParagraphs[2].Text);
    }

    // ---- endpoint cards (PARITY: GlassPanel1, one per endpoint) ---------------------

    [Fact]
    public void Six_endpoints_render_in_web_order()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);

        Assert.Collection(
            display.Endpoints,
            e => Assert.Equal("snapshot", e.Id),
            e => Assert.Equal("components", e.Id),
            e => Assert.Equal("resources", e.Id),
            e => Assert.Equal("uptime", e.Id),
            e => Assert.Equal("incidents", e.Id),
            e => Assert.Equal("live", e.Id));
    }

    [Fact]
    public void Endpoints_carry_the_web_paths()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);
        var paths = display.Endpoints.Select(e => e.Path).ToArray();

        Assert.Equal(
            new[]
            {
                "/api/v1/status",
                "/api/v1/status/components",
                "/api/v1/status/resources",
                "/api/v1/status/uptime",
                "/api/v1/status/incidents",
                "/api/v1/status/live",
            },
            paths);
    }

    [Fact]
    public void Every_endpoint_is_a_GET()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);
        Assert.All(display.Endpoints, e => Assert.Equal("GET", e.Method));
    }

    [Fact]
    public void Only_uptime_and_incidents_carry_a_query_hint()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);

        Assert.Null(display.Endpoints.Single(e => e.Id == "snapshot").Query);
        Assert.Null(display.Endpoints.Single(e => e.Id == "components").Query);
        Assert.Null(display.Endpoints.Single(e => e.Id == "resources").Query);
        Assert.Equal("window=24h | 7d | 30d | 90d | 1y", display.Endpoints.Single(e => e.Id == "uptime").Query);
        Assert.Equal("active=1 | limit=N", display.Endpoints.Single(e => e.Id == "incidents").Query);
        Assert.Null(display.Endpoints.Single(e => e.Id == "live").Query);
    }

    [Fact]
    public void Endpoint_description_and_automation_name_resolve()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);
        var snapshot = display.Endpoints[0];

        Assert.StartsWith("Overall snapshot", snapshot.Description);
        Assert.Equal($"GET /api/v1/status. {snapshot.Description}", snapshot.AutomationName);
    }

    [Fact]
    public void Endpoint_examples_are_the_verbatim_pretty_printed_json()
    {
        var display = StatusApiDocsProjection.Project(Model(), Localizer);

        Assert.Equal(StatusApiExamples.Snapshot, display.Endpoints[0].ExampleJson);
        Assert.Contains("\"status\": \"operational\"", display.Endpoints[0].ExampleJson);
        Assert.Contains("\"uptime_seconds\": 458321.4", display.Endpoints[2].ExampleJson);
        Assert.Contains("\"window\": \"30d\"", display.Endpoints[3].ExampleJson);
        Assert.Contains("MQTT broker reconnect storm", display.Endpoints[4].ExampleJson);
        // The live example contains an escaped backslash before n (web JSON.stringify of the '\\n' value), not a
        // real newline — so the rendered JSON shows two backslashes then 'n', byte-for-byte with the web docs page.
        Assert.Contains("event: status\\\\ndata:", display.Endpoints[5].ExampleJson);
    }

    [Fact]
    public void Catalog_is_the_six_canonical_endpoints()
    {
        Assert.Equal(6, StatusApiEndpointCatalog.Default.Count);
        Assert.Equal(
            StatusApiEndpointCatalog.Default.Count,
            StatusApiEndpointCatalog.Default.Select(e => e.Id).Distinct().Count());
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_default_catalog_is_success_with_six_endpoints()
    {
        var vm = new StatusApiDocsPageViewModel(Localizer);

        await vm.LoadAsync();

        Assert.Equal(StatusApiDocsState.Success, vm.State);
        Assert.True(vm.HasEndpoints);
        Assert.Equal(6, vm.Endpoints.Count);
        Assert.Equal("Status API", vm.Title);
        Assert.Equal("Stable contract for external integrations", vm.Subtitle);
        Assert.Equal("Back to System Status", vm.BackLabel);
    }

    [Fact]
    public async Task ViewModel_empty_catalog_degrades_to_empty_with_message()
    {
        var vm = new StatusApiDocsPageViewModel(Localizer, Array.Empty<StatusEndpoint>());

        await vm.RefreshAsync();

        Assert.Equal(StatusApiDocsState.Empty, vm.State);
        Assert.False(vm.HasEndpoints);
        Assert.Empty(vm.Endpoints);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_reload_reprojects_without_throwing()
    {
        var vm = new StatusApiDocsPageViewModel(Localizer);
        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.Reload();

        Assert.Equal(6, vm.Endpoints.Count);
        Assert.True(raised);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_back_route()
    {
        Assert.Equal("StatusApiDocs", StatusApiDocsRegistration.RouteName);
        Assert.Equal("StatusApiDocsPage", StatusApiDocsRegistration.Slug);
        Assert.Equal("Status API", StatusApiDocsRegistration.Title(Localizer));
        Assert.Equal("/system-status", StatusApiDocsRegistration.SystemStatusRoute);
        Assert.False(string.IsNullOrWhiteSpace(StatusApiDocsRegistration.EmptyMessage(Localizer)));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new StatusApiDocsDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatusApiDocsPage", captured);
    }

    [Fact]
    public void ViewModel_notify_opened_records_through_diagnostics()
    {
        string? captured = null;
        var diagnostics = new StatusApiDocsDiagnostics(line => captured = line);
        var vm = new StatusApiDocsPageViewModel(Localizer, diagnostics: diagnostics);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=StatusApiDocsPage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
