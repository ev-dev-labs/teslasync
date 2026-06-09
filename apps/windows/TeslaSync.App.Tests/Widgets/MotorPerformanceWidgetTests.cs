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
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the MotorPerformanceWidget's UI-thread-free logic — the JSON parse adapter (the
/// useMotorLatest read incl. the di_stator_temp / motor_temp_c_front and gear / shift_state fallbacks plus the
/// lateral_accel / longitudinal_accel reads), the torque-colour threshold helper, the value / temperature /
/// g-force formatting, the projection across the compact / full footprints (the gauge value + signed caption, the
/// four stat tiles, the gear em-dash fallback, the SI→display temperature conversion), the cache-then-network
/// result mapper, the per-vehicle data source (primary resolution + query-scoped request), the registry metadata,
/// the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec (web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx).
/// </summary>
public sealed class MotorPerformanceWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useMotorLatest read) -----------------------------------

    [Fact]
    public void FromResponse_reads_torque_temp_gear_and_gforces()
    {
        using var doc = JsonDocument.Parse(
            """{"di_torque":300,"di_stator_temp":45,"gear":"D","lateral_accel":0.5,"longitudinal_accel":-0.25}""");

        var reading = MotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(300, reading!.TorqueNm);
        Assert.Equal(45, reading.StatorTempC);
        Assert.Equal("D", reading.Gear);
        Assert.Equal(0.5, reading.LateralG);
        Assert.Equal(-0.25, reading.LongitudinalG);
    }

    [Fact]
    public void FromResponse_stator_temp_falls_back_to_motor_temp_c_front()
    {
        using var doc = JsonDocument.Parse("""{"di_torque":100,"motor_temp_c_front":38}""");

        var reading = MotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Equal(38, reading!.StatorTempC); // di_stator_temp absent → motor_temp_c_front
    }

    [Fact]
    public void FromResponse_prefers_di_stator_temp_over_motor_temp_c_front()
    {
        using var doc = JsonDocument.Parse("""{"di_stator_temp":50,"motor_temp_c_front":38}""");

        var reading = MotorReading.FromResponse(doc.RootElement);

        Assert.Equal(50, reading!.StatorTempC);
    }

    [Fact]
    public void FromResponse_gear_falls_back_to_shift_state()
    {
        using var doc = JsonDocument.Parse("""{"di_torque":0,"shift_state":"R"}""");

        var reading = MotorReading.FromResponse(doc.RootElement);

        Assert.Equal("R", reading!.Gear); // gear absent → shift_state
    }

    [Fact]
    public void FromResponse_object_with_missing_fields_is_tolerant()
    {
        using var doc = JsonDocument.Parse("""{"vehicle_id":7}""");

        var reading = MotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading); // web hasData = !!data — an object (even empty) is data
        Assert.Null(reading!.TorqueNm);
        Assert.Null(reading.StatorTempC);
        Assert.Null(reading.Gear);
        Assert.Null(reading.LateralG);
        Assert.Null(reading.LongitudinalG);
    }

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Null(MotorReading.FromResponse(doc.RootElement));

        using var array = JsonDocument.Parse("[]");
        Assert.Null(MotorReading.FromResponse(array.RootElement));
    }

    // ---- Torque colour thresholds (web torqueColor) --------------------------------

    [Theory]
    [InlineData(0, StatusKind.Success)]
    [InlineData(199, StatusKind.Success)]
    [InlineData(200, StatusKind.Warning)]   // web: < 200 green, so 200 is amber
    [InlineData(399, StatusKind.Warning)]
    [InlineData(400, StatusKind.Danger)]    // web: < 400 amber, so 400 is red
    [InlineData(600, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double absTorque, StatusKind expected) =>
        Assert.Equal(expected, MotorPerformanceProjection.StatusFor(absTorque));

    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    public void Status_maps_to_themed_status_brush(StatusKind status, string brushKey) =>
        Assert.Equal(brushKey, StatusResources.AccentBrushKey(status));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(200, MotorPerformanceProjection.WarningThresholdNm);
        Assert.Equal(400, MotorPerformanceProjection.DangerThresholdNm);
        Assert.Equal(600, MotorPerformanceProjection.TorqueMax);
        Assert.Equal(100, MotorPerformanceProjection.GaugeDiameter); // web RadialGauge size={100}
    }

    // ---- Value / temperature / g-force formatting ----------------------------------

    [Theory]
    [InlineData(300, "300")]       // integer -> 0 decimals
    [InlineData(0, "0")]
    [InlineData(305.5, "305.50")]  // non-integer -> 2 decimals (global precision)
    public void FormatValue_matches_web(double value, string expected) =>
        Assert.Equal(expected, MotorPerformanceProjection.FormatValue(value));

    [Theory]
    [InlineData(double.NaN, "0")]
    [InlineData(double.PositiveInfinity, "0")]
    public void FormatValue_coerces_non_finite_to_zero(double value, string expected) =>
        Assert.Equal(expected, MotorPerformanceProjection.FormatValue(value));

    [Fact]
    public void FormatTemperature_converts_si_celsius_to_display_unit()
    {
        Assert.Equal("45 \u00B0C", MotorPerformanceProjection.FormatTemperature(45, UnitPref.Metric));
        Assert.Equal("113 \u00B0F", MotorPerformanceProjection.FormatTemperature(45, UnitPref.Imperial)); // 45*9/5+32
    }

    [Fact]
    public void FormatTemperature_null_is_em_dash()
    {
        Assert.Equal("\u2014", MotorPerformanceProjection.FormatTemperature(null, UnitPref.Metric));
        Assert.Equal("\u2014", MotorPerformanceProjection.FormatTemperature(double.NaN, UnitPref.Metric));
    }

    [Fact]
    public void FormatGForce_two_decimals_with_unit_or_em_dash()
    {
        Assert.Equal("0.50 g", MotorPerformanceProjection.FormatGForce(0.5));
        Assert.Equal("-0.25 g", MotorPerformanceProjection.FormatGForce(-0.25));
        Assert.Equal("\u2014", MotorPerformanceProjection.FormatGForce(null));
    }

    // ---- Size / footprint flags (web isCompact / gauge diameter) -------------------

    [Theory]
    [InlineData(1, 2, true)]    // 1 col -> compact
    [InlineData(1, 40, true)]   // still compact at any row count (web cols <= 1)
    [InlineData(2, 4, false)]   // default -> full
    [InlineData(4, 40, false)]  // max -> full
    public void Size_flags_match_web(int cols, int rows, bool compact)
    {
        var size = new MotorPerformanceSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
    }

    // ---- Projection (full) ---------------------------------------------------------

    [Fact]
    public void Project_full_builds_gauge_and_four_stat_tiles()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(300, 45, "D", 0.5, -0.25), new MotorPerformanceSize(2, 4), UnitPref.Metric, Localizer);

        Assert.False(view.IsCompact);
        Assert.Equal(300, view.GaugeValue);
        Assert.Equal(600, view.GaugeMax);
        Assert.Equal("300", view.GaugeValueText);
        Assert.Equal("Nm", view.GaugeUnit);
        Assert.Equal("300", view.GaugeLabel);
        Assert.Equal(StatusKind.Warning, view.GaugeStatus); // 300 in [200,400)
        Assert.Equal(100, view.GaugeDiameter);
        Assert.Equal("Torque 300 Nm", view.GaugeAutomationName);

        Assert.Equal(4, view.Stats.Count);
        Assert.Equal("Stator Temp", view.Stats[0].Label);
        Assert.Equal("45 \u00B0C", view.Stats[0].ValueText);
        Assert.Equal("Gear State", view.Stats[1].Label);
        Assert.Equal("D", view.Stats[1].ValueText);
        Assert.Equal("Lateral G", view.Stats[2].Label);
        Assert.Equal("0.50 g", view.Stats[2].ValueText);
        Assert.Equal("Longitudinal G", view.Stats[3].Label);
        Assert.Equal("-0.25 g", view.Stats[3].ValueText);
    }

    [Fact]
    public void Project_compact_builds_gear_and_torque_readout()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(300, 45, "D", null, null), new MotorPerformanceSize(1, 2), UnitPref.Metric, Localizer);

        Assert.True(view.IsCompact);
        Assert.Equal("Gear", view.GearLabel);
        Assert.Equal("D", view.GearValue);
        Assert.Equal("Torque", view.TorqueLabel);
        Assert.Equal("300 Nm", view.TorqueValueText);
    }

    [Fact]
    public void Project_null_torque_is_zero_green_and_signed_label()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(null, null, null, null, null), new MotorPerformanceSize(2, 4), UnitPref.Metric, Localizer);

        Assert.Equal(0, view.GaugeValue);              // web di_torque ?? 0
        Assert.Equal("0", view.GaugeValueText);
        Assert.Equal("0", view.GaugeLabel);
        Assert.Equal(StatusKind.Success, view.GaugeStatus); // 0 < 200 -> green
        Assert.Equal("0 Nm", view.TorqueValueText);
        Assert.Equal("\u2014", view.GearValue);         // gear ?? shift_state ?? '—'
        Assert.Equal("\u2014", view.Stats[0].ValueText); // no stator temp
        Assert.Equal("\u2014", view.Stats[1].ValueText); // gear state em dash
        Assert.Equal("\u2014", view.Stats[2].ValueText); // lateral g
        Assert.Equal("\u2014", view.Stats[3].ValueText); // longitudinal g
    }

    [Fact]
    public void Project_negative_torque_uses_abs_for_gauge_signed_for_caption()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(-450, null, null, null, null), new MotorPerformanceSize(2, 4), UnitPref.Metric, Localizer);

        Assert.Equal(450, view.GaugeValue);            // |−450|
        Assert.Equal("450", view.GaugeValueText);
        Assert.Equal("-450", view.GaugeLabel);          // signed caption (web fmtInt(torque))
        Assert.Equal(StatusKind.Danger, view.GaugeStatus); // |−450| >= 400 -> red
    }

    [Fact]
    public void Project_clamps_gauge_value_to_max_but_keeps_signed_label()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(700, null, null, null, null), new MotorPerformanceSize(2, 4), UnitPref.Metric, Localizer);

        Assert.Equal(600, view.GaugeValue);            // clamped to TORQUE_MAX
        Assert.Equal("600", view.GaugeValueText);
        Assert.Equal("700", view.GaugeLabel);           // caption is the raw signed torque
    }

    [Fact]
    public void Project_converts_temperature_for_imperial_units()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(100, 20, "D", null, null), new MotorPerformanceSize(2, 4), UnitPref.Imperial, Localizer);

        Assert.Equal("68 \u00B0F", view.Stats[0].ValueText); // 20°C -> 68°F
    }

    [Fact]
    public void Project_stat_tiles_have_accessibility_names()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(120, 30, "P", 0.1, 0.2), new MotorPerformanceSize(2, 4), UnitPref.Metric, Localizer);

        Assert.Equal("Stator Temp 30 \u00B0C", view.Stats[0].AutomationName);
        Assert.Equal("Gear State P", view.Stats[1].AutomationName);
        Assert.Equal("Lateral G 0.10 g", view.Stats[2].AutomationName);
        Assert.Equal("Longitudinal G 0.20 g", view.Stats[3].AutomationName);
    }

    [Fact]
    public void Project_gauge_has_non_empty_accessibility_name_containing_value()
    {
        var view = MotorPerformanceProjection.Project(
            new MotorReading(250, null, null, null, null), new MotorPerformanceSize(2, 4), UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains("Torque", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("250", view.GaugeAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"di_torque":200,"di_stator_temp":40,"gear":"D"}""");

        var cached = MotorPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(200, cached.Value!.TorqueNm);
        Assert.Equal("D", cached.Value.Gear);

        var offline = MotorPerformanceResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(200, offline.Value!.TorqueNm);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"di_torque":100}""");

        Assert.Equal(LoadStatus.Loaded, MotorPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, MotorPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, MotorPerformanceResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        // Web parity: a non-object body makes `data` falsy (hasData == false) -> the empty surface.
        using var doc = JsonDocument.Parse("null");

        var mapped = MotorPerformanceResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<MotorReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(Loaded(new MotorReading(300, 45, "D", 0.5, -0.25)));
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("300", vm.Display!.GaugeValueText);
        Assert.Equal(StatusKind.Warning, vm.Display.GaugeStatus);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<MotorReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No motor data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorReading>.Cached(new MotorReading(150, 30, "D", null, null), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(StatusKind.Success, vm.Display!.GaugeStatus); // 150 < 200 -> green
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<MotorReading>.OfflineCached(
            new MotorReading(450, null, null, null, null), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.Equal(StatusKind.Danger, vm.Display!.GaugeStatus); // |450| >= 400 -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<MotorReading>.Loading(),
            RepositoryResult<MotorReading>.Cached(new MotorReading(100, null, "D", null, null), Now, stale: false),
            RepositoryResult<MotorReading>.Loaded(new MotorReading(220, null, "D", null, null), Now));
        await vm.LoadAsync();

        Assert.Equal(MotorPerformanceState.Loaded, vm.State);
        Assert.Equal("220", vm.Display!.GaugeValueText);
        Assert.Equal(StatusKind.Warning, vm.Display.GaugeStatus);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_and_full()
    {
        using var vm = NewViewModel(new MotorPerformanceSize(2, 4), Loaded(new MotorReading(300, 45, "D", null, null)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);

        vm.Size = new MotorPerformanceSize(1, 2);
        Assert.True(vm.Display!.IsCompact);
        Assert.Equal("D", vm.Display.GearValue);
        Assert.Equal("300 Nm", vm.Display.TorqueValueText);
        Assert.Equal(MotorPerformanceState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_temperature()
    {
        using var vm = NewViewModel(
            new MotorPerformanceSize(2, 4), UnitPref.Metric, Loaded(new MotorReading(100, 0, "D", null, null)));
        await vm.LoadAsync();
        Assert.Equal("0 \u00B0C", vm.Display!.Stats[0].ValueText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("32 \u00B0F", vm.Display!.Stats[0].ValueText); // 0°C -> 32°F
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<MotorReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Motor Performance", vm.Title);
        Assert.Equal("No motor data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new MotorReading(100, null, "D", null, null)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(MotorPerformanceViewModel.State), changed);
        Assert.Contains(nameof(MotorPerformanceViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("motor-performance", MotorPerformanceRegistration.Id);
        Assert.Equal("vehicle", MotorPerformanceRegistration.Category);
        Assert.Equal("MotorPerformanceWidget", MotorPerformanceRegistration.Slug);
        Assert.Equal(new MotorPerformanceSize(2, 4), MotorPerformanceRegistration.DefaultSize);
        Assert.Equal(new MotorPerformanceSize(1, 2), MotorPerformanceRegistration.MinSize);
        Assert.Equal(new MotorPerformanceSize(4, 40), MotorPerformanceRegistration.MaxSize);
        Assert.Equal("Motor Performance", MotorPerformanceRegistration.Name(Localizer));
        Assert.Contains("torque", MotorPerformanceRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(2, 4, true)]    // default
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, MotorPerformanceRegistration.IsWithinBounds(new MotorPerformanceSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new MotorPerformanceSize(1, 2), MotorPerformanceRegistration.Clamp(new MotorPerformanceSize(0, 0)));
        Assert.Equal(new MotorPerformanceSize(4, 40), MotorPerformanceRegistration.Clamp(new MotorPerformanceSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MotorPerformanceDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MotorPerformanceWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new MotorPerformanceSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_motor_latest_by_query()
    {
        using var doc = JsonDocument.Parse("""{"di_torque":300,"di_stator_temp":45,"gear":"D"}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MotorPerformanceSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(300, terminal.Value!.TorqueNm);
        Assert.Equal("D", terminal.Value.Gear);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_motor_latest", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"di_torque":120}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new MotorPerformanceSource(
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
        var source = new MotorPerformanceSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<MotorReading>>> Drain(IMotorPerformanceSource source)
    {
        var list = new List<RepositoryResult<MotorReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<MotorReading> Loaded(MotorReading reading) =>
        RepositoryResult<MotorReading>.Loaded(reading, Now);

    private static MotorPerformanceViewModel NewViewModel(params RepositoryResult<MotorReading>[] emissions) =>
        NewViewModel(MotorPerformanceSize.Default, emissions);

    private static MotorPerformanceViewModel NewViewModel(
        MotorPerformanceSize size,
        params RepositoryResult<MotorReading>[] emissions) =>
        new(new FakeMotorPerformanceSource(emissions), Localizer, size);

    private static MotorPerformanceViewModel NewViewModel(
        MotorPerformanceSize size,
        UnitPref units,
        params RepositoryResult<MotorReading>[] emissions) =>
        new(new FakeMotorPerformanceSource(emissions), Localizer, size, units);

    private sealed class FakeMotorPerformanceSource(params RepositoryResult<MotorReading>[] emissions)
        : IMotorPerformanceSource
    {
        public async IAsyncEnumerable<RepositoryResult<MotorReading>> StreamAsync(
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
