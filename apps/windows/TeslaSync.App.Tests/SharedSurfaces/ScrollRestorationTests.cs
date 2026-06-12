using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>ScrollRestoration</c> shared surface's UI-thread-free logic — the pure restore
/// projection (POP restores the saved offset or the top; PUSH / REPLACE always reset to the top), the in-memory
/// offset store (the <c>sessionStorage</c> analogue, including the non-finite guard), and the view-model's mount,
/// continuous capture, per-frame coalescing, outgoing flush, restore / reset, PII-safe diagnostics and argument
/// validation. Mirrors the web spec (web/src/components/layout/ScrollRestoration.tsx). The WinUI view itself (the
/// ScrollViewer adapter + composition-render frame scheduler) is exercised by the app build.
/// </summary>
public sealed class ScrollRestorationTests
{
    private static string KeyFor(string path, string search = "") =>
        ScrollRestorationRegistration.KeyFor(path, search);

    // ── Projection (the adapter): pure POP-restore / PUSH-reset decision ─────────────────────────────────

    [Fact]
    public void Resolve_on_pop_restores_the_saved_offset()
    {
        Assert.Equal(640d, ScrollRestorationProjection.Resolve(ScrollNavigationKind.Pop, 640d));
    }

    [Fact]
    public void Resolve_on_pop_with_no_saved_offset_returns_the_top()
    {
        Assert.Equal(0d, ScrollRestorationProjection.Resolve(ScrollNavigationKind.Pop, null));
    }

    [Fact]
    public void Resolve_on_push_always_returns_the_top_ignoring_any_saved_offset()
    {
        Assert.Equal(0d, ScrollRestorationProjection.Resolve(ScrollNavigationKind.Push, 900d));
    }

    [Fact]
    public void Resolve_on_replace_always_returns_the_top()
    {
        Assert.Equal(0d, ScrollRestorationProjection.Resolve(ScrollNavigationKind.Replace, 900d));
    }

    // ── Key shape matches the web sessionStorage key ─────────────────────────────────────────────────────

    [Fact]
    public void KeyFor_matches_the_web_session_storage_shape()
    {
        Assert.Equal("teslasync.scroll:", ScrollRestorationRegistration.StoragePrefix);
        Assert.Equal("teslasync.scroll:/drives?sort=desc", KeyFor("/drives", "?sort=desc"));
        Assert.Equal("teslasync.scroll:/", KeyFor("/"));
    }

    // ── Store (the adapter): round-trips, missing keys, non-finite guard ─────────────────────────────────

    [Fact]
    public void Store_read_of_an_unwritten_key_is_null()
    {
        var store = new InMemoryScrollOffsetStore();
        Assert.Null(store.Read(KeyFor("/never")));
    }

    [Fact]
    public void Store_write_then_read_round_trips_and_overwrites()
    {
        var store = new InMemoryScrollOffsetStore();
        string key = KeyFor("/drives");

        store.Write(key, 120d);
        Assert.Equal(120d, store.Read(key));
        Assert.True(store.Has(key));
        Assert.Equal(1, store.Count);

        store.Write(key, 350d);
        Assert.Equal(350d, store.Read(key));
        Assert.Equal(1, store.Count);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Store_drops_a_non_finite_offset(double bad)
    {
        var store = new InMemoryScrollOffsetStore();
        string key = KeyFor("/drives");

        store.Write(key, bad);

        Assert.False(store.Has(key));
        Assert.Null(store.Read(key));
    }

    [Fact]
    public void Store_clear_forgets_every_offset()
    {
        var store = new InMemoryScrollOffsetStore();
        store.Write(KeyFor("/a"), 1d);
        store.Write(KeyFor("/b"), 2d);

        store.Clear();

        Assert.Equal(0, store.Count);
        Assert.Null(store.Read(KeyFor("/a")));
    }

    // ── State: mount establishes the key and applies the initial top (PUSH) ──────────────────────────────

    [Fact]
    public void Start_establishes_the_current_key_and_applies_the_initial_top()
    {
        (ScrollRestorationViewModel vm, FakeLocation _, InMemoryScrollOffsetStore _, FakeSurface surface, ManualFrameScheduler _) =
            NewViewModel(path: "/dashboard");

        using (vm)
        {
            vm.Start();

            Assert.Equal(KeyFor("/dashboard"), vm.CurrentKey);
            Assert.Equal(0d, surface.LastScrolledTo);
        }
    }

    [Fact]
    public void Start_is_idempotent()
    {
        var captured = new List<string>();
        (ScrollRestorationViewModel vm, FakeLocation _, InMemoryScrollOffsetStore _, FakeSurface _, ManualFrameScheduler _) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            vm.Start();

            Assert.Equal("view.opened slug=ScrollRestoration", Assert.Single(captured));
        }
    }

    // ── State: POP restores the saved offset (or the top when none) ──────────────────────────────────────

    [Fact]
    public void A_back_or_forward_navigation_restores_the_saved_offset()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler _) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            store.Write(KeyFor("/drives"), 480d);

            location.Navigate("/drives", ScrollNavigationKind.Pop);

            Assert.Equal(480d, surface.LastScrolledTo);
        }
    }

    [Fact]
    public void A_back_or_forward_navigation_to_an_unseen_location_scrolls_to_the_top()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore _, FakeSurface surface, ManualFrameScheduler _) =
            NewViewModel();

        using (vm)
        {
            vm.Start();

            location.Navigate("/never-seen", ScrollNavigationKind.Pop);

            Assert.Equal(0d, surface.LastScrolledTo);
        }
    }

    // ── State: PUSH / REPLACE always reset to the top and never read the store ───────────────────────────

    [Fact]
    public void A_fresh_push_navigation_scrolls_to_the_top_even_with_a_saved_offset()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler _) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            store.Write(KeyFor("/drives"), 480d);

            location.Navigate("/drives", ScrollNavigationKind.Push);

            Assert.Equal(0d, surface.LastScrolledTo);
        }
    }

    [Fact]
    public void A_replace_navigation_scrolls_to_the_top()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler _) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            store.Write(KeyFor("/drives"), 480d);

            location.Navigate("/drives", ScrollNavigationKind.Replace);

            Assert.Equal(0d, surface.LastScrolledTo);
        }
    }

    // ── State: continuous capture persists the offset, throttled to one write per frame ──────────────────

    [Fact]
    public void Scrolling_persists_the_offset_under_the_current_key_on_the_next_frame()
    {
        (ScrollRestorationViewModel vm, FakeLocation _, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(path: "/drives");

        using (vm)
        {
            vm.Start();

            surface.RaiseScroll(220d);
            Assert.True(vm.HasPendingCapture);
            Assert.Null(store.Read(KeyFor("/drives")));

            frames.FireFrame();

            Assert.False(vm.HasPendingCapture);
            Assert.Equal(220d, store.Read(KeyFor("/drives")));
        }
    }

    [Fact]
    public void Rapid_scrolls_coalesce_to_a_single_capture_per_frame()
    {
        (ScrollRestorationViewModel vm, FakeLocation _, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(path: "/drives");

        using (vm)
        {
            vm.Start();

            surface.RaiseScroll(100d);
            surface.RaiseScroll(200d);
            surface.RaiseScroll(300d);
            Assert.Equal(1, frames.RequestCount);

            frames.FireFrame();
            Assert.Equal(300d, store.Read(KeyFor("/drives")));

            // After the frame fires a further scroll schedules a fresh capture.
            surface.RaiseScroll(360d);
            Assert.Equal(2, frames.RequestCount);
        }
    }

    // ── Flush: the outgoing position is saved under the OLD key on navigation ────────────────────────────

    [Fact]
    public void Navigating_flushes_the_outgoing_offset_under_the_previous_key()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(path: "/drives");

        using (vm)
        {
            vm.Start();
            surface.RaiseScroll(540d);
            frames.FireFrame();

            location.Navigate("/charging", ScrollNavigationKind.Push);

            Assert.Equal(540d, store.Read(KeyFor("/drives")));
        }
    }

    [Fact]
    public void A_pending_capture_is_flushed_and_cancelled_when_the_route_changes()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(path: "/drives");

        using (vm)
        {
            vm.Start();

            // Scroll, then navigate before the frame fires — the final flush must still capture the position.
            surface.RaiseScroll(610d);
            Assert.True(vm.HasPendingCapture);

            location.Navigate("/charging", ScrollNavigationKind.Push);

            Assert.Equal(610d, store.Read(KeyFor("/drives")));
            Assert.False(vm.HasPendingCapture);
            Assert.Equal(0, frames.ActiveCount);

            // The cancelled frame must not fire a stale capture against the new key.
            frames.FireFrame();
            Assert.Null(store.Read(KeyFor("/charging")));
        }
    }

    [Fact]
    public void The_outgoing_flush_runs_before_the_restore_so_a_saved_value_is_not_clobbered()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(path: "/drives");

        using (vm)
        {
            vm.Start();
            surface.RaiseScroll(700d);
            frames.FireFrame();

            // /charging was visited earlier and left at 250.
            store.Write(KeyFor("/charging"), 250d);

            location.Navigate("/charging", ScrollNavigationKind.Pop);

            Assert.Equal(250d, surface.LastScrolledTo);
            Assert.Equal(700d, store.Read(KeyFor("/drives")));
            Assert.Equal(250d, store.Read(KeyFor("/charging")));
        }
    }

    [Fact]
    public void Different_query_strings_on_the_same_path_restore_independently()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(path: "/drives", search: "?page=1");

        using (vm)
        {
            vm.Start();

            // Scroll page 1 to 300 so the capture saves it under the page-1 key.
            surface.RaiseScroll(300d);
            frames.FireFrame();

            // Page 2 was visited earlier and left at 80 (a different key, so it is not the current location).
            store.Write(KeyFor("/drives", "?page=2"), 80d);

            location.Navigate("/drives", ScrollNavigationKind.Pop, search: "?page=2");
            Assert.Equal(80d, surface.LastScrolledTo);

            location.Navigate("/drives", ScrollNavigationKind.Pop, search: "?page=1");
            Assert.Equal(300d, surface.LastScrolledTo);
        }
    }

    // ── Lifecycle: disposal flushes the final position and detaches from both seams ──────────────────────

    [Fact]
    public void Dispose_flushes_the_final_position_and_stops_responding()
    {
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore store, FakeSurface surface, ManualFrameScheduler _) =
            NewViewModel(path: "/drives");

        vm.Start();
        surface.RaiseScroll(615d);

        vm.Dispose();
        Assert.Equal(615d, store.Read(KeyFor("/drives")));
        Assert.False(vm.HasPendingCapture);

        // After disposal a further navigation is ignored and nothing more is applied.
        int scrolls = surface.ScrolledTo.Count;
        location.Navigate("/charging", ScrollNavigationKind.Pop);
        Assert.Equal(scrolls, surface.ScrolledTo.Count);
    }

    // ── Diagnostics (P1/S11): slug-only counters, never the path / search / key ──────────────────────────

    [Fact]
    public void Start_records_the_view_opened_event()
    {
        var captured = new List<string>();
        (ScrollRestorationViewModel vm, FakeLocation _, InMemoryScrollOffsetStore _, FakeSurface _, ManualFrameScheduler _) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            Assert.Equal("view.opened slug=ScrollRestoration", Assert.Single(captured));
        }
    }

    [Fact]
    public void A_pop_navigation_emits_restored_and_a_push_emits_reset()
    {
        var captured = new List<string>();
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore _, FakeSurface _, ManualFrameScheduler _) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            captured.Clear();

            location.Navigate("/drives", ScrollNavigationKind.Pop);
            Assert.Equal("scroll.restored slug=ScrollRestoration", Assert.Single(captured));

            captured.Clear();
            location.Navigate("/charging", ScrollNavigationKind.Push);
            Assert.Equal("scroll.reset slug=ScrollRestoration", Assert.Single(captured));
        }
    }

    [Fact]
    public void Diagnostics_never_leak_the_path_search_or_storage_key()
    {
        var captured = new List<string>();
        (ScrollRestorationViewModel vm, FakeLocation location, InMemoryScrollOffsetStore _, FakeSurface surface, ManualFrameScheduler frames) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            surface.RaiseScroll(120d);
            frames.FireFrame();
            location.Navigate("/charging/42", ScrollNavigationKind.Pop, search: "?vin=5YJ3E1EA");

            Assert.All(captured, line =>
            {
                Assert.DoesNotContain("charging", line, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("42", line, StringComparison.Ordinal);
                Assert.DoesNotContain("vin", line, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("5YJ3E1EA", line, StringComparison.Ordinal);
                Assert.DoesNotContain("teslasync.scroll", line, StringComparison.Ordinal);
            });
        }
    }

    [Fact]
    public void Diagnostics_count_each_event_and_capture_emits_no_line()
    {
        var captured = new List<string>();
        var diagnostics = new ScrollRestorationDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordRestored();
        diagnostics.RecordReset();
        diagnostics.RecordCaptured();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Restored);
        Assert.Equal(1, diagnostics.Reset);
        Assert.Equal(1, diagnostics.Captured);

        // The high-frequency per-frame capture is a counter only — it must not flood the sink.
        string[] expected =
        [
            "view.opened slug=ScrollRestoration",
            "scroll.restored slug=ScrollRestoration",
            "scroll.reset slug=ScrollRestoration",
        ];
        Assert.Equal(expected, captured);
    }

    // ── Accessibility: the surface renders nothing, so it needs no Narrator label ────────────────────────

    [Fact]
    public void The_surface_declares_no_visible_or_interactive_content()
    {
        // web `return null`: an invisible coordinator. The a11y contract is the deliberate ABSENCE of any node
        // that would need a label; the WinUI view honours it with AccessibilityView.Raw and IsTabStop=false.
        Assert.False(ScrollRestorationRegistration.RendersVisibleContent);
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("ScrollRestoration", ScrollRestorationRegistration.Slug);
        Assert.Equal("ScrollRestoration", ScrollRestorationViewModel.Slug);
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var location = new FakeLocation();
        var store = new InMemoryScrollOffsetStore();
        var surface = new FakeSurface();
        var frames = new ManualFrameScheduler();

        Assert.Throws<ArgumentNullException>(() => new ScrollRestorationViewModel(null!, store, surface, frames));
        Assert.Throws<ArgumentNullException>(() => new ScrollRestorationViewModel(location, null!, surface, frames));
        Assert.Throws<ArgumentNullException>(() => new ScrollRestorationViewModel(location, store, null!, frames));
        Assert.Throws<ArgumentNullException>(() => new ScrollRestorationViewModel(location, store, surface, null!));
    }

    [Fact]
    public void Store_and_key_reject_null_arguments()
    {
        var store = new InMemoryScrollOffsetStore();

        Assert.Throws<ArgumentNullException>(() => store.Read(null!));
        Assert.Throws<ArgumentNullException>(() => store.Write(null!, 0d));
        Assert.Throws<ArgumentNullException>(() => store.Has(null!));
        Assert.Throws<ArgumentNullException>(() => ScrollRestorationRegistration.KeyFor(null!, ""));
        Assert.Throws<ArgumentNullException>(() => ScrollRestorationRegistration.KeyFor("/", null!));
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static (ScrollRestorationViewModel Vm, FakeLocation Location, InMemoryScrollOffsetStore Store, FakeSurface Surface, ManualFrameScheduler Frames) NewViewModel(
        string path = "/",
        string search = "",
        ScrollNavigationKind kind = ScrollNavigationKind.Push,
        List<string>? sink = null)
    {
        var location = new FakeLocation(path, search, kind);
        var store = new InMemoryScrollOffsetStore();
        var surface = new FakeSurface();
        var frames = new ManualFrameScheduler();
        var diagnostics = sink is null ? null : new ScrollRestorationDiagnostics(sink.Add);
        var vm = new ScrollRestorationViewModel(location, store, surface, frames, diagnostics);
        return (vm, location, store, surface, frames);
    }

    private sealed class FakeLocation : IScrollRestorationLocationSource
    {
        public FakeLocation(string path = "/", string search = "", ScrollNavigationKind kind = ScrollNavigationKind.Push)
        {
            Path = path;
            Search = search;
            NavigationKind = kind;
        }

        public string Path { get; private set; }

        public string Search { get; private set; }

        public ScrollNavigationKind NavigationKind { get; private set; }

        public event EventHandler? Changed;

        public void Navigate(string path, ScrollNavigationKind kind, string search = "")
        {
            Path = path;
            Search = search;
            NavigationKind = kind;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class FakeSurface : IScrollSurface
    {
        public List<double> ScrolledTo { get; } = [];

        public double Offset { get; private set; }

        public double LastScrolledTo => ScrolledTo[^1];

        public event EventHandler? Scrolled;

        public void ScrollTo(double offset)
        {
            Offset = offset;
            ScrolledTo.Add(offset);
        }

        public void RaiseScroll(double to)
        {
            Offset = to;
            Scrolled?.Invoke(this, EventArgs.Empty);
        }
    }

    private sealed class ManualFrameScheduler : IFrameScheduler
    {
        private readonly List<ScheduledFrame> _frames = [];

        public int RequestCount { get; private set; }

        public int ActiveCount => _frames.Count(frame => frame is { Cancelled: false, Fired: false });

        public IDisposable RequestFrame(Action callback)
        {
            RequestCount++;
            var frame = new ScheduledFrame(callback);
            _frames.Add(frame);
            return frame;
        }

        public void FireFrame()
        {
            foreach (ScheduledFrame frame in _frames.ToList())
            {
                if (frame is { Cancelled: false, Fired: false })
                {
                    frame.Fired = true;
                    frame.Callback();
                }
            }
        }

        private sealed class ScheduledFrame(Action callback) : IDisposable
        {
            public Action Callback { get; } = callback;

            public bool Cancelled { get; private set; }

            public bool Fired { get; set; }

            public void Dispose() => Cancelled = true;
        }
    }
}
