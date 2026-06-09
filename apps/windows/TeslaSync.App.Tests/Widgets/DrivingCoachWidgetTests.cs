using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the DrivingCoachWidget's UI-thread-free logic — the JSON parse adapter, the
/// projection (score readout, the web potential-savings ratio, the impact-badge mapping and the tip
/// composition), the cache-then-network result mapper, the registry metadata, the diagnostics, the
/// repository source's vehicle resolution, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/DrivingCoachWidget.tsx + api/hooks/useDriving.ts).
/// </summary>
public sealed class DrivingCoachWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static CoachRecommendation Rec(string? category = "Acceleration", string? impact = "high", string? tip = "Ease off the pedal") =>
        new(category, impact, tip);

    private static CoachData Coaching(
        double score = 82,
        double efficiency = 200,
        double best = 150,
        params CoachRecommendation[] recommendations) =>
        new(score, efficiency, best, recommendations);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_coaching_body_with_snake_case_fields()
    {
        const string json = """
        {"overall_score":87,"efficiency_wh_km":200,"best_efficiency_wh_km":150,
         "total_drives_analyzed":42,
         "recommendations":[{"category":"Acceleration","impact":"high","tip":"Ease off the pedal"}]}
        """;
        using var doc = JsonDocument.Parse(json);

        var data = CoachData.FromJson(doc.RootElement);

        Assert.Equal(87, data.OverallScore);
        Assert.Equal(200, data.EfficiencyWhKm);
        Assert.Equal(150, data.BestEfficiencyWhKm);
        var rec = Assert.Single(data.Recommendations);
        Assert.Equal("Acceleration", rec.Category);
        Assert.Equal("high", rec.Impact);
        Assert.Equal("Ease off the pedal", rec.Tip);
        Assert.True(data.HasContent);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"recommendations":[{"tip":"Coast more"}]}""");

        var data = CoachData.FromJson(doc.RootElement);

        Assert.Equal(0, data.OverallScore);
        Assert.Equal(0, data.EfficiencyWhKm);
        Assert.Equal(0, data.BestEfficiencyWhKm);
        var rec = Assert.Single(data.Recommendations);
        Assert.Null(rec.Category);
        Assert.Null(rec.Impact);
        Assert.Equal("Coast more", rec.Tip);
        Assert.True(data.HasContent); // a recommendation alone is content
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object_body()
    {
        using var doc = JsonDocument.Parse("42");
        var data = CoachData.FromJson(doc.RootElement);
        Assert.False(data.HasContent);
        Assert.Empty(data.Recommendations);
    }

    [Fact]
    public void FromJson_empty_object_has_no_content()
    {
        using var doc = JsonDocument.Parse("{}");
        var data = CoachData.FromJson(doc.RootElement);
        Assert.False(data.HasContent);
        Assert.Equal(0, data.OverallScore);
        Assert.Empty(data.Recommendations);
    }

    [Fact]
    public void FromJson_score_alone_is_content()
    {
        using var doc = JsonDocument.Parse("""{"overall_score":73}""");
        Assert.True(CoachData.FromJson(doc.RootElement).HasContent);
    }

    [Fact]
    public void FromJson_savings_headroom_alone_is_content()
    {
        using var doc = JsonDocument.Parse("""{"efficiency_wh_km":200,"best_efficiency_wh_km":150}""");
        Assert.True(CoachData.FromJson(doc.RootElement).HasContent);
    }

    [Fact]
    public void FromJson_skips_non_object_recommendation_items()
    {
        using var doc = JsonDocument.Parse("""{"recommendations":[1,"x",{"category":"Braking"}]}""");
        var data = CoachData.FromJson(doc.RootElement);
        var rec = Assert.Single(data.Recommendations);
        Assert.Equal("Braking", rec.Category);
    }

    [Fact]
    public void FromJson_reads_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"overall_score":"88"}""");
        Assert.Equal(88, CoachData.FromJson(doc.RootElement).OverallScore);
    }

    // ---- Size / footprint flag (web isCompact) -------------------------------------

    [Theory]
    [InlineData(1, 2, true)]    // compact (min)
    [InlineData(2, 4, false)]   // standard (default)
    [InlineData(4, 40, false)]  // wide (max)
    public void Size_isCompact_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new DrivingCoachSize(cols, rows).IsCompact);

    // ---- Projection: score + savings -----------------------------------------------

    [Fact]
    public void Project_formats_score_and_score_label()
    {
        var display = DrivingCoachProjection.Project(Coaching(score: 87), new DrivingCoachSize(2, 4), Localizer);

        Assert.Equal("87", display.ScoreText);
        Assert.Equal("/ 100", display.ScoreLabel);
    }

    [Theory]
    [InlineData(200, 150, 25)]   // (200-150)/200 = 25%
    [InlineData(180, 150, 17)]   // 30/180 = 16.67 -> 17 (round away from zero)
    [InlineData(150, 150, 0)]    // no headroom
    [InlineData(140, 150, -7)]   // current already beats best -> negative (chip hidden)
    [InlineData(0, 150, 0)]      // guard: current <= 0
    public void Project_savings_percent_matches_web(double current, double best, int expected)
    {
        Assert.Equal(expected, DrivingCoachProjection.SavingsPercent(current, best));
    }

    [Fact]
    public void Project_shows_savings_chip_with_localized_label()
    {
        var display = DrivingCoachProjection.Project(Coaching(efficiency: 200, best: 150), new DrivingCoachSize(2, 4), Localizer);

        Assert.True(display.ShowSavings);
        Assert.Equal(25, display.SavingsPct);
        Assert.Equal("Potential savings: 25%", display.SavingsLabel);
    }

    [Fact]
    public void Project_hides_savings_chip_when_non_positive()
    {
        var display = DrivingCoachProjection.Project(Coaching(efficiency: 150, best: 150), new DrivingCoachSize(2, 4), Localizer);

        Assert.False(display.ShowSavings);
        Assert.Equal(string.Empty, display.SavingsLabel);
    }

    // ---- Projection: tips ----------------------------------------------------------

    [Fact]
    public void Project_maps_recommendation_to_tip()
    {
        var display = DrivingCoachProjection.Project(
            Coaching(recommendations: Rec(category: "Acceleration", impact: "high", tip: "Ease off the pedal")),
            new DrivingCoachSize(2, 4), Localizer);

        var tip = Assert.Single(display.Tips);
        Assert.Equal("Acceleration", tip.Title);
        Assert.Equal("Ease off the pedal", tip.Description);
        Assert.True(tip.ShowImpact);
        Assert.Equal("high", tip.ImpactLabel);
        Assert.Equal(StatusKind.Success, tip.ImpactStatus);
        Assert.Equal(DrivingCoachProjection.LightbulbGlyph, tip.Glyph);
    }

    [Fact]
    public void Project_tip_falls_back_to_em_dash_for_null_category_and_tip()
    {
        var display = DrivingCoachProjection.Project(
            Coaching(recommendations: Rec(category: null, impact: null, tip: null)),
            new DrivingCoachSize(2, 4), Localizer);

        var tip = Assert.Single(display.Tips);
        Assert.Equal("\u2014", tip.Title);
        Assert.Equal("\u2014", tip.Description);
        Assert.False(tip.ShowImpact);           // absent impact -> no badge (web `impact ?? undefined`)
        Assert.Equal(string.Empty, tip.ImpactLabel);
        Assert.Equal(StatusKind.Neutral, tip.ImpactStatus);
    }

    [Theory]
    [InlineData("high", StatusKind.Success)]
    [InlineData("medium", StatusKind.Warning)]
    [InlineData("low", StatusKind.Neutral)]
    [InlineData("nonsense", StatusKind.Neutral)]
    [InlineData("", StatusKind.Neutral)]
    public void Project_impact_badge_status_matches_web(string impact, StatusKind expected)
    {
        Assert.Equal(expected, DrivingCoachProjection.ImpactBadgeStatus(impact));
    }

    [Fact]
    public void Project_keeps_all_tips_and_exposes_standard_cap()
    {
        var display = DrivingCoachProjection.Project(
            Coaching(recommendations: new[] { Rec(tip: "a"), Rec(tip: "b"), Rec(tip: "c"), Rec(tip: "d") }),
            new DrivingCoachSize(2, 4), Localizer);

        Assert.Equal(4, display.Tips.Count); // projection keeps all; the view caps at MaxStandardTips
        Assert.Equal(3, DrivingCoachProjection.MaxStandardTips);
        Assert.True(display.HasTips);
    }

    [Fact]
    public void Project_compact_empty_flag_set_when_no_savings_and_no_tips()
    {
        // Score only (a content snapshot), but no savings and no recommendations.
        var display = DrivingCoachProjection.Project(
            new CoachData(73, 0, 0, Array.Empty<CoachRecommendation>()), new DrivingCoachSize(1, 2), Localizer);

        Assert.True(display.IsCompact);
        Assert.False(display.ShowSavings);
        Assert.False(display.HasTips);
        Assert.True(display.ShowCompactEmpty);
        Assert.Equal("No tips available", display.EmptyMessage);
    }

    [Fact]
    public void Project_compact_empty_flag_clear_when_savings_present()
    {
        var display = DrivingCoachProjection.Project(Coaching(efficiency: 200, best: 150), new DrivingCoachSize(1, 2), Localizer);

        Assert.True(display.ShowSavings);
        Assert.False(display.ShowCompactEmpty);
    }

    // ---- Projection: accessibility names -------------------------------------------

    [Fact]
    public void Project_score_automation_name_carries_score_and_label()
    {
        var display = DrivingCoachProjection.Project(Coaching(score: 87), new DrivingCoachSize(2, 4), Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.ScoreAutomationName));
        Assert.Contains("Driving Coach", display.ScoreAutomationName, StringComparison.Ordinal);
        Assert.Contains("87", display.ScoreAutomationName, StringComparison.Ordinal);
        Assert.Contains("/ 100", display.ScoreAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_automation_name_includes_savings_when_present()
    {
        var display = DrivingCoachProjection.Project(
            Coaching(score: 87, efficiency: 200, best: 150), new DrivingCoachSize(1, 2), Localizer);

        Assert.Contains("Potential savings: 25%", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_tips_have_non_empty_accessibility_names()
    {
        var display = DrivingCoachProjection.Project(
            Coaching(recommendations: Rec(category: "Acceleration", impact: "high", tip: "Ease off the pedal")),
            new DrivingCoachSize(2, 4), Localizer);

        var tip = Assert.Single(display.Tips);
        Assert.False(string.IsNullOrWhiteSpace(tip.AutomationName));
        Assert.Contains(tip.Title, tip.AutomationName, StringComparison.Ordinal);
        Assert.Contains(tip.Description, tip.AutomationName, StringComparison.Ordinal);
        Assert.Contains(tip.ImpactLabel, tip.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"overall_score":80,"recommendations":[{"category":"A","impact":"high","tip":"t"}]}""");

        var cached = DrivingCoachResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(80, cached.Value!.OverallScore);

        var offline = DrivingCoachResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Recommendations);
    }

    [Fact]
    public void Mapper_loaded_with_content_is_loaded()
    {
        using var doc = JsonDocument.Parse("""{"overall_score":80}""");
        Assert.Equal(LoadStatus.Loaded, DrivingCoachResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_loaded_without_content_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Equal(LoadStatus.Empty, DrivingCoachResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mapper_maps_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Empty, DrivingCoachResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DrivingCoachResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CoachData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Loading, vm.State);
        Assert.False(vm.HasContent);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_score_and_tips()
    {
        using var vm = NewViewModel(Loaded(Coaching(score: 87, recommendations: Rec())));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Loaded, vm.State);
        Assert.True(vm.HasContent);
        Assert.Equal("87", vm.Display.ScoreText);
        Assert.Single(vm.Display.Tips);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_content_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CoachData>.Loaded(CoachData.Empty, Now));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Empty, vm.State);
        Assert.False(vm.HasContent);
        Assert.Equal("No tips available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CoachData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Empty, vm.State);
        Assert.False(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<CoachData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<CoachData>.Cached(Coaching(score: 70, recommendations: Rec()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasContent);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<CoachData>.OfflineCached(
            Coaching(score: 70, recommendations: Rec()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Offline, vm.State);
        Assert.True(vm.HasContent);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CoachData>.Loading(),
            RepositoryResult<CoachData>.Cached(Coaching(score: 60, recommendations: Rec(category: "Cached")), Now, stale: false),
            RepositoryResult<CoachData>.Loaded(Coaching(score: 91, recommendations: Rec(category: "Fresh")), Now));
        await vm.LoadAsync();

        Assert.Equal(DrivingCoachState.Loaded, vm.State);
        Assert.Equal("91", vm.Display.ScoreText);
        Assert.Equal("Fresh", Assert.Single(vm.Display.Tips).Title);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new DrivingCoachSize(2, 4), Loaded(Coaching(score: 87, recommendations: Rec())));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new DrivingCoachSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(DrivingCoachState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CoachData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Driving Coach", vm.Title);
        Assert.Equal("No tips available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Coaching(score: 87, recommendations: Rec())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DrivingCoachViewModel.State), changed);
        Assert.Contains(nameof(DrivingCoachViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("driving-coach", DrivingCoachRegistration.Id);
        Assert.Equal("driving", DrivingCoachRegistration.Category);
        Assert.Equal("DrivingCoachWidget", DrivingCoachRegistration.Slug);
        Assert.Equal(30, DrivingCoachRegistration.DefaultDays);
        Assert.Equal(new DrivingCoachSize(2, 4), DrivingCoachRegistration.DefaultSize);
        Assert.Equal(new DrivingCoachSize(1, 2), DrivingCoachRegistration.MinSize);
        Assert.Equal(new DrivingCoachSize(4, 40), DrivingCoachRegistration.MaxSize);
        Assert.Equal("Driving Coach", DrivingCoachRegistration.Name(Localizer));
        Assert.Contains("recommendations", DrivingCoachRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DrivingCoachRegistration.IsWithinBounds(new DrivingCoachSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DrivingCoachSize(1, 2), DrivingCoachRegistration.Clamp(new DrivingCoachSize(0, 0)));
        Assert.Equal(new DrivingCoachSize(4, 40), DrivingCoachRegistration.Clamp(new DrivingCoachSize(9, 99)));
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_registration() =>
        Assert.Equal("driving-coach", DrivingCoachRegistration.Id);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DrivingCoachDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DrivingCoachWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shape --------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DrivingCoachSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_coaching()
    {
        using var doc = JsonDocument.Parse(
            """{"overall_score":88,"efficiency_wh_km":200,"best_efficiency_wh_km":150,"recommendations":[{"category":"A","impact":"high","tip":"t"}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DrivingCoachSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null, days: 30);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(88, terminal.Value!.OverallScore);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_driving_coach", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(30, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_and_empty_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new DrivingCoachSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42, days: 14);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(14, Convert.ToInt32(request.Query!["days"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new FakeCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<CoachData>>> Drain(IDrivingCoachSource source)
    {
        var list = new List<RepositoryResult<CoachData>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<CoachData> Loaded(CoachData data) =>
        RepositoryResult<CoachData>.Loaded(data, Now);

    private static DrivingCoachViewModel NewViewModel(params RepositoryResult<CoachData>[] emissions) =>
        NewViewModel(DrivingCoachSize.Default, emissions);

    private static DrivingCoachViewModel NewViewModel(
        DrivingCoachSize size,
        params RepositoryResult<CoachData>[] emissions) =>
        new(new FakeDrivingCoachSource(emissions), Localizer, size);

    private sealed class FakeDrivingCoachSource(params RepositoryResult<CoachData>[] emissions) : IDrivingCoachSource
    {
        public async IAsyncEnumerable<RepositoryResult<CoachData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
