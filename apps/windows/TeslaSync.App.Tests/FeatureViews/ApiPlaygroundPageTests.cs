using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ApiPlaygroundPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/ApiPlaygroundPage.tsx), the documented endpoint catalog, the four web data states
/// (loading / empty / error / success), the tag-grouped sidebar rows (GlassPanel1), the select-an-endpoint prompt
/// with its available-endpoint count and the selected-endpoint detail (GlassPanel2), and the view-model's
/// feed-driven load / search / select flow. The WinUI view is exercised by the app build; its per-region content is
/// driven entirely by the <see cref="ApiPlaygroundDisplay"/> projection asserted here.
/// </summary>
public sealed class ApiPlaygroundPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The four manifest string keys the page resolves (PARITY: string).
    private static readonly string[] ManifestStringKeys =
    [
        "playground.title",
        "playground.subtitle",
        "playground.selectEndpoint",
        "playground.endpointCount",
    ];

    private static ApiPlaygroundModel Model(
        IReadOnlyList<ApiEndpoint>? endpoints = null,
        string query = "",
        string? selectedId = null,
        bool loading = false,
        bool hasError = false) =>
        new(endpoints ?? ApiPlaygroundCatalog.Default, query, selectedId, loading, hasError, null);

    // ---- i18n key coverage (PARITY: string) ----------------------------------------

    [Fact]
    public void Projection_resolves_every_manifest_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = ApiPlaygroundProjection.Project(Model(), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Manifest_strings_resolve_the_web_defaults()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);

        Assert.Equal("API Playground", display.Title);
        Assert.Equal("Explore and test TeslaSync API endpoints", display.Subtitle);
        Assert.Equal("Select an endpoint from the sidebar to start testing", display.SelectEndpointMessage);
    }

    [Fact]
    public void Endpoint_count_label_formats_the_total()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);
        var expected = ApiPlaygroundCatalog.Default.Count;

        Assert.NotNull(display.EndpointCountLabel);
        Assert.Contains(expected.ToString(System.Globalization.CultureInfo.CurrentCulture), display.EndpointCountLabel);
        Assert.Contains("endpoints available", display.EndpointCountLabel);
        Assert.Equal(expected, display.TotalCount);
    }

    [Fact]
    public void Endpoint_count_label_is_null_when_catalog_is_empty()
    {
        var display = ApiPlaygroundProjection.Project(Model(Array.Empty<ApiEndpoint>()), Localizer);
        Assert.Null(display.EndpointCountLabel);
    }

    // ---- data states (PARITY: state) -----------------------------------------------

    [Fact]
    public void Default_catalog_projects_success_state()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);
        Assert.Equal(ApiPlaygroundState.Success, display.State);
    }

    [Fact]
    public void Loading_with_no_endpoints_projects_loading_state()
    {
        var display = ApiPlaygroundProjection.Project(Model(Array.Empty<ApiEndpoint>(), loading: true), Localizer);
        Assert.Equal(ApiPlaygroundState.Loading, display.State);
    }

    [Fact]
    public void Empty_catalog_projects_empty_state()
    {
        var display = ApiPlaygroundProjection.Project(Model(Array.Empty<ApiEndpoint>()), Localizer);

        Assert.Equal(ApiPlaygroundState.Empty, display.State);
        Assert.Empty(display.Groups);
        Assert.False(string.IsNullOrWhiteSpace(display.SidebarEmptyMessage));
    }

    [Fact]
    public void Error_projects_error_state_with_message()
    {
        var display = ApiPlaygroundProjection.Project(Model(Array.Empty<ApiEndpoint>(), hasError: true), Localizer);

        Assert.Equal(ApiPlaygroundState.Error, display.State);
        Assert.False(string.IsNullOrWhiteSpace(display.ErrorMessage));
        Assert.False(string.IsNullOrWhiteSpace(display.RetryLabel));
    }

    [Fact]
    public void Search_with_no_match_projects_empty_state_but_keeps_total_count()
    {
        var display = ApiPlaygroundProjection.Project(Model(query: "zzz-no-such-endpoint"), Localizer);

        Assert.Equal(ApiPlaygroundState.Empty, display.State);
        Assert.Empty(display.Groups);
        Assert.Equal(0, display.VisibleCount);
        Assert.True(display.TotalCount > 0);
        Assert.NotNull(display.EndpointCountLabel);
    }

    [Fact]
    public void Search_filters_rows_case_insensitively()
    {
        var display = ApiPlaygroundProjection.Project(Model(query: "charging"), Localizer);

        Assert.Equal(ApiPlaygroundState.Success, display.State);
        Assert.All(
            display.Groups.SelectMany(g => g.Endpoints),
            row => Assert.Contains("charging", row.Path, StringComparison.OrdinalIgnoreCase));
    }

    // ---- sidebar rows (PARITY: GlassPanel1) ----------------------------------------

    [Fact]
    public void Groups_are_ordered_by_tag_then_method_then_path()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);

        var tags = display.Groups.Select(g => g.Tag).ToArray();
        Assert.Equal(tags.OrderBy(t => t, StringComparer.OrdinalIgnoreCase).ToArray(), tags);

        var alerts = display.Groups.Single(g => g.Tag == "Alerts").Endpoints;
        Assert.Collection(
            alerts,
            e => Assert.Equal("/alerts", e.Path),
            e => Assert.Equal("/alerts/rules", e.Path),
            e => Assert.Equal("/alerts/test", e.Path));
        Assert.Equal("POST", alerts[^1].Method);
    }

    [Fact]
    public void Method_badges_carry_the_semantic_status()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);
        var rows = display.Groups.SelectMany(g => g.Endpoints).ToList();

        Assert.Equal(StatusKind.Info, rows.Single(r => r.Id == "vehicles-list").MethodStatus);
        Assert.Equal(StatusKind.Success, rows.Single(r => r.Id == "alerts-test").MethodStatus);
    }

    [Fact]
    public void Selected_row_is_flagged_in_the_sidebar()
    {
        var display = ApiPlaygroundProjection.Project(Model(selectedId: "vehicles-list"), Localizer);
        var rows = display.Groups.SelectMany(g => g.Endpoints).ToList();

        Assert.True(rows.Single(r => r.Id == "vehicles-list").IsSelected);
        Assert.All(rows.Where(r => r.Id != "vehicles-list"), r => Assert.False(r.IsSelected));
    }

    [Fact]
    public void Row_automation_name_is_method_and_path()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);
        var row = display.Groups.SelectMany(g => g.Endpoints).Single(r => r.Id == "vehicles-list");

        Assert.Equal("GET /vehicles", row.AutomationName);
    }

    // ---- main panel detail (PARITY: GlassPanel2) -----------------------------------

    [Fact]
    public void No_selection_has_no_detail()
    {
        var display = ApiPlaygroundProjection.Project(Model(), Localizer);
        Assert.Null(display.SelectedDetail);
        Assert.Null(display.SelectedId);
    }

    [Fact]
    public void Unknown_selection_has_no_detail()
    {
        var display = ApiPlaygroundProjection.Project(Model(selectedId: "does-not-exist"), Localizer);
        Assert.Null(display.SelectedDetail);
    }

    [Fact]
    public void Selecting_endpoint_projects_grouped_parameter_detail()
    {
        var display = ApiPlaygroundProjection.Project(Model(selectedId: "signal-history"), Localizer);

        var detail = display.SelectedDetail;
        Assert.NotNull(detail);
        Assert.Equal("GET", detail!.Method);
        Assert.Equal("/signals/{vehicleID}/{signalName}/history", detail.Path);
        Assert.Equal("Signals", detail.Tag);
        Assert.True(detail.HasParameters);

        Assert.Collection(
            detail.ParameterSections,
            path =>
            {
                Assert.Equal("Path Parameters", path.Heading);
                Assert.Equal(new[] { "vehicleID", "signalName" }, path.Items.Select(p => p.Name).ToArray());
                Assert.All(path.Items, p => Assert.True(p.Required));
                Assert.All(path.Items, p => Assert.Equal("Required", p.RequirementLabel));
            },
            query =>
            {
                Assert.Equal("Query Parameters", query.Heading);
                Assert.Equal(new[] { "start", "end" }, query.Items.Select(p => p.Name).ToArray());
                Assert.All(query.Items, p => Assert.False(p.Required));
                Assert.All(query.Items, p => Assert.Equal("Optional", p.RequirementLabel));
            });
    }

    [Fact]
    public void Parameterless_endpoint_detail_has_no_sections()
    {
        var display = ApiPlaygroundProjection.Project(Model(selectedId: "vehicles-list"), Localizer);

        var detail = display.SelectedDetail;
        Assert.NotNull(detail);
        Assert.False(detail!.HasParameters);
        Assert.Empty(detail.ParameterSections);
        Assert.Equal("GET /vehicles. List all registered vehicles", detail.AutomationName);
    }

    [Fact]
    public void Detail_projection_resolves_the_parameter_section_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = ApiPlaygroundProjection.Project(Model(selectedId: "signal-history"), recorder);

        Assert.Contains("playground.pathParams", recorder.Keys);
        Assert.Contains("playground.queryParams", recorder.Keys);
    }

    // ---- catalog sanity ------------------------------------------------------------

    [Fact]
    public void Catalog_ids_are_unique()
    {
        var ids = ApiPlaygroundCatalog.Default.Select(e => e.Id).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public void Catalog_paths_are_relative_to_the_api_prefix()
    {
        // The request client adds /api/v1; catalog paths must not double-prefix it (web ❌ #7).
        Assert.All(ApiPlaygroundCatalog.Default, e => Assert.StartsWith("/", e.Path));
        Assert.DoesNotContain(ApiPlaygroundCatalog.Default, e => e.Path.StartsWith("/api/v1", StringComparison.Ordinal));
    }

    [Fact]
    public void Catalog_covers_multiple_tags()
    {
        var tags = ApiPlaygroundCatalog.Default.Select(e => e.Tag).Distinct().ToList();
        Assert.True(tags.Count >= 5);
    }

    // ---- registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_exposes_route_slug_and_title()
    {
        Assert.Equal("ApiPlayground", ApiPlaygroundRegistration.RouteName);
        Assert.Equal("ApiPlaygroundPage", ApiPlaygroundRegistration.Slug);
        Assert.Equal("API Playground", ApiPlaygroundRegistration.Title(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(ApiPlaygroundRegistration.EmptyMessage(Localizer)));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        string? captured = null;
        var diagnostics = new ApiPlaygroundDiagnostics(line => captured = line);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ApiPlaygroundPage", captured);
    }

    // ---- view-model flow -----------------------------------------------------------

    [Fact]
    public async Task ViewModel_default_feed_loads_success_with_endpoints()
    {
        var vm = new ApiPlaygroundPageViewModel(null, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ApiPlaygroundState.Success, vm.State);
        Assert.Equal(ApiPlaygroundCatalog.Default.Count, vm.TotalCount);
        Assert.Equal("API Playground", vm.Title);
        Assert.Equal("Explore and test TeslaSync API endpoints", vm.Subtitle);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_feed_degrades_to_empty()
    {
        var vm = new ApiPlaygroundPageViewModel(EmptyApiPlaygroundFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(ApiPlaygroundState.Empty, vm.State);
        Assert.Equal(0, vm.TotalCount);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failed_feed_surfaces_error()
    {
        var vm = new ApiPlaygroundPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(ApiPlaygroundState.Error, vm.State);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_select_endpoint_shows_detail()
    {
        var vm = new ApiPlaygroundPageViewModel(null, Localizer);
        await vm.LoadAsync();

        vm.SelectEndpoint("drive-detail");

        Assert.True(vm.HasSelection);
        Assert.Equal("drive-detail", vm.SelectedId);
        Assert.NotNull(vm.Display.SelectedDetail);
        Assert.Equal("/drives/{driveID}", vm.Display.SelectedDetail!.Path);
    }

    [Fact]
    public async Task ViewModel_clear_selection_returns_to_prompt()
    {
        var vm = new ApiPlaygroundPageViewModel(null, Localizer);
        await vm.LoadAsync();
        vm.SelectEndpoint("drive-detail");

        vm.ClearSelection();

        Assert.False(vm.HasSelection);
        Assert.Null(vm.SelectedId);
        Assert.Null(vm.Display.SelectedDetail);
    }

    [Fact]
    public async Task ViewModel_set_query_filters_without_dropping_total()
    {
        var vm = new ApiPlaygroundPageViewModel(null, Localizer);
        await vm.LoadAsync();

        vm.SetQuery("zzz-no-such-endpoint");

        Assert.Equal(ApiPlaygroundState.Empty, vm.State);
        Assert.True(vm.TotalCount > 0);
        Assert.Equal("zzz-no-such-endpoint", vm.Query);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_on_load()
    {
        var vm = new ApiPlaygroundPageViewModel(null, Localizer);
        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        await vm.LoadAsync();

        Assert.True(raised);
    }

    [Fact]
    public void ViewModel_notify_opened_records_through_diagnostics()
    {
        string? captured = null;
        var diagnostics = new ApiPlaygroundDiagnostics(line => captured = line);
        var vm = new ApiPlaygroundPageViewModel(null, Localizer, diagnostics);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=ApiPlaygroundPage", captured);
    }

    // ---- test doubles --------------------------------------------------------------

    private sealed class ThrowingFeed : IApiPlaygroundFeed
    {
        public Task<ApiPlaygroundSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromException<ApiPlaygroundSnapshot>(new InvalidOperationException("catalog unavailable"));
    }

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
