using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Live;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// Verifies the live connection state holder: raw-state transitions, the freshness-window
/// derivation of <see cref="LiveConnection.Stale"/>, and the change notifications the UI binds to.
/// </summary>
public sealed class LiveConnectionMonitorTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Open_stream_reads_stale_once_past_the_freshness_window()
    {
        var clock = new ManualClock(Start);
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), clock.Get);

        monitor.MarkEvent(clock.Now);
        Assert.Equal(LiveConnection.Open, monitor.EffectiveState);

        clock.Advance(TimeSpan.FromSeconds(121));
        Assert.Equal(LiveConnection.Stale, monitor.EffectiveState);
        Assert.True(monitor.IsStale);
    }

    [Fact]
    public void A_new_event_clears_staleness()
    {
        var clock = new ManualClock(Start);
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), clock.Get);

        monitor.MarkEvent(clock.Now);
        clock.Advance(TimeSpan.FromSeconds(200));
        Assert.True(monitor.IsStale);

        clock.Advance(TimeSpan.FromSeconds(5));
        monitor.MarkEvent(clock.Now);
        Assert.Equal(LiveConnection.Open, monitor.EffectiveState);
        Assert.False(monitor.IsStale);
    }

    [Fact]
    public void Non_open_states_are_not_reinterpreted_as_stale()
    {
        var clock = new ManualClock(Start);
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), clock.Get);

        monitor.MarkEvent(clock.Now);
        monitor.SetState(LiveConnection.Reconnecting);
        clock.Advance(TimeSpan.FromSeconds(500));

        Assert.Equal(LiveConnection.Reconnecting, monitor.EffectiveStateAt(clock.Now));
    }

    [Fact]
    public void Raises_changed_on_state_and_event_transitions()
    {
        var clock = new ManualClock(Start);
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), clock.Get);
        var snapshots = new List<LiveConnectionSnapshot>();
        monitor.Changed += snapshots.Add;

        monitor.SetState(LiveConnection.Connecting);
        monitor.MarkEvent(clock.Now);

        Assert.Equal(LiveConnection.Connecting, snapshots[0].State);
        Assert.Equal(LiveConnection.Open, snapshots[^1].State);
    }

    [Fact]
    public void Evaluate_staleness_raises_changed_only_on_transition()
    {
        var clock = new ManualClock(Start);
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), clock.Get);
        monitor.MarkEvent(clock.Now);

        int changes = 0;
        monitor.Changed += _ => changes++;

        clock.Advance(TimeSpan.FromSeconds(60));
        monitor.EvaluateStaleness(clock.Now);
        Assert.Equal(0, changes);

        clock.Advance(TimeSpan.FromSeconds(61));
        monitor.EvaluateStaleness(clock.Now);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Indicator_mapping_treats_open_and_stale_as_connected()
    {
        Assert.Equal(LiveConnectionState.Connected, LiveConnectionMapping.ToIndicatorState(LiveConnection.Open));
        Assert.Equal(LiveConnectionState.Connected, LiveConnectionMapping.ToIndicatorState(LiveConnection.Stale));
        Assert.Equal(LiveConnectionState.Reconnecting, LiveConnectionMapping.ToIndicatorState(LiveConnection.Reconnecting));
        Assert.Equal(LiveConnectionState.Disconnected, LiveConnectionMapping.ToIndicatorState(LiveConnection.AuthRequired));
        Assert.True(LiveConnectionMapping.ShouldShowStaleBanner(LiveConnection.Stale));
        Assert.False(LiveConnectionMapping.ShouldShowStaleBanner(LiveConnection.Open));
    }
}
