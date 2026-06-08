using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the DriveTelemetryWidget's UI-thread-free logic — the JSON parse adapters
/// (drive distance / duration / energy / start_ts / start_address; telemetry timestamp ?? created_at,
/// speed, power, battery_level ?? soc, elevation), the newest-drive reduce by start_ts, the SI → display
/// unit conversion (distance / speed) + the Efficiency stat gate, the dual-axis speed/battery/elevation
/// (left) + power (right) chart normalization with <c>connectNulls</c> gaps, the cache-then-network result
/// mapper, the per-vehicle data source (primary resolution + drives → latest → telemetry request chain),
/// the registry metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading
/// / loaded / empty / error / stale / offline) + units reprojection. Mirrors the web spec
/// (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx + api/hooks/useDriving.ts).
/// </summary>
public sealed class DriveTelemetryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static DriveTelemetrySnapshot Snapshot(DriveSummary drive, params DriveTelemetrySample[] telemetry) =>
        new(drive, telemetry);

    private static DriveSummary Drive(
        long id = 1,
        DateTimeOffset? startTs = null,
        double distanceM = 0,
        long durationS = 0,
        double? energyUsedWh = null,
        string? startAddress = null) =>
        new(id, startTs ?? Now, distanceM, durationS, energyUsedWh, startAddress);

    private static DriveTelemetrySample Sample(
        double? speedMps = null,
        double? power = null,
        double? battery = null,
        double? elevation = null,
        DateTimeOffset? at = null) =>
        new(at ?? Now, speedMps, power, battery, elevation);

    private static DriveTelemetryDisplay Project(
        DriveTelemetrySnapshot snapshot,
        int cols = 2,
        int rows = 4,
        UnitPref? units = null) =>
        DriveTelemetryProjection.Project(
            snapshot, new DriveTelemetrySize(cols, rows), units ?? UnitPref.Metric, Localizer, Now);

    // ---- Drive summary parse adapter ----------------------------------------------

    [Fact]
    public void DriveFromJson_reads_distance_duration_energy_start_and_address()
    {
        using var doc = JsonDocument.Parse(
            """{"id":42,"start_ts":"2026-04-04T10:00:00Z","distance_m":42000.5,"duration_s":2100,"energy_used_wh":8400,"start_address":"Berlin"}""");

        var drive = DriveSummary.FromJson(doc.RootElement);

        Assert.Equal(42, drive.Id);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), drive.StartTs);
        Assert.Equal(42000.5, drive.DistanceM);
        Assert.Equal(2100, drive.DurationS);
        Assert.Equal(8400, drive.EnergyUsedWh);
        Assert.Equal("Berlin", drive.StartAddress);
    }

    [Fact]
    public void DriveFromJson_defaults_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var drive = DriveSummary.FromJson(doc.RootElement);

        Assert.Equal(7, drive.Id);
        Assert.Null(drive.StartTs);
        Assert.Equal(0, drive.DistanceM);
        Assert.Equal(0, drive.DurationS);
        Assert.Null(drive.EnergyUsedWh);
        Assert.Null(drive.StartAddress);
    }

    [Fact]
    public void DriveLatest_picks_newest_by_start_ts()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":11,"start_ts":"2026-04-01T08:00:00Z"},{"id":55,"start_ts":"2026-04-04T10:00:00Z"},{"id":33,"start_ts":"2026-04-02T09:00:00Z"}]""");

        var latest = DriveSummary.Latest(doc.RootElement);

        Assert.NotNull(latest);
        Assert.Equal(55, latest!.Id);
    }

    [Fact]
    public void DriveLatest_returns_null_for_empty_or_non_array()
    {
        using var empty = JsonDocument.Parse("[]");
        using var obj = JsonDocument.Parse("{}");

        Assert.Null(DriveSummary.Latest(empty.RootElement));
        Assert.Null(DriveSummary.Latest(obj.RootElement));
    }

    [Fact]
    public void DriveLatest_keeps_first_on_tie_and_prefers_dated_over_null()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"start_ts":"2026-04-04T10:00:00Z"},{"id":2,"start_ts":"2026-04-04T10:00:00Z"},{"id":3}]""");

        // Web parity: the reduce uses strict `>`, so a tie keeps the first and a null start_ts never wins.
        Assert.Equal(1, DriveSummary.Latest(doc.RootElement)!.Id);
    }

    // ---- Telemetry parse adapter --------------------------------------------------

    [Fact]
    public void TelemetryFromJson_reads_timestamp_speed_power_and_battery_level()
    {
        using var doc = JsonDocument.Parse(
            """{"timestamp":"2026-04-04T10:05:00Z","speed":20,"power":48.3,"battery_level":62,"elevation":120}""");

        var sample = DriveTelemetrySample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 5, 0, TimeSpan.Zero), sample.TimestampUtc);
        Assert.Equal(20, sample.SpeedMps);
        Assert.Equal(48.3, sample.PowerKw);
        Assert.Equal(62, sample.BatteryPct);
        Assert.Equal(120, sample.Elevation);
    }

    [Fact]
    public void TelemetryFromJson_falls_back_to_created_at_for_timestamp()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-04-04T10:06:00Z","speed":10}""");

        // Web parity: the DriveTelemetryPoint type documents created_at as the timestamp fallback and the
        // Go /drives/{id}/telemetry handler emits created_at.
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 6, 0, TimeSpan.Zero),
            DriveTelemetrySample.FromJson(doc.RootElement).TimestampUtc);
    }

    [Fact]
    public void TelemetryFromJson_falls_back_to_soc_when_no_battery_level()
    {
        using var doc = JsonDocument.Parse("""{"speed":11,"soc":44}""");

        Assert.Equal(44, DriveTelemetrySample.FromJson(doc.RootElement).BatteryPct);
    }

    [Fact]
    public void TelemetryParseList_reads_array_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"speed":10}, 7, {"speed":20}]""");

        var list = DriveTelemetrySample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(10, list[0].SpeedMps);
        Assert.Equal(20, list[1].SpeedMps);
    }

    [Fact]
    public void TelemetryParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"speed":10}""");
        Assert.Empty(DriveTelemetrySample.ParseList(doc.RootElement));
    }

    // ---- Projection: stats --------------------------------------------------------

    [Fact]
    public void Project_distance_converts_si_metres_to_km()
    {
        var display = Project(Snapshot(Drive(distanceM: 42000, durationS: 2100)));

        Assert.True(display.HasData);
        Assert.Equal("Distance", display.Stats[0].Label);
        Assert.Equal("42.0", display.Stats[0].Value);
        Assert.Equal("km", display.Stats[0].Unit);
    }

    [Fact]
    public void Project_distance_converts_si_metres_to_miles_for_imperial()
    {
        var display = Project(Snapshot(Drive(distanceM: 16093.44, durationS: 600)), units: UnitPref.Imperial);

        Assert.Equal("10.0", display.Stats[0].Value);
        Assert.Equal("mi", display.Stats[0].Unit);
    }

    [Fact]
    public void Project_duration_renders_whole_minutes()
    {
        var display = Project(Snapshot(Drive(distanceM: 1000, durationS: 2100)));

        Assert.Equal("Duration", display.Stats[1].Label);
        Assert.Equal("35", display.Stats[1].Value);
        Assert.Equal("min", display.Stats[1].Unit);
    }

    [Fact]
    public void Project_efficiency_is_energy_per_display_distance()
    {
        var display = Project(Snapshot(Drive(distanceM: 42000, durationS: 2100, energyUsedWh: 8400)));

        // 8400 Wh / 42.0 km = 200 Wh/km.
        Assert.Equal(3, display.Stats.Count);
        Assert.Equal("Efficiency", display.Stats[2].Label);
        Assert.Equal("200", display.Stats[2].Value);
        Assert.Equal("Wh/km", display.Stats[2].Unit);
    }

    [Fact]
    public void Project_efficiency_uses_miles_unit_for_imperial()
    {
        var display = Project(
            Snapshot(Drive(distanceM: 16093.44, durationS: 600, energyUsedWh: 2000)),
            units: UnitPref.Imperial);

        // 2000 Wh / 10.0 mi = 200 Wh/mi.
        Assert.Equal("Wh/mi", display.Stats[2].Unit);
        Assert.Equal("200", display.Stats[2].Value);
    }

    [Fact]
    public void Project_omits_efficiency_without_energy()
    {
        var display = Project(Snapshot(Drive(distanceM: 42000, durationS: 2100, energyUsedWh: null)));
        Assert.Equal(2, display.Stats.Count);
    }

    [Fact]
    public void Project_omits_efficiency_with_zero_distance()
    {
        var display = Project(Snapshot(Drive(distanceM: 0, durationS: 600, energyUsedWh: 5000)));
        Assert.Equal(2, display.Stats.Count);
    }

    // ---- Projection: compact / wide gating ----------------------------------------

    [Fact]
    public void Project_compact_at_single_column()
    {
        Assert.True(Project(Snapshot(Drive()), cols: 1, rows: 4).IsCompact);
        Assert.False(Project(Snapshot(Drive()), cols: 2, rows: 4).IsCompact);
    }

    [Fact]
    public void Project_wide_at_three_or_more_columns()
    {
        Assert.False(Project(Snapshot(Drive()), cols: 2, rows: 4).IsWide);
        Assert.True(Project(Snapshot(Drive()), cols: 3, rows: 4).IsWide);
    }

    [Fact]
    public void Project_start_address_badge_only_on_wide()
    {
        Assert.Null(Project(Snapshot(Drive(startAddress: "Berlin")), cols: 2).StartAddress);
        Assert.Equal("Berlin", Project(Snapshot(Drive(startAddress: "Berlin")), cols: 3).StartAddress);
    }

    // ---- Projection: chart normalization ------------------------------------------

    [Fact]
    public void Project_chart_normalizes_left_axis_and_zero_spanning_power()
    {
        var display = Project(Snapshot(
            Drive(distanceM: 1000),
            Sample(speedMps: 20, power: 50, battery: 80),
            Sample(speedMps: 30, power: -10, battery: 78)));

        var chart = display.Chart;
        Assert.True(display.HasChart);
        Assert.Equal(2, chart.Points.Count);

        // Speed is converted to km/h: 20 m/s → 72, 30 m/s → 108.
        Assert.Equal(72.0, chart.Points[0].SpeedDisplay!.Value, 3);
        Assert.Equal(108.0, chart.Points[1].SpeedDisplay!.Value, 3);

        // Left axis domain = [0, dataMax + 10] where dataMax = max(72, 80, 108, 78) = 108 → 118.
        Assert.Equal("118", chart.LeftAxisMaxLabel);
        Assert.Equal(72.0 / 118.0, chart.Points[0].SpeedRatio!.Value, 3);
        Assert.Equal(80.0 / 118.0, chart.Points[0].BatteryRatio!.Value, 3);

        // Power axis spans zero: [-10, 50] → ratio (value − min) / range.
        Assert.Equal("50", chart.PowerAxisMaxLabel);
        Assert.Equal("-10", chart.PowerAxisMinLabel);
        Assert.Equal(1.0, chart.Points[0].PowerRatio!.Value, 3);
        Assert.Equal(0.0, chart.Points[1].PowerRatio!.Value, 3);
    }

    [Fact]
    public void Project_chart_leaves_null_metrics_as_gaps()
    {
        var display = Project(Snapshot(
            Drive(distanceM: 1000),
            Sample(speedMps: null, power: 20, battery: 50),
            Sample(speedMps: 10, power: null, battery: null)));

        Assert.Null(display.Chart.Points[0].SpeedRatio);
        Assert.NotNull(display.Chart.Points[0].PowerRatio);
        Assert.NotNull(display.Chart.Points[0].BatteryRatio);
        Assert.NotNull(display.Chart.Points[1].SpeedRatio);
        Assert.Null(display.Chart.Points[1].PowerRatio);
        Assert.Null(display.Chart.Points[1].BatteryRatio);
    }

    [Fact]
    public void Project_chart_elevation_only_participates_when_wide()
    {
        var snapshot = Snapshot(Drive(distanceM: 1000), Sample(speedMps: 10, elevation: 500));

        Assert.Null(Project(snapshot, cols: 2).Chart.Points[0].ElevationRatio);
        Assert.NotNull(Project(snapshot, cols: 3).Chart.Points[0].ElevationRatio);
    }

    [Fact]
    public void Project_chart_time_label_is_local_hh_mm()
    {
        var at = new DateTimeOffset(2026, 4, 4, 10, 5, 0, TimeSpan.Zero);
        var display = Project(Snapshot(Drive(distanceM: 1000), Sample(speedMps: 10, at: at)));

        Assert.Equal(at.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture), display.Chart.Points[0].TimeLabel);
    }

    [Fact]
    public void Project_without_telemetry_has_no_chart_but_keeps_stats()
    {
        var display = Project(Snapshot(Drive(distanceM: 42000, durationS: 2100)));

        Assert.True(display.HasData);
        Assert.False(display.HasChart);
        Assert.Empty(display.Chart.Points);
        Assert.Equal(2, display.Stats.Count);
    }

    // ---- Projection: legend -------------------------------------------------------

    [Fact]
    public void Project_legend_has_three_series_standard_and_four_wide()
    {
        Assert.Equal(3, Project(Snapshot(Drive()), cols: 2).Legend.Count);

        var wide = Project(Snapshot(Drive()), cols: 3).Legend;
        Assert.Equal(4, wide.Count);
        Assert.Equal("Elevation", wide[3].Label);
    }

    // ---- Empty projection ---------------------------------------------------------

    [Fact]
    public void Empty_projection_has_no_data_and_no_stats()
    {
        var display = DriveTelemetryProjection.Empty(new DriveTelemetrySize(2, 4), Localizer);

        Assert.False(display.HasData);
        Assert.False(display.HasChart);
        Assert.Empty(display.Stats);
    }

    // ---- Accessibility (Narrator names on every surface) --------------------------

    [Fact]
    public void Project_publishes_automation_names_for_every_surface()
    {
        var display = Project(Snapshot(
            Drive(distanceM: 42000, durationS: 2100, energyUsedWh: 8400),
            Sample(speedMps: 20, power: 50, battery: 80)));

        Assert.All(display.Stats, s => Assert.False(string.IsNullOrWhiteSpace(s.AutomationName)));
        Assert.Contains("Distance", display.Stats[0].AutomationName);
        Assert.Contains("km", display.Stats[0].AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(display.CompactAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Chart.AutomationName));
        Assert.Contains("Speed", display.Chart.AutomationName);
    }

    // ---- Result mapper (status preservation) --------------------------------------

    [Fact]
    public void Mapper_preserves_loaded_and_parses_snapshot()
    {
        using var doc = JsonDocument.Parse("""[{"speed":20,"power":40}]""");

        var result = DriveTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), Drive(id: 9, distanceM: 1000));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(9, result.Value!.LatestDrive.Id);
        Assert.Single(result.Value.Telemetry);
    }

    [Fact]
    public void Mapper_empty_telemetry_status_becomes_loaded_with_drive_and_empty_curve()
    {
        // Web parity: the drive is resolved, so an empty telemetry response keeps the stats (Loaded) with no
        // curve — never the whole-surface empty state.
        var result = DriveTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), Drive(id: 5, distanceM: 1000));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(5, result.Value!.LatestDrive.Id);
        Assert.Empty(result.Value.Telemetry);
    }

    [Fact]
    public void Mapper_preserves_freshness_states()
    {
        using var doc = JsonDocument.Parse("""[{"speed":10}]""");
        var drive = Drive(distanceM: 1000);

        Assert.Equal(LoadStatus.Loading, DriveTelemetryResultMapper.Map(RepositoryResult<JsonElement>.Loading(), drive).Status);
        Assert.Equal(LoadStatus.Cached, DriveTelemetryResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: false), drive).Status);
        Assert.Equal(LoadStatus.Refreshing, DriveTelemetryResultMapper.Map(RepositoryResult<JsonElement>.Refreshing(doc.RootElement, Now, stale: true), drive).Status);
        Assert.Equal(LoadStatus.Offline, DriveTelemetryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "x")), drive).Status);
        Assert.Equal(LoadStatus.Error, DriveTelemetryResultMapper.Map(RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), drive).Status);
    }

    // ---- View-model state matrix --------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<DriveTelemetrySnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Snapshot(
            Drive(distanceM: 25000, durationS: 1800, energyUsedWh: 5000),
            Sample(speedMps: 20, power: 40, battery: 70))));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.Equal("25.0", vm.Display.Stats[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_telemetry_keeps_stats_and_no_chart()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Drive(distanceM: 25000, durationS: 1800))));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.False(vm.Display.HasChart);
        Assert.Equal("No telemetry for this drive", vm.NoTelemetryMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<DriveTelemetrySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Empty, vm.State);
        Assert.Equal("No recent drives", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveTelemetrySnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DriveTelemetrySnapshot>.Cached(
            Snapshot(Drive(distanceM: 12000, durationS: 900), Sample(speedMps: 10, power: 20)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<DriveTelemetrySnapshot>.OfflineCached(
            Snapshot(Drive(distanceM: 12000, durationS: 900), Sample(speedMps: 10)), Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<DriveTelemetrySnapshot>.Loading(),
            RepositoryResult<DriveTelemetrySnapshot>.Cached(Snapshot(Drive(distanceM: 4000, durationS: 300)), Now, stale: false),
            RepositoryResult<DriveTelemetrySnapshot>.Loaded(Snapshot(Drive(distanceM: 18000, durationS: 1200)), Now));
        await vm.LoadAsync();

        Assert.Equal(DriveTelemetryState.Loaded, vm.State);
        Assert.Equal("18.0", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(
            new DriveTelemetrySize(2, 4),
            Loaded(Snapshot(Drive(distanceM: 12000, durationS: 900), Sample(speedMps: 10, power: 20))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new DriveTelemetrySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(DriveTelemetryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_distance()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Drive(distanceM: 16093.44, durationS: 600))));
        await vm.LoadAsync();
        Assert.Equal("16.1", vm.Display.Stats[0].Value);
        Assert.Equal("km", vm.Display.Stats[0].Unit);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("10.0", vm.Display.Stats[0].Value);
        Assert.Equal("mi", vm.Display.Stats[0].Unit);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<DriveTelemetrySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Drive Telemetry", vm.Title);
        Assert.Equal("No recent drives", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Drive(distanceM: 12000, durationS: 900), Sample(speedMps: 10))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(DriveTelemetryViewModel.State), changed);
        Assert.Contains(nameof(DriveTelemetryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) ------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("drive-telemetry", DriveTelemetryRegistration.Id);
        Assert.Equal("driving", DriveTelemetryRegistration.Category);
        Assert.Equal("DriveTelemetryWidget", DriveTelemetryRegistration.Slug);
        Assert.Equal(new DriveTelemetrySize(2, 4), DriveTelemetryRegistration.DefaultSize);
        Assert.Equal(new DriveTelemetrySize(2, 4), DriveTelemetryRegistration.MinSize);
        Assert.Equal(new DriveTelemetrySize(4, 40), DriveTelemetryRegistration.MaxSize);
        Assert.Equal("Drive Telemetry", DriveTelemetryRegistration.Name(Localizer));
        Assert.Equal(
            "Last drive replay: speed, power, battery over time with route",
            DriveTelemetryRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]   // min / default
    [InlineData(4, 40, true)]  // max
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 3, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, DriveTelemetryRegistration.IsWithinBounds(new DriveTelemetrySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new DriveTelemetrySize(2, 4), DriveTelemetryRegistration.Clamp(new DriveTelemetrySize(0, 0)));
        Assert.Equal(new DriveTelemetrySize(4, 40), DriveTelemetryRegistration.Clamp(new DriveTelemetrySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) --------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DriveTelemetryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DriveTelemetryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter, drives → latest → telemetry chain) ----------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new DriveTelemetrySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_drives_yields_empty_after_listing()
    {
        using var drives = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement);
        var source = new DriveTelemetrySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drives", request.OperationId);
    }

    [Fact]
    public async Task Source_resolves_primary_then_chains_drives_latest_telemetry()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":11,"start_ts":"2026-04-01T08:00:00Z","distance_m":1000,"duration_s":300},{"id":55,"start_ts":"2026-04-04T10:00:00Z","distance_m":42000,"duration_s":2100}]""");
        using var telemetry = JsonDocument.Parse("""[{"timestamp":"2026-04-04T10:05:00Z","speed":20,"power":48,"battery_level":60}]""");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(telemetry.RootElement);
        var source = new DriveTelemetrySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(55, terminal.Value!.LatestDrive.Id);
        Assert.Equal(42000, terminal.Value.LatestDrive.DistanceM);
        Assert.Single(terminal.Value.Telemetry);

        Assert.Equal(2, api.Requests.Count);

        // 1) drive list scoped by vehicle_id (newest by start_ts → id 55).
        Assert.Equal("get_api_v1_drives", api.Requests[0].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[0].Query!["vehicle_id"], CultureInfo.InvariantCulture));

        // 2) telemetry for the resolved drive id.
        Assert.Equal("get_api_v1_drives_driveID_telemetry", api.Requests[1].OperationId);
        Assert.Equal("55", api.Requests[1].PathParams!["driveID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":9,"start_ts":"2026-04-04T10:00:00Z","distance_m":1000,"duration_s":300}]""");
        using var telemetry = JsonDocument.Parse("[]");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(telemetry.RootElement);
        var source = new DriveTelemetrySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(42L, Convert.ToInt64(api.Requests[0].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_empty_telemetry_yields_loaded_with_drive_and_empty_curve()
    {
        using var drives = JsonDocument.Parse(
            """[{"id":9,"start_ts":"2026-04-04T10:00:00Z","distance_m":1000,"duration_s":300}]""");
        using var telemetry = JsonDocument.Parse("[]");

        var api = new FakeApiClient()
            .ReturnsValue(drives.RootElement)
            .ReturnsValue(telemetry.RootElement);
        var source = new DriveTelemetrySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(9, terminal.Value!.LatestDrive.Id);
        Assert.Empty(terminal.Value.Telemetry);
    }

    [Fact]
    public async Task Source_survives_drive_list_failure_with_empty_surface()
    {
        // drives list throws (best-effort) → no latest drive → empty surface (web latestDrive === null).
        var api = new FakeApiClient().Throws(new InvalidOperationException("drives down"));
        var source = new DriveTelemetrySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers ----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<DriveTelemetrySnapshot>>> Drain(IDriveTelemetrySource source)
    {
        var list = new List<RepositoryResult<DriveTelemetrySnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<DriveTelemetrySnapshot> Loaded(DriveTelemetrySnapshot snapshot) =>
        RepositoryResult<DriveTelemetrySnapshot>.Loaded(snapshot, Now);

    private static DriveTelemetryViewModel NewViewModel(params RepositoryResult<DriveTelemetrySnapshot>[] emissions) =>
        NewViewModel(DriveTelemetrySize.Default, emissions);

    private static DriveTelemetryViewModel NewViewModel(
        DriveTelemetrySize size,
        params RepositoryResult<DriveTelemetrySnapshot>[] emissions) =>
        new(new FakeDriveTelemetrySource(emissions), Localizer, size, UnitPref.Metric, () => Now);

    private sealed class FakeDriveTelemetrySource(params RepositoryResult<DriveTelemetrySnapshot>[] emissions) : IDriveTelemetrySource
    {
        public async IAsyncEnumerable<RepositoryResult<DriveTelemetrySnapshot>> StreamAsync(
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
