using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Vehicles;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the VehiclePaintPicker surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks + per-palette label-key map + persistence token map + storage key + title formatter
/// (<see cref="VehiclePaintPickerRegistration"/>), the per-vehicle override store
/// (<see cref="InMemoryVehiclePaintStore"/> + <see cref="DelegatedVehiclePaintStore"/>), the override &gt;
/// inferred &gt; fallback resolution + the "select inferred clears the override" normalization + the per-vehicle
/// re-read + cross-instance sync (<see cref="VehiclePaintPickerViewModel"/>), and the PII-safe diagnostics
/// (<see cref="VehiclePaintPickerDiagnostics"/>). Mirrors the web spec one-for-one
/// (web/src/components/vehicles/VehiclePaintPicker.tsx, web/src/hooks/useVehiclePaint.ts and the web test
/// web/src/components/vehicles/__tests__/VehiclePaintPicker.test.tsx). The WinUI view (VehiclePaintPicker.cs,
/// which composes the swatch radio group + check marks + polite live region + reset button) is exercised by the
/// app build.
/// </summary>
public sealed class VehiclePaintPickerTests
{
    // ── recording double ─────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static VehiclePaintPickerViewModel NewViewModel(
        ILocalizer? localizer = null,
        IVehiclePaintStore? store = null) =>
        new(localizer ?? PassthroughLocalizer.Instance, store ?? new InMemoryVehiclePaintStore());

    private static PaintSwatchItem Swatch(VehiclePaintPickerViewModel vm, PaintPaletteId id) =>
        vm.Swatches.Single(s => s.Id == id);

    // ── registration: slug + i18n keys/fallbacks (web verbatim) ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("VehiclePaintPicker", VehiclePaintPickerRegistration.Slug);

    [Theory]
    [InlineData(VehiclePaintPickerRegistration.PickerLabelKey, "translation.paint.pickerLabel")]
    [InlineData(VehiclePaintPickerRegistration.CaptionKey, "translation.paint.label")]
    [InlineData(VehiclePaintPickerRegistration.DetectedKey, "translation.paint.detected")]
    [InlineData(VehiclePaintPickerRegistration.ResetKey, "translation.paint.reset")]
    [InlineData(VehiclePaintPickerRegistration.PearlWhiteKey, "translation.paint.pearlWhite")]
    [InlineData(VehiclePaintPickerRegistration.MidnightSilverKey, "translation.paint.midnightSilver")]
    [InlineData(VehiclePaintPickerRegistration.DeepBlueKey, "translation.paint.deepBlue")]
    [InlineData(VehiclePaintPickerRegistration.SolidBlackKey, "translation.paint.solidBlack")]
    [InlineData(VehiclePaintPickerRegistration.RedMulticoatKey, "translation.paint.redMulticoat")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(VehiclePaintPickerRegistration.PickerLabelFallback, "Vehicle paint color")]
    [InlineData(VehiclePaintPickerRegistration.CaptionFallback, "Paint")]
    [InlineData(VehiclePaintPickerRegistration.DetectedFallback, "Auto-detected")]
    [InlineData(VehiclePaintPickerRegistration.ResetFallback, "Reset to auto-detected")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(PaintPaletteId.PearlWhite, "translation.paint.pearlWhite")]
    [InlineData(PaintPaletteId.MidnightSilver, "translation.paint.midnightSilver")]
    [InlineData(PaintPaletteId.DeepBlue, "translation.paint.deepBlue")]
    [InlineData(PaintPaletteId.SolidBlack, "translation.paint.solidBlack")]
    [InlineData(PaintPaletteId.RedMulticoat, "translation.paint.redMulticoat")]
    public void Label_key_maps_each_palette_to_its_web_key(PaintPaletteId id, string expected) =>
        Assert.Equal(expected, VehiclePaintPickerRegistration.LabelKey(id));

    // ── registration: persistence token map (web PaintPaletteId kebab string ids) ───────────────────────

    [Theory]
    [InlineData(PaintPaletteId.PearlWhite, "pearl-white")]
    [InlineData(PaintPaletteId.MidnightSilver, "midnight-silver")]
    [InlineData(PaintPaletteId.DeepBlue, "deep-blue")]
    [InlineData(PaintPaletteId.SolidBlack, "solid-black")]
    [InlineData(PaintPaletteId.RedMulticoat, "red-multicoat")]
    public void Token_maps_each_palette_to_its_web_kebab_id(PaintPaletteId id, string expected) =>
        Assert.Equal(expected, VehiclePaintPickerRegistration.Token(id));

    [Theory]
    [InlineData("pearl-white", PaintPaletteId.PearlWhite)]
    [InlineData("midnight-silver", PaintPaletteId.MidnightSilver)]
    [InlineData("deep-blue", PaintPaletteId.DeepBlue)]
    [InlineData("solid-black", PaintPaletteId.SolidBlack)]
    [InlineData("red-multicoat", PaintPaletteId.RedMulticoat)]
    public void TryParseToken_round_trips_each_web_kebab_id(string token, PaintPaletteId expected)
    {
        Assert.True(VehiclePaintPickerRegistration.TryParseToken(token, out PaintPaletteId id));
        Assert.Equal(expected, id);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-color")]
    [InlineData("PearlWhite")]
    public void TryParseToken_rejects_unknown_or_foreign_tokens(string? token) =>
        Assert.False(VehiclePaintPickerRegistration.TryParseToken(token, out _));

    [Fact]
    public void Storage_key_matches_the_web_per_vehicle_slot() =>
        Assert.Equal("teslasync:vehicle:1:paint", VehiclePaintPickerRegistration.StorageKey(1));

    [Fact]
    public void Format_detected_title_appends_the_localized_suffix() =>
        Assert.Equal(
            "Pearl White Multi-Coat · Auto-detected",
            VehiclePaintPickerRegistration.FormatDetectedTitle("Pearl White Multi-Coat", "Auto-detected"));

    // ── store: in-memory round-trip + guards + cross-instance (web localStorage slot + broadcast) ───────

    [Fact]
    public void Store_persists_and_reloads_the_override_as_the_web_token()
    {
        var store = new InMemoryVehiclePaintStore();
        store.Persist(1, PaintPaletteId.RedMulticoat);

        Assert.Equal("red-multicoat", store.RawFor(1));
        Assert.Equal(PaintPaletteId.RedMulticoat, store.Load(1));
    }

    [Fact]
    public void Store_clears_the_slot_when_persisting_null()
    {
        var store = new InMemoryVehiclePaintStore();
        store.Persist(1, PaintPaletteId.DeepBlue);
        store.Persist(1, null);

        Assert.Null(store.RawFor(1));
        Assert.Null(store.Load(1));
    }

    [Fact]
    public void Store_ignores_a_non_positive_vehicle_id()
    {
        var store = new InMemoryVehiclePaintStore();
        store.Persist(0, PaintPaletteId.RedMulticoat);

        Assert.Equal(0, store.WriteCount);
        Assert.Null(store.RawFor(0));
        Assert.Null(store.Load(0));
    }

    [Fact]
    public void Store_keeps_separate_slots_per_vehicle()
    {
        var store = new InMemoryVehiclePaintStore();
        store.Persist(1, PaintPaletteId.RedMulticoat);
        store.Persist(2, PaintPaletteId.DeepBlue);

        Assert.Equal(PaintPaletteId.RedMulticoat, store.Load(1));
        Assert.Equal(PaintPaletteId.DeepBlue, store.Load(2));
    }

    [Fact]
    public void Store_raises_external_changed_on_persist()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintChangedEventArgs? captured = null;
        store.ExternalChanged += (_, e) => captured = e;

        store.Persist(7, PaintPaletteId.SolidBlack);

        Assert.NotNull(captured);
        Assert.Equal(7, captured!.VehicleId);
        Assert.Equal(PaintPaletteId.SolidBlack, captured.NewValue);
    }

    [Fact]
    public void Store_simulates_a_cross_instance_write()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintChangedEventArgs? captured = null;
        store.ExternalChanged += (_, e) => captured = e;

        store.RaiseExternalChange(3, "deep-blue");

        Assert.Equal("deep-blue", store.RawFor(3));
        Assert.Equal(PaintPaletteId.DeepBlue, store.Load(3));
        Assert.NotNull(captured);
        Assert.Equal(PaintPaletteId.DeepBlue, captured!.NewValue);
    }

    [Fact]
    public void Delegated_store_reads_and_writes_through_the_storage_key()
    {
        var slots = new Dictionary<string, string?>();
        var store = new DelegatedVehiclePaintStore(
            key => slots.TryGetValue(key, out string? v) ? v : null,
            (key, value) => slots[key] = value);

        store.Persist(1, PaintPaletteId.RedMulticoat);

        Assert.Equal("red-multicoat", slots["teslasync:vehicle:1:paint"]);
        Assert.Equal(PaintPaletteId.RedMulticoat, store.Load(1));
    }

    [Fact]
    public void Delegated_store_swallows_a_throwing_reader()
    {
        var store = new DelegatedVehiclePaintStore(
            _ => throw new InvalidOperationException("identity-less"),
            (_, _) => { });

        Assert.Null(store.Load(1));
    }

    // ── view-model: swatch projection (web PAINT_PALETTE_LIST.map) ──────────────────────────────────────

    [Fact]
    public void Renders_five_swatches_as_a_radio_group()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.ExteriorColor = "PearlWhite";

        Assert.Equal(5, vm.Swatches.Count);
    }

    [Fact]
    public void Every_swatch_has_an_accessible_label()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.ExteriorColor = "PearlWhite";

        Assert.All(vm.Swatches, s => Assert.False(string.IsNullOrEmpty(s.Label)));
    }

    [Fact]
    public void Marks_the_inferred_paint_as_selected_initially()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.ExteriorColor = "MidnightSilverMetallic";

        PaintSwatchItem selected = vm.Swatches.Single(s => s.Selected);
        Assert.Equal(PaintPaletteId.MidnightSilver, selected.Id);
        Assert.Equal("Midnight Silver Metallic", selected.Label);
        Assert.False(vm.IsOverridden);
    }

    [Fact]
    public void Inferred_swatch_carries_the_auto_detected_tooltip()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.ExteriorColor = "DeepBlueMetallic";

        PaintSwatchItem inferred = Swatch(vm, PaintPaletteId.DeepBlue);
        Assert.True(inferred.IsInferred);
        Assert.Equal("Deep Blue Metallic · Auto-detected", inferred.Title);

        // Non-inferred swatches use the bare label as their tooltip (web title={label}).
        PaintSwatchItem other = Swatch(vm, PaintPaletteId.RedMulticoat);
        Assert.False(other.IsInferred);
        Assert.Equal(other.Label, other.Title);
    }

    [Fact]
    public void Unknown_exterior_color_falls_back_to_pearl_white()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.ExteriorColor = "SomeUnmappedFactoryCode";

        Assert.Equal(PaintPaletteId.PearlWhite, vm.Inferred.Id);
        Assert.Equal(PaintPaletteId.PearlWhite, vm.Swatches.Single(s => s.Selected).Id);
    }

    // ── view-model: pick + persist + re-check (web onClick -> setPaint) ─────────────────────────────────

    [Fact]
    public void Picking_a_swatch_persists_the_override_and_rechecks()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.VehicleId = 1;
        vm.ExteriorColor = "PearlWhite";

        bool changed = vm.SetPaint(PaintPaletteId.RedMulticoat);

        Assert.True(changed);
        Assert.True(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.RedMulticoat, vm.Paint.Id);
        Assert.Equal(PaintPaletteId.RedMulticoat, vm.Swatches.Single(s => s.Selected).Id);
        Assert.Equal("red-multicoat", store.RawFor(1));
    }

    [Fact]
    public void Selecting_the_inferred_color_clears_the_override()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.VehicleId = 1;
        vm.ExteriorColor = "PearlWhite";

        vm.SetPaint(PaintPaletteId.RedMulticoat);
        Assert.True(vm.IsOverridden);

        // web: setPaint(id === inferred.id) normalizes to null — the override is cleared, not stored.
        bool changed = vm.SetPaint(PaintPaletteId.PearlWhite);

        Assert.True(changed);
        Assert.False(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.PearlWhite, vm.Paint.Id);
        Assert.Null(store.RawFor(1));
    }

    [Fact]
    public void Reset_clears_the_override_back_to_inferred()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.VehicleId = 1;
        vm.ExteriorColor = "PearlWhite";

        vm.SetPaint(PaintPaletteId.DeepBlue);
        Assert.True(vm.IsOverridden);

        bool changed = vm.Reset();

        Assert.True(changed);
        Assert.False(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.PearlWhite, vm.Paint.Id);
        Assert.Null(store.RawFor(1));
    }

    [Fact]
    public void Reset_affordance_visibility_tracks_the_override_state()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.VehicleId = 1;
        vm.ExteriorColor = "PearlWhite";

        // web: the reset button renders only when isOverridden.
        Assert.False(vm.IsOverridden);

        vm.SetPaint(PaintPaletteId.DeepBlue);
        Assert.True(vm.IsOverridden);

        vm.Reset();
        Assert.False(vm.IsOverridden);
    }

    [Fact]
    public void Persistence_is_disabled_for_a_non_positive_vehicle_id()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.ExteriorColor = "PearlWhite";

        // web: vehicleId null/0 still updates local state but writes nothing.
        bool changed = vm.SetPaint(PaintPaletteId.RedMulticoat);

        Assert.True(changed);
        Assert.True(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.RedMulticoat, vm.Paint.Id);
        Assert.Equal(0, store.WriteCount);
    }

    [Fact]
    public void Set_paint_raises_property_changed()
    {
        VehiclePaintPickerViewModel vm = NewViewModel();
        vm.ExteriorColor = "PearlWhite";
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetPaint(PaintPaletteId.DeepBlue);

        Assert.True(raised);
    }

    // ── view-model: per-vehicle re-read + cross-instance sync (web vehicleId effect + broadcast) ─────────

    [Fact]
    public void Switching_vehicle_rereads_that_vehicles_override_slot()
    {
        var store = new InMemoryVehiclePaintStore();
        store.Persist(2, PaintPaletteId.SolidBlack);

        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.ExteriorColor = "PearlWhite";
        vm.VehicleId = 1;
        Assert.False(vm.IsOverridden);

        vm.VehicleId = 2;

        Assert.True(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.SolidBlack, vm.Paint.Id);
    }

    [Fact]
    public void External_change_for_the_target_vehicle_updates_the_picker()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.VehicleId = 1;
        vm.ExteriorColor = "PearlWhite";

        store.RaiseExternalChange(1, "deep-blue");

        Assert.True(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.DeepBlue, vm.Paint.Id);
    }

    [Fact]
    public void External_change_for_another_vehicle_is_ignored()
    {
        var store = new InMemoryVehiclePaintStore();
        VehiclePaintPickerViewModel vm = NewViewModel(store: store);
        vm.VehicleId = 1;
        vm.ExteriorColor = "PearlWhite";

        store.RaiseExternalChange(2, "red-multicoat");

        Assert.False(vm.IsOverridden);
        Assert.Equal(PaintPaletteId.PearlWhite, vm.Paint.Id);
    }

    // ── accessibility: every label resolves through the i18n facade (P1/S10) ────────────────────────────

    [Fact]
    public void Labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        VehiclePaintPickerViewModel vm = NewViewModel(localizer);
        vm.ExteriorColor = "PearlWhite";

        Assert.Equal("Vehicle paint color", vm.PickerLabel);
        Assert.Equal("Paint", vm.Caption);
        Assert.Equal("Reset to auto-detected", vm.ResetLabel);
        Assert.Equal("Auto-detected", vm.DetectedSuffix);
        _ = vm.Swatches;

        Assert.Contains("translation.paint.pickerLabel", localizer.RequestedKeys);
        Assert.Contains("translation.paint.label", localizer.RequestedKeys);
        Assert.Contains("translation.paint.reset", localizer.RequestedKeys);
        Assert.Contains("translation.paint.detected", localizer.RequestedKeys);
        Assert.Contains("translation.paint.pearlWhite", localizer.RequestedKeys);
        Assert.Contains("translation.paint.redMulticoat", localizer.RequestedKeys);
    }

    // ── diagnostics (P1/S11): view.opened + paint.selected with the surface slug ────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new VehiclePaintPickerDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=VehiclePaintPicker", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_records_paint_selected_without_the_color_or_vehicle()
    {
        string? captured = null;
        var diagnostics = new VehiclePaintPickerDiagnostics(value => captured = value);

        diagnostics.RecordPaintSelected();

        Assert.Equal("paint.selected slug=VehiclePaintPicker", captured);
        Assert.Equal(1, diagnostics.PaintsSelected);
    }
}
