using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the VehicleHeader surface's UI-thread-free logic — the vehicle/state parse
/// adapters, the web-faithful status derivation, the projection (title fallback, subtitle, status accent and
/// the spoken accessibility name), the i18n keys, the registration metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline) plus
/// the wake mutation (idle → waking → sent/failed). Mirrors the web spec
/// (web/src/features/vehicles/components/VehicleHeader.tsx).
/// </summary>
public sealed class VehicleHeaderTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse: vehicle identity ---------------------------------------------------

    [Fact]
    public void FromVehiclesArray_prefers_the_matching_id()
    {
        var v = VehicleHeaderVehicle.FromVehiclesArray(
            Json("""[ { "id": 1, "vin": "AAA" }, { "id": 7, "display_name": "My Tesla", "vin": "VIN9", "model": "Model 3", "trim_badging": "Long Range" } ]"""),
            preferredId: 7);

        Assert.NotNull(v);
        Assert.Equal(7, v!.Id);
        Assert.Equal("My Tesla", v.DisplayName);
        Assert.Equal("VIN9", v.Vin);
        Assert.Equal("Model 3", v.Model);
        Assert.Equal("Long Range", v.TrimBadging);
    }

    [Fact]
    public void FromVehiclesArray_falls_back_to_the_first_entry()
    {
        var byNull = VehicleHeaderVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: null);
        Assert.Equal(3, byNull!.Id);

        var noMatch = VehicleHeaderVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: 99);
        Assert.Equal(3, noMatch!.Id);
    }

    [Fact]
    public void FromVehiclesArray_returns_null_for_empty_or_non_array()
    {
        Assert.Null(VehicleHeaderVehicle.FromVehiclesArray(Json("[]"), null));
        Assert.Null(VehicleHeaderVehicle.FromVehiclesArray(Json("{}"), null));
        Assert.Null(VehicleHeaderVehicle.FromVehiclesArray(Json("null"), null));
    }

    [Fact]
    public void Vehicle_name_prefers_display_name_then_vin()
    {
        Assert.Equal("My Tesla", new VehicleHeaderVehicle(1, "My Tesla", "VIN", "", "").Name);
        Assert.Equal("VIN", new VehicleHeaderVehicle(1, "  ", "VIN", "", "").Name);
        Assert.Equal(string.Empty, new VehicleHeaderVehicle(1, "  ", "  ", "", "").Name);
    }

    [Fact]
    public void Vehicle_subtitle_joins_model_trim_and_vin()
    {
        Assert.Equal("Model 3 Long Range \u00B7 VIN9", new VehicleHeaderVehicle(1, "n", "VIN9", "Model 3", "Long Range").Subtitle);
        Assert.Equal("VIN9", new VehicleHeaderVehicle(1, "n", "VIN9", "", "").Subtitle);
        Assert.Equal("Model Y", new VehicleHeaderVehicle(1, "n", "", "Model Y", "").Subtitle);
    }

    [Fact]
    public void Vehicle_has_vehicle_when_id_or_vin_present()
    {
        Assert.True(new VehicleHeaderVehicle(7, "", "", "", "").HasVehicle);
        Assert.True(new VehicleHeaderVehicle(0, "", "VIN", "", "").HasVehicle);
        Assert.False(VehicleHeaderVehicle.None.HasVehicle);
    }

    // ---- Parse: telemetry ----------------------------------------------------------

    [Fact]
    public void FromResponse_reads_the_wrapped_state_object()
    {
        var t = VehicleHeaderTelemetry.FromResponse(Json("""{ "state": { "state": "driving", "speed": 25, "is_charging": false } }"""));

        Assert.NotNull(t);
        Assert.Equal("driving", t!.RawState);
        Assert.Equal(25, t.SpeedMps);
        Assert.False(t.IsCharging);
    }

    [Fact]
    public void FromResponse_reads_a_bare_state_object()
    {
        var t = VehicleHeaderTelemetry.FromResponse(Json("""{ "state": "charging", "is_charging": true }"""));

        Assert.NotNull(t);
        Assert.Equal("charging", t!.RawState);
        Assert.True(t.IsCharging);
    }

    [Fact]
    public void FromResponse_returns_null_when_asleep_or_stateless()
    {
        Assert.Null(VehicleHeaderTelemetry.FromResponse(Json("{}")));
        Assert.Null(VehicleHeaderTelemetry.FromResponse(Json("""{ "state": null }""")));
        Assert.Null(VehicleHeaderTelemetry.FromResponse(Json("null")));
    }

    // ---- Status derivation (web getVehicleStatus parity) ---------------------------

    [Theory]
    [InlineData(true, 0, "online", "charging")]   // is_charging wins over everything
    [InlineData(false, 25, "online", "driving")]  // speed > 0 ⇒ driving
    [InlineData(false, 0, "parked", "parked")]    // recognised FSM state passes through
    [InlineData(false, 0, "asleep", "asleep")]
    [InlineData(false, 0, "weird", "online")]     // unrecognised ⇒ online
    [InlineData(false, 0, "", "online")]          // empty state ⇒ online
    public void Derive_with_vehicle_mirrors_the_web(bool charging, double speed, string raw, string expected) =>
        Assert.Equal(expected, VehicleHeaderStatus.Derive(SampleVehicle(), new VehicleHeaderTelemetry(raw, speed, charging)));

    [Fact]
    public void Derive_is_offline_without_a_vehicle()
    {
        Assert.Equal("offline", VehicleHeaderStatus.Derive(null, new VehicleHeaderTelemetry("online", 0, false)));
        Assert.Equal("offline", VehicleHeaderStatus.Derive(null, null));
    }

    [Fact]
    public void Derive_is_offline_when_the_vehicle_has_no_live_state() =>
        Assert.Equal("offline", VehicleHeaderStatus.Derive(SampleVehicle(), null));

    [Fact]
    public void Data_status_uses_the_derivation()
    {
        Assert.Equal("charging", new VehicleHeaderData(SampleVehicle(), new VehicleHeaderTelemetry("online", 0, true)).Status);
        Assert.Equal("offline", VehicleHeaderData.Empty.Status);
    }

    // ---- Status accent -------------------------------------------------------------

    [Theory]
    [InlineData("online", "TsColorSuccessBrush")]
    [InlineData("driving", "TsColorInfoBrush")]
    [InlineData("charging", "TsColorWarningBrush")]
    [InlineData("parked", "TsColorInfoBrush")]
    [InlineData("updating", "TsColorInfoBrush")]
    [InlineData("asleep", "TsChart07Brush")]
    [InlineData("offline", "TsColorDangerBrush")]
    [InlineData("weird", "TsColorTextSecondaryBrush")]
    public void AccentKey_maps_each_state_to_a_token(string status, string expected) =>
        Assert.Equal(expected, VehicleHeaderStatus.AccentKey(status));

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_renders_the_name_subtitle_status_and_accent()
    {
        var view = Project(Data(Online()));

        Assert.Equal("My Tesla", view.Name);
        Assert.Equal("Model 3 Long Range \u00B7 VIN9", view.Subtitle);
        Assert.Equal("online", view.Status);
        Assert.Equal("TsColorSuccessBrush", view.StatusAccentKey);
        Assert.True(view.HasVehicle);
    }

    [Fact]
    public void Project_falls_back_to_the_vehicle_title_when_unnamed()
    {
        var view = Project(new VehicleHeaderData(new VehicleHeaderVehicle(7, "  ", "", "Model 3", ""), null));

        Assert.Equal("Vehicle", view.Name);   // web t('common.vehicle', 'Vehicle')
        Assert.Equal("offline", view.Status);  // vehicle present but no live state
        Assert.True(view.HasVehicle);
    }

    [Fact]
    public void Project_empty_snapshot_renders_a_friendly_header()
    {
        var view = Project(VehicleHeaderData.Empty);

        Assert.False(view.HasVehicle);
        Assert.Equal("Vehicle", view.Name);
        Assert.Equal("offline", view.Status);
        Assert.Equal(string.Empty, view.Subtitle);
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();

        Assert.Equal("L:common.vehicle", VehicleHeaderDisplay.Empty(echo).Name);
        Assert.Equal("L:common.vehicle", VehicleHeaderRegistration.TitleFallback(echo));
        Assert.Equal("L:common.wakeUp", VehicleHeaderRegistration.WakeLabel(echo));
        Assert.Equal("L:common.back", VehicleHeaderRegistration.BackLabel(echo));
        Assert.Equal("L:common.refresh", VehicleHeaderRegistration.RefreshLabel(echo));
        Assert.Equal("L:common.retry", VehicleHeaderRegistration.RetryLabel(echo));
        Assert.Equal("L:common.loading", VehicleHeaderRegistration.LoadingLabel(echo));
        Assert.Equal("L:common.stale", VehicleHeaderRegistration.StaleLabel(echo));
        Assert.Equal("L:common.offline", VehicleHeaderRegistration.OfflineLabel(echo));
        Assert.Equal("L:vehicles.detail.title", VehicleHeaderRegistration.Name(echo));
        Assert.Equal("L:vehicles.emptyTitle", VehicleHeaderRegistration.EmptyMessage(echo));
        Assert.Equal("L:vehicles.loadError", VehicleHeaderRegistration.LoadErrorMessage(echo));
        Assert.Equal("L:toast.vehicles.wake.success", VehicleHeaderRegistration.WakeSuccessMessage(echo));
        Assert.Equal("L:toast.vehicles.wake.error", VehicleHeaderRegistration.WakeErrorMessage(echo));
        Assert.Equal("L:vehicle.state.charging", VehicleHeaderRegistration.StatusLabel(echo, "charging"));
    }

    // ---- a11y: every surface carries a spoken name ---------------------------------

    [Fact]
    public void Projected_header_carries_a_non_empty_automation_name()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(Data(Driving())).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(VehicleHeaderDisplay.Empty(Localizer).AutomationName));
        Assert.Equal("My Tesla, Charging", Project(Data(Charging())).AutomationName);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeaderData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_the_header_and_enables_wake()
    {
        using var vm = NewViewModel(Loaded(Data(Driving())));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Loaded, vm.State);
        Assert.True(vm.HasVehicle);
        Assert.True(vm.CanWake);
        Assert.True(vm.WakeButtonEnabled);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.Equal("My Tesla", vm.Display.Name);
        Assert.Equal("driving", vm.Display.Status);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_renders_empty_and_disables_wake()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeaderData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Empty, vm.State);
        Assert.False(vm.HasVehicle);
        Assert.False(vm.CanWake);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeaderData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeaderData>.Cached(Data(Online()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasVehicle);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeaderData>.OfflineCached(
            Data(Online()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeaderData>.Loading(),
            RepositoryResult<VehicleHeaderData>.Cached(Data(Online()), Now, stale: false),
            RepositoryResult<VehicleHeaderData>.Loaded(Data(Driving()), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeaderState.Loaded, vm.State);
        Assert.Equal("driving", vm.Display.Status); // the freshest snapshot wins
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(Online())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VehicleHeaderViewModel.State), changed);
        Assert.Contains(nameof(VehicleHeaderViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeaderData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Vehicle Detail", vm.Title);
    }

    // ---- View-model: wake mutation -------------------------------------------------

    [Fact]
    public async Task Wake_success_sends_then_refetches_and_records_diagnostics()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleHeaderDiagnostics(lines.Add);
        var source = new FakeVehicleHeaderSource(VehicleHeaderWakeOutcome.Ok(), Loaded(Data(Online())));
        using var vm = new VehicleHeaderViewModel(source, Localizer, diagnostics, _ => Task.CompletedTask);

        await vm.LoadAsync();
        Assert.True(vm.CanWake);

        await vm.WakeAsync();

        Assert.Equal(VehicleHeaderWakePhase.Sent, vm.WakePhase);
        Assert.False(vm.WakeFailed);
        Assert.Equal("Wake command sent", vm.WakeStatusMessage);
        Assert.Equal(1, source.WakeCalls);
        Assert.Equal(7, source.WakeVehicleId);
        Assert.Equal(2, source.StreamCalls); // initial load + post-wake refetch (web setTimeout(onRefetchState))
        Assert.Equal(1, diagnostics.WakesRequested);
        Assert.Equal(1, diagnostics.WakesSucceeded);
        Assert.Contains("vehicle.wake.requested slug=VehicleHeader", lines);
        Assert.Contains("vehicle.wake.resolved slug=VehicleHeader success=true", lines);
    }

    [Fact]
    public async Task Wake_failure_surfaces_the_error_and_does_not_refetch()
    {
        var diagnostics = new VehicleHeaderDiagnostics();
        var source = new FakeVehicleHeaderSource(
            VehicleHeaderWakeOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            Loaded(Data(Online())));
        using var vm = new VehicleHeaderViewModel(source, Localizer, diagnostics, _ => Task.CompletedTask);

        await vm.LoadAsync();
        await vm.WakeAsync();

        Assert.Equal(VehicleHeaderWakePhase.Failed, vm.WakePhase);
        Assert.True(vm.WakeFailed);
        Assert.Equal("Failed to wake vehicle", vm.WakeStatusMessage);
        Assert.Equal(1, source.WakeCalls);
        Assert.Equal(1, source.StreamCalls); // no refetch on failure
        Assert.Equal(1, diagnostics.WakesFailed);
        Assert.True(vm.CanWake); // re-enabled so the user can retry
    }

    [Fact]
    public async Task Wake_is_a_no_op_without_a_resolved_vehicle()
    {
        var source = new FakeVehicleHeaderSource(VehicleHeaderWakeOutcome.Ok(), RepositoryResult<VehicleHeaderData>.Empty(Now));
        using var vm = new VehicleHeaderViewModel(source, Localizer, null, _ => Task.CompletedTask);

        await vm.LoadAsync();
        Assert.False(vm.CanWake);

        await vm.WakeAsync();

        Assert.Equal(VehicleHeaderWakePhase.Idle, vm.WakePhase);
        Assert.Equal(0, source.WakeCalls);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("vehicle-header", VehicleHeaderRegistration.Id);
        Assert.Equal("vehicles", VehicleHeaderRegistration.Category);
        Assert.Equal("VehicleHeader", VehicleHeaderRegistration.Slug);
        Assert.Equal("Vehicle Detail", VehicleHeaderRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emit_pii_safe_lines_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleHeaderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordWakeRequested();
        diagnostics.RecordWakeResolved(true);
        diagnostics.RecordWakeResolved(false);

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.WakesRequested);
        Assert.Equal(1, diagnostics.WakesSucceeded);
        Assert.Equal(1, diagnostics.WakesFailed);
        Assert.Contains("view.opened slug=VehicleHeader", lines);
        Assert.Contains("vehicle.wake.requested slug=VehicleHeader", lines);
        Assert.Contains("vehicle.wake.resolved slug=VehicleHeader success=true", lines);
        Assert.Contains("vehicle.wake.resolved slug=VehicleHeader success=false", lines);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static VehicleHeaderVehicle SampleVehicle() => new(7, "My Tesla", "VIN9", "Model 3", "Long Range");

    private static VehicleHeaderData Data(VehicleHeaderTelemetry? state) => new(SampleVehicle(), state);

    private static VehicleHeaderTelemetry Online() => new("online", 0, false);

    private static VehicleHeaderTelemetry Driving() => new("driving", 25, false);

    private static VehicleHeaderTelemetry Charging() => new("charging", 0, true);

    private static VehicleHeaderDisplay Project(VehicleHeaderData data) =>
        VehicleHeaderProjection.Project(data, Localizer);

    private static RepositoryResult<VehicleHeaderData> Loaded(VehicleHeaderData data) =>
        RepositoryResult<VehicleHeaderData>.Loaded(data, Now);

    private static VehicleHeaderViewModel NewViewModel(params RepositoryResult<VehicleHeaderData>[] emissions) =>
        new(new FakeVehicleHeaderSource(VehicleHeaderWakeOutcome.Ok(), emissions), Localizer, null, _ => Task.CompletedTask);

    private sealed class FakeVehicleHeaderSource(
        VehicleHeaderWakeOutcome wake,
        params RepositoryResult<VehicleHeaderData>[] emissions) : IVehicleHeaderSource
    {
        public int StreamCalls { get; private set; }

        public int WakeCalls { get; private set; }

        public long WakeVehicleId { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<VehicleHeaderData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            StreamCalls++;
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public Task<VehicleHeaderWakeOutcome> WakeAsync(long vehicleId, CancellationToken cancellationToken = default)
        {
            WakeCalls++;
            WakeVehicleId = vehicleId;
            return Task.FromResult(wake);
        }
    }

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
