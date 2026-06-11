using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the <c>Modal</c> modal-dialog surface's UI-thread-free logic — the size wire
/// mapping, the projections (header gate, accessible-name choice, full-bleed breakpoint, responsive max-width /
/// max-height), the state-holder view-model's branches (initial defaults, the title / ariaLabel accessible-name
/// switch, the open flag and the <c>onClose</c> dismiss contract), the i18n key + fallback contract that
/// doubles as the Narrator-label source, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/ui/Modal.tsx). The WinUI view itself (Modal.cs) is exercised by the app build.
/// </summary>
public sealed class ModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Size wire mapping (web size union 'sm' | 'md' | 'lg' | 'full') ───────────────────────────────────

    [Theory]
    [InlineData(ModalSize.Sm, "sm")]
    [InlineData(ModalSize.Md, "md")]
    [InlineData(ModalSize.Lg, "lg")]
    [InlineData(ModalSize.Full, "full")]
    public void Size_round_trips_through_token(ModalSize size, string token)
    {
        Assert.Equal(token, ModalSizes.ToToken(size));
        Assert.True(ModalSizes.TryFromToken(token, out var parsed));
        Assert.Equal(size, parsed);
    }

    [Fact]
    public void Token_from_unknown_is_false_and_defaults_to_md()
    {
        Assert.False(ModalSizes.TryFromToken("nope", out var size));
        Assert.Equal(ModalSize.Md, size);
        Assert.False(ModalSizes.TryFromToken(null, out var fromNull));
        Assert.Equal(ModalSize.Md, fromNull);
    }

    // ── Registration constants (web Tailwind size / breakpoint literals) ─────────────────────────────────

    [Fact]
    public void Registration_pins_the_web_constants()
    {
        Assert.Equal("Modal", ModalRegistration.Slug);
        Assert.Equal(640, ModalRegistration.MobileBreakpoint);
        Assert.Equal(44, ModalRegistration.CloseButtonMinSize);
        Assert.Equal(1100, ModalRegistration.FullMaxWidth);
        Assert.Equal(0.96, ModalRegistration.ViewportWidthFraction);
        Assert.Equal(0.90, ModalRegistration.MaxHeightFraction);
    }

    [Theory]
    [InlineData(ModalSize.Sm, 384)]
    [InlineData(ModalSize.Md, 512)]
    [InlineData(ModalSize.Lg, 672)]
    [InlineData(ModalSize.Full, 1100)]
    public void MaxContentWidth_matches_the_web_size_map(ModalSize size, double expected) =>
        Assert.Equal(expected, ModalRegistration.MaxContentWidth(size));

    // ── Projection: header gate (web title && (…)) ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", true)]
    [InlineData("Battery Health", true)]
    public void ShouldRenderHeader_matches_web_truthiness(string? title, bool expected) =>
        Assert.Equal(expected, ModalProjection.ShouldRenderHeader(title));

    // ── Projection: accessible name (web aria-labelledby / aria-label) ───────────────────────────────────

    [Fact]
    public void ResolveAccessibleName_prefers_the_title() =>
        Assert.Equal("Settings", ModalProjection.ResolveAccessibleName("Settings", "ignored aria label"));

    [Fact]
    public void ResolveAccessibleName_falls_back_to_aria_label_without_a_title() =>
        Assert.Equal("Confirm action", ModalProjection.ResolveAccessibleName(null, "Confirm action"));

    [Fact]
    public void ResolveAccessibleName_is_empty_when_neither_is_set()
    {
        Assert.Equal(string.Empty, ModalProjection.ResolveAccessibleName(null, null));
        Assert.Equal(string.Empty, ModalProjection.ResolveAccessibleName(string.Empty, null));
    }

    // ── Projection: full-bleed breakpoint (web < sm) ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, false)]
    [InlineData(-10, false)]
    [InlineData(320, true)]
    [InlineData(639, true)]
    [InlineData(640, false)]
    [InlineData(1280, false)]
    public void IsFullBleed_is_true_only_below_the_sm_breakpoint(double width, bool expected) =>
        Assert.Equal(expected, ModalProjection.IsFullBleed(width));

    // ── Projection: responsive max width (web size map + 96vw cap + full-bleed) ──────────────────────────

    [Fact]
    public void EffectiveMaxWidth_unknown_viewport_falls_back_to_the_preset() =>
        Assert.Equal(512, ModalProjection.EffectiveMaxWidth(ModalSize.Md, 0));

    [Fact]
    public void EffectiveMaxWidth_below_sm_fills_the_viewport() =>
        Assert.Equal(500, ModalProjection.EffectiveMaxWidth(ModalSize.Sm, 500));

    [Fact]
    public void EffectiveMaxWidth_at_or_above_sm_uses_the_preset_on_a_wide_viewport() =>
        Assert.Equal(512, ModalProjection.EffectiveMaxWidth(ModalSize.Md, 2000));

    [Fact]
    public void EffectiveMaxWidth_caps_a_preset_to_96vw_on_a_small_viewport() =>
        Assert.Equal(624, ModalProjection.EffectiveMaxWidth(ModalSize.Lg, 650)); // 0.96 * 650

    [Fact]
    public void EffectiveMaxWidth_full_uses_96vw_below_the_cap() =>
        Assert.Equal(960, ModalProjection.EffectiveMaxWidth(ModalSize.Full, 1000)); // 0.96 * 1000

    [Fact]
    public void EffectiveMaxWidth_full_is_capped_at_1100() =>
        Assert.Equal(1100, ModalProjection.EffectiveMaxWidth(ModalSize.Full, 2000));

    // ── Projection: responsive max height (web max-h-[100dvh] / max-h-[90vh]) ────────────────────────────

    [Fact]
    public void EffectiveMaxHeight_unknown_viewport_is_unconstrained() =>
        Assert.Equal(double.PositiveInfinity, ModalProjection.EffectiveMaxHeight(800, 0));

    [Fact]
    public void EffectiveMaxHeight_below_sm_fills_the_viewport() =>
        Assert.Equal(900, ModalProjection.EffectiveMaxHeight(500, 900));

    [Fact]
    public void EffectiveMaxHeight_at_or_above_sm_caps_to_90vh() =>
        Assert.Equal(810, ModalProjection.EffectiveMaxHeight(1000, 900)); // 0.90 * 900

    // ── View-model: initial (closed) state mirrors web defaults ──────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = new ModalViewModel(Localizer);

        Assert.False(vm.IsOpen);
        Assert.Null(vm.Title);
        Assert.Equal(ModalSize.Md, vm.Size);
        Assert.Null(vm.AriaLabel);
        Assert.False(vm.HasTitle);
        Assert.Equal(string.Empty, vm.AccessibleName);
        Assert.Equal("Close", vm.CloseLabel);
    }

    // ── View-model: title drives the header gate + accessible name + change notifications ────────────────

    [Fact]
    public void Title_drives_header_and_accessible_name_and_raises_change()
    {
        var vm = new ModalViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Title = "Battery Health";

        Assert.True(vm.HasTitle);
        Assert.Equal("Battery Health", vm.AccessibleName);
        Assert.Contains(nameof(ModalViewModel.Title), changed);
        Assert.Contains(nameof(ModalViewModel.HasTitle), changed);
        Assert.Contains(nameof(ModalViewModel.AccessibleName), changed);
    }

    [Fact]
    public void AriaLabel_is_the_accessible_name_only_without_a_title()
    {
        var vm = new ModalViewModel(Localizer) { AriaLabel = "Confirm delete" };

        Assert.False(vm.HasTitle);
        Assert.Equal("Confirm delete", vm.AccessibleName);

        vm.Title = "Delete vehicle";
        Assert.Equal("Delete vehicle", vm.AccessibleName); // title wins
    }

    [Fact]
    public void IsOpen_and_Size_raise_change()
    {
        var vm = new ModalViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.IsOpen = true;
        vm.Size = ModalSize.Lg;

        Assert.True(vm.IsOpen);
        Assert.Equal(ModalSize.Lg, vm.Size);
        Assert.Contains(nameof(ModalViewModel.IsOpen), changed);
        Assert.Contains(nameof(ModalViewModel.Size), changed);
    }

    // ── View-model: dismiss contract (web onClose) ───────────────────────────────────────────────────────

    [Fact]
    public void RequestClose_raises_close_requested()
    {
        var vm = new ModalViewModel(Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        vm.RequestClose();

        Assert.Equal(1, closes);
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diag = new ModalDiagnostics(lines.Add);
        var vm = new ModalViewModel(Localizer, diag);

        vm.NotifyOpened();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=Modal", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_records_view_opened_without_content()
    {
        var lines = new List<string>();
        var diag = new ModalDiagnostics(lines.Add);

        diag.RecordViewOpened();
        diag.RecordViewOpened();

        Assert.Equal(2, diag.ViewsOpened);
        Assert.All(lines, line => Assert.Equal("view.opened slug=Modal", line));
    }

    // ── i18n key + fallback contract (the Narrator-label source) ─────────────────────────────────────────

    [Fact]
    public void Close_label_routes_through_a_common_key()
    {
        var recorder = new RecordingLocalizer();

        _ = new ModalViewModel(recorder).CloseLabel;

        var key = Assert.Single(recorder.Keys);
        Assert.StartsWith("common.", key, StringComparison.Ordinal);
    }

    [Fact]
    public void English_fallback_matches_the_web_literal() =>
        Assert.Equal("Close", ModalRegistration.CloseLabel(Localizer));

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
