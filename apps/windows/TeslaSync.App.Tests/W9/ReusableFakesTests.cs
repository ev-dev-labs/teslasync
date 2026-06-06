using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Push;
using TeslaSync.App.Tests.Fakes;
using Xunit;

namespace TeslaSync.App.Tests.W9;

/// <summary>
/// Exercises the W9 shared test doubles (<see cref="TestClock"/>, <see cref="RecordingLogSink"/>)
/// against real Core components so the reusable fakes — not just the components — are proven. These
/// are the canonical clock and logger seams the rest of the suite can adopt in place of ad-hoc
/// per-file doubles.
/// </summary>
public sealed class ReusableFakesTests
{
    [Fact]
    public void TestClock_DrivesLiveStalenessDeterministically()
    {
        var clock = new TestClock();
        var monitor = new LiveConnectionMonitor(TimeSpan.FromMinutes(2), clock.Func);

        monitor.MarkEvent(clock.Now);
        Assert.Equal(LiveConnection.Open, monitor.EffectiveState);
        Assert.False(monitor.IsStale);

        clock.Advance(TimeSpan.FromMinutes(3)); // open but silent past the freshness window
        Assert.Equal(LiveConnection.Stale, monitor.EffectiveState);
        Assert.True(monitor.IsStale);
    }

    [Fact]
    public void RecordingLogSink_CapturesDiagnosticsStampedByTestClock()
    {
        var clock = new TestClock();
        var log = new RecordingLogSink();
        var diagnostics = new PushDiagnostics(log.Sink, clock.Func);

        clock.Advance(TimeSpan.FromSeconds(30));
        diagnostics.RecordRegister();
        diagnostics.RecordPayloadRouted();

        var snapshot = diagnostics.Snapshot();
        Assert.Equal(1, snapshot.RegisterCount);
        Assert.Equal(1, snapshot.PayloadsRouted);
        Assert.Equal(clock.Now, snapshot.LastActionAt);

        Assert.Equal(2, log.Count);
        Assert.True(log.Contains("push register"));
        Assert.True(log.Contains("payload routed"));
    }

    [Fact]
    public void RecordingLogSink_NeverCapturesAChannelUriInTheClear()
    {
        var log = new RecordingLogSink();
        var diagnostics = new PushDiagnostics(log.Sink);

        diagnostics.RecordFailure("https://wns.example/secret-channel");

        Assert.Equal(1, log.Count);
        Assert.True(log.Contains(PushRedaction.Marker)); // the URI was redacted...
        Assert.False(log.Contains("secret-channel")); // ...so the secret never reached the sink.
    }
}
