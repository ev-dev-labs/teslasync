using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>VehicleTwin</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, logical canvas, per-size widths and the i18n keys / verbatim English
/// fallbacks), the pure <see cref="VehicleTwinProjection"/> (the <c>useVehiclePaint</c> override &gt; inferred &gt;
/// fallback resolution, the always-on lock / windows chips, the active-only driving / charging / sentry / lights /
/// hazards / doors / frunk / trunk chips and the composed accessible description), the
/// <see cref="InMemoryVehiclePaintOverrideStore"/>, the <see cref="VehicleTwinViewModel"/> state holder (every
/// loading / loaded / empty / error / stale / offline branch, paint-override and size re-projection, retry and
/// subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/vehicles/VehicleTwin.tsx). The WinUI view itself
/// (shared-surfaces/VehicleTwin/VehicleTwin.cs) is exercised by the app build.
/// </summary>
public sealed class VehicleTwinTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static VehicleTwinModel Model(
        bool? locked = null,
        bool isCharging = false,
        bool isDriving = false,
        bool? sentry = null,
        bool? headlights = null,
        TurnSignal turnSignal = TurnSignal.Unknown,
        bool? doorDriverFront = null,
        bool? frunkOpen = null,
        bool? trunkOpen = null,
        WindowPosition windowDriverFront = WindowPosition.Unknown,
        string? exteriorColor = null) =>
        new()
        {
            Locked = locked,
            IsCharging = isCharging,
            IsDriving = isDriving,
            SentryMode = sentry,
            Headlights = headlights,
            TurnSignal = turnSignal,
            DoorDriverFront = doorDriverFront,
            FrunkOpen = frunkOpen,
            TrunkOpen = trunkOpen,
            WindowDriverFront = windowDriverFront,
            ExteriorColor = exteriorColor,
        };

    private static VehicleTwinReading Reading(
        VehicleTwinModel? model = null,
        long? vehicleId = 7,
        string? displayName = "My Tesla",
        string? vin = "5YJ3E1EA7KF000001") =>
        new(model ?? Model(), vehicleId, displayName, vin);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("VehicleTwin", VehicleTwinRegistration.Slug);

    [Fact]
    public void Registration_slug_matches_the_view_model_slug() =>
        Assert.Equal(VehicleTwinRegistration.Slug, VehicleTwinViewModel.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("vehicle-twin-surface", VehicleTwinRegistration.RootAutomationId);

    [Fact]
    public void Logical_canvas_matches_the_hosted_visual()
    {
        Assert.Equal(560, VehicleTwinRegistration.LogicalWidth);
        Assert.Equal(220, VehicleTwinRegistration.LogicalHeight);
    }

    [Theory]
    [InlineData(VehicleTwinSize.Small, 300)]
    [InlineData(VehicleTwinSize.Medium, 440)]
    [InlineData(VehicleTwinSize.Large, 560)]
    public void Width_matches_the_web_size_map(VehicleTwinSize size, double expected) =>
        Assert.Equal(expected, VehicleTwinRegistration.Width(size));

    [Fact]
    public void I18n_keys_and_fallbacks_are_stable()
    {
        Assert.Equal("vehicle.twin.loading", VehicleTwinRegistration.LoadingKey);
        Assert.Equal("Loading vehicle state", VehicleTwinRegistration.LoadingFallback);
        Assert.Equal("vehicle.twin.empty.title", VehicleTwinRegistration.EmptyTitleKey);
        Assert.Equal("No vehicle data", VehicleTwinRegistration.EmptyTitleFallback);
        Assert.Equal("vehicle.twin.error", VehicleTwinRegistration.ErrorKey);
        Assert.Equal("vehicle.twin.error.offline", VehicleTwinRegistration.ErrorOfflineKey);
        Assert.Equal("vehicle.twin.error.auth", VehicleTwinRegistration.ErrorAuthKey);
        Assert.Equal("common.retry", VehicleTwinRegistration.RetryKey);
        Assert.Equal("vehicle.twin.stale", VehicleTwinRegistration.StaleKey);
        Assert.Equal("vehicle.twin.offline", VehicleTwinRegistration.OfflineKey);
    }

    // ── paint resolution (web useVehiclePaint) ────────────────────────────────────────────────────────────

    [Fact]
    public void ResolvePaint_override_wins_over_inferred()
    {
        (PaintPalette paint, bool overridden) = VehicleTwinProjection.ResolvePaint(PaintPaletteId.RedMulticoat, "white");
        Assert.Equal(PaintPaletteId.RedMulticoat, paint.Id);
        Assert.True(overridden);
    }

    [Fact]
    public void ResolvePaint_infers_from_exterior_color_when_not_overridden()
    {
        (PaintPalette paint, bool overridden) = VehicleTwinProjection.ResolvePaint(null, "deep blue metallic");
        Assert.Equal(PaintPaletteId.DeepBlue, paint.Id);
        Assert.False(overridden);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("MysteryColor")]
    public void ResolvePaint_falls_back_to_pearl_white(string? exterior)
    {
        (PaintPalette paint, bool overridden) = VehicleTwinProjection.ResolvePaint(null, exterior);
        Assert.Equal(PaintPaletteId.PearlWhite, paint.Id);
        Assert.False(overridden);
    }

    // ── projection chips ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_always_includes_lock_and_windows_chips()
    {
        VehicleTwinDisplay display = VehicleTwinProjection.Project(Reading(), overrideId: null, VehicleTwinSize.Medium, Localizer);
        Assert.Contains(display.Chips, c => c.Kind == "lock");
        Assert.Contains(display.Chips, c => c.Kind == "windows");
    }

    [Fact]
    public void Project_adds_active_state_chips_only_when_reported()
    {
        var model = Model(
            locked: true,
            isCharging: true,
            isDriving: true,
            sentry: true,
            headlights: true,
            turnSignal: TurnSignal.Both,
            doorDriverFront: true,
            frunkOpen: true,
            trunkOpen: true);

        VehicleTwinDisplay display = VehicleTwinProjection.Project(Reading(model), overrideId: null, VehicleTwinSize.Large, Localizer);
        string[] kinds = display.Chips.Select(c => c.Kind).ToArray();

        Assert.Contains("driving", kinds);
        Assert.Contains("charging", kinds);
        Assert.Contains("sentry", kinds);
        Assert.Contains("headlights", kinds);
        Assert.Contains("hazards", kinds);
        Assert.Contains("doors", kinds);
        Assert.Contains("frunk", kinds);
        Assert.Contains("trunk", kinds);
    }

    [Fact]
    public void Project_omits_inactive_state_chips()
    {
        VehicleTwinDisplay display = VehicleTwinProjection.Project(Reading(Model()), overrideId: null, VehicleTwinSize.Medium, Localizer);
        string[] kinds = display.Chips.Select(c => c.Kind).ToArray();

        Assert.DoesNotContain("driving", kinds);
        Assert.DoesNotContain("charging", kinds);
        Assert.DoesNotContain("frunk", kinds);
        Assert.DoesNotContain("trunk", kinds);
    }

    [Fact]
    public void Project_caption_prefers_display_name_then_vin()
    {
        Assert.Equal("My Tesla", VehicleTwinProjection.Project(Reading(displayName: "My Tesla", vin: "VIN1"), null, VehicleTwinSize.Medium, Localizer).Caption);
        Assert.Equal("VIN1", VehicleTwinProjection.Project(Reading(displayName: null, vin: "VIN1"), null, VehicleTwinSize.Medium, Localizer).Caption);
        Assert.Equal(string.Empty, VehicleTwinProjection.Project(Reading(displayName: null, vin: null), null, VehicleTwinSize.Medium, Localizer).Caption);
    }

    [Fact]
    public void Project_size_flows_through()
    {
        Assert.Equal(VehicleTwinSize.Small, VehicleTwinProjection.Project(Reading(), null, VehicleTwinSize.Small, Localizer).Size);
        Assert.Equal(VehicleTwinSize.Large, VehicleTwinProjection.Project(Reading(), null, VehicleTwinSize.Large, Localizer).Size);
    }

    [Theory]
    [InlineData(WindowPosition.Open, 1)]
    [InlineData(WindowPosition.Partial, 1)]
    [InlineData(WindowPosition.Closed, 0)]
    [InlineData(WindowPosition.Unknown, 0)]
    public void OpenWindowCount_counts_open_and_partial(WindowPosition position, int expected) =>
        Assert.Equal(expected, VehicleTwinProjection.OpenWindowCount(Model(windowDriverFront: position)));

    [Fact]
    public void OpenDoorCount_counts_reported_open_doors() =>
        Assert.Equal(1, VehicleTwinProjection.OpenDoorCount(Model(doorDriverFront: true)));

    // ── accessibility ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_automation_name_describes_the_surface_and_state()
    {
        VehicleTwinDisplay display = VehicleTwinProjection.Project(
            Reading(Model(locked: true), displayName: "Garage Car"),
            overrideId: null,
            VehicleTwinSize.Medium,
            Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.Contains("Vehicle digital twin", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Garage Car", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Locked", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_every_chip_has_a_non_empty_label()
    {
        VehicleTwinDisplay display = VehicleTwinProjection.Project(
            Reading(Model(locked: false, isCharging: true)),
            overrideId: null,
            VehicleTwinSize.Medium,
            Localizer);

        Assert.All(display.Chips, c => Assert.False(string.IsNullOrWhiteSpace(c.Text)));
    }

    // ── paint override store (web useVehiclePaint persistence) ────────────────────────────────────────────

    [Fact]
    public void PaintStore_round_trips_and_clears_an_override()
    {
        var store = new InMemoryVehiclePaintOverrideStore();
        Assert.Null(store.GetOverride(7));

        store.SetOverride(7, PaintPaletteId.SolidBlack);
        Assert.Equal(PaintPaletteId.SolidBlack, store.GetOverride(7));

        store.SetOverride(7, null);
        Assert.Null(store.GetOverride(7));
    }

    [Fact]
    public void PaintStore_ignores_non_positive_vehicle_ids()
    {
        var store = new InMemoryVehiclePaintOverrideStore();
        store.SetOverride(0, PaintPaletteId.RedMulticoat);
        store.SetOverride(-1, PaintPaletteId.RedMulticoat);
        Assert.Null(store.GetOverride(0));
        Assert.Null(store.GetOverride(-1));
    }

    [Fact]
    public void PaintStore_raises_changed_on_mutation()
    {
        var store = new InMemoryVehiclePaintOverrideStore();
        VehiclePaintOverrideChange? seen = null;
        store.Changed += (_, e) => seen = e;

        store.SetOverride(7, PaintPaletteId.DeepBlue);

        Assert.NotNull(seen);
        Assert.Equal(7, seen!.Value.VehicleId);
        Assert.Equal(PaintPaletteId.DeepBlue, seen.Value.PaintId);
    }

    // ── view-model state machine ──────────────────────────────────────────────────────────────────────────

    private static VehicleTwinViewModel NewViewModel(
        out InMemoryVehiclePaintOverrideStore store,
        params RepositoryResult<VehicleTwinReading>[] emissions)
    {
        store = new InMemoryVehiclePaintOverrideStore();
        var source = new ScriptedVehicleTwinSource(emissions);
        return new VehicleTwinViewModel(source, store, Localizer, VehicleTwinSize.Medium);
    }

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = NewViewModel(out _);
        Assert.Equal(VehicleTwinViewState.Loading, vm.State);
        Assert.Null(vm.Display);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_the_twin()
    {
        var fetchedAt = DateTimeOffset.UtcNow;
        using var vm = NewViewModel(
            out _,
            RepositoryResult<VehicleTwinReading>.Loading(),
            RepositoryResult<VehicleTwinReading>.Loaded(Reading(Model(exteriorColor: "deep blue metallic")), fetchedAt));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinViewState.Loaded, vm.State);
        Assert.NotNull(vm.Display);
        Assert.Equal(PaintPaletteId.DeepBlue, vm.Display!.Paint.Id);
        Assert.False(vm.Display.IsOverridden);
        Assert.True(vm.HasTwin);
        Assert.Equal(fetchedAt, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_emission_shows_empty_state()
    {
        using var vm = NewViewModel(out _, RepositoryResult<VehicleTwinReading>.Empty(DateTimeOffset.UtcNow));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinViewState.Empty, vm.State);
        Assert.Null(vm.Display);
        Assert.False(vm.HasTwin);
    }

    [Fact]
    public async Task ViewModel_hard_failure_shows_error_with_message()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        using var vm = NewViewModel(out _, RepositoryResult<VehicleTwinReading>.Failure(error));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinViewState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal(VehicleTwinRegistration.ErrorFallback, vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_unauthorized_failure_uses_auth_message()
    {
        var error = new RepositoryError(RepositoryErrorKind.Unauthorized, "401");
        using var vm = NewViewModel(out _, RepositoryResult<VehicleTwinReading>.Failure(error));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinRegistration.ErrorAuthFallback, vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_cached_stale_reading_is_stale_with_twin()
    {
        using var vm = NewViewModel(
            out _,
            RepositoryResult<VehicleTwinReading>.Cached(Reading(), DateTimeOffset.UtcNow, stale: true));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinViewState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.NotNull(vm.Display);
    }

    [Fact]
    public async Task ViewModel_offline_shows_cached_twin_with_offline_message()
    {
        var error = new RepositoryError(RepositoryErrorKind.Offline, "offline");
        using var vm = NewViewModel(
            out _,
            RepositoryResult<VehicleTwinReading>.OfflineCached(Reading(), DateTimeOffset.UtcNow, error));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinViewState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.NotNull(vm.Display);
        Assert.Equal(VehicleTwinRegistration.ErrorOfflineFallback, vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_refreshing_keeps_the_twin_visible()
    {
        using var vm = NewViewModel(
            out _,
            RepositoryResult<VehicleTwinReading>.Refreshing(Reading(), DateTimeOffset.UtcNow, stale: false));

        await vm.LoadAsync();

        Assert.Equal(VehicleTwinViewState.Loaded, vm.State);
        Assert.True(vm.IsFetching);
        Assert.NotNull(vm.Display);
    }

    [Fact]
    public async Task ViewModel_counts_attempts_across_retries()
    {
        using var vm = NewViewModel(out _, RepositoryResult<VehicleTwinReading>.Loaded(Reading(), DateTimeOffset.UtcNow));

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_paint_override_changes()
    {
        using var vm = NewViewModel(
            out InMemoryVehiclePaintOverrideStore store,
            RepositoryResult<VehicleTwinReading>.Loaded(Reading(Model(exteriorColor: "white"), vehicleId: 7), DateTimeOffset.UtcNow));

        await vm.LoadAsync();
        Assert.Equal(PaintPaletteId.PearlWhite, vm.Display!.Paint.Id);
        Assert.False(vm.Display.IsOverridden);

        store.SetOverride(7, PaintPaletteId.RedMulticoat);

        Assert.Equal(PaintPaletteId.RedMulticoat, vm.Display!.Paint.Id);
        Assert.True(vm.Display.IsOverridden);
    }

    [Fact]
    public async Task ViewModel_ignores_override_for_a_different_vehicle()
    {
        using var vm = NewViewModel(
            out InMemoryVehiclePaintOverrideStore store,
            RepositoryResult<VehicleTwinReading>.Loaded(Reading(Model(exteriorColor: "white"), vehicleId: 7), DateTimeOffset.UtcNow));

        await vm.LoadAsync();
        store.SetOverride(99, PaintPaletteId.SolidBlack);

        Assert.Equal(PaintPaletteId.PearlWhite, vm.Display!.Paint.Id);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects()
    {
        using var vm = NewViewModel(out _, RepositoryResult<VehicleTwinReading>.Loaded(Reading(), DateTimeOffset.UtcNow));

        await vm.LoadAsync();
        Assert.Equal(VehicleTwinSize.Medium, vm.Display!.Size);

        vm.Size = VehicleTwinSize.Large;

        Assert.Equal(VehicleTwinSize.Large, vm.Display!.Size);
    }

    [Fact]
    public async Task ViewModel_does_not_emit_after_dispose()
    {
        var store = new InMemoryVehiclePaintOverrideStore();
        var source = new ScriptedVehicleTwinSource(
            RepositoryResult<VehicleTwinReading>.Loaded(Reading(Model(exteriorColor: "white"), vehicleId: 7), DateTimeOffset.UtcNow));
        var vm = new VehicleTwinViewModel(source, store, Localizer);

        await vm.LoadAsync();
        vm.Dispose();

        // A change after dispose must not be observed (the holder unsubscribed from the store).
        store.SetOverride(7, PaintPaletteId.SolidBlack);
        Assert.Equal(PaintPaletteId.PearlWhite, vm.Display!.Paint.Id);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleTwinDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleTwin", Assert.Single(lines));
    }
}
