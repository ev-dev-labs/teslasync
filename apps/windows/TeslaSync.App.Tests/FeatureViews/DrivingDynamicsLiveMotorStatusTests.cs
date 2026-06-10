using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the driving-dynamics <c>LiveMotorStatus</c> feature surface's UI-thread-free logic —
/// the JSON parse adapter (the useMotorLatest read of shift / rpm / torque / temperature fields), the projection
/// (three radial gauges + the shift chip, the front+rear torque sum, the SI→display temperature conversion and the
/// "Awaiting data" fallback, the accessible names), the cache-then-network result mapper, the per-vehicle data
/// source (primary resolution + query-scoped request), the registry metadata, the PII-safe diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline) plus the
/// units re-projection. Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx). The WinUI view itself is exercised
/// by the app build. Named distinctly from the drivetrain-health <c>LiveMotorStatusTests</c> so both surfaces'
/// suites coexist.
/// </summary>
public sealed class DrivingDynamicsLiveMotorStatusTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 5, 0, TimeSpan.Zero);

    private const string DegreesC = "\u00B0C";
    private const string DegreesF = "\u00B0F";

    private static MotorLiveReading Reading(
        string? shiftState = "D",
        double? rpmFront = 950,
        double? torqueFront = 250,
        double? torqueRear = 180,
        double? tempFront = 45,
        double? tempRear = 40) =>
        new(shiftState, rpmFront, torqueFront, torqueRear, tempFront, tempRear);

    // ── Parse adapter (web useMotorLatest read) ───────────────────────────────────────────────────────

    [Fact]
    public void FromResponse_reads_all_motor_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"shift_state":"D","motor_rpm_front":950,"torque_nm_front":250,"torque_nm_rear":180,
             "motor_temp_c_front":45,"motor_temp_c_rear":40}
            """);

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("D", reading!.ShiftState);
        Assert.Equal(950, reading.MotorRpmFront);
        Assert.Equal(250, reading.TorqueNmFront);
        Assert.Equal(180, reading.TorqueNmRear);
        Assert.Equal(45, reading.MotorTempCFront);
        Assert.Equal(40, reading.MotorTempCRear);
    }

    [Fact]
    public void FromResponse_reads_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"torque_nm_front":"250.5","motor_rpm_front":"1200"}""");

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.Equal(250.5, reading!.TorqueNmFront);
        Assert.Equal(1200, reading.MotorRpmFront);
    }

    [Fact]
    public void FromResponse_drops_non_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"motor_rpm_front":"abc","torque_nm_rear":""}""");

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.Null(reading!.MotorRpmFront);
        Assert.Null(reading.TorqueNmRear);
    }

    [Fact]
    public void FromResponse_object_with_missing_fields_is_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading); // web hasData = motorLatest != null — an object (even empty) is data
        Assert.Null(reading!.ShiftState);
        Assert.Null(reading.MotorRpmFront);
        Assert.Null(reading.TorqueNmFront);
        Assert.Null(reading.MotorTempCFront);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var nul = JsonDocument.Parse("null");
        Assert.Null(MotorLiveReading.FromResponse(nul.RootElement));

        using var array = JsonDocument.Parse("[]");
        Assert.Null(MotorLiveReading.FromResponse(array.RootElement));
    }

    // ── Projection: gauges ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_builds_three_gauges_and_a_shift_chip()
    {
        var view = LiveMotorStatusProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Live Motor Status", view.Title);
        Assert.Equal(3, view.Gauges.Count);
        Assert.NotNull(view.ShiftBadge);
    }

    [Fact]
    public void Project_torque_gauge_sums_front_and_rear()
    {
        var view = LiveMotorStatusProjection.Project(Reading(torqueFront: 250, torqueRear: 180), UnitPref.Metric, Localizer);

        var torque = view.Gauges[0];
        Assert.Equal("Torque", torque.Label);
        Assert.Equal(430, torque.Value);
        Assert.Equal(1000, torque.Max);
        Assert.Equal("Nm", torque.Unit);
        Assert.Equal(ChartRole.Power, torque.Accent);
        Assert.Equal("430.00 Nm", torque.Caption);
    }

    [Fact]
    public void Project_torque_treats_missing_axle_as_zero()
    {
        var oneAxle = LiveMotorStatusProjection.Project(Reading(torqueFront: 250, torqueRear: null), UnitPref.Metric, Localizer);
        Assert.Equal(250, oneAxle.Gauges[0].Value);

        var noAxle = LiveMotorStatusProjection.Project(Reading(torqueFront: null, torqueRear: null), UnitPref.Metric, Localizer);
        Assert.Equal(0, noAxle.Gauges[0].Value);
        Assert.Equal("0.00 Nm", noAxle.Gauges[0].Caption);
    }

    [Fact]
    public void Project_rpm_gauge_uses_front_motor()
    {
        var view = LiveMotorStatusProjection.Project(Reading(rpmFront: 950), UnitPref.Metric, Localizer);

        var rpm = view.Gauges[1];
        Assert.Equal("Front RPM", rpm.Label);
        Assert.Equal(950, rpm.Value);
        Assert.Equal(18000, rpm.Max);
        Assert.Equal("RPM", rpm.Unit);
        Assert.Equal(ChartRole.Speed, rpm.Accent);
        Assert.Equal("950 RPM", rpm.Caption);
    }

    [Fact]
    public void Project_rpm_groups_thousands_and_zero_fallback()
    {
        var grouped = LiveMotorStatusProjection.Project(Reading(rpmFront: 12000), UnitPref.Metric, Localizer);
        Assert.Equal("12,000 RPM", grouped.Gauges[1].Caption);

        var missing = LiveMotorStatusProjection.Project(Reading(rpmFront: null), UnitPref.Metric, Localizer);
        Assert.Equal(0, missing.Gauges[1].Value);
        Assert.Equal("0 RPM", missing.Gauges[1].Caption);
    }

    [Fact]
    public void Project_temp_gauge_uses_max_of_front_and_rear_metric()
    {
        var view = LiveMotorStatusProjection.Project(Reading(tempFront: 45, tempRear: 40), UnitPref.Metric, Localizer);

        var temp = view.Gauges[2];
        Assert.Equal("Motor", temp.Label);
        Assert.Equal(45, temp.Value);
        Assert.Equal(200, temp.Max);
        Assert.Equal(DegreesC, temp.Unit);
        Assert.Equal(ChartRole.Temperature, temp.Accent);
        Assert.Equal($"45.0{DegreesC}", temp.Caption);
    }

    [Fact]
    public void Project_temp_converts_to_imperial_at_render_boundary()
    {
        var view = LiveMotorStatusProjection.Project(Reading(tempFront: 45, tempRear: 40), UnitPref.Imperial, Localizer);

        var temp = view.Gauges[2];
        Assert.Equal(113, temp.Value); // (45 * 9/5) + 32
        Assert.Equal(DegreesF, temp.Unit);
        Assert.Equal($"113.0{DegreesF}", temp.Caption);
    }

    [Fact]
    public void Project_temp_uses_finite_axle_when_the_other_is_missing()
    {
        var view = LiveMotorStatusProjection.Project(Reading(tempFront: 50, tempRear: null), UnitPref.Metric, Localizer);
        Assert.Equal(50, view.Gauges[2].Value);
        Assert.Equal($"50.0{DegreesC}", view.Gauges[2].Caption);
    }

    [Fact]
    public void Project_temp_missing_shows_awaiting_data()
    {
        var view = LiveMotorStatusProjection.Project(Reading(tempFront: null, tempRear: null), UnitPref.Metric, Localizer);

        Assert.Equal(0, view.Gauges[2].Value);
        Assert.Equal("Awaiting data", view.Gauges[2].Caption);
    }

    [Fact]
    public void Project_gauge_decimals_follow_the_web_integer_rule()
    {
        var integer = LiveMotorStatusProjection.Project(Reading(torqueFront: 250, torqueRear: 180), UnitPref.Metric, Localizer);
        Assert.Equal(0, integer.Gauges[0].Decimals); // 430 is integral → 0 decimals (matches web RadialGauge)

        var fractional = LiveMotorStatusProjection.Project(Reading(torqueFront: 250.5, torqueRear: 180), UnitPref.Metric, Localizer);
        Assert.Equal(2, fractional.Gauges[0].Decimals); // 430.5 → global precision (2)
    }

    // ── Projection: shift chip ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_shift_drive_is_success()
    {
        var view = LiveMotorStatusProjection.Project(Reading(shiftState: "D"), UnitPref.Metric, Localizer);

        Assert.True(view.ShiftBadge.IsDrive);
        Assert.Equal(StatusKind.Success, view.ShiftBadge.Status);
        Assert.Equal("D", view.ShiftBadge.ValueText);
        Assert.Equal("Shift State", view.ShiftBadge.Caption);
    }

    [Fact]
    public void Project_shift_non_drive_is_neutral()
    {
        var view = LiveMotorStatusProjection.Project(Reading(shiftState: "P"), UnitPref.Metric, Localizer);

        Assert.False(view.ShiftBadge.IsDrive);
        Assert.Equal(StatusKind.Neutral, view.ShiftBadge.Status);
        Assert.Equal("P", view.ShiftBadge.ValueText);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Project_shift_missing_is_unknown(string? shift)
    {
        var view = LiveMotorStatusProjection.Project(Reading(shiftState: shift), UnitPref.Metric, Localizer);

        Assert.Equal("Unknown", view.ShiftBadge.ValueText);
        Assert.Equal(StatusKind.Neutral, view.ShiftBadge.Status);
        Assert.False(view.ShiftBadge.IsDrive);
    }

    // ── Accessibility (every readout carries a Narrator name) ──────────────────────────────────────────

    [Fact]
    public void Project_every_gauge_and_chip_carries_a_narrator_name()
    {
        var view = LiveMotorStatusProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Torque 430.00 Nm", view.Gauges[0].AutomationName);
        Assert.Equal("Front RPM 950 RPM", view.Gauges[1].AutomationName);
        Assert.Equal($"Motor 45.0{DegreesC}", view.Gauges[2].AutomationName);
        Assert.Equal("Shift State D", view.ShiftBadge.AutomationName);
        Assert.All(view.Gauges, g => Assert.False(string.IsNullOrWhiteSpace(g.AutomationName)));
    }

    // ── Result mapper ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Mapper_preserves_status_for_each_kind()
    {
        using var doc = JsonDocument.Parse("""{"shift_state":"D"}""");
        var body = doc.RootElement;

        Assert.Equal(LoadStatus.Loading, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Cached, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Cached(body, Now, stale: false)).Status);
        Assert.Equal(LoadStatus.Refreshing, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Refreshing(body, Now, stale: false)).Status);
        Assert.Equal(LoadStatus.Loaded, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Loaded(body, Now)).Status);
        Assert.Equal(LoadStatus.Empty, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Offline, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(body, Now, new RepositoryError(RepositoryErrorKind.Network, "x"))).Status);
        Assert.Equal(LoadStatus.Error, LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        // Web parity: a non-object body makes `motorLatest` falsy (hasData == false) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ── View-model state matrix ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<MotorLiveReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("430.00 Nm", vm.Display!.Gauges[0].Caption);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<MotorLiveReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("Awaiting live motor data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorLiveReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorLiveReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<MotorLiveReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorLiveReading>.Loading(),
            RepositoryResult<MotorLiveReading>.Cached(Reading(torqueFront: 100, torqueRear: 0), Now, stale: false),
            RepositoryResult<MotorLiveReading>.Loaded(Reading(torqueFront: 250, torqueRear: 180), Now));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Loaded, vm.State);
        Assert.Equal("430.00 Nm", vm.Display!.Gauges[0].Caption);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(UnitPref.Metric, Loaded(Reading(tempFront: 0, tempRear: null)));
        await vm.LoadAsync();
        Assert.Equal($"0.0{DegreesC}", vm.Display!.Gauges[2].Caption);

        vm.Units = UnitPref.Imperial;
        Assert.Equal($"32.0{DegreesF}", vm.Display!.Gauges[2].Caption); // 0°C -> 32°F
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(LiveMotorStatusViewModel.State), changed);
        Assert.Contains(nameof(LiveMotorStatusViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MotorLiveReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Live Motor Status", vm.Title);
        Assert.Equal("Awaiting live motor data", vm.EmptyMessage);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("live-motor-status", LiveMotorStatusRegistration.Id);
        Assert.Equal("LiveMotorStatus", LiveMotorStatusRegistration.Slug);
        Assert.Equal("Live Motor Status", LiveMotorStatusRegistration.Name(Localizer));
        Assert.Equal("Awaiting live motor data", LiveMotorStatusRegistration.EmptyMessage(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveMotorStatus, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveMotorStatusDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveMotorStatus", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_motor_values()
    {
        var captured = new List<string>();
        var diagnostics = new LiveMotorStatusDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(captured, line => Assert.Equal("view.opened slug=LiveMotorStatus", line));
    }

    // ── Source (per-vehicle adapter) ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new LiveMotorStatusSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_motor_latest_by_query()
    {
        using var doc = JsonDocument.Parse("""{"shift_state":"D","torque_nm_front":250}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveMotorStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("D", terminal.Value!.ShiftState);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_motor_latest", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"motor_rpm_front":1}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveMotorStatusSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new LiveMotorStatusSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ── Fakes / helpers ───────────────────────────────────────────────────────────────────────────────

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<MotorLiveReading>>> Drain(ILiveMotorStatusSource source)
    {
        var list = new List<RepositoryResult<MotorLiveReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<MotorLiveReading> Loaded(MotorLiveReading reading) =>
        RepositoryResult<MotorLiveReading>.Loaded(reading, Now);

    private static LiveMotorStatusViewModel NewViewModel(params RepositoryResult<MotorLiveReading>[] emissions) =>
        new(new FakeLiveMotorStatusSource(emissions), Localizer);

    private static LiveMotorStatusViewModel NewViewModel(
        UnitPref units,
        params RepositoryResult<MotorLiveReading>[] emissions) =>
        new(new FakeLiveMotorStatusSource(emissions), Localizer, units);

    private sealed class FakeLiveMotorStatusSource(params RepositoryResult<MotorLiveReading>[] emissions)
        : ILiveMotorStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<MotorLiveReading>> StreamAsync(
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
