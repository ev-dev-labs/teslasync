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
/// Headless verification of the ChargeStatusWidget's UI-thread-free logic — the JSON parse adapter (the
/// useVehicleState normalisation, including rated_range), the power / rate / battery / time-to-full / idle
/// formatters, the charging / idle projection across unit preferences, the state result mapper, the
/// single-endpoint per-vehicle data source (primary resolution, the path-scoped state read), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/ChargeStatusWidget.tsx).
/// </summary>
public sealed class ChargeStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // 1 mile = 1609.344 m, so this is exactly 10 miles of range added per hour.
    private const double TenMilesPerHourMeters = 16_093.44;

    // 250 miles in metres (250 × 1609.344) — exactly 250 mi / 402.336 km of rated range.
    private const double TwoFiftyMilesMeters = 402_336.0;

    private const string ChargingStateJson =
        """{"state":{"vehicle_id":7,"battery_level":80,"is_charging":true,"charger_power":7.2,"charge_rate":16093.44,"time_to_full_charge":2.5,"rated_range":402336}}""";

    // ---- Parse adapter (web useVehicleState normalisation) -------------------------

    [Fact]
    public void FromResponse_reads_primary_state_object_with_all_charge_fields()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);

        var reading = ChargeStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(80, reading!.BatteryLevel);
        Assert.True(reading.IsCharging);
        Assert.Equal(7.2, reading.ChargerPowerKw);
        Assert.Equal(16_093.44, reading.ChargeRateMeters);
        Assert.Equal(2.5, reading.TimeToFullHours);
        Assert.Equal(402_336, reading.RatedRangeMeters);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var reading = ChargeStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(0, reading!.BatteryLevel);
        Assert.False(reading.IsCharging);
        Assert.Equal(0, reading.ChargerPowerKw);
        Assert.Equal(0, reading.ChargeRateMeters);
        Assert.Equal(0, reading.TimeToFullHours);
        Assert.Equal(0, reading.RatedRangeMeters);
    }

    [Fact]
    public void FromResponse_falls_back_to_position_battery_and_top_level_fields()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5},"position":{"battery_level":33},"is_charging":true,"charger_power":11,"charge_rate":2500,"time_to_full_charge":1.5,"rated_range":350000}""");

        var reading = ChargeStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(33, reading!.BatteryLevel);
        Assert.True(reading.IsCharging);
        Assert.Equal(11, reading.ChargerPowerKw);
        Assert.Equal(2500, reading.ChargeRateMeters);
        Assert.Equal(1.5, reading.TimeToFullHours);
        Assert.Equal(350_000, reading.RatedRangeMeters);
    }

    [Fact]
    public void FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"battery_level":55,"is_charging":false,"rated_range":402336}}""");

        var reading = ChargeStatusReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(55, reading!.BatteryLevel);
        Assert.False(reading.IsCharging);
        Assert.Equal(402_336, reading.RatedRangeMeters);
    }

    [Fact]
    public void FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(ChargeStatusReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(ChargeStatusReading.FromResponse(doc.RootElement));
    }

    // ---- Scalar / unit formatters --------------------------------------------------

    [Theory]
    [InlineData(7.2, "7.20 kW")]   // web fmtNumber default precision = 2
    [InlineData(11, "11.00 kW")]
    [InlineData(0, "0.00 kW")]
    public void FormatPower_uses_default_two_fraction_digits(double kw, string expected) =>
        Assert.Equal(expected, ChargeStatusProjection.FormatPower(kw, UnitPref.Metric));

    [Fact]
    public void FormatPower_honours_an_explicit_precision_preference()
    {
        var oneDecimal = UnitPref.Metric with { Precision = 1 };
        Assert.Equal("7.2 kW", ChargeStatusProjection.FormatPower(7.2, oneDecimal));
    }

    [Fact]
    public void FormatRate_honours_distance_preference()
    {
        Assert.Equal("16 km/h", ChargeStatusProjection.FormatRate(TenMilesPerHourMeters, UnitPref.Metric));
        Assert.Equal("10 mi/h", ChargeStatusProjection.FormatRate(TenMilesPerHourMeters, UnitPref.Imperial));
    }

    [Theory]
    [InlineData(80, "80%")]
    [InlineData(80.5, "80.5%")]
    [InlineData(0, "0%")]
    public void FormatBattery_matches_web_interpolation(double value, string expected) =>
        Assert.Equal(expected, ChargeStatusProjection.FormatBattery(value));

    [Theory]
    [InlineData(2.5, "2.5h")]
    [InlineData(1.0, "1.0h")]
    [InlineData(0.5, "0.5h")]
    public void FormatTimeToFull_positive_is_one_decimal_hours(double hours, string expected) =>
        Assert.Equal(expected, ChargeStatusProjection.FormatTimeToFull(hours));

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatTimeToFull_non_positive_or_non_finite_is_em_dash(double hours) =>
        Assert.Equal(ChargeStatusProjection.EmDash, ChargeStatusProjection.FormatTimeToFull(hours));

    [Fact]
    public void FormatIdleSummary_combines_battery_and_rated_range()
    {
        Assert.Equal("55% \u00B7 402 km", ChargeStatusProjection.FormatIdleSummary(55, TwoFiftyMilesMeters, UnitPref.Metric));
        Assert.Equal("55% \u00B7 250 mi", ChargeStatusProjection.FormatIdleSummary(55, TwoFiftyMilesMeters, UnitPref.Imperial));
    }

    // ---- Projection: charging ------------------------------------------------------

    [Fact]
    public void Project_charging_formats_every_metric()
    {
        var view = ChargeStatusProjection.Project(ChargingReading(), UnitPref.Metric, Localizer);

        Assert.True(view.IsCharging);
        Assert.Equal("Charging", view.ChargingLabel);
        Assert.Equal("Power", view.PowerLabel);
        Assert.Equal("7.20 kW", view.PowerText);
        Assert.Equal("Rate", view.RateLabel);
        Assert.Equal("16 km/h", view.RateText);
        Assert.Equal("Battery", view.BatteryLabel);
        Assert.Equal("80%", view.BatteryText);
        Assert.Equal("Time to Full", view.TimeToFullLabel);
        Assert.Equal("2.5h", view.TimeToFullText);
    }

    [Fact]
    public void Project_charging_rate_uses_imperial_distance_unit()
    {
        var view = ChargeStatusProjection.Project(ChargingReading(), UnitPref.Imperial, Localizer);

        Assert.Equal("10 mi/h", view.RateText);
        Assert.Equal("80%", view.BatteryText);
    }

    [Fact]
    public void Project_idle_formats_not_charging_and_summary()
    {
        var view = ChargeStatusProjection.Project(IdleReading(), UnitPref.Metric, Localizer);

        Assert.False(view.IsCharging);
        Assert.Equal("Not Charging", view.NotChargingText);
        Assert.Equal("55% \u00B7 402 km", view.IdleSummaryText);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_charging_automation_name_contains_power_and_battery()
    {
        var view = ChargeStatusProjection.Project(ChargingReading(), UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.ChargingAutomationName));
        Assert.Contains("Charging", view.ChargingAutomationName, StringComparison.Ordinal);
        Assert.Contains("7.20 kW", view.ChargingAutomationName, StringComparison.Ordinal);
        Assert.Contains("80%", view.ChargingAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_idle_automation_name_contains_state_and_summary()
    {
        var view = ChargeStatusProjection.Project(IdleReading(), UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.IdleAutomationName));
        Assert.Contains("Not Charging", view.IdleAutomationName, StringComparison.Ordinal);
        Assert.Contains("55%", view.IdleAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_state()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);

        var cached = ChargeStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(80, cached.Value!.BatteryLevel);

        var offline = ChargeStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(80, offline.Value!.BatteryLevel);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse(ChargingStateJson);

        Assert.Equal(LoadStatus.Loaded, ChargeStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, ChargeStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, ChargeStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_stateless_loaded_body_to_empty()
    {
        // Web parity: a successful response with no `state` makes stateData?.state undefined -> the empty surface.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = ChargeStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_charging_display()
    {
        using var vm = NewViewModel(Loaded(ChargingReading()));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Loaded, vm.State);
        Assert.True(vm.HasState);
        Assert.NotNull(vm.Display);
        Assert.True(vm.Display!.IsCharging);
        Assert.Equal("7.20 kW", vm.Display.PowerText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Empty, vm.State);
        Assert.False(vm.HasState);
        Assert.Null(vm.Display);
        Assert.Equal("No charge data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargeStatusReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargeStatusReading>.Cached(ChargingReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasState);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusReading>.OfflineCached(
            IdleReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Offline, vm.State);
        Assert.True(vm.HasState);
        Assert.True(vm.IsStale);
        Assert.False(vm.Display!.IsCharging);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<ChargeStatusReading>.Loading(),
            RepositoryResult<ChargeStatusReading>.Cached(IdleReading(), Now, stale: false),
            RepositoryResult<ChargeStatusReading>.Loaded(ChargingReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(ChargeStatusState.Loaded, vm.State);
        Assert.True(vm.Display!.IsCharging);
        Assert.Equal("7.20 kW", vm.Display.PowerText);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_rate()
    {
        using var vm = NewViewModel(ChargeStatusSize.Default, UnitPref.Metric, Loaded(ChargingReading()));
        await vm.LoadAsync();
        Assert.Equal("16 km/h", vm.Display!.RateText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("10 mi/h", vm.Display!.RateText);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<ChargeStatusReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Charge Status", vm.Title);
        Assert.Equal("No charge data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(ChargingReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChargeStatusViewModel.State), changed);
        Assert.Contains(nameof(ChargeStatusViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("charge-status", ChargeStatusRegistration.Id);
        Assert.Equal("charging", ChargeStatusRegistration.Category);
        Assert.Equal("ChargeStatusWidget", ChargeStatusRegistration.Slug);
        Assert.Equal(new ChargeStatusSize(2, 2), ChargeStatusRegistration.DefaultSize);
        Assert.Equal(new ChargeStatusSize(1, 2), ChargeStatusRegistration.MinSize);
        Assert.Equal(new ChargeStatusSize(3, 40), ChargeStatusRegistration.MaxSize);
        Assert.Equal("Charge Status", ChargeStatusRegistration.Name(Localizer));
        Assert.Contains("charge state", ChargeStatusRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("charge-status", ChargeStatusRegistration.Id);

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, ChargeStatusRegistration.IsWithinBounds(new ChargeStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new ChargeStatusSize(1, 2), ChargeStatusRegistration.Clamp(new ChargeStatusSize(0, 0)));
        Assert.Equal(new ChargeStatusSize(3, 40), ChargeStatusRegistration.Clamp(new ChargeStatusSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChargeStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargeStatusWidget", Assert.Single(lines));
    }

    // ---- Source (single-endpoint per-vehicle adapter) ------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new ChargeStatusSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_state()
    {
        using var state = JsonDocument.Parse(ChargingStateJson);
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new ChargeStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(80, terminal.Value!.BatteryLevel);
        Assert.True(terminal.Value.IsCharging);

        Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_state", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":50,"is_charging":false}}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new ChargeStatusSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal("42", api.Requests[^1].PathParams!["vehicleID"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(50, results[^1].Value!.BatteryLevel);
    }

    [Fact]
    public async Task Source_stateless_body_collapses_to_empty()
    {
        using var state = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeApiClient().ReturnsValue(state.RootElement);
        var source = new ChargeStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ChargeStatusReading ChargingReading() =>
        new(80, true, 7.2, TenMilesPerHourMeters, 2.5, TwoFiftyMilesMeters);

    private static ChargeStatusReading IdleReading() =>
        new(55, false, 0, 0, 0, TwoFiftyMilesMeters);

    private static async Task<List<RepositoryResult<ChargeStatusReading>>> Drain(IChargeStatusSource source)
    {
        var list = new List<RepositoryResult<ChargeStatusReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<ChargeStatusReading> Loaded(ChargeStatusReading reading) =>
        RepositoryResult<ChargeStatusReading>.Loaded(reading, Now);

    private static ChargeStatusViewModel NewViewModel(params RepositoryResult<ChargeStatusReading>[] emissions) =>
        NewViewModel(ChargeStatusSize.Default, UnitPref.Metric, emissions);

    private static ChargeStatusViewModel NewViewModel(
        ChargeStatusSize size,
        UnitPref units,
        params RepositoryResult<ChargeStatusReading>[] emissions) =>
        new(new FakeChargeStatusSource(emissions), Localizer, size, units);

    private sealed class FakeChargeStatusSource(params RepositoryResult<ChargeStatusReading>[] emissions) : IChargeStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChargeStatusReading>> StreamAsync(
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
