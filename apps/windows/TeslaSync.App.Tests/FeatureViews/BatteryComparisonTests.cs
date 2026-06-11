using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.BatteryComparison;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the BatteryComparison surface's UI-thread-free logic — the roster + per-vehicle
/// state JSON parse adapters, the SI→display projection (battery tier colour, clamped bar fraction, percentage
/// and unit-converted rated range), the registry metadata, the PII-safe diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web
/// spec (web/src/features/vehicles/components/BatteryComparison.tsx).
/// </summary>
public sealed class BatteryComparisonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private static BatteryComparisonRow Row(long id, string name, double level, double rangeMeters) =>
        new(id, name, level, rangeMeters);

    private static BatteryComparisonData Data(params BatteryComparisonRow[] rows) => new(rows);

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    // ---- Parse adapter: roster --------------------------------------------------------

    [Fact]
    public void ParseVehicles_reads_id_and_name()
    {
        var refs = BatteryComparisonData.ParseVehicles(Json("""
        [{"id":1,"display_name":"Model 3","vin":"VIN1"},
         {"id":2,"display_name":"Model Y","vin":"VIN2"}]
        """));

        Assert.Equal(2, refs.Count);
        Assert.Equal(1, refs[0].Id);
        Assert.Equal("Model 3", refs[0].Name);
        Assert.Equal(2, refs[1].Id);
        Assert.Equal("Model Y", refs[1].Name);
    }

    [Fact]
    public void ParseVehicles_falls_back_to_vin_when_display_name_blank()
    {
        var refs = BatteryComparisonData.ParseVehicles(Json("""[{"id":5,"display_name":"  ","vin":"VINX"}]"""));
        var v = Assert.Single(refs);
        Assert.Equal("VINX", v.Name);
    }

    [Fact]
    public void ParseVehicles_uses_vehicle_id_when_id_absent()
    {
        var refs = BatteryComparisonData.ParseVehicles(Json("""[{"vehicle_id":"42","vin":"V"}]"""));
        var v = Assert.Single(refs);
        Assert.Equal(42, v.Id);
    }

    [Fact]
    public void ParseVehicles_returns_empty_for_non_array()
    {
        Assert.Empty(BatteryComparisonData.ParseVehicles(Json("""{"total":3}""")));
    }

    [Fact]
    public void ParseVehicles_skips_non_object_entries()
    {
        var refs = BatteryComparisonData.ParseVehicles(Json("""[1,"a",{"id":9,"vin":"V9"}]"""));
        var v = Assert.Single(refs);
        Assert.Equal(9, v.Id);
    }

    // ---- Parse adapter: per-vehicle state ---------------------------------------------

    [Fact]
    public void ParseStateRow_reads_state_object()
    {
        var v = new VehicleRef(1, "Model 3");
        var row = BatteryComparisonData.ParseStateRow(v, Json("""{"state":{"vehicle_id":1,"battery_level":85,"rated_range":400000}}"""));

        Assert.NotNull(row);
        Assert.Equal(1, row!.Id);
        Assert.Equal("Model 3", row.Name);
        Assert.Equal(85, row.BatteryLevel);
        Assert.Equal(400000, row.RatedRangeMeters);
    }

    [Fact]
    public void ParseStateRow_falls_back_to_position()
    {
        var row = BatteryComparisonData.ParseStateRow(new VehicleRef(2, "Y"), Json("""{"position":{"battery_level":50,"rated_range":300000}}"""));
        Assert.NotNull(row);
        Assert.Equal(50, row!.BatteryLevel);
        Assert.Equal(300000, row.RatedRangeMeters);
    }

    [Fact]
    public void ParseStateRow_uses_ideal_range_when_rated_range_absent()
    {
        // Web parity: state.rated_range ?? state.ideal_range ?? 0.
        var row = BatteryComparisonData.ParseStateRow(new VehicleRef(3, "S"), Json("""{"position":{"battery_level":40,"ideal_range":250000}}"""));
        Assert.NotNull(row);
        Assert.Equal(250000, row!.RatedRangeMeters);
    }

    [Fact]
    public void ParseStateRow_reads_top_level_battery_fields()
    {
        var row = BatteryComparisonData.ParseStateRow(new VehicleRef(4, "X"), Json("""{"battery_level":72,"rated_range":360000}"""));
        Assert.NotNull(row);
        Assert.Equal(72, row!.BatteryLevel);
        Assert.Equal(360000, row.RatedRangeMeters);
    }

    [Fact]
    public void ParseStateRow_coerces_missing_numerics_to_zero()
    {
        // A resolved state with no battery info is still a valid (zero) bar — web keeps it (state !== null).
        var row = BatteryComparisonData.ParseStateRow(new VehicleRef(1, "A"), Json("""{"state":{"vehicle_id":1}}"""));
        Assert.NotNull(row);
        Assert.Equal(0, row!.BatteryLevel);
        Assert.Equal(0, row.RatedRangeMeters);
    }

    [Fact]
    public void ParseStateRow_returns_null_for_empty_object()
    {
        Assert.Null(BatteryComparisonData.ParseStateRow(new VehicleRef(1, "A"), Json("{}")));
    }

    [Fact]
    public void ParseStateRow_returns_null_for_non_object()
    {
        Assert.Null(BatteryComparisonData.ParseStateRow(new VehicleRef(1, "A"), Json("[]")));
    }

    // ---- Projection: gates + chrome ---------------------------------------------------

    [Fact]
    public void Project_empty_has_no_bars_but_localized_chrome()
    {
        var display = BatteryComparisonProjection.Project(BatteryComparisonData.Empty, UnitPref.Metric, Localizer);

        Assert.False(display.HasRows);
        Assert.Empty(display.Bars);
        Assert.Equal("Fleet Battery Status", display.Title);
        Assert.Equal("No vehicle battery data", display.EmptyMessage);
    }

    [Fact]
    public void Project_builds_one_bar_per_row_in_order()
    {
        var display = BatteryComparisonProjection.Project(
            Data(Row(1, "A", 85, 400000), Row(2, "B", 40, 300000)), UnitPref.Metric, Localizer);

        Assert.True(display.HasRows);
        Assert.Equal(2, display.Bars.Count);
        Assert.Equal("A", display.Bars[0].Name);
        Assert.Equal("B", display.Bars[1].Name);
    }

    // ---- Projection: battery colour tiers (web batteryColor) --------------------------

    [Theory]
    [InlineData(85, StatusKind.Success)]
    [InlineData(61, StatusKind.Success)]
    [InlineData(60, StatusKind.Warning)]   // web: level > 60 (strict)
    [InlineData(26, StatusKind.Warning)]
    [InlineData(25, StatusKind.Danger)]    // web: level > 25 (strict)
    [InlineData(0, StatusKind.Danger)]
    public void Tier_matches_web_batteryColor(double level, StatusKind expected) =>
        Assert.Equal(expected, BatteryComparisonProjection.Tier(level));

    [Fact]
    public void Tier_non_finite_is_danger() =>
        Assert.Equal(StatusKind.Danger, BatteryComparisonProjection.Tier(double.NaN));

    [Fact]
    public void Project_bar_carries_tier_and_token_accent()
    {
        var bars = BatteryComparisonProjection.Project(
            Data(Row(1, "Hi", 90, 0), Row(2, "Mid", 40, 0), Row(3, "Lo", 10, 0)), UnitPref.Metric, Localizer).Bars;

        Assert.Equal(StatusKind.Success, bars[0].Tier);
        Assert.Equal(StatusKind.Warning, bars[1].Tier);
        Assert.Equal(StatusKind.Danger, bars[2].Tier);
        foreach (var bar in bars)
        {
            Assert.Equal(StatusResources.AccentBrushKey(bar.Tier), bar.AccentBrushKey);
        }
    }

    // ---- Projection: percentage + bar fraction ----------------------------------------

    [Fact]
    public void Project_percent_text_is_integer_with_sign()
    {
        var bars = BatteryComparisonProjection.Project(Data(Row(1, "A", 85, 0), Row(2, "B", 0, 0)), UnitPref.Metric, Localizer).Bars;
        Assert.Equal("85%", bars[0].PercentText);
        Assert.Equal("0%", bars[1].PercentText);
    }

    [Theory]
    [InlineData(85, 0.85)]
    [InlineData(0, 0.0)]
    [InlineData(100, 1.0)]
    [InlineData(150, 1.0)]    // web clips overflow to the track width
    [InlineData(-10, 0.0)]
    public void Project_bar_fraction_is_clamped(double level, double expected)
    {
        var bar = Assert.Single(BatteryComparisonProjection.Project(Data(Row(1, "A", level, 0)), UnitPref.Metric, Localizer).Bars);
        Assert.Equal(expected, bar.BarFraction, 6);
    }

    // ---- Projection: rated-range unit conversion --------------------------------------

    [Fact]
    public void Project_metric_range_is_km()
    {
        var bar = Assert.Single(BatteryComparisonProjection.Project(Data(Row(1, "A", 80, 400000)), UnitPref.Metric, Localizer).Bars);
        Assert.Equal("400.0 km", bar.RangeText);
    }

    [Fact]
    public void Project_imperial_range_is_miles()
    {
        var bar = Assert.Single(BatteryComparisonProjection.Project(Data(Row(1, "A", 80, 400000)), UnitPref.Imperial, Localizer).Bars);
        // 400000 m / 1609.344 = 248.5485… → 1-digit halfExpand → 248.5 mi.
        Assert.Equal("248.5 mi", bar.RangeText);
    }

    // ---- Projection: accessibility + name fallback ------------------------------------

    [Fact]
    public void Project_bar_has_accessibility_name_with_value()
    {
        var bar = Assert.Single(BatteryComparisonProjection.Project(Data(Row(1, "Garage", 80, 400000)), UnitPref.Metric, Localizer).Bars);
        Assert.Contains("Garage", bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains(bar.PercentText, bar.AutomationName, StringComparison.Ordinal);
        Assert.Contains(bar.RangeText, bar.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_blank_name_uses_unique_fallback()
    {
        var bars = BatteryComparisonProjection.Project(Data(Row(1, "", 80, 0), Row(2, "   ", 50, 0)), UnitPref.Metric, Localizer).Bars;
        Assert.Equal("Vehicle 1", bars[0].Name);
        Assert.Equal("Vehicle 2", bars[1].Name);
    }

    [Fact]
    public void Project_thresholds_match_web_constants()
    {
        Assert.Equal(60, BatteryComparisonProjection.GoodThreshold);
        Assert.Equal(25, BatteryComparisonProjection.WarningThreshold);
    }

    // ---- View-model state matrix ------------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryComparisonData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_bars()
    {
        using var vm = NewViewModel(Loaded(Data(Row(1, "A", 85, 400000), Row(2, "B", 40, 300000))));
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Bars.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryComparisonData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Empty(vm.Display.Bars);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryComparisonData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryComparisonData>.Cached(Data(Row(1, "A", 85, 400000)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryComparisonData>.OfflineCached(
            Data(Row(1, "A", 85, 400000)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryComparisonData>.Loading(),
            RepositoryResult<BatteryComparisonData>.Cached(Data(Row(1, "A", 85, 400000)), Now, stale: false),
            RepositoryResult<BatteryComparisonData>.Loaded(Data(Row(1, "A", 85, 400000), Row(2, "B", 40, 300000)), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryComparisonState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Bars.Count);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_range()
    {
        using var vm = NewViewModel(Loaded(Data(Row(1, "A", 85, 400000))));
        await vm.LoadAsync();
        Assert.Equal("400.0 km", vm.Display.Bars[0].RangeText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("248.5 mi", vm.Display.Bars[0].RangeText);
        Assert.Equal(BatteryComparisonState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(Row(1, "A", 85, 400000))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryComparisonViewModel.State), changed);
        Assert.Contains(nameof(BatteryComparisonViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel();
        Assert.Equal("Fleet Battery Status", vm.Title);
    }

    // ---- Registration metadata + diagnostics ------------------------------------------

    [Fact]
    public void Registration_metadata_matches_contract()
    {
        Assert.Equal("battery-comparison", BatteryComparisonRegistration.Id);
        Assert.Equal("vehicles", BatteryComparisonRegistration.Category);
        Assert.Equal("BatteryComparison", BatteryComparisonRegistration.Slug);
        Assert.Equal(30, BatteryComparisonRegistration.RefreshIntervalSeconds);
        Assert.Equal("Fleet Battery Status", BatteryComparisonRegistration.Name(Localizer));
        Assert.Contains("range", BatteryComparisonRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryComparisonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryComparison", Assert.Single(lines));
    }

    // ---- Fakes / helpers --------------------------------------------------------------

    private static RepositoryResult<BatteryComparisonData> Loaded(BatteryComparisonData data) =>
        RepositoryResult<BatteryComparisonData>.Loaded(data, Now);

    private static BatteryComparisonViewModel NewViewModel(params RepositoryResult<BatteryComparisonData>[] emissions) =>
        new(new FakeSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeSource(params RepositoryResult<BatteryComparisonData>[] emissions) : IBatteryComparisonSource
    {
        public async IAsyncEnumerable<RepositoryResult<BatteryComparisonData>> StreamAsync(
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
