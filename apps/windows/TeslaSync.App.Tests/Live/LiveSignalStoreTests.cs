using System.Text.Json;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// Verifies the live signal state holder applies decoded events into freshness-aware L1 state,
/// flags stale (two-minute) values, exposes the latest batched vehicle update, and consumes a
/// subscription stream end-to-end.
/// </summary>
public sealed class LiveSignalStoreTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static LiveEvent.Signal SignalEvent(long vehicleId, string field, double value) =>
        new(new SignalEnvelope(vehicleId, field, SignalKind.Float, new SignalValue.Number(value), "t"), null);

    [Fact]
    public void Apply_stores_latest_signal_value()
    {
        var store = new LiveSignalStore(() => Start);

        store.Apply(SignalEvent(7, "VehicleSpeed", 12.0));
        store.Apply(SignalEvent(7, "VehicleSpeed", 34.0));

        var latest = store.Latest(7, "VehicleSpeed");
        Assert.NotNull(latest);
        Assert.Equal(34.0, Assert.IsType<SignalValue.Number>(latest!.Value).Value);
    }

    [Fact]
    public void Signal_changed_event_fires_per_apply()
    {
        var store = new LiveSignalStore(() => Start);
        var seen = new List<LiveSignal>();
        store.SignalChanged += seen.Add;

        store.Apply(SignalEvent(1, "A", 1));
        store.Apply(SignalEvent(1, "B", 2));

        Assert.Equal(2, seen.Count);
    }

    [Fact]
    public void Value_is_flagged_stale_after_two_minutes()
    {
        var clock = new ManualClock(Start);
        var store = new LiveSignalStore(clock.Get);

        store.Apply(SignalEvent(7, "VehicleSpeed", 12.0));
        Assert.False(store.IsStale(7, "VehicleSpeed"));

        clock.Advance(TimeSpan.FromSeconds(FreshnessLogic.DefaultStaleSeconds + 1));
        Assert.True(store.IsStale(7, "VehicleSpeed"));
        Assert.Equal(FreshnessStatus.Stale, store.Latest(7, "VehicleSpeed")!.Freshness(clock.Now));
    }

    [Fact]
    public void Missing_signal_is_treated_as_stale()
    {
        var store = new LiveSignalStore(() => Start);
        Assert.True(store.IsStale(99, "Nope"));
        Assert.Null(store.Latest(99, "Nope"));
    }

    [Fact]
    public void Signals_for_filters_by_vehicle()
    {
        var store = new LiveSignalStore(() => Start);
        store.Apply(SignalEvent(1, "A", 1));
        store.Apply(SignalEvent(1, "B", 2));
        store.Apply(SignalEvent(2, "A", 3));

        Assert.Equal(2, store.SignalsFor(1).Count);
        Assert.Single(store.SignalsFor(2));
    }

    [Fact]
    public void Vehicle_update_is_stored_with_resolved_id()
    {
        var store = new LiveSignalStore(() => Start);
        using var doc = JsonDocument.Parse("{\"vehicle_id\":42,\"speed\":10}");
        store.Apply(new LiveEvent.VehicleUpdate(doc.RootElement.Clone(), null));

        var snapshot = store.LatestVehicleUpdate(42);
        Assert.NotNull(snapshot);
        Assert.Equal(42, snapshot!.VehicleId);
    }

    [Fact]
    public async Task Bind_consumes_a_subscription_stream()
    {
        var transport = new FakeSseTransport((attempt, _) => attempt == 0
            ? new SseStep[]
            {
                new SseStep.Emit("event: signal_change\ndata: {\"vehicle_id\":7,\"field\":\"VehicleSpeed\",\"kind\":\"ValueKindFloat\",\"value\":50,\"ts\":\"t\"}\n\n"),
                new SseStep.Complete(),
            }
            : new SseStep[] { new SseStep.Hang() });

        var client = new SseClient(transport, new FakeTokenProvider("tok"), options: NoReconnect());
        var store = new LiveSignalStore(() => Start);
        var sub = client.Subscribe();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await store.BindAsync(sub, cts.Token);

        var latest = store.Latest(7, "VehicleSpeed");
        Assert.NotNull(latest);
        Assert.Equal(50.0, Assert.IsType<SignalValue.Number>(latest!.Value).Value);
    }

    [Fact]
    public void Clear_drops_all_live_state()
    {
        var store = new LiveSignalStore(() => Start);
        store.Apply(SignalEvent(1, "A", 1));
        store.Clear();
        Assert.Empty(store.SignalsFor(1));
    }

    private static SseClientOptions NoReconnect() => new()
    {
        Reconnect = false,
        Delay = (_, _) => Task.CompletedTask,
    };
}
