using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveMotorStatus</c> feature surface's UI-thread-free logic — the JSON parse
/// adapter (the useMotorLatest read of shift / power / regen / source / rpm / torque / temperature fields), the
/// projection (four chips + nine inline metrics, the SI→display temperature conversion, the HV-Isolation
/// threshold colour + em-dash guards, the accessible names), the cache-then-network result mapper, the
/// per-vehicle data source (primary resolution + query-scoped request), the registry metadata, the PII-safe
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale
/// / offline) plus the units / HV-isolation re-projection. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class LiveMotorStatusTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";
    private const string DegreesC = "\u00B0C";
    private const string DegreesF = "\u00B0F";
    private const string Kilohm = "k\u03A9";

    private static MotorLiveReading Reading(
        string? shiftState = "D",
        double? powerKw = 12.5,
        double? regenKw = 0,
        string? source = "telemetry",
        double? rpmFront = 950,
        double? rpmRear = 900,
        double? torqueFront = 250,
        double? torqueRear = 180,
        double? tempFront = 45,
        double? tempRear = 40,
        double? inverter = 55,
        double? battery = 30) =>
        new(shiftState, powerKw, regenKw, source, rpmFront, rpmRear, torqueFront, torqueRear, tempFront, tempRear, inverter, battery);

    private static readonly MotorLiveReading NullReading =
        new(null, null, null, null, null, null, null, null, null, null, null, null);

    // ── Parse adapter (web useMotorLatest read) ───────────────────────────────────────────────────────

    [Fact]
    public void FromResponse_reads_all_motor_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"shift_state":"D","power_kw":12.5,"regen_kw":0,"source":"telemetry",
             "motor_rpm_front":950,"motor_rpm_rear":-12,"torque_nm_front":250,"torque_nm_rear":180,
             "motor_temp_c_front":45,"motor_temp_c_rear":40,"inverter_temp_c":55,"battery_temp_c":30}
            """);

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("D", reading!.ShiftState);
        Assert.Equal(12.5, reading.PowerKw);
        Assert.Equal(0, reading.RegenKw);
        Assert.Equal("telemetry", reading.Source);
        Assert.Equal(950, reading.MotorRpmFront);
        Assert.Equal(-12, reading.MotorRpmRear);
        Assert.Equal(250, reading.TorqueNmFront);
        Assert.Equal(180, reading.TorqueNmRear);
        Assert.Equal(45, reading.MotorTempCFront);
        Assert.Equal(40, reading.MotorTempCRear);
        Assert.Equal(55, reading.InverterTempC);
        Assert.Equal(30, reading.BatteryTempC);
    }

    [Fact]
    public void FromResponse_reads_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"power_kw":"12.5","motor_rpm_front":"1200"}""");

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.Equal(12.5, reading!.PowerKw);
        Assert.Equal(1200, reading.MotorRpmFront);
    }

    [Fact]
    public void FromResponse_object_with_missing_fields_is_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = MotorLiveReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading); // web hasData = motorLatest != null — an object (even empty) is data
        Assert.Null(reading!.ShiftState);
        Assert.Null(reading.PowerKw);
        Assert.Null(reading.MotorRpmFront);
        Assert.Null(reading.BatteryTempC);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var nul = JsonDocument.Parse("null");
        Assert.Null(MotorLiveReading.FromResponse(nul.RootElement));

        using var array = JsonDocument.Parse("[]");
        Assert.Null(MotorLiveReading.FromResponse(array.RootElement));
    }

    // ── Projection: chips ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_builds_four_chips()
    {
        var view = LiveMotorStatusProjection.Project(Reading(), isolationResistanceKohm: null, UnitPref.Metric, Localizer);

        Assert.Equal("Live Motor Status", view.Title);
        Assert.Equal(4, view.Chips.Count);
        Assert.Equal("Shift State", view.Chips[0].Label);
        Assert.Equal("D", view.Chips[0].ValueText);
        Assert.Equal("Power", view.Chips[1].Label);
        Assert.Equal("12.50 kW", view.Chips[1].ValueText);
        Assert.Equal("Regen", view.Chips[2].Label);
        Assert.Equal("0.00 kW", view.Chips[2].ValueText);
        Assert.Equal("Source", view.Chips[3].Label);
        Assert.Equal("telemetry", view.Chips[3].ValueText);
    }

    [Fact]
    public void Project_chips_em_dash_when_missing()
    {
        var view = LiveMotorStatusProjection.Project(NullReading, isolationResistanceKohm: null, UnitPref.Metric, Localizer);

        Assert.Equal(EmDash, view.Chips[0].ValueText); // shift state
        Assert.Equal(EmDash, view.Chips[1].ValueText); // power
        Assert.Equal(EmDash, view.Chips[2].ValueText); // regen
        Assert.Equal(EmDash, view.Chips[3].ValueText); // source
    }

    // ── Projection: metrics ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_builds_nine_metrics_in_web_order()
    {
        var view = LiveMotorStatusProjection.Project(
            Reading(rpmFront: 950, rpmRear: 900, torqueFront: 250, torqueRear: 180, tempFront: 45, tempRear: 40, inverter: 55, battery: 30),
            isolationResistanceKohm: 650,
            UnitPref.Metric,
            Localizer);

        Assert.Equal(9, view.Metrics.Count);
        Assert.Equal("Front Motor RPM", view.Metrics[0].Label);
        Assert.Equal("950 RPM", view.Metrics[0].ValueText);
        Assert.Equal("Rear Motor RPM", view.Metrics[1].Label);
        Assert.Equal("900 RPM", view.Metrics[1].ValueText);
        Assert.Equal("Front Torque", view.Metrics[2].Label);
        Assert.Equal("250.00 Nm", view.Metrics[2].ValueText);
        Assert.Equal("Rear Torque", view.Metrics[3].Label);
        Assert.Equal("180.00 Nm", view.Metrics[3].ValueText);
        Assert.Equal("Front Motor Temp", view.Metrics[4].Label);
        Assert.Equal($"45.00 {DegreesC}", view.Metrics[4].ValueText);
        Assert.Equal("Rear Motor Temp", view.Metrics[5].Label);
        Assert.Equal($"40.00 {DegreesC}", view.Metrics[5].ValueText);
        Assert.Equal("Inverter Temp", view.Metrics[6].Label);
        Assert.Equal($"55.00 {DegreesC}", view.Metrics[6].ValueText);
        Assert.Equal("Battery Temp", view.Metrics[7].Label);
        Assert.Equal($"30.00 {DegreesC}", view.Metrics[7].ValueText);
        Assert.Equal("HV Isolation", view.Metrics[8].Label);
        Assert.Equal($"650.00 {Kilohm}", view.Metrics[8].ValueText);
    }

    [Fact]
    public void Project_metrics_em_dash_when_missing()
    {
        var view = LiveMotorStatusProjection.Project(NullReading, isolationResistanceKohm: null, UnitPref.Metric, Localizer);

        foreach (var metric in view.Metrics)
        {
            Assert.Equal(EmDash, metric.ValueText);
        }
    }

    [Fact]
    public void Project_converts_temperature_for_imperial_units()
    {
        var view = LiveMotorStatusProjection.Project(
            Reading(tempFront: 20, tempRear: 0, inverter: 100, battery: 37),
            isolationResistanceKohm: null,
            UnitPref.Imperial,
            Localizer);

        Assert.Equal($"68.00 {DegreesF}", view.Metrics[4].ValueText);   // 20°C -> 68°F
        Assert.Equal($"32.00 {DegreesF}", view.Metrics[5].ValueText);   // 0°C -> 32°F
        Assert.Equal($"212.00 {DegreesF}", view.Metrics[6].ValueText);  // 100°C -> 212°F
        Assert.Equal($"98.60 {DegreesF}", view.Metrics[7].ValueText);   // 37°C -> 98.6°F
    }

    [Fact]
    public void Project_rpm_uses_zero_fraction_digits()
    {
        var view = LiveMotorStatusProjection.Project(
            Reading(rpmFront: 1234.7), isolationResistanceKohm: null, UnitPref.Metric, Localizer);

        Assert.Equal("1,235 RPM", view.Metrics[0].ValueText); // web fmtInt -> 0 decimals, en-US grouping
    }

    [Fact]
    public void Project_honours_custom_precision()
    {
        var view = LiveMotorStatusProjection.Project(
            Reading(powerKw: 12.34), isolationResistanceKohm: null, UnitPref.Metric with { Precision = 1 }, Localizer);

        Assert.Equal("12.3 kW", view.Chips[1].ValueText);
    }

    // ── Projection: HV isolation thresholds + value guard ─────────────────────────────────────────────

    [Theory]
    [InlineData(null, StatusKind.Neutral)]
    [InlineData(0d, StatusKind.Neutral)]
    [InlineData(-5d, StatusKind.Neutral)]
    [InlineData(99d, StatusKind.Danger)]
    [InlineData(100d, StatusKind.Warning)]   // web: >= 100 amber
    [InlineData(250d, StatusKind.Warning)]
    [InlineData(499d, StatusKind.Warning)]
    [InlineData(500d, StatusKind.Success)]   // web: >= 500 green
    [InlineData(650d, StatusKind.Success)]
    public void IsolationStatusFor_classifies_by_threshold(double? kohm, StatusKind expected) =>
        Assert.Equal(expected, LiveMotorStatusProjection.IsolationStatusFor(kohm));

    [Theory]
    [InlineData(null, EmDash)]
    [InlineData(0d, EmDash)]      // web: isolationResistance > 0 gate
    [InlineData(-5d, EmDash)]
    public void Project_isolation_value_is_em_dash_when_non_positive(double? kohm, string expected)
    {
        var view = LiveMotorStatusProjection.Project(NullReading, kohm, UnitPref.Metric, Localizer);
        Assert.Equal(expected, view.Metrics[8].ValueText);
    }

    [Fact]
    public void Project_isolation_metric_carries_threshold_status()
    {
        var good = LiveMotorStatusProjection.Project(NullReading, 650, UnitPref.Metric, Localizer);
        Assert.Equal(StatusKind.Success, good.Metrics[8].Status);

        var bad = LiveMotorStatusProjection.Project(NullReading, 50, UnitPref.Metric, Localizer);
        Assert.Equal(StatusKind.Danger, bad.Metrics[8].Status);

        var unknown = LiveMotorStatusProjection.Project(NullReading, null, UnitPref.Metric, Localizer);
        Assert.Equal(StatusKind.Neutral, unknown.Metrics[8].Status);
    }

    [Fact]
    public void Project_only_isolation_metric_has_status()
    {
        var view = LiveMotorStatusProjection.Project(Reading(), 650, UnitPref.Metric, Localizer);

        for (int i = 0; i < 8; i++)
        {
            Assert.Null(view.Metrics[i].Status);
        }

        Assert.NotNull(view.Metrics[8].Status);
    }

    // ── Accessibility names (Narrator) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_chips_and_metrics_have_accessibility_names()
    {
        var view = LiveMotorStatusProjection.Project(Reading(), 650, UnitPref.Metric, Localizer);

        Assert.Equal("Shift State D", view.Chips[0].AutomationName);
        Assert.Equal("Power 12.50 kW", view.Chips[1].AutomationName);
        Assert.Equal("Front Motor RPM 950 RPM", view.Metrics[0].AutomationName);
        Assert.Equal($"HV Isolation 650.00 {Kilohm}", view.Metrics[8].AutomationName);

        foreach (var chip in view.Chips)
        {
            Assert.False(string.IsNullOrWhiteSpace(chip.AutomationName));
        }

        foreach (var metric in view.Metrics)
        {
            Assert.False(string.IsNullOrWhiteSpace(metric.AutomationName));
        }

        Assert.Equal(view.Title, view.AutomationName);
    }

    // ── Result mapper (cache-then-network preservation) ───────────────────────────────────────────────

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"shift_state":"D","power_kw":15}""");

        var cached = LiveMotorStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("D", cached.Value!.ShiftState);
        Assert.Equal(15, cached.Value.PowerKw);

        var offline = LiveMotorStatusResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("D", offline.Value!.ShiftState);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"power_kw":10}""");

        Assert.Equal(LoadStatus.Loaded, LiveMotorStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, LiveMotorStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, LiveMotorStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
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
        Assert.Equal("12.50 kW", vm.Display!.Chips[1].ValueText);
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
        Assert.Equal("No live motor telemetry yet", vm.EmptyMessage);
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
            RepositoryResult<MotorLiveReading>.Cached(Reading(powerKw: 5), Now, stale: false),
            RepositoryResult<MotorLiveReading>.Loaded(Reading(powerKw: 22), Now));
        await vm.LoadAsync();

        Assert.Equal(LiveMotorStatusState.Loaded, vm.State);
        Assert.Equal("22.00 kW", vm.Display!.Chips[1].ValueText);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(UnitPref.Metric, isolation: null, Loaded(Reading(tempFront: 0)));
        await vm.LoadAsync();
        Assert.Equal($"0.00 {DegreesC}", vm.Display!.Metrics[4].ValueText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal($"32.00 {DegreesF}", vm.Display!.Metrics[4].ValueText); // 0°C -> 32°F
    }

    [Fact]
    public async Task ViewModel_isolation_change_reprojects_hv_metric()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();
        Assert.Equal(EmDash, vm.Display!.Metrics[8].ValueText);             // no isolation yet
        Assert.Equal(StatusKind.Neutral, vm.Display.Metrics[8].Status);

        vm.IsolationResistanceKohm = 650;
        Assert.Equal($"650.00 {Kilohm}", vm.Display!.Metrics[8].ValueText); // live SSE value flows in
        Assert.Equal(StatusKind.Success, vm.Display.Metrics[8].Status);
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
        Assert.Equal("No live motor telemetry yet", vm.EmptyMessage);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("live-motor-status", LiveMotorStatusRegistration.Id);
        Assert.Equal("LiveMotorStatus", LiveMotorStatusRegistration.Slug);
        Assert.Equal("Live Motor Status", LiveMotorStatusRegistration.Name(Localizer));
        Assert.Equal("No live motor telemetry yet", LiveMotorStatusRegistration.EmptyMessage(Localizer));
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
        using var doc = JsonDocument.Parse("""{"shift_state":"D","power_kw":12.5}""");
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
        using var doc = JsonDocument.Parse("""{"power_kw":1}""");
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
        double? isolation,
        params RepositoryResult<MotorLiveReading>[] emissions) =>
        new(new FakeLiveMotorStatusSource(emissions), Localizer, units, isolation);

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
