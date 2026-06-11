using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.MiscSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.MiscSurfaces;

/// <summary>
/// Headless verification of the <c>TourLauncher</c> misc surface's UI-thread-free logic — the static tour
/// catalogue, the route-recommendation matcher, the render-ready projection (per state: populated rows with
/// completed / recommended variants, and the defensive empty surface), the open/close/start/reset view-model
/// commands, the composed Narrator names and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/onboarding/TourLauncher.tsx + web/src/lib/tourRegistry.ts). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class TourLauncherTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TourLauncherEntry Entry(string id) =>
        TourLauncherCatalog.DefaultTours.Single(t => t.Id == id);

    // ── Catalogue (adapter): the eight tours in web TOUR_ORDER ───────────────────────────────────────────

    [Fact]
    public void Catalog_lists_the_eight_tours_in_launcher_order()
    {
        string[] expected = ["main", "vehicles", "drives", "charging", "alerts", "automations", "settings", "debugger"];

        string[] actual = [.. TourLauncherCatalog.DefaultTours.Select(t => t.Id)];

        Assert.Equal(expected, actual);
        Assert.Equal(8, TourLauncherCatalog.TourCount);
        Assert.Equal(TourLauncherCatalog.TourCount, TourLauncherCatalog.DefaultTours.Count);
    }

    [Fact]
    public void Catalog_main_tour_is_version_two_the_rest_version_one()
    {
        Assert.Equal(2, Entry("main").Version);
        foreach (TourLauncherEntry entry in TourLauncherCatalog.DefaultTours.Where(t => t.Id != "main"))
        {
            Assert.Equal(1, entry.Version);
        }
    }

    [Fact]
    public void Catalog_entries_carry_distinct_title_and_description_keys()
    {
        var keys = TourLauncherCatalog.DefaultTours
            .SelectMany(t => new[] { t.TitleKey, t.DescriptionKey })
            .ToList();

        Assert.Equal(keys.Count, keys.Distinct(StringComparer.Ordinal).Count());
        Assert.All(TourLauncherCatalog.DefaultTours, t => Assert.StartsWith("tour.tours.", t.TitleKey, StringComparison.Ordinal));
    }

    // ── Route matcher: web isRecommendedForRoute (string root, prefix, and RegExp branches) ───────────────

    [Theory]
    [InlineData("/", true)]
    [InlineData("/vehicles", false)]
    [InlineData("/dashboard", false)]
    [InlineData("", false)]
    public void Route_main_matches_only_the_root(string path, bool expected) =>
        Assert.Equal(expected, TourLauncherProjection.IsRecommendedForRoute(Entry("main"), path));

    [Theory]
    [InlineData("/vehicles", true)]
    [InlineData("/vehicles/3", true)]
    [InlineData("/drives", false)]
    [InlineData("/", false)]
    public void Route_vehicles_matches_the_vehicles_subtree(string path, bool expected) =>
        Assert.Equal(expected, TourLauncherProjection.IsRecommendedForRoute(Entry("vehicles"), path));

    [Theory]
    [InlineData("/charging", true)]
    [InlineData("/cost-analysis", true)]
    [InlineData("/charging-curve/42", true)]
    [InlineData("/smart-charge", true)]
    [InlineData("/vehicles", false)]
    public void Route_charging_matches_any_charging_alias(string path, bool expected) =>
        Assert.Equal(expected, TourLauncherProjection.IsRecommendedForRoute(Entry("charging"), path));

    [Theory]
    [InlineData("/notifications/alerts", true)]
    [InlineData("/notifications/studio", true)]
    [InlineData("/notifications/inbox", false)]
    [InlineData("/notifications", false)]
    public void Route_alerts_matches_only_alerts_and_studio(string path, bool expected) =>
        Assert.Equal(expected, TourLauncherProjection.IsRecommendedForRoute(Entry("alerts"), path));

    [Theory]
    [InlineData("/state-debugger", true)]
    [InlineData("/signal-log", true)]
    [InlineData("/redis-signals", true)]
    [InlineData("/drives", false)]
    public void Route_debugger_matches_any_debugger_alias(string path, bool expected) =>
        Assert.Equal(expected, TourLauncherProjection.IsRecommendedForRoute(Entry("debugger"), path));

    [Fact]
    public void Route_matching_tolerates_a_null_path() =>
        Assert.False(TourLauncherProjection.IsRecommendedForRoute(Entry("main"), null));

    // ── Projection: Ready state (the populated modal body) ───────────────────────────────────────────────

    [Fact]
    public void Project_ready_lists_every_tour_with_no_completion_and_root_recommendation()
    {
        TourLauncherDisplay display = Project(new FakeCompletion(), "/");

        Assert.Equal(TourLauncherState.Ready, display.State);
        Assert.True(display.HasTours);
        Assert.Equal(8, display.Rows.Count);
        Assert.Equal("Take a tour", display.Title);
        Assert.Equal("Guided walkthroughs for every major feature.", display.Subtitle);

        // Only the main tour is recommended on the root, and nothing is completed.
        Assert.Equal(1, display.RecommendedCount);
        Assert.Equal(0, display.CompletedCount);

        TourRowView main = display.Rows.Single(r => r.Id == "main");
        Assert.True(main.IsRecommended);
        Assert.Equal("Recommended for this page", main.RecommendedBadge);

        Assert.All(display.Rows, r =>
        {
            Assert.False(r.IsCompleted);
            Assert.Null(r.CompletedBadge);
            Assert.Equal("Start", r.ActionLabel);
            Assert.Equal(TourLauncherRegistration.AvailableGlyph, r.StatusGlyph);
        });
    }

    [Fact]
    public void Project_marks_completed_tours_with_replay_and_a_check()
    {
        TourLauncherDisplay display = Project(new FakeCompletion("vehicles", "drives"), "/");

        Assert.Equal(2, display.CompletedCount);

        TourRowView vehicles = display.Rows.Single(r => r.Id == "vehicles");
        Assert.True(vehicles.IsCompleted);
        Assert.Equal("Replay", vehicles.ActionLabel);
        Assert.Equal("Completed", vehicles.CompletedBadge);
        Assert.Equal(TourLauncherRegistration.CompletedGlyph, vehicles.StatusGlyph);

        TourRowView main = display.Rows.Single(r => r.Id == "main");
        Assert.False(main.IsCompleted);
        Assert.Equal("Start", main.ActionLabel);
    }

    [Fact]
    public void Project_highlights_the_route_recommended_tour()
    {
        TourLauncherDisplay display = Project(new FakeCompletion(), "/charging/session/42");

        TourRowView charging = display.Rows.Single(r => r.Id == "charging");
        Assert.True(charging.IsRecommended);
        Assert.Equal("Recommended for this page", charging.RecommendedBadge);

        // The main tour is not recommended away from the root.
        Assert.False(display.Rows.Single(r => r.Id == "main").IsRecommended);
        Assert.Equal(1, display.RecommendedCount);
    }

    // ── Projection: Empty state (defensive — no tours in the registry, never a blank box) ─────────────────

    [Fact]
    public void Project_with_no_tours_yields_a_friendly_empty_surface()
    {
        TourLauncherDisplay display = TourLauncherProjection.Project(
            Array.Empty<TourLauncherEntry>(), new FakeCompletion(), "/", Localizer);

        Assert.Equal(TourLauncherState.Empty, display.State);
        Assert.False(display.HasTours);
        Assert.Empty(display.Rows);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Accessibility: composed Narrator names on rows and actions ───────────────────────────────────────

    [Fact]
    public void Project_composes_start_and_replay_narrator_names_from_the_title()
    {
        TourLauncherDisplay display = Project(new FakeCompletion("main"), "/");

        TourRowView main = display.Rows.Single(r => r.Id == "main");
        Assert.Equal("Replay TeslaSync overview tour", main.ActionAutomationName);

        TourRowView vehicles = display.Rows.Single(r => r.Id == "vehicles");
        Assert.Equal("Start Vehicles & access tour", vehicles.ActionAutomationName);
    }

    [Fact]
    public void Project_row_narrator_name_includes_title_badges_and_description()
    {
        TourLauncherDisplay display = Project(new FakeCompletion("main"), "/");

        TourRowView main = display.Rows.Single(r => r.Id == "main");
        Assert.Contains("TeslaSync overview", main.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Recommended for this page", main.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Completed", main.AutomationName, StringComparison.Ordinal);
        Assert.Contains(main.Description, main.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_every_row_has_a_non_empty_action_name()
    {
        TourLauncherDisplay display = Project(new FakeCompletion(), "/vehicles");

        Assert.All(display.Rows, r =>
        {
            Assert.False(string.IsNullOrWhiteSpace(r.ActionAutomationName));
            Assert.False(string.IsNullOrWhiteSpace(r.AutomationName));
        });
    }

    // ── i18n: every visible string flows through a registration / catalogue key ──────────────────────────

    [Fact]
    public void Project_copy_flows_through_the_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        TourLauncherProjection.Project(TourLauncherCatalog.DefaultTours, new FakeCompletion("main"), "/", localizer);

        Assert.Contains(TourLauncherRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.SubtitleKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.ResetAllKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.CloseKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.StartKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.ReplayKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.RecommendedKey, localizer.RequestedKeys);
        Assert.Contains(TourLauncherRegistration.CompletedKey, localizer.RequestedKeys);
        Assert.Contains("tour.tours.main.title", localizer.RequestedKeys);
        Assert.Contains("tour.tours.main.description", localizer.RequestedKeys);
    }

    // ── ViewModel: open / close / start / reset commands ─────────────────────────────────────────────────

    [Fact]
    public void Open_marks_the_list_seen_opens_and_records_the_view()
    {
        var completion = new FakeCompletion();
        var captured = new List<string>();
        var vm = NewViewModel(completion, "/", captured);

        Assert.False(vm.IsOpen);
        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.Equal(1, completion.SeenCount);
        Assert.Equal("view.opened slug=TourLauncher", Assert.Single(captured));
    }

    [Fact]
    public void Close_lowers_open_and_raises_the_close_request()
    {
        var vm = NewViewModel(new FakeCompletion(), "/");
        vm.Open();

        bool closed = false;
        vm.CloseRequested += (_, _) => closed = true;
        vm.Close();

        Assert.False(vm.IsOpen);
        Assert.True(closed);
    }

    [Fact]
    public void StartTour_closes_records_and_raises_the_start_request_with_the_id()
    {
        var captured = new List<string>();
        var vm = NewViewModel(new FakeCompletion(), "/", captured);
        vm.Open();
        captured.Clear();

        string? started = null;
        vm.TourStartRequested += (_, e) => started = e.TourId;
        vm.StartTour("charging");

        Assert.False(vm.IsOpen);
        Assert.Equal("charging", started);
        Assert.Equal("tour.started slug=TourLauncher", Assert.Single(captured));
    }

    [Fact]
    public void ResetAll_clears_completion_reprojects_and_stays_open()
    {
        var completion = new FakeCompletion("main", "vehicles");
        var captured = new List<string>();
        var vm = NewViewModel(completion, "/", captured);
        vm.Open();
        captured.Clear();

        Assert.Equal(2, vm.Display.CompletedCount);

        vm.ResetAll();

        Assert.Equal(1, completion.ResetCount);
        Assert.Equal(0, vm.Display.CompletedCount);
        Assert.True(vm.IsOpen);
        Assert.Equal("tour.reset slug=TourLauncher", Assert.Single(captured));
    }

    [Fact]
    public void Reload_reprojects_against_the_current_route()
    {
        var location = new MutableLocation("/");
        var vm = new TourLauncherViewModel(Localizer, new FakeCompletion(), location);

        Assert.True(vm.Display.Rows.Single(r => r.Id == "main").IsRecommended);

        location.Path = "/settings/general";
        vm.Reload();

        Assert.False(vm.Display.Rows.Single(r => r.Id == "main").IsRecommended);
        Assert.True(vm.Display.Rows.Single(r => r.Id == "settings").IsRecommended);
    }

    // ── Diagnostics (P1/S11): slug-only counters, never a tour id ─────────────────────────────────────────

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new TourLauncherDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordTourStarted();
        diagnostics.RecordToursReset();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.ToursStarted);
        Assert.Equal(1, diagnostics.ToursReset);
        string[] expected =
        [
            "view.opened slug=TourLauncher",
            "tour.started slug=TourLauncher",
            "tour.reset slug=TourLauncher",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void StartTour_never_leaks_the_tour_id_to_diagnostics()
    {
        var captured = new List<string>();
        var vm = NewViewModel(new FakeCompletion(), "/", captured);
        vm.StartTour("debugger");

        string line = Assert.Single(captured, l => l.StartsWith("tour.started", StringComparison.Ordinal));
        Assert.DoesNotContain("debugger", line, StringComparison.Ordinal);
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() => Assert.Equal("TourLauncher", TourLauncherRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            TourLauncherProjection.Project(null!, new FakeCompletion(), "/", Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            TourLauncherProjection.Project(TourLauncherCatalog.DefaultTours, null!, "/", Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            TourLauncherProjection.Project(TourLauncherCatalog.DefaultTours, new FakeCompletion(), "/", null!));
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new TourLauncherViewModel(null!, new FakeCompletion(), new MutableLocation("/")));
        Assert.Throws<ArgumentNullException>(() =>
            new TourLauncherViewModel(Localizer, null!, new MutableLocation("/")));
        Assert.Throws<ArgumentNullException>(() =>
            new TourLauncherViewModel(Localizer, new FakeCompletion(), null!));
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static TourLauncherDisplay Project(ITourCompletionStore completion, string path) =>
        TourLauncherProjection.Project(TourLauncherCatalog.DefaultTours, completion, path, Localizer);

    private static TourLauncherViewModel NewViewModel(
        ITourCompletionStore completion,
        string path,
        List<string>? sink = null) =>
        new(
            Localizer,
            completion,
            new MutableLocation(path),
            diagnostics: sink is null ? null : new TourLauncherDiagnostics(sink.Add));

    private sealed class FakeCompletion : ITourCompletionStore
    {
        private readonly HashSet<string> _completed;

        public FakeCompletion(params string[] completed) =>
            _completed = new HashSet<string>(completed, StringComparer.Ordinal);

        public int ResetCount { get; private set; }

        public int SeenCount { get; private set; }

        public bool IsCompleted(string tourId, int version) => _completed.Contains(tourId);

        public void ResetAll()
        {
            ResetCount++;
            _completed.Clear();
        }

        public void MarkListSeen() => SeenCount++;
    }

    private sealed class MutableLocation(string path) : ITourLauncherLocation
    {
        public string Path { get; set; } = path;
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
