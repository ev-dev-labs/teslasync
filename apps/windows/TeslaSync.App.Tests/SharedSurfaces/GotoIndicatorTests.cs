using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>GotoIndicator</c> shared surface's UI-thread-free logic — the registration
/// metadata + label / accessible-name resolvers, the pure visibility policy
/// (<see cref="GotoIndicatorVisibilityPolicy"/>), the state holder that resolves the label and projects the armed
/// flag to the render state (<see cref="GotoIndicatorViewModel"/>), the PII-safe diagnostics and the argument
/// validation. Mirrors the web spec one-for-one (web/src/components/feedback/GotoIndicator.tsx): the localized
/// "Go to..." lead-in, the two physical key-caps <c>g</c> and <c>?</c> joined by <c>+</c>, and the
/// <c>if (!visible) return null</c> render guard whose only two states are hidden and shown. The WinUI view
/// itself (GotoIndicator.cs, which composes the Border / TextBlock chrome, the reduce-motion entrance and the
/// live-region announcement) is exercised by the app build.
/// </summary>
public sealed class GotoIndicatorTests
{
    private const string LabelKey = "translation.shortcuts.goto";
    private const string LabelFallback = "Go to...";

    // ── registration (slug, i18n key + fallback, key-caps, automation id, token brushes) ─────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("GotoIndicator", GotoIndicatorRegistration.Slug);
        Assert.Equal("GotoIndicator", GotoIndicatorViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_web_i18n_key_and_verbatim_english_fallback()
    {
        Assert.Equal(LabelKey, GotoIndicatorRegistration.LabelKey);
        Assert.Equal(LabelFallback, GotoIndicatorRegistration.LabelFallback);
    }

    [Fact]
    public void Registration_pins_the_two_physical_key_caps_and_separator()
    {
        // web <kbd>g</kbd> + <kbd>?</kbd> — physical keys, never localized.
        Assert.Equal("g", GotoIndicatorRegistration.LeadingKeyCap);
        Assert.Equal("?", GotoIndicatorRegistration.ChordKeyCap);
        Assert.Equal("+", GotoIndicatorRegistration.KeyChordSeparator);
    }

    [Fact]
    public void Registration_pins_the_automation_id_and_token_brush_keys()
    {
        Assert.Equal("goto-indicator", GotoIndicatorRegistration.RootAutomationId);

        // web bg-[var(--surface-overlay)] / border-[var(--border-subtle)] / text-[var(--text-muted)] /
        // bg-[var(--surface-2)] / text-[var(--text-secondary)] / text-[var(--text-primary)].
        Assert.Equal("TsSurfaceOverlayBrush", GotoIndicatorRegistration.OverlayBrushKey);
        Assert.Equal("TsColorBorderBrush", GotoIndicatorRegistration.BorderBrushKey);
        Assert.Equal("TsColorTextMutedBrush", GotoIndicatorRegistration.LabelBrushKey);
        Assert.Equal("TsColorSurfaceBrush", GotoIndicatorRegistration.KeyCapBackgroundBrushKey);
        Assert.Equal("TsColorTextSecondaryBrush", GotoIndicatorRegistration.KeyCapForegroundBrushKey);
        Assert.Equal("TsColorTextPrimaryBrush", GotoIndicatorRegistration.PrimaryTextBrushKey);
    }

    [Fact]
    public void ResolveLabel_reads_the_shortcuts_goto_key_with_the_english_fallback()
    {
        var localizer = new RecordingLocalizer();

        string label = GotoIndicatorRegistration.ResolveLabel(localizer);

        (string Key, string Fallback) call = Assert.Single(localizer.Calls);
        Assert.Equal(LabelKey, call.Key);
        Assert.Equal(LabelFallback, call.Fallback);
        Assert.Equal(LabelFallback, label);
    }

    [Fact]
    public void ResolveLabel_returns_the_localized_value_when_the_catalogue_has_one()
    {
        var localizer = new RecordingLocalizer { Translation = "Gehe zu..." };

        string label = GotoIndicatorRegistration.ResolveLabel(localizer);

        Assert.Equal("Gehe zu...", label);
    }

    [Fact]
    public void ResolveLabel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => GotoIndicatorRegistration.ResolveLabel(null!));

    // ── accessible name composition (label + key-caps, the Narrator reading order) ───────────────────────

    [Fact]
    public void ComposeAccessibleName_joins_the_label_and_the_two_key_caps()
    {
        string name = GotoIndicatorRegistration.ComposeAccessibleName(LabelFallback);

        Assert.Equal("Go to... g + ?", name);
    }

    [Fact]
    public void ComposeAccessibleName_uses_the_localized_label()
    {
        string name = GotoIndicatorRegistration.ComposeAccessibleName("Gehe zu...");

        Assert.Equal("Gehe zu... g + ?", name);
    }

    [Fact]
    public void ComposeAccessibleName_rejects_a_null_label() =>
        Assert.Throws<ArgumentNullException>(() => GotoIndicatorRegistration.ComposeAccessibleName(null!));

    // ── adapter: GotoIndicatorVisibilityPolicy (the web `if (!visible) return null` guard) ───────────────

    [Fact]
    public void Decide_returns_shown_when_armed() =>
        Assert.Equal(GotoIndicatorVisibility.Shown, GotoIndicatorVisibilityPolicy.Decide(visible: true));

    [Fact]
    public void Decide_returns_hidden_when_disarmed() =>
        Assert.Equal(GotoIndicatorVisibility.Hidden, GotoIndicatorVisibilityPolicy.Decide(visible: false));

    // ── ViewModel: label / key-caps / accessible name (web useTranslation + <kbd> glyphs) ────────────────

    [Fact]
    public void ViewModel_exposes_the_localized_label()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance);

        Assert.Equal(LabelFallback, vm.Label);
    }

    [Fact]
    public void ViewModel_resolves_the_label_through_the_shortcuts_goto_key()
    {
        var localizer = new RecordingLocalizer { Translation = "Ir a..." };

        var vm = new GotoIndicatorViewModel(localizer);

        Assert.Equal("Ir a...", vm.Label);
        Assert.Equal(LabelKey, Assert.Single(localizer.Calls).Key);
    }

    [Fact]
    public void ViewModel_exposes_the_composed_accessible_name()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance);

        Assert.Equal("Go to... g + ?", vm.AccessibleName);
    }

    // ── ViewModel: visibility projection (the web `visible` prop / two states) ───────────────────────────

    [Fact]
    public void ViewModel_defaults_to_hidden()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance);

        Assert.False(vm.IsVisible);
        Assert.Equal(GotoIndicatorVisibility.Hidden, vm.Visibility);
    }

    [Fact]
    public void ViewModel_can_be_constructed_armed()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance, visible: true);

        Assert.True(vm.IsVisible);
        Assert.Equal(GotoIndicatorVisibility.Shown, vm.Visibility);
    }

    [Fact]
    public void Show_arms_the_hint_and_Hide_disarms_it()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance);

        vm.Show();
        Assert.Equal(GotoIndicatorVisibility.Shown, vm.Visibility);

        vm.Hide();
        Assert.Equal(GotoIndicatorVisibility.Hidden, vm.Visibility);
    }

    [Fact]
    public void Setting_is_visible_raises_property_changed_for_is_visible_and_visibility()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IsVisible = true;

        Assert.Contains(nameof(GotoIndicatorViewModel.IsVisible), changed);
        Assert.Contains(nameof(GotoIndicatorViewModel.Visibility), changed);
    }

    [Fact]
    public void Setting_is_visible_to_the_current_value_is_a_no_op()
    {
        var vm = new GotoIndicatorViewModel(PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IsVisible = false; // already hidden

        Assert.Empty(changed);
    }

    // ── ViewModel: visibility transitions are recorded (PII-safe) ────────────────────────────────────────

    [Fact]
    public void Arming_and_disarming_record_the_shown_and_hidden_events()
    {
        var captured = new List<string>();
        var vm = NewViewModel(captured);

        vm.Show();
        vm.Hide();

        string[] expected =
        [
            "goto.shown slug=GotoIndicator",
            "goto.hidden slug=GotoIndicator",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Repeated_arming_records_a_single_shown_event()
    {
        var captured = new List<string>();
        var vm = NewViewModel(captured);

        vm.Show();
        vm.Show();
        vm.Show();

        Assert.Equal("goto.shown slug=GotoIndicator", Assert.Single(captured));
    }

    [Fact]
    public void Construction_records_no_events()
    {
        var captured = new List<string>();

        _ = NewViewModel(captured, visible: true);

        Assert.Empty(captured);
    }

    // ── ViewModel: view.opened is emitted once on open (web component mount) ─────────────────────────────

    [Fact]
    public void MarkOpened_records_the_view_opened_event_once()
    {
        var captured = new List<string>();
        var vm = NewViewModel(captured);

        vm.MarkOpened();
        vm.MarkOpened();

        Assert.Equal("view.opened slug=GotoIndicator", Assert.Single(captured));
    }

    // ── ViewModel: argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new GotoIndicatorViewModel(null!));

    // ── Diagnostics (P1/S11): slug-only operational counters, never the label text ───────────────────────

    [Fact]
    public void Diagnostics_count_and_emit_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new GotoIndicatorDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordShown();
        diagnostics.RecordHidden();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Shown);
        Assert.Equal(1, diagnostics.Hidden);
        string[] expected =
        [
            "view.opened slug=GotoIndicator",
            "goto.shown slug=GotoIndicator",
            "goto.hidden slug=GotoIndicator",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_never_leak_the_label_text()
    {
        var captured = new List<string>();
        var vm = NewViewModel(captured);

        vm.MarkOpened();
        vm.Show();
        vm.Hide();

        Assert.All(captured, line => Assert.DoesNotContain(LabelFallback, line, StringComparison.Ordinal));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new GotoIndicatorDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static GotoIndicatorViewModel NewViewModel(List<string> sink, bool visible = false) =>
        new(PassthroughLocalizer.Instance, visible, new GotoIndicatorDiagnostics(sink.Add));

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<(string Key, string Fallback)> _calls = [];

        public IReadOnlyList<(string Key, string Fallback)> Calls => _calls;

        public string? Translation { get; init; }

        public string GetString(string key, string fallback)
        {
            _calls.Add((key, fallback));
            return Translation ?? fallback;
        }
    }
}
