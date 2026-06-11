using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the AIThinkingIndicator surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the two i18n keys the source references, the ARIA role/live contract, and the
/// structural dot/skeleton constants), the pure <see cref="AIThinkingProjection"/> adapter (label resolution +
/// reduced-motion branch), the <see cref="AIThinkingIndicatorViewModel"/> state holder (initial projection,
/// runtime motion toggle, subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/ai/AIThinkingIndicator.tsx). The WinUI views (shared-surfaces/AIThinkingIndicator.cs and
/// AIThinkingIndicator.Dots.cs) are exercised by the app build.
/// </summary>
public sealed class AIThinkingIndicatorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIThinkingIndicator", AIThinkingIndicatorRegistration.Slug);

    [Fact]
    public void Root_automation_id_matches_the_web_test_id() =>
        Assert.Equal("ai-thinking-indicator", AIThinkingIndicatorRegistration.RootAutomationId);

    [Fact]
    public void Default_label_key_and_fallback_match_the_web_source()
    {
        // web: t('helix.thinking', 'Helix is thinking') — translation-namespaced key, verbatim fallback.
        Assert.Equal("translation.helix.thinking", AIThinkingIndicatorRegistration.HelixThinkingKey);
        Assert.Equal("Helix is thinking", AIThinkingIndicatorRegistration.HelixThinkingFallback);
    }

    [Fact]
    public void Generic_override_label_key_and_fallback_match_the_web_jsdoc()
    {
        // web JSDoc override example: t('ai.common.thinking', 'AI is thinking').
        Assert.Equal("translation.ai.common.thinking", AIThinkingIndicatorRegistration.AiCommonThinkingKey);
        Assert.Equal("AI is thinking", AIThinkingIndicatorRegistration.AiCommonThinkingFallback);
    }

    [Fact]
    public void Aria_role_and_live_setting_match_the_web_container()
    {
        // web: role="status" aria-live="polite".
        Assert.Equal("status", AIThinkingIndicatorRegistration.Role);
        Assert.Equal("polite", AIThinkingIndicatorRegistration.LiveSetting);
    }

    [Fact]
    public void Dot_count_matches_the_web_three_dots() =>
        Assert.Equal(3, AIThinkingIndicatorRegistration.DotCount);

    [Fact]
    public void Skeleton_line_fractions_match_the_web_decreasing_widths()
    {
        // web: w-full, w-11/12, w-9/12.
        Assert.Equal(
            new[] { (1, 1), (11, 12), (9, 12) },
            AIThinkingIndicatorRegistration.SkeletonLineFractions);
    }

    // ── projection adapter (web component body: label ?? t(...), motion-safe branch) ──────────────────────

    [Fact]
    public void Projection_default_label_resolves_through_the_i18n_facade()
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: false);

        Assert.Equal("Helix is thinking", projection.Label);
    }

    [Fact]
    public void Projection_uses_the_localizer_translation_when_the_catalog_has_the_key()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [AIThinkingIndicatorRegistration.HelixThinkingKey] = "Helix réfléchit",
        });

        var projection = AIThinkingProjection.Project(localizer, customLabel: null, reduceMotion: false);

        Assert.Equal("Helix réfléchit", projection.Label);
    }

    [Fact]
    public void Projection_uses_the_custom_label_verbatim_when_supplied()
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel: "AI is summarising", reduceMotion: false);

        Assert.Equal("AI is summarising", projection.Label);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Projection_falls_back_to_the_default_label_when_the_override_is_blank(string? customLabel)
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel, reduceMotion: false);

        Assert.Equal("Helix is thinking", projection.Label);
    }

    [Fact]
    public void Projection_animates_when_motion_is_allowed()
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: false);

        Assert.True(projection.Animate);
    }

    [Fact]
    public void Projection_does_not_animate_under_reduced_motion()
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: true);

        // web motion-safe: the dots stop bouncing and the lines drop the shimmer; the static skeleton remains.
        Assert.False(projection.Animate);
    }

    [Fact]
    public void Projection_carries_the_status_polite_live_contract()
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: false);

        Assert.Equal("status", projection.Role);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => AIThinkingProjection.Project(null!, customLabel: null, reduceMotion: false));

    // ── per-state "snapshot": each of the four render states projects an exact, stable value ──────────────

    [Theory]
    [InlineData(null, false, "Helix is thinking", true)]
    [InlineData(null, true, "Helix is thinking", false)]
    [InlineData("AI is thinking", false, "AI is thinking", true)]
    [InlineData("AI is thinking", true, "AI is thinking", false)]
    public void Projection_snapshot_per_state(string? customLabel, bool reduceMotion, string expectedLabel, bool expectedAnimate)
    {
        var projection = AIThinkingProjection.Project(Localizer, customLabel, reduceMotion);

        Assert.Equal(expectedLabel, projection.Label);
        Assert.Equal(expectedAnimate, projection.Animate);
        Assert.Equal("status", projection.Role);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: false);
        var b = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: false);
        var different = AIThinkingProjection.Project(Localizer, customLabel: null, reduceMotion: true);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("AIThinkingIndicator", AIThinkingIndicatorViewModel.Slug);

    [Fact]
    public void ViewModel_starts_with_the_default_label_and_motion()
    {
        using var viewModel = new AIThinkingIndicatorViewModel(
            Localizer, customLabel: null, StaticMotionPreferenceSource.FullMotion);

        Assert.Equal("Helix is thinking", viewModel.Label);
        Assert.True(viewModel.Animate);
        Assert.Equal("Helix is thinking", viewModel.Projection.Label);
    }

    [Fact]
    public void ViewModel_starts_reduced_when_the_motion_source_reports_reduced()
    {
        using var viewModel = new AIThinkingIndicatorViewModel(
            Localizer, customLabel: null, StaticMotionPreferenceSource.Reduced);

        Assert.False(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_carries_the_custom_label()
    {
        using var viewModel = new AIThinkingIndicatorViewModel(
            Localizer, customLabel: "AI is thinking", StaticMotionPreferenceSource.FullMotion);

        Assert.Equal("AI is thinking", viewModel.Label);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new AIThinkingIndicatorViewModel(Localizer, customLabel: null, motion);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Animate);
        Assert.Contains(nameof(AIThinkingIndicatorViewModel.Animate), changed);
        Assert.Contains(nameof(AIThinkingIndicatorViewModel.Projection), changed);
        // The label is unaffected by a motion change.
        Assert.DoesNotContain(nameof(AIThinkingIndicatorViewModel.Label), changed);
        Assert.Equal("Helix is thinking", viewModel.Label);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_a_motion_change_is_a_no_op()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        using var viewModel = new AIThinkingIndicatorViewModel(Localizer, customLabel: null, motion);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        motion.Set(reduceMotion: false);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_motion_source()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var viewModel = new AIThinkingIndicatorViewModel(Localizer, customLabel: null, motion);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);
        Assert.True(viewModel.Animate);

        // After dispose a late change must not move the projection.
        motion.Set(reduceMotion: true);
        Assert.True(viewModel.Animate);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => new AIThinkingIndicatorViewModel(null!, customLabel: null, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new AIThinkingIndicatorViewModel(Localizer, customLabel: null, motion: null!));
    }

    // ── accessibility: the resolved label is the surface's accessible status name ─────────────────────────

    [Fact]
    public void Accessible_status_name_is_the_resolved_label()
    {
        using var viewModel = new AIThinkingIndicatorViewModel(
            Localizer, customLabel: null, StaticMotionPreferenceSource.FullMotion);

        // The view sets AutomationProperties.Name to ViewModel.Label and marks the surface a polite live region
        // (see AIThinkingIndicator.cs), so the projected label IS the accessible name Narrator announces.
        Assert.Equal("Helix is thinking", viewModel.Label);
        Assert.Equal("polite", viewModel.Projection.LiveSetting);
        Assert.Equal("status", viewModel.Projection.Role);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIThinkingIndicatorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIThinkingIndicator", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIThinkingIndicatorDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new AIThinkingIndicatorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(AIThinkingIndicatorRegistration.Slug, line, StringComparison.Ordinal);
    }

    private sealed class StubLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public StubLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class FakeMotionSource : IMotionPreferenceSource
    {
        private readonly List<Action<bool>> _observers = new();
        private bool _reduceMotion;

        public FakeMotionSource(bool reduceMotion) => _reduceMotion = reduceMotion;

        public bool ReduceMotion => _reduceMotion;

        public int ObserverCount => _observers.Count;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        public void Set(bool reduceMotion)
        {
            _reduceMotion = reduceMotion;
            foreach (var observer in _observers.ToArray())
            {
                observer(reduceMotion);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeMotionSource _owner;
            private readonly Action<bool> _observer;
            private bool _disposed;

            public Subscription(FakeMotionSource owner, Action<bool> observer)
            {
                _owner = owner;
                _observer = observer;
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _owner._observers.Remove(_observer);
            }
        }
    }
}
