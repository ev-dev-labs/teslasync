using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the CostHeatmap's UI-thread-free logic — the charging-optimizer JSON parse
/// adapter (weekly_heatmap + cost_analysis.peak_cost_per_kwh), the cost-intensity colour maths (ported from
/// the web inline rgba formula), the projection (dense 7×24 grid, sparse hour labels, localized day labels,
/// legend swatches, tooltips, accessibility), the cache-then-network result mapper, the registration
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-list/CostHeatmap.tsx).
/// </summary>
public sealed class CostHeatmapTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void Entry_FromJson_reads_fields()
    {
        const string json = """
        { "day": 1, "hour": 14, "sessions": 3, "avg_cost_per_kwh": 0.3 }
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = CostHeatmapEntry.FromJson(doc.RootElement);

        Assert.Equal(1, entry.Day);
        Assert.Equal(14, entry.Hour);
        Assert.Equal(3, entry.Sessions);
        Assert.Equal(0.3, entry.AvgCostPerKwh, 6);
    }

    [Fact]
    public void Report_FromJson_reads_entries_and_peak()
    {
        const string json = """
        {
          "cost_analysis": { "peak_cost_per_kwh": 0.42 },
          "weekly_heatmap": [
            { "day": 0, "hour": 0, "sessions": 1, "avg_cost_per_kwh": 0.1 },
            { "day": 6, "hour": 23, "sessions": 2, "avg_cost_per_kwh": 0.2 }
          ]
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var report = CostHeatmapReport.FromJson(doc.RootElement);

        Assert.True(report.HasData);
        Assert.Equal(2, report.Entries.Count);
        Assert.Equal(0.42, report.PeakCostPerKwh, 6);
        Assert.Equal(6, report.Entries[1].Day);
        Assert.Equal(23, report.Entries[1].Hour);
    }

    [Fact]
    public void Report_FromJson_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""
        { "weekly_heatmap": [ { "day": "2", "hour": "9" } ] }
        """);

        var report = CostHeatmapReport.FromJson(doc.RootElement);

        Assert.Single(report.Entries);
        Assert.Equal(2, report.Entries[0].Day);
        Assert.Equal(9, report.Entries[0].Hour);
        Assert.Equal(0, report.Entries[0].Sessions);
        Assert.Equal(0, report.Entries[0].AvgCostPerKwh);
        Assert.Equal(0, report.PeakCostPerKwh); // no cost_analysis -> 0
    }

    [Fact]
    public void Report_FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[ 1, 2, 3 ]");
        var report = CostHeatmapReport.FromJson(doc.RootElement);

        Assert.False(report.HasData);
        Assert.Empty(report.Entries);
    }

    [Fact]
    public void Report_FromJson_empty_weekly_heatmap_has_no_data()
    {
        using var doc = JsonDocument.Parse("""{ "weekly_heatmap": [] }""");
        var report = CostHeatmapReport.FromJson(doc.RootElement);

        Assert.False(report.HasData);
        Assert.Empty(report.Entries);
    }

    // ---- Colour maths (web inline rgba formula) ------------------------------------

    [Fact]
    public void ForCell_full_intensity_is_red_with_session_alpha()
    {
        var c = HeatColor.ForCell(intensity: 1.0, sessions: 3);

        Assert.Equal(239, c.R);
        Assert.Equal(0, c.G);
        Assert.Equal(0, c.B);
        Assert.Equal(0.51, c.Alpha, 5); // min(0.9, 0.15 + 3*0.12)
    }

    [Fact]
    public void ForCell_zero_intensity_is_warm()
    {
        var c = HeatColor.ForCell(intensity: 0.0, sessions: 1);

        Assert.Equal(0, c.R);
        Assert.Equal(187, c.G);
        Assert.Equal(100, c.B);
        Assert.Equal(0.27, c.Alpha, 5);
    }

    [Fact]
    public void ForCell_no_sessions_is_empty_wash()
    {
        var c = HeatColor.ForCell(intensity: 1.0, sessions: 0);

        Assert.Equal(255, c.R);
        Assert.Equal(255, c.G);
        Assert.Equal(255, c.B);
        Assert.Equal(0.02, c.Alpha, 5);
    }

    [Fact]
    public void ForCell_alpha_clamped_at_point_nine()
    {
        var c = HeatColor.ForCell(intensity: 0.0, sessions: 10); // 0.15 + 1.2 -> clamp 0.9
        Assert.Equal(0.9, c.Alpha, 5);
    }

    [Theory]
    [InlineData(0.15, 36, 159, 85)]
    [InlineData(0.9, 215, 19, 10)]
    public void ForLegend_matches_web_formula(double opacity, int r, int g, int b)
    {
        var c = HeatColor.ForLegend(opacity);

        Assert.Equal((byte)r, c.R);
        Assert.Equal((byte)g, c.G);
        Assert.Equal((byte)b, c.B);
        Assert.Equal(0.6, c.Alpha, 5);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_dense_7x24_grid()
    {
        var view = CostHeatmapProjection.Project(Report(), Localizer);

        Assert.Equal(CostHeatmapProjection.Days, view.Rows.Count);
        Assert.All(view.Rows, r => Assert.Equal(CostHeatmapProjection.Hours, r.Cells.Count));
        Assert.Equal(CostHeatmapProjection.Hours, view.HourLabels.Count);
    }

    [Fact]
    public void Project_hour_labels_only_every_third_column()
    {
        var view = CostHeatmapProjection.Project(Report(), Localizer);

        Assert.Equal("0", view.HourLabels[0]);
        Assert.Equal(string.Empty, view.HourLabels[1]);
        Assert.Equal(string.Empty, view.HourLabels[2]);
        Assert.Equal("3", view.HourLabels[3]);
        Assert.Equal("21", view.HourLabels[21]);
        Assert.Equal(string.Empty, view.HourLabels[23]);
    }

    [Fact]
    public void Project_day_labels_are_localized_sun_to_sat()
    {
        var view = CostHeatmapProjection.Project(Report(), Localizer);

        Assert.Equal(new[] { "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" }, view.Rows.Select(r => r.DayLabel));
        Assert.Equal(0, view.Rows[0].DayIndex);
        Assert.Equal(6, view.Rows[6].DayIndex);
    }

    [Fact]
    public void Project_maxCost_falls_back_to_default_when_peak_zero()
    {
        var view = CostHeatmapProjection.Project(Report(peak: 0), Localizer);
        Assert.Equal(CostHeatmapProjection.DefaultMaxCost, view.MaxCost, 6);
    }

    [Fact]
    public void Project_maxCost_uses_peak_when_present()
    {
        var view = CostHeatmapProjection.Project(Report(peak: 0.55), Localizer);
        Assert.Equal(0.55, view.MaxCost, 6);
    }

    [Fact]
    public void Project_cell_fill_and_intensity_for_known_entry()
    {
        var report = Report(peak: 0.30, Entry(day: 1, hour: 14, sessions: 3, cost: 0.30));
        var view = CostHeatmapProjection.Project(report, Localizer);

        var cell = view.Rows[1].Cells[14];
        Assert.Equal(3, cell.Sessions);
        Assert.Equal(0.30, cell.Cost, 6);
        Assert.Equal(1.0, cell.Intensity, 6); // cost / maxCost = 1
        Assert.True(cell.HasSessions);
        Assert.Equal(239, cell.Fill.R);
        Assert.Equal(0, cell.Fill.G);
        Assert.Equal(0, cell.Fill.B);
        Assert.Equal(0.51, cell.Fill.Alpha, 5);
    }

    [Fact]
    public void Project_intensity_is_clamped_to_one()
    {
        var report = Report(peak: 0.30, Entry(day: 2, hour: 8, sessions: 1, cost: 0.60));
        var view = CostHeatmapProjection.Project(report, Localizer);

        Assert.Equal(1.0, view.Rows[2].Cells[8].Intensity, 6); // min(1, 0.6/0.3)
    }

    [Fact]
    public void Project_tooltip_includes_day_hour_sessions_and_cost()
    {
        var report = Report(peak: 0.30, Entry(day: 1, hour: 14, sessions: 3, cost: 0.30));
        var view = CostHeatmapProjection.Project(report, Localizer);

        Assert.Equal("Mon 14:00 \u2014 3 sessions, $0.300/kWh", view.Rows[1].Cells[14].Tooltip);
    }

    [Fact]
    public void Project_tooltip_without_sessions_is_day_and_hour_only()
    {
        var view = CostHeatmapProjection.Project(Report(), Localizer);
        Assert.Equal("Sun 5:00", view.Rows[0].Cells[5].Tooltip);
    }

    [Fact]
    public void Project_legend_has_five_swatches()
    {
        var view = CostHeatmapProjection.Project(Report(), Localizer);

        Assert.Equal(5, view.LegendSwatches.Count);
        Assert.Equal(36, view.LegendSwatches[0].R); // first stop 0.15
        Assert.Equal(215, view.LegendSwatches[4].R); // last stop 0.9
    }

    [Fact]
    public void Project_hasData_tracks_entries()
    {
        Assert.False(CostHeatmapProjection.Project(Report(), Localizer).HasData);
        Assert.True(CostHeatmapProjection.Project(Report(peak: 0.3, Entry(0, 0, 1, 0.1)), Localizer).HasData);
    }

    [Fact]
    public void Project_first_entry_wins_for_duplicate_coordinate()
    {
        var report = Report(
            peak: 0.30,
            Entry(day: 0, hour: 0, sessions: 5, cost: 0.10),
            Entry(day: 0, hour: 0, sessions: 9, cost: 0.20));
        var view = CostHeatmapProjection.Project(report, Localizer);

        Assert.Equal(5, view.Rows[0].Cells[0].Sessions); // Array.find semantics: first match wins
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = CostHeatmapProjection.Project(
            Report(peak: 0.3, Entry(day: 1, hour: 2, sessions: 1, cost: 0.1)), echo);

        Assert.Equal("L:charging.optimizer.heatmap", view.Title);
        Assert.Equal("L:charging.optimizer.cheap", view.CheapLabel);
        Assert.Equal("L:charging.optimizer.expensive", view.ExpensiveLabel);
        Assert.Equal("L:common.noData", view.EmptyMessage);
        Assert.Equal("L:quietHours.weekday.sun", view.Rows[0].DayLabel);
        Assert.Equal("L:quietHours.weekday.sat", view.Rows[6].DayLabel);
        // The tooltip's "sessions" word resolves through charging.curve.sessions.
        Assert.Contains("L:charging.curve.sessions", view.Rows[1].Cells[2].Tooltip);
    }

    // ---- a11y: every cell carries a spoken/hover label -----------------------------

    [Fact]
    public void Every_cell_carries_a_non_empty_tooltip()
    {
        var view = CostHeatmapProjection.Project(
            Report(peak: 0.3, Entry(day: 3, hour: 7, sessions: 2, cost: 0.15)), Localizer);

        Assert.All(view.Rows, row => Assert.All(row.Cells, c => Assert.False(string.IsNullOrWhiteSpace(c.Tooltip))));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""
        { "weekly_heatmap": [ { "day": 0, "hour": 0, "sessions": 1, "avg_cost_per_kwh": 0.1 } ] }
        """);

        var cached = CostHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);

        var offline = CostHeatmapResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, CostHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, CostHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostHeatmapResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CostHeatmapReport>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_grid()
    {
        using var vm = NewViewModel(Loaded(Report(peak: 0.3, Entry(1, 14, 3, 0.3))));
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(CostHeatmapProjection.Days, vm.Display.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_entries_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Report())); // no entries
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.EmptyMessage)); // never a blank box
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CostHeatmapReport>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostHeatmapReport>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<CostHeatmapReport>.Cached(
            Report(peak: 0.3, Entry(1, 14, 3, 0.3)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<CostHeatmapReport>.OfflineCached(
            Report(peak: 0.3, Entry(1, 14, 3, 0.3)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostHeatmapReport>.Loading(),
            RepositoryResult<CostHeatmapReport>.Cached(Report(peak: 0.3, Entry(0, 0, 1, 0.1)), Now, stale: false),
            RepositoryResult<CostHeatmapReport>.Loaded(Report(peak: 0.3, Entry(1, 14, 3, 0.3)), Now));
        await vm.LoadAsync();

        Assert.Equal(CostHeatmapState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CostHeatmapReport>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Charging Cost Heatmap", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Report(peak: 0.3, Entry(1, 14, 3, 0.3))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostHeatmapViewModel.State), changed);
        Assert.Contains(nameof(CostHeatmapViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("cost-heatmap", CostHeatmapRegistration.Id);
        Assert.Equal("charging", CostHeatmapRegistration.Category);
        Assert.Equal("CostHeatmap", CostHeatmapRegistration.Slug);
        Assert.Equal("Charging Cost Heatmap", CostHeatmapRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CostHeatmapDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostHeatmap", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CostHeatmapEntry Entry(int day, int hour, int sessions, double cost) =>
        new(day, hour, sessions, cost);

    private static CostHeatmapReport Report(double peak = 0.30, params CostHeatmapEntry[] entries) =>
        new(entries, peak);

    private static RepositoryResult<CostHeatmapReport> Loaded(CostHeatmapReport report) =>
        RepositoryResult<CostHeatmapReport>.Loaded(report, Now);

    private static CostHeatmapViewModel NewViewModel(params RepositoryResult<CostHeatmapReport>[] emissions) =>
        new(new FakeCostHeatmapSource(emissions), Localizer);

    private sealed class FakeCostHeatmapSource(params RepositoryResult<CostHeatmapReport>[] emissions) : ICostHeatmapSource
    {
        public async IAsyncEnumerable<RepositoryResult<CostHeatmapReport>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
