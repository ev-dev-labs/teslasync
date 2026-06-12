using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Review;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>YearReviewPage</c> story player's Microsoft.UI-free logic — the report +
/// vehicle parsers (incl. the platform <c>{data:…}</c> envelope), the projection's data-state precedence
/// (loading → empty → success, plus the native error branch), the nine ported year-review strings (key names +
/// English defaults matching web/src/features/analytics/pages/YearReviewPage.tsx), the vehicle-selector +
/// slide-counter chrome, the canonical slide deck order (web <c>SLIDE_DEFS</c>), the registration metadata, the
/// diagnostics, and the view-model's load / select / navigate transitions. The WinUI view + slide-content
/// factory are exercised by the app build; their per-region visibility is driven entirely by the
/// <see cref="YearReviewPageDisplay"/> flags asserted here.
/// </summary>
public sealed class YearReviewPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private const int Year = 2025;

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static YearReviewReport ActiveReport(int year = Year, long drives = 120, long charges = 30) =>
        new(true, year, drives, charges, default);

    private static YearReviewPageModel Model(
        YearReviewReport? report = null,
        bool hasReport = false,
        bool hasError = false,
        IReadOnlyList<YearReviewVehicleOption>? vehicles = null,
        long? selected = null,
        int slideIndex = 0) => new(
        Year: Year,
        Vehicles: vehicles ?? Array.Empty<YearReviewVehicleOption>(),
        SelectedVehicleId: selected,
        Report: report ?? YearReviewReport.Empty,
        HasReport: hasReport,
        Loading: !hasReport && !hasError,
        HasError: hasError,
        ErrorDetail: hasError ? "boom" : null,
        SlideCount: YearReviewSlideDeck.Count,
        SlideIndex: slideIndex);

    // ── Report parse adapter ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Report_parses_snake_case_fields_and_activity()
    {
        var report = YearReviewReport.FromJson(Json(
            """{ "year": 2025, "total_drives": 120, "total_charge_sessions": 30 }"""));

        Assert.True(report.HasReview);
        Assert.Equal(2025, report.Year);
        Assert.Equal(120, report.TotalDrives);
        Assert.Equal(30, report.TotalChargeSessions);
        Assert.False(report.HasNoActivity);
    }

    [Fact]
    public void Report_unwraps_the_platform_data_envelope()
    {
        var report = YearReviewReport.FromJson(Json(
            """{ "data": { "year": 2024, "total_drives": 5, "total_charge_sessions": 0 } }"""));

        Assert.True(report.HasReview);
        Assert.Equal(2024, report.Year);
        Assert.Equal(5, report.TotalDrives);
    }

    [Fact]
    public void Report_no_activity_when_no_drives_and_no_charges()
    {
        var report = YearReviewReport.FromJson(Json("""{ "year": 2025, "total_drives": 0, "total_charge_sessions": 0 }"""));

        Assert.True(report.HasReview);
        Assert.True(report.HasNoActivity);
    }

    [Fact]
    public void Report_non_object_is_empty()
    {
        Assert.Same(YearReviewReport.Empty, YearReviewReport.FromJson(Json("[]")));
        Assert.False(YearReviewReport.FromJson(Json("\"nope\"")).HasReview);
    }

    [Fact]
    public void Vehicle_option_parses_id_and_name()
    {
        var option = YearReviewVehicleOption.FromJson(Json("""{ "id": 7, "display_name": "Model Y" }"""));

        Assert.Equal(7, option.Id);
        Assert.Equal("Model Y", option.DisplayName);
    }

    // ── Data-state precedence (3 declared states + the native error branch) ─────────────────────────────────

    [Fact]
    public void State_loading_when_no_report_yet()
    {
        var display = YearReviewPageProjection.Project(Model(), Localizer);

        Assert.Equal(YearReviewPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSuccess);
    }

    [Fact]
    public void State_empty_when_review_has_no_activity()
    {
        var display = YearReviewPageProjection.Project(
            Model(report: ActiveReport(drives: 0, charges: 0), hasReport: true),
            Localizer);

        Assert.Equal(YearReviewPageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowSuccess);
    }

    [Fact]
    public void State_success_when_review_has_activity()
    {
        var display = YearReviewPageProjection.Project(
            Model(report: ActiveReport(), hasReport: true),
            Localizer);

        Assert.Equal(YearReviewPageState.Success, display.State);
        Assert.True(display.ShowSuccess);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void State_error_takes_precedence_over_loading()
    {
        var display = YearReviewPageProjection.Project(Model(hasError: true), Localizer);

        Assert.Equal(YearReviewPageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowLoading);
        Assert.Contains("Failed to load data", display.ErrorText, StringComparison.Ordinal);
    }

    // ── The nine ported year-review strings (key names + English defaults) ──────────────────────────────────

    [Fact]
    public void I18n_key_names_match_the_web_source_under_the_translation_namespace()
    {
        Assert.Equal("translation.yearReview.loading", YearReviewPageProjection.LoadingKey);
        Assert.Equal("translation.yearReview.noData", YearReviewPageProjection.NoDataKey);
        Assert.Equal("translation.yearReview.noDataHint", YearReviewPageProjection.NoDataHintKey);
        Assert.Equal("translation.yearReview.goBack", YearReviewPageProjection.GoBackKey);
        Assert.Equal("translation.yearReview.selectVehicle", YearReviewPageProjection.SelectVehicleKey);
        Assert.Equal("translation.yearReview.prev", YearReviewPageProjection.PrevKey);
        Assert.Equal("translation.yearReview.next", YearReviewPageProjection.NextKey);
        Assert.Equal("translation.yearReview.close", YearReviewPageProjection.CloseKey);
        Assert.Equal("translation.yearReview.pageTitle", YearReviewPageProjection.PageTitleKey);
    }

    [Fact]
    public void All_nine_strings_resolve_into_the_display()
    {
        var display = YearReviewPageProjection.Project(Model(report: ActiveReport(), hasReport: true), Localizer);

        Assert.Equal("Building your year in review...", display.LoadingText);
        Assert.Equal("Start driving and charging to build your annual review!", display.NoDataHintText);
        Assert.Equal("Go Back", display.GoBackText);
        Assert.Equal("Select vehicle", display.SelectVehicleText);
        Assert.Equal("Previous slide", display.PrevText);
        Assert.Equal("Next slide", display.NextText);
        Assert.Equal("Close", display.CloseText);
        Assert.Equal("2025 Year in Review", display.PageTitle);   // pageTitle formats the route year
        Assert.Equal("No driving data for 2025", display.NoDataText); // noData formats the route year
    }

    // ── Vehicle selector + slide-counter chrome ─────────────────────────────────────────────────────────────

    [Fact]
    public void Vehicle_selector_hidden_for_a_single_vehicle()
    {
        var display = YearReviewPageProjection.Project(
            Model(report: ActiveReport(), hasReport: true, vehicles: new[] { new YearReviewVehicleOption(1, "A") }, selected: 1),
            Localizer);

        Assert.False(display.ShowVehicleSelector);
        Assert.Single(display.VehicleChoices);
    }

    [Fact]
    public void Vehicle_selector_shown_and_marks_selection_for_multiple_vehicles()
    {
        var display = YearReviewPageProjection.Project(
            Model(
                report: ActiveReport(),
                hasReport: true,
                vehicles: new[] { new YearReviewVehicleOption(1, "A"), new YearReviewVehicleOption(2, "B") },
                selected: 2),
            Localizer);

        Assert.True(display.ShowVehicleSelector);
        Assert.Equal(2, display.VehicleChoices.Count);
        Assert.False(display.VehicleChoices[0].IsSelected);
        Assert.True(display.VehicleChoices[1].IsSelected);
    }

    [Fact]
    public void Slide_counter_and_arrows_track_the_index()
    {
        var first = YearReviewPageProjection.Project(Model(report: ActiveReport(), hasReport: true, slideIndex: 0), Localizer);
        Assert.Equal($"1 / {YearReviewSlideDeck.Count}", first.SlideCounterText);
        Assert.False(first.ShowPrev);
        Assert.True(first.ShowNext);

        int last = YearReviewSlideDeck.Count - 1;
        var end = YearReviewPageProjection.Project(Model(report: ActiveReport(), hasReport: true, slideIndex: last), Localizer);
        Assert.Equal($"{YearReviewSlideDeck.Count} / {YearReviewSlideDeck.Count}", end.SlideCounterText);
        Assert.True(end.ShowPrev);
        Assert.False(end.ShowNext);
    }

    // ── Canonical slide deck (web SLIDE_DEFS order) ─────────────────────────────────────────────────────────

    [Fact]
    public void Slide_deck_matches_the_web_slide_defs_order()
    {
        Assert.Equal(12, YearReviewSlideDeck.Count);

        var types = YearReviewSlideDeck.Slides.Select(s => s.Type).ToArray();
        Assert.Equal(
            new[]
            {
                "title", "stat-hero", "stat-chart", "drive-highlight", "stat-hero", "charging-breakdown",
                "savings", "environment", "patterns", "drive-highlight", "comparisons", "summary",
            },
            types);

        Assert.Equal("distance", YearReviewSlideDeck.Slides[1].Field);
        Assert.Equal("energy", YearReviewSlideDeck.Slides[4].Field);
        Assert.Equal("longest", YearReviewSlideDeck.Slides[3].Field);
        Assert.Equal("efficient", YearReviewSlideDeck.Slides[9].Field);
    }

    // ── Registration + diagnostics ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("YearReviewPage", YearReviewPageRegistration.Slug);
        Assert.Equal("year-review-page", YearReviewPageRegistration.Id);
        Assert.Equal("analytics", YearReviewPageRegistration.Category);
        Assert.Equal("2025 Year in Review", YearReviewPageRegistration.Title(Localizer, 2025));
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new YearReviewPageDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=YearReviewPage", Assert.Single(captured));
    }

    // ── View-model load / select / navigate ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_vehicles_auto_selects_first_and_reaches_success()
    {
        var feed = new FakeFeed(
            new[] { new YearReviewVehicleOption(1, "A"), new YearReviewVehicleOption(2, "B") },
            (year, id) => ActiveReport(year));
        using var vm = new YearReviewPageViewModel(feed, Localizer, Year);

        await vm.LoadAsync();

        Assert.Equal(YearReviewPageState.Success, vm.State);
        Assert.Equal(1, feed.VehicleFetches);
        Assert.Equal(1, feed.ReviewFetches);
        Assert.Equal(1, feed.LastVehicleId);   // auto-selected the first vehicle
        Assert.Equal(Year, feed.LastYear);
    }

    [Fact]
    public async Task ViewModel_no_vehicles_stays_loading()
    {
        using var vm = new YearReviewPageViewModel(EmptyYearReviewPageFeed.Instance, Localizer, Year);

        await vm.LoadAsync();

        Assert.Equal(YearReviewPageState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_no_activity_review_is_the_empty_state()
    {
        var feed = new FakeFeed(
            new[] { new YearReviewVehicleOption(1, "A") },
            (year, id) => ActiveReport(year, drives: 0, charges: 0));
        using var vm = new YearReviewPageViewModel(feed, Localizer, Year);

        await vm.LoadAsync();

        Assert.Equal(YearReviewPageState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new YearReviewPageViewModel(new ThrowingFeed(), Localizer, Year);

        await vm.LoadAsync();

        Assert.Equal(YearReviewPageState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_select_vehicle_reloads_and_resets_the_slide_index()
    {
        var feed = new FakeFeed(
            new[] { new YearReviewVehicleOption(1, "A"), new YearReviewVehicleOption(2, "B") },
            (year, id) => ActiveReport(year));
        using var vm = new YearReviewPageViewModel(feed, Localizer, Year);

        await vm.LoadAsync();
        vm.Next();
        Assert.Equal(1, vm.SlideIndex);

        await vm.SelectVehicleAsync(2);

        Assert.Equal(2, feed.ReviewFetches);
        Assert.Equal(2, feed.LastVehicleId);
        Assert.Equal(0, vm.SlideIndex);   // web setSlideIndex(0)
    }

    [Fact]
    public async Task ViewModel_navigation_clamps_at_both_ends()
    {
        var feed = new FakeFeed(new[] { new YearReviewVehicleOption(1, "A") }, (year, id) => ActiveReport(year));
        using var vm = new YearReviewPageViewModel(feed, Localizer, Year);
        await vm.LoadAsync();

        vm.Prev();
        Assert.Equal(0, vm.SlideIndex);   // clamped at the first slide

        for (var i = 0; i < YearReviewSlideDeck.Count + 3; i++)
        {
            vm.Next();
        }

        Assert.Equal(YearReviewSlideDeck.Count - 1, vm.SlideIndex);   // clamped at the last slide
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new[] { new YearReviewVehicleOption(1, "A") }, (year, id) => ActiveReport(year));
        using var vm = new YearReviewPageViewModel(feed, Localizer, Year);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.VehicleFetches);
    }

    // ── Fakes ───────────────────────────────────────────────────────────────────────────────────────────────

    private sealed class FakeFeed(
        IReadOnlyList<YearReviewVehicleOption> vehicles,
        Func<int, long, YearReviewReport> review) : IYearReviewPageFeed
    {
        public int VehicleFetches { get; private set; }

        public int ReviewFetches { get; private set; }

        public long LastVehicleId { get; private set; }

        public int LastYear { get; private set; }

        public Task<IReadOnlyList<YearReviewVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken)
        {
            VehicleFetches++;
            return Task.FromResult(vehicles);
        }

        public Task<YearReviewReport> FetchYearReviewAsync(int year, long vehicleId, CancellationToken cancellationToken)
        {
            ReviewFetches++;
            LastVehicleId = vehicleId;
            LastYear = year;
            return Task.FromResult(review(year, vehicleId));
        }
    }

    private sealed class ThrowingFeed : IYearReviewPageFeed
    {
        public Task<IReadOnlyList<YearReviewVehicleOption>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromException<IReadOnlyList<YearReviewVehicleOption>>(new InvalidOperationException("boom"));

        public Task<YearReviewReport> FetchYearReviewAsync(int year, long vehicleId, CancellationToken cancellationToken) =>
            Task.FromException<YearReviewReport>(new InvalidOperationException("boom"));
    }
}
