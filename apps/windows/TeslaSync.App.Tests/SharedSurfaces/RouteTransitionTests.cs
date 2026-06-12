using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>RouteTransition</c> shared surface's UI-thread-free logic — the
/// <see cref="RouteMatcher"/> react-router <c>matchPath({ end: true })</c> port, the pure
/// <see cref="RouteTransitionPlan"/> projection (full-motion / reduced-motion / list↔detail skip / zero-duration
/// / clamping branches), the <see cref="RouteTransitionViewModel"/> state holder (mount-without-fade,
/// pathname-only re-key, first-and-subsequent navigations, runtime reduce-motion, disposal) and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/motion/RouteTransition.tsx). The WinUI view itself
/// (shared-surfaces/RouteTransition/RouteTransition.cs — the presenter + cross-fade storyboard) is exercised by
/// the app build. Because the surface reads no network data, there is no loading / error / stale / offline state;
/// the reproduced branches are the animated navigation, the instant (reduced-motion or list↔detail) navigation,
/// and the no-op mount / same-pathname render.
/// </summary>
public sealed class RouteTransitionTests
{
    // ── registration metadata ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface()
    {
        Assert.Equal("RouteTransition", RouteTransitionRegistration.Slug);
        Assert.Equal("RouteTransition", RouteTransitionViewModel.Slug);
    }

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("route-transition", RouteTransitionRegistration.RootAutomationId);

    [Fact]
    public void Prop_defaults_match_the_web_source()
    {
        // web: useMotionPreference(120), y: 4.
        Assert.Equal(120, RouteTransitionRegistration.DefaultDurationMs);
        Assert.Equal(4.0, RouteTransitionRegistration.DefaultOffsetY);
    }

    [Fact]
    public void Wrapper_is_accessibility_transparent() =>
        // web motion.div has no ARIA role: the wrapper contributes no Narrator node of its own.
        Assert.False(RouteTransitionRegistration.ContributesAccessibilityNode);

    [Fact]
    public void Default_skip_patterns_match_the_web_source()
    {
        string[] expected =
        [
            "/drives/:id",
            "/drives/:id/replay",
            "/charging/:id",
            "/vehicles/:id",
            "/vehicles/:id/access",
            "/trips/:id",
        ];
        Assert.Equal(expected, RouteTransitionRegistration.DefaultSkipPatterns);
    }

    // ── RouteMatcher: react-router matchPath({ end: true }) port ─────────────────────────────────────────

    [Theory]
    [InlineData("/drives/:id", "/drives/123", true)]
    [InlineData("/drives/:id", "/drives/abc", true)]
    [InlineData("/drives/:id", "/drives/123/", true)]          // end: true tolerates a trailing slash
    [InlineData("/drives/:id", "/Drives/123", true)]           // caseSensitive: false
    [InlineData("/drives/:id", "/drives", false)]              // missing dynamic segment
    [InlineData("/drives/:id", "/drives/", false)]             // empty dynamic segment (segment count drops)
    [InlineData("/drives/:id", "/drives/123/replay", false)]   // extra segment — end: true requires full match
    [InlineData("/drives/:id", "/charging/123", false)]        // different static segment
    [InlineData("/drives/:id/replay", "/drives/9/replay", true)]
    [InlineData("/drives/:id/replay", "/drives//replay", false)] // empty dynamic segment in the middle
    [InlineData("/vehicles/:id/access", "/vehicles/7/access", true)]
    [InlineData("/vehicles/:id/access", "/vehicles/7", false)]
    [InlineData("/charging/:id", "/charging/42", true)]
    [InlineData("/trips/:id", "/trips/x", true)]
    public void Matcher_reproduces_matchPath(string pattern, string pathname, bool expected) =>
        Assert.Equal(expected, RouteMatcher.Matches(pattern, pathname));

    [Theory]
    [InlineData("/drives/5", true)]
    [InlineData("/drives/5/replay", true)]
    [InlineData("/charging/9", true)]
    [InlineData("/vehicles/2", true)]
    [InlineData("/vehicles/2/access", true)]
    [InlineData("/trips/77", true)]
    [InlineData("/drives", false)]     // the list page is NOT a skip target
    [InlineData("/charging", false)]
    [InlineData("/vehicles", false)]
    [InlineData("/dashboard", false)]
    [InlineData("/", false)]
    public void MatchesAny_flags_only_list_detail_paths(string pathname, bool expected) =>
        Assert.Equal(expected, RouteMatcher.MatchesAny(RouteTransitionRegistration.DefaultSkipPatterns, pathname));

    [Fact]
    public void Matcher_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => RouteMatcher.Matches(null!, "/x"));
        Assert.Throws<ArgumentNullException>(() => RouteMatcher.Matches("/x", null!));
        Assert.Throws<ArgumentNullException>(() => RouteMatcher.MatchesAny(null!, "/x"));
        Assert.Throws<ArgumentNullException>(() => RouteMatcher.MatchesAny(RouteTransitionRegistration.DefaultSkipPatterns, null!));
    }

    // ── RouteTransitionPlan: the projection adapter (web skipForList + effectiveDurationMs) ───────────────

    [Fact]
    public void Plan_animates_a_plain_list_to_list_navigation()
    {
        RouteTransitionPlan plan = Compute("/dashboard", "/drives");

        Assert.True(plan.Animate);
        Assert.Equal(120, plan.DurationMs);
        Assert.Equal(4.0, plan.OffsetY);
        Assert.False(plan.Reduced);
        Assert.False(plan.SkippedForList);
    }

    [Fact]
    public void Plan_skips_a_drill_into_a_detail_route()
    {
        // web: matchesSkip(newPath) — entering /drives/:id is instant.
        RouteTransitionPlan plan = Compute("/drives", "/drives/123");

        Assert.True(plan.SkippedForList);
        Assert.False(plan.Animate);
        Assert.Equal(0, plan.DurationMs);
        Assert.Equal(0.0, plan.OffsetY);
    }

    [Fact]
    public void Plan_skips_a_drill_back_out_of_a_detail_route()
    {
        // web: matchesSkip(prevPath) — leaving /drives/:id (POP back to the list) is instant too.
        RouteTransitionPlan plan = Compute("/drives/123", "/drives");

        Assert.True(plan.SkippedForList);
        Assert.False(plan.Animate);
    }

    [Fact]
    public void Plan_collapses_under_reduced_motion()
    {
        RouteTransitionPlan plan = RouteTransitionPlan.Compute(
            "/dashboard", "/settings", reduceMotion: true, 120, RouteTransitionRegistration.DefaultSkipPatterns, 4);

        Assert.True(plan.Reduced);
        Assert.False(plan.Animate);
        Assert.Equal(0, plan.DurationMs);
    }

    [Fact]
    public void Plan_does_not_animate_with_a_zero_or_negative_duration()
    {
        Assert.False(RouteTransitionPlan.Compute("/a", "/b", false, 0, RouteTransitionRegistration.DefaultSkipPatterns, 4).Animate);

        RouteTransitionPlan negative = RouteTransitionPlan.Compute("/a", "/b", false, -5, RouteTransitionRegistration.DefaultSkipPatterns, 4);
        Assert.False(negative.Animate);
        Assert.Equal(0, negative.DurationMs);
    }

    [Fact]
    public void Plan_clamps_a_negative_offset_to_zero()
    {
        RouteTransitionPlan plan = RouteTransitionPlan.Compute("/a", "/b", false, 120, RouteTransitionRegistration.DefaultSkipPatterns, -3);

        Assert.True(plan.Animate);
        Assert.Equal(0.0, plan.OffsetY);
    }

    [Fact]
    public void Plan_with_no_skip_patterns_always_animates()
    {
        RouteTransitionPlan plan = RouteTransitionPlan.Compute("/drives", "/drives/123", false, 120, Array.Empty<string>(), 4);

        Assert.False(plan.SkippedForList);
        Assert.True(plan.Animate);
    }

    [Theory]
    [InlineData("/dashboard", "/drives", false, 120, true, 120, false)]
    [InlineData("/drives", "/drives/9", false, 120, false, 0, true)]
    [InlineData("/drives/9", "/charging/3", false, 120, false, 0, true)]   // both endpoints are detail routes
    [InlineData("/dashboard", "/energy", true, 120, false, 0, false)]      // reduced motion
    [InlineData("/dashboard", "/energy", false, 0, false, 0, false)]       // zero duration
    public void Plan_snapshot_per_state(
        string prev, string next, bool reduce, int duration, bool expectedAnimate, int expectedDuration, bool expectedSkip)
    {
        RouteTransitionPlan plan = RouteTransitionPlan.Compute(prev, next, reduce, duration, RouteTransitionRegistration.DefaultSkipPatterns, 4);

        Assert.Equal(expectedAnimate, plan.Animate);
        Assert.Equal(expectedDuration, plan.DurationMs);
        Assert.Equal(expectedSkip, plan.SkippedForList);
    }

    [Fact]
    public void Plan_value_equality_makes_identical_states_equal()
    {
        RouteTransitionPlan a = Compute("/dashboard", "/drives");
        RouteTransitionPlan b = Compute("/dashboard", "/drives");
        RouteTransitionPlan different = Compute("/drives", "/drives/1");

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Plan_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => RouteTransitionPlan.Compute(null!, "/b", false, 120, RouteTransitionRegistration.DefaultSkipPatterns, 4));
        Assert.Throws<ArgumentNullException>(() => RouteTransitionPlan.Compute("/a", null!, false, 120, RouteTransitionRegistration.DefaultSkipPatterns, 4));
        Assert.Throws<ArgumentNullException>(() => RouteTransitionPlan.Compute("/a", "/b", false, 120, null!, 4));
    }

    // ── ViewModel: mount renders without a fade (web initial={false}) ─────────────────────────────────────

    [Fact]
    public void Start_does_not_fade_on_mount()
    {
        (RouteTransitionViewModel vm, FakeLocation _, FakeMotion _) = NewViewModel(initialPath: "/dashboard");
        var plans = new List<RouteTransitionPlan>();

        using (vm)
        {
            vm.TransitionRequested += (_, p) => plans.Add(p);
            vm.Start();

            Assert.Empty(plans);
            Assert.False(vm.HasNavigated);
            Assert.Equal("/dashboard", vm.CurrentPathKey);
            Assert.False(vm.CurrentPlan.Animate);
        }
    }

    // ── ViewModel: a real navigation fades (web AnimatePresence on a new pathname key) ────────────────────

    [Fact]
    public void First_navigation_requests_an_animated_transition()
    {
        (RouteTransitionViewModel vm, FakeLocation location, FakeMotion _) = NewViewModel(initialPath: "/dashboard");
        var plans = new List<RouteTransitionPlan>();

        using (vm)
        {
            vm.Start();
            vm.TransitionRequested += (_, p) => plans.Add(p);

            location.Navigate("/drives");

            RouteTransitionPlan plan = Assert.Single(plans);
            Assert.True(plan.Animate);
            Assert.Equal(120, plan.DurationMs);
            Assert.True(vm.HasNavigated);
            Assert.Equal("/drives", vm.CurrentPathKey);
            Assert.Equal(plan, vm.CurrentPlan);
        }
    }

    // ── ViewModel: list↔detail navigations are instant (web skipForList) ──────────────────────────────────

    [Fact]
    public void Drilling_into_a_detail_route_is_instant()
    {
        (RouteTransitionViewModel vm, FakeLocation location, FakeMotion _) = NewViewModel(initialPath: "/drives");
        var plans = new List<RouteTransitionPlan>();

        using (vm)
        {
            vm.Start();
            vm.TransitionRequested += (_, p) => plans.Add(p);

            location.Navigate("/drives/123");

            RouteTransitionPlan plan = Assert.Single(plans);
            Assert.True(plan.SkippedForList);
            Assert.False(plan.Animate);
        }
    }

    // ── ViewModel: pathname-only re-key (web "query/hash never re-fade") ──────────────────────────────────

    [Fact]
    public void A_change_that_keeps_the_pathname_does_not_re_fade()
    {
        (RouteTransitionViewModel vm, FakeLocation location, FakeMotion _) = NewViewModel(initialPath: "/drives");
        var plans = new List<RouteTransitionPlan>();

        using (vm)
        {
            vm.Start();
            vm.TransitionRequested += (_, p) => plans.Add(p);

            // The location seam exposes the pathname only; a query / search / hash change leaves it unchanged, so
            // re-raising Changed with the same path must not trigger a transition (web re-key by pathname only).
            location.Navigate("/drives");

            Assert.Empty(plans);
            Assert.False(vm.HasNavigated);
        }
    }

    // ── ViewModel: reduced motion ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Reduced_motion_makes_navigations_instant()
    {
        var location = new FakeLocation("/dashboard");
        var motion = new FakeMotion(reduceMotion: true);
        using var vm = new RouteTransitionViewModel(location, motion);
        var plans = new List<RouteTransitionPlan>();

        vm.Start();
        vm.TransitionRequested += (_, p) => plans.Add(p);
        location.Navigate("/drives");

        RouteTransitionPlan plan = Assert.Single(plans);
        Assert.True(plan.Reduced);
        Assert.False(plan.Animate);
    }

    [Fact]
    public void A_runtime_reduce_motion_toggle_affects_the_next_navigation_without_fading()
    {
        var location = new FakeLocation("/dashboard");
        var motion = new FakeMotion(reduceMotion: false);
        using var vm = new RouteTransitionViewModel(location, motion);
        var plans = new List<RouteTransitionPlan>();
        var changed = new List<string?>();
        vm.Start();
        vm.TransitionRequested += (_, p) => plans.Add(p);
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        location.Navigate("/drives");
        Assert.True(plans[^1].Animate);

        // Toggling reduce-motion mid-session must NOT fade on its own (web only re-evaluates on a route change).
        int beforeToggle = plans.Count;
        motion.Set(reduceMotion: true);
        Assert.Equal(beforeToggle, plans.Count);
        Assert.True(vm.ReduceMotion);
        Assert.Contains(nameof(RouteTransitionViewModel.ReduceMotion), changed);

        // The next navigation honours the new preference.
        location.Navigate("/energy");
        Assert.False(plans[^1].Animate);
        Assert.True(plans[^1].Reduced);
    }

    [Fact]
    public void A_no_op_reduce_motion_change_raises_nothing()
    {
        var location = new FakeLocation("/dashboard");
        var motion = new FakeMotion(reduceMotion: false);
        using var vm = new RouteTransitionViewModel(location, motion);
        var changes = 0;
        vm.Start();
        vm.PropertyChanged += (_, _) => changes++;

        motion.Set(reduceMotion: false);

        Assert.Equal(0, changes);
    }

    // ── ViewModel: a back-navigation out of a detail page is also skipped (prev-path match) ───────────────

    [Fact]
    public void Navigating_back_out_of_a_detail_route_is_instant()
    {
        (RouteTransitionViewModel vm, FakeLocation location, FakeMotion _) = NewViewModel(initialPath: "/drives");

        using (vm)
        {
            vm.Start();
            location.Navigate("/drives/55");   // drill in (skipped — new path is detail)
            location.Navigate("/drives");      // drill back out (skipped — prev path was detail)

            Assert.True(vm.CurrentPlan.SkippedForList);
            Assert.False(vm.CurrentPlan.Animate);
        }
    }

    // ── ViewModel: lifecycle ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Dispose_detaches_from_both_seams_and_stops_responding()
    {
        var location = new FakeLocation("/dashboard");
        var motion = new FakeMotion(reduceMotion: false);
        var vm = new RouteTransitionViewModel(location, motion);
        var plans = new List<RouteTransitionPlan>();
        vm.Start();
        vm.TransitionRequested += (_, p) => plans.Add(p);
        Assert.Equal(1, motion.ObserverCount);

        vm.Dispose();

        Assert.Equal(0, motion.ObserverCount);

        // A late navigation or motion change after disposal is ignored.
        location.Navigate("/drives");
        motion.Set(reduceMotion: true);
        Assert.Empty(plans);
    }

    [Fact]
    public void Start_is_idempotent()
    {
        var captured = new List<string>();
        (RouteTransitionViewModel vm, FakeLocation _, FakeMotion _) = NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            vm.Start();

            Assert.Equal("view.opened slug=RouteTransition", Assert.Single(captured));
        }
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var location = new FakeLocation();
        var motion = new FakeMotion(reduceMotion: false);

        Assert.Throws<ArgumentNullException>(() => new RouteTransitionViewModel(null!, motion));
        Assert.Throws<ArgumentNullException>(() => new RouteTransitionViewModel(location, null!));
    }

    [Fact]
    public void ViewModel_exposes_its_configuration()
    {
        var location = new FakeLocation("/dashboard");
        var motion = new FakeMotion(reduceMotion: false);
        var custom = new[] { "/foo/:id" };
        using var vm = new RouteTransitionViewModel(location, motion, durationMs: 200, skipPatterns: custom, offsetY: 8);

        Assert.Equal(200, vm.DurationMs);
        Assert.Equal(8.0, vm.OffsetY);
        Assert.Equal(custom, vm.SkipPatterns);
    }

    // ── diagnostics (P1/S11): slug-only counters, never the route path ────────────────────────────────────

    [Fact]
    public void Start_records_the_view_opened_event()
    {
        var captured = new List<string>();
        (RouteTransitionViewModel vm, FakeLocation _, FakeMotion _) = NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            Assert.Equal("view.opened slug=RouteTransition", Assert.Single(captured));
        }
    }

    [Fact]
    public void Animated_and_skipped_navigations_emit_their_operational_events()
    {
        var captured = new List<string>();
        (RouteTransitionViewModel vm, FakeLocation location, FakeMotion _) = NewViewModel(initialPath: "/dashboard", sink: captured);

        using (vm)
        {
            vm.Start();
            captured.Clear();

            location.Navigate("/drives");                 // animated
            Assert.Equal("route.transition slug=RouteTransition", Assert.Single(captured));

            captured.Clear();
            location.Navigate("/drives/9");               // skipped (list↔detail)
            Assert.Equal("route.skipped slug=RouteTransition", Assert.Single(captured));
        }
    }

    [Fact]
    public void Diagnostics_never_leak_the_route_path()
    {
        var captured = new List<string>();
        (RouteTransitionViewModel vm, FakeLocation location, FakeMotion _) = NewViewModel(initialPath: "/dashboard", sink: captured);

        using (vm)
        {
            vm.Start();
            location.Navigate("/charging/42");

            Assert.All(captured, line =>
            {
                Assert.DoesNotContain("charging", line, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("/charging/42", line, StringComparison.Ordinal);
                Assert.DoesNotContain("42", line, StringComparison.Ordinal);
            });
        }
    }

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new RouteTransitionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordAnimated();
        diagnostics.RecordSkipped();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Animated);
        Assert.Equal(1, diagnostics.Skipped);
        string[] expected =
        [
            "view.opened slug=RouteTransition",
            "route.transition slug=RouteTransition",
            "route.skipped slug=RouteTransition",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new RouteTransitionDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordAnimated();
        diagnostics.RecordAnimated();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(2, diagnostics.Animated);
        Assert.Equal(0, diagnostics.Skipped);
    }

    // ── helpers / test doubles ────────────────────────────────────────────────────────────────────────────

    private static RouteTransitionPlan Compute(string prev, string next) =>
        RouteTransitionPlan.Compute(prev, next, reduceMotion: false, RouteTransitionRegistration.DefaultDurationMs, RouteTransitionRegistration.DefaultSkipPatterns, RouteTransitionRegistration.DefaultOffsetY);

    private static (RouteTransitionViewModel Vm, FakeLocation Location, FakeMotion Motion) NewViewModel(
        string initialPath = "/",
        List<string>? sink = null)
    {
        var location = new FakeLocation(initialPath);
        var motion = new FakeMotion(reduceMotion: false);
        var diagnostics = sink is null ? null : new RouteTransitionDiagnostics(sink.Add);
        var vm = new RouteTransitionViewModel(location, motion, diagnostics: diagnostics);
        return (vm, location, motion);
    }

    private sealed class FakeLocation : IRouteLocationSource
    {
        public FakeLocation(string path = "/") => Path = path;

        public string Path { get; private set; }

        public event EventHandler? Changed;

        public void Navigate(string path)
        {
            Path = path;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class FakeMotion : IMotionPreferenceSource
    {
        private readonly List<Action<bool>> _observers = [];
        private bool _reduceMotion;

        public FakeMotion(bool reduceMotion) => _reduceMotion = reduceMotion;

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
            foreach (Action<bool> observer in _observers.ToArray())
            {
                observer(reduceMotion);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeMotion _owner;
            private readonly Action<bool> _observer;
            private bool _disposed;

            public Subscription(FakeMotion owner, Action<bool> observer)
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
