using System.ComponentModel;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the announcer surface's UI-thread-free logic — the announcement padding/dedup,
/// the shared bus (empty-skip / fan-out / subscribe-unsubscribe / reset), the state-holder's polite/assertive
/// routing and projection, and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/a11y/AnnouncerRegion.tsx + web/src/hooks/useAnnouncer.ts). The WinUI part
/// (<c>AnnouncerRegion</c> in shared-surfaces/AnnouncerRegion.cs, which composes two TsAnnouncerRegion live
/// regions and marshals fan-outs onto the dispatcher) is exercised by the app build.
/// </summary>
public sealed class AnnouncerRegionTests
{
    private const char Zwsp = AnnouncerText.ZeroWidthSpace;

    // ── padding / dedup (web announce(): '\u200B'.repeat(announceCounter % 4)) ────────────────────────────

    [Fact]
    public void Pad_appends_nothing_when_counter_is_a_multiple_of_four()
    {
        Assert.Equal("Saved", AnnouncerText.Pad("Saved", 0));
        Assert.Equal("Saved", AnnouncerText.Pad("Saved", 4));
        Assert.Equal("Saved", AnnouncerText.Pad("Saved", 8));
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 3)]
    [InlineData(4, 0)]
    [InlineData(5, 1)]
    [InlineData(6, 2)]
    [InlineData(7, 3)]
    [InlineData(8, 0)]
    public void Pad_rotates_a_zero_width_space_run_of_counter_mod_four(int counter, int expectedRun)
    {
        var padded = AnnouncerText.Pad("Filter applied", counter);

        Assert.StartsWith("Filter applied", padded, StringComparison.Ordinal);
        Assert.Equal(expectedRun, padded.Length - "Filter applied".Length);
        Assert.Equal(new string(Zwsp, expectedRun), padded[(padded.Length - expectedRun)..]);
    }

    // ── bus: empty-skip (web: if (!message) return;) ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Announce_skips_empty_messages(string? message)
    {
        var bus = new AnnouncerBus();
        var received = new List<string>();
        using var sub = bus.Subscribe((msg, _) => received.Add(msg));

        bus.Announce(message!);

        Assert.Empty(received);
    }

    // ── bus: fan-out + default priority + padding ────────────────────────────────────────────────────────

    [Fact]
    public void Announce_fans_out_padded_message_with_default_polite_priority()
    {
        var bus = new AnnouncerBus();
        AnnouncerPriority? priority = null;
        string? message = null;
        using var sub = bus.Subscribe((msg, pri) => { message = msg; priority = pri; });

        bus.Announce("3 items archived");

        Assert.Equal(AnnouncerPriority.Polite, priority);
        Assert.StartsWith("3 items archived", message, StringComparison.Ordinal);
        Assert.Equal("3 items archived" + Zwsp, message); // first announcement -> counter 1 -> one ZWSP
    }

    [Fact]
    public void Announce_forwards_explicit_assertive_priority()
    {
        var bus = new AnnouncerBus();
        AnnouncerPriority? priority = null;
        using var sub = bus.Subscribe((_, pri) => priority = pri);

        bus.Announce("Session expiring", AnnouncerPriority.Assertive);

        Assert.Equal(AnnouncerPriority.Assertive, priority);
    }

    [Fact]
    public void Announce_delivers_to_every_subscribed_region()
    {
        var bus = new AnnouncerBus();
        var a = new List<string>();
        var b = new List<string>();
        using var subA = bus.Subscribe((msg, _) => a.Add(msg));
        using var subB = bus.Subscribe((msg, _) => b.Add(msg));

        bus.Announce("Saved view applied");

        Assert.Single(a);
        Assert.Single(b);
        Assert.Equal(a[0], b[0]);
    }

    [Fact]
    public void Announce_redelivers_distinct_strings_for_duplicate_messages()
    {
        // web: consecutive identical messages must differ so the screen reader re-reads them.
        var bus = new AnnouncerBus();
        var received = new List<string>();
        using var sub = bus.Subscribe((msg, _) => received.Add(msg));

        bus.Announce("Selection cleared");
        bus.Announce("Selection cleared");

        Assert.Equal(2, received.Count);
        Assert.NotEqual(received[0], received[1]);
        Assert.All(received, m => Assert.StartsWith("Selection cleared", m, StringComparison.Ordinal));
    }

    [Fact]
    public void Announce_with_no_subscribers_is_a_silent_no_op()
    {
        var bus = new AnnouncerBus();

        var ex = Record.Exception(() => bus.Announce("nobody listening"));

        Assert.Null(ex);
    }

    // ── bus: subscribe / unsubscribe (web subscribeAnnouncer + __getAnnouncerListenerCountForTests) ───────

    [Fact]
    public void Subscribe_increments_listener_count_and_dispose_decrements_it()
    {
        var bus = new AnnouncerBus();
        Assert.Equal(0, bus.ListenerCount);

        var sub = bus.Subscribe((_, _) => { });
        Assert.Equal(1, bus.ListenerCount);

        sub.Dispose();
        Assert.Equal(0, bus.ListenerCount);
    }

    [Fact]
    public void Disposed_subscription_no_longer_receives_announcements()
    {
        var bus = new AnnouncerBus();
        var received = new List<string>();
        var sub = bus.Subscribe((msg, _) => received.Add(msg));

        sub.Dispose();
        bus.Announce("after unsubscribe");

        Assert.Empty(received);
    }

    [Fact]
    public void Subscription_dispose_is_idempotent()
    {
        var bus = new AnnouncerBus();
        var sub = bus.Subscribe((_, _) => { });

        sub.Dispose();
        var ex = Record.Exception(sub.Dispose);

        Assert.Null(ex);
        Assert.Equal(0, bus.ListenerCount);
    }

    [Fact]
    public void Subscribe_rejects_a_null_listener()
    {
        var bus = new AnnouncerBus();

        Assert.Throws<ArgumentNullException>(() => bus.Subscribe(null!));
    }

    // ── bus: reset (web __resetAnnouncerForTests) + shared singleton ─────────────────────────────────────

    [Fact]
    public void ResetForTests_clears_listeners_and_restarts_the_padding_counter()
    {
        var bus = new AnnouncerBus();
        using var first = bus.Subscribe((_, _) => { });
        bus.Announce("seed"); // advances the counter

        bus.ResetForTests();
        Assert.Equal(0, bus.ListenerCount);

        var received = new List<string>();
        using var sub = bus.Subscribe((msg, _) => received.Add(msg));
        bus.Announce("fresh");

        // Counter restarted at 0 -> first post-reset announcement is counter 1 -> exactly one ZWSP.
        Assert.Equal("fresh" + Zwsp, Assert.Single(received));
    }

    [Fact]
    public void Shared_is_a_process_wide_singleton() =>
        Assert.Same(AnnouncerBus.Shared, AnnouncerBus.Shared);

    // ── view-model: initial empty state (web useState('')) ───────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_with_both_regions_empty()
    {
        using var vm = new AnnouncerRegionViewModel(new AnnouncerBus());

        Assert.Equal(string.Empty, vm.Polite);
        Assert.Equal(string.Empty, vm.Assertive);
    }

    [Fact]
    public void ViewModel_subscribes_to_the_bus_on_construction()
    {
        var bus = new AnnouncerBus();

        using var vm = new AnnouncerRegionViewModel(bus);

        Assert.Equal(1, bus.ListenerCount);
    }

    [Fact]
    public void ViewModel_rejects_a_null_bus() =>
        Assert.Throws<ArgumentNullException>(() => new AnnouncerRegionViewModel(null!));

    // ── view-model: routing (web: priority==='assertive' ? setAssertive : setPolite) ─────────────────────

    [Fact]
    public void Polite_announcement_updates_only_the_polite_region()
    {
        var bus = new AnnouncerBus();
        using var vm = new AnnouncerRegionViewModel(bus);

        bus.Announce("Filter removed");

        Assert.Equal("Filter removed", vm.Polite.TrimEnd(Zwsp));
        Assert.Equal(string.Empty, vm.Assertive);
    }

    [Fact]
    public void Assertive_announcement_updates_only_the_assertive_region()
    {
        var bus = new AnnouncerBus();
        using var vm = new AnnouncerRegionViewModel(bus);

        bus.Announce("Your session is about to expire", AnnouncerPriority.Assertive);

        Assert.Equal("Your session is about to expire", vm.Assertive.TrimEnd(Zwsp));
        Assert.Equal(string.Empty, vm.Polite);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_the_routed_region()
    {
        var bus = new AnnouncerBus();
        using var vm = new AnnouncerRegionViewModel(bus);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        bus.Announce("polite one");
        bus.Announce("assertive one", AnnouncerPriority.Assertive);

        Assert.Contains(nameof(AnnouncerRegionViewModel.Polite), changed);
        Assert.Contains(nameof(AnnouncerRegionViewModel.Assertive), changed);
    }

    [Fact]
    public void ViewModel_raises_announced_with_message_and_priority()
    {
        var bus = new AnnouncerBus();
        using var vm = new AnnouncerRegionViewModel(bus);
        AnnouncerMessageEventArgs? captured = null;
        vm.Announced += (_, e) => captured = e;

        bus.Announce("Bulk action complete", AnnouncerPriority.Assertive);

        Assert.NotNull(captured);
        Assert.Equal(AnnouncerPriority.Assertive, captured!.Priority);
        Assert.Equal("Bulk action complete", captured.Message.TrimEnd(Zwsp));
    }

    [Fact]
    public void ViewModel_keeps_the_latest_message_per_region()
    {
        var bus = new AnnouncerBus();
        using var vm = new AnnouncerRegionViewModel(bus);

        bus.Announce("first");
        bus.Announce("second");

        Assert.Equal("second", vm.Polite.TrimEnd(Zwsp));
    }

    [Fact]
    public void Disposed_view_model_unsubscribes_and_stops_projecting()
    {
        var bus = new AnnouncerBus();
        var vm = new AnnouncerRegionViewModel(bus);

        vm.Dispose();
        Assert.Equal(0, bus.ListenerCount);

        bus.Announce("after dispose");
        Assert.Equal(string.Empty, vm.Polite);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new AnnouncerRegionViewModel(new AnnouncerBus());

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    // ── diagnostics: view.opened, PII-safe (never the announced text) ────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AnnouncerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AnnouncerRegion", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AnnouncerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── registration + priority default (web slug + priority='polite') ───────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AnnouncerRegion", AnnouncerRegionRegistration.Slug);

    [Fact]
    public void Default_priority_is_polite() =>
        Assert.Equal(AnnouncerPriority.Polite, default(AnnouncerPriority));
}
