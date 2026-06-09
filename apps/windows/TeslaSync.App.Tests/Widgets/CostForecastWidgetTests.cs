using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the CostForecastWidget's UI-thread-free logic — the JSON parse adapter
/// (historical / forecast month arrays), the <c>buildChartData</c> combine-then-slice(-6) projection with
/// its <c>isForecast</c> tagging, the compact (Next Month + Trend) vs standard (Next Month + Avg $/kWh +
/// signed Trend) stat sets, the currency formatting, the per-bar height-ratio / single-brush color, the
/// trend-up/down gate, the <c>hasData = chartData.length &gt; 0</c> empty gate and the
/// <c>isCompact = cols &lt;= 1</c> branch, the cache-then-network result mapper, the per-vehicle data
/// source (primary resolution + vehicle_id/months query scoping + generated-operation resolution), the
/// registry metadata, the diagnostics, the Narrator automation names, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/CostForecastWidget.tsx + api/hooks/useCharging.ts).
/// </summary>
public sealed class CostForecastWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static CostForecastHistoryMonth H(string month, double cost, double cpk = 0) => new(month, cost, cpk);

    private static CostForecastProjectionMonth F(string month, double cost) => new(month, cost);

    private static CostForecast Data(
        IReadOnlyList<CostForecastHistoryMonth> historical,
        IReadOnlyList<CostForecastProjectionMonth> forecast) => new(historical, forecast);

    private static CostForecastDisplay Project(CostForecast data, int cols, int rows) =>
        CostForecastProjection.Project(data, new CostForecastSize(cols, rows), "$", Localizer);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_historical_and_forecast_months()
    {
        using var doc = JsonDocument.Parse(
            """
            {
              "historical": [{"month":"2026-01","cost":100.5,"kwh":800,"sessions":12,"cost_per_kwh":0.18}],
              "forecast": [{"month":"2026-02","cost":120,"cost_low":110,"cost_high":130,"kwh":850}],
              "insights": ["ignored"]
            }
            """);

        var snapshot = CostForecast.FromJson(doc.RootElement);

        var hist = Assert.Single(snapshot.Historical);
        Assert.Equal("2026-01", hist.Month);
        Assert.Equal(100.5, hist.Cost);
        Assert.Equal(0.18, hist.CostPerKwh);

        var fore = Assert.Single(snapshot.Forecast);
        Assert.Equal("2026-02", fore.Month);
        Assert.Equal(120, fore.Cost);
    }

    [Fact]
    public void FromJson_defaults_missing_fields_to_em_dash_and_zero()
    {
        using var doc = JsonDocument.Parse(
            """{"historical":[{"kwh":1}],"forecast":[{"cost_low":1}]}""");

        var snapshot = CostForecast.FromJson(doc.RootElement);

        var hist = Assert.Single(snapshot.Historical);
        Assert.Equal("\u2014", hist.Month);
        Assert.Equal(0, hist.Cost);
        Assert.Equal(0, hist.CostPerKwh);

        var fore = Assert.Single(snapshot.Forecast);
        Assert.Equal("\u2014", fore.Month);
        Assert.Equal(0, fore.Cost);
    }

    [Fact]
    public void FromJson_parses_numeric_string_cost()
    {
        using var doc = JsonDocument.Parse(
            """{"historical":[{"month":"2026-01","cost":"95.25","cost_per_kwh":"0.2"}],"forecast":[]}""");

        var hist = Assert.Single(CostForecast.FromJson(doc.RootElement).Historical);
        Assert.Equal(95.25, hist.Cost);
        Assert.Equal(0.2, hist.CostPerKwh);
    }

    [Fact]
    public void FromJson_skips_non_object_entries_and_tolerates_missing_arrays()
    {
        using var doc = JsonDocument.Parse(
            """{"historical":[{"month":"2026-01","cost":10}, 7, "x"]}""");

        var snapshot = CostForecast.FromJson(doc.RootElement);

        Assert.Single(snapshot.Historical);
        Assert.Empty(snapshot.Forecast);
    }

    [Fact]
    public void FromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");

        var snapshot = CostForecast.FromJson(doc.RootElement);

        Assert.False(snapshot.HasData);
        Assert.Empty(snapshot.Historical);
        Assert.Empty(snapshot.Forecast);
    }

    [Fact]
    public void HasData_true_when_any_history_or_forecast_present()
    {
        Assert.True(Data(new[] { H("2026-01", 10) }, Array.Empty<CostForecastProjectionMonth>()).HasData);
        Assert.True(Data(Array.Empty<CostForecastHistoryMonth>(), new[] { F("2026-02", 10) }).HasData);
        Assert.False(CostForecast.Empty.HasData);
    }

    // ---- Projection: buildChartData (combine then slice(-6)) ------------------------

    [Fact]
    public void Project_combines_historical_then_forecast_in_order()
    {
        var data = Data(
            new[] { H("2026-01", 100), H("2026-02", 110) },
            new[] { F("2026-03", 120), F("2026-04", 130) });

        var view = Project(data, 2, 4);

        Assert.Equal(new[] { "2026-01", "2026-02", "2026-03", "2026-04" }, view.Bars.Select(b => b.Month));
        Assert.Equal(new[] { 100.0, 110.0, 120.0, 130.0 }, view.Bars.Select(b => b.Cost));
    }

    [Fact]
    public void Project_tags_forecast_bars_isForecast_true_history_false()
    {
        var data = Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) });

        var view = Project(data, 2, 4);

        Assert.False(view.Bars[0].IsForecast);
        Assert.True(view.Bars[1].IsForecast);
    }

    [Fact]
    public void Project_keeps_only_the_six_most_recent_months()
    {
        // 4 historical + 4 forecast = 8 combined; slice(-6) drops the two oldest historical months.
        var data = Data(
            new[] { H("h1", 1), H("h2", 2), H("h3", 3), H("h4", 4) },
            new[] { F("f1", 5), F("f2", 6), F("f3", 7), F("f4", 8) });

        var view = Project(data, 2, 4);

        Assert.Equal(6, view.Bars.Count);
        Assert.Equal(new[] { "h3", "h4", "f1", "f2", "f3", "f4" }, view.Bars.Select(b => b.Month));
        // The two retained historical months stay isForecast=false; the four forecast months stay true.
        Assert.Equal(new[] { false, false, true, true, true, true }, view.Bars.Select(b => b.IsForecast));
    }

    [Fact]
    public void Project_blank_month_falls_back_to_em_dash()
    {
        var view = Project(Data(new[] { H(string.Empty, 100) }, Array.Empty<CostForecastProjectionMonth>()), 2, 4);

        Assert.Equal("\u2014", Assert.Single(view.Bars).Month);
    }

    // ---- Projection: hasData gate (web hasData = chartData.length > 0) --------------

    [Fact]
    public void Project_hasData_false_when_no_months()
    {
        var view = Project(CostForecast.Empty, 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Empty(view.Bars);
    }

    [Fact]
    public void Project_hasData_true_with_single_forecast_month()
    {
        var view = Project(Data(Array.Empty<CostForecastHistoryMonth>(), new[] { F("2026-03", 120) }), 2, 4);

        Assert.True(view.HasData);
        Assert.Single(view.Bars);
        Assert.Equal(3, view.Stats.Count);
    }

    // ---- Projection: standard stats (Next Month / Avg $/kWh / Trend) ---------------

    [Fact]
    public void Project_standard_stats_next_month_avg_and_signed_trend_up()
    {
        var data = Data(
            new[] { H("2026-01", 100, 0.18), H("2026-02", 110, 0.19) },
            new[] { F("2026-03", 120) });

        var view = Project(data, 2, 4);

        Assert.Equal(3, view.Stats.Count);

        Assert.Equal("Next Month", view.Stats[0].Label);
        Assert.Equal("$120", view.Stats[0].Value);
        Assert.Equal("Next Month: $120", view.Stats[0].AutomationName);

        // Avg $/kWh comes from the most-recent historical month (cost_per_kwh, 2dp).
        Assert.Equal("Avg $/kWh", view.Stats[1].Label);
        Assert.Equal("$0.19", view.Stats[1].Value);

        // trendUp (120 >= 110): "↑ $Δ" where Δ = next - last = 10.
        Assert.Equal("Trend", view.Stats[2].Label);
        Assert.Equal("\u2191 $10", view.Stats[2].Value);
        Assert.True(view.TrendUp);
    }

    [Fact]
    public void Project_standard_trend_down_uses_absolute_difference()
    {
        var data = Data(
            new[] { H("2026-01", 100, 0.20), H("2026-02", 110, 0.21) },
            new[] { F("2026-03", 80) });

        var view = Project(data, 2, 4);

        // trendDown (80 < 110): "↓ $Δ" where Δ = last - next = 30.
        Assert.False(view.TrendUp);
        Assert.Equal("\u2193 $30", view.Stats[2].Value);
    }

    [Fact]
    public void Project_avg_per_kwh_is_em_dash_when_no_history()
    {
        // Forecast-only snapshot: lastHistorical is undefined -> Avg $/kWh shows the em-dash (web '—').
        var view = Project(Data(Array.Empty<CostForecastHistoryMonth>(), new[] { F("2026-03", 120) }), 2, 4);

        Assert.Equal("Avg $/kWh", view.Stats[1].Label);
        Assert.Equal("\u2014", view.Stats[1].Value);

        // lastCost defaults to 0, so trendUp (120 >= 0) with Δ = 120.
        Assert.True(view.TrendUp);
        Assert.Equal("\u2191 $120", view.Stats[2].Value);
    }

    [Fact]
    public void Project_currency_formatting_uses_supplied_symbol_and_grouping()
    {
        var data = Data(new[] { H("2026-01", 900, 0.5) }, new[] { F("2026-02", 1500) });

        var view = CostForecastProjection.Project(data, new CostForecastSize(2, 4), "€", Localizer);

        Assert.Equal("€1,500", view.Stats[0].Value);   // Next Month, grouped, 0dp
        Assert.Equal("€0.50", view.Stats[1].Value);     // Avg €/kWh, 2dp
        Assert.Equal("€600", view.Stats[2].Value[2..]); // Trend Δ = 1500 - 900 = 600 (after "↑ ")
    }

    // ---- Projection: compact (web isCompact = cols <= 1) ---------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(1, 4, true)]
    [InlineData(2, 4, false)]
    [InlineData(3, 4, false)]
    public void Project_compact_requires_single_column(int cols, int rows, bool expected) =>
        Assert.Equal(expected, Project(Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) }), cols, rows).IsCompact);

    [Fact]
    public void Project_compact_stats_are_next_month_and_arrow_only()
    {
        var data = Data(new[] { H("2026-01", 100, 0.18) }, new[] { F("2026-02", 120) });

        var view = Project(data, 1, 2);

        Assert.True(view.IsCompact);
        Assert.Equal(2, view.Stats.Count);
        Assert.Equal("Next Month", view.Stats[0].Label);
        Assert.Equal("$120", view.Stats[0].Value);
        Assert.Equal("Trend", view.Stats[1].Label);
        Assert.Equal("\u2191", view.Stats[1].Value);
    }

    [Fact]
    public void Project_compact_trend_arrow_down()
    {
        var data = Data(new[] { H("2026-01", 200) }, new[] { F("2026-02", 120) });

        var view = Project(data, 1, 2);

        Assert.False(view.TrendUp);
        Assert.Equal("\u2193", view.Stats[1].Value);
    }

    // ---- Projection: bar geometry / color ------------------------------------------

    [Fact]
    public void Project_scales_bar_height_ratio_to_the_costliest_bar()
    {
        var data = Data(
            new[] { H("2026-01", 50), H("2026-02", 100) },
            new[] { F("2026-03", 200) });

        var view = Project(data, 2, 4);

        Assert.Equal(50.0 / 200.0, view.Bars[0].HeightRatio, 3);
        Assert.Equal(100.0 / 200.0, view.Bars[1].HeightRatio, 3);
        Assert.Equal(1.0, view.Bars[2].HeightRatio, 3);
    }

    [Fact]
    public void Project_all_zero_cost_keeps_data_with_zero_ratios()
    {
        var view = Project(Data(new[] { H("2026-01", 0) }, new[] { F("2026-02", 0) }), 2, 4);

        Assert.True(view.HasData);
        Assert.All(view.Bars, b => Assert.Equal(0, b.HeightRatio));
    }

    [Fact]
    public void Project_bars_share_the_single_brand_chart_brush()
    {
        var data = Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) });

        var view = Project(data, 2, 4);

        Assert.All(view.Bars, b => Assert.Equal(CostForecastProjection.BarBrushKey, b.ColorBrushKey));
        Assert.Equal("TsChart01Brush", CostForecastProjection.BarBrushKey);
    }

    // ---- A11y: automation names ----------------------------------------------------

    [Fact]
    public void Project_bar_automation_name_combines_month_and_value()
    {
        var view = Project(Data(Array.Empty<CostForecastHistoryMonth>(), new[] { F("2026-03", 120) }), 2, 4);

        var bar = Assert.Single(view.Bars);
        Assert.Equal("2026-03: $120", bar.AutomationName);
        Assert.Equal("$120", bar.ValueText);
    }

    [Fact]
    public void Project_compact_automation_name_lists_stats()
    {
        var data = Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) });

        var view = Project(data, 1, 2);

        Assert.Contains("Next Month: $120", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Trend: \u2191", view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Trend glyph / brush mapping (web TrendingUp amber / TrendingDown emerald) --

    [Fact]
    public void TrendGlyph_and_brush_map_up_to_amber_and_down_to_emerald()
    {
        Assert.Equal(CostForecastProjection.TrendUpGlyph, CostForecastProjection.TrendGlyph(true));
        Assert.Equal(CostForecastProjection.TrendDownGlyph, CostForecastProjection.TrendGlyph(false));
        Assert.Equal("TsColorWarningBrush", CostForecastProjection.TrendBrushKey(true));
        Assert.Equal("TsColorSuccessBrush", CostForecastProjection.TrendBrushKey(false));
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """{"historical":[{"month":"2026-01","cost":100}],"forecast":[{"month":"2026-02","cost":120}]}""");

        var cached = CostForecastResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);

        var offline = CostForecastResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Forecast);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"historical":[],"forecast":[{"month":"2026-02","cost":1}]}""");

        Assert.Equal(LoadStatus.Loaded, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, CostForecastResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecast>.Loading());
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Data(
            new[] { H("2026-01", 100, 0.18) }, new[] { F("2026-02", 120) })));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.Equal("$120", vm.Display.Stats[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecast>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_resolved_empty_snapshot_renders_empty()
    {
        using var vm = NewViewModel(Loaded(CostForecast.Empty));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Empty, vm.State);
        Assert.Equal("No forecast data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostForecast>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecast>.Cached(
            Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) }), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecast>.OfflineCached(
            Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) }), Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<CostForecast>.Loading(),
            RepositoryResult<CostForecast>.Cached(Data(new[] { H("2026-01", 90) }, new[] { F("2026-02", 95) }), Now, stale: false),
            RepositoryResult<CostForecast>.Loaded(Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) }), Now));
        await vm.LoadAsync();

        Assert.Equal(CostForecastState.Loaded, vm.State);
        Assert.Equal("$120", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new CostForecastSize(2, 4),
            Loaded(Data(new[] { H("2026-01", 100, 0.18) }, new[] { F("2026-02", 120) })));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.Equal(3, vm.Display.Stats.Count);

        vm.Size = new CostForecastSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(2, vm.Display.Stats.Count);
        Assert.Equal(CostForecastState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_currency_change_reprojects_values()
    {
        using var vm = NewViewModel(Loaded(Data(new[] { H("2026-01", 100, 0.18) }, new[] { F("2026-02", 120) })));
        await vm.LoadAsync();
        Assert.Equal("$120", vm.Display.Stats[0].Value);

        vm.CurrencySymbol = "£";
        Assert.Equal("£120", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<CostForecast>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Cost Forecast", vm.Title);
        Assert.Equal("No forecast data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(new[] { H("2026-01", 100) }, new[] { F("2026-02", 120) })));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(CostForecastViewModel.State), changed);
        Assert.Contains(nameof(CostForecastViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("cost-forecast", CostForecastRegistration.Id);
        Assert.Equal("charging", CostForecastRegistration.Category);
        Assert.Equal("CostForecastWidget", CostForecastRegistration.Slug);
        Assert.Equal(new CostForecastSize(2, 4), CostForecastRegistration.DefaultSize);
        Assert.Equal(new CostForecastSize(1, 2), CostForecastRegistration.MinSize);
        Assert.Equal(new CostForecastSize(4, 40), CostForecastRegistration.MaxSize);
        Assert.Equal("Cost Forecast", CostForecastRegistration.Name(Localizer));
        Assert.Equal(
            "6-month charging cost projection with seasonal trends",
            CostForecastRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(2, 4, true)]   // default
    [InlineData(0, 2, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(1, 1, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, CostForecastRegistration.IsWithinBounds(new CostForecastSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new CostForecastSize(1, 2), CostForecastRegistration.Clamp(new CostForecastSize(0, 0)));
        Assert.Equal(new CostForecastSize(4, 40), CostForecastRegistration.Clamp(new CostForecastSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CostForecastDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CostForecastWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new CostForecastSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"historical":[{"month":"2026-01","cost":100}],"forecast":[{"month":"2026-02","cost":120}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new CostForecastSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasData);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_cost_forecast", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(6L, Convert.ToInt64(request.Query!["months"], CultureInfo.InvariantCulture));

        // The operation must resolve against the generated endpoint table (contract wiring).
        Assert.NotNull(api.ResolveEndpoint(request.OperationId));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_and_months_win()
    {
        using var doc = JsonDocument.Parse("""{"historical":[],"forecast":[{"month":"2026-02","cost":1}]}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new CostForecastSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42, months: 12);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(12L, Convert.ToInt64(request.Query!["months"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new CostForecastSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<CostForecast>>> Drain(ICostForecastSource source)
    {
        var list = new List<RepositoryResult<CostForecast>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<CostForecast> Loaded(CostForecast data) =>
        RepositoryResult<CostForecast>.Loaded(data, Now);

    private static CostForecastViewModel NewViewModel(params RepositoryResult<CostForecast>[] emissions) =>
        NewViewModel(CostForecastSize.Default, emissions);

    private static CostForecastViewModel NewViewModel(
        CostForecastSize size,
        params RepositoryResult<CostForecast>[] emissions) =>
        new(new FakeCostForecastSource(emissions), Localizer, size, "$");

    private sealed class FakeCostForecastSource(params RepositoryResult<CostForecast>[] emissions) : ICostForecastSource
    {
        public async IAsyncEnumerable<RepositoryResult<CostForecast>> StreamAsync(
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
