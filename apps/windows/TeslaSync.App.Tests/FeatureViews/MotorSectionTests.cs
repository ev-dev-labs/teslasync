using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
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
/// Headless verification of the <c>MotorSection</c> feature surface's UI-thread-free logic — the JSON parse
/// adapter (the useMotorLatest read of shift / voltage / current / torque / rpm / temperature fields), the
/// pack-voltage <c>vbat_rear ?? vbat_front</c> fallback and the <c>Math.max</c> peak-temperature rollup, the
/// projection (eight metric cards in web order, the SI→display temperature conversion, the per-card accent
/// colours, the em-dash guards, the accessible names), the cache-then-network result mapper, the per-vehicle data
/// source (primary resolution + query-scoped request), the registry metadata, the PII-safe diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline) plus the
/// units re-projection. Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class MotorSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";
    private const string DegreesC = "\u00B0C";
    private const string DegreesF = "\u00B0F";

    private static MotorSectionReading Reading(
        string? shiftState = "D",
        double? vbatFront = 380,
        double? vbatRear = 395,
        double? currentFront = 120,
        double? torqueFront = 250,
        double? torqueRear = 180,
        double? rpmFront = 950,
        double? rpmRear = 900,
        double? tempFront = 45,
        double? tempRear = 40) =>
        new(shiftState, vbatFront, vbatRear, currentFront, torqueFront, torqueRear, rpmFront, rpmRear, tempFront, tempRear);

    private static readonly MotorSectionReading NullReading =
        new(null, null, null, null, null, null, null, null, null, null);

    // ── Parse adapter (web useMotorLatest read) ───────────────────────────────────────────────────────

    [Fact]
    public void FromResponse_reads_all_motor_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"shift_state":"D","vbat_front":380,"vbat_rear":395,"motor_current_front":120,
             "torque_nm_front":250,"torque_nm_rear":180,"motor_rpm_front":950,"motor_rpm_rear":-12,
             "motor_temp_c_front":45,"motor_temp_c_rear":40}
            """);

        var reading = MotorSectionReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal("D", reading!.ShiftState);
        Assert.Equal(380, reading.VbatFront);
        Assert.Equal(395, reading.VbatRear);
        Assert.Equal(120, reading.MotorCurrentFront);
        Assert.Equal(250, reading.TorqueNmFront);
        Assert.Equal(180, reading.TorqueNmRear);
        Assert.Equal(950, reading.MotorRpmFront);
        Assert.Equal(-12, reading.MotorRpmRear);
        Assert.Equal(45, reading.MotorTempCFront);
        Assert.Equal(40, reading.MotorTempCRear);
    }

    [Fact]
    public void FromResponse_reads_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"vbat_rear":"395.5","motor_rpm_front":"1200"}""");

        var reading = MotorSectionReading.FromResponse(doc.RootElement);

        Assert.Equal(395.5, reading!.VbatRear);
        Assert.Equal(1200, reading.MotorRpmFront);
    }

    [Fact]
    public void FromResponse_object_with_missing_fields_is_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = MotorSectionReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading); // web motorData ? grid : empty — an object (even empty) renders the grid
        Assert.Null(reading!.ShiftState);
        Assert.Null(reading.PackVoltage);
        Assert.Null(reading.MotorRpmFront);
        Assert.Null(reading.PeakMotorTempC);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var nul = JsonDocument.Parse("null");
        Assert.Null(MotorSectionReading.FromResponse(nul.RootElement));

        using var array = JsonDocument.Parse("[]");
        Assert.Null(MotorSectionReading.FromResponse(array.RootElement));
    }

    // ── Derived: pack voltage (vbat_rear ?? vbat_front) + peak temperature (Math.max) ──────────────────

    [Theory]
    [InlineData(380d, 395d, 395d)]   // rear preferred
    [InlineData(380d, null, 380d)]   // front fallback
    [InlineData(null, 395d, 395d)]   // only rear
    public void PackVoltage_prefers_rear_then_front(double? front, double? rear, double expected)
    {
        var reading = Reading(vbatFront: front, vbatRear: rear);
        Assert.Equal(expected, reading.PackVoltage);
    }

    [Fact]
    public void PackVoltage_is_null_when_both_axles_missing() =>
        Assert.Null(Reading(vbatFront: null, vbatRear: null).PackVoltage);

    [Theory]
    [InlineData(45d, 40d, 45d)]      // max of both
    [InlineData(40d, 45d, 45d)]      // max of both (rear higher)
    [InlineData(45d, null, 45d)]     // only front
    [InlineData(null, 40d, 40d)]     // only rear
    public void PeakMotorTemp_takes_the_larger_reading(double? front, double? rear, double expected)
    {
        var reading = Reading(tempFront: front, tempRear: rear);
        Assert.Equal(expected, reading.PeakMotorTempC);
    }

    [Fact]
    public void PeakMotorTemp_is_null_when_both_axles_missing() =>
        Assert.Null(Reading(tempFront: null, tempRear: null).PeakMotorTempC);

    // ── Projection: the eight metric cards ─────────────────────────────────────────────────────────────

    [Fact]
    public void Project_builds_eight_cards_in_web_order()
    {
        var view = MotorSectionProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Powertrain", view.Title);
        Assert.Equal(8, view.Cards.Count);

        Assert.Equal("Shift State", view.Cards[0].Label);
        Assert.Equal("D", view.Cards[0].ValueText);
        Assert.Equal("Pack Voltage", view.Cards[1].Label);
        Assert.Equal("395.00 V", view.Cards[1].ValueText);
        Assert.Equal("Motor Current (F)", view.Cards[2].Label);
        Assert.Equal("120.00 A", view.Cards[2].ValueText);
        Assert.Equal("Front Torque", view.Cards[3].Label);
        Assert.Equal("250.00 Nm", view.Cards[3].ValueText);
        Assert.Equal("Rear Torque", view.Cards[4].Label);
        Assert.Equal("180.00 Nm", view.Cards[4].ValueText);
        Assert.Equal("Front RPM", view.Cards[5].Label);
        Assert.Equal("950", view.Cards[5].ValueText);
        Assert.Equal("Rear RPM", view.Cards[6].Label);
        Assert.Equal("900", view.Cards[6].ValueText);
        Assert.Equal("Motor Temp (peak)", view.Cards[7].Label);
        Assert.Equal($"45.00 {DegreesC}", view.Cards[7].ValueText);
    }

    [Fact]
    public void Project_cards_em_dash_when_missing()
    {
        var view = MotorSectionProjection.Project(NullReading, UnitPref.Metric, Localizer);

        foreach (var card in view.Cards)
        {
            Assert.Equal(EmDash, card.ValueText);
        }
    }

    [Fact]
    public void Project_pack_voltage_falls_back_to_front_axle()
    {
        var view = MotorSectionProjection.Project(Reading(vbatFront: 360, vbatRear: null), UnitPref.Metric, Localizer);
        Assert.Equal("360.00 V", view.Cards[1].ValueText);
    }

    [Fact]
    public void Project_peak_temperature_converts_for_imperial_units()
    {
        // peak = max(100, 37) = 100°C -> 212°F
        var view = MotorSectionProjection.Project(
            Reading(tempFront: 100, tempRear: 37), UnitPref.Imperial, Localizer);

        Assert.Equal($"212.00 {DegreesF}", view.Cards[7].ValueText);
    }

    [Fact]
    public void Project_rpm_uses_zero_fraction_digits()
    {
        var view = MotorSectionProjection.Project(
            Reading(rpmFront: 1234.7, rpmRear: 900), UnitPref.Metric, Localizer);

        Assert.Equal("1,235", view.Cards[5].ValueText); // web fmtInt -> 0 decimals, en-US grouping
        Assert.Equal("900", view.Cards[6].ValueText);
    }

    [Fact]
    public void Project_honours_custom_precision()
    {
        var view = MotorSectionProjection.Project(
            Reading(currentFront: 12.34), UnitPref.Metric with { Precision = 1 }, Localizer);

        Assert.Equal("12.3 A", view.Cards[2].ValueText);
    }

    [Fact]
    public void Project_cards_carry_web_accent_colours()
    {
        var view = MotorSectionProjection.Project(Reading(), UnitPref.Metric, Localizer);

        // web color: cyan, purple, green, cyan, purple, cyan, purple, green
        Assert.Equal("TsColorInfoBrush", view.Cards[0].AccentBrushKey);    // Shift State (cyan)
        Assert.Equal("TsColorAccentBrush", view.Cards[1].AccentBrushKey);  // Pack Voltage (purple)
        Assert.Equal("TsColorSuccessBrush", view.Cards[2].AccentBrushKey); // Motor Current (green)
        Assert.Equal("TsColorInfoBrush", view.Cards[3].AccentBrushKey);    // Front Torque (cyan)
        Assert.Equal("TsColorAccentBrush", view.Cards[4].AccentBrushKey);  // Rear Torque (purple)
        Assert.Equal("TsColorInfoBrush", view.Cards[5].AccentBrushKey);    // Front RPM (cyan)
        Assert.Equal("TsColorAccentBrush", view.Cards[6].AccentBrushKey);  // Rear RPM (purple)
        Assert.Equal("TsColorSuccessBrush", view.Cards[7].AccentBrushKey); // Motor Temp (green)
    }

    // ── Accessibility names (Narrator) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_cards_have_accessibility_names()
    {
        var view = MotorSectionProjection.Project(Reading(), UnitPref.Metric, Localizer);

        Assert.Equal("Shift State D", view.Cards[0].AutomationName);
        Assert.Equal("Pack Voltage 395.00 V", view.Cards[1].AutomationName);
        Assert.Equal("Front RPM 950", view.Cards[5].AutomationName);

        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
        }

        Assert.Equal(view.Title, view.AutomationName);
    }

    // ── Result mapper (cache-then-network preservation) ───────────────────────────────────────────────

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"shift_state":"D","vbat_rear":395}""");

        var cached = MotorSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("D", cached.Value!.ShiftState);
        Assert.Equal(395, cached.Value.PackVoltage);

        var offline = MotorSectionResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("D", offline.Value!.ShiftState);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"torque_nm_front":10}""");

        Assert.Equal(LoadStatus.Loaded, MotorSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MotorSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MotorSectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        // Web parity: a non-object body makes `motorData` falsy -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = MotorSectionResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ── View-model state matrix ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<MotorSectionReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("395.00 V", vm.Display!.Cards[1].ValueText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<MotorSectionReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No motor data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorSectionReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorSectionReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<MotorSectionReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorSectionReading>.Loading(),
            RepositoryResult<MotorSectionReading>.Cached(Reading(vbatRear: 300), Now, stale: false),
            RepositoryResult<MotorSectionReading>.Loaded(Reading(vbatRear: 410), Now));
        await vm.LoadAsync();

        Assert.Equal(MotorSectionState.Loaded, vm.State);
        Assert.Equal("410.00 V", vm.Display!.Cards[1].ValueText);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(UnitPref.Metric, Loaded(Reading(tempFront: 0, tempRear: 0)));
        await vm.LoadAsync();
        Assert.Equal($"0.00 {DegreesC}", vm.Display!.Cards[7].ValueText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal($"32.00 {DegreesF}", vm.Display!.Cards[7].ValueText); // 0°C -> 32°F
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MotorSectionViewModel.State), changed);
        Assert.Contains(nameof(MotorSectionViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MotorSectionReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Powertrain", vm.Title);
        Assert.Equal("No motor data available", vm.EmptyMessage);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("motor-section", MotorSectionRegistration.Id);
        Assert.Equal("MotorSection", MotorSectionRegistration.Slug);
        Assert.Equal("Powertrain", MotorSectionRegistration.Name(Localizer));
        Assert.Equal("No motor data available", MotorSectionRegistration.EmptyMessage(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened slug=MotorSection, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new MotorSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MotorSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_motor_values()
    {
        var captured = new List<string>();
        var diagnostics = new MotorSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(captured, line => Assert.Equal("view.opened slug=MotorSection", line));
    }

    // ── Source (per-vehicle adapter) ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new MotorSectionSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_motor_latest_by_query()
    {
        using var doc = JsonDocument.Parse("""{"shift_state":"D","vbat_rear":395}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MotorSectionSource(
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
        using var doc = JsonDocument.Parse("""{"torque_nm_front":1}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MotorSectionSource(
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
        var source = new MotorSectionSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ── Fakes / helpers ───────────────────────────────────────────────────────────────────────────────

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<MotorSectionReading>>> Drain(IMotorSectionSource source)
    {
        var list = new List<RepositoryResult<MotorSectionReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<MotorSectionReading> Loaded(MotorSectionReading reading) =>
        RepositoryResult<MotorSectionReading>.Loaded(reading, Now);

    private static MotorSectionViewModel NewViewModel(params RepositoryResult<MotorSectionReading>[] emissions) =>
        new(new FakeMotorSectionSource(emissions), Localizer);

    private static MotorSectionViewModel NewViewModel(
        UnitPref units,
        params RepositoryResult<MotorSectionReading>[] emissions) =>
        new(new FakeMotorSectionSource(emissions), Localizer, units);

    private sealed class FakeMotorSectionSource(params RepositoryResult<MotorSectionReading>[] emissions)
        : IMotorSectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<MotorSectionReading>> StreamAsync(
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
