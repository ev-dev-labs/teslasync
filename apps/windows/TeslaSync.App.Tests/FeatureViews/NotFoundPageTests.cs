using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>NotFoundPage</c> feature surface's UI-thread-free logic — the stable
/// registration metadata, the Levenshtein + closest-route suggestion engine (the native port of
/// web/src/lib/closestRoute.ts), the render-ready projection (the body's <c>{{path}}</c> substitution, the
/// localized + ranked suggestions, the accessible name), the view-model's one-shot 404 diagnostic and escape-hatch
/// dispatch, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/pages/NotFoundPage.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class NotFoundPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_constants_are_stable()
    {
        Assert.Equal("NotFoundPage", NotFoundRegistration.Slug);
        Assert.Equal("translation.notFound.title", NotFoundRegistration.TitleKey);
        Assert.Equal("Page not found", NotFoundRegistration.TitleFallback);
        Assert.Equal("translation.notFound.heading", NotFoundRegistration.HeadingKey);
        Assert.Equal("We couldn't find that page", NotFoundRegistration.HeadingFallback);
        Assert.Equal("translation.notFound.body", NotFoundRegistration.BodyKey);
        Assert.Equal("{0} doesn't match any route.", NotFoundRegistration.BodyFallback);
        Assert.Equal("translation.notFound.didYouMean", NotFoundRegistration.DidYouMeanKey);
        Assert.Equal("Did you mean:", NotFoundRegistration.DidYouMeanFallback);
        Assert.Equal("translation.notFound.goBack", NotFoundRegistration.GoBackKey);
        Assert.Equal("Go back", NotFoundRegistration.GoBackFallback);
        Assert.Equal("translation.notFound.goHome", NotFoundRegistration.GoHomeKey);
        Assert.Equal("Go to dashboard", NotFoundRegistration.GoHomeFallback);
        Assert.Equal("translation.notFound.openSearch", NotFoundRegistration.OpenSearchKey);
        Assert.Equal("Open command palette", NotFoundRegistration.OpenSearchFallback);
        Assert.Equal("Dashboard", NotFoundRegistration.DashboardRouteName);
        Assert.Equal(5, NotFoundRegistration.MaxSuggestions);
        Assert.Equal(6, NotFoundRegistration.MaxDistance);
        Assert.Equal("\uE81E", NotFoundRegistration.CompassGlyph);
    }

    // ── Normalize / DisplayPath / Levenshtein (the comparison primitives) ────────────────────────────────

    [Theory]
    [InlineData("/Vehicle-List_", "vehiclelist")]
    [InlineData("  Battery Health ", "batteryhealth")]
    [InlineData("/", "")]
    [InlineData(null, "")]
    public void Normalize_lowercases_and_strips_separators(string? input, string expected) =>
        Assert.Equal(expected, RouteSuggestionEngine.Normalize(input));

    [Theory]
    [InlineData("", "/")]
    [InlineData("vehicles", "/vehicles")]
    [InlineData("/vehicles/", "/vehicles")]
    public void DisplayPath_prefixes_a_single_slash(string pattern, string expected) =>
        Assert.Equal(expected, RouteSuggestionEngine.DisplayPath(pattern));

    [Theory]
    [InlineData("battery", "battery", 0)]
    [InlineData("vehiclees", "vehicles", 1)]
    [InlineData("kitten", "sitting", 3)]
    [InlineData("", "abc", 3)]
    [InlineData("abc", "", 3)]
    public void Levenshtein_matches_the_reference_distances(string a, string b, int expected)
    {
        Assert.Equal(expected, RouteSuggestionEngine.Levenshtein(a, b));
        Assert.Equal(expected, RouteSuggestionEngine.Levenshtein(b, a));
    }

    // ── Suggestion engine: ranking, threshold, limit, dedupe, exclusions ─────────────────────────────────

    [Fact]
    public void Closest_returns_empty_for_a_blank_query()
    {
        var routes = new[] { Route("Vehicles", "vehicles", "Vehicles") };

        Assert.Empty(RouteSuggestionEngine.Closest("   ", routes));
        Assert.Empty(RouteSuggestionEngine.Closest("///", routes));
    }

    [Fact]
    public void Closest_ranks_by_ascending_distance_and_drops_beyond_the_ceiling()
    {
        var routes = new[]
        {
            Route("Exact", "alpha", "Exact"),
            Route("One", "alphx", "One"),
            Route("Two", "alpyy", "Two"),
            Route("Far", "zzzzzzzzzz", "Zzzzzzzzzz"),
        };

        var ranked = RouteSuggestionEngine.Closest("alpha", routes);

        Assert.Equal(new[] { "Exact", "One", "Two" }, ranked.Select(r => r.RouteName).ToArray());
        Assert.Equal(0, ranked[0].Distance);
        Assert.Equal(1, ranked[1].Distance);
        Assert.Equal(2, ranked[2].Distance);
        Assert.DoesNotContain(ranked, r => r.RouteName == "Far");
    }

    [Fact]
    public void Closest_caps_results_at_the_requested_limit_keeping_the_nearest()
    {
        // Seven candidates at distances 0..6 (all within the ceiling); labels are far so path distance wins.
        var routes = new[]
        {
            Route("R0", "abcdef", "Zzzzzzzz"),
            Route("R1", "abcdeg", "Zzzzzzzz"),
            Route("R2", "abcdgg", "Zzzzzzzz"),
            Route("R3", "abcggg", "Zzzzzzzz"),
            Route("R4", "abgggg", "Zzzzzzzz"),
            Route("R5", "aggggg", "Zzzzzzzz"),
            Route("R6", "gggggg", "Zzzzzzzz"),
        };

        var ranked = RouteSuggestionEngine.Closest("abcdef", routes);

        Assert.Equal(5, ranked.Count);
        Assert.Equal(new[] { "R0", "R1", "R2", "R3", "R4" }, ranked.Select(r => r.RouteName).ToArray());
    }

    [Fact]
    public void Closest_breaks_distance_ties_by_ordinal_path()
    {
        var routes = new[]
        {
            Route("Beta", "abcdeh", "Beta"),
            Route("Alpha", "abcdeg", "Alpha"),
        };

        var ranked = RouteSuggestionEngine.Closest("abcdef", routes);

        // Both at distance 1; "/abcdeg" sorts before "/abcdeh".
        Assert.Equal(new[] { "/abcdeg", "/abcdeh" }, ranked.Select(r => r.Path).ToArray());
    }

    [Fact]
    public void Closest_excludes_parameterized_redirect_and_catch_all_routes()
    {
        var routes = new[]
        {
            Route("Vehicles", "vehicles", "Vehicles"),
            new RouteDefinition { Name = "VehicleDetail", PathPattern = "vehicles/:id", DefaultTitle = "Vehicle" },
            new RouteDefinition { Name = "redirect:vehicle", PathPattern = "vehicle", RedirectTo = "vehicles" },
            new RouteDefinition { Name = "NotFound", PathPattern = "*", DefaultTitle = "Not Found", IsCatchAll = true },
        };

        var ranked = RouteSuggestionEngine.Closest("vehicles", routes);

        var single = Assert.Single(ranked);
        Assert.Equal("Vehicles", single.RouteName);
    }

    [Fact]
    public void Closest_lists_each_route_name_once_keeping_the_first_declared_path()
    {
        var routes = new[]
        {
            Route("BatteryHealth", "battery", "Battery Health"),
            Route("BatteryHealth", "battery/health", "Battery Health"),
        };

        var ranked = RouteSuggestionEngine.Closest("battery", routes);

        var single = Assert.Single(ranked);
        Assert.Equal("/battery", single.Path);
    }

    [Fact]
    public void Closest_finds_the_real_route_in_the_full_table()
    {
        // Integration with the live route table: a typo'd /vehicles resolves to Vehicles at distance 1.
        var ranked = RouteSuggestionEngine.Closest("vehiclees", RouteTable.All);

        Assert.NotEmpty(ranked);
        Assert.Equal("Vehicles", ranked[0].RouteName);
        Assert.Equal("/vehicles", ranked[0].Path);
        Assert.True(ranked.Count <= NotFoundRegistration.MaxSuggestions);
    }

    [Fact]
    public void Closest_rejects_a_null_route_list() =>
        Assert.Throws<ArgumentNullException>(() => RouteSuggestionEngine.Closest("x", null!));

    // ── Projection: copy, body substitution, localized suggestions, accessible name ──────────────────────

    [Fact]
    public void Project_resolves_every_visible_literal_and_fills_the_body_path()
    {
        var display = NotFoundProjection.Project("missing-page", RouteTable.All, Localizer);

        Assert.Equal("Page not found", display.PageTitle);
        Assert.Equal("We couldn't find that page", display.Heading);
        Assert.Equal("/missing-page doesn't match any route.", display.Body);
        Assert.Equal("Did you mean:", display.DidYouMeanLabel);
        Assert.Equal("Go back", display.GoBackLabel);
        Assert.Equal("Go to dashboard", display.GoHomeLabel);
        Assert.Equal("Open command palette", display.OpenSearchLabel);
        Assert.Equal("/missing-page", display.UnmatchedPath);
    }

    [Fact]
    public void Project_composes_the_accessible_name_from_heading_and_body()
    {
        var display = NotFoundProjection.Project("foo", RouteTable.All, Localizer);

        Assert.Equal("We couldn't find that page. /foo doesn't match any route.", display.AutomationName);
    }

    [Fact]
    public void Project_surfaces_localized_ranked_suggestions()
    {
        var display = NotFoundProjection.Project("vehiclees", RouteTable.All, Localizer);

        Assert.True(display.HasSuggestions);
        Assert.NotEmpty(display.Suggestions);
        var first = display.Suggestions[0];
        Assert.Equal("Vehicles", first.Label);
        Assert.Equal("/vehicles", first.Path);
        Assert.Equal("Vehicles /vehicles", first.AutomationName);
    }

    [Fact]
    public void Project_reports_no_suggestions_when_nothing_is_close()
    {
        var routes = new[] { Route("Vehicles", "vehicles", "Vehicles") };

        var display = NotFoundProjection.Project("zzzzzzzzzzzzzzz", routes, Localizer);

        Assert.False(display.HasSuggestions);
        Assert.Empty(display.Suggestions);
    }

    [Fact]
    public void Project_flows_every_string_through_the_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        NotFoundProjection.Project("foo", RouteTable.All, localizer);

        Assert.Contains(NotFoundRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(NotFoundRegistration.HeadingKey, localizer.RequestedKeys);
        Assert.Contains(NotFoundRegistration.BodyKey, localizer.RequestedKeys);
        Assert.Contains(NotFoundRegistration.DidYouMeanKey, localizer.RequestedKeys);
        Assert.Contains(NotFoundRegistration.GoBackKey, localizer.RequestedKeys);
        Assert.Contains(NotFoundRegistration.GoHomeKey, localizer.RequestedKeys);
        Assert.Contains(NotFoundRegistration.OpenSearchKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Project_rejects_null_required_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => NotFoundProjection.Project("x", null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => NotFoundProjection.Project("x", RouteTable.All, null!));
    }

    // ── ViewModel: projects the display, marks shown once, dispatches the escape hatches ─────────────────

    [Fact]
    public void ViewModel_projects_the_display_and_trims_the_unmatched_path()
    {
        var vm = new NotFoundPageViewModel(new RecordingNavigator(), Localizer, "  bad-route  ");

        Assert.Equal("bad-route", vm.UnmatchedPath);
        Assert.Equal("/bad-route doesn't match any route.", vm.Display.Body);
        Assert.False(vm.HasShown);
    }

    [Fact]
    public void MarkShown_emits_the_404_diagnostic_once_with_the_path()
    {
        var captured = new List<string>();
        var vm = new NotFoundPageViewModel(
            new RecordingNavigator(),
            Localizer,
            "bad-route",
            diagnostics: new NotFoundDiagnostics(captured.Add));

        vm.MarkShown();
        vm.MarkShown();
        vm.MarkShown();

        Assert.True(vm.HasShown);
        Assert.Equal("notfound.shown slug=NotFoundPage path=/bad-route", Assert.Single(captured));
    }

    [Fact]
    public void GoBack_dispatches_to_the_navigator_and_records_the_target()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new NotFoundPageViewModel(navigator, Localizer, "x", diagnostics: new NotFoundDiagnostics(captured.Add));

        vm.GoBack();

        Assert.Equal(1, navigator.BackCount);
        Assert.Equal("notfound.navigate slug=NotFoundPage target=back", Assert.Single(captured));
    }

    [Fact]
    public void GoToDashboard_dispatches_to_the_navigator_and_records_the_target()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new NotFoundPageViewModel(navigator, Localizer, "x", diagnostics: new NotFoundDiagnostics(captured.Add));

        vm.GoToDashboard();

        Assert.Equal(1, navigator.DashboardCount);
        Assert.Equal("notfound.navigate slug=NotFoundPage target=dashboard", Assert.Single(captured));
    }

    [Fact]
    public void OpenCommandPalette_dispatches_to_the_navigator_and_records_the_target()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new NotFoundPageViewModel(navigator, Localizer, "x", diagnostics: new NotFoundDiagnostics(captured.Add));

        vm.OpenCommandPalette();

        Assert.Equal(1, navigator.PaletteCount);
        Assert.Equal("notfound.navigate slug=NotFoundPage target=command-palette", Assert.Single(captured));
    }

    [Fact]
    public void NavigateToSuggestion_dispatches_the_path_and_records_it()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new NotFoundPageViewModel(navigator, Localizer, "x", diagnostics: new NotFoundDiagnostics(captured.Add));

        vm.NavigateToSuggestion("/vehicles");

        Assert.Equal("/vehicles", Assert.Single(navigator.Paths));
        Assert.Equal("notfound.navigate slug=NotFoundPage target=/vehicles", Assert.Single(captured));
    }

    [Fact]
    public void NavigateToSuggestion_rejects_a_missing_path()
    {
        var vm = new NotFoundPageViewModel(new RecordingNavigator(), Localizer, "x");

        Assert.Throws<ArgumentNullException>(() => vm.NavigateToSuggestion(null!));
        Assert.Throws<ArgumentException>(() => vm.NavigateToSuggestion(string.Empty));
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new NotFoundPageViewModel(null!, Localizer, "x"));
        Assert.Throws<ArgumentNullException>(() => new NotFoundPageViewModel(new RecordingNavigator(), null!, "x"));
    }

    // ── Diagnostics (P1/S11): counts, line format, inert without a sink ───────────────────────────────────

    [Fact]
    public void Diagnostics_records_shown_with_slug_and_path()
    {
        var captured = new List<string>();
        var diagnostics = new NotFoundDiagnostics(captured.Add);

        diagnostics.RecordShown("/oops");

        Assert.Equal(1, diagnostics.ViewsShown);
        Assert.Equal("notfound.shown slug=NotFoundPage path=/oops", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_navigation_with_slug_and_target()
    {
        var captured = new List<string>();
        var diagnostics = new NotFoundDiagnostics(captured.Add);

        diagnostics.RecordNavigation("dashboard");

        Assert.Equal(1, diagnostics.Navigations);
        Assert.Equal("notfound.navigate slug=NotFoundPage target=dashboard", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_are_inert_without_a_sink()
    {
        var diagnostics = new NotFoundDiagnostics();

        diagnostics.RecordShown("/x");
        diagnostics.RecordNavigation("back");

        Assert.Equal(1, diagnostics.ViewsShown);
        Assert.Equal(1, diagnostics.Navigations);
    }

    // ── Test doubles ─────────────────────────────────────────────────────────────────────────────────────

    private static RouteDefinition Route(string name, string path, string title) =>
        new() { Name = name, PathPattern = path, DefaultTitle = title, TitleKey = $"route.{name}" };

    private sealed class RecordingNavigator : INotFoundNavigator
    {
        public int BackCount { get; private set; }

        public int DashboardCount { get; private set; }

        public int PaletteCount { get; private set; }

        public List<string> Paths { get; } = [];

        public void GoBack() => BackCount++;

        public void GoToDashboard() => DashboardCount++;

        public void OpenCommandPalette() => PaletteCount++;

        public void NavigateTo(string path) => Paths.Add(path);
    }

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }
}
