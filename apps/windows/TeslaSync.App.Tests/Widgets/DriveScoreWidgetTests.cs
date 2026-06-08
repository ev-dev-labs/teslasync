using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the DriveScoreWidget's UI-thread-free logic — the JSON parse adapter (the
/// fleet-efficiency slice), the score derivation + threshold colour helper, the SI→display efficiency
/// conversion, the projection across the compact / standard footprints, the cache-then-network result
/// mapper, the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/DriveScoreWidget.tsx).
/// </summary>
public sealed class DriveScoreWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web analytics.avg_efficiency_wh_km) ------------------------

    [Fact]
    public void FromJson_reads_snake_case_efficiency()
    {
        const string json = """
        {"period_days":7,"total_vehicles":3,"total_distance_km":1234.5,
         "total_energy_kwh":456.7,"avg_efficiency_wh_km":171.2}
        """;
        using var doc = JsonDocument.Parse(json);

        var efficiency = FleetEfficiency.FromJson(doc.RootElement);

        Assert.Equal(171.2, efficiency.AvgEfficiencyWhKm);
        Assert.True(efficiency.HasScore);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_field()
    {
        using var doc = JsonDocument.Parse("""{"total_distance_km":12}""");

        var efficiency = FleetEfficiency.FromJson(doc.RootElement);

        Assert.Equal(0, efficiency.AvgEfficiencyWhKm);
        Assert.False(efficiency.HasScore);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var efficiency = FleetEfficiency.FromJson(doc.RootElement);
        Assert.False(efficiency.HasScore);
        Assert.Equal(0, efficiency.AvgEfficiencyWhKm);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(-5, false)]
    [InlineData(0.1, true)]
    [InlineData(150, true)]
    public void HasScore_matches_web_gate(double efficiencyWhKm, bool expected) =>
        Assert.Equal(expected, new FleetEfficiency(efficiencyWhKm).HasScore);

    // ---- Score derivation (web Math.min(100, Math.round((250 / efficiency) * 100))) -

    [Theory]
    [InlineData(250, 100)] // 250/250*100 = 100
    [InlineData(500, 50)]  // 250/500*100 = 50
    [InlineData(1000, 25)] // 250/1000*100 = 25
    [InlineData(300, 83)]  // 83.33 -> 83
    [InlineData(0, 0)]     // no efficiency -> 0
    [InlineData(-10, 0)]   // negative -> 0
    public void ScoreFor_matches_web_formula(double efficiencyWhKm, double expected) =>
        Assert.Equal(expected, DriveScoreProjection.ScoreFor(efficiencyWhKm));

    [Fact]
    public void ScoreFor_clamps_to_one_hundred()
    {
        // 250/125*100 = 200 -> min(100, 200) = 100
        Assert.Equal(100, DriveScoreProjection.ScoreFor(125));
    }

    [Fact]
    public void ScoreFor_rounds_half_away_from_zero_like_js()
    {
        // 250/400*100 = 62.5 -> JS Math.round -> 63 (banker's rounding would give 62)
        Assert.Equal(63, DriveScoreProjection.ScoreFor(400));
    }

    [Theory]
    [InlineData(double.NaN, 0)]
    [InlineData(double.PositiveInfinity, 0)]
    public void ScoreFor_coerces_non_finite_to_zero(double efficiencyWhKm, double expected) =>
        Assert.Equal(expected, DriveScoreProjection.ScoreFor(efficiencyWhKm));

    // ---- Score colour thresholds (web score > 75 / > 50) ---------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(76, StatusKind.Success)]
    [InlineData(75, StatusKind.Warning)]  // web: > 75, so 75 is amber
    [InlineData(51, StatusKind.Warning)]
    [InlineData(50, StatusKind.Danger)]   // web: > 50, so 50 is red
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double score, StatusKind expected) =>
        Assert.Equal(expected, DriveScoreProjection.StatusFor(score));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(75, DriveScoreProjection.HealthyThresholdScore);
        Assert.Equal(50, DriveScoreProjection.WarningThresholdScore);
        Assert.Equal(100, DriveScoreProjection.MaxScore);
        Assert.Equal(250, DriveScoreProjection.ScoreBaselineWhKm);
    }

    // ---- Efficiency conversion (web toEfficiencyDisplay) ---------------------------

    [Fact]
    public void EfficiencyDisplay_keeps_wh_km_for_metric()
    {
        Assert.Equal(150, DriveScoreProjection.EfficiencyDisplay(150, DistanceUnit.Km));
        Assert.Equal("Wh/km", DriveScoreProjection.EfficiencyUnitFor(DistanceUnit.Km));
    }

    [Fact]
    public void EfficiencyDisplay_converts_to_wh_mi_for_imperial()
    {
        Assert.Equal(150 * 1.609344, DriveScoreProjection.EfficiencyDisplay(150, DistanceUnit.Mi));
        Assert.Equal("Wh/mi", DriveScoreProjection.EfficiencyUnitFor(DistanceUnit.Mi));
    }

    [Fact]
    public void Efficiency_mi_to_km_matches_web_constant() =>
        Assert.Equal(1.609344, DriveScoreProjection.EfficiencyMiToKm);

    // ---- Size / footprint flags (web isCompact / gauge diameter) -------------------

    [Theory]
    [InlineData(1, 1, true, 70)]    // compact 1x1 -> 70px gauge
    [InlineData(1, 2, false, 100)]  // default -> 100px gauge
    [InlineData(2, 2, false, 100)]
    public void Size_flags_match_web(int cols, int rows, bool compact, double diameter)
    {
        var size = new DriveScoreSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    // ---- Projection (metric) -------------------------------------------------------

    [Fact]
    public void Project_metric_derives_score_colour_and_efficiency_stat()
    {
        var view = DriveScoreProjection.Project(
            new FleetEfficiency(300), new DriveScoreSize(1, 2), UnitPref.Metric, Localizer);

        Assert.Equal(83, view.Score);
        Assert.Equal(100, view.Max);
        Assert.Equal("83", view.ScoreText);
        Assert.Equal("Score", view.ScoreLabel);
        Assert.Equal(StatusKind.Success, view.Status);

        Assert.Equal("Efficiency", view.EfficiencyLabel);
        Assert.Equal("300", view.EfficiencyValue);
        Assert.Equal("Wh/km", view.EfficiencyUnit);

        Assert.False(view.IsCompact);
        Assert.Equal(100, view.GaugeDiameter);
    }

    // ---- Projection (imperial) -----------------------------------------------------

    [Fact]
    public void Project_imperial_converts_efficiency_but_not_score()
    {
        var view = DriveScoreProjection.Project(
            new FleetEfficiency(300), new DriveScoreSize(1, 2), UnitPref.Imperial, Localizer);

        Assert.Equal(83, view.Score); // score is unit-independent
        Assert.Equal("483", view.EfficiencyValue); // 300 * 1.609344 -> 483
        Assert.Equal("Wh/mi", view.EfficiencyUnit);
    }

    [Theory]
    [InlineData(200, StatusKind.Success)] // 250/200*100 = 125 -> clamp 100 -> Success
    [InlineData(350, StatusKind.Warning)] // 71.4 -> Warning
    [InlineData(800, StatusKind.Danger)]  // 31.25 -> 31 -> Danger
    public void Project_colours_gauge_by_score(double efficiencyWhKm, StatusKind expected)
    {
        var view = DriveScoreProjection.Project(
            new FleetEfficiency(efficiencyWhKm), new DriveScoreSize(1, 2), UnitPref.Metric, Localizer);
        Assert.Equal(expected, view.Status);
    }

    [Fact]
    public void Project_has_non_empty_accessibility_names()
    {
        var view = DriveScoreProjection.Project(
            new FleetEfficiency(300), new DriveScoreSize(1, 2), UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains(view.ScoreLabel, view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.ScoreText, view.GaugeAutomationName, StringComparison.Ordinal);

        Assert.False(string.IsNullOrWhiteSpace(view.EfficiencyAutomationName));
        Assert.Contains(view.EfficiencyLabel, view.EfficiencyAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.EfficiencyValue, view.EfficiencyAutomationName, StringComparison.Ordinal);
        Assert.Contains(view.EfficiencyUnit, view.EfficiencyAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"avg_efficiency_wh_km":171.2}""");

        var cached = DriveScoreResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(171.2, cached.Value!.AvgEfficiencyWhKm);

        var offline = DriveScoreResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(171.2, offline.Value!.AvgEfficiencyWhKm);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"avg_efficiency_wh_km":150}""");

        Assert.Equal(LoadStatus.Loaded, DriveScoreResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, DriveScoreResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, DriveScoreResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<FleetEfficiency>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Loading, vm.State);
        Assert.False(vm.HasScore);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_display()
    {
        using var vm = NewViewModel(Loaded(new FleetEfficiency(300)));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Loaded, vm.State);
        Assert.True(vm.HasScore);
        Assert.NotNull(vm.Display);
        Assert.Equal(83, vm.Display!.Score);
        Assert.Equal("300", vm.Display.EfficiencyValue);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_efficiency_renders_empty()
    {
        using var vm = NewViewModel(Loaded(new FleetEfficiency(0)));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Empty, vm.State);
        Assert.False(vm.HasScore);
        Assert.Null(vm.Display);
        Assert.Equal("No data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<FleetEfficiency>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Empty, vm.State);
        Assert.False(vm.HasScore);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetEfficiency>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetEfficiency>.Cached(new FleetEfficiency(300), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasScore);
        Assert.Equal(StatusKind.Success, vm.Display!.Status);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<FleetEfficiency>.OfflineCached(
            new FleetEfficiency(800), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Offline, vm.State);
        Assert.True(vm.HasScore);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 31 -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<FleetEfficiency>.Loading(),
            RepositoryResult<FleetEfficiency>.Cached(new FleetEfficiency(500), Now, stale: false),
            RepositoryResult<FleetEfficiency>.Loaded(new FleetEfficiency(300), Now));
        await vm.LoadAsync();

        Assert.Equal(DriveScoreState.Loaded, vm.State);
        Assert.Equal("83", vm.Display!.ScoreText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(DriveScoreSize.Default, Loaded(new FleetEfficiency(300)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new DriveScoreSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.Equal(DriveScoreState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_efficiency()
    {
        using var vm = NewViewModel(Loaded(new FleetEfficiency(300)));
        await vm.LoadAsync();
        Assert.Equal("Wh/km", vm.Display!.EfficiencyUnit);
        Assert.Equal("300", vm.Display.EfficiencyValue);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("Wh/mi", vm.Display!.EfficiencyUnit);
        Assert.Equal("483", vm.Display.EfficiencyValue);
        Assert.Equal(83, vm.Display.Score); // score unchanged by units
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<FleetEfficiency>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Driving Score", vm.Title);
        Assert.Equal("No data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new FleetEfficiency(300)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DriveScoreViewModel.State), changed);
        Assert.Contains(nameof(DriveScoreViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("drive-score", DriveScoreRegistration.Id);
        Assert.Equal("driving", DriveScoreRegistration.Category);
        Assert.Equal("DriveScoreWidget", DriveScoreRegistration.Slug);
        Assert.Equal(new DriveScoreSize(1, 2), DriveScoreRegistration.DefaultSize);
        Assert.Equal(new DriveScoreSize(1, 2), DriveScoreRegistration.MinSize);
        Assert.Equal(new DriveScoreSize(2, 40), DriveScoreRegistration.MaxSize);
        Assert.Equal("Driving Score", DriveScoreRegistration.Name(Localizer));
        Assert.Contains("efficiency", DriveScoreRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]   // min == default
    [InlineData(2, 40, true)]  // max
    [InlineData(2, 10, true)]  // inside
    [InlineData(3, 2, false)]  // above max cols
    [InlineData(1, 1, false)]  // below min rows
    [InlineData(1, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DriveScoreRegistration.IsWithinBounds(new DriveScoreSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DriveScoreSize(1, 2), DriveScoreRegistration.Clamp(new DriveScoreSize(0, 0)));
        Assert.Equal(new DriveScoreSize(2, 40), DriveScoreRegistration.Clamp(new DriveScoreSize(9, 99)));
    }

    [Fact]
    public void Source_requests_the_web_default_window() =>
        Assert.Equal(7, DriveScoreRegistration.DefaultDays);

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveScoreDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveScoreWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<FleetEfficiency> Loaded(FleetEfficiency efficiency) =>
        RepositoryResult<FleetEfficiency>.Loaded(efficiency, Now);

    private static DriveScoreViewModel NewViewModel(params RepositoryResult<FleetEfficiency>[] emissions) =>
        NewViewModel(DriveScoreSize.Default, emissions);

    private static DriveScoreViewModel NewViewModel(
        DriveScoreSize size,
        params RepositoryResult<FleetEfficiency>[] emissions) =>
        new(new FakeDriveScoreSource(emissions), Localizer, size, UnitPref.Metric);

    private sealed class FakeDriveScoreSource(params RepositoryResult<FleetEfficiency>[] emissions) : IDriveScoreSource
    {
        public async IAsyncEnumerable<RepositoryResult<FleetEfficiency>> StreamAsync(
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
}
