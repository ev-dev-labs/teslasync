using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
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
/// Headless verification of the ChargeStatusLiveWidget's UI-thread-free logic — the JSON parse adapters (the
/// useVehicleState normalisation + the newest-session pick), the <c>formatTime</c> / percent / energy / rate
/// formatters, the compact / charging / idle projection across footprints + unit preferences, the
/// state+session result mapper, the two-endpoint per-vehicle data source (primary resolution, the best-effort
/// session read, the path-scoped state read), the registry metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web
/// spec (web/src/features/dashboard/widgets/ChargeStatusLiveWidget.tsx).
/// </summary>
public sealed class ChargeStatusLiveWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // 1 mile = 1609.344 m, so this is exactly 10 miles of range added per hour.
    private const double TenMilesPerHourMeters = 16_093.44;

    private const string ChargingStateJson =
        """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true,"charger_power":7.2,"charge_rate":16093.44,"time_to_full_charge":2.5}}""";

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object_with_all_charging_fields()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);

        var state = VehicleChargeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(80, state!.BatteryLevel);
        Assert.True(state.IsCharging);
        Assert.Equal(7.2, state.ChargerPowerKw);
        Assert.Equal(16_093.44, state.ChargeRateMeters);
        Assert.Equal(2.5, state.TimeToFullHours);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var state = VehicleChargeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(0, state!.BatteryLevel);
        Assert.False(state.IsCharging);
        Assert.Equal(0, state.ChargerPowerKw);
        Assert.Equal(0, state.ChargeRateMeters);
        Assert.Equal(0, state.TimeToFullHours);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_battery_and_top_level_charging_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"battery_level":33},"is_charging":true,"charger_power":11,"charge_rate":2500,"time_to_full_charge":1.5}""");

        var state = VehicleChargeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(33, state!.BatteryLevel);
        Assert.True(state.IsCharging);
        Assert.Equal(11, state.ChargerPowerKw);
        Assert.Equal(2500, state.ChargeRateMeters);
        Assert.Equal(1.5, state.TimeToFullHours);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"battery_level":55,"is_charging":false}}""");

        var state = VehicleChargeState.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(55, state!.BatteryLevel);
        Assert.False(state.IsCharging);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(VehicleChargeState.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleChargeState.FromResponse(doc.RootElement));
    }

    // ---- Session parse adapter (web (sessions ?? [])[0]) ---------------------------

    [Fact]
    public void ParseLatest_reads_newest_session_energy()
    {
        using var doc = JsonDocument.Parse(
            """[{"total_energy_added_wh":12340},{"total_energy_added_wh":99}]""");

        var session = ChargeStatusLiveSession.ParseLatest(doc.RootElement);

        Assert.NotNull(session);
        Assert.Equal(12340, session!.EnergyAddedWh); // first row wins (web [0])
    }

    [Fact]
    public void ParseLatest_returns_session_with_zero_energy_when_field_absent()
    {
        using var doc = JsonDocument.Parse("""[{}]""");

        var session = ChargeStatusLiveSession.ParseLatest(doc.RootElement);

        Assert.NotNull(session); // presence drives the web {latestSession && …} gate
        Assert.Equal(0, session!.EnergyAddedWh);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("null")]
    public void ParseLatest_returns_null_for_empty_or_non_array(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(ChargeStatusLiveSession.ParseLatest(doc.RootElement));
    }

    // ---- formatTime (web parity, including its no-carry edge) ----------------------

    [Theory]
    [InlineData(2.5, "2h 30m")]
    [InlineData(0.5, "30m")]
    [InlineData(3.0, "3h")]
    [InlineData(1.25, "1h 15m")]
    [InlineData(1.999, "1h 60m")] // web Math.round((1.999-1)*60)=60 with no carry — reproduced verbatim
    public void FormatTime_matches_web(double hours, string expected) =>
        Assert.Equal(expected, ChargeStatusLiveProjection.FormatTime(hours));

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatTime_non_positive_or_non_finite_is_em_dash(double hours) =>
        Assert.Equal(ChargeStatusLiveProjection.EmDash, ChargeStatusLiveProjection.FormatTime(hours));

    // ---- Scalar / unit formatters --------------------------------------------------

    [Theory]
    [InlineData(80, "80%")]
    [InlineData(80.5, "80.5%")]
    [InlineData(0, "0%")]
    public void FormatPercent_matches_web_interpolation(double value, string expected) =>
        Assert.Equal(expected, ChargeStatusLiveProjection.FormatPercent(value));

    [Theory]
    [InlineData(12340, "12.3 kWh")]
    [InlineData(8000, "8.0 kWh")]
    [InlineData(0, "0.0 kWh")]
    public void FormatEnergyKwh_converts_wh_to_kwh_one_decimal(double wh, string expected) =>
        Assert.Equal(expected, ChargeStatusLiveProjection.FormatEnergyKwh(wh));

    [Fact]
    public void FormatRate_honours_distance_preference()
    {
        Assert.Equal("16 km/h", ChargeStatusLiveProjection.FormatRate(TenMilesPerHourMeters, UnitPref.Metric));
        Assert.Equal("10 mi/h", ChargeStatusLiveProjection.FormatRate(TenMilesPerHourMeters, UnitPref.Imperial));
    }

    // ---- Size / footprint flags (web isCompact / isTall) ---------------------------

    [Theory]
    [InlineData(2, 2, false, true)]   // default
    [InlineData(1, 1, true, false)]   // compact
    [InlineData(1, 2, false, true)]   // min footprint
    [InlineData(3, 40, false, true)]  // max footprint
    public void Size_flags_match_web(int cols, int rows, bool compact, bool tall)
    {
        var size = new ChargeStatusLiveSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(tall, size.IsTall);
    }

    // ---- Projection: charging ------------------------------------------------------

    [Fact]
    public void Project_charging_standard_formats_every_metric()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(80, true, 7.2, TenMilesPerHourMeters, 2.5),
            new ChargeStatusLiveSession(12340));

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.True(view.IsCharging);
        Assert.False(view.IsCompact);
        Assert.True(view.IsTall);
        Assert.True(view.HasSession);
        Assert.Equal(7.2, view.PowerValue);
        Assert.Equal("7.2 kW", view.PowerText);
        Assert.Equal("80%", view.BatteryPercentText);
        Assert.Equal("Charging", view.ChargingBadgeLabel);
        Assert.Equal("Voltage", view.Voltage.Label);
        Assert.Equal(ChargeStatusLiveProjection.EmDash, view.Voltage.Value);
        Assert.Equal("Current", view.Current.Label);
        Assert.Equal(ChargeStatusLiveProjection.EmDash, view.Current.Value);
        Assert.Equal("Time Left", view.TimeLeft.Label);
        Assert.Equal("2h 30m", view.TimeLeft.Value);
        Assert.Equal("Added", view.Added.Label);
        Assert.Equal("12.3 kWh", view.Added.Value);
        Assert.Equal("Rate", view.Rate.Label);
        Assert.Equal("16 km/h", view.Rate.Value);
        Assert.Equal("Battery", view.Battery.Label);
        Assert.Equal("80%", view.Battery.Value);
    }

    [Fact]
    public void Project_charging_added_defaults_to_zero_without_session()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(80, true, 7.2, 0, 0),
            LatestSession: null);

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.False(view.HasSession);
        Assert.Equal("0.0 kWh", view.Added.Value); // web energyAdded ?? 0
    }

    [Fact]
    public void Project_charging_rate_uses_imperial_distance_unit()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(80, true, 7.2, TenMilesPerHourMeters, 2.5),
            new ChargeStatusLiveSession(12340));

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Imperial, Localizer);

        Assert.Equal("10 mi/h", view.Rate.Value);
        Assert.Equal("12.3 kWh", view.Added.Value); // energy is always kWh (web hard-codes it)
    }

    [Fact]
    public void Project_compact_sets_compact_flag()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(80, true, 7.2, 0, 0), null);

        var view = ChargeStatusLiveProjection.Project(snapshot, new ChargeStatusLiveSize(1, 1), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        Assert.False(view.IsTall);
    }

    // ---- Projection: idle ----------------------------------------------------------

    [Fact]
    public void Project_idle_without_session_hides_last_session()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(55, false, 0, 0, 0), null);

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.False(view.IsCharging);
        Assert.False(view.HasSession);
        Assert.Equal("Not Charging", view.NotChargingText);
        Assert.Equal("55%", view.BatteryPercentText);
    }

    [Fact]
    public void Project_idle_with_session_formats_last_session_line()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(55, false, 0, 0, 0),
            new ChargeStatusLiveSession(8000));

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.True(view.HasSession);
        Assert.Equal("Last Session", view.LastSessionLabel);
        Assert.Equal("+8.0 kWh", view.LastSessionValue);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_charging_automation_name_contains_power_and_battery()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(80, true, 7.2, 0, 0), new ChargeStatusLiveSession(0));

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.ChargingAutomationName));
        Assert.Contains("7.2 kW", view.ChargingAutomationName, StringComparison.Ordinal);
        Assert.Contains("80%", view.ChargingAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_idle_automation_name_contains_battery()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(55, false, 0, 0, 0), null);

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.IdleAutomationName));
        Assert.Contains("55%", view.IdleAutomationName, StringComparison.Ordinal);
        Assert.Contains("Not Charging", view.IdleAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_cells_carry_label_and_value_automation_names()
    {
        var snapshot = new ChargeStatusLiveSnapshot(
            new VehicleChargeState(80, true, 7.2, TenMilesPerHourMeters, 2.5),
            new ChargeStatusLiveSession(12340));

        var view = ChargeStatusLiveProjection.Project(snapshot, ChargeStatusLiveSize.Default, UnitPref.Metric, Localizer);

        Assert.Equal("Time Left 2h 30m", view.TimeLeft.AutomationName);
        Assert.Equal("Added 12.3 kWh", view.Added.AutomationName);
        Assert.Equal("Rate 16 km/h", view.Rate.AutomationName);
        Assert.Equal("Battery 80%", view.Battery.AutomationName);
    }

    // ---- Result mapper (parse + combine session + preserve status) -----------------

    [Fact]
    public void Mapper_preserves_status_and_attaches_session()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);
        var session = new ChargeStatusLiveSession(12340);

        var cached = ChargeStatusLiveResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), session);

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(80, cached.Value!.State.BatteryLevel);
        Assert.Same(session, cached.Value.LatestSession);

        var offline = ChargeStatusLiveResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            session: null);

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(80, offline.Value!.State.BatteryLevel);
        Assert.Null(offline.Value.LatestSession);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);

        Assert.Equal(LoadStatus.Loaded, ChargeStatusLiveResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), new ChargeStatusLiveSession(1)).Status);

        Assert.Equal(LoadStatus.Empty, ChargeStatusLiveResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), null).Status);

        Assert.Equal(LoadStatus.Error, ChargeStatusLiveResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), null).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> the empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = ChargeStatusLiveResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), new ChargeStatusLiveSession(5));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusLiveSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_charging_display()
    {
        using var vm = NewViewModel(Loaded(ChargingSnapshot()));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.True(vm.Display!.IsCharging);
        Assert.Equal("7.2 kW", vm.Display.PowerText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusLiveSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
        Assert.Equal("No charge data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargeStatusLiveSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargeStatusLiveSnapshot>.Cached(ChargingSnapshot(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasState);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusLiveSnapshot>.OfflineCached(
            IdleSnapshot(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Offline, vm.State);
        Assert.True(vm.HasState);
        Assert.True(vm.IsStale);
        Assert.False(vm.Display!.IsCharging);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargeStatusLiveSnapshot>.Loading(),
            RepositoryResult<ChargeStatusLiveSnapshot>.Cached(IdleSnapshot(), Now, stale: false),
            RepositoryResult<ChargeStatusLiveSnapshot>.Loaded(ChargingSnapshot(), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusLiveState.Loaded, vm.State);
        Assert.True(vm.Display!.IsCharging);
        Assert.Equal("7.2 kW", vm.Display.PowerText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(ChargeStatusLiveSize.Default, UnitPref.Metric, Loaded(ChargingSnapshot()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new ChargeStatusLiveSize(1, 1);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal(ChargeStatusLiveState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_rate()
    {
        using var vm = NewViewModel(ChargeStatusLiveSize.Default, UnitPref.Metric, Loaded(ChargingSnapshot()));
        await vm.LoadAsync();
        Assert.Equal("16 km/h", vm.Display!.Rate.Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("10 mi/h", vm.Display!.Rate.Value);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusLiveSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge Status", vm.Title);
        Assert.Equal("No charge data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(ChargingSnapshot()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargeStatusLiveViewModel.State), changed);
        Assert.Contains(nameof(ChargeStatusLiveViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charge-status-live", ChargeStatusLiveRegistration.Id);
        Assert.Equal("charging", ChargeStatusLiveRegistration.Category);
        Assert.Equal("ChargeStatusLiveWidget", ChargeStatusLiveRegistration.Slug);
        Assert.Equal(new ChargeStatusLiveSize(2, 2), ChargeStatusLiveRegistration.DefaultSize);
        Assert.Equal(new ChargeStatusLiveSize(1, 2), ChargeStatusLiveRegistration.MinSize);
        Assert.Equal(new ChargeStatusLiveSize(3, 40), ChargeStatusLiveRegistration.MaxSize);
        Assert.Equal("Charge Status Live", ChargeStatusLiveRegistration.Name(Localizer));
        Assert.Contains("Live charging", ChargeStatusLiveRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargeStatusLiveRegistration.IsWithinBounds(new ChargeStatusLiveSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargeStatusLiveSize(1, 2), ChargeStatusLiveRegistration.Clamp(new ChargeStatusLiveSize(0, 0)));
        Assert.Equal(new ChargeStatusLiveSize(3, 40), ChargeStatusLiveRegistration.Clamp(new ChargeStatusLiveSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargeStatusLiveDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargeStatusLiveWidget", Assert.Single(lines));
    }

    // ---- Source (two-endpoint per-vehicle adapter) ---------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargeStatusLiveSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_session_then_state()
    {
        using var sessions = JsonDocument.Parse("""[{"total_energy_added_wh":12340}]""");
        using var state = JsonDocument.Parse(ChargingStateJson);
        var api = new FakeApiClient()
            .ReturnsValue(sessions.RootElement) // session read happens first
            .ReturnsValue(state.RootElement);
        var source = new ChargeStatusLiveSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(80, terminal.Value!.State.BatteryLevel);
        Assert.True(terminal.Value.State.IsCharging);
        Assert.NotNull(terminal.Value.LatestSession);
        Assert.Equal(12340, terminal.Value.LatestSession!.EnergyAddedWh);

        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_charging_sessions", api.Requests[0].OperationId);
        Assert.Equal(7L, Assert.IsType<long>(api.Requests[0].Query!["vehicle_id"]));
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var sessions = JsonDocument.Parse("[]");
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":50,"is_charging":false}}""");
        var api = new FakeApiClient().ReturnsValue(sessions.RootElement).ReturnsValue(state.RootElement);
        var source = new ChargeStatusLiveSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal("42", api.Requests[^1].PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Null(results[^1].Value!.LatestSession); // empty session list -> no latest session
    }

    [Fact]
    public async Task Source_stateless_body_collapses_to_empty()
    {
        using var sessions = JsonDocument.Parse("[]");
        using var state = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeApiClient().ReturnsValue(sessions.RootElement).ReturnsValue(state.RootElement);
        var source = new ChargeStatusLiveSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    [Fact]
    public async Task Source_session_failure_does_not_fail_the_surface()
    {
        using var state = JsonDocument.Parse(ChargingStateJson);
        var api = new FakeApiClient()
            .Throws(new HttpRequestException("sessions down")) // best-effort session read fails
            .ReturnsValue(state.RootElement);
        var source = new ChargeStatusLiveSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status); // state still loads
        Assert.Equal(80, terminal.Value!.State.BatteryLevel);
        Assert.Null(terminal.Value.LatestSession); // session collapses to null, never throws
        Assert.Equal(2, api.Requests.Count);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ChargeStatusLiveSnapshot ChargingSnapshot() => new(
        new VehicleChargeState(80, true, 7.2, TenMilesPerHourMeters, 2.5),
        new ChargeStatusLiveSession(12340));

    private static ChargeStatusLiveSnapshot IdleSnapshot() => new(
        new VehicleChargeState(55, false, 0, 0, 0), null);

    private static async Task<List<RepositoryResult<ChargeStatusLiveSnapshot>>> Drain(IChargeStatusLiveSource source)
    {
        var list = new List<RepositoryResult<ChargeStatusLiveSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ChargeStatusLiveSnapshot> Loaded(ChargeStatusLiveSnapshot snapshot) =>
        RepositoryResult<ChargeStatusLiveSnapshot>.Loaded(snapshot, Now);

    private static ChargeStatusLiveViewModel NewViewModel(params RepositoryResult<ChargeStatusLiveSnapshot>[] emissions) =>
        NewViewModel(ChargeStatusLiveSize.Default, UnitPref.Metric, emissions);

    private static ChargeStatusLiveViewModel NewViewModel(
        ChargeStatusLiveSize size,
        UnitPref units,
        params RepositoryResult<ChargeStatusLiveSnapshot>[] emissions) =>
        new(new FakeChargeStatusLiveSource(emissions), Localizer, size, units);

    private sealed class FakeChargeStatusLiveSource(params RepositoryResult<ChargeStatusLiveSnapshot>[] emissions) : IChargeStatusLiveSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargeStatusLiveSnapshot>> StreamAsync(
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
