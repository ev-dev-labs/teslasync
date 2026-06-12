using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the FullscreenButton surface's UI-thread-free logic — the registration slug + i18n
/// keys / fallbacks + glyphs + state attribute (<see cref="FullscreenButtonRegistration"/>), the fullscreen seam
/// with its in-memory implementation (<see cref="IFullscreenController"/> / <see cref="InMemoryFullscreenController"/>),
/// the per-state projection + event-sourced state sync + caller label overrides (<see cref="FullscreenButtonViewModel"/>),
/// and the PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/ui/FullscreenButton.tsx). The
/// WinUI view (FullscreenButton.cs, which composes a TsButton + an IToggleProvider peer + the AppWindow controller)
/// is exercised by the app build.
/// </summary>
public sealed class FullscreenButtonTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static FullscreenButtonViewModel NewViewModel(
        IFullscreenController? controller = null,
        ILocalizer? localizer = null,
        string? enterLabelOverride = null,
        string? exitLabelOverride = null) =>
        new(
            controller ?? new InMemoryFullscreenController(),
            localizer ?? PassthroughLocalizer.Instance,
            enterLabelOverride,
            exitLabelOverride);

    // ── registration (diagnostics slug + i18n keys/fallbacks + glyphs + state attrs, web verbatim) ────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("FullscreenButton", FullscreenButtonRegistration.Slug);

    [Theory]
    [InlineData(FullscreenButtonRegistration.EnterKey, "translation.common.fullscreen.enter")]
    [InlineData(FullscreenButtonRegistration.ExitKey, "translation.common.fullscreen.exit")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(FullscreenButtonRegistration.EnterFallback, "Enter fullscreen")]
    [InlineData(FullscreenButtonRegistration.ExitFallback, "Exit fullscreen")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void Registration_glyphs_are_distinct_enter_and_exit_affordances()
    {
        Assert.Equal("\uE740", FullscreenButtonRegistration.EnterGlyph);
        Assert.Equal("\uE73F", FullscreenButtonRegistration.ExitGlyph);
        Assert.NotEqual(FullscreenButtonRegistration.EnterGlyph, FullscreenButtonRegistration.ExitGlyph);
    }

    [Fact]
    public void Registration_state_attribute_values_match_the_web_data_attribute()
    {
        Assert.Equal("on", FullscreenButtonRegistration.StateOn);
        Assert.Equal("off", FullscreenButtonRegistration.StateOff);
    }

    [Fact]
    public void Registration_automation_id_matches_the_web_test_id() =>
        Assert.Equal("fullscreen-button", FullscreenButtonRegistration.AutomationId);

    // ── seam: in-memory controller (web Fullscreen API) ──────────────────────────────────────────────────

    [Fact]
    public void InMemory_controller_defaults_to_supported_and_windowed()
    {
        var controller = new InMemoryFullscreenController();

        Assert.True(controller.IsSupported);
        Assert.False(controller.IsFullscreen);
    }

    [Fact]
    public void InMemory_controller_enter_sets_fullscreen_and_raises_change_once()
    {
        var controller = new InMemoryFullscreenController();
        int changes = 0;
        controller.FullscreenChanged += (_, _) => changes++;

        controller.RequestFullscreen();

        Assert.True(controller.IsFullscreen);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void InMemory_controller_enter_is_idempotent()
    {
        var controller = new InMemoryFullscreenController();
        int changes = 0;
        controller.FullscreenChanged += (_, _) => changes++;

        controller.RequestFullscreen();
        controller.RequestFullscreen();

        Assert.True(controller.IsFullscreen);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void InMemory_controller_exit_clears_fullscreen_and_raises_change()
    {
        var controller = new InMemoryFullscreenController(isSupported: true, initiallyFullscreen: true);
        int changes = 0;
        controller.FullscreenChanged += (_, _) => changes++;

        controller.ExitFullscreen();

        Assert.False(controller.IsFullscreen);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void InMemory_controller_exit_when_windowed_is_a_no_op()
    {
        var controller = new InMemoryFullscreenController();
        int changes = 0;
        controller.FullscreenChanged += (_, _) => changes++;

        controller.ExitFullscreen();

        Assert.False(controller.IsFullscreen);
        Assert.Equal(0, changes);
    }

    [Fact]
    public void InMemory_controller_unsupported_never_enters_fullscreen()
    {
        var controller = new InMemoryFullscreenController(isSupported: false);
        int changes = 0;
        controller.FullscreenChanged += (_, _) => changes++;

        controller.RequestFullscreen();

        Assert.False(controller.IsFullscreen);
        Assert.Equal(0, changes);
    }

    // ── state: hidden (web if (!supported) return null;) ─────────────────────────────────────────────────

    [Fact]
    public void Unsupported_platform_hides_the_surface()
    {
        FullscreenButtonViewModel vm = NewViewModel(new InMemoryFullscreenController(isSupported: false));

        Assert.False(vm.IsSupported);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void Supported_platform_shows_the_surface()
    {
        FullscreenButtonViewModel vm = NewViewModel(new InMemoryFullscreenController(isSupported: true));

        Assert.True(vm.IsSupported);
        Assert.True(vm.IsVisible);
    }

    // ── state: enter (web isFs === false — Maximize icon + "Enter fullscreen", not pressed) ──────────────

    [Fact]
    public void Windowed_state_shows_the_enter_affordance()
    {
        FullscreenButtonViewModel vm = NewViewModel();

        Assert.False(vm.IsFullscreen);
        Assert.Equal("Enter fullscreen", vm.Label);
        Assert.Equal("Enter fullscreen", vm.AccessibleLabel);
        Assert.False(vm.ShowExitIcon);
        Assert.False(vm.IsPressed);
        Assert.Equal("off", vm.StateAttribute);
    }

    // ── state: exit (web isFs === true — Minimize icon + "Exit fullscreen", pressed) ─────────────────────

    [Fact]
    public void Toggle_enters_fullscreen_and_shows_the_exit_affordance()
    {
        var controller = new InMemoryFullscreenController();
        FullscreenButtonViewModel vm = NewViewModel(controller);

        vm.Toggle();

        Assert.True(controller.IsFullscreen);
        Assert.True(vm.IsFullscreen);
        Assert.Equal("Exit fullscreen", vm.Label);
        Assert.Equal("Exit fullscreen", vm.AccessibleLabel);
        Assert.True(vm.ShowExitIcon);
        Assert.True(vm.IsPressed);
        Assert.Equal("on", vm.StateAttribute);
    }

    [Fact]
    public void Toggle_enter_raises_change_for_every_dependent_property()
    {
        FullscreenButtonViewModel vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Toggle();

        Assert.Contains(nameof(FullscreenButtonViewModel.IsFullscreen), changed);
        Assert.Contains(nameof(FullscreenButtonViewModel.Label), changed);
        Assert.Contains(nameof(FullscreenButtonViewModel.AccessibleLabel), changed);
        Assert.Contains(nameof(FullscreenButtonViewModel.IsPressed), changed);
        Assert.Contains(nameof(FullscreenButtonViewModel.ShowExitIcon), changed);
        Assert.Contains(nameof(FullscreenButtonViewModel.StateAttribute), changed);
    }

    [Fact]
    public void Toggle_twice_returns_to_the_enter_affordance()
    {
        var controller = new InMemoryFullscreenController();
        FullscreenButtonViewModel vm = NewViewModel(controller);

        vm.Toggle();
        vm.Toggle();

        Assert.False(controller.IsFullscreen);
        Assert.False(vm.IsFullscreen);
        Assert.Equal("Enter fullscreen", vm.Label);
        Assert.False(vm.ShowExitIcon);
        Assert.False(vm.IsPressed);
        Assert.Equal("off", vm.StateAttribute);
    }

    [Fact]
    public void Initially_fullscreen_controller_starts_in_the_exit_affordance()
    {
        FullscreenButtonViewModel vm =
            NewViewModel(new InMemoryFullscreenController(isSupported: true, initiallyFullscreen: true));

        Assert.True(vm.IsFullscreen);
        Assert.Equal("Exit fullscreen", vm.Label);
        Assert.True(vm.ShowExitIcon);
        Assert.True(vm.IsPressed);
    }

    // ── event-sourced sync (web: state comes from fullscreenchange, NOT the click) ───────────────────────

    [Fact]
    public void External_enter_updates_the_view_model_without_a_click()
    {
        var controller = new InMemoryFullscreenController();
        FullscreenButtonViewModel vm = NewViewModel(controller);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        // Simulate the OS / a sibling entering fullscreen on the same target (web fullscreenchange).
        controller.RequestFullscreen();

        Assert.True(vm.IsFullscreen);
        Assert.Equal("Exit fullscreen", vm.Label);
        Assert.Contains(nameof(FullscreenButtonViewModel.IsFullscreen), changed);
    }

    [Fact]
    public void External_exit_updates_the_view_model_without_a_click()
    {
        var controller = new InMemoryFullscreenController(isSupported: true, initiallyFullscreen: true);
        FullscreenButtonViewModel vm = NewViewModel(controller);
        Assert.True(vm.IsFullscreen);

        // Simulate the user pressing Esc (web fullscreenchange → exit).
        controller.ExitFullscreen();

        Assert.False(vm.IsFullscreen);
        Assert.Equal("Enter fullscreen", vm.Label);
        Assert.False(vm.IsPressed);
    }

    // ── label overrides (web ariaLabelEnter / ariaLabelExit props) ───────────────────────────────────────

    [Fact]
    public void Enter_label_override_replaces_the_localized_default()
    {
        var localizer = new RecordingLocalizer();
        FullscreenButtonViewModel vm = NewViewModel(localizer: localizer, enterLabelOverride: "Expand chart");

        Assert.Equal("Expand chart", vm.EnterLabel);
        Assert.Equal("Expand chart", vm.Label);
        // The override short-circuits the localizer for the enter label.
        Assert.DoesNotContain(FullscreenButtonRegistration.EnterKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Exit_label_override_replaces_the_localized_default()
    {
        var controller = new InMemoryFullscreenController();
        var localizer = new RecordingLocalizer();
        FullscreenButtonViewModel vm = NewViewModel(controller, localizer, exitLabelOverride: "Restore chart");

        vm.Toggle();

        Assert.Equal("Restore chart", vm.ExitLabel);
        Assert.Equal("Restore chart", vm.Label);
        Assert.DoesNotContain(FullscreenButtonRegistration.ExitKey, localizer.RequestedKeys);
    }

    // ── unsupported: toggling is inert ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Toggle_on_unsupported_platform_stays_windowed()
    {
        var controller = new InMemoryFullscreenController(isSupported: false);
        FullscreenButtonViewModel vm = NewViewModel(controller);

        vm.Toggle();

        Assert.False(vm.IsFullscreen);
        Assert.Equal("Enter fullscreen", vm.Label);
        Assert.False(vm.IsPressed);
    }

    // ── i18n: every label flows through the localizer (no hardcoded English in the view-model) ───────────

    [Fact]
    public void Every_default_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        FullscreenButtonViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.EnterLabel;
        _ = vm.ExitLabel;

        Assert.Contains(FullscreenButtonRegistration.EnterKey, localizer.RequestedKeys);
        Assert.Contains(FullscreenButtonRegistration.ExitKey, localizer.RequestedKeys);
    }

    // ── constructor guards ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Constructor_rejects_null_seams()
    {
        IFullscreenController controller = new InMemoryFullscreenController();
        ILocalizer localizer = PassthroughLocalizer.Instance;

        Assert.Throws<ArgumentNullException>(() => new FullscreenButtonViewModel(null!, localizer));
        Assert.Throws<ArgumentNullException>(() => new FullscreenButtonViewModel(controller, null!));
    }

    // ── dispose: detaches from the controller change event ───────────────────────────────────────────────

    [Fact]
    public void Dispose_stops_syncing_from_the_controller()
    {
        var controller = new InMemoryFullscreenController();
        FullscreenButtonViewModel vm = NewViewModel(controller);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Dispose();
        controller.RequestFullscreen();

        Assert.False(vm.IsFullscreen);
        Assert.Empty(changed);
    }

    [Fact]
    public void Dispose_is_idempotent()
    {
        FullscreenButtonViewModel vm = NewViewModel();

        vm.Dispose();
        vm.Dispose();
    }

    // ── diagnostics (view.opened, PII-safe — no target identity or view content) ─────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FullscreenButtonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FullscreenButton", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new FullscreenButtonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
