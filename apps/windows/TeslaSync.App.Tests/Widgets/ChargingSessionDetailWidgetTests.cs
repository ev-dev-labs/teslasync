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
/// Headless verification of the ChargingSessionDetailWidget's UI-thread-free logic — the JSON parse
/// adapters (detail energy / charger_type / started_at / ended_at; telemetry created_at / power_kw /
/// battery_level ?? soc), the charger classification + badge accent, the kWh conversion / duration / peak
/// power / 4-stat projection across the compact and standard footprints (the web <c>isCompact = cols
/// &lt;= 1</c> branch and the dual-axis power/SoC curve normalization with <c>connectNulls</c> gaps), the
/// cache-then-network result mapper (including the <c>!detail</c> empty gate), the per-vehicle data source
/// (primary resolution + sessions → telemetry → detail request chain), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx + api/hooks/useCharging.ts).
/// </summary>
public sealed class ChargingSessionDetailWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static ChargingSessionDetailSnapshot Snapshot(
        ChargingSessionDetailRow detail,
        params ChargeTelemetrySample[] telemetry) =>
        new(detail, telemetry);

    private static ChargingSessionDetailRow Detail(
        double energyWh = 0,
        string? chargerType = null,
        DateTimeOffset? started = null,
        DateTimeOffset? ended = null) =>
        new(energyWh, chargerType, started, ended);

    private static ChargeTelemetrySample Sample(double? powerKw, double? soc = null, DateTimeOffset? at = null) =>
        new(at ?? Now, powerKw, soc);

    private static ChargingSessionDetailDisplay Project(ChargingSessionDetailSnapshot snapshot, int cols = 2, int rows = 4) =>
        ChargingSessionDetailProjection.Project(snapshot, new ChargingSessionDetailSize(cols, rows), Localizer, Now);

    // ---- Detail parse adapter ------------------------------------------------------

    [Fact]
    public void DetailFromJson_reads_energy_charger_started_and_ended()
    {
        using var doc = JsonDocument.Parse(
            """{"total_energy_added_wh":42500.5,"charger_type":"Supercharger","started_at":"2026-04-04T10:00:00Z","ended_at":"2026-04-04T10:45:00Z"}""");

        var detail = ChargingSessionDetailRow.FromJson(doc.RootElement);

        Assert.Equal(42500.5, detail.EnergyAddedWh);
        Assert.Equal("Supercharger", detail.ChargerType);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero), detail.StartedAt);
        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 45, 0, TimeSpan.Zero), detail.EndedAt);
    }

    [Fact]
    public void DetailFromJson_defaults_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":7}""");

        var detail = ChargingSessionDetailRow.FromJson(doc.RootElement);

        Assert.Equal(0, detail.EnergyAddedWh);
        Assert.Null(detail.ChargerType);
        Assert.Null(detail.StartedAt);
        Assert.Null(detail.EndedAt);
    }

    [Theory]
    [InlineData(JsonValueKind.Object, true)]
    [InlineData(JsonValueKind.Null, false)]
    [InlineData(JsonValueKind.Array, false)]
    public void HasDetail_gates_on_object_payload(JsonValueKind kind, bool expected)
    {
        string json = kind switch
        {
            JsonValueKind.Object => "{}",
            JsonValueKind.Array => "[]",
            _ => "null",
        };
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, ChargingSessionDetailRow.HasDetail(doc.RootElement));
    }

    [Fact]
    public void DurationMinutes_computes_from_started_and_ended()
    {
        var detail = Detail(
            started: new DateTimeOffset(2026, 4, 4, 10, 0, 0, TimeSpan.Zero),
            ended: new DateTimeOffset(2026, 4, 4, 11, 30, 0, TimeSpan.Zero));

        Assert.Equal(90, detail.DurationMinutes());
    }

    [Fact]
    public void DurationMinutes_null_without_end()
    {
        Assert.Null(Detail(started: Now, ended: null).DurationMinutes());
        Assert.Null(Detail(started: null, ended: Now).DurationMinutes());
    }

    // ---- Telemetry parse adapter ---------------------------------------------------

    [Fact]
    public void TelemetryFromJson_reads_created_power_and_battery_level()
    {
        using var doc = JsonDocument.Parse(
            """{"created_at":"2026-04-04T10:05:00Z","power_kw":48.3,"battery_level":62}""");

        var sample = ChargeTelemetrySample.FromJson(doc.RootElement);

        Assert.Equal(new DateTimeOffset(2026, 4, 4, 10, 5, 0, TimeSpan.Zero), sample.CreatedAt);
        Assert.Equal(48.3, sample.PowerKw);
        Assert.Equal(62, sample.Soc);
    }

    [Fact]
    public void TelemetryFromJson_falls_back_to_soc_when_no_battery_level()
    {
        using var doc = JsonDocument.Parse("""{"power_kw":11,"soc":44}""");

        Assert.Equal(44, ChargeTelemetrySample.FromJson(doc.RootElement).Soc);
    }

    [Fact]
    public void TelemetryFromJson_tolerates_missing_metrics()
    {
        using var doc = JsonDocument.Parse("""{"created_at":"not-a-date"}""");

        var sample = ChargeTelemetrySample.FromJson(doc.RootElement);
        Assert.Null(sample.CreatedAt);
        Assert.Null(sample.PowerKw);
        Assert.Null(sample.Soc);
    }

    [Fact]
    public void TelemetryParseList_reads_array_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"power_kw":10}, 7, {"power_kw":20}]""");

        var list = ChargeTelemetrySample.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(10, list[0].PowerKw);
        Assert.Equal(20, list[1].PowerKw);
    }

    [Fact]
    public void TelemetryParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"power_kw":10}""");
        Assert.Empty(ChargeTelemetrySample.ParseList(doc.RootElement));
    }

    // ---- Charger classification (web classifyCharger) ------------------------------

    [Theory]
    [InlineData("supercharger", ChargerKind.Supercharger)]
    [InlineData("Tesla Supercharger", ChargerKind.Supercharger)]
    [InlineData("TESLA", ChargerKind.Supercharger)]
    [InlineData("ccs", ChargerKind.DcFast)]
    [InlineData("CHAdeMO", ChargerKind.DcFast)]
    [InlineData("<invalid>", ChargerKind.AcHome)]
    [InlineData("", ChargerKind.AcHome)]
    [InlineData(null, ChargerKind.AcHome)]
    public void Classify_buckets_charger_types(string? raw, ChargerKind expected) =>
        Assert.Equal(expected, ChargingSessionDetailProjection.Classify(raw));

    [Theory]
    [InlineData(ChargerKind.AcHome, StatusKind.Neutral)]
    [InlineData(ChargerKind.Supercharger, StatusKind.Warning)]
    [InlineData(ChargerKind.DcFast, StatusKind.Warning)]
    public void StatusFor_maps_badge_accent(ChargerKind kind, StatusKind expected) =>
        Assert.Equal(expected, ChargingSessionDetailProjection.StatusFor(kind));

    // ---- Duration text (web durationStr) -------------------------------------------

    [Fact]
    public void DurationText_minutes_only_below_an_hour()
    {
        var detail = Detail(started: Now, ended: Now.AddMinutes(45));
        Assert.Equal("45m", ChargingSessionDetailProjection.DurationText(detail));
    }

    [Fact]
    public void DurationText_hours_and_minutes()
    {
        var detail = Detail(started: Now, ended: Now.AddMinutes(95));
        Assert.Equal("1h 35m", ChargingSessionDetailProjection.DurationText(detail));
    }

    [Fact]
    public void DurationText_whole_hours_drop_the_minutes()
    {
        var detail = Detail(started: Now, ended: Now.AddMinutes(120));
        Assert.Equal("2h", ChargingSessionDetailProjection.DurationText(detail));
    }

    [Fact]
    public void DurationText_live_session_reads_zero_minutes()
    {
        Assert.Equal("0m", ChargingSessionDetailProjection.DurationText(Detail(started: Now, ended: null)));
    }

    // ---- Peak power (web reduce max power_kw) ---------------------------------------

    [Fact]
    public void PeakPower_is_the_max_sample_power()
    {
        var telemetry = new[] { Sample(12), Sample(48), Sample(null), Sample(30) };
        Assert.Equal(48, ChargingSessionDetailProjection.PeakPower(telemetry));
    }

    [Fact]
    public void PeakPower_zero_for_no_telemetry() =>
        Assert.Equal(0, ChargingSessionDetailProjection.PeakPower(Array.Empty<ChargeTelemetrySample>()));

    // ---- Projection: stats + compact + chart ---------------------------------------

    [Fact]
    public void Project_energy_converts_si_watt_hours_to_kwh()
    {
        var display = Project(Snapshot(Detail(energyWh: 42500)));

        Assert.True(display.HasData);
        Assert.Equal("Energy Added", display.Stats[0].Label);
        Assert.Equal("42.5", display.Stats[0].Value);
        Assert.Equal("kWh", display.Stats[0].Unit);
    }

    [Fact]
    public void Project_builds_the_four_summary_stats()
    {
        var display = Project(Snapshot(
            Detail(energyWh: 20000, chargerType: "supercharger", started: Now, ended: Now.AddMinutes(35)),
            Sample(150), Sample(90)));

        Assert.Collection(
            display.Stats,
            s => { Assert.Equal("Energy Added", s.Label); Assert.Equal("20.0", s.Value); Assert.Equal("kWh", s.Unit); },
            s => { Assert.Equal("Duration", s.Label); Assert.Equal("35m", s.Value); Assert.Null(s.Unit); },
            s => { Assert.Equal("Peak Power", s.Label); Assert.Equal("150.0", s.Value); Assert.Equal("kW", s.Unit); },
            s => { Assert.Equal("Charger", s.Label); Assert.Equal("Supercharger", s.Value); Assert.Null(s.Unit); });
    }

    [Fact]
    public void Project_compact_exposes_big_number_and_badge()
    {
        var display = Project(Snapshot(Detail(energyWh: 33250, chargerType: "ccs")), cols: 1, rows: 2);

        Assert.True(display.IsCompact);
        Assert.Equal("33.3", display.CompactEnergyText);
        Assert.Equal("kWh added", display.CompactUnitLabel);
        Assert.Equal("DC Fast", display.ChargerLabel);
        Assert.Equal(StatusKind.Warning, display.ChargerStatus);
    }

    [Fact]
    public void Project_standard_is_not_compact()
    {
        Assert.False(Project(Snapshot(Detail()), cols: 2, rows: 4).IsCompact);
        Assert.False(Project(Snapshot(Detail()), cols: 2, rows: 4).IsWide);
        Assert.True(Project(Snapshot(Detail()), cols: 3, rows: 4).IsWide);
    }

    [Fact]
    public void Project_chart_normalizes_power_to_axis_and_soc_to_hundred()
    {
        var display = Project(Snapshot(
            Detail(energyWh: 10000),
            Sample(10, 20), Sample(50, 60), Sample(30, 80)));

        var chart = display.Chart;
        Assert.True(display.HasChart);
        Assert.Equal(3, chart.Points.Count);

        // Web parity: left power axis domain = [0, dataMax + 5] → axisMax 55.
        Assert.Equal(55, chart.PowerAxisMaxKw);
        Assert.Equal(50.0 / 55.0, chart.Points[1].PowerRatio!.Value, 3);
        Assert.Equal(0.6, chart.Points[1].SocRatio!.Value, 3);
        Assert.Equal(50, chart.Points[1].PowerKw);
        Assert.Equal(60, chart.Points[1].Soc);
    }

    [Fact]
    public void Project_chart_leaves_null_metrics_as_gaps()
    {
        var display = Project(Snapshot(
            Detail(energyWh: 1000),
            Sample(powerKw: null, soc: 50), Sample(powerKw: 20, soc: null)));

        Assert.Null(display.Chart.Points[0].PowerRatio);
        Assert.Equal(0.5, display.Chart.Points[0].SocRatio!.Value, 3);
        Assert.NotNull(display.Chart.Points[1].PowerRatio);
        Assert.Null(display.Chart.Points[1].SocRatio);
    }

    [Fact]
    public void Project_without_telemetry_has_no_chart()
    {
        var display = Project(Snapshot(Detail(energyWh: 5000)));

        Assert.True(display.HasData);
        Assert.False(display.HasChart);
        Assert.Empty(display.Chart.Points);
    }

    [Fact]
    public void Project_null_charger_classifies_as_ac_home()
    {
        var display = Project(Snapshot(Detail(energyWh: 1000, chargerType: null)));
        Assert.Equal(ChargerKind.AcHome, display.Charger);
        Assert.Equal("AC / Home", display.ChargerLabel);
        Assert.Equal(StatusKind.Neutral, display.ChargerStatus);
    }

    [Fact]
    public void Empty_projection_has_no_data_and_a_curve_placeholder()
    {
        var display = ChargingSessionDetailProjection.Empty(new ChargingSessionDetailSize(2, 4), Localizer);

        Assert.False(display.HasData);
        Assert.False(display.HasChart);
        Assert.Empty(display.Stats);
    }

    // ---- Accessibility (Narrator names on every surface) ---------------------------

    [Fact]
    public void Project_publishes_automation_names_for_every_surface()
    {
        var display = Project(Snapshot(
            Detail(energyWh: 20000, chargerType: "supercharger", started: Now, ended: Now.AddMinutes(35)),
            Sample(150, 90)));

        Assert.All(display.Stats, s => Assert.False(string.IsNullOrWhiteSpace(s.AutomationName)));
        Assert.Contains("Energy Added", display.Stats[0].AutomationName);
        Assert.Contains("kWh", display.Stats[0].AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(display.CompactAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Chart.AutomationName));
        Assert.Contains("Power (kW)", display.Chart.AutomationName);
    }

    // ---- Result mapper (status preservation + !detail gate) ------------------------

    [Fact]
    public void Mapper_preserves_loaded_and_parses_snapshot()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":12000,"charger_type":"home"}""");
        var telemetry = new[] { Sample(40) };

        var result = ChargingSessionDetailResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), telemetry);

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(12000, result.Value!.Detail.EnergyAddedWh);
        Assert.Single(result.Value.Telemetry);
    }

    [Fact]
    public void Mapper_collapses_detail_less_payload_to_empty()
    {
        using var doc = JsonDocument.Parse("null");

        var result = ChargingSessionDetailResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), Array.Empty<ChargeTelemetrySample>());

        Assert.Equal(LoadStatus.Empty, result.Status);
    }

    [Fact]
    public void Mapper_preserves_freshness_states()
    {
        using var doc = JsonDocument.Parse("""{"total_energy_added_wh":1000}""");
        var telemetry = Array.Empty<ChargeTelemetrySample>();

        Assert.Equal(LoadStatus.Loading, ChargingSessionDetailResultMapper.Map(RepositoryResult<JsonElement>.Loading(), telemetry).Status);
        Assert.Equal(LoadStatus.Cached, ChargingSessionDetailResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: false), telemetry).Status);
        Assert.Equal(LoadStatus.Refreshing, ChargingSessionDetailResultMapper.Map(RepositoryResult<JsonElement>.Refreshing(doc.RootElement, Now, stale: true), telemetry).Status);
        Assert.Equal(LoadStatus.Empty, ChargingSessionDetailResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now), telemetry).Status);
        Assert.Equal(LoadStatus.Offline, ChargingSessionDetailResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "x")), telemetry).Status);
        Assert.Equal(LoadStatus.Error, ChargingSessionDetailResultMapper.Map(RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), telemetry).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSessionDetailSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_projection()
    {
        using var vm = NewViewModel(Loaded(Snapshot(
            Detail(energyWh: 25000, chargerType: "supercharger", started: Now, ended: Now.AddMinutes(40)),
            Sample(120, 70))));
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Loaded, vm.State);
        Assert.True(vm.Display.HasData);
        Assert.Equal(4, vm.Display.Stats.Count);
        Assert.Equal("25.0", vm.Display.Stats[0].Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSessionDetailSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Empty, vm.State);
        Assert.Equal("No charge sessions", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingSessionDetailSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSessionDetailSnapshot>.Cached(
            Snapshot(Detail(energyWh: 12000), Sample(40)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSessionDetailSnapshot>.OfflineCached(
            Snapshot(Detail(energyWh: 12000), Sample(40)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingSessionDetailSnapshot>.Loading(),
            RepositoryResult<ChargingSessionDetailSnapshot>.Cached(Snapshot(Detail(energyWh: 4000)), Now, stale: false),
            RepositoryResult<ChargingSessionDetailSnapshot>.Loaded(Snapshot(Detail(energyWh: 18000)), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingSessionDetailState.Loaded, vm.State);
        Assert.Equal("18.0", vm.Display.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new ChargingSessionDetailSize(2, 4), Loaded(Snapshot(Detail(energyWh: 12000), Sample(40))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new ChargingSessionDetailSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(ChargingSessionDetailState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingSessionDetailSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge Session Detail", vm.Title);
        Assert.Equal("No charge sessions", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Detail(energyWh: 12000), Sample(40))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargingSessionDetailViewModel.State), changed);
        Assert.Contains(nameof(ChargingSessionDetailViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charging-session-detail", ChargingSessionDetailRegistration.Id);
        Assert.Equal("charging", ChargingSessionDetailRegistration.Category);
        Assert.Equal("ChargingSessionDetailWidget", ChargingSessionDetailRegistration.Slug);
        Assert.Equal(new ChargingSessionDetailSize(2, 4), ChargingSessionDetailRegistration.DefaultSize);
        Assert.Equal(new ChargingSessionDetailSize(1, 2), ChargingSessionDetailRegistration.MinSize);
        Assert.Equal(new ChargingSessionDetailSize(4, 40), ChargingSessionDetailRegistration.MaxSize);
        Assert.Equal("Charge Session Detail", ChargingSessionDetailRegistration.Name(Localizer));
        Assert.Equal(
            "Last charge session power curve with SoC overlay, kWh added, peak power",
            ChargingSessionDetailRegistration.Description(Localizer));
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
        Assert.Equal(within, ChargingSessionDetailRegistration.IsWithinBounds(new ChargingSessionDetailSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargingSessionDetailSize(1, 2), ChargingSessionDetailRegistration.Clamp(new ChargingSessionDetailSize(0, 0)));
        Assert.Equal(new ChargingSessionDetailSize(4, 40), ChargingSessionDetailRegistration.Clamp(new ChargingSessionDetailSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingSessionDetailDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingSessionDetailWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter, sessions → telemetry → detail chain) ---------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargingSessionDetailSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_with_no_sessions_yields_empty_after_listing()
    {
        using var sessions = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(sessions.RootElement);
        var source = new ChargingSessionDetailSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
    }

    [Fact]
    public async Task Source_resolves_primary_then_chains_sessions_telemetry_detail()
    {
        using var sessions = JsonDocument.Parse(
            """[{"id":11,"started_at":"2026-04-01T08:00:00Z"},{"id":55,"started_at":"2026-04-04T10:00:00Z"}]""");
        using var telemetry = JsonDocument.Parse("""[{"created_at":"2026-04-04T10:05:00Z","power_kw":48,"battery_level":60}]""");
        using var detail = JsonDocument.Parse("""{"total_energy_added_wh":42000,"charger_type":"supercharger"}""");

        var api = new FakeApiClient()
            .ReturnsValue(sessions.RootElement)
            .ReturnsValue(telemetry.RootElement)
            .ReturnsValue(detail.RootElement);
        var source = new ChargingSessionDetailSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(42000, terminal.Value!.Detail.EnergyAddedWh);
        Assert.Single(terminal.Value.Telemetry);

        Assert.Equal(3, api.Requests.Count);

        // 1) sessions list scoped by vehicle_id (newest by started_at → id 55).
        Assert.Equal("get_api_v1_charging_sessions", api.Requests[0].OperationId);
        Assert.Equal(7L, Convert.ToInt64(api.Requests[0].Query!["vehicle_id"], CultureInfo.InvariantCulture));

        // 2) telemetry for the resolved session id.
        Assert.Equal("get_api_v1_charging_sessionID_telemetry", api.Requests[1].OperationId);
        Assert.Equal("55", api.Requests[1].PathParams!["sessionID"]);

        // 3) the primary detail read for the resolved session id.
        Assert.Equal("get_api_v1_charging_sessions_sessionID", api.Requests[2].OperationId);
        Assert.Equal("55", api.Requests[2].PathParams!["sessionID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var sessions = JsonDocument.Parse("""[{"id":9,"started_at":"2026-04-04T10:00:00Z"}]""");
        using var telemetry = JsonDocument.Parse("[]");
        using var detail = JsonDocument.Parse("""{"total_energy_added_wh":1000}""");

        var api = new FakeApiClient()
            .ReturnsValue(sessions.RootElement)
            .ReturnsValue(telemetry.RootElement)
            .ReturnsValue(detail.RootElement);
        var source = new ChargingSessionDetailSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(42L, Convert.ToInt64(api.Requests[0].Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_survives_telemetry_failure_with_empty_curve()
    {
        using var sessions = JsonDocument.Parse("""[{"id":9,"started_at":"2026-04-04T10:00:00Z"}]""");
        using var detail = JsonDocument.Parse("""{"total_energy_added_wh":1000}""");

        // sessions ok → telemetry throws (best-effort) → detail ok.
        var api = new FakeApiClient()
            .ReturnsValue(sessions.RootElement)
            .Throws(new InvalidOperationException("telemetry down"))
            .ReturnsValue(detail.RootElement);
        var source = new ChargingSessionDetailSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Empty(terminal.Value!.Telemetry);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<ChargingSessionDetailSnapshot>>> Drain(IChargingSessionDetailSource source)
    {
        var list = new List<RepositoryResult<ChargingSessionDetailSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ChargingSessionDetailSnapshot> Loaded(ChargingSessionDetailSnapshot snapshot) =>
        RepositoryResult<ChargingSessionDetailSnapshot>.Loaded(snapshot, Now);

    private static ChargingSessionDetailViewModel NewViewModel(params RepositoryResult<ChargingSessionDetailSnapshot>[] emissions) =>
        NewViewModel(ChargingSessionDetailSize.Default, emissions);

    private static ChargingSessionDetailViewModel NewViewModel(
        ChargingSessionDetailSize size,
        params RepositoryResult<ChargingSessionDetailSnapshot>[] emissions) =>
        new(new FakeChargingSessionDetailSource(emissions), Localizer, size, () => Now);

    private sealed class FakeChargingSessionDetailSource(params RepositoryResult<ChargingSessionDetailSnapshot>[] emissions) : IChargingSessionDetailSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingSessionDetailSnapshot>> StreamAsync(
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
