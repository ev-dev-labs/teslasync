using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
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
/// Headless verification of the TirePressureHistoryWidget's UI-thread-free logic — the JSON parse adapter
/// (the useTirePressureHistory read), the SI-kilopascal → display-unit conversion, the chronological sort,
/// the timestamp-drop filter, the connectNulls gap handling across four corner series, the latest-value /
/// hasData projection, the recommended-range Min/Max reference-line visibility, the result mapper, the
/// per-vehicle data source (primary resolution + the query-scoped read against
/// <c>get_api_v1_tire_pressure</c>), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx).
/// </summary>
public sealed class TirePressureHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string T0 = "2026-06-06T10:00:00Z";
    private const string T1 = "2026-06-06T11:00:00Z";
    private const string T2 = "2026-06-06T12:00:00Z";

    // Recommended range in display psi (240/280 kPa converted with KpaPerPsi = 6.894757).
    private const double RecommendedLowPsi = 240.0 / 6.894757;
    private const double RecommendedHighPsi = 280.0 / 6.894757;

    private static TirePressureSample Sample(
        string? ts, double? fl = null, double? fr = null, double? rl = null, double? rr = null) =>
        new(ts, fl, fr, rl, rr);

    private static IReadOnlyList<TirePressureSample> Samples(params TirePressureSample[] rows) => rows;

    private static TirePressureHistoryDisplay Project(
        IReadOnlyList<TirePressureSample> samples, int cols, int rows, UnitPref? units = null) =>
        TirePressureHistoryProjection.Project(samples, new TirePressureHistorySize(cols, rows), units ?? UnitPref.Metric, Localizer);

    // ---- Parse adapter (web useTirePressureHistory read) ---------------------------

    [Fact]
    public void FromJson_reads_timestamp_and_all_four_corners()
    {
        using var doc = JsonDocument.Parse(
            """{"created_at":"2026-06-06T12:00:00Z","front_left":240,"front_right":242,"rear_left":250,"rear_right":252,"id":1}""");

        var sample = TirePressureSample.FromJson(doc.RootElement);

        Assert.Equal("2026-06-06T12:00:00Z", sample.TimestampRaw);
        Assert.Equal(240, sample.FrontLeftKpa);
        Assert.Equal(242, sample.FrontRightKpa);
        Assert.Equal(250, sample.RearLeftKpa);
        Assert.Equal(252, sample.RearRightKpa);
    }

    [Fact]
    public void FromJson_resolves_timestamp_created_at_then_ts_then_timestamp()
    {
        // created_at wins.
        using var both = JsonDocument.Parse("""{"created_at":"c","ts":"t","timestamp":"x"}""");
        Assert.Equal("c", TirePressureSample.FromJson(both.RootElement).TimestampRaw);

        // ts is the backend List handler's other timestamp key (row["ts"] = ts).
        using var tsOnly = JsonDocument.Parse("""{"ts":"t","timestamp":"x"}""");
        Assert.Equal("t", TirePressureSample.FromJson(tsOnly.RootElement).TimestampRaw);

        // timestamp is the web type's declared field — the last-resort fallback.
        using var timestampOnly = JsonDocument.Parse("""{"timestamp":"x"}""");
        Assert.Equal("x", TirePressureSample.FromJson(timestampOnly.RootElement).TimestampRaw);

        // empty created_at falls through to ts.
        using var empty = JsonDocument.Parse("""{"created_at":"","ts":"t"}""");
        Assert.Equal("t", TirePressureSample.FromJson(empty.RootElement).TimestampRaw);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"2026-06-06T10:00:00Z"}""");

        var sample = TirePressureSample.FromJson(doc.RootElement);

        Assert.Equal("2026-06-06T10:00:00Z", sample.TimestampRaw);
        Assert.Null(sample.FrontLeftKpa);
        Assert.Null(sample.FrontRightKpa);
        Assert.Null(sample.RearLeftKpa);
        Assert.Null(sample.RearRightKpa);
    }

    [Fact]
    public void FromJson_treats_explicit_null_and_no_timestamp_as_null()
    {
        using var doc = JsonDocument.Parse("""{"front_left":null,"rear_right":null}""");

        var sample = TirePressureSample.FromJson(doc.RootElement);

        // Web parity: d.frontLeft != null — a JSON null reads as "no value" → a gap.
        Assert.Null(sample.TimestampRaw);
        Assert.Null(sample.FrontLeftKpa);
        Assert.Null(sample.RearRightKpa);
    }

    [Fact]
    public void FromJson_parses_numeric_string_pressures()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"t","front_left":"240.5","rear_left":"250"}""");

        var sample = TirePressureSample.FromJson(doc.RootElement);

        Assert.Equal(240.5, sample.FrontLeftKpa);
        Assert.Equal(250, sample.RearLeftKpa);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """[{"created_at":"a","front_left":1}, 7, {"created_at":"b","front_left":2}]""");

        var list = TirePressureSample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].FrontLeftKpa);
        Assert.Equal(2, list[1].FrontLeftKpa);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"front_left":1}""");
        Assert.Empty(TirePressureSample.ParseList(doc.RootElement));
    }

    // ---- Projection: conversion / order --------------------------------------------

    [Fact]
    public void Project_sorts_chronologically_and_keeps_si_kpa_in_metric()
    {
        // Supplied out of order; the projection sorts by the timestamp string.
        var view = Project(Samples(Sample(T2, 245, 246, 255, 256), Sample(T0, 240, 241, 250, 251)), 2, 4);

        Assert.True(view.HasData);
        Assert.Equal(new[] { new ChartPoint(0, 240), new ChartPoint(1, 245) }, view.FrontLeftPoints);
        Assert.Equal(new[] { new ChartPoint(0, 251), new ChartPoint(1, 256) }, view.RearRightPoints);
    }

    [Fact]
    public void Project_converts_to_psi_under_imperial()
    {
        // 240 kPa → 34.8 psi, 250 kPa → 36.3 psi.
        var view = Project(Samples(Sample(T0, 240, null, 250, null)), 2, 4, UnitPref.Imperial);

        Assert.Equal("34.8", view.Stats[0].Value);
        Assert.Equal("psi", view.Stats[0].Unit);
        Assert.Equal("36.3", view.Stats[2].Value);

        var fl = Assert.Single(view.FrontLeftPoints);
        Assert.Equal(240.0 / 6.894757, fl.Y, 6);
    }

    [Fact]
    public void Project_drops_rows_without_a_timestamp()
    {
        var view = Project(Samples(Sample(T0, 240, 241, 250, 251), Sample(null, 99, 99, 99, 99), Sample("", 88, 88, 88, 88)), 2, 4);

        // Only the single timestamped row survives.
        Assert.Single(view.FrontLeftPoints);
        Assert.Equal(new ChartPoint(0, 240), view.FrontLeftPoints[0]);
    }

    // ---- Projection: connectNulls (gaps skipped, shared ordinal X) -----------------

    [Fact]
    public void Project_skips_null_points_per_series_on_a_shared_index()
    {
        // index 0: FL only, index 1: FR only, index 2: all four.
        var view = Project(
            Samples(
                Sample(T0, fl: 240),
                Sample(T1, fr: 242),
                Sample(T2, fl: 244, fr: 246, rl: 256, rr: 258)),
            2, 4);

        Assert.Equal(new[] { new ChartPoint(0, 240), new ChartPoint(2, 244) }, view.FrontLeftPoints);
        Assert.Equal(new[] { new ChartPoint(1, 242), new ChartPoint(2, 246) }, view.FrontRightPoints);
        Assert.Equal(new[] { new ChartPoint(2, 256) }, view.RearLeftPoints);
        Assert.Equal(new[] { new ChartPoint(2, 258) }, view.RearRightPoints);
    }

    // ---- Projection: hasData gate (web hasData = chartData.length > 0) --------------

    [Fact]
    public void Project_hasData_false_when_no_samples()
    {
        var view = Project(Samples(), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Empty(view.FrontLeftPoints);
        Assert.False(view.ShowRecommendedLow);
        Assert.False(view.ShowRecommendedHigh);
    }

    [Fact]
    public void Project_hasData_false_when_no_row_has_a_timestamp()
    {
        var view = Project(Samples(Sample(null, 240, 241, 250, 251), Sample("", 242, 243, 252, 253)), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
    }

    [Fact]
    public void Project_hasData_true_with_a_single_timestamped_row()
    {
        Assert.True(Project(Samples(Sample(T0, 240, 241, 250, 251)), 2, 4).HasData);
    }

    // ---- Projection: stats (latest value, em dash, rounding) -----------------------

    [Fact]
    public void Project_builds_four_corner_latest_stats()
    {
        var view = Project(
            Samples(
                Sample(T0, 230, 231, 240, 241),
                Sample(T1, 235, 236, 245, 246),
                Sample(T2, 240, 242, 250, 252)),
            2, 4);

        Assert.Equal(4, view.Stats.Count);
        Assert.Equal("FL", view.Stats[0].Label);
        Assert.Equal("240.0", view.Stats[0].Value); // latest FL
        Assert.Equal("kPa", view.Stats[0].Unit);
        Assert.Equal("FR", view.Stats[1].Label);
        Assert.Equal("242.0", view.Stats[1].Value);
        Assert.Equal("RL", view.Stats[2].Label);
        Assert.Equal("250.0", view.Stats[2].Value);
        Assert.Equal("RR", view.Stats[3].Label);
        Assert.Equal("252.0", view.Stats[3].Value);
    }

    [Fact]
    public void Project_latest_stat_rounds_to_one_decimal()
    {
        var view = Project(Samples(Sample(T0, 240.46, 241.93, 250.12, 251.61)), 2, 4);

        Assert.Equal("240.5", view.Stats[0].Value);
        Assert.Equal("241.9", view.Stats[1].Value);
        Assert.Equal("250.1", view.Stats[2].Value);
        Assert.Equal("251.6", view.Stats[3].Value);
    }

    [Fact]
    public void Project_em_dashes_a_corner_with_no_readings()
    {
        // Timestamped row but FL absent → FL stat shows the em dash, the others show values.
        var view = Project(Samples(Sample(T0, fl: null, fr: 242, rl: 250, rr: 252)), 2, 4);

        Assert.True(view.HasData);
        Assert.Equal("\u2014", view.Stats[0].Value);
        Assert.Empty(view.FrontLeftPoints);
        Assert.Equal("242.0", view.Stats[1].Value);
    }

    // ---- Projection: recommended-range reference lines -----------------------------

    [Fact]
    public void Project_recommended_range_is_si_240_280_kpa_in_metric()
    {
        var view = Project(Samples(Sample(T0, 230, 250, 270, 290)), 2, 4);

        Assert.Equal(240.0, view.RecommendedLowDisplay);
        Assert.Equal(280.0, view.RecommendedHighDisplay);
    }

    [Fact]
    public void Project_recommended_range_converts_to_psi_under_imperial()
    {
        var view = Project(Samples(Sample(T0, 230, 250, 270, 290)), 2, 4, UnitPref.Imperial);

        Assert.Equal(RecommendedLowPsi, view.RecommendedLowDisplay, 6);
        Assert.Equal(RecommendedHighPsi, view.RecommendedHighDisplay, 6);
    }

    [Fact]
    public void Project_shows_recommended_lines_when_inside_the_data_domain()
    {
        // Domain spans 230..290 kPa, so both 240 (Min) and 280 (Max) fall inside.
        var view = Project(Samples(Sample(T0, 230, 250, 270, 290)), 2, 4);

        Assert.True(view.ShowRecommendedLow);
        Assert.True(view.ShowRecommendedHigh);
        Assert.Equal("Min", view.MinLabel);
        Assert.Equal("Max", view.MaxLabel);
    }

    [Fact]
    public void Project_discards_recommended_lines_outside_the_data_domain()
    {
        // Domain spans 250..260 kPa — 240 (Min) is below it and 280 (Max) above it; both discarded
        // (web Recharts ifOverflow="discard" parity).
        var view = Project(Samples(Sample(T0, 250, 255, 258, 260)), 2, 4);

        Assert.False(view.ShowRecommendedLow);
        Assert.False(view.ShowRecommendedHigh);
    }

    [Fact]
    public void Project_recommended_lines_visible_at_exact_domain_boundary()
    {
        // Domain spans exactly 240..280 kPa — both reference lines sit on the boundary (inclusive).
        var view = Project(Samples(Sample(T0, 240, 280, 250, 260)), 2, 4);

        Assert.True(view.ShowRecommendedLow);
        Assert.True(view.ShowRecommendedHigh);
    }

    [Fact]
    public void Project_recommended_lines_hidden_when_no_corner_has_a_reading()
    {
        // Timestamped row but every corner absent → no plotted points, no domain → no reference lines.
        var view = Project(Samples(Sample(T0)), 2, 4);

        Assert.True(view.HasData);
        Assert.False(view.ShowRecommendedLow);
        Assert.False(view.ShowRecommendedHigh);
    }

    // ---- Projection: layout + series identity --------------------------------------

    [Fact]
    public void Project_compact_flag_tracks_single_column()
    {
        Assert.True(Project(Samples(Sample(T0, 240, 241, 250, 251)), 1, 4).IsCompact);
        Assert.False(Project(Samples(Sample(T0, 240, 241, 250, 251)), 2, 4).IsCompact);
    }

    [Fact]
    public void Project_series_names_are_localized()
    {
        var view = Project(Samples(Sample(T0, 240, 241, 250, 251)), 2, 4);

        Assert.Equal("FL", view.FrontLeftSeriesName);
        Assert.Equal("FR", view.FrontRightSeriesName);
        Assert.Equal("RL", view.RearLeftSeriesName);
        Assert.Equal("RR", view.RearRightSeriesName);
    }

    // ---- Accessibility (Narrator name) ---------------------------------------------

    [Fact]
    public void Project_compact_automation_name_combines_stats()
    {
        var view = Project(Samples(Sample(T0, 240, 242, 250, 252)), 1, 4);

        Assert.Equal("FL: 240.0 kPa, FR: 242.0 kPa, RL: 250.0 kPa, RR: 252.0 kPa", view.CompactAutomationName);
    }

    [Fact]
    public void Project_automation_name_handles_em_dash_without_unit()
    {
        var view = Project(Samples(Sample(T0, fl: null, fr: 242, rl: 250, rr: 252)), 1, 4);

        Assert.Equal("FL: \u2014, FR: 242.0 kPa, RL: 250.0 kPa, RR: 252.0 kPa", view.CompactAutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_rows()
    {
        using var doc = JsonDocument.Parse("""[{"created_at":"t","front_left":240,"rear_right":252}]""");

        var cached = TirePressureHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(240, Assert.Single(cached.Value!).FrontLeftKpa);

        var offline = TirePressureHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(252, Assert.Single(offline.Value!).RearRightKpa);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""[{"created_at":"t","front_left":240}]""");

        Assert.Equal(LoadStatus.Loaded, TirePressureHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, TirePressureHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, TirePressureHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_chart_display()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(T0, 240, 241, 250, 251), Sample(T1, 244, 245, 254, 255))));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(2, vm.Display.FrontLeftPoints.Count);
        Assert.Equal("244.0", vm.Display.Stats[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Empty, vm.State);
        Assert.False(vm.Display.HasData);
        Assert.Equal("No tire pressure history", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_untimestamped_rows_render_empty()
    {
        // Web parity: WidgetChartSummary isEmpty — a populated list with no chartable row → empty surface.
        using var vm = NewViewModel(Loaded(Samples(Sample(null, 240, 241, 250, 251))));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Cached(Samples(Sample(T0, 240, 241, 250, 251)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.OfflineCached(
            Samples(Sample(T0, 240, 241, 250, 251)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Loading(),
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Cached(Samples(Sample(T0, 238, 239, 248, 249)), Now, stale: false),
            RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(Samples(Sample(T0, 240, 241, 250, 251), Sample(T1, 244, 245, 254, 255)), Now));
        await vm.LoadAsync();

        Assert.Equal(TirePressureHistoryState.Loaded, vm.State);
        Assert.Equal("244.0", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_pressures()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(T0, 240, 241, 250, 251))));
        await vm.LoadAsync();
        Assert.Equal("240.0", vm.Display.Stats[0].Value);
        Assert.Equal("kPa", vm.Display.Stats[0].Unit);

        vm.Units = UnitPref.Imperial; // 240 kPa → 34.8 psi
        Assert.Equal("34.8", vm.Display.Stats[0].Value);
        Assert.Equal("psi", vm.Display.Stats[0].Unit);
        Assert.Equal(TirePressureHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new TirePressureHistorySize(2, 4), Loaded(Samples(Sample(T0, 240, 241, 250, 251))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new TirePressureHistorySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(TirePressureHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<TirePressureSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Tire Pressure History", vm.Title);
        Assert.Equal("No tire pressure history", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Samples(Sample(T0, 240, 241, 250, 251), Sample(T1, 244, 245, 254, 255))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(TirePressureHistoryViewModel.State), changed);
        Assert.Contains(nameof(TirePressureHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("tire-pressure-history", TirePressureHistoryRegistration.Id);
        Assert.Equal("tires", TirePressureHistoryRegistration.Category);
        Assert.Equal("TirePressureHistoryWidget", TirePressureHistoryRegistration.Slug);
        Assert.Equal(new TirePressureHistorySize(2, 4), TirePressureHistoryRegistration.DefaultSize);
        Assert.Equal(new TirePressureHistorySize(2, 4), TirePressureHistoryRegistration.MinSize);
        Assert.Equal(new TirePressureHistorySize(4, 40), TirePressureHistoryRegistration.MaxSize);
        Assert.Equal("Tire Pressure History", TirePressureHistoryRegistration.Name(Localizer));
        Assert.Equal("Pressure trends for all 4 tires over time with recommended range", TirePressureHistoryRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(5, 40, false)]  // above max cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, TirePressureHistoryRegistration.IsWithinBounds(new TirePressureHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new TirePressureHistorySize(2, 4), TirePressureHistoryRegistration.Clamp(new TirePressureHistorySize(0, 0)));
        Assert.Equal(new TirePressureHistorySize(4, 40), TirePressureHistoryRegistration.Clamp(new TirePressureHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TirePressureHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TirePressureHistoryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public void Source_operation_resolves_against_generated_endpoint_table()
    {
        // The inlined operation id must be a real generated endpoint (GET /api/v1/tire-pressure).
        Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == "get_api_v1_tire_pressure");
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new TirePressureHistorySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_tire_pressure()
    {
        using var doc = JsonDocument.Parse(
            """[{"created_at":"2026-06-06T11:00:00Z","front_left":240,"rear_right":252},{"created_at":"2026-06-06T12:00:00Z","front_left":242,"rear_right":254}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new TirePressureHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_tire_pressure", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"created_at":"t","front_left":240}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new TirePressureHistorySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Convert.ToInt64(api.Requests[^1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new TirePressureHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<TirePressureSample>>>> Drain(ITirePressureHistorySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<TirePressureSample>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<TirePressureSample>> Loaded(IReadOnlyList<TirePressureSample> samples) =>
        RepositoryResult<IReadOnlyList<TirePressureSample>>.Loaded(samples, Now);

    private static TirePressureHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<TirePressureSample>>[] emissions) =>
        NewViewModel(TirePressureHistorySize.Default, emissions);

    private static TirePressureHistoryViewModel NewViewModel(
        TirePressureHistorySize size,
        params RepositoryResult<IReadOnlyList<TirePressureSample>>[] emissions) =>
        new(new FakeTirePressureHistorySource(emissions), Localizer, size);

    private sealed class FakeTirePressureHistorySource(params RepositoryResult<IReadOnlyList<TirePressureSample>>[] emissions) : ITirePressureHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TirePressureSample>>> StreamAsync(
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
