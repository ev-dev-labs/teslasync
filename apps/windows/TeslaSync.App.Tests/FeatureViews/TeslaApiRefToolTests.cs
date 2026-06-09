using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Tesla API reference surface's UI-thread-free logic — the static
/// endpoint catalog, the pure search adapter (port of the web <c>useMemo</c> filter), the state-holder
/// view-model's per-state transitions (populated / empty) and pagination math, the registration
/// metadata, the PII-safe diagnostics, the localized labels + Narrator names, and the exact set of
/// i18n keys. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class TeslaApiRefToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Catalog (port of TESLA_ENDPOINTS) -----------------------------------------

    [Fact]
    public void Catalog_has_the_eleven_web_endpoints_in_order()
    {
        IReadOnlyList<TeslaApiEndpoint> endpoints = TeslaApiEndpointCatalog.Endpoints;

        Assert.Equal(11, endpoints.Count);
        Assert.Equal(new TeslaApiEndpoint("GET", "/api/1/vehicles", "List vehicles"), endpoints[0]);
        Assert.Equal(new TeslaApiEndpoint("GET", "/api/1/vehicles/{id}/nearby_charging_sites", "Nearby chargers"), endpoints[^1]);
    }

    [Fact]
    public void Catalog_has_three_get_and_eight_post_endpoints()
    {
        IReadOnlyList<TeslaApiEndpoint> endpoints = TeslaApiEndpointCatalog.Endpoints;

        Assert.Equal(3, endpoints.Count(e => e.IsGet));
        Assert.Equal(8, endpoints.Count(e => !e.IsGet));
    }

    // ---- Endpoint method → badge status (web variant mapping) -----------------------

    [Fact]
    public void Get_endpoint_uses_info_status()
    {
        var endpoint = new TeslaApiEndpoint("GET", "/api/1/vehicles", "List vehicles");

        Assert.True(endpoint.IsGet);
        Assert.Equal(StatusKind.Info, endpoint.MethodStatus);
    }

    [Fact]
    public void Write_endpoint_uses_warning_status()
    {
        var endpoint = new TeslaApiEndpoint("POST", "/api/1/vehicles/{id}/command/wake_up", "Wake up vehicle");

        Assert.False(endpoint.IsGet);
        Assert.Equal(StatusKind.Warning, endpoint.MethodStatus);
    }

    // ---- Search adapter (port of the useMemo filter) --------------------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Filter_empty_or_whitespace_query_returns_the_whole_catalog(string? query)
    {
        IReadOnlyList<TeslaApiEndpoint> result = TeslaApiRefFilter.Apply(query);

        Assert.Equal(TeslaApiEndpointCatalog.Endpoints.Count, result.Count);
    }

    [Fact]
    public void Filter_matches_on_path_substring()
    {
        IReadOnlyList<TeslaApiEndpoint> result = TeslaApiRefFilter.Apply("door");

        Assert.Equal(2, result.Count);
        Assert.All(result, e => Assert.Contains("door", e.Path, System.StringComparison.Ordinal));
    }

    [Fact]
    public void Filter_matches_on_method_substring()
    {
        IReadOnlyList<TeslaApiEndpoint> result = TeslaApiRefFilter.Apply("POST");

        Assert.Equal(8, result.Count);
        Assert.All(result, e => Assert.False(e.IsGet));
    }

    [Fact]
    public void Filter_matches_on_description_substring()
    {
        IReadOnlyList<TeslaApiEndpoint> result = TeslaApiRefFilter.Apply("Wake");

        TeslaApiEndpoint match = Assert.Single(result);
        Assert.Equal("/api/1/vehicles/{id}/command/wake_up", match.Path);
    }

    [Fact]
    public void Filter_is_case_insensitive()
    {
        IReadOnlyList<TeslaApiEndpoint> lower = TeslaApiRefFilter.Apply("door");
        IReadOnlyList<TeslaApiEndpoint> upper = TeslaApiRefFilter.Apply("DOOR");

        Assert.Equal(2, upper.Count);
        Assert.Equal(lower.Select(e => e.Path), upper.Select(e => e.Path));
    }

    [Fact]
    public void Filter_no_match_returns_empty()
    {
        IReadOnlyList<TeslaApiEndpoint> result = TeslaApiRefFilter.Apply("nonexistent-endpoint");

        Assert.Empty(result);
    }

    [Fact]
    public void Filter_matches_the_query_verbatim_like_the_web_untrimmed_memo()
    {
        // The web trims only for the empty check; the match uses the raw query. A padded term that is
        // non-empty after trimming therefore matches nothing, because no field contains the spaces.
        IReadOnlyList<TeslaApiEndpoint> result = TeslaApiRefFilter.Apply("  door  ");

        Assert.Empty(result);
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_populated_with_every_endpoint()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer);

        Assert.Equal(string.Empty, vm.Search);
        Assert.Equal(11, vm.Filtered.Count);
        Assert.Equal(11, vm.TotalItems);
        Assert.Equal(11, vm.PageItems.Count);
        Assert.Equal(1, vm.Page);
        Assert.Equal(1, vm.PageCount);
        Assert.Equal(TeslaApiRefState.Populated, vm.State);
        Assert.False(vm.IsEmpty);
        Assert.True(vm.ShowPagination);
    }

    [Fact]
    public void ViewModel_filters_on_search()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer) { Search = "door" };

        Assert.Equal(2, vm.Filtered.Count);
        Assert.Equal(2, vm.PageItems.Count);
        Assert.Equal(TeslaApiRefState.Populated, vm.State);
    }

    [Fact]
    public void ViewModel_empty_state_when_no_endpoint_matches()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer) { Search = "nonexistent-endpoint" };

        Assert.Equal(TeslaApiRefState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.PageItems);
        Assert.Equal(0, vm.TotalItems);
        Assert.False(vm.ShowPagination);
    }

    [Fact]
    public void ViewModel_clearing_search_restores_the_full_catalog()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer) { Search = "door" };
        Assert.Equal(2, vm.Filtered.Count);

        vm.Search = string.Empty;

        Assert.Equal(11, vm.Filtered.Count);
        Assert.Equal(TeslaApiRefState.Populated, vm.State);
    }

    [Fact]
    public void ViewModel_page_is_clamped_to_the_available_range()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer);

        vm.Page = 99; // only one page exists for the 11-row catalog

        Assert.Equal(1, vm.Page);
        Assert.Equal(11, vm.PageItems.Count);
    }

    [Fact]
    public void ViewModel_search_resets_to_the_first_page()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer);

        vm.Search = "door";

        Assert.Equal(1, vm.Page);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_search_projection()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Search = "door";

        Assert.Contains(nameof(TeslaApiRefToolViewModel.Search), changed);
        Assert.Contains(nameof(TeslaApiRefToolViewModel.Filtered), changed);
        Assert.Contains(nameof(TeslaApiRefToolViewModel.PageItems), changed);
        Assert.Contains(nameof(TeslaApiRefToolViewModel.State), changed);
        Assert.Contains(nameof(TeslaApiRefToolViewModel.IsEmpty), changed);
        Assert.Contains(nameof(TeslaApiRefToolViewModel.TotalItems), changed);
    }

    [Fact]
    public void ViewModel_setting_same_search_does_not_raise()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer) { Search = "door" };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Search = "door"; // unchanged

        Assert.Empty(changed);
    }

    // ---- Accessibility names (Narrator) --------------------------------------------

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_names()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer);

        Assert.False(string.IsNullOrWhiteSpace(vm.SearchAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.TableAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.PaginationAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.FirstPageLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.PreviousPageLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.NextPageLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.LastPageLabel));
    }

    [Fact]
    public void ViewModel_copy_accessible_name_names_the_copied_path()
    {
        var vm = new TeslaApiRefToolViewModel(Localizer);

        string name = vm.CopyAccessibleName("/api/1/vehicles");

        Assert.Contains(vm.CopyLabel, name, System.StringComparison.Ordinal);
        Assert.Contains("/api/1/vehicles", name, System.StringComparison.Ordinal);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_tool()
    {
        Assert.Equal("tesla-api", TeslaApiRefToolRegistration.Id);
        Assert.Equal("devtools", TeslaApiRefToolRegistration.Category);
        Assert.Equal("TeslaApiRefTool", TeslaApiRefToolRegistration.Slug);
        Assert.Equal("admin:tesla-api-ref", TeslaApiRefToolRegistration.TableId);
        Assert.Equal("cyan", TeslaApiRefToolRegistration.Accent);
        Assert.False(string.IsNullOrEmpty(TeslaApiRefToolRegistration.IconGlyph));
        Assert.Equal("Tesla Api Ref", TeslaApiRefToolRegistration.Name(Localizer));
        Assert.Equal("Tesla Api Ref Desc", TeslaApiRefToolRegistration.Description(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TeslaApiRefToolDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TeslaApiRefTool", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_emits_the_search_query()
    {
        var lines = new List<string>();
        var diagnostics = new TeslaApiRefToolDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains("door", System.StringComparison.Ordinal));
    }

    // ---- i18n key parity (web t() call sites) --------------------------------------

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new TeslaApiRefToolViewModel(recorder);

        // Touch every localized surface the view renders.
        _ = vm.Title;
        _ = vm.Description;
        _ = vm.SearchHint;
        _ = vm.MethodHeader;
        _ = vm.PathHeader;
        _ = vm.DescriptionHeader;
        _ = vm.CopyLabel;
        _ = vm.CopiedLabel;
        _ = vm.EmptyTitle;
        _ = vm.EmptyMessage;
        _ = vm.FirstPageLabel;
        _ = vm.PreviousPageLabel;
        _ = vm.NextPageLabel;
        _ = vm.LastPageLabel;
        _ = vm.PaginationAccessibleName;

        string[] expected =
        [
            "Tesla Api Ref",
            "Tesla Api Ref Desc",
            "Search Endpoints",
            "Method",
            "Path",
            "Endpoint Desc",
            "common.copyButton.copy",
            "common.copyButton.copied",
            "devtools.teslaApiRef.emptyTitle",
            "devtools.teslaApiRef.emptyMessage",
            "pagination.first",
            "pagination.previous",
            "pagination.next",
            "pagination.last",
            "a11y.pagination",
        ];

        foreach (string key in expected)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(System.StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
