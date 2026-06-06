using System.Collections.Concurrent;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// End-to-end behaviour of the foreground <see cref="SseClient"/> over a scripted transport:
/// typed-event delivery, <c>Last-Event-ID</c> resume, capped exponential backoff, deterministic
/// staleness, cancellation, the single-refresh-then-<see cref="LiveConnection.AuthRequired"/> 401
/// policy, malformed-frame tolerance, reconnect-disabled close, and foreground pause/resume.
/// All time/jitter/sleep seams are injected so the suite is deterministic and never sleeps.
/// </summary>
public sealed class SseClientTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private const string ConnectedFrame = "event: connected\ndata: {\"client_id\":\"c1\"}\n\n";

    private static string SignalFrame(string field, double value) =>
        $"event: signal_change\ndata: {{\"vehicle_id\":7,\"field\":\"{field}\",\"kind\":\"ValueKindFloat\",\"value\":{value},\"ts\":\"t\"}}\n\n";

    [Fact]
    public async Task Yields_typed_events_and_reports_open()
    {
        var transport = Script((attempt, _) => attempt == 0
            ? new SseStep[] { new SseStep.Emit(ConnectedFrame), new SseStep.Emit(SignalFrame("VehicleSpeed", 12)), new SseStep.Complete() }
            : new SseStep[] { new SseStep.Hang() });
        var sub = NewClient(transport).Subscribe();

        var events = await CollectAsync(sub, TimeSpan.FromSeconds(5));

        Assert.Contains(events, e => e is LiveEvent.Connected);
        Assert.Contains(events, e => e is LiveEvent.Signal);
        Assert.Single(transport.Opens);
    }

    [Fact]
    public async Task Reconnects_and_resumes_with_last_event_id()
    {
        var transport = Script((attempt, _) => attempt == 0
            ? new SseStep[]
            {
                new SseStep.Emit("event: heartbeat\nid: evt-7\ndata: {\"time\":\"t\"}\n\n"),
                new SseStep.Fail(new IOException("dropped")),
            }
            : new SseStep[] { new SseStep.Hang() });
        var sub = new SseClient(transport, new FakeTokenProvider("tok"), options: OptionsWith(() => Start, reconnect: true)).Subscribe();

        using var run = Drain(sub);
        await WaitForAsync(() => transport.Opens.Count >= 2);

        Assert.Equal("evt-7", transport.Opens[1].LastEventId);
        run.Cancel();
    }

    [Fact]
    public async Task Reconnect_backoff_grows_exponentially_and_is_capped()
    {
        var delays = new DelayController(TimeSpan.FromSeconds(60));
        var transport = Script((_, _) => new SseStep[] { new SseStep.Fail(new IOException("down")) });
        var options = new SseClientOptions
        {
            Reconnect = true,
            BaseRetryDelay = TimeSpan.FromSeconds(1),
            MaxRetryDelay = TimeSpan.FromSeconds(5),
            FreshnessWindow = TimeSpan.FromSeconds(120),
            Clock = () => Start,
            Delay = delays.Delay,
            Random = () => 0.5,
        };
        var sub = new SseClient(transport, new FakeTokenProvider("tok"), options: options).Subscribe();

        using var run = Drain(sub);
        await WaitForAsync(() => delays.Recorded.Count >= 4);
        run.Cancel();

        var backoff = delays.Recorded;
        Assert.Equal(TimeSpan.FromSeconds(1), backoff[0]);
        Assert.Equal(TimeSpan.FromSeconds(2), backoff[1]);
        Assert.Equal(TimeSpan.FromSeconds(4), backoff[2]);
        Assert.Equal(TimeSpan.FromSeconds(5), backoff[3]);
    }

    [Fact]
    public async Task Open_stream_reads_stale_after_the_freshness_window()
    {
        var clock = new ManualClock(Start);
        var transport = Script((_, _) => new SseStep[] { new SseStep.Emit(ConnectedFrame), new SseStep.Hang() });
        var options = OptionsWith(clock.Get, reconnect: true);
        var sub = new SseClient(transport, new FakeTokenProvider("tok"), options: options).Subscribe();

        using var run = Drain(sub);
        await WaitForAsync(() => sub.Connection.State == LiveConnection.Open);

        Assert.Equal(LiveConnection.Open, sub.Connection.EffectiveStateAt(clock.Now));
        clock.Advance(TimeSpan.FromSeconds(121));
        Assert.Equal(LiveConnection.Stale, sub.Connection.EffectiveStateAt(clock.Now));
        run.Cancel();
    }

    [Fact]
    public async Task Cancellation_closes_the_transport_connection()
    {
        var transport = Script((_, _) => new SseStep[] { new SseStep.Hang() });
        var sub = NewClient(transport).Subscribe();

        var run = Drain(sub);
        await WaitForAsync(() => transport.ActiveConnections == 1);
        run.Cancel();

        await WaitForAsync(() => transport.ActiveConnections == 0);
        await run.Completion;
    }

    [Fact]
    public async Task Unauthorized_refreshes_token_and_reconnects_once()
    {
        var tokens = new FakeTokenProvider("old", refreshedToken: "new");
        var transport = Script((attempt, _) => attempt == 0
            ? new SseStep[] { new SseStep.Unauthorized() }
            : new SseStep[] { new SseStep.Emit(ConnectedFrame), new SseStep.Hang() });
        var sub = new SseClient(transport, tokens, options: OptionsWith(() => Start, reconnect: true)).Subscribe();

        using var run = Drain(sub);
        await WaitForAsync(() => transport.Opens.Count >= 2);

        Assert.Equal(1, tokens.RefreshCount);
        Assert.Equal(1, sub.Diagnostics.AuthRefreshCount);
        run.Cancel();
    }

    [Fact]
    public async Task Recurring_unauthorized_surfaces_auth_required()
    {
        var tokens = new FakeTokenProvider("old", refreshedToken: "new");
        var transport = Script((_, _) => new SseStep[] { new SseStep.Unauthorized() });
        var sub = new SseClient(transport, tokens, options: OptionsWith(() => Start, reconnect: true)).Subscribe();
        var states = ObserveStates(sub);

        await CollectAsync(sub, TimeSpan.FromSeconds(5));

        Assert.True(states.Contains(LiveConnection.AuthRequired));
        Assert.Equal(1, tokens.RefreshCount);
    }

    [Fact]
    public async Task Failed_refresh_surfaces_auth_required()
    {
        var tokens = new FakeTokenProvider("old");
        var transport = Script((_, _) => new SseStep[] { new SseStep.Unauthorized() });
        var sub = new SseClient(transport, tokens, options: OptionsWith(() => Start, reconnect: true)).Subscribe();
        var states = ObserveStates(sub);

        await CollectAsync(sub, TimeSpan.FromSeconds(5));

        Assert.True(states.Contains(LiveConnection.AuthRequired));
        Assert.Equal(1, sub.Diagnostics.AuthRefreshCount);
    }

    [Fact]
    public async Task Malformed_frame_is_surfaced_as_unknown_without_breaking_the_stream()
    {
        var transport = Script((_, _) => new SseStep[]
        {
            new SseStep.Emit("event: vehicle_update\ndata: not-json\n\n"),
            new SseStep.Emit(ConnectedFrame),
            new SseStep.Complete(),
        });
        var sub = NewClient(transport).Subscribe();

        var events = await CollectAsync(sub, TimeSpan.FromSeconds(5));

        Assert.Contains(events, e => e is LiveEvent.Unknown u && u.Event == "vehicle_update");
        Assert.Contains(events, e => e is LiveEvent.Connected);
        Assert.Equal(1, sub.Diagnostics.ParseErrorCount);
    }

    [Fact]
    public async Task Reconnect_disabled_closes_after_a_single_attempt()
    {
        var transport = Script((_, _) => new SseStep[] { new SseStep.Complete() });
        var sub = NewClient(transport).Subscribe();
        var states = ObserveStates(sub);

        await CollectAsync(sub, TimeSpan.FromSeconds(5));

        Assert.Single(transport.Opens);
        Assert.True(states.Contains(LiveConnection.Closed));
    }

    [Fact]
    public async Task Foreground_pause_suspends_the_stream_and_resume_reopens_it()
    {
        var lifecycle = new ControllableForegroundLifecycle(foreground: true);
        var transport = Script((attempt, _) => attempt == 0
            ? new SseStep[] { new SseStep.Emit(ConnectedFrame), new SseStep.Hang() }
            : new SseStep[] { new SseStep.Hang() });
        var client = new SseClient(transport, new FakeTokenProvider("tok"), lifecycle, OptionsWith(() => Start, reconnect: true));
        var sub = client.Subscribe();
        var states = ObserveStates(sub);

        using var run = Drain(sub);
        await WaitForAsync(() => transport.ActiveConnections == 1);

        lifecycle.Set(false);
        await WaitForAsync(() => transport.ActiveConnections == 0);
        await WaitForAsync(() => states.Contains(LiveConnection.Paused));

        lifecycle.Set(true);
        await WaitForAsync(() => transport.Opens.Count >= 2);
        run.Cancel();
    }

    private static SseClient NewClient(ISseTransport transport) =>
        new(transport, new FakeTokenProvider("tok"), options: OptionsWith(() => Start, reconnect: false));

    private static SseClientOptions OptionsWith(Func<DateTimeOffset> clock, bool reconnect) => new()
    {
        Reconnect = reconnect,
        BaseRetryDelay = TimeSpan.FromMilliseconds(1),
        MaxRetryDelay = TimeSpan.FromMilliseconds(5),
        FreshnessWindow = TimeSpan.FromSeconds(120),
        Clock = clock,
        Delay = new DelayController(TimeSpan.FromSeconds(60)).Delay,
        Random = () => 0.5,
    };

    private static FakeSseTransport Script(Func<int, string?, IReadOnlyList<SseStep>> script) => new(script);

    private static StateLog ObserveStates(LiveSubscription sub)
    {
        var log = new StateLog();
        sub.Connection.Changed += snapshot => log.Add(snapshot.State);
        return log;
    }

    private static async Task<IReadOnlyList<LiveEvent>> CollectAsync(LiveSubscription sub, TimeSpan timeout)
    {
        var events = new List<LiveEvent>();
        using var cts = new CancellationTokenSource(timeout);
        await foreach (var live in sub.ReadEventsAsync(cts.Token).ConfigureAwait(false))
        {
            events.Add(live);
        }

        return events;
    }

    private static DrainHandle Drain(LiveSubscription sub)
    {
        var cts = new CancellationTokenSource();
        var events = new ConcurrentQueue<LiveEvent>();
        var completion = Task.Run(async () =>
        {
            try
            {
                await foreach (var live in sub.ReadEventsAsync(cts.Token).ConfigureAwait(false))
                {
                    events.Enqueue(live);
                }
            }
            catch (OperationCanceledException)
            {
                // Expected on Cancel().
            }
        });

        return new DrainHandle(cts, completion);
    }

    private static async Task WaitForAsync(Func<bool> condition, int timeoutMs = 5000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(10).ConfigureAwait(false);
        }

        Assert.Fail("Timed out waiting for the expected live-stream condition.");
    }

    private sealed class DrainHandle : IDisposable
    {
        private readonly CancellationTokenSource _cts;

        public DrainHandle(CancellationTokenSource cts, Task completion)
        {
            _cts = cts;
            Completion = completion;
        }

        public Task Completion { get; }

        public void Cancel() => _cts.Cancel();

        public void Dispose()
        {
            _cts.Cancel();
            _cts.Dispose();
        }
    }

    private sealed class StateLog
    {
        private readonly object _gate = new();
        private readonly List<LiveConnection> _states = new();

        public void Add(LiveConnection state)
        {
            lock (_gate)
            {
                _states.Add(state);
            }
        }

        public bool Contains(LiveConnection state)
        {
            lock (_gate)
            {
                return _states.Contains(state);
            }
        }
    }
}
