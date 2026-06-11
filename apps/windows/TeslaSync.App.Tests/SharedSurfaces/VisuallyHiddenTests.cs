using TeslaSync.App.SharedSurfaces.VisuallyHiddenSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the VisuallyHidden announcer surface's UI-thread-free logic — the
/// <c>useAnnouncer</c> pub/sub port (<see cref="Announcer"/>), the rotating zero-width-space de-duplication
/// (<see cref="AnnouncerMessage"/>), the ARIA live-region semantics (<see cref="LiveRegionSemantics"/>), the
/// state holder that routes announcements by priority (<see cref="AnnouncerRegionViewModel"/>), the inert
/// fallback (<see cref="NoOpAnnouncer"/>), the registration slug and the PII-safe diagnostics. Mirrors the
/// web spec one-for-one (web/src/components/a11y/VisuallyHidden.tsx, web/src/components/a11y/AnnouncerRegion.tsx,
/// web/src/hooks/useAnnouncer.ts + web/src/hooks/__tests__/useAnnouncer.test.ts). The WinUI view
/// (VisuallyHidden.cs, which composes the atomic TsAnnouncerRegion) is exercised by the app build.
/// </summary>
public sealed class VisuallyHiddenTests
{
    private const char Zws = '\u200B';

    // ── registration (diagnostics slug, web anonymous component) ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("VisuallyHidden", VisuallyHiddenRegistration.Slug);

    // ── adapter: LiveRegionSemantics (web liveProps object) ──────────────────────────────────────────────

    [Fact]
    public void Semantics_for_non_live_region_are_inert()
    {
        LiveRegionSemantics semantics = LiveRegionSemantics.For(liveRegion: false, AnnouncerPriority.Polite);

        Assert.Null(semantics.Role);
        Assert.Null(semantics.Live);
        Assert.False(semantics.Atomic);
    }

    [Fact]
    public void Semantics_for_polite_live_region_are_status_polite_atomic()
    {
        LiveRegionSemantics semantics = LiveRegionSemantics.For(liveRegion: true, AnnouncerPriority.Polite);

        // web: role="status" aria-live="polite" aria-atomic="true".
        Assert.Equal("status", semantics.Role);
        Assert.Equal("polite", semantics.Live);
        Assert.True(semantics.Atomic);
    }

    [Fact]
    public void Semantics_for_assertive_live_region_are_alert_assertive_atomic()
    {
        LiveRegionSemantics semantics = LiveRegionSemantics.For(liveRegion: true, AnnouncerPriority.Assertive);

        // web: role="alert" aria-live="assertive" aria-atomic="true".
        Assert.Equal("alert", semantics.Role);
        Assert.Equal("assertive", semantics.Live);
        Assert.True(semantics.Atomic);
    }

    // ── adapter: AnnouncerMessage.Pad (web rotating zero-width-space suffix, mod 4) ───────────────────────

    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 3)]
    [InlineData(4, 0)]
    [InlineData(5, 1)]
    [InlineData(8, 0)]
    public void Pad_appends_mod_four_zero_width_spaces(int counter, int expectedSuffixLength)
    {
        string padded = AnnouncerMessage.Pad("msg", counter);

        Assert.StartsWith("msg", padded, System.StringComparison.Ordinal);
        Assert.Equal(expectedSuffixLength, padded.Length - "msg".Length);
        Assert.All(padded.AsSpan("msg".Length).ToArray(), c => Assert.Equal(Zws, c));
    }

    [Fact]
    public void Pad_normalises_negative_counters_into_the_zero_to_three_range()
    {
        // -1 % 4 == -1 in C#; the helper normalises so the suffix length is always 0..3 (here 3).
        string padded = AnnouncerMessage.Pad("msg", -1);

        Assert.Equal(3, padded.Length - "msg".Length);
    }

    // ── Announcer: pub/sub parity with the web useAnnouncer module ───────────────────────────────────────

    [Fact]
    public void Announce_delivers_to_subscribed_listeners()
    {
        var announcer = new Announcer();
        var received = new List<(string Message, AnnouncerPriority Priority)>();
        using IDisposable _ = announcer.Subscribe((m, p) => received.Add((m, p)));

        announcer.Announce("hello");

        (string Message, AnnouncerPriority Priority) call = Assert.Single(received);
        Assert.StartsWith("hello", call.Message, System.StringComparison.Ordinal);
        Assert.Equal(AnnouncerPriority.Polite, call.Priority);
    }

    [Fact]
    public void Announce_defaults_to_polite()
    {
        var announcer = new Announcer();
        AnnouncerPriority? seen = null;
        using IDisposable _ = announcer.Subscribe((_, p) => seen = p);

        announcer.Announce("default-priority");

        Assert.Equal(AnnouncerPriority.Polite, seen);
    }

    [Fact]
    public void Announce_routes_the_priority_argument_through_to_listeners()
    {
        var announcer = new Announcer();
        AnnouncerPriority? seen = null;
        using IDisposable _ = announcer.Subscribe((_, p) => seen = p);

        announcer.Announce("error!", AnnouncerPriority.Assertive);

        Assert.Equal(AnnouncerPriority.Assertive, seen);
    }

    [Fact]
    public void Announce_skips_empty_messages()
    {
        var announcer = new Announcer();
        int calls = 0;
        using IDisposable _ = announcer.Subscribe((_, _) => calls++);

        announcer.Announce(string.Empty);

        Assert.Equal(0, calls);
    }

    [Fact]
    public void Announce_appends_a_rotating_suffix_so_duplicates_re_fire()
    {
        var announcer = new Announcer();
        var messages = new List<string>();
        using IDisposable _ = announcer.Subscribe((m, _) => messages.Add(m));

        announcer.Announce("same");
        announcer.Announce("same");
        announcer.Announce("same");

        Assert.Equal(3, messages.Count);
        Assert.NotEqual(messages[0], messages[1]);
        Assert.NotEqual(messages[1], messages[2]);
        Assert.All(messages, m => Assert.StartsWith("same", m, System.StringComparison.Ordinal));
    }

    [Fact]
    public void Dispose_of_subscription_stops_further_deliveries()
    {
        var announcer = new Announcer();
        int calls = 0;
        IDisposable subscription = announcer.Subscribe((_, _) => calls++);

        announcer.Announce("first");
        Assert.Equal(1, calls);

        subscription.Dispose();
        announcer.Announce("second");

        Assert.Equal(1, calls);
    }

    [Fact]
    public void Announce_supports_multiple_concurrent_listeners()
    {
        var announcer = new Announcer();
        int a = 0;
        int b = 0;
        using IDisposable subA = announcer.Subscribe((_, _) => a++);
        using IDisposable subB = announcer.Subscribe((_, _) => b++);

        announcer.Announce("broadcast");

        Assert.Equal(1, a);
        Assert.Equal(1, b);
    }

    [Fact]
    public void Listener_count_reflects_the_live_subscriber_set()
    {
        var announcer = new Announcer();
        Assert.Equal(0, announcer.ListenerCount);

        IDisposable subscription = announcer.Subscribe((_, _) => { });
        Assert.Equal(1, announcer.ListenerCount);

        subscription.Dispose();
        Assert.Equal(0, announcer.ListenerCount);
    }

    [Fact]
    public void Announce_with_no_subscribers_does_not_throw()
    {
        var announcer = new Announcer();

        Exception? error = Record.Exception(() => announcer.Announce("drop me"));

        Assert.Null(error);
    }

    [Fact]
    public void Shared_announcer_is_a_stable_singleton() =>
        Assert.Same(Announcer.Shared, Announcer.Shared);

    // ── AnnouncerRegionViewModel: per-state routing (web AnnouncerRegion two regions) ─────────────────────

    [Fact]
    public void ViewModel_starts_empty()
    {
        using var viewModel = new AnnouncerRegionViewModel(new Announcer());

        Assert.Equal(string.Empty, viewModel.PoliteMessage);
        Assert.Equal(string.Empty, viewModel.AssertiveMessage);
    }

    [Fact]
    public void ViewModel_routes_polite_announcement_to_polite_message_only()
    {
        var announcer = new Announcer();
        using var viewModel = new AnnouncerRegionViewModel(announcer);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        announcer.Announce("filter applied");

        Assert.StartsWith("filter applied", viewModel.PoliteMessage, System.StringComparison.Ordinal);
        Assert.Equal(string.Empty, viewModel.AssertiveMessage);
        Assert.Contains(nameof(AnnouncerRegionViewModel.PoliteMessage), changed);
        Assert.DoesNotContain(nameof(AnnouncerRegionViewModel.AssertiveMessage), changed);
    }

    [Fact]
    public void ViewModel_routes_assertive_announcement_to_assertive_message_only()
    {
        var announcer = new Announcer();
        using var viewModel = new AnnouncerRegionViewModel(announcer);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        announcer.Announce("session expiring", AnnouncerPriority.Assertive);

        Assert.StartsWith("session expiring", viewModel.AssertiveMessage, System.StringComparison.Ordinal);
        Assert.Equal(string.Empty, viewModel.PoliteMessage);
        Assert.Contains(nameof(AnnouncerRegionViewModel.AssertiveMessage), changed);
        Assert.DoesNotContain(nameof(AnnouncerRegionViewModel.PoliteMessage), changed);
    }

    [Fact]
    public void ViewModel_raises_change_for_each_duplicate_announcement()
    {
        var announcer = new Announcer();
        using var viewModel = new AnnouncerRegionViewModel(announcer);
        int politeChanges = 0;
        viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(AnnouncerRegionViewModel.PoliteMessage))
            {
                politeChanges++;
            }
        };

        announcer.Announce("saved");
        announcer.Announce("saved");

        // web re-renders on every announce because the zero-width-space suffix differs; the holder mirrors
        // that so the assistive technology re-voices the duplicate.
        Assert.Equal(2, politeChanges);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_announcer()
    {
        var announcer = new Announcer();
        var viewModel = new AnnouncerRegionViewModel(announcer);
        viewModel.Dispose();

        announcer.Announce("after dispose");

        Assert.Equal(string.Empty, viewModel.PoliteMessage);
        Assert.Equal(0, announcer.ListenerCount);
    }

    // ── accessibility: the announced text is the live region's accessible name + aria-live urgency ────────

    [Fact]
    public void Announced_message_becomes_the_live_region_accessible_name_with_polite_urgency()
    {
        var announcer = new Announcer();
        using var viewModel = new AnnouncerRegionViewModel(announcer);

        announcer.Announce("3 vehicles archived");

        // The view sets the polite region's automation Name to PoliteMessage (see VisuallyHidden.cs /
        // TsAnnouncerRegion.Announce), so the holder's text IS the accessible name Narrator reads, and the
        // region carries the polite aria-live urgency.
        Assert.StartsWith("3 vehicles archived", viewModel.PoliteMessage, System.StringComparison.Ordinal);
        Assert.Equal("polite", LiveRegionSemantics.For(liveRegion: true, AnnouncerPriority.Polite).Live);
    }

    // ── NoOpAnnouncer: inert fallback (web call-before-mount drop) ────────────────────────────────────────

    [Fact]
    public void NoOp_announcer_is_inert()
    {
        IAnnouncer announcer = NoOpAnnouncer.Instance;
        using var viewModel = new AnnouncerRegionViewModel(announcer);

        announcer.Announce("ignored", AnnouncerPriority.Assertive);

        Assert.Equal(string.Empty, viewModel.PoliteMessage);
        Assert.Equal(string.Empty, viewModel.AssertiveMessage);
    }

    [Fact]
    public void NoOp_announcer_is_a_shared_singleton() =>
        Assert.Same(NoOpAnnouncer.Instance, NoOpAnnouncer.Instance);

    // ── diagnostics (view.opened, PII-safe — never the announced text) ───────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VisuallyHiddenDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VisuallyHidden", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new VisuallyHiddenDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
