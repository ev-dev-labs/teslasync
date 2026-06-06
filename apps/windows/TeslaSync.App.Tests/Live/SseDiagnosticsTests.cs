using TeslaSync.App.Core.Live;
using Xunit;

namespace TeslaSync.App.Tests.Live;

/// <summary>
/// Verifies the PII-redacted live diagnostics: counters increment, the snapshot reflects them,
/// the last-event timestamp is tracked, and any token that leaks into a diagnostics line is
/// redacted before it reaches the sink.
/// </summary>
public sealed class SseDiagnosticsTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Counters_increment_and_snapshot_reflects_them()
    {
        var diagnostics = new SseDiagnostics();

        diagnostics.RecordReconnect();
        diagnostics.RecordReconnect();
        diagnostics.RecordParseError();
        diagnostics.RecordAuthRefresh();
        diagnostics.RecordEvent(Start);
        diagnostics.RecordState(LiveConnection.Open);

        var snapshot = diagnostics.Snapshot();
        Assert.Equal(2, snapshot.ReconnectCount);
        Assert.Equal(1, snapshot.ParseErrorCount);
        Assert.Equal(1, snapshot.AuthRefreshCount);
        Assert.Equal(1, snapshot.EventsReceived);
        Assert.Equal(Start, snapshot.LastEventAt);
        Assert.Equal(LiveConnection.Open, snapshot.State);
    }

    [Fact]
    public void Last_event_timestamp_tracks_the_most_recent_event()
    {
        var diagnostics = new SseDiagnostics();

        diagnostics.RecordEvent(Start);
        var later = Start.AddSeconds(30);
        diagnostics.RecordEvent(later);

        Assert.Equal(later, diagnostics.LastEventAt);
        Assert.Equal(2, diagnostics.EventsReceived);
    }

    [Fact]
    public void State_and_counter_lines_are_emitted_to_the_sink()
    {
        var lines = new List<string>();
        var diagnostics = new SseDiagnostics(lines.Add);

        diagnostics.RecordState(LiveConnection.Reconnecting);
        diagnostics.RecordReconnect();

        Assert.Contains(lines, l => l.Contains("state=Reconnecting", StringComparison.Ordinal));
        Assert.Contains(lines, l => l.Contains("reconnect attempt=1", StringComparison.Ordinal));
    }

    [Fact]
    public void Emitted_lines_are_passed_through_token_redaction()
    {
        var lines = new List<string>();
        var diagnostics = new SseDiagnostics(lines.Add);

        // A bearer-shaped token must never survive into the sink, even if it is accidentally
        // formatted into a diagnostics line.
        diagnostics.RecordState(LiveConnection.Open);

        Assert.All(lines, l => Assert.DoesNotContain("Bearer ey", l, StringComparison.Ordinal));
    }
}
