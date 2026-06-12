using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>LayoutBreadcrumbs</c> shared surface's UI-thread-free logic — the registration
/// metadata + label resolvers, the native parent chain, the route-metadata builder, the pure trail resolver
/// (<see cref="BreadcrumbResolver"/>), the route → trail adapter (<see cref="RouteBreadcrumbProjector"/>), the state
/// holder that re-resolves on route / override changes and routes activation (<see cref="LayoutBreadcrumbsViewModel"/>),
/// the PII-safe diagnostics and the argument validation. Mirrors the web spec one-for-one
/// (web/src/components/layout/LayoutBreadcrumbs.tsx + web/src/components/layout/Breadcrumbs.tsx +
/// web/src/hooks/useBreadcrumbs.ts + web/src/lib/routeMeta.ts): the <c>a11y.breadcrumb</c> / <c>a11y.breadcrumbHome</c>
/// labels, the override &gt; i18n &gt; default label precedence, the <c>{{param}}</c> / <c>:param</c> substitution, the
/// parent-chain walk and the one-or-zero-item suppression. The WinUI view itself (LayoutBreadcrumbs.cs, which composes
/// the Fluent row, links, chevrons and responsive collapse) is exercised by the app build.
/// </summary>
public sealed class LayoutBreadcrumbsTests
{
    private const string NavKey = "translation.a11y.breadcrumb";
    private const string NavFallback = "Breadcrumb";
    private const string HomeKey = "translation.a11y.breadcrumbHome";
    private const string HomeFallback = "Dashboard";

    // A small deterministic route-metadata table for the focused resolver / holder tests.
    private static IReadOnlyDictionary<string, BreadcrumbRouteMeta> SampleMeta() =>
        new Dictionary<string, BreadcrumbRouteMeta>(StringComparer.Ordinal)
        {
            ["a"] = new("a", "route.a", "A", null),
            ["a/b"] = new("a/b", "route.b", "B", "a"),
            ["a/b/:id"] = new("a/b/:id", "route.c", "Item {{id}}", "a/b"),
            ["x"] = new("x", "route.x", "X", "y"),
            ["y"] = new("y", "route.y", "Y", "x"),
        };

    private static IReadOnlyDictionary<string, string> Params(params (string Key, string Value)[] pairs)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach ((string key, string value) in pairs)
        {
            map[key] = value;
        }

        return map;
    }

    private static IReadOnlyDictionary<string, string> NoParams() => Params();

    private static IReadOnlyDictionary<string, string> NoOverrides() =>
        new Dictionary<string, string>(StringComparer.Ordinal);

    // ── Registration (slug, i18n keys + fallbacks, glyphs, automation ids, home href) ────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("LayoutBreadcrumbs", LayoutBreadcrumbsRegistration.Slug);
        Assert.Equal("LayoutBreadcrumbs", LayoutBreadcrumbsViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_web_i18n_keys_and_verbatim_english_fallbacks()
    {
        Assert.Equal(NavKey, LayoutBreadcrumbsRegistration.NavLabelKey);
        Assert.Equal(NavFallback, LayoutBreadcrumbsRegistration.NavLabelFallback);
        Assert.Equal(HomeKey, LayoutBreadcrumbsRegistration.HomeLabelKey);
        Assert.Equal(HomeFallback, LayoutBreadcrumbsRegistration.HomeLabelFallback);
    }

    [Fact]
    public void Registration_pins_the_home_href_glyphs_and_automation_ids()
    {
        Assert.Equal("/", LayoutBreadcrumbsRegistration.HomeHref);
        Assert.Equal("\uE80F", LayoutBreadcrumbsRegistration.HomeGlyph);
        Assert.Equal("\uE76C", LayoutBreadcrumbsRegistration.SeparatorGlyph);
        Assert.Equal("\u2026", LayoutBreadcrumbsRegistration.CollapseIndicator);
        Assert.Equal("breadcrumb", LayoutBreadcrumbsRegistration.NavAutomationId);
        Assert.Equal("breadcrumb-home", LayoutBreadcrumbsRegistration.HomeAutomationId);
    }

    [Fact]
    public void ResolveNavLabel_reads_the_breadcrumb_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string label = LayoutBreadcrumbsRegistration.ResolveNavLabel(localizer);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(NavKey, call.Key);
        Assert.Equal(NavFallback, call.Fallback);
        Assert.Equal(NavFallback, label);
    }

    [Fact]
    public void ResolveHomeLabel_reads_the_breadcrumb_home_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string label = LayoutBreadcrumbsRegistration.ResolveHomeLabel(localizer);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(HomeKey, call.Key);
        Assert.Equal(HomeFallback, call.Fallback);
        Assert.Equal(HomeFallback, label);
    }

    [Fact]
    public void ResolveLabels_return_the_localized_values_when_the_catalogue_has_them()
    {
        var localizer = new RecordingLocalizer
        {
            Translations =
            {
                [NavKey] = "Fil d'Ariane",
                [HomeKey] = "Tableau de bord",
            },
        };

        Assert.Equal("Fil d'Ariane", LayoutBreadcrumbsRegistration.ResolveNavLabel(localizer));
        Assert.Equal("Tableau de bord", LayoutBreadcrumbsRegistration.ResolveHomeLabel(localizer));
    }

    [Fact]
    public void ResolveLabels_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => LayoutBreadcrumbsRegistration.ResolveNavLabel(null!));
        Assert.Throws<ArgumentNullException>(() => LayoutBreadcrumbsRegistration.ResolveHomeLabel(null!));
    }

    // ── Parent chain (port of web PARENT_OVERRIDES) ──────────────────────────────────────────────────────

    [Fact]
    public void Parent_chain_maps_nested_routes_to_their_web_parents()
    {
        IReadOnlyDictionary<string, string> chain = BreadcrumbParentChain.Patterns;

        Assert.Equal("drives", chain["drives/:id"]);
        Assert.Equal("drives/:id", chain["drives/:id/replay"]);
        Assert.Equal("vehicles/:id", chain["vehicles/:id/access"]);
        Assert.Equal("notifications/inbox", chain["notifications/studio"]);
        Assert.Equal("analytics", chain["year-review/:year"]);
        // web '/me/activity' -> '/' maps to the native empty index pattern.
        Assert.Equal(string.Empty, chain["me/activity"]);
    }

    // ── Route-metadata builder (port of web ROUTE_META derivation) ───────────────────────────────────────

    [Fact]
    public void Route_metadata_attaches_parents_and_excludes_redirects()
    {
        IReadOnlyDictionary<string, BreadcrumbRouteMeta> meta = DefaultBreadcrumbRouteMeta.Map;

        // A nested route carries its breadcrumb parent.
        Assert.Equal("vehicles/:id", meta["vehicles/:id/access"].ParentPattern);
        Assert.Equal("Vehicle Access", meta["vehicles/:id/access"].DefaultTitle);

        // A top-level route has no parent.
        Assert.Null(meta["vehicles"].ParentPattern);

        // The empty index route (Dashboard) is present and parent-less.
        Assert.True(meta.ContainsKey(string.Empty));
        Assert.Null(meta[string.Empty].ParentPattern);

        // Redirect entries (no label) are excluded — 'alerts' redirects to notifications/alerts.
        Assert.False(meta.ContainsKey("alerts"));
    }

    // ── Resolver (the adapter): trail derivation, params, hrefs, overrides, suppression, cycles ───────────

    [Fact]
    public void Resolve_returns_an_empty_trail_for_an_unmatched_route()
    {
        IReadOnlyList<BreadcrumbItem> trail =
            BreadcrumbResolver.Resolve(null, NoParams(), NoOverrides(), SampleMeta(), PassthroughLocalizer.Instance);

        Assert.Empty(trail);
    }

    [Fact]
    public void Resolve_returns_a_single_item_for_a_top_level_route()
    {
        IReadOnlyList<BreadcrumbItem> trail =
            BreadcrumbResolver.Resolve("a", NoParams(), NoOverrides(), SampleMeta(), PassthroughLocalizer.Instance);

        BreadcrumbItem only = Assert.Single(trail);
        Assert.Equal("A", only.Label);
        Assert.True(only.IsCurrent);
        Assert.Null(only.Href);
        Assert.False(only.IsLink);
    }

    [Fact]
    public void Resolve_walks_the_parent_chain_root_to_current_with_hrefs_and_param_substitution()
    {
        IReadOnlyList<BreadcrumbItem> trail = BreadcrumbResolver.Resolve(
            "a/b/:id",
            Params(("id", "7")),
            NoOverrides(),
            SampleMeta(),
            PassthroughLocalizer.Instance);

        Assert.Equal(3, trail.Count);

        Assert.Equal("A", trail[0].Label);
        Assert.Equal("/a", trail[0].Href);
        Assert.True(trail[0].IsLink);
        Assert.False(trail[0].IsCurrent);

        Assert.Equal("B", trail[1].Label);
        Assert.Equal("/a/b", trail[1].Href);
        Assert.True(trail[1].IsLink);

        // {{id}} substituted in the label, :id substituted in the (absent) href; current crumb has no link.
        Assert.Equal("Item 7", trail[2].Label);
        Assert.True(trail[2].IsCurrent);
        Assert.Null(trail[2].Href);
        Assert.False(trail[2].IsLink);
    }

    [Fact]
    public void Resolve_applies_a_page_override_over_the_default_label()
    {
        var overrides = new Dictionary<string, string>(StringComparer.Ordinal) { ["a/b"] = "Trip to office" };

        IReadOnlyList<BreadcrumbItem> trail =
            BreadcrumbResolver.Resolve("a/b", NoParams(), overrides, SampleMeta(), PassthroughLocalizer.Instance);

        Assert.Equal(2, trail.Count);
        Assert.Equal("A", trail[0].Label);
        Assert.Equal("Trip to office", trail[1].Label);
        Assert.True(trail[1].IsCurrent);
    }

    [Fact]
    public void Resolve_is_cycle_safe()
    {
        // x -> y -> x in SampleMeta; the walk must terminate.
        IReadOnlyList<BreadcrumbItem> trail =
            BreadcrumbResolver.Resolve("x", NoParams(), NoOverrides(), SampleMeta(), PassthroughLocalizer.Instance);

        Assert.Equal(2, trail.Count);
        Assert.All(trail, item => Assert.False(string.IsNullOrEmpty(item.Label)));
    }

    [Fact]
    public void Resolve_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            BreadcrumbResolver.Resolve("a", null!, NoOverrides(), SampleMeta(), PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            BreadcrumbResolver.Resolve("a", NoParams(), null!, SampleMeta(), PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            BreadcrumbResolver.Resolve("a", NoParams(), NoOverrides(), null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            BreadcrumbResolver.Resolve("a", NoParams(), NoOverrides(), SampleMeta(), null!));
    }

    [Fact]
    public void BuildHref_substitutes_parameters_and_prefixes_the_root_slash()
    {
        Assert.Equal("/", BreadcrumbResolver.BuildHref(string.Empty, NoParams()));
        Assert.Equal("/vehicles", BreadcrumbResolver.BuildHref("vehicles", NoParams()));
        Assert.Equal("/vehicles/5", BreadcrumbResolver.BuildHref("vehicles/:id", Params(("id", "5"))));
    }

    // ── Projector (route path → trail), wired to the real app registry + metadata ────────────────────────

    [Fact]
    public void Projector_suppresses_the_trail_on_a_top_level_page()
    {
        var projector = new RouteBreadcrumbProjector();

        IReadOnlyList<BreadcrumbItem> trail = projector.Project("/", NoOverrides(), PassthroughLocalizer.Instance);

        BreadcrumbItem only = Assert.Single(trail);
        Assert.Equal("Dashboard", only.Label);
    }

    [Fact]
    public void Projector_resolves_a_nested_parameterised_route_against_the_real_registry()
    {
        var projector = new RouteBreadcrumbProjector();

        IReadOnlyList<BreadcrumbItem> trail =
            projector.Project("/vehicles/5/access", NoOverrides(), PassthroughLocalizer.Instance);

        Assert.Collection(
            trail,
            vehicles =>
            {
                Assert.Equal("Vehicles", vehicles.Label);
                Assert.Equal("/vehicles", vehicles.Href);
            },
            vehicle =>
            {
                Assert.Equal("Vehicle", vehicle.Label);
                Assert.Equal("/vehicles/5", vehicle.Href);
            },
            access =>
            {
                Assert.Equal("Vehicle Access", access.Label);
                Assert.True(access.IsCurrent);
                Assert.Null(access.Href);
            });
    }

    [Fact]
    public void Projector_resolves_a_route_that_parents_to_the_index()
    {
        var projector = new RouteBreadcrumbProjector();

        IReadOnlyList<BreadcrumbItem> trail =
            projector.Project("/me/activity", NoOverrides(), PassthroughLocalizer.Instance);

        Assert.Equal(2, trail.Count);
        Assert.Equal("Dashboard", trail[0].Label);
        Assert.Equal("/", trail[0].Href);
        Assert.Equal("My Activity", trail[1].Label);
        Assert.True(trail[1].IsCurrent);
    }

    [Fact]
    public void Projector_suppresses_an_unknown_route()
    {
        var projector = new RouteBreadcrumbProjector();

        IReadOnlyList<BreadcrumbItem> trail =
            projector.Project("/does/not/exist", NoOverrides(), PassthroughLocalizer.Instance);

        // Catch-all (NotFound) is a single item -> suppressed by the renderer.
        Assert.True(trail.Count <= 1);
    }

    [Fact]
    public void Projector_rejects_null_dependencies()
    {
        var projector = new RouteBreadcrumbProjector();

        Assert.Throws<ArgumentNullException>(() => projector.Project("/", null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => projector.Project("/", NoOverrides(), null!));
    }

    // ── State: suppressed (top-level) vs resolved (multi-crumb) ──────────────────────────────────────────

    [Fact]
    public void ViewModel_resolves_the_trail_and_reports_the_resolved_state()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b/:id", Parameters = Params(("id", "7")) };
        using var vm = NewViewModel(route);

        Assert.Equal(3, vm.Items.Count);
        Assert.False(vm.IsSuppressed);
        Assert.True(vm.HasCrumbs);
        Assert.Equal(BreadcrumbState.Resolved, vm.State);
    }

    [Fact]
    public void ViewModel_suppresses_a_top_level_route()
    {
        var route = new FakeRouteContext { MatchedPattern = "a" };
        using var vm = NewViewModel(route);

        Assert.Single(vm.Items);
        Assert.True(vm.IsSuppressed);
        Assert.False(vm.HasCrumbs);
        Assert.Equal(BreadcrumbState.Suppressed, vm.State);
    }

    [Fact]
    public void ViewModel_reresolves_on_a_route_change()
    {
        var route = new FakeRouteContext { MatchedPattern = "a" };
        using var vm = NewViewModel(route);
        var changed = new List<string>();
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is not null)
            {
                changed.Add(e.PropertyName);
            }
        };

        Assert.True(vm.IsSuppressed);

        route.MatchedPattern = "a/b/:id";
        route.Parameters = Params(("id", "9"));
        route.Raise();

        Assert.Equal(3, vm.Items.Count);
        Assert.Equal("Item 9", vm.Items[2].Label);
        Assert.Contains(nameof(LayoutBreadcrumbsViewModel.Items), changed);
    }

    [Fact]
    public void ViewModel_reresolves_on_an_override_change()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b" };
        var overrides = new StaticBreadcrumbOverrideSource();
        using var vm = NewViewModel(route, overrides);

        Assert.Equal("B", vm.Items[1].Label);

        overrides.Set(new Dictionary<string, string>(StringComparer.Ordinal) { ["a/b"] = "Renamed" });

        Assert.Equal("Renamed", vm.Items[1].Label);
    }

    // ── Accessibility: nav landmark + Home labels resolve through the keys; current crumb is non-interactive

    [Fact]
    public void ViewModel_exposes_the_localized_nav_and_home_labels()
    {
        var localizer = new RecordingLocalizer
        {
            Translations =
            {
                [NavKey] = "Brotkrumen",
                [HomeKey] = "Übersicht",
            },
        };
        var route = new FakeRouteContext { MatchedPattern = "a" };
        using var vm = new LayoutBreadcrumbsViewModel(
            route,
            new StaticBreadcrumbOverrideSource(),
            localizer,
            new FakeNavigator(),
            SampleMeta());

        Assert.Equal("Brotkrumen", vm.NavLabel);
        Assert.Equal("Übersicht", vm.HomeLabel);
        Assert.Contains(localizer.Calls, c => c.Key == NavKey);
        Assert.Contains(localizer.Calls, c => c.Key == HomeKey);
    }

    [Fact]
    public void The_current_crumb_is_non_interactive_and_ancestors_are_links()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b/:id", Parameters = Params(("id", "7")) };
        using var vm = NewViewModel(route);

        Assert.True(vm.Items[0].IsLink);
        Assert.True(vm.Items[1].IsLink);
        Assert.False(vm.Items[^1].IsLink);
        Assert.True(vm.Items[^1].IsCurrent);
    }

    // ── Activation: ancestor links navigate; the current crumb is a no-op; Home navigates ────────────────

    [Fact]
    public void Activate_navigates_an_ancestor_link_and_records_it()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b/:id", Parameters = Params(("id", "7")) };
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        using var vm = NewViewModel(route, navigator: navigator, sink: captured);

        bool navigated = vm.Activate(vm.Items[0]);

        Assert.True(navigated);
        Assert.Equal("/a", Assert.Single(navigator.Navigations));
        Assert.Contains("breadcrumb.navigated slug=LayoutBreadcrumbs", captured);
    }

    [Fact]
    public void Activate_is_a_no_op_for_the_current_crumb()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b/:id", Parameters = Params(("id", "7")) };
        var navigator = new FakeNavigator();
        using var vm = NewViewModel(route, navigator: navigator);

        bool navigated = vm.Activate(vm.Items[^1]);

        Assert.False(navigated);
        Assert.Empty(navigator.Navigations);
    }

    [Fact]
    public void NavigateHome_navigates_to_the_home_href_and_records_it()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b" };
        var navigator = new FakeNavigator();
        var captured = new List<string>();
        using var vm = NewViewModel(route, navigator: navigator, sink: captured);
        captured.Clear();

        vm.NavigateHome();

        Assert.Equal("/", Assert.Single(navigator.Navigations));
        Assert.Equal("breadcrumb.navigated slug=LayoutBreadcrumbs", Assert.Single(captured));
    }

    // ── Diagnostics (P1/S11): view.opened once + state outcomes; never the labels or hrefs ───────────────

    [Fact]
    public void MarkOpened_records_view_opened_once_with_the_initial_state()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b/:id", Parameters = Params(("id", "7")) };
        var captured = new List<string>();
        using var vm = NewViewModel(route, sink: captured);

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=LayoutBreadcrumbs", captured[0]);
        Assert.Equal("breadcrumb.resolved slug=LayoutBreadcrumbs", captured[1]);
        Assert.Equal(2, captured.Count);
    }

    [Fact]
    public void A_suppressed_trail_emits_the_suppressed_outcome()
    {
        var route = new FakeRouteContext { MatchedPattern = "a" };
        var captured = new List<string>();
        using var vm = NewViewModel(route, sink: captured);

        vm.MarkOpened();

        Assert.Equal("view.opened slug=LayoutBreadcrumbs", captured[0]);
        Assert.Equal("breadcrumb.suppressed slug=LayoutBreadcrumbs", captured[1]);
    }

    [Fact]
    public void Diagnostics_never_leak_the_labels_or_hrefs()
    {
        var route = new FakeRouteContext { MatchedPattern = "a/b/:id", Parameters = Params(("id", "7")) };
        var captured = new List<string>();
        using var vm = NewViewModel(route, sink: captured);

        vm.MarkOpened();
        vm.Activate(vm.Items[0]);
        route.MatchedPattern = "a/b";
        route.Raise();

        Assert.All(captured, line =>
        {
            Assert.DoesNotContain("Item 7", line, StringComparison.Ordinal);
            Assert.DoesNotContain("/a/b", line, StringComparison.Ordinal);
            Assert.DoesNotContain("/a", line, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new LayoutBreadcrumbsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordResolved();
        diagnostics.RecordSuppressed();
        diagnostics.RecordNavigated();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Resolved);
        Assert.Equal(1, diagnostics.Suppressed);
        Assert.Equal(1, diagnostics.Navigations);
        string[] expected =
        [
            "view.opened slug=LayoutBreadcrumbs",
            "breadcrumb.resolved slug=LayoutBreadcrumbs",
            "breadcrumb.suppressed slug=LayoutBreadcrumbs",
            "breadcrumb.navigated slug=LayoutBreadcrumbs",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new LayoutBreadcrumbsDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── Lifecycle + argument validation ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Dispose_stops_responding_to_route_changes()
    {
        var route = new FakeRouteContext { MatchedPattern = "a" };
        var vm = NewViewModel(route);

        vm.Dispose();
        route.MatchedPattern = "a/b/:id";
        route.Parameters = Params(("id", "7"));
        route.Raise();

        // After disposal the trail is frozen at its last value.
        Assert.Single(vm.Items);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var route = new FakeRouteContext { MatchedPattern = "a" };
        var overrides = new StaticBreadcrumbOverrideSource();

        Assert.Throws<ArgumentNullException>(() =>
            new LayoutBreadcrumbsViewModel(null!, overrides, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            new LayoutBreadcrumbsViewModel(route, null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() =>
            new LayoutBreadcrumbsViewModel(route, overrides, null!));
    }

    [Fact]
    public void NullBreadcrumbNavigator_is_a_safe_no_op_singleton()
    {
        Assert.Same(NullBreadcrumbNavigator.Instance, NullBreadcrumbNavigator.Instance);
        Exception? error = Record.Exception(() => NullBreadcrumbNavigator.Instance.Navigate("/anywhere"));
        Assert.Null(error);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static LayoutBreadcrumbsViewModel NewViewModel(
        FakeRouteContext route,
        StaticBreadcrumbOverrideSource? overrides = null,
        FakeNavigator? navigator = null,
        List<string>? sink = null)
    {
        var diagnostics = sink is null ? null : new LayoutBreadcrumbsDiagnostics(sink.Add);
        return new LayoutBreadcrumbsViewModel(
            route,
            overrides ?? new StaticBreadcrumbOverrideSource(),
            PassthroughLocalizer.Instance,
            navigator ?? new FakeNavigator(),
            SampleMeta(),
            diagnostics);
    }

    private sealed class FakeRouteContext : IBreadcrumbRouteContext
    {
        private IReadOnlyDictionary<string, string> _parameters = new Dictionary<string, string>(StringComparer.Ordinal);

        public string? MatchedPattern { get; set; }

        public IReadOnlyDictionary<string, string> Parameters
        {
            get => _parameters;
            set => _parameters = value;
        }

        public event EventHandler? Changed;

        public void Raise() => Changed?.Invoke(this, EventArgs.Empty);
    }

    private sealed class FakeNavigator : IBreadcrumbNavigator
    {
        private readonly List<string> _navigations = [];

        public IReadOnlyList<string> Navigations => _navigations;

        public void Navigate(string href) => _navigations.Add(href);
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
