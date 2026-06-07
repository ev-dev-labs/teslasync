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
/// Headless verification of the ChargeSessionChartWidget's UI-thread-free logic — the JSON parse adapter
/// (energy / charger_type / started_at), the charger-type classification + color-coding, the kWh
/// conversion / chronological-reverse / 10-session-cap / per-bar height-ratio / 3-stat projection across
/// the compact and standard footprints (including the web <c>hasData = chartData.length &gt; 0</c> gate
/// and the <c>isCompact = cols &lt;= 1 &amp;&amp; rows &lt;= 1</c> branch), the legend, the
/// cache-then-network result mapper, the per-vehicle data source (primary resolution + query-scoped
/// request), the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargeSessionChartWidget.tsx + api/hooks/useVehicles.ts).
/// </summary>
public sealed class ChargeSessionChartWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // Sessions are supplied newest-first (the backend orders started_at DESC) so the projection's reverse
    // produces a chronological chart.
    private static IReadOnlyList<ChargeSessionChartSession> Sessions(params double[] wh)
    {
        var list = new List<ChargeSessionChartSession>(wh.Length);
        foreach (double w in wh)
        {
            list.Add(new ChargeSessionChartSession(w, null, null));
        }

        return list;
    }

    private static ChargeSessionChartDisplay Project(IReadOnlyList<ChargeSessionChartSession> sessions, int cols, int rows) =>
        ChargeSessionChartProjection.Project(sessions, new ChargeSessionChartSize(cols, rows), Localizer, Now);

    private static ChargeSessionChartBar SingleBar(string? chargerType, double wh = 5000) => Assert.Single(
        Project(new List<ChargeSessionChartSession> { new(wh, chargerType, null) }, 2, 4).Bars);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_energy_charger_type_and_started_at()
    {
        using var doc = JsonDocument.Parse(
            """{"total_energy_added_wh":12345.6,"charger_type":"Supercharger","started_at":"2026-04-04T10:00:00Z"}""");

        var session = ChargeSessionChartSession.FromJson(doc.RootElement);

        Assert.Equal(12345.6, session.EnergyAddedWh);
        Assert.Equal("Supercharger", session.ChargerType);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), session.StartedAt);
    }

    [Fact]
    public void FromJson_defaults_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var session = ChargeSessionChartSession.FromJson(doc.RootElement);

        Assert.Equal(0, session.EnergyAddedWh);
        Assert.Null(session.ChargerType);
        Assert.Null(session.StartedAt);
    }

    [Fact]
    public void FromJson_parses_numeric_string_energy()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":"9000"}""");

        Assert.Equal(9000, ChargeSessionChartSession.FromJson(doc.RootElement).EnergyAddedWh);
    }

    [Fact]
    public void FromJson_tolerates_unparseable_started_at()
    {
        using var doc = JsonDocument.Parse("""{"started_at":"not-a-date"}""");

        Assert.Null(ChargeSessionChartSession.FromJson(doc.RootElement).StartedAt);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":1000}, 7, {"total_energy_added_wh":2000}]""");

        var list = ChargeSessionChartSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1000, list[0].EnergyAddedWh);
        Assert.Equal(2000, list[1].EnergyAddedWh);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":1000}""");
        Assert.Empty(ChargeSessionChartSession.ParseList(doc.RootElement));
    }

    // ---- Charger-type classification (web classifyChargerType) ---------------------

    [Theory]
    [InlineData("supercharger", ChargerType.Supercharger)]
    [InlineData("Tesla Supercharger", ChargerType.Supercharger)]
    [InlineData("TESLA", ChargerType.Supercharger)]
    [InlineData("ccs", ChargerType.Dc)]
    [InlineData("CHAdeMO", ChargerType.Dc)]
    [InlineData("<invalid>", ChargerType.Home)]
    [InlineData("", ChargerType.Home)]
    [InlineData(null, ChargerType.Home)]
    public void Classify_buckets_charger_type(string? raw, ChargerType expected) =>
        Assert.Equal(expected, ChargeSessionChartProjection.Classify(raw));

    [Theory]
    [InlineData(ChargerType.Home, "TsColorSuccessBrush")]
    [InlineData(ChargerType.Supercharger, "TsColorDangerBrush")]
    [InlineData(ChargerType.Dc, "TsColorWarningBrush")]
    public void BrushKeyFor_maps_charger_color(ChargerType type, string expectedKey) =>
        Assert.Equal(expectedKey, ChargeSessionChartProjection.BrushKeyFor(type));

    // ---- Projection: conversion / order / cap --------------------------------------

    [Fact]
    public void Project_converts_watt_hours_to_kwh()
    {
        var view = Project(Sessions(12000, 8000), 2, 4);

        // 12000 wh -> 12 kWh, 8000 wh -> 8 kWh; reversed into chronological order.
        Assert.Equal(new[] { 8.0, 12.0 }, view.Bars.Select(b => b.EnergyKwh));
    }

    [Fact]
    public void Project_reverses_newest_first_into_chronological_order()
    {
        // Newest-first input s0=10k, s1=20k, s2=30k -> chronological [s2, s1, s0] = [30, 20, 10] kWh.
        var view = Project(Sessions(10000, 20000, 30000), 2, 4);

        Assert.Equal(new[] { 30.0, 20.0, 10.0 }, view.Bars.Select(b => b.EnergyKwh));
    }

    [Fact]
    public void Project_caps_at_ten_most_recent_sessions()
    {
        // Twelve sessions newest-first (1000..12000 wh). Web limit=10 keeps the first ten (1000..10000),
        // dropping the two oldest (11000, 12000).
        var whs = new double[12];
        for (int i = 0; i < 12; i++)
        {
            whs[i] = (i + 1) * 1000.0;
        }

        var view = Project(Sessions(whs), 2, 4);

        Assert.Equal(10, view.Bars.Count);
        Assert.DoesNotContain(11.0, view.Bars.Select(b => b.EnergyKwh));
        Assert.DoesNotContain(12.0, view.Bars.Select(b => b.EnergyKwh));

        // Total of the kept ten (1..10 kWh) = 55; mean = 5.5.
        Assert.Equal("55.0", view.Stats[0].Value);
        Assert.Equal("5.5", view.Stats[1].Value);
        Assert.Equal("10", view.Stats[2].Value);
    }

    // ---- Projection: hasData gate (web hasData = chartData.length > 0) --------------

    [Fact]
    public void Project_hasData_false_when_no_sessions()
    {
        var view = Project(Sessions(), 2, 4);

        Assert.False(view.HasData);
        Assert.Empty(view.Stats);
        Assert.Empty(view.Bars);
    }

    [Fact]
    public void Project_hasData_true_with_single_session()
    {
        // Web parity: hasData = chartData.length > 0 — unlike ChargeHistory, ONE session is enough.
        var view = Project(Sessions(12000), 2, 4);

        Assert.True(view.HasData);
        Assert.Single(view.Bars);
        Assert.Equal(3, view.Stats.Count);
        Assert.Equal("12.0", view.Stats[0].Value);
        Assert.Equal("12.0", view.Stats[1].Value);
        Assert.Equal("1", view.Stats[2].Value);
    }

    // ---- Projection: stats (Total / Avg / Sessions) --------------------------------

    [Fact]
    public void Project_builds_total_avg_and_session_count_stats()
    {
        var view = Project(Sessions(12000, 8000), 2, 4);

        Assert.Equal(3, view.Stats.Count);

        Assert.Equal("Total", view.Stats[0].Label);
        Assert.Equal("20.0", view.Stats[0].Value);
        Assert.Equal("kWh", view.Stats[0].Unit);
        Assert.Equal("Total: 20.0 kWh", view.Stats[0].AutomationName);

        Assert.Equal("Avg", view.Stats[1].Label);
        Assert.Equal("10.0", view.Stats[1].Value);
        Assert.Equal("kWh", view.Stats[1].Unit);
        Assert.Equal("Avg: 10.0 kWh", view.Stats[1].AutomationName);

        // Web parity: the Sessions stat carries no unit suffix.
        Assert.Equal("Sessions", view.Stats[2].Label);
        Assert.Equal("2", view.Stats[2].Value);
        Assert.Null(view.Stats[2].Unit);
        Assert.Equal("Sessions: 2", view.Stats[2].AutomationName);
    }

    // ---- Projection: bar geometry (height ratio) -----------------------------------

    [Fact]
    public void Project_scales_bar_height_ratio_to_the_tallest_bar()
    {
        // Chronological [30, 20, 10] kWh, max 30 -> ratios 1.0, 0.667, 0.333.
        var view = Project(Sessions(10000, 20000, 30000), 2, 4);

        Assert.Equal(1.0, view.Bars[0].HeightRatio, 3);
        Assert.Equal(20.0 / 30.0, view.Bars[1].HeightRatio, 3);
        Assert.Equal(10.0 / 30.0, view.Bars[2].HeightRatio, 3);
    }

    [Fact]
    public void Project_all_zero_energy_keeps_data_with_zero_ratios()
    {
        // Two zero-energy sessions still satisfy hasData (length > 0) but every bar collapses to ratio 0.
        var view = Project(Sessions(0, 0), 2, 4);

        Assert.True(view.HasData);
        Assert.Equal(2, view.Bars.Count);
        Assert.All(view.Bars, b => Assert.Equal(0, b.HeightRatio));
    }

    // ---- Projection: bar color / type / automation ---------------------------------

    [Theory]
    [InlineData("supercharger", ChargerType.Supercharger, "TsColorDangerBrush", "Supercharger")]
    [InlineData("ccs", ChargerType.Dc, "TsColorWarningBrush", "DC Fast")]
    [InlineData(null, ChargerType.Home, "TsColorSuccessBrush", "Home / AC")]
    public void Project_color_codes_bars_by_charger_type(string? raw, ChargerType type, string brushKey, string label)
    {
        var bar = SingleBar(raw);

        Assert.Equal(type, bar.Type);
        Assert.Equal(brushKey, bar.ColorBrushKey);
        Assert.Equal(label, bar.TypeLabel);
    }

    [Fact]
    public void Project_bar_automation_name_combines_label_value_and_type()
    {
        var bar = SingleBar("supercharger", 5000);

        // Single null-dated session -> "#1" label, 5.0 kWh, Supercharger.
        Assert.Equal("#1: 5.0 kWh, Supercharger", bar.AutomationName);
    }

    // ---- Projection: bar labels (date / #index fallback) ---------------------------

    [Fact]
    public void Project_labels_fall_back_to_hash_index_using_pre_reverse_position()
    {
        // Web parity: `.map((s, i) => `#${i + 1}`).reverse()` -> newest gets the highest index, leftmost the
        // lowest, so the reversed chronological order reads #3, #2, #1.
        var view = Project(Sessions(1000, 2000, 3000), 2, 4);

        Assert.Equal(new[] { "#3", "#2", "#1" }, view.Bars.Select(b => b.Label));
    }

    [Fact]
    public void Project_labels_use_short_date_when_started_at_present()
    {
        var ts = new DateTimeOffset(2026, 4, 4, 12, 0, 0, TimeSpan.Zero);
        var view = ChargeSessionChartProjection.Project(
            new List<ChargeSessionChartSession> { new(5000, "home", ts) },
            new ChargeSessionChartSize(2, 4),
            Localizer,
            Now);

        var bar = Assert.Single(view.Bars);
        Assert.Equal(DateTimeFormatting.Format(ts, DateTimeVariant.Short, Now), bar.Label);
    }

    // ---- Projection: legend --------------------------------------------------------

    [Fact]
    public void Project_legend_lists_home_supercharger_dc_in_order()
    {
        var legend = Project(Sessions(12000, 8000), 2, 4).Legend;

        Assert.Equal(3, legend.Count);

        Assert.Equal(ChargerType.Home, legend[0].Type);
        Assert.Equal("Home / AC", legend[0].Label);
        Assert.Equal("TsColorSuccessBrush", legend[0].ColorBrushKey);

        Assert.Equal(ChargerType.Supercharger, legend[1].Type);
        Assert.Equal("Supercharger", legend[1].Label);
        Assert.Equal("TsColorDangerBrush", legend[1].ColorBrushKey);

        Assert.Equal(ChargerType.Dc, legend[2].Type);
        Assert.Equal("DC Fast", legend[2].Label);
        Assert.Equal("TsColorWarningBrush", legend[2].ColorBrushKey);
    }

    // ---- Projection: compact (web isCompact = cols <= 1 && rows <= 1) ---------------

    [Theory]
    [InlineData(1, 1, true)]
    [InlineData(1, 4, false)]
    [InlineData(2, 1, false)]
    [InlineData(2, 4, false)]
    [InlineData(1, 2, false)]
    public void Project_compact_requires_single_cell(int cols, int rows, bool expected) =>
        Assert.Equal(expected, Project(Sessions(12000, 8000), cols, rows).IsCompact);

    [Fact]
    public void Project_compact_automation_name_lists_stats()
    {
        var view = Project(Sessions(12000, 8000), 1, 1);

        Assert.True(view.IsCompact);
        Assert.Contains("Total: 20.0 kWh", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg: 10.0 kWh", view.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Sessions: 2", view.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12000},{"total_energy_added_wh":8000}]""");

        var cached = ChargeSessionChartResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Count);

        var offline = ChargeSessionChartResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, offline.Value!.Count);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000}]""");

        Assert.Equal(LoadStatus.Loaded, ChargeSessionChartResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ChargeSessionChartResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargeSessionChartResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Sessions(12000, 8000)));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(3, vm.Display.Stats.Count);
        Assert.Equal(new[] { 8.0, 12.0 }, vm.Display.Bars.Select(b => b.EnergyKwh));
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_single_session_still_renders_loaded()
    {
        // Web parity: hasData = chartData.length > 0, so a lone session charts (it does NOT hit the empty
        // gate the way ChargeHistory's > 1 gate does).
        using var vm = NewViewModel(Loaded(Sessions(12000)));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Single(vm.Display.Bars);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_resolved_empty_list_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Sessions()));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Empty, vm.State);
        Assert.Equal("No charge sessions yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Cached(Sessions(12000, 8000), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.OfflineCached(
            Sessions(12000, 8000), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Loading(),
            RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Cached(Sessions(4000, 2000), Now, stale: false),
            RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Loaded(Sessions(12000, 8000), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeSessionChartState.Loaded, vm.State);
        Assert.Equal("20.0", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ChargeSessionChartSize(2, 4), Loaded(Sessions(12000, 8000)));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ChargeSessionChartSize(1, 1);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ChargeSessionChartState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge Sessions", vm.Title);
        Assert.Equal("No charge sessions yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sessions(12000, 8000)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargeSessionChartViewModel.State), changed);
        Assert.Contains(nameof(ChargeSessionChartViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charge-session-chart", ChargeSessionChartRegistration.Id);
        Assert.Equal("charging", ChargeSessionChartRegistration.Category);
        Assert.Equal("ChargeSessionChartWidget", ChargeSessionChartRegistration.Slug);
        Assert.Equal(new ChargeSessionChartSize(2, 4), ChargeSessionChartRegistration.DefaultSize);
        Assert.Equal(new ChargeSessionChartSize(1, 2), ChargeSessionChartRegistration.MinSize);
        Assert.Equal(new ChargeSessionChartSize(4, 40), ChargeSessionChartRegistration.MaxSize);
        Assert.Equal("Charge Session Chart", ChargeSessionChartRegistration.Name(Localizer));
        Assert.Equal(
            "Bar chart of recent charge sessions: energy per session, color-coded by charger type (home/SC/destination)",
            ChargeSessionChartRegistration.Description(Localizer));
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
        Assert.Equal(within, ChargeSessionChartRegistration.IsWithinBounds(new ChargeSessionChartSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargeSessionChartSize(1, 2), ChargeSessionChartRegistration.Clamp(new ChargeSessionChartSize(0, 0)));
        Assert.Equal(new ChargeSessionChartSize(4, 40), ChargeSessionChartRegistration.Clamp(new ChargeSessionChartSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargeSessionChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargeSessionChartWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargeSessionChartSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_by_query()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12000,"charger_type":"home"},{"total_energy_added_wh":8000,"charger_type":"supercharger"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargeSessionChartSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(2, terminal.Value!.Count);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"total_energy_added_wh":1000},{"total_energy_added_wh":2000}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargeSessionChartSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new ChargeSessionChartSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>>> Drain(IChargeSessionChartSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<ChargeSessionChartSession>> Loaded(IReadOnlyList<ChargeSessionChartSession> sessions) =>
        RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>.Loaded(sessions, Now);

    private static ChargeSessionChartViewModel NewViewModel(params RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>[] emissions) =>
        NewViewModel(ChargeSessionChartSize.Default, emissions);

    private static ChargeSessionChartViewModel NewViewModel(
        ChargeSessionChartSize size,
        params RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>[] emissions) =>
        new(new FakeChargeSessionChartSource(emissions), Localizer, size, () => Now);

    private sealed class FakeChargeSessionChartSource(params RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>[] emissions) : IChargeSessionChartSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargeSessionChartSession>>> StreamAsync(
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
