using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.BreadcrumbsSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Breadcrumbs</c> shared surface's UI-thread-free logic — the registration
/// metadata + label resolvers, the pure trail projection (<see cref="BreadcrumbProjection"/>), the responsive
/// collapse decision (<see cref="BreadcrumbResponsive"/>), the inert navigation seam
/// (<see cref="NullBreadcrumbNavigator"/>), the state holder that resolves the a11y labels, projects the items
/// and routes navigation/prefetch (<see cref="BreadcrumbsViewModel"/>), the PII-safe diagnostics and the
/// argument validation. Mirrors the web spec one-for-one (web/src/components/layout/Breadcrumbs.tsx): the
/// <c>items.length &lt;= 1</c> self-suppression, the leading <c>Dashboard</c> Home link, the per-crumb
/// <c>isLast</c> / <c>isMiddle</c> / link-vs-text decision and the two a11y keys. The WinUI view itself
/// (Breadcrumbs.cs, which lays out the landmark, the Home link, the chevrons and the responsive collapse) is
/// exercised by the app build.
/// </summary>
public sealed class BreadcrumbsTests
{
    private const string NavKey = "translation.a11y.breadcrumb";
    private const string NavFallback = "Breadcrumb";
    private const string HomeKey = "translation.a11y.breadcrumbHome";
    private const string HomeFallback = "Dashboard";

    // ── registration (slug, i18n keys + verbatim english fallbacks, defaults) ────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("Breadcrumbs", BreadcrumbsRegistration.Slug);
        Assert.Equal("Breadcrumbs", BreadcrumbsViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_web_i18n_keys_and_verbatim_english_fallbacks()
    {
        Assert.Equal(NavKey, BreadcrumbsRegistration.NavLabelKey);
        Assert.Equal(NavFallback, BreadcrumbsRegistration.NavLabelFallback);
        Assert.Equal(HomeKey, BreadcrumbsRegistration.HomeLabelKey);
        Assert.Equal(HomeFallback, BreadcrumbsRegistration.HomeLabelFallback);
    }

    [Fact]
    public void Registration_pins_the_web_layout_defaults()
    {
        Assert.Equal("/", BreadcrumbsRegistration.DefaultHomeHref);
        Assert.Equal(2, BreadcrumbsRegistration.MinimumTrailLength);
        Assert.Equal(640.0, BreadcrumbsRegistration.CollapseWidthThreshold);
        Assert.Equal(200.0, BreadcrumbsRegistration.MaxLabelWidth);
        Assert.Equal("\u2026", BreadcrumbsRegistration.CollapsedIndicator);
    }

    [Fact]
    public void ResolveNavLabel_reads_the_a11y_breadcrumb_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string label = BreadcrumbsRegistration.ResolveNavLabel(localizer);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(NavKey, call.Key);
        Assert.Equal(NavFallback, call.Fallback);
        Assert.Equal(NavFallback, label);
    }

    [Fact]
    public void ResolveHomeLabel_reads_the_a11y_breadcrumb_home_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string label = BreadcrumbsRegistration.ResolveHomeLabel(localizer);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(HomeKey, call.Key);
        Assert.Equal(HomeFallback, call.Fallback);
        Assert.Equal(HomeFallback, label);
    }

    [Fact]
    public void ResolveLabels_return_the_localized_values_when_the_catalogue_has_them()
    {
        var localizer = new RecordingLocalizer();
        localizer.Translations[NavKey] = "Brotkrümelnavigation";
        localizer.Translations[HomeKey] = "Übersicht";

        Assert.Equal("Brotkrümelnavigation", BreadcrumbsRegistration.ResolveNavLabel(localizer));
        Assert.Equal("Übersicht", BreadcrumbsRegistration.ResolveHomeLabel(localizer));
    }

    [Fact]
    public void ResolveLabels_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => BreadcrumbsRegistration.ResolveNavLabel(null!));
        Assert.Throws<ArgumentNullException>(() => BreadcrumbsRegistration.ResolveHomeLabel(null!));
    }

    // ── projection (the adapter): the web items.map + self-suppression ───────────────────────────────────

    [Fact]
    public void Build_with_no_items_is_not_visible()
    {
        BreadcrumbTrailView trail = BreadcrumbProjection.Build(Array.Empty<BreadcrumbItem>());

        Assert.False(trail.Visible);
        Assert.Empty(trail.Crumbs);
    }

    [Fact]
    public void Build_with_a_single_crumb_is_not_visible()
    {
        // web: `if (items.length <= 1) return null` — a lone crumb renders nothing.
        BreadcrumbTrailView trail = BreadcrumbProjection.Build([new BreadcrumbItem("Dashboard", "/")]);

        Assert.False(trail.Visible);
        BreadcrumbCrumb only = Assert.Single(trail.Crumbs);
        Assert.True(only.IsLast);
        Assert.False(only.IsMiddle);
    }

    [Fact]
    public void Build_with_two_crumbs_is_visible_and_flags_first_link_and_current()
    {
        BreadcrumbTrailView trail = BreadcrumbProjection.Build(
        [
            new BreadcrumbItem("Drives", "/drives"),
            new BreadcrumbItem("Drive 42", "/drives/42"),
        ]);

        Assert.True(trail.Visible);
        Assert.Equal(2, trail.Crumbs.Count);

        BreadcrumbCrumb first = trail.Crumbs[0];
        Assert.True(first.IsLink);
        Assert.False(first.IsLast);
        Assert.False(first.IsMiddle);

        BreadcrumbCrumb last = trail.Crumbs[1];
        Assert.True(last.IsLast);
        Assert.False(last.IsLink);
        Assert.False(last.IsMiddle);
    }

    [Fact]
    public void Build_flags_interior_crumbs_as_middle()
    {
        BreadcrumbTrailView trail = BreadcrumbProjection.Build(
        [
            new BreadcrumbItem("Drives", "/drives"),
            new BreadcrumbItem("2024", "/drives/2024"),
            new BreadcrumbItem("Drive 42", "/drives/2024/42"),
        ]);

        Assert.True(trail.Visible);
        Assert.False(trail.Crumbs[0].IsMiddle);
        Assert.True(trail.Crumbs[1].IsMiddle);
        Assert.False(trail.Crumbs[2].IsMiddle);
    }

    [Fact]
    public void Build_renders_a_crumb_without_an_href_as_text()
    {
        // web: `isLast || !item.href` → text. A non-last crumb without an href is muted text, not a link.
        BreadcrumbTrailView trail = BreadcrumbProjection.Build(
        [
            new BreadcrumbItem("Section"),
            new BreadcrumbItem("Drive 42", "/drives/42"),
        ]);

        Assert.False(trail.Crumbs[0].IsLink);
        Assert.False(trail.Crumbs[0].IsLast);
    }

    [Fact]
    public void Build_never_renders_the_last_crumb_as_a_link_even_with_an_href()
    {
        BreadcrumbTrailView trail = BreadcrumbProjection.Build(
        [
            new BreadcrumbItem("Drives", "/drives"),
            new BreadcrumbItem("Drive 42", "/drives/42"),
        ]);

        Assert.True(trail.Crumbs[1].IsLast);
        Assert.False(trail.Crumbs[1].IsLink);
    }

    [Fact]
    public void Build_preserves_labels_hrefs_and_indices()
    {
        BreadcrumbTrailView trail = BreadcrumbProjection.Build(
        [
            new BreadcrumbItem("Drives", "/drives"),
            new BreadcrumbItem("Drive 42", "/drives/42"),
        ]);

        Assert.Equal("Drives", trail.Crumbs[0].Label);
        Assert.Equal("/drives", trail.Crumbs[0].Href);
        Assert.Equal(0, trail.Crumbs[0].Index);
        Assert.Equal(1, trail.Crumbs[1].Index);
    }

    [Fact]
    public void Build_rejects_null_items() =>
        Assert.Throws<ArgumentNullException>(() => BreadcrumbProjection.Build(null!));

    // ── responsive (the web hidden sm:inline / sm:hidden collapse) ───────────────────────────────────────

    [Theory]
    [InlineData(320.0, true)]
    [InlineData(639.0, true)]
    [InlineData(640.0, false)]
    [InlineData(1280.0, false)]
    public void IsNarrow_collapses_below_the_sm_breakpoint(double width, bool expected) =>
        Assert.Equal(expected, BreadcrumbResponsive.IsNarrow(width, BreadcrumbsRegistration.CollapseWidthThreshold));

    [Fact]
    public void IsNarrow_treats_an_unmeasured_width_as_wide()
    {
        Assert.False(BreadcrumbResponsive.IsNarrow(0.0, BreadcrumbsRegistration.CollapseWidthThreshold));
        Assert.False(BreadcrumbResponsive.IsNarrow(-1.0, BreadcrumbsRegistration.CollapseWidthThreshold));
    }

    // ── NullBreadcrumbNavigator: inert fallback (web PrefetchLink outside a router) ───────────────────────

    [Fact]
    public void NullBreadcrumbNavigator_is_a_shared_no_op_singleton()
    {
        IBreadcrumbNavigator navigator = NullBreadcrumbNavigator.Instance;

        Assert.Same(NullBreadcrumbNavigator.Instance, navigator);
        Assert.Null(Record.Exception(() => navigator.Navigate("/drives")));
        Assert.Null(Record.Exception(() => navigator.Prefetch("/drives")));
    }

    // ── ViewModel: label resolution (web useTranslation) + homeAriaLabel/homeHref props ──────────────────

    [Fact]
    public void ViewModel_exposes_the_localized_labels_and_default_home_href()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);

        Assert.Equal(NavFallback, vm.NavLabel);
        Assert.Equal(HomeFallback, vm.HomeLabel);
        Assert.Equal("/", vm.HomeHref);
    }

    [Fact]
    public void ViewModel_resolves_labels_through_the_a11y_keys()
    {
        var localizer = new RecordingLocalizer();
        localizer.Translations[NavKey] = "Fil d'Ariane";
        localizer.Translations[HomeKey] = "Accueil";

        var vm = new BreadcrumbsViewModel(localizer);

        Assert.Equal("Fil d'Ariane", vm.NavLabel);
        Assert.Equal("Accueil", vm.HomeLabel);
        Assert.Contains((NavKey, NavFallback), localizer.Calls);
        Assert.Contains((HomeKey, HomeFallback), localizer.Calls);
    }

    [Fact]
    public void ViewModel_honours_an_explicit_home_aria_label_override()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance, homeAriaLabel: "Fleet home");

        Assert.Equal("Fleet home", vm.HomeLabel);
    }

    [Fact]
    public void ViewModel_honours_an_explicit_home_href_and_falls_back_to_root_when_blank()
    {
        var custom = new BreadcrumbsViewModel(PassthroughLocalizer.Instance, homeHref: "/fleet");
        var blank = new BreadcrumbsViewModel(PassthroughLocalizer.Instance, homeHref: "");

        Assert.Equal("/fleet", custom.HomeHref);
        Assert.Equal("/", blank.HomeHref);
    }

    // ── ViewModel: state (collapsed ≤1 crumb vs populated) driven by the items ───────────────────────────

    [Fact]
    public void ViewModel_starts_collapsed_with_no_items()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);

        Assert.False(vm.IsVisible);
        Assert.Empty(vm.Trail.Crumbs);
    }

    [Fact]
    public void SetItems_with_one_crumb_stays_collapsed()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);

        vm.SetItems([new BreadcrumbItem("Dashboard", "/")]);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void SetItems_with_two_crumbs_becomes_visible_and_projects_them()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);

        vm.SetItems([new BreadcrumbItem("Drives", "/drives"), new BreadcrumbItem("Drive 42")]);

        Assert.True(vm.IsVisible);
        Assert.Equal(2, vm.Trail.Crumbs.Count);
    }

    [Fact]
    public void SetItems_raises_property_changed_for_trail_and_visibility()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);
        var raised = new List<string>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName ?? string.Empty);

        vm.SetItems([new BreadcrumbItem("Drives", "/drives"), new BreadcrumbItem("Drive 42")]);

        Assert.Contains(nameof(BreadcrumbsViewModel.Trail), raised);
        Assert.Contains(nameof(BreadcrumbsViewModel.IsVisible), raised);
    }

    [Fact]
    public void SetItems_rejects_null_items()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);

        Assert.Throws<ArgumentNullException>(() => vm.SetItems(null!));
    }

    // ── ViewModel: navigation + prefetch route through the seam (web PrefetchLink) ───────────────────────

    [Fact]
    public void NavigateHome_routes_to_the_home_href_and_records_the_navigation()
    {
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        var vm = new BreadcrumbsViewModel(
            PassthroughLocalizer.Instance, navigator, new BreadcrumbsDiagnostics(captured.Add), homeHref: "/fleet");

        vm.NavigateHome();

        Assert.Equal("/fleet", Assert.Single(navigator.Navigations));
        Assert.Equal("breadcrumb.navigated slug=Breadcrumbs", Assert.Single(captured));
    }

    [Fact]
    public void Navigate_routes_to_the_crumb_href_and_records_the_navigation()
    {
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        var vm = new BreadcrumbsViewModel(
            PassthroughLocalizer.Instance, navigator, new BreadcrumbsDiagnostics(captured.Add));

        vm.Navigate("/drives");

        Assert.Equal("/drives", Assert.Single(navigator.Navigations));
        Assert.Equal("breadcrumb.navigated slug=Breadcrumbs", Assert.Single(captured));
    }

    [Fact]
    public void PrefetchHome_and_Prefetch_route_through_the_seam_and_record_the_prefetch()
    {
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        var vm = new BreadcrumbsViewModel(
            PassthroughLocalizer.Instance, navigator, new BreadcrumbsDiagnostics(captured.Add), homeHref: "/fleet");

        vm.PrefetchHome();
        vm.Prefetch("/drives");

        Assert.Equal(new[] { "/fleet", "/drives" }, navigator.Prefetches);
        string[] expectedPrefetch =
        [
            "breadcrumb.prefetched slug=Breadcrumbs",
            "breadcrumb.prefetched slug=Breadcrumbs",
        ];
        Assert.Equal(expectedPrefetch, captured);
    }

    [Fact]
    public void Navigate_and_Prefetch_are_safe_no_ops_for_a_blank_href()
    {
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        var vm = new BreadcrumbsViewModel(
            PassthroughLocalizer.Instance, navigator, new BreadcrumbsDiagnostics(captured.Add));

        vm.Navigate("");
        vm.Prefetch("");

        Assert.Empty(navigator.Navigations);
        Assert.Empty(navigator.Prefetches);
        Assert.Empty(captured);
    }

    [Fact]
    public void ViewModel_defaults_to_the_inert_navigator_when_none_is_supplied()
    {
        var vm = new BreadcrumbsViewModel(PassthroughLocalizer.Instance);

        Assert.Null(Record.Exception(vm.NavigateHome));
        Assert.Null(Record.Exception(() => vm.Navigate("/drives")));
    }

    // ── ViewModel: view.opened is emitted once on open (web component mount) ─────────────────────────────

    [Fact]
    public void MarkOpened_records_the_view_opened_event_once()
    {
        var captured = new List<string>();
        var vm = new BreadcrumbsViewModel(
            PassthroughLocalizer.Instance, diagnostics: new BreadcrumbsDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=Breadcrumbs", Assert.Single(captured));
    }

    // ── ViewModel: argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new BreadcrumbsViewModel(null!));

    // ── accessibility: the landmark + home link expose the localized names ───────────────────────────────

    [Fact]
    public void The_landmark_and_home_link_carry_the_localized_accessible_names()
    {
        var localizer = new RecordingLocalizer();
        localizer.Translations[NavKey] = "Ruta de navegación";
        localizer.Translations[HomeKey] = "Inicio";

        var vm = new BreadcrumbsViewModel(localizer);

        // The view applies these as AutomationProperties.Name on the landmark and the Home link.
        Assert.Equal("Ruta de navegación", vm.NavLabel);
        Assert.Equal("Inicio", vm.HomeLabel);
    }

    // ── diagnostics (P1/S11): slug-only operational counters, never the label or href ────────────────────

    [Fact]
    public void Diagnostics_count_and_emit_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new BreadcrumbsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordNavigated();
        diagnostics.RecordPrefetched();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Navigations);
        Assert.Equal(1, diagnostics.Prefetches);
        string[] expected =
        [
            "view.opened slug=Breadcrumbs",
            "breadcrumb.navigated slug=Breadcrumbs",
            "breadcrumb.prefetched slug=Breadcrumbs",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_never_leak_the_crumb_label_or_href()
    {
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        var vm = new BreadcrumbsViewModel(
            PassthroughLocalizer.Instance, navigator, new BreadcrumbsDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.Navigate("/charging/42");
        vm.Prefetch("/charging/42");

        Assert.All(captured, line =>
        {
            Assert.DoesNotContain("/charging/42", line, StringComparison.Ordinal);
            Assert.DoesNotContain("42", line, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new BreadcrumbsDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private sealed class FakeNavigator : IBreadcrumbNavigator
    {
        public List<string> Navigations { get; } = [];

        public List<string> Prefetches { get; } = [];

        public void Navigate(string href) => Navigations.Add(href);

        public void Prefetch(string href) => Prefetches.Add(href);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<(string Key, string Fallback)> _calls = [];

        public IReadOnlyList<(string Key, string Fallback)> Calls => _calls;

        public Dictionary<string, string> Translations { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            _calls.Add((key, fallback));
            return Translations.TryGetValue(key, out string? value) ? value : fallback;
        }
    }
}
