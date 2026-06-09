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
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SpeedHeatmapWidget's UI-thread-free logic — the drive-list parse adapter
/// (avg_speed_mps / max_speed_mps / start_ts), the footprint flags (isCompact / isWide), the
/// teal→cyan→amber→red colour ramp, the buildHeatmap projection (local day/hour bucketing, the
/// average-then-convert SI→display speed, the grid maximum, the total/peak derivations, the compact metric,
/// the summary line, the legend, the day/hour tick labels, the per-cell tooltips and the 200-drive cap), the
/// cache-then-network result mapper, the registry metadata, the diagnostics, the per-vehicle source adapter
/// (vehicle resolution + vehicle_id-scoped request + empty short-circuit), and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline + size/units re-projection).
/// Mirrors the web spec (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx + registry/driving.ts).
/// </summary>
public sealed class SpeedHeatmapWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly TimeZoneInfo Utc = TimeZoneInfo.Utc;

    // 2026-06-08 is a Monday and 2026-06-07 a Sunday (guarded in the bucketing tests below).
    private static readonly DateTimeOffset MondayMorning = new(2026, 6, 8, 9, 0, 0, TimeSpan.Zero);

    private static DriveSample Sample(double? avgMps = 25, double? maxMps = 40, DateTimeOffset? start = null) =>
        new(avgMps, maxMps, start ?? MondayMorning);

    private static HeatCellView Cell(SpeedHeatmapDisplay display, int day, int hour) =>
        display.Cells[(day * SpeedHeatmapProjection.Cols) + hour];

    private static SpeedHeatmapDisplay Project(
        UnitPref units, SpeedHeatmapSize size, params DriveSample[] drives) =>
        SpeedHeatmapProjection.Project(drives, size, units, Utc, Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_si_speed_and_start()
    {
        const string json = """
        [
          {"id":1,"vehicle_id":7,"avg_speed_mps":25.0,"max_speed_mps":40.0,"start_ts":"2026-06-08T09:00:00Z"},
          {"id":2,"avg_speed_mps":null,"max_speed_mps":12.5,"start_ts":"2026-06-08T08:00:00Z"}
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = DriveSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(25.0, list[0].AvgSpeedMps);
        Assert.Equal(40.0, list[0].MaxSpeedMps);
        Assert.NotNull(list[0].StartInstant);
        Assert.Null(list[1].AvgSpeedMps);
        Assert.Equal(12.5, list[1].MaxSpeedMps);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":3}]""");

        var drive = Assert.Single(DriveSample.ParseList(doc.RootElement));

        Assert.Null(drive.AvgSpeedMps);
        Assert.Null(drive.MaxSpeedMps);
        Assert.Null(drive.StartInstant);
    }

    [Fact]
    public void ParseList_accepts_numeric_string_values()
    {
        using var doc = JsonDocument.Parse("""[{"avg_speed_mps":"25","max_speed_mps":"40","start_ts":"2026-06-08T09:00:00Z"}]""");

        var drive = Assert.Single(DriveSample.ParseList(doc.RootElement));

        Assert.Equal(25, drive.AvgSpeedMps);
        Assert.Equal(40, drive.MaxSpeedMps);
        Assert.NotNull(drive.StartInstant);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"not":"an array"}""");
        Assert.Empty(DriveSample.ParseList(doc.RootElement));
    }

    // ---- Footprint flags (web isCompact / isWide) ----------------------------------

    [Theory]
    [InlineData(1, 4, true, false)]   // min: 1 col -> compact, not wide
    [InlineData(2, 4, false, false)]  // default: not compact, not wide
    [InlineData(3, 4, false, true)]   // wide
    [InlineData(4, 40, false, true)]  // max -> wide
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new SpeedHeatmapSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Colour ramp (port of speedToColor / COLOR_STOPS) --------------------------

    [Fact]
    public void CellColor_returns_empty_tint_for_non_positive_inputs()
    {
        Assert.Equal(SpeedHeatmapColors.Empty, SpeedHeatmapColors.CellColor(0, 100));
        Assert.Equal(SpeedHeatmapColors.Empty, SpeedHeatmapColors.CellColor(-5, 100));
        Assert.Equal(SpeedHeatmapColors.Empty, SpeedHeatmapColors.CellColor(10, 0));
    }

    [Fact]
    public void CellColor_empty_tint_is_faint_white()
    {
        var empty = SpeedHeatmapColors.Empty;
        Assert.Equal(255, empty.R);
        Assert.Equal(255, empty.G);
        Assert.Equal(255, empty.B);
        Assert.Equal(0.03, empty.Opacity, 3);
    }

    [Fact]
    public void CellColor_at_max_is_the_hot_red_stop()
    {
        var color = SpeedHeatmapColors.CellColor(100, 100);
        Assert.Equal(new HeatColor(239, 68, 68, 1.0), color);
    }

    [Fact]
    public void CellColor_clamps_above_max()
    {
        Assert.Equal(SpeedHeatmapColors.CellColor(100, 100), SpeedHeatmapColors.CellColor(250, 100));
    }

    [Fact]
    public void CellColor_in_range_is_opaque_and_not_the_empty_tint()
    {
        var color = SpeedHeatmapColors.CellColor(50, 100);
        Assert.Equal(1.0, color.Opacity, 3);
        Assert.NotEqual(SpeedHeatmapColors.Empty, color);
    }

    // ---- Projection: bucketing (port of buildHeatmap) ------------------------------

    [Fact]
    public void Project_buckets_drive_by_local_monday_and_hour()
    {
        Assert.Equal(DayOfWeek.Monday, MondayMorning.DayOfWeek); // guard

        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 25, start: MondayMorning));

        // Monday -> day index 0; 09:00 -> hour 9.
        var cell = Cell(display, 0, 9);
        Assert.Equal(1, cell.Count);
        Assert.Equal(1, display.TotalDrives);
    }

    [Fact]
    public void Project_remaps_sunday_to_last_row()
    {
        var sundayNight = new DateTimeOffset(2026, 6, 7, 23, 0, 0, TimeSpan.Zero);
        Assert.Equal(DayOfWeek.Sunday, sundayNight.DayOfWeek); // guard

        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 20, start: sundayNight));

        // Sunday -> day index 6 (web jsDay 0 -> 6); 23:00 -> hour 23.
        Assert.Equal(1, Cell(display, 6, 23).Count);
    }

    [Fact]
    public void Project_uses_avg_speed_then_falls_back_to_max()
    {
        // avg present -> uses avg (25 mps -> 90 km/h).
        var withAvg = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 25, maxMps: 40));
        Assert.Equal(90, Cell(withAvg, 0, 9).AvgSpeed, 0);

        // avg null -> uses max (10 mps -> 36 km/h).
        var withMax = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: null, maxMps: 10));
        Assert.Equal(36, Cell(withMax, 0, 9).AvgSpeed, 0);
    }

    [Fact]
    public void Project_skips_drives_without_positive_speed()
    {
        var display = Project(
            UnitPref.Metric,
            SpeedHeatmapSize.Default,
            Sample(avgMps: 0, maxMps: 0),       // non-positive -> skipped
            Sample(avgMps: null, maxMps: null), // no speed -> skipped
            Sample(avgMps: 25, maxMps: 40));    // valid -> one bucket

        Assert.Equal(1, display.TotalDrives);
    }

    [Fact]
    public void Project_skips_drive_with_no_start_timestamp()
    {
        var noStart = new DriveSample(25, 40, null);
        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, noStart);

        Assert.Equal(0, display.TotalDrives);
        Assert.False(display.HasData);
    }

    [Fact]
    public void Project_averages_in_si_then_converts_once()
    {
        // Two drives in the same bucket at 20 and 30 mps -> SI average 25 mps -> 90 km/h.
        var display = Project(
            UnitPref.Metric,
            SpeedHeatmapSize.Default,
            Sample(avgMps: 20, start: MondayMorning),
            Sample(avgMps: 30, start: MondayMorning));

        var cell = Cell(display, 0, 9);
        Assert.Equal(2, cell.Count);
        Assert.Equal(90, cell.AvgSpeed, 0);
        Assert.Equal(90, display.MaxSpeed, 0);
    }

    [Fact]
    public void Project_converts_to_imperial_speed_unit()
    {
        // 25 mps -> 55.92 mph -> peak "56".
        var display = Project(UnitPref.Imperial, SpeedHeatmapSize.Default, Sample(avgMps: 25));
        Assert.Equal("56", display.PeakValueText);
        Assert.Contains("mph", display.SummaryPeakText, StringComparison.Ordinal);
    }

    // ---- Projection: compact metric (web isCompact branch) -------------------------

    [Fact]
    public void Project_compact_peak_shows_value_with_data()
    {
        var display = Project(UnitPref.Metric, new SpeedHeatmapSize(1, 4), Sample(avgMps: 25));

        Assert.True(display.IsCompact);
        Assert.Equal("90", display.PeakValueText);
        Assert.Equal("Peak km/h", display.PeakUnitCaption);
    }

    [Fact]
    public void Project_compact_peak_shows_em_dash_without_data()
    {
        var display = SpeedHeatmapProjection.Project(
            Array.Empty<DriveSample>(), new SpeedHeatmapSize(1, 4), UnitPref.Metric, Utc, Localizer);

        Assert.Equal("\u2014", display.PeakValueText);
        Assert.False(display.HasData);
    }

    // ---- Projection: summary / labels / legend -------------------------------------

    [Fact]
    public void Project_summary_reports_total_drives_and_peak()
    {
        var display = Project(
            UnitPref.Metric,
            SpeedHeatmapSize.Default,
            Sample(avgMps: 25, start: MondayMorning),
            Sample(avgMps: 25, start: MondayMorning.AddHours(2)));

        Assert.Equal(2, display.TotalDrives);
        Assert.Equal("2 drives", display.SummaryDrivesText);
        Assert.Equal("Peak avg 90 km/h", display.SummaryPeakText);
    }

    [Fact]
    public void Project_legend_has_five_swatches()
    {
        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 25));
        Assert.Equal(5, display.LegendColors.Count);
        Assert.Equal("Slow", display.SlowLabel);
        Assert.Equal("Fast", display.FastLabel);
    }

    [Fact]
    public void Project_labels_are_short_when_narrow_and_full_when_wide()
    {
        var narrow = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample());
        Assert.Equal(new[] { "M", "T", "W", "T", "F", "S", "S" }, narrow.DayLabels);
        Assert.Equal(new[] { 0, 6, 12, 18 }, narrow.HourLabels);

        var wide = Project(UnitPref.Metric, new SpeedHeatmapSize(3, 4), Sample());
        Assert.Equal(new[] { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" }, wide.DayLabels);
        Assert.Equal(new[] { 0, 3, 6, 9, 12, 15, 18, 21 }, wide.HourLabels);
    }

    [Fact]
    public void Project_emits_full_seven_by_twenty_four_grid()
    {
        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample());
        Assert.Equal(SpeedHeatmapProjection.Rows * SpeedHeatmapProjection.Cols, display.Cells.Count);
    }

    [Fact]
    public void Project_caps_at_two_hundred_newest_drives()
    {
        var drives = new List<DriveSample>();
        for (int i = 0; i < 205; i++)
        {
            drives.Add(Sample(avgMps: 25, start: MondayMorning));
        }

        var display = SpeedHeatmapProjection.Project(drives, SpeedHeatmapSize.Default, UnitPref.Metric, Utc, Localizer);

        Assert.Equal(SpeedHeatmapProjection.DriveLimit, display.TotalDrives);
    }

    // ---- Projection: empty gate ----------------------------------------------------

    [Fact]
    public void Project_with_no_drives_has_no_data()
    {
        var display = SpeedHeatmapProjection.Project(
            Array.Empty<DriveSample>(), SpeedHeatmapSize.Default, UnitPref.Metric, Utc, Localizer);

        Assert.False(display.HasData);
        Assert.Equal(0, display.TotalDrives);
        Assert.Equal(0, display.MaxSpeed);
    }

    // ---- Accessibility (label presence; web SVG <title> + metric) ------------------

    [Fact]
    public void Project_data_cell_carries_tooltip_and_automation_name()
    {
        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 25));

        var cell = Cell(display, 0, 9);
        Assert.False(string.IsNullOrWhiteSpace(cell.AutomationName));
        Assert.Equal(cell.Tooltip, cell.AutomationName);
        Assert.Contains("90 km/h", cell.Tooltip, StringComparison.Ordinal);
        Assert.Contains("1 drives", cell.Tooltip, StringComparison.Ordinal);
        Assert.Contains("9:00", cell.Tooltip, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_cell_has_no_data_tooltip_and_no_automation_name()
    {
        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 25));

        // A bucket with no drive (Tuesday 3am) carries the "No data" tooltip and stays out of the Narrator tree.
        var empty = Cell(display, 1, 3);
        Assert.Equal(0, empty.Count);
        Assert.Null(empty.AutomationName);
        Assert.Contains("No data", empty.Tooltip, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_heatmap_and_compact_automation_names_are_populated()
    {
        var display = Project(UnitPref.Metric, SpeedHeatmapSize.Default, Sample(avgMps: 25));

        Assert.Contains("Speed Heatmap", display.HeatmapAutomationName, StringComparison.Ordinal);
        Assert.Contains("Peak avg 90 km/h", display.HeatmapAutomationName, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(display.PeakAutomationName));
        Assert.Contains("90", display.PeakAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"avg_speed_mps":25,"start_ts":"2026-06-08T09:00:00Z"}]""");

        var cached = SpeedHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, MondayMorning, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = SpeedHeatmapResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, MondayMorning, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var rows = JsonDocument.Parse("""[{"avg_speed_mps":25,"start_ts":"2026-06-08T09:00:00Z"}]""");

        Assert.Equal(LoadStatus.Loaded, SpeedHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(rows.RootElement, MondayMorning)).Status);

        Assert.Equal(LoadStatus.Empty, SpeedHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(MondayMorning)).Status);

        Assert.Equal(LoadStatus.Error, SpeedHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveSample>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_grid()
    {
        using var vm = NewViewModel(Loaded(Sample(avgMps: 25)));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.Display.TotalDrives >= 1);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveSample>>.Empty(MondayMorning));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No drive data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_unbucketable_list_collapses_to_empty()
    {
        // A drive with no usable speed never buckets -> totalDrives 0 -> empty (web totalDrives > 0 gate).
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveSample>>.Loaded(new[] { new DriveSample(0, 0, MondayMorning) }, MondayMorning));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Empty, vm.State);
        Assert.False(vm.HasData);
        // Compact metric still renders via the always-populated display.
        Assert.Equal("\u2014", vm.Display.PeakValueText);
    }

    [Fact]
    public async Task ViewModel_failure_flips_error_state()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveSample>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_grid()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveSample>>.Cached(new[] { Sample(avgMps: 25) }, MondayMorning, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(vm.IsError);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_grid()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveSample>>.OfflineCached(
            new[] { Sample(avgMps: 25) }, MondayMorning, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<DriveSample>>.Loading(),
            RepositoryResult<IReadOnlyList<DriveSample>>.Cached(new[] { Sample(avgMps: 25) }, MondayMorning, stale: false),
            RepositoryResult<IReadOnlyList<DriveSample>>.Loaded(new[] { Sample(avgMps: 25), Sample(avgMps: 30) }, MondayMorning));
        await vm.LoadAsync();

        Assert.Equal(SpeedHeatmapState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.TotalDrives);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_flag()
    {
        using var vm = NewViewModel(new SpeedHeatmapSize(2, 4), Loaded(Sample(avgMps: 25)));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new SpeedHeatmapSize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(SpeedHeatmapState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_peak()
    {
        using var vm = NewViewModel(Loaded(Sample(avgMps: 25)));
        await vm.LoadAsync();
        Assert.Equal("90", vm.Display.PeakValueText); // 25 mps -> 90 km/h

        vm.Units = UnitPref.Imperial;
        Assert.Equal("56", vm.Display.PeakValueText);  // 25 mps -> 56 mph
        Assert.Equal(SpeedHeatmapState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<DriveSample>>.Empty(MondayMorning));
        await vm.LoadAsync();

        Assert.Equal("Speed Heatmap", vm.Title);
        Assert.Equal("No drive data yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample(avgMps: 25)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SpeedHeatmapViewModel.State), changed);
        Assert.Contains(nameof(SpeedHeatmapViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("speed-heatmap", SpeedHeatmapRegistration.Id);
        Assert.Equal("driving", SpeedHeatmapRegistration.Category);
        Assert.Equal("SpeedHeatmapWidget", SpeedHeatmapRegistration.Slug);
        Assert.Equal(new SpeedHeatmapSize(2, 4), SpeedHeatmapRegistration.DefaultSize);
        Assert.Equal(new SpeedHeatmapSize(1, 4), SpeedHeatmapRegistration.MinSize);
        Assert.Equal(new SpeedHeatmapSize(4, 40), SpeedHeatmapRegistration.MaxSize);
        Assert.Equal("Speed Heatmap", SpeedHeatmapRegistration.Name(Localizer));
        Assert.Contains("time-of-day", SpeedHeatmapRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_matches_the_registration() =>
        Assert.Equal("speed-heatmap", SpeedHeatmapRegistration.Id);

    [Theory]
    [InlineData(1, 4, true)]   // min
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 3, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SpeedHeatmapRegistration.IsWithinBounds(new SpeedHeatmapSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SpeedHeatmapSize(1, 4), SpeedHeatmapRegistration.Clamp(new SpeedHeatmapSize(0, 0)));
        Assert.Equal(new SpeedHeatmapSize(4, 40), SpeedHeatmapRegistration.Clamp(new SpeedHeatmapSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedHeatmapDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SpeedHeatmapWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SpeedHeatmapSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_drives_scoped_by_vehicle()
    {
        using var drives = JsonDocument.Parse(
            """[{"avg_speed_mps":25,"max_speed_mps":40,"start_ts":"2026-06-08T09:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement);
        var source = new SpeedHeatmapSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Single(terminal.Value!);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_drives", request.OperationId);
        var query = Assert.Single(request.Query!);
        Assert.Equal("vehicle_id", query.Key); // the generated endpoint declares only vehicle_id (no limit)
        Assert.Equal(7L, Assert.IsType<long>(query.Value));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var drives = JsonDocument.Parse("""[{"avg_speed_mps":25,"start_ts":"2026-06-08T09:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(drives.RootElement);
        var source = new SpeedHeatmapSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(Assert.Single(api.Requests).Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_collapses_to_empty()
    {
        using var empty = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(empty.RootElement);
        var source = new SpeedHeatmapSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public void Source_operation_resolves_against_the_generated_endpoint_table()
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(e => e.OperationId == "get_api_v1_drives");

        Assert.True(descriptor is not null, "Operation 'get_api_v1_drives' is not in the generated endpoint table.");
        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => MondayMorning);

    private static async Task<List<RepositoryResult<IReadOnlyList<DriveSample>>>> Drain(ISpeedHeatmapSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<DriveSample>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<DriveSample>> Loaded(params DriveSample[] drives) =>
        RepositoryResult<IReadOnlyList<DriveSample>>.Loaded(drives, MondayMorning);

    private static SpeedHeatmapViewModel NewViewModel(params RepositoryResult<IReadOnlyList<DriveSample>>[] emissions) =>
        NewViewModel(SpeedHeatmapSize.Default, emissions);

    private static SpeedHeatmapViewModel NewViewModel(
        SpeedHeatmapSize size,
        params RepositoryResult<IReadOnlyList<DriveSample>>[] emissions) =>
        new(new FakeSpeedHeatmapSource(emissions), Localizer, size, UnitPref.Metric, Utc);

    private sealed class FakeSpeedHeatmapSource(params RepositoryResult<IReadOnlyList<DriveSample>>[] emissions)
        : ISpeedHeatmapSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveSample>>> StreamAsync(
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
