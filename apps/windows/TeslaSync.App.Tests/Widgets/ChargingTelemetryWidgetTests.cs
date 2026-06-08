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
/// Headless verification of the ChargingTelemetryWidget's UI-thread-free logic — the JSON parse adapter (the
/// useChargingTelemetryLatest read), the charger-type + efficiency derivations, the power/voltage/current
/// formatters, the compact / standard / wide projection across footprints, the rolling power-history
/// accumulation, the result mapper, the single-endpoint per-vehicle data source (primary resolution, the
/// query-scoped telemetry read), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx).
/// </summary>
public sealed class ChargingTelemetryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string ChargingJson =
        """{"ts":"2026-06-06T12:00:00Z","charging_state":"Charging","charger_voltage":240,"charger_actual_current":32,"charger_power_w":7400,"charger_phases":1,"charger_pilot_current":40}""";

    private const string IdleJson =
        """{"ts":"2026-06-06T12:00:00Z","charging_state":"Disconnected","charger_voltage":0,"charger_actual_current":0,"charger_power_w":0,"charger_phases":0}""";

    // ---- Parse adapter (web useChargingTelemetryLatest read) -----------------------

    [Fact]
    public void FromResponse_reads_all_charging_fields()
    {
        using var doc = JsonDocument.Parse(ChargingJson);

        var reading = ChargingTelemetryReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("2026-06-06T12:00:00Z", reading!.Ts);
        Assert.Equal("Charging", reading.ChargingState);
        Assert.True(reading.IsCharging);
        Assert.Equal(240, reading.ChargerVoltage);
        Assert.Equal(32, reading.ChargerActualCurrent);
        Assert.Equal(7400, reading.ChargerPowerW);
        Assert.Equal(1, reading.ChargerPhases);
        Assert.Equal(40, reading.ChargerPilotCurrent);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"ts":"t"}""");

        var reading = ChargingTelemetryReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("t", reading!.Ts);
        Assert.Null(reading.ChargingState);
        Assert.False(reading.IsCharging);
        Assert.Equal(0, reading.ChargerVoltage);
        Assert.Equal(0, reading.ChargerActualCurrent);
        Assert.Equal(0, reading.ChargerPowerW);
        Assert.Equal(0, reading.ChargerPhases);
        Assert.Equal(0, reading.ChargerPilotCurrent);
    }

    [Fact]
    public void FromResponse_isCharging_only_for_exact_charging_literal()
    {
        using var idle = JsonDocument.Parse(IdleJson);
        Assert.False(ChargingTelemetryReading.FromResponse(idle.RootElement)!.IsCharging);

        using var stopped = JsonDocument.Parse("""{"ts":"t","charging_state":"Stopped"}""");
        Assert.False(ChargingTelemetryReading.FromResponse(stopped.RootElement)!.IsCharging);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"x\"")]
    [InlineData("5")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(ChargingTelemetryReading.FromResponse(doc.RootElement));
    }

    // ---- Charger-type heuristic (web chargerType memo) -----------------------------

    [Theory]
    [InlineData(240, "AC")]
    [InlineData(300, "AC")]   // boundary: > 300 only
    [InlineData(301, "DC")]
    [InlineData(500, "DC")]
    public void DeriveChargerType_matches_web(double voltage, string expected) =>
        Assert.Equal(expected, ChargingTelemetryProjection.DeriveChargerType(isCharging: true, voltage));

    [Fact]
    public void DeriveChargerType_null_when_not_charging() =>
        Assert.Null(ChargingTelemetryProjection.DeriveChargerType(isCharging: false, voltage: 500));

    // ---- Efficiency formula (web efficiency memo, verbatim) ------------------------

    [Fact]
    public void DeriveEfficiency_null_when_not_charging()
    {
        var reading = Reading(pilot: 40);
        Assert.Null(ChargingTelemetryProjection.DeriveEfficiency(isCharging: false, reading, 240, 1, 7400));
    }

    [Theory]
    [InlineData(0)]   // pilot <= 0
    [InlineData(-3)]
    public void DeriveEfficiency_null_when_pilot_non_positive(double pilot)
    {
        var reading = Reading(pilot: pilot);
        Assert.Null(ChargingTelemetryProjection.DeriveEfficiency(isCharging: true, reading, 240, 1, 7400));
    }

    [Fact]
    public void DeriveEfficiency_null_when_voltage_non_positive()
    {
        var reading = Reading(pilot: 40);
        Assert.Null(ChargingTelemetryProjection.DeriveEfficiency(isCharging: true, reading, 0, 1, 7400));
    }

    [Fact]
    public void DeriveEfficiency_clamps_to_100()
    {
        // theoretical = 40 * 240 * 1 / 1000 = 9.6; power (watts, web-literal) = 7400 -> 77083% -> clamp 100.
        var reading = Reading(pilot: 40);
        var eff = ChargingTelemetryProjection.DeriveEfficiency(isCharging: true, reading, 240, 1, 7400);
        Assert.Equal(100, eff);
    }

    [Fact]
    public void DeriveEfficiency_uses_phase_multiplier_floor_of_one()
    {
        // phases = 0 -> multiplier 1: theoretical = 10 * 100 * 1 / 1000 = 1.0; power 0.5 -> 50%.
        var reading = Reading(pilot: 10);
        var eff = ChargingTelemetryProjection.DeriveEfficiency(isCharging: true, reading, 100, 0, 0.5);
        Assert.Equal(50, eff);
    }

    // ---- Power formatter (web fmtNumber(power, 1) + " kW") -------------------------

    [Theory]
    [InlineData(7400, "7,400.0 kW")]
    [InlineData(7.2, "7.2 kW")]
    [InlineData(0, "0.0 kW")]
    public void FormatPower_matches_web(double power, string expected) =>
        Assert.Equal(expected, ChargingTelemetryProjection.FormatPower(power));

    // ---- Size / footprint flags (web isCompact / isWide) ---------------------------

    [Theory]
    [InlineData(2, 2, false, false)]  // default
    [InlineData(1, 2, true, false)]   // compact / min
    [InlineData(4, 2, false, true)]   // wide
    [InlineData(4, 40, false, true)]  // max
    public void Size_flags_match_web(int cols, int rows, bool compact, bool wide)
    {
        var size = new ChargingTelemetrySize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
    }

    // ---- Projection: charging (standard) -------------------------------------------

    [Fact]
    public void Project_charging_standard_builds_core_stats()
    {
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(), Array.Empty<double>(), ChargingTelemetrySize.Default, Localizer);

        Assert.True(view.IsCharging);
        Assert.False(view.IsCompact);
        Assert.False(view.IsWide);
        Assert.Equal(2, view.StatColumns);
        Assert.Equal("7,400.0 kW", view.PowerText);
        Assert.Equal("240V \u00b7 32A", view.VoltageCurrentText);

        Assert.Equal(4, view.Stats.Count); // no efficiency when not wide
        Assert.Equal("Voltage", view.Stats[0].Label);
        Assert.Equal("240", view.Stats[0].Value);
        Assert.Equal("V", view.Stats[0].Unit);
        Assert.Equal("Current", view.Stats[1].Label);
        Assert.Equal("32", view.Stats[1].Value);
        Assert.Equal("A", view.Stats[1].Unit);
        Assert.Equal("Power", view.Stats[2].Label);
        Assert.Equal("7,400.0", view.Stats[2].Value);
        Assert.Equal("kW", view.Stats[2].Unit);
        Assert.True(view.Stats[2].Emphasize); // web valueColor: text-emerald-300
        Assert.Equal("Phases", view.Stats[3].Label);
        Assert.Equal("1", view.Stats[3].Value);
    }

    [Fact]
    public void Project_charging_phases_zero_renders_em_dash()
    {
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(phases: 0), Array.Empty<double>(), ChargingTelemetrySize.Default, Localizer);

        Assert.Equal(ChargingTelemetryProjection.EmDash, view.Stats[3].Value);
        Assert.Equal(string.Empty, view.Stats[3].Unit);
    }

    [Fact]
    public void Project_charging_ac_badge_for_low_voltage()
    {
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(voltage: 240), Array.Empty<double>(), ChargingTelemetrySize.Default, Localizer);

        Assert.Equal("AC", view.ChargerType);
        Assert.Equal("AC Charger", view.ChargerBadgeText);
        Assert.Equal(StatusKind.Neutral, view.ChargerBadgeStatus);
    }

    // ---- Projection: charging (wide) -----------------------------------------------

    [Fact]
    public void Project_charging_wide_adds_efficiency_and_dc_badge()
    {
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(voltage: 500), Array.Empty<double>(), new ChargingTelemetrySize(4, 2), Localizer);

        Assert.True(view.IsWide);
        Assert.Equal(4, view.StatColumns);
        Assert.Equal(5, view.Stats.Count);
        Assert.Equal("Efficiency", view.Stats[4].Label);
        Assert.Equal("%", view.Stats[4].Unit);
        Assert.Equal("100", view.Stats[4].Value); // clamp (web-literal watt-as-power)

        Assert.Equal("DC", view.ChargerType);
        Assert.Equal("DC Charger", view.ChargerBadgeText);
        Assert.Equal(StatusKind.Warning, view.ChargerBadgeStatus);
    }

    [Fact]
    public void Project_charging_wide_omits_efficiency_when_not_computable()
    {
        // pilot 0 -> efficiency null -> no Efficiency tile even when wide.
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(pilot: 0), Array.Empty<double>(), new ChargingTelemetrySize(4, 2), Localizer);

        Assert.Equal(4, view.Stats.Count);
        Assert.DoesNotContain(view.Stats, s => s.Label == "Efficiency");
    }

    [Fact]
    public void Project_sparkline_visible_only_when_wide_with_history()
    {
        var history = new double[] { 100, 200, 300 };

        var wide = ChargingTelemetryProjection.Project(ChargingSnapshot(), history, new ChargingTelemetrySize(4, 2), Localizer);
        Assert.True(wide.ShowSparkline);
        Assert.Equal(history, wide.PowerHistory);

        var standard = ChargingTelemetryProjection.Project(ChargingSnapshot(), history, ChargingTelemetrySize.Default, Localizer);
        Assert.False(standard.ShowSparkline); // not wide

        var sparse = ChargingTelemetryProjection.Project(ChargingSnapshot(), new double[] { 100 }, new ChargingTelemetrySize(4, 2), Localizer);
        Assert.False(sparse.ShowSparkline); // history.length <= 1
    }

    // ---- Projection: not charging --------------------------------------------------

    [Fact]
    public void Project_not_charging_has_no_stats_and_no_badge()
    {
        var view = ChargingTelemetryProjection.Project(
            IdleSnapshot(), Array.Empty<double>(), ChargingTelemetrySize.Default, Localizer);

        Assert.False(view.IsCharging);
        Assert.Empty(view.Stats);
        Assert.Null(view.ChargerType);
        Assert.Null(view.ChargerBadgeText);
        Assert.Equal("Not currently charging", view.NotChargingText);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_stat_automation_names_combine_label_value_unit()
    {
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(), Array.Empty<double>(), ChargingTelemetrySize.Default, Localizer);

        Assert.Equal("Voltage 240 V", view.Stats[0].AutomationName);
        Assert.Equal("Power 7,400.0 kW", view.Stats[2].AutomationName);
        Assert.Equal("Phases 1", view.Stats[3].AutomationName); // no unit
    }

    [Fact]
    public void Project_charging_automation_name_contains_power_and_voltage_current()
    {
        var view = ChargingTelemetryProjection.Project(
            ChargingSnapshot(), Array.Empty<double>(), ChargingTelemetrySize.Default, Localizer);

        Assert.Contains("7,400.0 kW", view.ChargingAutomationName, StringComparison.Ordinal);
        Assert.Contains("240V \u00b7 32A", view.ChargingAutomationName, StringComparison.Ordinal);
        Assert.Equal("7,400.0 kW, 240V \u00b7 32A", view.CompactAutomationName);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_reading()
    {
        using var doc = JsonDocument.Parse(ChargingJson);

        var cached = ChargingTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.Reading.IsCharging);
        Assert.Equal(240, cached.Value.Reading.ChargerVoltage);

        var offline = ChargingTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(7400, offline.Value!.Reading.ChargerPowerW);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ChargingJson);

        Assert.Equal(LoadStatus.Loaded, ChargingTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ChargingTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargingTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_null_body_to_empty()
    {
        // Web parity: a successful response with no telemetry row (data == null) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = ChargingTelemetryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingTelemetrySnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_charging_display()
    {
        using var vm = NewViewModel(Loaded(ChargingSnapshot()));
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Loaded, vm.State);
        Assert.True(vm.HasReading);
        Assert.NotNull(vm.Display);
        Assert.True(vm.Display!.IsCharging);
        Assert.Equal("7,400.0 kW", vm.Display.PowerText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingTelemetrySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Empty, vm.State);
        Assert.False(vm.HasReading);
        Assert.Null(vm.Display);
        Assert.Equal("Not currently charging", vm.NotChargingMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingTelemetrySnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingTelemetrySnapshot>.Cached(ChargingSnapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasReading);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingTelemetrySnapshot>.OfflineCached(
            IdleSnapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Offline, vm.State);
        Assert.True(vm.HasReading);
        Assert.True(vm.IsStale);
        Assert.False(vm.Display!.IsCharging);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargingTelemetrySnapshot>.Loading(),
            RepositoryResult<ChargingTelemetrySnapshot>.Cached(IdleSnapshot(), Now, stale: false),
            RepositoryResult<ChargingTelemetrySnapshot>.Loaded(ChargingSnapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargingTelemetryState.Loaded, vm.State);
        Assert.True(vm.Display!.IsCharging);
    }

    // ---- Power-history accumulation (web powerHistoryRef) --------------------------

    [Fact]
    public async Task ViewModel_accumulates_one_power_sample_per_distinct_ts()
    {
        using var vm = NewViewModel(
            new ChargingTelemetrySize(4, 2),
            RepositoryResult<ChargingTelemetrySnapshot>.Loaded(ChargingSnapshot(power: 100, ts: "A"), Now),
            RepositoryResult<ChargingTelemetrySnapshot>.Loaded(ChargingSnapshot(power: 200, ts: "B"), Now),
            RepositoryResult<ChargingTelemetrySnapshot>.Loaded(ChargingSnapshot(power: 999, ts: "B"), Now)); // same ts -> ignored
        await vm.LoadAsync();

        Assert.Equal(new double[] { 100, 200 }, vm.Display!.PowerHistory);
        Assert.True(vm.Display.ShowSparkline);
    }

    [Fact]
    public async Task ViewModel_size_change_preserves_power_history()
    {
        using var vm = NewViewModel(
            new ChargingTelemetrySize(4, 2),
            RepositoryResult<ChargingTelemetrySnapshot>.Loaded(ChargingSnapshot(power: 100, ts: "A"), Now),
            RepositoryResult<ChargingTelemetrySnapshot>.Loaded(ChargingSnapshot(power: 200, ts: "B"), Now));
        await vm.LoadAsync();
        Assert.Equal(2, vm.Display!.PowerHistory.Count);

        vm.Size = ChargingTelemetrySize.Default; // re-project, no new sample
        Assert.Equal(2, vm.Display!.PowerHistory.Count);
        Assert.False(vm.Display.ShowSparkline); // narrowed below wide
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_wide()
    {
        using var vm = NewViewModel(ChargingTelemetrySize.Default, Loaded(ChargingSnapshot(pilot: 40)));
        await vm.LoadAsync();
        Assert.Equal(4, vm.Display!.Stats.Count); // no efficiency at standard

        vm.Size = new ChargingTelemetrySize(4, 2);
        Assert.Equal(5, vm.Display!.Stats.Count); // efficiency appears when wide
        Assert.Equal(ChargingTelemetryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargingTelemetrySnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charging Telemetry", vm.Title);
        Assert.Equal("Not currently charging", vm.NotChargingMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(ChargingSnapshot()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargingTelemetryViewModel.State), changed);
        Assert.Contains(nameof(ChargingTelemetryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charging-telemetry", ChargingTelemetryRegistration.Id);
        Assert.Equal("charging", ChargingTelemetryRegistration.Category);
        Assert.Equal("ChargingTelemetryWidget", ChargingTelemetryRegistration.Slug);
        Assert.Equal(new ChargingTelemetrySize(2, 2), ChargingTelemetryRegistration.DefaultSize);
        Assert.Equal(new ChargingTelemetrySize(1, 2), ChargingTelemetryRegistration.MinSize);
        Assert.Equal(new ChargingTelemetrySize(4, 40), ChargingTelemetryRegistration.MaxSize);
        Assert.Equal("Charging Telemetry", ChargingTelemetryRegistration.Name(Localizer));
        Assert.Contains("Live charging", ChargingTelemetryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(5, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargingTelemetryRegistration.IsWithinBounds(new ChargingTelemetrySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargingTelemetrySize(1, 2), ChargingTelemetryRegistration.Clamp(new ChargingTelemetrySize(0, 0)));
        Assert.Equal(new ChargingTelemetrySize(4, 40), ChargingTelemetryRegistration.Clamp(new ChargingTelemetrySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargingTelemetryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargingTelemetryWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargingTelemetrySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_telemetry()
    {
        using var telemetry = JsonDocument.Parse(ChargingJson);
        var api = new FakeApiClient().ReturnsValue(telemetry.RootElement);
        var source = new ChargingTelemetrySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.Reading.IsCharging);
        Assert.Equal(240, terminal.Value.Reading.ChargerVoltage);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_telemetry_latest", request.OperationId);
        Assert.Equal(7L, Assert.IsType<long>(request.Query!["vehicle_id"]));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var telemetry = JsonDocument.Parse(IdleJson);
        var api = new FakeApiClient().ReturnsValue(telemetry.RootElement);
        var source = new ChargingTelemetrySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Assert.IsType<long>(api.Requests[^1].Query!["vehicle_id"]));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.False(results[^1].Value!.Reading.IsCharging);
    }

    [Fact]
    public async Task Source_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(nullBody.RootElement);
        var source = new ChargingTelemetrySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ChargingTelemetryReading Reading(double pilot) =>
        new("t", "Charging", 240, 32, 7400, 1, pilot);

    private static ChargingTelemetrySnapshot ChargingSnapshot(
        double voltage = 240,
        double current = 32,
        double power = 7400,
        double phases = 1,
        double pilot = 40,
        string ts = "2026-06-06T12:00:00Z") =>
        new(new ChargingTelemetryReading(ts, "Charging", voltage, current, power, phases, pilot));

    private static ChargingTelemetrySnapshot IdleSnapshot(string ts = "2026-06-06T12:00:00Z") =>
        new(new ChargingTelemetryReading(ts, "Disconnected", 0, 0, 0, 0, 0));

    private static async Task<List<RepositoryResult<ChargingTelemetrySnapshot>>> Drain(IChargingTelemetrySource source)
    {
        var list = new List<RepositoryResult<ChargingTelemetrySnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ChargingTelemetrySnapshot> Loaded(ChargingTelemetrySnapshot snapshot) =>
        RepositoryResult<ChargingTelemetrySnapshot>.Loaded(snapshot, Now);

    private static ChargingTelemetryViewModel NewViewModel(params RepositoryResult<ChargingTelemetrySnapshot>[] emissions) =>
        NewViewModel(ChargingTelemetrySize.Default, emissions);

    private static ChargingTelemetryViewModel NewViewModel(
        ChargingTelemetrySize size,
        params RepositoryResult<ChargingTelemetrySnapshot>[] emissions) =>
        new(new FakeChargingTelemetrySource(emissions), Localizer, size);

    private sealed class FakeChargingTelemetrySource(params RepositoryResult<ChargingTelemetrySnapshot>[] emissions) : IChargingTelemetrySource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargingTelemetrySnapshot>> StreamAsync(
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
