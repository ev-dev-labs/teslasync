using System;
using System.Collections.Generic;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the SwipeRow surface's UI-thread-free logic — the registration metadata + gesture
/// constants (<see cref="SwipeRowRegistration"/>), the action display model + its accessible-name / glyph contract
/// (<see cref="SwipeActionModel"/>), the pure offset / release maths (<see cref="SwipeGeometry"/>, the adapter the
/// view drives through), the active-gating + reduce-motion projection (<see cref="SwipeRowProjection"/>), the
/// state holder with its reactive reprojection + action invocation (<see cref="SwipeRowViewModel"/>), the
/// coarse-pointer + haptic seams (<see cref="ICoarsePointerSource"/> / <see cref="ISwipeHaptic"/> and their static
/// / no-op / delegate implementations) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/mobile/SwipeRow.tsx). The WinUI view (shared-surfaces/SwipeRow.cs, which lays out the action
/// panels + the translating content host and forwards pointer input) is exercised by the app build. Because the
/// component reads no network data and resolves no i18n keys (it is an anonymous wrapper whose action labels are
/// caller-provided, already-localized strings), there is no loading / error / stale / offline state and no i18n
/// catalogue dependency; the reproduced branches are the inactive passthrough, the active drag clamp, the
/// threshold-cross haptic, the fire / peek / snap-closed releases and the reduced-motion vs animated snap.
/// </summary>
public sealed class SwipeRowTests
{
    // ── recording / controllable doubles ─────────────────────────────────────────────────────────────────────

    private sealed class ControllableCoarsePointerSource : ICoarsePointerSource
    {
        private readonly List<Action<bool>> _observers = new();

        public ControllableCoarsePointerSource(bool initial) => IsCoarsePointer = initial;

        public bool IsCoarsePointer { get; private set; }

        public int ObserverCount => _observers.Count;

        public void Set(bool value)
        {
            IsCoarsePointer = value;
            foreach (Action<bool> observer in _observers.ToArray())
            {
                observer(value);
            }
        }

        public IDisposable Observe(Action<bool> onChanged)
        {
            _observers.Add(onChanged);
            return new Subscription(() => _observers.Remove(onChanged));
        }

        private sealed class Subscription : IDisposable
        {
            private Action? _dispose;

            public Subscription(Action dispose) => _dispose = dispose;

            public void Dispose()
            {
                _dispose?.Invoke();
                _dispose = null;
            }
        }
    }

    private sealed class ControllableMotionSource : IMotionPreferenceSource
    {
        private readonly List<Action<bool>> _observers = new();

        public ControllableMotionSource(bool initial) => ReduceMotion = initial;

        public bool ReduceMotion { get; private set; }

        public int ObserverCount => _observers.Count;

        public void Set(bool value)
        {
            ReduceMotion = value;
            foreach (Action<bool> observer in _observers.ToArray())
            {
                observer(value);
            }
        }

        public IDisposable Observe(Action<bool> onChanged)
        {
            _observers.Add(onChanged);
            return new Subscription(() => _observers.Remove(onChanged));
        }

        private sealed class Subscription : IDisposable
        {
            private Action? _dispose;

            public Subscription(Action dispose) => _dispose = dispose;

            public void Dispose()
            {
                _dispose?.Invoke();
                _dispose = null;
            }
        }
    }

    private static SwipeActionModel Archive() => new("Archive");

    private static SwipeActionModel Delete() => new("Delete", SwipeActionTone.Danger);

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("SwipeRow", SwipeRowRegistration.Slug);

    [Fact]
    public void Root_automation_id_matches_the_web_testid() =>
        Assert.Equal("swipe-row", SwipeRowRegistration.RootAutomationId);

    [Fact]
    public void Gesture_constants_match_the_web_module_constants()
    {
        Assert.Equal(64, SwipeRowRegistration.DefaultRevealThreshold);   // web DEFAULT_REVEAL
        Assert.Equal(16, SwipeRowRegistration.VerticalTolerance);        // web VERTICAL_TOLERANCE
        Assert.Equal(96, SwipeRowRegistration.ActionWidth);              // web ACTION_WIDTH
        Assert.Equal(8, SwipeRowRegistration.HorizontalEngageThreshold); // web Math.abs(dx) < 8
        Assert.Equal(10, SwipeRowRegistration.HapticPulseMs);            // web navigator.vibrate(10)
        Assert.Equal(150, SwipeRowRegistration.SnapDurationMs);          // web duration-fast (150ms)
    }

    [Fact]
    public void Default_glyphs_map_tone_to_the_web_lucide_icons()
    {
        // web defaultIcon: Trash2 for danger, Archive otherwise.
        Assert.Equal(SwipeRowRegistration.DangerActionGlyph, SwipeRowRegistration.DefaultGlyphFor(SwipeActionTone.Danger));
        Assert.Equal(SwipeRowRegistration.DefaultActionGlyph, SwipeRowRegistration.DefaultGlyphFor(SwipeActionTone.Default));
        Assert.NotEqual(SwipeRowRegistration.DefaultActionGlyph, SwipeRowRegistration.DangerActionGlyph);
    }

    // ── action model ─────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Action_requires_a_label()
    {
        Assert.Throws<ArgumentNullException>(() => new SwipeActionModel(null!));
        Assert.Throws<ArgumentException>(() => new SwipeActionModel("   "));
    }

    [Fact]
    public void Action_defaults_to_the_default_tone_and_its_glyph()
    {
        var action = new SwipeActionModel("Archive");
        Assert.Equal(SwipeActionTone.Default, action.Tone);
        Assert.Equal(SwipeRowRegistration.DefaultActionGlyph, action.Glyph);
    }

    [Fact]
    public void Danger_action_uses_the_danger_glyph()
    {
        var action = new SwipeActionModel("Delete", SwipeActionTone.Danger);
        Assert.Equal(SwipeRowRegistration.DangerActionGlyph, action.Glyph);
    }

    [Fact]
    public void Action_glyph_override_wins_over_the_tone_default()
    {
        var action = new SwipeActionModel("Pin", SwipeActionTone.Default, iconGlyphOverride: "\uE718");
        Assert.Equal("\uE718", action.Glyph);
    }

    [Fact]
    public void Action_accessible_name_falls_back_to_the_label()
    {
        // web aria-label={ariaLabel ?? label}.
        Assert.Equal("Archive", new SwipeActionModel("Archive").AccessibleName);
        Assert.Equal("Archive this drive", new SwipeActionModel("Archive", ariaLabel: "Archive this drive").AccessibleName);
    }

    [Fact]
    public void Blank_aria_label_and_glyph_override_are_treated_as_absent()
    {
        var action = new SwipeActionModel("Archive", ariaLabel: "   ", iconGlyphOverride: " ");
        Assert.Null(action.AriaLabel);
        Assert.Null(action.IconGlyphOverride);
        Assert.Equal("Archive", action.AccessibleName);
        Assert.Equal(SwipeRowRegistration.DefaultActionGlyph, action.Glyph);
    }

    // ── geometry: vertical abort + horizontal engage ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(4, 40, true)]   // dominant vertical past tolerance -> cancel
    [InlineData(40, 40, false)] // equal -> not strictly greater -> no cancel
    [InlineData(40, 8, false)]  // horizontal dominant -> no cancel
    [InlineData(2, 10, false)]  // vertical but within tolerance -> no cancel
    public void IsVerticalCancel_matches_the_web_abort_rule(double dx, double dy, bool expected) =>
        Assert.Equal(expected, SwipeGeometry.IsVerticalCancel(dx, dy));

    [Theory]
    [InlineData(8, true)]
    [InlineData(-8, true)]
    [InlineData(7.9, false)]
    [InlineData(0, false)]
    public void IsHorizontalEngaged_locks_at_eight_pixels(double dx, bool expected) =>
        Assert.Equal(expected, SwipeGeometry.IsHorizontalEngaged(dx));

    // ── geometry: per-side clamp ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ClampOffset_ignores_a_left_drag_without_a_right_action()
    {
        // web: if (next < 0 && !rightAction) next = 0.
        Assert.Equal(0, SwipeGeometry.ClampOffset(-50, 320, hasLeftAction: true, hasRightAction: false));
    }

    [Fact]
    public void ClampOffset_ignores_a_right_drag_without_a_left_action()
    {
        // web: if (next > 0 && !leftAction) next = 0.
        Assert.Equal(0, SwipeGeometry.ClampOffset(50, 320, hasLeftAction: false, hasRightAction: true));
    }

    [Fact]
    public void ClampOffset_passes_a_drag_towards_a_wired_side()
    {
        Assert.Equal(-50, SwipeGeometry.ClampOffset(-50, 320, hasLeftAction: false, hasRightAction: true));
        Assert.Equal(50, SwipeGeometry.ClampOffset(50, 320, hasLeftAction: true, hasRightAction: false));
    }

    [Fact]
    public void ClampOffset_resists_past_the_row_width()
    {
        Assert.Equal(-320, SwipeGeometry.ClampOffset(-999, 320, hasLeftAction: true, hasRightAction: true));
        Assert.Equal(320, SwipeGeometry.ClampOffset(999, 320, hasLeftAction: true, hasRightAction: true));
    }

    [Fact]
    public void ClampOffset_falls_back_to_the_web_default_width()
    {
        // web: width || 320.
        Assert.Equal(-320, SwipeGeometry.ClampOffset(-999, 0, hasLeftAction: true, hasRightAction: true));
    }

    [Theory]
    [InlineData(64, 64, true)]
    [InlineData(-64, 64, true)]
    [InlineData(63, 64, false)]
    public void CrossedReveal_fires_at_the_threshold(double offset, double threshold, bool expected) =>
        Assert.Equal(expected, SwipeGeometry.CrossedReveal(offset, threshold));

    // ── geometry: release ladder ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ResolveRelease_auto_fires_the_right_action_past_half_width()
    {
        SwipeRelease release = SwipeGeometry.ResolveRelease(-160, 320, 64, hasLeftAction: true, hasRightAction: true);
        Assert.Equal(SwipeOutcome.FireRight, release.Outcome);
        Assert.Equal(0, release.RestingOffset);
    }

    [Fact]
    public void ResolveRelease_auto_fires_the_left_action_past_half_width()
    {
        SwipeRelease release = SwipeGeometry.ResolveRelease(160, 320, 64, hasLeftAction: true, hasRightAction: true);
        Assert.Equal(SwipeOutcome.FireLeft, release.Outcome);
        Assert.Equal(0, release.RestingOffset);
    }

    [Fact]
    public void ResolveRelease_peeks_the_right_action_past_the_threshold()
    {
        SwipeRelease release = SwipeGeometry.ResolveRelease(-80, 320, 64, hasLeftAction: false, hasRightAction: true);
        Assert.Equal(SwipeOutcome.PeekRight, release.Outcome);
        Assert.Equal(-SwipeRowRegistration.ActionWidth, release.RestingOffset);
    }

    [Fact]
    public void ResolveRelease_peeks_the_left_action_past_the_threshold()
    {
        SwipeRelease release = SwipeGeometry.ResolveRelease(80, 320, 64, hasLeftAction: true, hasRightAction: false);
        Assert.Equal(SwipeOutcome.PeekLeft, release.Outcome);
        Assert.Equal(SwipeRowRegistration.ActionWidth, release.RestingOffset);
    }

    [Fact]
    public void ResolveRelease_snaps_closed_below_the_threshold()
    {
        SwipeRelease release = SwipeGeometry.ResolveRelease(-40, 320, 64, hasLeftAction: true, hasRightAction: true);
        Assert.Equal(SwipeOutcome.None, release.Outcome);
        Assert.Equal(0, release.RestingOffset);
    }

    [Fact]
    public void ResolveRelease_does_not_fire_an_unwired_side()
    {
        // Far left swipe but no right action wired -> nothing fires / peeks.
        SwipeRelease release = SwipeGeometry.ResolveRelease(-300, 320, 64, hasLeftAction: true, hasRightAction: false);
        Assert.Equal(SwipeOutcome.None, release.Outcome);
        Assert.Equal(0, release.RestingOffset);
    }

    [Fact]
    public void ResolveRelease_prefers_fire_over_peek_when_past_half_width()
    {
        // Past both the reveal threshold and half width -> the auto-fire branch wins (it is checked first).
        SwipeRelease release = SwipeGeometry.ResolveRelease(-200, 320, 64, hasLeftAction: false, hasRightAction: true);
        Assert.Equal(SwipeOutcome.FireRight, release.Outcome);
    }

    // ── projection: active gating (per-state) ────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_active_on_a_coarse_pointer_with_an_action()
    {
        SwipeRowProjection p = SwipeRowProjection.Project(enabled: null, coarsePointer: true, reduceMotion: false, leftAction: null, rightAction: Delete());
        Assert.True(p.IsActive);
    }

    [Fact]
    public void Projection_renders_passthrough_on_a_fine_pointer()
    {
        // web active = (enabled ?? isCoarse) && hasAction.
        SwipeRowProjection p = SwipeRowProjection.Project(enabled: null, coarsePointer: false, reduceMotion: false, leftAction: null, rightAction: Delete());
        Assert.False(p.IsActive);
    }

    [Fact]
    public void Projection_enabled_override_forces_active_on_a_fine_pointer()
    {
        SwipeRowProjection p = SwipeRowProjection.Project(enabled: true, coarsePointer: false, reduceMotion: false, leftAction: Archive(), rightAction: null);
        Assert.True(p.IsActive);
    }

    [Fact]
    public void Projection_enabled_false_forces_passthrough_on_a_coarse_pointer()
    {
        SwipeRowProjection p = SwipeRowProjection.Project(enabled: false, coarsePointer: true, reduceMotion: false, leftAction: Archive(), rightAction: Delete());
        Assert.False(p.IsActive);
    }

    [Fact]
    public void Projection_is_inactive_without_any_action()
    {
        // web active requires (rightAction != null || leftAction != null).
        SwipeRowProjection p = SwipeRowProjection.Project(enabled: true, coarsePointer: true, reduceMotion: false, leftAction: null, rightAction: null);
        Assert.False(p.IsActive);
    }

    [Fact]
    public void Projection_surfaces_the_wired_actions_and_flags()
    {
        SwipeActionModel left = Archive();
        SwipeActionModel right = Delete();
        SwipeRowProjection p = SwipeRowProjection.Project(enabled: null, coarsePointer: true, reduceMotion: true, leftAction: left, rightAction: right);

        Assert.True(p.HasLeftAction);
        Assert.True(p.HasRightAction);
        Assert.Same(left, p.LeftAction);
        Assert.Same(right, p.RightAction);
        Assert.True(p.ReduceMotion);
        Assert.Equal(SwipeRowRegistration.ActionWidth, p.ActionWidth);
    }

    [Fact]
    public void Projection_uses_the_default_threshold_when_unset_or_non_positive()
    {
        Assert.Equal(64, SwipeRowProjection.Project(null, true, false, Archive(), null).RevealThreshold);
        Assert.Equal(64, SwipeRowProjection.Project(null, true, false, Archive(), null, revealThreshold: 0).RevealThreshold);
        Assert.Equal(120, SwipeRowProjection.Project(null, true, false, Archive(), null, revealThreshold: 120).RevealThreshold);
    }

    // ── view-model: state holder ─────────────────────────────────────────────────────────────────────────────

    private static SwipeRowViewModel NewViewModel(
        SwipeActionModel? left = null,
        Action? onLeft = null,
        SwipeActionModel? right = null,
        Action? onRight = null,
        ICoarsePointerSource? pointer = null,
        IMotionPreferenceSource? motion = null,
        bool? enabled = null) =>
        new(
            left,
            onLeft,
            right,
            onRight,
            pointer ?? StaticCoarsePointerSource.Coarse,
            motion ?? StaticMotionPreferenceSource.FullMotion,
            enabled);

    [Fact]
    public void ViewModel_projects_its_sources_on_construction()
    {
        using SwipeRowViewModel vm = NewViewModel(right: Delete(), pointer: StaticCoarsePointerSource.Fine);
        Assert.False(vm.IsActive);
        Assert.True(vm.HasRightAction);
        Assert.False(vm.HasLeftAction);
    }

    [Fact]
    public void ViewModel_invokes_the_action_callbacks()
    {
        var fired = new List<string>();
        using SwipeRowViewModel vm = NewViewModel(
            left: Archive(),
            onLeft: () => fired.Add("left"),
            right: Delete(),
            onRight: () => fired.Add("right"));

        vm.InvokeLeftAction();
        vm.InvokeRightAction();

        Assert.Equal(new[] { "left", "right" }, fired);
    }

    [Fact]
    public void ViewModel_invocation_is_safe_when_no_callback_is_wired()
    {
        using SwipeRowViewModel vm = NewViewModel(left: Archive());
        vm.InvokeLeftAction();  // no callback supplied -> no-op
        vm.InvokeRightAction(); // no right action at all -> no-op
    }

    [Fact]
    public void ViewModel_reprojects_when_the_pointer_becomes_coarse()
    {
        var pointer = new ControllableCoarsePointerSource(initial: false);
        using SwipeRowViewModel vm = NewViewModel(right: Delete(), pointer: pointer);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        Assert.False(vm.IsActive);
        pointer.Set(true);

        Assert.True(vm.IsActive);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_reprojects_when_reduce_motion_toggles()
    {
        var motion = new ControllableMotionSource(initial: false);
        using SwipeRowViewModel vm = NewViewModel(right: Delete(), motion: motion);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        Assert.False(vm.ReduceMotion);
        motion.Set(true);

        Assert.True(vm.ReduceMotion);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_ignores_a_no_op_source_change()
    {
        var pointer = new ControllableCoarsePointerSource(initial: true);
        using SwipeRowViewModel vm = NewViewModel(right: Delete(), pointer: pointer);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        pointer.Set(true); // same value -> no reprojection

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_both_sources()
    {
        var pointer = new ControllableCoarsePointerSource(initial: false);
        var motion = new ControllableMotionSource(initial: false);
        SwipeRowViewModel vm = NewViewModel(right: Delete(), pointer: pointer, motion: motion);

        Assert.Equal(1, pointer.ObserverCount);
        Assert.Equal(1, motion.ObserverCount);

        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;
        vm.Dispose();

        Assert.Equal(0, pointer.ObserverCount);
        Assert.Equal(0, motion.ObserverCount);

        pointer.Set(true); // after dispose -> no reprojection
        motion.Set(true);
        Assert.Equal(0, changes);

        vm.Dispose(); // idempotent
    }

    // ── seams ────────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticCoarsePointerSource_reports_its_fixed_value()
    {
        Assert.True(StaticCoarsePointerSource.Coarse.IsCoarsePointer);
        Assert.False(StaticCoarsePointerSource.Fine.IsCoarsePointer);
    }

    [Fact]
    public void NoopSwipeHaptic_pulse_is_inert()
    {
        // No throw, no observable effect — the desktop default, mirroring web safeVibrate on unsupported hosts.
        NoopSwipeHaptic.Instance.Pulse(10);
    }

    [Fact]
    public void DelegateSwipeHaptic_routes_the_pulse_to_its_delegate()
    {
        var pulses = new List<int>();
        var haptic = new DelegateSwipeHaptic(pulses.Add);
        haptic.Pulse(SwipeRowRegistration.HapticPulseMs);
        Assert.Equal(new[] { 10 }, pulses);
    }

    [Fact]
    public void DelegateSwipeHaptic_with_a_null_delegate_is_safe()
    {
        var haptic = new DelegateSwipeHaptic(null);
        haptic.Pulse(10); // no throw
    }

    // ── diagnostics ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SwipeRowDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=SwipeRow" }, lines);
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new SwipeRowDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
