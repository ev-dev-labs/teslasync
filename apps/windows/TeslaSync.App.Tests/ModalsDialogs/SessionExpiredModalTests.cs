using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the <c>SessionExpiredModal</c> overlay surface's UI-thread-free logic — the
/// localized projection, the open-decision evaluation (per state: suppressed in open mode, dormant while the
/// session is live, and the active hard block once expired or a 401 latches), the reactive view-model bound to
/// the session seams, the re-auth recovery command, the composed Narrator name and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/components/feedback/SessionExpiredModal.tsx +
/// web/src/hooks/useSessionMonitor.ts). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class SessionExpiredModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Projection (adapter): localized copy + composed Narrator name ────────────────────────────────────

    [Fact]
    public void Project_resolves_every_label_and_the_lock_glyph()
    {
        SessionExpiredModalDisplay display = SessionExpiredModalProjection.Project(Localizer);

        Assert.Equal("Session expired", display.Title);
        Assert.Equal(
            "For your security, your session has timed out. Sign in again to pick up where you left off.",
            display.Body);
        Assert.Equal("Sign in again", display.SignInLabel);
        Assert.Equal(SessionExpiredModalRegistration.LockGlyph, display.IconGlyph);
    }

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SessionExpiredModalProjection.Project(null!));

    // ── Evaluate: the web open-decision (mode === 'open' guard, then hasExpired || eventTriggered) ────────

    [Theory]
    [InlineData(SessionMode.Session, false, false, SessionExpiredModalState.Dormant)]
    [InlineData(SessionMode.Unknown, false, false, SessionExpiredModalState.Dormant)]
    [InlineData(SessionMode.Session, true, false, SessionExpiredModalState.Active)]
    [InlineData(SessionMode.Session, false, true, SessionExpiredModalState.Active)]
    [InlineData(SessionMode.Session, true, true, SessionExpiredModalState.Active)]
    public void Evaluate_resolves_the_session_mode_states(
        SessionMode mode, bool hasExpired, bool hardExpiry, SessionExpiredModalState expected) =>
        Assert.Equal(expected, SessionExpiredModalProjection.Evaluate(mode, hasExpired, hardExpiry));

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(true, true)]
    public void Evaluate_open_mode_suppresses_even_when_expiry_signals_are_set(bool hasExpired, bool hardExpiry) =>
        Assert.Equal(
            SessionExpiredModalState.Suppressed,
            SessionExpiredModalProjection.Evaluate(SessionMode.Open, hasExpired, hardExpiry));

    // ── Accessibility: the composed Narrator name carries the title and body ──────────────────────────────

    [Fact]
    public void Project_composes_the_narrator_name_from_the_title_and_body()
    {
        SessionExpiredModalDisplay display = SessionExpiredModalProjection.Project(Localizer);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Body, display.AutomationName, StringComparison.Ordinal);
        Assert.False(string.IsNullOrWhiteSpace(display.SignInLabel));
    }

    // ── i18n: every visible string flows through a registration key ───────────────────────────────────────

    [Fact]
    public void Project_copy_flows_through_the_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        SessionExpiredModalProjection.Project(localizer);

        Assert.Contains(SessionExpiredModalRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(SessionExpiredModalRegistration.BodyKey, localizer.RequestedKeys);
        Assert.Contains(SessionExpiredModalRegistration.SignInKey, localizer.RequestedKeys);
    }

    // ── ViewModel: initial state resolved from the bound monitor ──────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_dormant_while_the_session_is_live()
    {
        using var vm = NewViewModel(new FakeMonitor());

        Assert.Equal(SessionExpiredModalState.Dormant, vm.State);
        Assert.False(vm.IsOpen);
        Assert.False(vm.IsSuppressed);
    }

    [Fact]
    public void ViewModel_starts_suppressed_in_open_mode()
    {
        using var vm = NewViewModel(new FakeMonitor { Mode = SessionMode.Open, HasExpired = true });

        Assert.Equal(SessionExpiredModalState.Suppressed, vm.State);
        Assert.False(vm.IsOpen);
        Assert.True(vm.IsSuppressed);
    }

    [Fact]
    public void ViewModel_starts_active_and_records_the_view_when_already_expired()
    {
        var captured = new List<string>();
        using var vm = NewViewModel(new FakeMonitor { HasExpired = true }, captured);

        Assert.True(vm.IsOpen);
        Assert.Equal(SessionExpiredModalState.Active, vm.State);
        Assert.Equal("view.opened slug=SessionExpiredModal", Assert.Single(captured));
    }

    // ── ViewModel: reactive transitions driven by the monitor + the 401 broadcast ────────────────────────

    [Fact]
    public void ViewModel_opens_and_records_the_view_when_the_monitor_reports_expiry()
    {
        var monitor = new FakeMonitor();
        var captured = new List<string>();
        using var vm = NewViewModel(monitor, captured);

        var opened = new List<bool>();
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SessionExpiredModalViewModel.IsOpen))
            {
                opened.Add(vm.IsOpen);
            }
        };

        monitor.HasExpired = true;
        monitor.Raise();

        Assert.True(vm.IsOpen);
        Assert.Equal(SessionExpiredModalState.Active, vm.State);
        Assert.Equal("view.opened slug=SessionExpiredModal", Assert.Single(captured));
        Assert.Equal(new[] { true }, opened);
    }

    [Fact]
    public void ViewModel_opens_when_a_401_hard_expiry_broadcast_latches()
    {
        var broadcast = new FakeBroadcast();
        using var vm = NewViewModel(new FakeMonitor(), broadcast: broadcast);

        Assert.False(vm.IsOpen);
        broadcast.Raise();

        Assert.True(vm.IsOpen);
        Assert.Equal(SessionExpiredModalState.Active, vm.State);
    }

    [Fact]
    public void ViewModel_keeps_the_block_open_after_a_401_even_if_the_monitor_recovers()
    {
        var monitor = new FakeMonitor();
        var broadcast = new FakeBroadcast();
        using var vm = NewViewModel(monitor, broadcast: broadcast);

        broadcast.Raise();
        Assert.True(vm.IsOpen);

        // The latch never resets — a fresh authenticated poll cannot lower the hard block (web eventTriggered).
        monitor.HasExpired = false;
        monitor.Raise();

        Assert.True(vm.IsOpen);
    }

    [Fact]
    public void ViewModel_open_mode_suppresses_a_latched_401()
    {
        var broadcast = new FakeBroadcast();
        using var vm = NewViewModel(new FakeMonitor { Mode = SessionMode.Open }, broadcast: broadcast);

        broadcast.Raise();

        Assert.True(vm.IsSuppressed);
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void ViewModel_closes_when_the_session_recovers_through_the_polling_path()
    {
        var monitor = new FakeMonitor { HasExpired = true };
        using var vm = NewViewModel(monitor);

        Assert.True(vm.IsOpen);

        monitor.HasExpired = false;
        monitor.Raise();

        Assert.False(vm.IsOpen);
        Assert.Equal(SessionExpiredModalState.Dormant, vm.State);
    }

    [Fact]
    public void ViewModel_records_each_distinct_open_transition()
    {
        var monitor = new FakeMonitor();
        var captured = new List<string>();
        using var vm = NewViewModel(monitor, captured);

        monitor.HasExpired = true;
        monitor.Raise();
        monitor.HasExpired = false;
        monitor.Raise();
        monitor.HasExpired = true;
        monitor.Raise();

        Assert.Equal(2, captured.Count(l => l == "view.opened slug=SessionExpiredModal"));
    }

    // ── ViewModel: the re-auth recovery command ───────────────────────────────────────────────────────────

    [Fact]
    public void RequestReauth_invokes_the_handoff_and_records_the_request()
    {
        var reauth = new RecordingReauth();
        var captured = new List<string>();
        using var vm = NewViewModel(new FakeMonitor { HasExpired = true }, captured, reauth: reauth);
        captured.Clear();

        vm.RequestReauth();

        Assert.Equal(1, reauth.Calls);
        Assert.Equal("reauth.requested slug=SessionExpiredModal", Assert.Single(captured));
    }

    [Fact]
    public void RequestReauth_keeps_the_hard_block_open()
    {
        var reauth = new RecordingReauth();
        using var vm = NewViewModel(new FakeMonitor { HasExpired = true }, reauth: reauth);

        vm.RequestReauth();

        Assert.True(vm.IsOpen);
    }

    // ── ViewModel: i18n reload + dispose ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Reload_reprojects_the_display_after_a_language_change()
    {
        var localizer = new MutableLocalizer { Suffix = string.Empty };
        using var vm = new SessionExpiredModalViewModel(
            localizer, new FakeMonitor(), new FakeBroadcast(), new RecordingReauth());

        Assert.Equal("Session expired", vm.Display.Title);

        localizer.Suffix = " (es)";
        vm.Reload();

        Assert.Equal("Session expired (es)", vm.Display.Title);
    }

    [Fact]
    public void Dispose_detaches_from_the_session_seams()
    {
        var monitor = new FakeMonitor();
        var vm = NewViewModel(monitor);

        vm.Dispose();

        monitor.HasExpired = true;
        monitor.Raise();

        Assert.False(vm.IsOpen);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new SessionExpiredModalViewModel(null!, new FakeMonitor(), new FakeBroadcast(), new RecordingReauth()));
        Assert.Throws<ArgumentNullException>(() =>
            new SessionExpiredModalViewModel(Localizer, null!, new FakeBroadcast(), new RecordingReauth()));
        Assert.Throws<ArgumentNullException>(() =>
            new SessionExpiredModalViewModel(Localizer, new FakeMonitor(), null!, new RecordingReauth()));
        Assert.Throws<ArgumentNullException>(() =>
            new SessionExpiredModalViewModel(Localizer, new FakeMonitor(), new FakeBroadcast(), null!));
    }

    // ── Diagnostics (P1/S11): slug-only counters, never session data ──────────────────────────────────────

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new SessionExpiredModalDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordReauthRequested();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.ReauthRequests);
        string[] expected =
        [
            "view.opened slug=SessionExpiredModal",
            "reauth.requested slug=SessionExpiredModal",
        ];
        Assert.Equal(expected, captured);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SessionExpiredModal", SessionExpiredModalRegistration.Slug);

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static SessionExpiredModalViewModel NewViewModel(
        FakeMonitor monitor,
        List<string>? sink = null,
        FakeBroadcast? broadcast = null,
        RecordingReauth? reauth = null) =>
        new(
            Localizer,
            monitor,
            broadcast ?? new FakeBroadcast(),
            reauth ?? new RecordingReauth(),
            sink is null ? null : new SessionExpiredModalDiagnostics(sink.Add));

    private sealed class FakeMonitor : ISessionMonitor
    {
        public SessionMode Mode { get; set; } = SessionMode.Session;

        public bool HasExpired { get; set; }

        public event EventHandler? Changed;

        public void Raise() => Changed?.Invoke(this, EventArgs.Empty);
    }

    private sealed class FakeBroadcast : ISessionExpiryBroadcast
    {
        public event EventHandler? Triggered;

        public void Raise() => Triggered?.Invoke(this, EventArgs.Empty);
    }

    private sealed class RecordingReauth : IReauthHandoff
    {
        public int Calls { get; private set; }

        public void NavigateToReauth() => Calls++;
    }

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class MutableLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) => fallback + Suffix;
    }
}
