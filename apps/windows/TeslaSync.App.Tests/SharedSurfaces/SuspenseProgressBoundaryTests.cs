using TeslaSync.App.SharedSurfaces.SuspenseProgressBoundarySurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the SuspenseProgressBoundary surface's UI-thread-free logic — the registration
/// slug, the PII-safe diagnostics, the global progress controller (<see cref="GlobalProgress"/>: initial jump,
/// asymptotic trickle toward the target, consumer stacking, idempotent stop, subscriber replay, listener-error
/// isolation), the inert fallback (<see cref="NoOpGlobalProgress"/>), and the Suspense → progress bridge
/// (<see cref="SuspenseProgressBoundaryViewModel"/>: pending edge starts/stops the channel, reflects the live
/// busy/progress state, idempotent release on dispose). Mirrors the web spec one-for-one
/// (<c>web/src/components/feedback/SuspenseProgressBoundary.tsx</c>, <c>web/src/lib/globalProgress.ts</c>). The
/// WinUI view (<c>SuspenseProgressBoundary.cs</c>) is exercised by the app build.
/// </summary>
public sealed class SuspenseProgressBoundaryTests
{
    private const double Epsilon = 1e-9;

    private static void AssertNear(double expected, double actual) =>
        Assert.True(Math.Abs(expected - actual) < Epsilon, $"expected ~{expected} but got {actual}");

    // ── registration (anonymous web wrapper: slug only) ──────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_prompt_surface_slug() =>
        Assert.Equal("SuspenseProgressBoundary", SuspenseProgressBoundaryRegistration.Slug);

    // ── diagnostics (view.opened, PII-safe — never route/chunk identifiers) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SuspenseProgressBoundaryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SuspenseProgressBoundary", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new SuspenseProgressBoundaryDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── controller: initial jump + active edge (web start) ───────────────────────────────────────────────

    [Fact]
    public void Start_jumps_to_the_initial_value_and_activates()
    {
        using var progress = new GlobalProgress(new ManualTicker());

        using IDisposable _ = progress.Start();

        GlobalProgressSnapshot snapshot = progress.Snapshot();
        Assert.True(snapshot.IsActive);
        Assert.Equal(1, snapshot.ActiveCount);
        AssertNear(GlobalProgress.TrickleInitial, snapshot.Progress);
        Assert.True(snapshot.Ticking);
    }

    [Fact]
    public void Fresh_controller_is_idle()
    {
        using var progress = new GlobalProgress(new ManualTicker());

        GlobalProgressSnapshot snapshot = progress.Snapshot();
        Assert.False(snapshot.IsActive);
        Assert.Equal(0, snapshot.ActiveCount);
        Assert.Equal(0d, snapshot.Progress);
        Assert.False(snapshot.Ticking);
    }

    // ── controller: asymptotic trickle (web setInterval loop) ────────────────────────────────────────────

    [Fact]
    public void Tick_advances_progress_by_fifteen_percent_of_the_remaining_gap()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        using IDisposable _ = progress.Start();

        ticker.Tick();

        // web: progress + Math.max(1, remaining * 0.15) with progress=8, remaining=72 -> 8 + 10.8 = 18.8.
        double remaining = GlobalProgress.TrickleTarget - GlobalProgress.TrickleInitial;
        double expected = GlobalProgress.TrickleInitial + Math.Max(1d, remaining * 0.15d);
        AssertNear(expected, progress.Snapshot().Progress);
    }

    [Fact]
    public void Trickle_approaches_but_never_exceeds_the_target()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        using IDisposable _ = progress.Start();

        for (int i = 0; i < 500; i++)
        {
            ticker.Tick();
            Assert.True(progress.Snapshot().Progress <= GlobalProgress.TrickleTarget);
        }

        // The min-step (max(1, ...)) plus the Min cap means it converges to exactly the target.
        Assert.Equal(GlobalProgress.TrickleTarget, progress.Snapshot().Progress);
    }

    [Fact]
    public void Trickle_holds_at_the_target_once_reached()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        using IDisposable _ = progress.Start();
        for (int i = 0; i < 500; i++)
        {
            ticker.Tick();
        }

        double atTarget = progress.Snapshot().Progress;
        ticker.Tick();

        Assert.Equal(atTarget, progress.Snapshot().Progress);
    }

    [Fact]
    public void Tick_with_no_active_consumer_stops_the_ticker()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        IDisposable consumer = progress.Start();
        consumer.Dispose();

        // The last stop already stopped the ticker; a late in-flight tick is a no-op and re-stops defensively.
        ticker.Tick();

        Assert.False(progress.Snapshot().Ticking);
        Assert.Equal(0d, progress.Snapshot().Progress);
    }

    // ── controller: stacking + the last-stop snap-back (web activeCount stacking) ────────────────────────

    [Fact]
    public void Concurrent_consumers_stack_and_only_the_last_stop_deactivates()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);

        IDisposable first = progress.Start();
        IDisposable second = progress.Start();
        Assert.Equal(2, progress.Snapshot().ActiveCount);

        first.Dispose();
        GlobalProgressSnapshot afterFirst = progress.Snapshot();
        Assert.True(afterFirst.IsActive);
        Assert.Equal(1, afterFirst.ActiveCount);
        Assert.True(afterFirst.Ticking);

        second.Dispose();
        GlobalProgressSnapshot afterLast = progress.Snapshot();
        Assert.False(afterLast.IsActive);
        Assert.Equal(0d, afterLast.Progress);
        Assert.False(afterLast.Ticking);
    }

    [Fact]
    public void Stop_is_idempotent_and_does_not_underflow_the_consumer_count()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        IDisposable consumer = progress.Start();

        consumer.Dispose();
        consumer.Dispose();
        consumer.Dispose();

        // A fresh start must observe a clean count of 1 (and re-jump to the initial), proving the repeated
        // releases never drove the count negative.
        using IDisposable _ = progress.Start();
        GlobalProgressSnapshot snapshot = progress.Snapshot();
        Assert.Equal(1, snapshot.ActiveCount);
        AssertNear(GlobalProgress.TrickleInitial, snapshot.Progress);
    }

    // ── controller: subscriber replay + publish edges (web subscribe / publish) ──────────────────────────

    [Fact]
    public void Subscribe_replays_the_idle_state_immediately()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        var calls = new List<(bool Active, double Progress)>();

        using IDisposable _ = progress.Subscribe((a, p) => calls.Add((a, p)));

        (bool Active, double Progress) replay = Assert.Single(calls);
        Assert.False(replay.Active);
        Assert.Equal(0d, replay.Progress);
    }

    [Fact]
    public void Subscribe_replays_the_active_state_when_already_busy()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using IDisposable _ = progress.Start();
        var calls = new List<(bool Active, double Progress)>();

        using IDisposable __ = progress.Subscribe((a, p) => calls.Add((a, p)));

        (bool Active, double Progress) replay = Assert.Single(calls);
        Assert.True(replay.Active);
        AssertNear(GlobalProgress.TrickleInitial, replay.Progress);
    }

    [Fact]
    public void Start_and_last_stop_notify_listeners_but_a_non_last_stop_does_not()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        var calls = new List<(bool Active, double Progress)>();
        using IDisposable _ = progress.Subscribe((a, p) => calls.Add((a, p)));
        calls.Clear(); // drop the initial replay

        IDisposable first = progress.Start();   // publish (true, initial)
        IDisposable second = progress.Start();   // publish (true, initial)
        first.Dispose();                         // non-last stop -> no publish
        second.Dispose();                        // last stop -> publish (false, 0)

        Assert.Equal(3, calls.Count);
        Assert.True(calls[0].Active);
        Assert.True(calls[1].Active);
        Assert.False(calls[2].Active);
        Assert.Equal(0d, calls[2].Progress);
    }

    [Fact]
    public void Trickle_publishes_each_advance_to_listeners()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        using IDisposable _ = progress.Start();
        double last = double.NaN;
        using IDisposable __ = progress.Subscribe((_, p) => last = p);

        ticker.Tick();

        double remaining = GlobalProgress.TrickleTarget - GlobalProgress.TrickleInitial;
        AssertNear(GlobalProgress.TrickleInitial + Math.Max(1d, remaining * 0.15d), last);
    }

    [Fact]
    public void Unsubscribe_stops_further_notifications()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        int calls = 0;
        IDisposable subscription = progress.Subscribe((_, _) => calls++);
        Assert.Equal(1, calls); // initial replay

        subscription.Dispose();
        using IDisposable _ = progress.Start();

        Assert.Equal(1, calls);
    }

    [Fact]
    public void A_throwing_listener_does_not_break_the_controller()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        bool healthyNotified = false;
        using IDisposable bad = progress.Subscribe((_, _) => throw new InvalidOperationException("listener boom"));
        using IDisposable good = progress.Subscribe((_, _) => healthyNotified = true);

        Exception? error = Record.Exception(() => progress.Start());

        Assert.Null(error);
        Assert.True(healthyNotified);
        Assert.True(progress.Snapshot().IsActive);
    }

    [Fact]
    public void Snapshot_reports_the_live_listener_count()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        Assert.Equal(0, progress.Snapshot().Listeners);

        IDisposable subscription = progress.Subscribe((_, _) => { });
        Assert.Equal(1, progress.Snapshot().Listeners);

        subscription.Dispose();
        Assert.Equal(0, progress.Snapshot().Listeners);
    }

    [Fact]
    public void Shared_controller_is_a_stable_singleton() =>
        Assert.Same(GlobalProgress.Shared, GlobalProgress.Shared);

    // ── controller: ticker lifecycle (web startTrickle / stopTrickle) ────────────────────────────────────

    [Fact]
    public void First_start_starts_the_ticker_and_the_last_stop_stops_it()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);

        IDisposable first = progress.Start();
        IDisposable second = progress.Start();
        Assert.Equal(1, ticker.StartCount); // ticker armed only on the first consumer
        Assert.True(ticker.Running);

        first.Dispose();
        Assert.True(ticker.Running); // still a consumer

        second.Dispose();
        Assert.False(ticker.Running); // stopped on the last
    }

    // ── NoOpGlobalProgress: inert fallback ───────────────────────────────────────────────────────────────

    [Fact]
    public void NoOp_start_and_subscribe_are_inert()
    {
        IGlobalProgress progress = NoOpGlobalProgress.Instance;
        var calls = new List<(bool Active, double Progress)>();

        using IDisposable start = progress.Start();
        using IDisposable subscription = progress.Subscribe((a, p) => calls.Add((a, p)));

        (bool Active, double Progress) replay = Assert.Single(calls);
        Assert.False(replay.Active);
        Assert.Equal(0d, replay.Progress);
    }

    [Fact]
    public void NoOp_is_a_shared_singleton() =>
        Assert.Same(NoOpGlobalProgress.Instance, NoOpGlobalProgress.Instance);

    // ── view-model: the Suspense → progress bridge (web ProgressTrackingFallback) — the two states ───────

    [Fact]
    public void ViewModel_starts_resolved_and_idle()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using var viewModel = new SuspenseProgressBoundaryViewModel(progress);

        Assert.False(viewModel.IsPending);
        Assert.False(viewModel.IsProgressActive);
        Assert.Equal(0d, viewModel.Progress);
    }

    [Fact]
    public void Pending_true_activates_the_channel_and_reflects_the_initial_value()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using var viewModel = new SuspenseProgressBoundaryViewModel(progress);

        viewModel.IsPending = true;

        Assert.True(progress.Snapshot().IsActive);
        Assert.True(viewModel.IsProgressActive);
        AssertNear(GlobalProgress.TrickleInitial, viewModel.Progress);
    }

    [Fact]
    public void Pending_false_releases_the_consumer()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using var viewModel = new SuspenseProgressBoundaryViewModel(progress);

        viewModel.IsPending = true;
        viewModel.IsPending = false;

        Assert.False(progress.Snapshot().IsActive);
        Assert.False(viewModel.IsProgressActive);
        Assert.Equal(0d, viewModel.Progress);
    }

    [Fact]
    public void Setting_pending_to_the_same_value_does_not_stack_a_second_consumer()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using var viewModel = new SuspenseProgressBoundaryViewModel(progress);

        viewModel.IsPending = true;
        viewModel.IsPending = true;

        Assert.Equal(1, progress.Snapshot().ActiveCount);
    }

    [Fact]
    public void ViewModel_raises_is_pending_change()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using var viewModel = new SuspenseProgressBoundaryViewModel(progress);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.IsPending = true;

        Assert.Contains(nameof(SuspenseProgressBoundaryViewModel.IsPending), changed);
    }

    [Fact]
    public void ViewModel_reflects_and_raises_trickle_advances()
    {
        var ticker = new ManualTicker();
        using var progress = new GlobalProgress(ticker);
        using var viewModel = new SuspenseProgressBoundaryViewModel(progress);
        viewModel.IsPending = true;
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        ticker.Tick();

        double remaining = GlobalProgress.TrickleTarget - GlobalProgress.TrickleInitial;
        AssertNear(GlobalProgress.TrickleInitial + Math.Max(1d, remaining * 0.15d), viewModel.Progress);
        Assert.Contains(nameof(SuspenseProgressBoundaryViewModel.Progress), changed);
    }

    [Fact]
    public void Dispose_releases_a_held_consumer_and_unsubscribes()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        var viewModel = new SuspenseProgressBoundaryViewModel(progress);
        viewModel.IsPending = true;
        Assert.Equal(1, progress.Snapshot().Listeners);

        viewModel.Dispose();

        Assert.False(progress.Snapshot().IsActive);
        Assert.Equal(0, progress.Snapshot().Listeners);
    }

    [Fact]
    public void Two_boundaries_stack_on_the_shared_channel()
    {
        using var progress = new GlobalProgress(new ManualTicker());
        using var first = new SuspenseProgressBoundaryViewModel(progress);
        using var second = new SuspenseProgressBoundaryViewModel(progress);

        first.IsPending = true;
        second.IsPending = true;
        Assert.Equal(2, progress.Snapshot().ActiveCount);

        first.IsPending = false;
        Assert.True(progress.Snapshot().IsActive);

        second.IsPending = false;
        Assert.False(progress.Snapshot().IsActive);
    }

    [Fact]
    public void ViewModel_throws_for_a_null_channel() =>
        Assert.Throws<ArgumentNullException>(() => new SuspenseProgressBoundaryViewModel(null!));

    /// <summary>
    /// A deterministic <see cref="IGlobalProgressTicker"/> — the test analogue of the web trickle
    /// <c>setInterval</c>: it captures the controller's tick callback so a test can advance the trickle one
    /// step at a time without a wall-clock timer.
    /// </summary>
    private sealed class ManualTicker : IGlobalProgressTicker
    {
        private Action? _onTick;

        public bool Running { get; private set; }

        public int StartCount { get; private set; }

        public void Start(Action onTick)
        {
            _onTick = onTick;
            Running = true;
            StartCount++;
        }

        public void StopTicking() => Running = false;

        public void Tick() => _onTick?.Invoke();
    }
}
