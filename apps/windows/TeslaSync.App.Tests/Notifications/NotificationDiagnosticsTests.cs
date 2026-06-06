using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the PII-safe notification diagnostics counters and sink (P2/W8-0001, ADR-016).</summary>
public sealed class NotificationDiagnosticsTests
{
    [Fact]
    public void Snapshot_counts_each_record()
    {
        var diagnostics = new NotificationDiagnostics();
        diagnostics.RecordIngested(NotificationKind.Alert);
        diagnostics.RecordBanner(NotificationKind.Alert);
        diagnostics.RecordToast(NotificationKind.Alert);
        diagnostics.RecordToastSuppressed(NotificationKind.Generic);
        diagnostics.RecordActivation(NotificationKind.ChargeComplete);
        diagnostics.RecordTaskbarUpdate();
        diagnostics.RecordJumpListBuild();

        var snapshot = diagnostics.Snapshot();
        Assert.Equal(1, snapshot.Ingested);
        Assert.Equal(1, snapshot.BannersRaised);
        Assert.Equal(1, snapshot.ToastsPresented);
        Assert.Equal(1, snapshot.ToastsSuppressed);
        Assert.Equal(1, snapshot.ActivationsRouted);
        Assert.Equal(1, snapshot.TaskbarUpdates);
        Assert.Equal(1, snapshot.JumpListBuilds);
    }

    [Fact]
    public void Sink_emits_only_pii_safe_kind_tokens()
    {
        var lines = new List<string>();
        var diagnostics = new NotificationDiagnostics(lines.Add);

        diagnostics.RecordToast(NotificationKind.ChargeComplete);

        var line = Assert.Single(lines);
        Assert.Contains("kind=charge_complete", line, StringComparison.Ordinal);
        Assert.Contains("toast", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Sink_omits_kind_for_surface_only_events()
    {
        var lines = new List<string>();
        var diagnostics = new NotificationDiagnostics(lines.Add);

        diagnostics.RecordTaskbarUpdate();

        Assert.DoesNotContain("kind=", Assert.Single(lines), StringComparison.Ordinal);
    }
}
