using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the VehiclePicker surface's UI-thread-free logic — the registration slug + i18n
/// key/fallback + pinned glyph (<see cref="VehiclePickerRegistration"/>), the pin-aware cached → projection
/// adapter (<see cref="VehiclePickerProjection"/> with the display-name → VIN → "Vehicle {id}" label rule, the
/// stable pin-position float, the 📌 prefix and the web positive-finite commit guard), and the per-state
/// view-model: the hidden / ready projection (web <c>vehicles.length &lt;= 1</c> hide rule), the selected-value
/// round-trip, commit-and-clamp selection, the resolved accessible name, pin reprojection, and the PII-safe
/// diagnostics (<see cref="VehiclePickerViewModel"/>, <see cref="VehiclePickerDiagnostics"/>). Mirrors the web
/// spec one-for-one (web/src/components/layout/VehiclePicker.tsx). The WinUI view (VehiclePicker.cs, which
/// composes a ComboBox plus the decorative car glyph and toggles the surface visibility) is exercised by the app
/// build.
/// </summary>
public sealed class VehiclePickerTests
{
    private static readonly IReadOnlyList<VehicleOption> Fleet =
    [
        new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3"),
        new(2, null, "7SAYGDEE9PF000222", "Model Y"),
        new(3, null, null, null),
    ];

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static VehiclePickerViewModel NewLoaded(
        IReadOnlyList<VehicleOption>? fleet = null,
        IReadOnlyList<VehiclePickerPin>? pins = null,
        ILocalizer? localizer = null,
        string? aria = null)
    {
        var state = new VehicleSelectState();
        state.SetLoaded(fleet ?? Fleet);
        var pinSource = new InMemoryVehiclePinSource(pins);
        return new VehiclePickerViewModel(state, pinSource, localizer ?? PassthroughLocalizer.Instance, aria);
    }

    // ── registration: diagnostics slug + i18n key/fallback + pinned glyph (web verbatim) ──────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("VehiclePicker", VehiclePickerRegistration.Slug);

    [Fact]
    public void Aria_key_carries_the_translation_prefixed_web_key() =>
        Assert.Equal("translation.vehiclePicker.aria", VehiclePickerRegistration.AriaKey);

    [Fact]
    public void Aria_fallback_matches_the_web_english_copy() =>
        Assert.Equal("Select vehicle", VehiclePickerRegistration.AriaFallback);

    [Fact]
    public void Pinned_prefix_is_the_web_pushpin_glyph_and_a_space() =>
        Assert.Equal("\U0001F4CC ", VehiclePickerRegistration.PinnedPrefix);

    // ── adapter: cached fleet → projected options (web sorted.map) ────────────────────────────────────────

    [Fact]
    public void Projection_maps_id_to_value_and_applies_the_label_fallback_rule()
    {
        IReadOnlyList<VehiclePickerItem> items = VehiclePickerProjection.ToItems(Fleet, pins: null);

        Assert.Equal(3, items.Count);

        Assert.Equal(1, items[0].Id);
        Assert.Equal("1", items[0].Value);
        Assert.Equal("Red Three", items[0].Label); // display name wins
        Assert.False(items[0].IsPinned);

        Assert.Equal("7SAYGDEE9PF000222", items[1].Label); // falls back to VIN
        Assert.Equal("Vehicle 3", items[2].Label);          // falls back to "Vehicle {id}"
    }

    [Fact]
    public void Projection_of_a_null_or_empty_fleet_is_empty()
    {
        Assert.Empty(VehiclePickerProjection.ToItems(null, null));
        Assert.Empty(VehiclePickerProjection.ToItems([], null));
    }

    [Fact]
    public void Projection_with_no_pins_keeps_original_api_order()
    {
        IReadOnlyList<VehiclePickerItem> items = VehiclePickerProjection.ToItems(Fleet, []);

        Assert.Equal(new long[] { 1, 2, 3 }, items.Select(i => i.Id));
        Assert.All(items, i => Assert.False(i.IsPinned));
    }

    [Fact]
    public void Projection_floats_pinned_vehicles_to_the_top_in_position_order()
    {
        // Pin id 3 first (position 0) then id 2 (position 1); id 1 is unpinned.
        var pins = new VehiclePickerPin[] { new("3", 0), new("2", 1) };

        IReadOnlyList<VehiclePickerItem> items = VehiclePickerProjection.ToItems(Fleet, pins);

        Assert.Equal(new long[] { 3, 2, 1 }, items.Select(i => i.Id)); // pinned (by position) then the unpinned remainder
        Assert.True(items[0].IsPinned);
        Assert.True(items[1].IsPinned);
        Assert.False(items[2].IsPinned);

        Assert.StartsWith(VehiclePickerRegistration.PinnedPrefix, items[0].Label);
        Assert.Equal("\U0001F4CC Vehicle 3", items[0].Label);
        Assert.Equal("\U0001F4CC 7SAYGDEE9PF000222", items[1].Label);
        Assert.Equal("Red Three", items[2].Label); // unpinned: no prefix
    }

    [Fact]
    public void Projection_keeps_unpinned_rows_in_stable_api_order_after_the_floated_pins()
    {
        var fleet = new VehicleOption[] { new(1), new(2), new(3), new(4) };
        var pins = new VehiclePickerPin[] { new("4", 0) };

        IReadOnlyList<VehiclePickerItem> items = VehiclePickerProjection.ToItems(fleet, pins);

        Assert.Equal(new long[] { 4, 1, 2, 3 }, items.Select(i => i.Id));
    }

    [Fact]
    public void Projection_ignores_pins_for_vehicles_outside_the_fleet()
    {
        var pins = new VehiclePickerPin[] { new("99", 0) };

        IReadOnlyList<VehiclePickerItem> items = VehiclePickerProjection.ToItems(Fleet, pins);

        Assert.Equal(new long[] { 1, 2, 3 }, items.Select(i => i.Id)); // unknown pin → no float
        Assert.All(items, i => Assert.False(i.IsPinned));
    }

    [Theory]
    [InlineData("1", 1L)]
    [InlineData("42", 42L)]
    public void ParseValue_accepts_a_positive_id(string value, long expected) =>
        Assert.Equal(expected, VehiclePickerProjection.ParseValue(value));

    [Theory]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-3")]
    [InlineData("abc")]
    [InlineData(null)]
    public void ParseValue_clears_on_blank_nonpositive_or_nonnumeric(string? value) =>
        Assert.Null(VehiclePickerProjection.ParseValue(value));

    // ── state: hidden / ready projection (web vehicles.length <= 1 hide rule) ──────────────────────────────

    [Fact]
    public void Idle_before_any_load_is_hidden()
    {
        var vm = new VehiclePickerViewModel(
            new VehicleSelectState(), new InMemoryVehiclePinSource(), PassthroughLocalizer.Instance);

        Assert.Equal(VehiclePickerStatus.Hidden, vm.Status);
        Assert.False(vm.IsVisible);
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Loading_collapses_to_hidden()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        var vm = new VehiclePickerViewModel(state, new InMemoryVehiclePinSource(), PassthroughLocalizer.Instance);

        Assert.Equal(VehiclePickerStatus.Hidden, vm.Status);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void Empty_fleet_collapses_to_hidden()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetLoaded([]);
        var vm = new VehiclePickerViewModel(state, new InMemoryVehiclePinSource(), PassthroughLocalizer.Instance);

        Assert.Equal(VehiclePickerStatus.Hidden, vm.Status);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void Failed_fleet_collapses_to_hidden()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetError("fleet load failed");
        var vm = new VehiclePickerViewModel(state, new InMemoryVehiclePinSource(), PassthroughLocalizer.Instance);

        Assert.Equal(VehiclePickerStatus.Hidden, vm.Status);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void A_single_vehicle_fleet_is_hidden()
    {
        VehiclePickerViewModel vm = NewLoaded([Fleet[0]]);

        // web: hides for fleets of 0 or 1 vehicle — there's nothing meaningful to pick.
        Assert.Equal(VehiclePickerStatus.Hidden, vm.Status);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void A_multi_vehicle_fleet_is_ready_and_visible()
    {
        VehiclePickerViewModel vm = NewLoaded();

        Assert.Equal(VehiclePickerStatus.Ready, vm.Status);
        Assert.True(vm.IsVisible);
        Assert.Equal(3, vm.Items.Count);
    }

    [Fact]
    public void Items_refresh_when_the_fleet_reloads()
    {
        var state = new VehicleSelectState();
        var vm = new VehiclePickerViewModel(state, new InMemoryVehiclePinSource(), PassthroughLocalizer.Instance);
        Assert.Empty(vm.Items);

        state.SetLoaded(Fleet);

        Assert.Equal(3, vm.Items.Count);
        Assert.True(vm.IsVisible);
    }

    [Fact]
    public void Items_reproject_when_the_pins_change()
    {
        var state = new VehicleSelectState();
        state.SetLoaded(Fleet);
        var pins = new InMemoryVehiclePinSource();
        var vm = new VehiclePickerViewModel(state, pins, PassthroughLocalizer.Instance);

        Assert.Equal(new long[] { 1, 2, 3 }, vm.Items.Select(i => i.Id)); // no pins → API order

        pins.SetPins([new VehiclePickerPin("3", 0)]);

        Assert.Equal(new long[] { 3, 1, 2 }, vm.Items.Select(i => i.Id)); // id 3 floated to the top
        Assert.True(vm.Items[0].IsPinned);
        Assert.StartsWith(VehiclePickerRegistration.PinnedPrefix, vm.Items[0].Label);
    }

    // ── selection: round-trip + web positive-finite commit + clamp to known ids ───────────────────────────

    [Fact]
    public void SelectedValue_is_empty_when_nothing_is_selected()
    {
        VehiclePickerViewModel vm = NewLoaded();

        Assert.Null(vm.SelectedId);
        Assert.Equal(string.Empty, vm.SelectedValue);
    }

    [Fact]
    public void SelectByValue_commits_a_known_id_and_round_trips_the_value()
    {
        VehiclePickerViewModel vm = NewLoaded();

        Assert.True(vm.SelectByValue("2"));
        Assert.Equal(2, vm.SelectedId);
        Assert.Equal("2", vm.SelectedValue);

        Assert.False(vm.SelectByValue("2")); // re-selecting the same id is a no-op
    }

    [Fact]
    public void SelectByValue_clears_the_scope_for_an_unknown_id()
    {
        VehiclePickerViewModel vm = NewLoaded();
        vm.SelectByValue("2");

        Assert.True(vm.SelectByValue("999")); // unknown → clamped to null (the scope changed from 2)
        Assert.Null(vm.SelectedId);
        Assert.Equal(string.Empty, vm.SelectedValue);
    }

    // ── i18n + accessibility: the accessible name resolves through its key ─────────────────────────────────

    [Fact]
    public void AriaLabel_resolves_the_web_key_through_the_facade()
    {
        var localizer = new RecordingLocalizer();
        VehiclePickerViewModel vm = NewLoaded(localizer: localizer);

        Assert.Equal("Select vehicle", vm.AriaLabel);
        Assert.False(string.IsNullOrWhiteSpace(vm.AriaLabel)); // a11y: the trigger always has an accessible name
        Assert.Contains(VehiclePickerRegistration.AriaKey, localizer.RequestedKeys);
    }

    [Fact]
    public void AriaLabel_override_takes_precedence_over_the_key()
    {
        VehiclePickerViewModel vm = NewLoaded(aria: "Vehicle scope");

        Assert.Equal("Vehicle scope", vm.AriaLabel);
    }

    // ── change notification + lifetime ────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_state_change_raises_property_changed()
    {
        var state = new VehicleSelectState();
        var vm = new VehiclePickerViewModel(state, new InMemoryVehiclePinSource(), PassthroughLocalizer.Instance);

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        state.SetLoaded(Fleet);

        Assert.True(raised);
    }

    [Fact]
    public void A_pin_change_raises_property_changed()
    {
        var state = new VehicleSelectState();
        state.SetLoaded(Fleet);
        var pins = new InMemoryVehiclePinSource();
        var vm = new VehiclePickerViewModel(state, pins, PassthroughLocalizer.Instance);

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        pins.SetPins([new VehiclePickerPin("1", 0)]);

        Assert.True(raised);
    }

    [Fact]
    public void Dispose_detaches_from_both_the_state_and_the_pins()
    {
        var state = new VehicleSelectState();
        state.SetLoaded(Fleet);
        var pins = new InMemoryVehiclePinSource();
        var vm = new VehiclePickerViewModel(state, pins, PassthroughLocalizer.Instance);
        vm.Dispose();

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        state.SetLoading();
        pins.SetPins([new VehiclePickerPin("1", 0)]);

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_requires_a_state_pins_and_a_localizer()
    {
        var state = new VehicleSelectState();
        var pins = new InMemoryVehiclePinSource();

        Assert.Throws<ArgumentNullException>(() => new VehiclePickerViewModel(null!, pins, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new VehiclePickerViewModel(state, null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new VehiclePickerViewModel(state, pins, null!));
    }

    // ── diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_the_surface_slug()
    {
        var events = new List<string>();
        var diagnostics = new VehiclePickerDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehiclePicker", Assert.Single(events));
    }

    [Fact]
    public void Diagnostics_default_sink_is_safe()
    {
        var diagnostics = new VehiclePickerDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
