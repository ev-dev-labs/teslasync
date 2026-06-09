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
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the VehicleHeroCardWidget's UI-thread-free logic — the JSON parse adapters (the
/// useVehicleState normalisation + the useVehicles identity selection), the SI→display projection across unit
/// preferences (battery threshold colour, range/temperature conversion, charging affordance, em-dash fallbacks,
/// Narrator names), the identity+state result mapper, the two-endpoint combine-latest data source (primary
/// resolution, vehicles-list identity enrichment, path-scoped state read), the registry metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) and unit reprojection. Mirrors the web spec
/// (web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx).
/// </summary>
public sealed class VehicleHeroCardWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 0, 0, TimeSpan.Zero);

    // 250 mi in metres (250 × 1609.344) — exactly 250 mi / 402.336 km of ideal range.
    private const double TwoFiftyMilesMeters = 402_336.0;

    private const string VehiclesJson =
        """[{"id":7,"display_name":"My Tesla","vin":"5YJ3E1EA7KF000000","model":"Model 3","trim_badging":"Performance"}]""";

    private const string StateJson =
        """{"state":{"vehicle_id":7,"battery_level":72,"ideal_range":402336,"inside_temp":21,"outside_temp":15,"is_charging":true,"charger_power":11,"state":"charging"}}""";

    // ---- State parse adapter (web useVehicleState normalisation) --------------------

    [Fact]
    public void State_FromResponse_reads_primary_state_object_with_all_fields()
    {
        using var doc = JsonDocument.Parse(StateJson);

        var state = VehicleHeroStateReading.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(72, state!.BatteryLevel);
        Assert.Equal(402_336, state.IdealRangeMeters);
        Assert.Equal(21, state.InsideTempCelsius);
        Assert.Equal(15, state.OutsideTempCelsius);
        Assert.True(state.IsCharging);
        Assert.Equal(11, state.ChargerPowerKw);
        Assert.Equal("charging", state.Status);
    }

    [Fact]
    public void State_FromResponse_defaults_status_to_offline_and_nulls_missing_metrics()
    {
        using var doc = JsonDocument.Parse("""{"state":{"vehicle_id":1}}""");

        var state = VehicleHeroStateReading.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Null(state!.BatteryLevel);
        Assert.Null(state.IdealRangeMeters);
        Assert.Null(state.InsideTempCelsius);
        Assert.False(state.IsCharging);
        Assert.Equal("offline", state.Status);
    }

    [Fact]
    public void State_FromResponse_falls_back_to_position_and_vehicle_state()
    {
        using var doc = JsonDocument.Parse(
            """{"vehicle":{"id":5,"state":"online"},"position":{"battery_level":33,"ideal_range":250000,"inside_temp":18,"outside_temp":9},"is_charging":false,"charger_power":0}""");

        var state = VehicleHeroStateReading.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(33, state!.BatteryLevel);
        Assert.Equal(250_000, state.IdealRangeMeters);
        Assert.Equal(18, state.InsideTempCelsius);
        Assert.Equal(9, state.OutsideTempCelsius);
        Assert.False(state.IsCharging);
        Assert.Equal("online", state.Status);
    }

    [Fact]
    public void State_FromResponse_uses_plain_state_object_when_no_vehicle_or_position()
    {
        using var doc = JsonDocument.Parse("""{"state":{"battery_level":55,"state":"asleep"}}""");

        var state = VehicleHeroStateReading.FromResponse(doc.RootElement);

        Assert.NotNull(state);
        Assert.Equal(55, state!.BatteryLevel);
        Assert.Equal("asleep", state.Status);
    }

    [Fact]
    public void State_FromResponse_returns_null_when_no_state()
    {
        using var doc = JsonDocument.Parse("""{"live":true}""");
        Assert.Null(VehicleHeroStateReading.FromResponse(doc.RootElement));
    }

    [Fact]
    public void State_FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleHeroStateReading.FromResponse(doc.RootElement));
    }

    // ---- Identity parse adapter (web useVehicles selection) -------------------------

    [Fact]
    public void Identity_FromVehiclesArray_finds_matching_id()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":3,"display_name":"A","model":"Model S","trim_badging":"Plaid"},{"id":7,"display_name":"My Tesla","vin":"5YJ","model":"Model 3","trim_badging":"Performance"}]""");

        var identity = VehicleHeroIdentity.FromVehiclesArray(doc.RootElement, 7);

        Assert.NotNull(identity);
        Assert.Equal(7, identity!.Id);
        Assert.Equal("My Tesla", identity.DisplayName);
        Assert.Equal("Model 3", identity.Model);
        Assert.Equal("Performance", identity.TrimBadging);
        Assert.Equal("My Tesla", identity.Name);
        Assert.Equal("Model 3 Performance", identity.Subtitle);
    }

    [Fact]
    public void Identity_FromVehiclesArray_falls_back_to_first_when_id_absent()
    {
        using var doc = JsonDocument.Parse("""[{"id":3,"display_name":"A","model":"Model S","trim_badging":""}]""");

        var identity = VehicleHeroIdentity.FromVehiclesArray(doc.RootElement, 99);

        Assert.NotNull(identity);
        Assert.Equal(3, identity!.Id);
        Assert.Equal("Model S", identity.Subtitle); // no trim → model only
    }

    [Fact]
    public void Identity_name_falls_back_to_vin_when_display_name_blank()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"display_name":"","vin":"5YJABC","model":"Model Y","trim_badging":""}]""");

        var identity = VehicleHeroIdentity.FromVehiclesArray(doc.RootElement, 1);

        Assert.Equal("5YJABC", identity!.Name);
    }

    [Fact]
    public void Identity_FromVehiclesArray_returns_null_for_empty_array()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Null(VehicleHeroIdentity.FromVehiclesArray(doc.RootElement, 1));
    }

    // ---- Projection (SI → display, unit preferences, web FullView) ------------------

    [Fact]
    public void Project_full_metric_formats_range_and_temperatures()
    {
        var display = VehicleHeroCardProjection.Project(Reading(), Full, UnitPref.Metric, Localizer);

        Assert.Equal("My Tesla", display.Name);
        Assert.Equal("Model 3 Performance", display.Subtitle);
        Assert.Equal("charging", display.Status);
        Assert.Equal("72%", display.BatteryText);
        Assert.Equal("402 km", display.RangeText);
        Assert.Equal("21\u00B0C", display.CabinText);
        Assert.Equal("15\u00B0C", display.OutsideText);
        Assert.False(display.IsCompact);
    }

    [Fact]
    public void Project_full_imperial_converts_range_and_temperatures()
    {
        var display = VehicleHeroCardProjection.Project(Reading(), Full, UnitPref.Imperial, Localizer);

        Assert.Equal("250 mi", display.RangeText);
        Assert.Equal("70\u00B0F", display.CabinText);  // 21°C → 69.8 → 70
        Assert.Equal("59\u00B0F", display.OutsideText); // 15°C → 59
    }

    [Fact]
    public void Project_charging_exposes_banner_with_power()
    {
        var display = VehicleHeroCardProjection.Project(Reading(), Full, UnitPref.Metric, Localizer);

        Assert.True(display.IsCharging);
        Assert.Equal("Charging", display.ChargingText);
        Assert.Equal("11.0 kW", display.ChargerText);
    }

    [Fact]
    public void Project_no_charger_power_hides_power_text()
    {
        var state = State(isCharging: true, chargerPowerKw: 0);
        var display = VehicleHeroCardProjection.Project(ReadingWith(state), Full, UnitPref.Metric, Localizer);

        Assert.True(display.IsCharging);
        Assert.Null(display.ChargerText);
    }

    [Theory]
    [InlineData(72, "TsColorSuccessBrush")]
    [InlineData(60, "TsColorSuccessBrush")]
    [InlineData(40, "TsColorWarningBrush")]
    [InlineData(21, "TsColorWarningBrush")]
    [InlineData(20, "TsColorDangerBrush")]
    [InlineData(5, "TsColorDangerBrush")]
    public void Project_battery_color_follows_thresholds(double level, string expectedKey)
    {
        var display = VehicleHeroCardProjection.Project(
            ReadingWith(State(batteryLevel: level)), Full, UnitPref.Metric, Localizer);

        Assert.Equal(expectedKey, display.BatteryAccentKey);
    }

    [Fact]
    public void Project_no_state_uses_muted_battery_and_offline_status_and_em_dashes()
    {
        var display = VehicleHeroCardProjection.Project(
            new VehicleHeroReading(Identity(), null), Full, UnitPref.Metric, Localizer);

        Assert.Equal("TsColorTextMutedBrush", display.BatteryAccentKey);
        Assert.Equal("offline", display.Status);
        Assert.False(display.HasBattery);
        Assert.Equal(VehicleHeroCardProjection.Dash, display.BatteryText);
        Assert.Equal(VehicleHeroCardProjection.Dash, display.RangeText);
        Assert.Equal(VehicleHeroCardProjection.Dash, display.CabinText);
        Assert.Equal(VehicleHeroCardProjection.Dash, display.OutsideText);
    }

    [Theory]
    [InlineData("online", "TsColorSuccessBrush")]
    [InlineData("driving", "TsColorInfoBrush")]
    [InlineData("charging", "TsColorWarningBrush")]
    [InlineData("parked", "TsColorInfoBrush")]
    [InlineData("asleep", "TsChart07Brush")]
    [InlineData("offline", "TsColorDangerBrush")]
    [InlineData("mystery", "TsColorTextSecondaryBrush")]
    public void Project_status_accent_mirrors_web_badge_dot(string status, string expectedKey)
    {
        var display = VehicleHeroCardProjection.Project(
            ReadingWith(State(status: status)), Full, UnitPref.Metric, Localizer);

        Assert.Equal(expectedKey, display.StatusAccentKey);
    }

    [Fact]
    public void Project_compact_sets_compact_flag_and_battery_value()
    {
        var display = VehicleHeroCardProjection.Project(Reading(), Compact, UnitPref.Metric, Localizer);

        Assert.True(display.IsCompact);
        Assert.True(display.HasBattery);
        Assert.Equal(72, display.BatteryValue);
    }

    [Fact]
    public void Project_a11y_names_are_non_empty_and_describe_the_card()
    {
        var display = VehicleHeroCardProjection.Project(Reading(), Full, UnitPref.Metric, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.CompactAutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.FullAutomationName));
        Assert.Contains("My Tesla", display.FullAutomationName, StringComparison.Ordinal);
        Assert.Contains("Charging", display.FullAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.BatteryText, display.FullAutomationName, StringComparison.Ordinal);
        Assert.Contains(display.RangeText, display.FullAutomationName, StringComparison.Ordinal);
        Assert.Contains("My Tesla", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_labels_resolve_through_i18n()
    {
        var display = VehicleHeroCardProjection.Project(Reading(), Full, UnitPref.Metric, Localizer);

        Assert.Equal("Battery", display.BatteryLabel);
        Assert.Equal("Range", display.RangeLabel);
        Assert.Equal("Cabin", display.CabinLabel);
        Assert.Equal("Outside", display.OutsideLabel);
        Assert.Equal("Ideal", display.IdealLabel);
    }

    // ---- Result mapper (identity + state, cache-then-network preservation) ----------

    [Fact]
    public void Mapper_loaded_combines_identity_and_state()
    {
        using var doc = JsonDocument.Parse(StateJson);

        var mapped = VehicleHeroCardResultMapper.Combine(
            Identity(), RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Equal("Model 3", mapped.Value!.Identity.Model);
        Assert.Equal(72, mapped.Value.State!.BatteryLevel);
    }

    [Fact]
    public void Mapper_stateless_body_still_renders_card_with_null_state()
    {
        // Web parity: vehicle present + state undefined → the card renders (em-dash metrics), not empty.
        using var doc = JsonDocument.Parse("""{"live":false}""");

        var mapped = VehicleHeroCardResultMapper.Combine(
            Identity(), RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Null(mapped.Value!.State);
        Assert.Equal("Model 3", mapped.Value.Identity.Model);
    }

    [Fact]
    public void Mapper_engine_empty_folds_to_loaded_card()
    {
        var mapped = VehicleHeroCardResultMapper.Combine(
            Identity(), RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Null(mapped.Value!.State);
    }

    [Fact]
    public void Mapper_preserves_offline_and_failure()
    {
        using var doc = JsonDocument.Parse(StateJson);

        var offline = VehicleHeroCardResultMapper.Combine(
            Identity(), RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(72, offline.Value!.State!.BatteryLevel);

        var failure = VehicleHeroCardResultMapper.Combine(
            Identity(), RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
    }

    // ---- Source (two-endpoint per-vehicle adapter) ---------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeHeroApiClient();
        var source = new VehicleHeroCardSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_then_reads_vehicles_and_state()
    {
        using var vehicles = JsonDocument.Parse(VehiclesJson);
        using var state = JsonDocument.Parse(StateJson);
        var api = new FakeHeroApiClient()
            .On(Operations.Vehicles.List, vehicles.RootElement)
            .On(Operations.Vehicles.State, state.RootElement);
        var source = new VehicleHeroCardSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7, DisplayName = "Seed", Vin = "5YJ" }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("Model 3", terminal.Value!.Identity.Model);          // enriched from the vehicles list
        Assert.Equal("Performance", terminal.Value.Identity.TrimBadging);
        Assert.Equal(72, terminal.Value.State!.BatteryLevel);
        Assert.True(terminal.Value.State.IsCharging);

        Assert.Contains(api.Requests, r => r.OperationId == Operations.Vehicles.List);
        var stateReq = Assert.Single(api.Requests, r => r.OperationId == Operations.Vehicles.State);
        Assert.Equal("7", stateReq.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_scopes_the_state_read()
    {
        using var vehicles = JsonDocument.Parse(
            """[{"id":42,"display_name":"Forty Two","model":"Model X","trim_badging":""}]""");
        using var state = JsonDocument.Parse("""{"state":{"vehicle_id":42,"battery_level":40,"is_charging":false,"state":"online"}}""");
        var api = new FakeHeroApiClient()
            .On(Operations.Vehicles.List, vehicles.RootElement)
            .On(Operations.Vehicles.State, state.RootElement);
        var source = new VehicleHeroCardSource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("Model X", terminal.Value!.Identity.Model);
        Assert.Equal(40, terminal.Value.State!.BatteryLevel);
        var stateReq = Assert.Single(api.Requests, r => r.OperationId == Operations.Vehicles.State);
        Assert.Equal("42", stateReq.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task Source_stateless_body_still_renders_the_card()
    {
        using var vehicles = JsonDocument.Parse(VehiclesJson);
        using var state = JsonDocument.Parse("""{"live":false}""");
        var api = new FakeHeroApiClient()
            .On(Operations.Vehicles.List, vehicles.RootElement)
            .On(Operations.Vehicles.State, state.RootElement);
        var source = new VehicleHeroCardSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.NotNull(terminal.Value);
        Assert.Null(terminal.Value!.State);
        Assert.Equal("Model 3", terminal.Value.Identity.Model);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("vehicle-hero-card", VehicleHeroCardRegistration.Id);
        Assert.Equal("vehicle", VehicleHeroCardRegistration.Category);
        Assert.Equal("VehicleHeroCardWidget", VehicleHeroCardRegistration.Slug);
        Assert.Equal(new VehicleHeroCardSize(2, 2), VehicleHeroCardRegistration.DefaultSize);
        Assert.Equal(new VehicleHeroCardSize(1, 2), VehicleHeroCardRegistration.MinSize);
        Assert.Equal(new VehicleHeroCardSize(4, 40), VehicleHeroCardRegistration.MaxSize);
        Assert.Equal("Vehicle Hero Card", VehicleHeroCardRegistration.Name(Localizer));
        Assert.Contains("state badge", VehicleHeroCardRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RegistryId_is_exposed_on_the_view_type() =>
        Assert.Equal("vehicle-hero-card", VehicleHeroCardRegistration.Id);

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 2, true)]    // default
    [InlineData(5, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, VehicleHeroCardRegistration.IsWithinBounds(new VehicleHeroCardSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new VehicleHeroCardSize(1, 2), VehicleHeroCardRegistration.Clamp(new VehicleHeroCardSize(0, 0)));
        Assert.Equal(new VehicleHeroCardSize(4, 40), VehicleHeroCardRegistration.Clamp(new VehicleHeroCardSize(9, 99)));
    }

    [Theory]
    [InlineData(1, 1, true, false, false)]   // compact
    [InlineData(2, 2, false, false, true)]   // default: tall, not wide
    [InlineData(3, 2, false, true, true)]    // wide + tall
    public void Size_flags_match_web_breakpoints(int cols, int rows, bool compact, bool wide, bool tall)
    {
        var size = new VehicleHeroCardSize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(tall, size.IsTall);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleHeroCardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleHeroCardWidget", Assert.Single(lines));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_card_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Loaded, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.NotNull(vm.Display);
        Assert.Equal("My Tesla", vm.Display!.Name);
        Assert.Equal("402 km", vm.Display.RangeText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Empty, vm.State);
        Assert.False(vm.HasVehicle);
        Assert.Null(vm.Display);
        Assert.Equal("No vehicle data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeroReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeroReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasVehicle);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Offline, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeroReading>.Loading(),
            RepositoryResult<VehicleHeroReading>.Cached(ReadingWith(State(batteryLevel: 30)), Now, stale: false),
            RepositoryResult<VehicleHeroReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroCardState.Loaded, vm.State);
        Assert.Equal("72%", vm.Display!.BatteryText);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_range()
    {
        using var vm = NewViewModel(VehicleHeroCardSize.Default, UnitPref.Metric, Loaded(Reading()));
        await vm.LoadAsync();
        Assert.Equal("402 km", vm.Display!.RangeText);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("250 mi", vm.Display!.RangeText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout_flags()
    {
        using var vm = NewViewModel(new VehicleHeroCardSize(2, 2), UnitPref.Metric, Loaded(Reading()));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsWide);

        vm.Size = new VehicleHeroCardSize(3, 2);
        Assert.True(vm.Display!.IsWide);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Vehicle", vm.Title);
        Assert.Equal("No vehicle data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Reading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VehicleHeroCardViewModel.State), changed);
        Assert.Contains(nameof(VehicleHeroCardViewModel.Display), changed);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static readonly VehicleHeroCardSize Full = new(2, 2);
    private static readonly VehicleHeroCardSize Compact = new(1, 1);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static VehicleHeroIdentity Identity() => new(7, "My Tesla", "5YJ3E1EA7KF000000", "Model 3", "Performance");

    private static VehicleHeroStateReading State(
        double? batteryLevel = 72,
        double? idealRangeMeters = TwoFiftyMilesMeters,
        double? insideTempCelsius = 21,
        double? outsideTempCelsius = 15,
        bool isCharging = true,
        double? chargerPowerKw = 11,
        string status = "charging") =>
        new(batteryLevel, idealRangeMeters, insideTempCelsius, outsideTempCelsius, isCharging, chargerPowerKw, status);

    private static VehicleHeroReading Reading() => new(Identity(), State());

    private static VehicleHeroReading ReadingWith(VehicleHeroStateReading state) => new(Identity(), state);

    private static async Task<List<RepositoryResult<VehicleHeroReading>>> Drain(IVehicleHeroCardSource source)
    {
        var list = new List<RepositoryResult<VehicleHeroReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<VehicleHeroReading> Loaded(VehicleHeroReading reading) =>
        RepositoryResult<VehicleHeroReading>.Loaded(reading, Now);

    private static VehicleHeroCardViewModel NewViewModel(params RepositoryResult<VehicleHeroReading>[] emissions) =>
        NewViewModel(VehicleHeroCardSize.Default, UnitPref.Metric, emissions);

    private static VehicleHeroCardViewModel NewViewModel(
        VehicleHeroCardSize size,
        UnitPref units,
        params RepositoryResult<VehicleHeroReading>[] emissions) =>
        new(new FakeVehicleHeroCardSource(emissions), Localizer, size, units);

    private sealed class FakeVehicleHeroCardSource(params RepositoryResult<VehicleHeroReading>[] emissions) : IVehicleHeroCardSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleHeroReading>> StreamAsync(
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

    private sealed class FakeHeroApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _byOperation = new(StringComparer.Ordinal);
        private readonly List<ApiRequest> _requests = new();
        private readonly Lock _gate = new();

        public IReadOnlyList<ApiRequest> Requests
        {
            get
            {
                lock (_gate)
                {
                    return _requests.ToList();
                }
            }
        }

        public FakeHeroApiClient On<T>(string operationId, T value)
        {
            _byOperation[operationId] = () => value;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                _requests.Add(request);
            }

            if (!_byOperation.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"FakeHeroApiClient received an unexpected request: {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
