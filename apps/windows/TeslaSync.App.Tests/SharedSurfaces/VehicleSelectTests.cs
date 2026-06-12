using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the VehicleSelect surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="VehicleSelectRegistration"/>), the cached → projection adapter
/// (<see cref="VehicleSelectProjection"/> with the display-name → VIN → "Vehicle {id}" label rule and the web
/// positive-finite commit guard), and the per-state view-model: the loading / empty / error / ready
/// projection, the selected-value round-trip, commit-and-clamp selection, retry, the resolved captions +
/// accessible name, and the PII-safe diagnostics (<see cref="VehicleSelectViewModel"/>,
/// <see cref="VehicleSelectDiagnostics"/>). Mirrors the web spec one-for-one
/// (web/src/components/forms/VehicleSelect.tsx). The WinUI view (VehicleSelect.cs, which composes a ComboBox
/// plus the shared spinner / error / empty surfaces and the decorative car glyph) is exercised by the app build.
/// </summary>
public sealed class VehicleSelectTests
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

    private static VehicleSelectViewModel NewLoaded(
        IReadOnlyList<VehicleOption>? fleet = null,
        ILocalizer? localizer = null,
        bool withIcon = false,
        string? aria = null)
    {
        var state = new VehicleSelectState();
        state.SetLoaded(fleet ?? Fleet);
        return new VehicleSelectViewModel(state, localizer ?? PassthroughLocalizer.Instance, withIcon, aria);
    }

    // ── registration: diagnostics slug + i18n keys/fallbacks (web verbatim) ───────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("VehicleSelect", VehicleSelectRegistration.Slug);

    [Theory]
    [InlineData(VehicleSelectRegistration.AriaKey, "translation.vehicleSelect.aria")]
    [InlineData(VehicleSelectRegistration.PromptKey, "translation.vehicleSelect.prompt")]
    [InlineData(VehicleSelectRegistration.LoadingKey, "translation.vehicleSelect.loading")]
    [InlineData(VehicleSelectRegistration.EmptyTitleKey, "translation.vehicleSelect.emptyTitle")]
    [InlineData(VehicleSelectRegistration.EmptyMessageKey, "translation.vehicleSelect.emptyMessage")]
    [InlineData(VehicleSelectRegistration.ErrorTitleKey, "translation.vehicleSelect.errorTitle")]
    [InlineData(VehicleSelectRegistration.RetryKey, "translation.vehicleSelect.retry")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void Aria_fallback_matches_the_web_english_copy() =>
        Assert.Equal("Select vehicle", VehicleSelectRegistration.AriaFallback);

    // ── adapter: cached fleet → projected options (web vehicles.map) ──────────────────────────────────────

    [Fact]
    public void Projection_maps_id_to_value_and_applies_the_label_fallback_rule()
    {
        IReadOnlyList<VehicleSelectItem> items = VehicleSelectProjection.ToItems(Fleet);

        Assert.Equal(3, items.Count);

        Assert.Equal(1, items[0].Id);
        Assert.Equal("1", items[0].Value);
        Assert.Equal("Red Three", items[0].Label); // display name wins

        Assert.Equal("2", items[1].Value);
        Assert.Equal("7SAYGDEE9PF000222", items[1].Label); // falls back to VIN

        Assert.Equal("3", items[2].Value);
        Assert.Equal("Vehicle 3", items[2].Label); // falls back to "Vehicle {id}"
    }

    [Fact]
    public void Projection_of_a_null_or_empty_fleet_is_empty()
    {
        Assert.Empty(VehicleSelectProjection.ToItems(null));
        Assert.Empty(VehicleSelectProjection.ToItems([]));
    }

    [Theory]
    [InlineData("1", 1L)]
    [InlineData("42", 42L)]
    public void ParseValue_accepts_a_positive_id(string value, long expected) =>
        Assert.Equal(expected, VehicleSelectProjection.ParseValue(value));

    [Theory]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-3")]
    [InlineData("abc")]
    [InlineData(null)]
    public void ParseValue_clears_on_blank_nonpositive_or_nonnumeric(string? value) =>
        Assert.Null(VehicleSelectProjection.ParseValue(value));

    // ── state: loading / empty / error / ready projection (web fleet binding, widened) ────────────────────

    [Fact]
    public void Idle_before_any_load_reads_as_loading()
    {
        var vm = new VehicleSelectViewModel(new VehicleSelectState(), PassthroughLocalizer.Instance);

        Assert.Equal(VehicleSelectStatus.Loading, vm.Status);
        Assert.True(vm.IsLoading);
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Loading_state_shows_the_busy_chrome()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);

        Assert.Equal(VehicleSelectStatus.Loading, vm.Status);
        Assert.True(vm.IsLoading);
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Empty_state_when_the_fleet_resolved_with_no_vehicles()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetLoaded([]);
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);

        Assert.Equal(VehicleSelectStatus.Empty, vm.Status);
        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.Items);
    }

    [Fact]
    public void Error_state_exposes_the_message_and_can_retry()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetError("fleet load failed");
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);

        Assert.Equal(VehicleSelectStatus.Error, vm.Status);
        Assert.True(vm.HasError);
        Assert.True(vm.CanRetry);
        Assert.Equal("fleet load failed", vm.ErrorMessage);
    }

    [Fact]
    public void Ready_state_projects_the_loaded_fleet()
    {
        VehicleSelectViewModel vm = NewLoaded();

        Assert.Equal(VehicleSelectStatus.Ready, vm.Status);
        Assert.True(vm.IsReady);
        Assert.Equal(3, vm.Items.Count);
    }

    [Fact]
    public void Items_refresh_when_the_fleet_reloads()
    {
        var state = new VehicleSelectState();
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);
        Assert.Empty(vm.Items);

        state.SetLoaded(Fleet);

        Assert.Equal(3, vm.Items.Count);
    }

    // ── selection: round-trip + web positive-finite commit + clamp to known ids ───────────────────────────

    [Fact]
    public void SelectedValue_is_empty_when_nothing_is_selected()
    {
        VehicleSelectViewModel vm = NewLoaded();

        Assert.Null(vm.SelectedId);
        Assert.Equal(string.Empty, vm.SelectedValue);
    }

    [Fact]
    public void SelectByValue_commits_a_known_id_and_round_trips_the_value()
    {
        VehicleSelectViewModel vm = NewLoaded();

        Assert.True(vm.SelectByValue("2"));
        Assert.Equal(2, vm.SelectedId);
        Assert.Equal("2", vm.SelectedValue);

        Assert.False(vm.SelectByValue("2")); // re-selecting the same id is a no-op
    }

    [Fact]
    public void SelectByValue_clears_the_scope_for_an_unknown_id()
    {
        VehicleSelectViewModel vm = NewLoaded();
        vm.SelectByValue("2");

        Assert.True(vm.SelectByValue("999")); // unknown → clamped to null (the scope changed from 2)
        Assert.Null(vm.SelectedId);
        Assert.Equal(string.Empty, vm.SelectedValue);
    }

    [Fact]
    public void A_single_vehicle_fleet_is_auto_selected()
    {
        VehicleSelectViewModel vm = NewLoaded([Fleet[0]]);

        Assert.Equal(VehicleSelectStatus.Ready, vm.Status);
        Assert.Equal(1, vm.SelectedId);
        Assert.Equal("1", vm.SelectedValue);
    }

    [Fact]
    public void Retry_requests_a_reload_from_the_error_state()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetError("boom");
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);

        var retried = false;
        state.RetryRequested += (_, _) => retried = true;
        vm.Retry();

        Assert.True(retried);
        Assert.True(vm.IsLoading);
    }

    [Fact]
    public void Retry_is_a_safe_no_op_outside_the_error_state()
    {
        VehicleSelectViewModel vm = NewLoaded();

        vm.Retry();

        Assert.Equal(VehicleSelectStatus.Ready, vm.Status);
    }

    // ── i18n + accessibility: every caption resolves through its key (a11y label present) ─────────────────

    [Fact]
    public void AriaLabel_resolves_the_web_key_through_the_facade()
    {
        var localizer = new RecordingLocalizer();
        VehicleSelectViewModel vm = NewLoaded(localizer: localizer);

        Assert.Equal("Select vehicle", vm.AriaLabel);
        Assert.Contains(VehicleSelectRegistration.AriaKey, localizer.RequestedKeys);
    }

    [Fact]
    public void AriaLabel_override_takes_precedence_over_the_key()
    {
        VehicleSelectViewModel vm = NewLoaded(aria: "Vehicle scope");

        Assert.Equal("Vehicle scope", vm.AriaLabel);
    }

    [Fact]
    public void Every_caption_resolves_through_its_translation_key()
    {
        var localizer = new RecordingLocalizer();
        VehicleSelectViewModel vm = NewLoaded(localizer: localizer);

        Assert.Equal(VehicleSelectRegistration.PromptFallback, vm.PromptText);
        Assert.Equal(VehicleSelectRegistration.LoadingFallback, vm.LoadingText);
        Assert.Equal(VehicleSelectRegistration.EmptyTitleFallback, vm.EmptyTitle);
        Assert.Equal(VehicleSelectRegistration.EmptyMessageFallback, vm.EmptyMessage);
        Assert.Equal(VehicleSelectRegistration.ErrorTitleFallback, vm.ErrorTitle);
        Assert.Equal(VehicleSelectRegistration.RetryFallback, vm.RetryText);

        Assert.Contains(VehicleSelectRegistration.PromptKey, localizer.RequestedKeys);
        Assert.Contains(VehicleSelectRegistration.LoadingKey, localizer.RequestedKeys);
        Assert.Contains(VehicleSelectRegistration.EmptyTitleKey, localizer.RequestedKeys);
        Assert.Contains(VehicleSelectRegistration.EmptyMessageKey, localizer.RequestedKeys);
        Assert.Contains(VehicleSelectRegistration.ErrorTitleKey, localizer.RequestedKeys);
        Assert.Contains(VehicleSelectRegistration.RetryKey, localizer.RequestedKeys);
    }

    [Fact]
    public void ErrorMessage_falls_back_to_the_error_heading_when_none_is_set()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetError(string.Empty);
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);

        Assert.Equal(VehicleSelectRegistration.ErrorTitleFallback, vm.ErrorMessage);
    }

    [Fact]
    public void WithIcon_flag_is_surfaced_to_the_view()
    {
        Assert.True(NewLoaded(withIcon: true).WithIcon);
        Assert.False(NewLoaded().WithIcon);
    }

    // ── change notification + lifetime ────────────────────────────────────────────────────────────────────

    [Fact]
    public void A_state_change_raises_property_changed()
    {
        var state = new VehicleSelectState();
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        state.SetLoading();

        Assert.True(raised);
    }

    [Fact]
    public void Dispose_detaches_from_the_state_holder()
    {
        var state = new VehicleSelectState();
        var vm = new VehicleSelectViewModel(state, PassthroughLocalizer.Instance);
        vm.Dispose();

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        state.SetLoading();

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_requires_a_state_and_a_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new VehicleSelectViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new VehicleSelectViewModel(new VehicleSelectState(), null!));
    }

    // ── diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_the_surface_slug()
    {
        var events = new List<string>();
        var diagnostics = new VehicleSelectDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleSelect", Assert.Single(events));
    }

    [Fact]
    public void Diagnostics_default_sink_is_safe()
    {
        var diagnostics = new VehicleSelectDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
