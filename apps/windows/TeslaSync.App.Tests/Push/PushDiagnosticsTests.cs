using TeslaSync.App.Core.Push;
using Xunit;

namespace TeslaSync.App.Tests.Push;

/// <summary>Verifies <see cref="PushDiagnostics"/> counts actions and redacts every emitted line.</summary>
public sealed class PushDiagnosticsTests
{
    [Fact]
    public void Counters_track_each_action()
    {
        var diagnostics = new PushDiagnostics();

        diagnostics.RecordRegister();
        diagnostics.RecordRenew();
        diagnostics.RecordUnregister();
        diagnostics.RecordPayloadRouted();
        diagnostics.RecordPayloadRouted();
        diagnostics.RecordFailure("channel_unavailable");

        var snapshot = diagnostics.Snapshot();
        Assert.Equal(1, snapshot.RegisterCount);
        Assert.Equal(1, snapshot.RenewCount);
        Assert.Equal(1, snapshot.UnregisterCount);
        Assert.Equal(2, snapshot.PayloadsRouted);
        Assert.Equal(1, snapshot.FailureCount);
    }

    [Fact]
    public void Emitted_lines_are_redacted_and_never_carry_a_uri()
    {
        var lines = new List<string>();
        var diagnostics = new PushDiagnostics(lines.Add);

        diagnostics.RecordRegister();
        diagnostics.RecordFailure("https://db5.notify.windows.com/?token=SECRET");

        Assert.NotEmpty(lines);
        Assert.DoesNotContain(lines, l => l.Contains("notify.windows.com", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(lines, l => l.Contains("SECRET", StringComparison.OrdinalIgnoreCase));
    }
}
