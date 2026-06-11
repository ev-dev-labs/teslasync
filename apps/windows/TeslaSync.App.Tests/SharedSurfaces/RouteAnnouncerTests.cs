using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>RouteAnnouncer</c> shared surface's UI-thread-free logic — the pure
/// zero-width-space rotation projection, the view-model's first-paint suppression, deferred title read,
/// debouncing of rapid navigations, region clearing on a title-less destination, the PII-safe diagnostics and the
/// argument validation. Mirrors the web spec (web/src/components/a11y/RouteAnnouncer.tsx + its
/// __tests__/RouteAnnouncer.test.tsx). The WinUI view itself (the live region + dispatcher timer) is exercised by
/// the app build.
/// </summary>
public sealed class RouteAnnouncerTests
{
    private const string Dashboard = "Dashboard \u2014 TeslaSync";
    private const string Drives = "Drives \u2014 TeslaSync";
    private const string Charging = "Charging Session \u2014 TeslaSync";
    private static readonly TimeSpan Past = TimeSpan.FromMilliseconds(150);

    private static string Strip(string value) =>
        value.Replace("\u200B", string.Empty, StringComparison.Ordinal);

    // ── Projection (the adapter): pure zero-width-space rotation ─────────────────────────────────────────

    [Fact]
    public void Next_with_an_empty_title_clears_the_region_and_keeps_the_counter()
    {
        AnnouncementStep step = RouteAnnouncerProjection.Next(string.Empty, 2);

        Assert.Equal(string.Empty, step.Message);
        Assert.True(step.IsCleared);
        Assert.Equal(2, step.Counter);
    }

    [Fact]
    public void Next_with_a_null_title_clears_the_region()
    {
        AnnouncementStep step = RouteAnnouncerProjection.Next(null, 0);

        Assert.True(step.IsCleared);
        Assert.Equal(0, step.Counter);
    }

    [Fact]
    public void Next_appends_the_rotated_padding_and_advances_the_counter()
    {
        AnnouncementStep first = RouteAnnouncerProjection.Next("Title", 0);
        Assert.Equal(1, first.Counter);
        Assert.Equal("Title", Strip(first.Message));
        Assert.Equal("Title\u200B", first.Message);
        Assert.False(first.IsCleared);

        AnnouncementStep wrap = RouteAnnouncerProjection.Next("Title", 3);
        Assert.Equal(0, wrap.Counter);
        Assert.Equal("Title", wrap.Message);
    }

    // ── State: first paint renders an empty region (web "no announce on first render") ───────────────────

    [Fact]
    public void Start_does_not_announce_on_first_paint()
    {
        (RouteAnnouncerViewModel vm, FakeLocation _, FakeTitle _, ManualScheduler scheduler) =
            NewViewModel(initialTitle: Dashboard);

        using (vm)
        {
            vm.Start();
            scheduler.Advance(TimeSpan.FromMilliseconds(500));

            Assert.Equal(string.Empty, vm.Message);
            Assert.Equal(0, scheduler.ScheduleCount);
        }
    }

    // ── State: announcing — title read is deferred, then spoken ──────────────────────────────────────────

    [Fact]
    public void Announces_the_page_title_after_a_navigation_deferring_the_read()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            title.Title = Drives;
            location.Navigate("/b");

            // Pre-timeout the region is still empty — the read is deferred so the destination page's title effect
            // has time to run first.
            Assert.Equal(string.Empty, vm.Message);

            scheduler.Advance(Past);

            Assert.Equal(Drives, Strip(vm.Message));
        }
    }

    [Fact]
    public void Honours_a_custom_delay()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel(delay: TimeSpan.FromMilliseconds(500));

        using (vm)
        {
            vm.Start();
            title.Title = Drives;
            location.Navigate("/b");

            scheduler.Advance(TimeSpan.FromMilliseconds(200));
            Assert.Equal(string.Empty, vm.Message);

            scheduler.Advance(TimeSpan.FromMilliseconds(400));
            Assert.Equal(Drives, Strip(vm.Message));
        }
    }

    // ── State: re-announce two consecutive routes that share a title (zero-width-space rotation) ─────────

    [Fact]
    public void Reannounces_when_two_consecutive_routes_share_the_same_title()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            title.Title = Charging;

            location.Navigate("/charging/1");
            scheduler.Advance(Past);
            string firstAnnouncement = vm.Message;
            Assert.Equal(Charging, Strip(firstAnnouncement));

            location.Navigate("/charging/2");
            scheduler.Advance(Past);
            string secondAnnouncement = vm.Message;
            Assert.Equal(Charging, Strip(secondAnnouncement));

            // The literal text must differ so the screen reader re-reads it.
            Assert.NotEqual(firstAnnouncement, secondAnnouncement);
        }
    }

    // ── State: clear the region when the destination has no title ────────────────────────────────────────

    [Fact]
    public void Clears_the_region_when_the_destination_has_no_title()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            title.Title = Drives;
            location.Navigate("/b");
            scheduler.Advance(Past);
            Assert.Equal(Drives, Strip(vm.Message));

            title.Title = string.Empty;
            location.Navigate("/c");
            scheduler.Advance(Past);
            Assert.Equal(string.Empty, vm.Message);
        }
    }

    // ── Debounce: a second navigation cancels the pending announcement ──────────────────────────────────

    [Fact]
    public void Cancels_a_pending_announcement_when_the_route_changes_again()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();

            title.Title = Drives;
            location.Navigate("/b");
            Assert.True(vm.HasPendingAnnouncement);

            title.Title = Charging;
            location.Navigate("/charging/1");

            scheduler.Advance(Past);

            // Only the FINAL destination is announced; the intermediate timer was cancelled.
            Assert.Equal(Charging, Strip(vm.Message));
            Assert.Equal(2, scheduler.ScheduleCount);
            Assert.Equal(0, scheduler.ActiveCount);
        }
    }

    // ── Counter: rotates 1 → 2 → 3 → 0 → 1 and never advances on a cleared region ───────────────────────

    [Fact]
    public void The_padding_counter_cycles_through_the_full_range()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            title.Title = "Page";

            int[] observed = new int[5];
            for (int i = 0; i < observed.Length; i++)
            {
                location.Navigate($"/r{i}");
                scheduler.Advance(Past);
                observed[i] = vm.PaddingCounter;
            }

            Assert.Equal(new[] { 1, 2, 3, 0, 1 }, observed);
        }
    }

    [Fact]
    public void A_cleared_region_does_not_advance_the_padding_counter()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();

            title.Title = "Page";
            location.Navigate("/a");
            scheduler.Advance(Past);
            Assert.Equal(1, vm.PaddingCounter);

            title.Title = string.Empty;
            location.Navigate("/b");
            scheduler.Advance(Past);
            Assert.Equal(1, vm.PaddingCounter);

            title.Title = "Page";
            location.Navigate("/c");
            scheduler.Advance(Past);
            Assert.Equal(2, vm.PaddingCounter);
        }
    }

    // ── Accessibility: the polite live region carries the page title to assistive tech ──────────────────

    [Fact]
    public void The_announced_content_exposes_the_page_title_to_assistive_technology()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        using (vm)
        {
            vm.Start();
            title.Title = Drives;
            location.Navigate("/b");
            scheduler.Advance(Past);

            Assert.Equal(Drives, Strip(vm.Message));
        }

        Assert.Equal("polite", RouteAnnouncerRegistration.Priority);
    }

    // ── Diagnostics (P1/S11): slug-only counters, never the title or path ───────────────────────────────

    [Fact]
    public void Start_records_the_view_opened_event()
    {
        var captured = new List<string>();
        (RouteAnnouncerViewModel vm, FakeLocation _, FakeTitle _, ManualScheduler _) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            Assert.Equal("view.opened slug=RouteAnnouncer", Assert.Single(captured));
        }
    }

    [Fact]
    public void Announcing_and_clearing_emit_their_operational_events()
    {
        var captured = new List<string>();
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            captured.Clear();

            title.Title = Drives;
            location.Navigate("/b");
            scheduler.Advance(Past);
            Assert.Equal("route.announced slug=RouteAnnouncer", Assert.Single(captured));

            captured.Clear();
            title.Title = string.Empty;
            location.Navigate("/c");
            scheduler.Advance(Past);
            Assert.Equal("route.cleared slug=RouteAnnouncer", Assert.Single(captured));
        }
    }

    [Fact]
    public void Diagnostics_never_leak_the_title_or_the_route_path()
    {
        var captured = new List<string>();
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            title.Title = Charging;
            location.Navigate("/charging/42");
            scheduler.Advance(Past);

            Assert.All(captured, line =>
            {
                Assert.DoesNotContain("Charging", line, StringComparison.Ordinal);
                Assert.DoesNotContain("/charging/42", line, StringComparison.Ordinal);
            });
        }
    }

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new RouteAnnouncerDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordAnnounced();
        diagnostics.RecordCleared();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Announced);
        Assert.Equal(1, diagnostics.Cleared);
        string[] expected =
        [
            "view.opened slug=RouteAnnouncer",
            "route.announced slug=RouteAnnouncer",
            "route.cleared slug=RouteAnnouncer",
        ];
        Assert.Equal(expected, captured);
    }

    // ── Lifecycle: disposal cancels the pending read and detaches from the location seam ────────────────

    [Fact]
    public void Dispose_cancels_a_pending_announcement_and_stops_responding()
    {
        (RouteAnnouncerViewModel vm, FakeLocation location, FakeTitle title, ManualScheduler scheduler) =
            NewViewModel();

        vm.Start();
        title.Title = Drives;
        location.Navigate("/b");
        Assert.True(vm.HasPendingAnnouncement);

        vm.Dispose();
        Assert.False(vm.HasPendingAnnouncement);

        // After disposal a further navigation is ignored and nothing is ever announced.
        title.Title = Charging;
        location.Navigate("/charging/1");
        scheduler.Advance(Past);
        Assert.Equal(string.Empty, vm.Message);
    }

    [Fact]
    public void Start_is_idempotent()
    {
        var captured = new List<string>();
        (RouteAnnouncerViewModel vm, FakeLocation _, FakeTitle _, ManualScheduler _) =
            NewViewModel(sink: captured);

        using (vm)
        {
            vm.Start();
            vm.Start();

            Assert.Equal("view.opened slug=RouteAnnouncer", Assert.Single(captured));
        }
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("RouteAnnouncer", RouteAnnouncerRegistration.Slug);
        Assert.Equal("RouteAnnouncer", RouteAnnouncerViewModel.Slug);
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var location = new FakeLocation();
        var title = new FakeTitle();
        var scheduler = new ManualScheduler();

        Assert.Throws<ArgumentNullException>(() => new RouteAnnouncerViewModel(null!, title, scheduler));
        Assert.Throws<ArgumentNullException>(() => new RouteAnnouncerViewModel(location, null!, scheduler));
        Assert.Throws<ArgumentNullException>(() => new RouteAnnouncerViewModel(location, title, null!));
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static (RouteAnnouncerViewModel Vm, FakeLocation Location, FakeTitle Title, ManualScheduler Scheduler) NewViewModel(
        string initialTitle = "",
        TimeSpan? delay = null,
        List<string>? sink = null)
    {
        var location = new FakeLocation();
        var title = new FakeTitle(initialTitle);
        var scheduler = new ManualScheduler();
        var diagnostics = sink is null ? null : new RouteAnnouncerDiagnostics(sink.Add);
        var vm = new RouteAnnouncerViewModel(location, title, scheduler, diagnostics, delay);
        return (vm, location, title, scheduler);
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

    private sealed class FakeTitle : IPageTitleSource
    {
        public FakeTitle(string title = "") => Title = title;

        public string Title { get; set; }
    }

    private sealed class ManualScheduler : IAnnounceScheduler
    {
        private readonly List<ScheduledItem> _items = [];

        public int ScheduleCount { get; private set; }

        public int ActiveCount => _items.Count(item => item is { Cancelled: false, Fired: false });

        public IDisposable Schedule(TimeSpan delay, Action callback)
        {
            ScheduleCount++;
            var item = new ScheduledItem(delay, callback);
            _items.Add(item);
            return item;
        }

        public void Advance(TimeSpan by)
        {
            foreach (ScheduledItem item in _items.ToList())
            {
                if (item is { Cancelled: false, Fired: false })
                {
                    item.Remaining -= by;
                    if (item.Remaining <= TimeSpan.Zero)
                    {
                        item.Fired = true;
                        item.Callback();
                    }
                }
            }
        }

        private sealed class ScheduledItem : IDisposable
        {
            public ScheduledItem(TimeSpan delay, Action callback)
            {
                Remaining = delay;
                Callback = callback;
            }

            public TimeSpan Remaining { get; set; }

            public Action Callback { get; }

            public bool Cancelled { get; private set; }

            public bool Fired { get; set; }

            public void Dispose() => Cancelled = true;
        }
    }
}
