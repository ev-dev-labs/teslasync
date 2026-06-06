using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the taskbar job tracker upserts, removes and notifies honestly (P2/W8-0001).</summary>
public sealed class TaskbarJobTrackerTests
{
    [Fact]
    public void Starts_idle() => Assert.Equal(TaskbarStatus.Idle, new TaskbarJobTracker().Status);

    [Fact]
    public void Report_updates_status_and_notifies()
    {
        var tracker = new TaskbarJobTracker();
        TaskbarStatus? last = null;
        tracker.Changed += (_, status) => last = status;

        tracker.Report(TaskbarJob.Running("a", TaskbarJobKind.Command, 0.5));

        Assert.Equal(1, tracker.Status.BadgeCount);
        Assert.NotNull(last);
        Assert.Equal(1, last!.BadgeCount);
    }

    [Fact]
    public void Reporting_complete_removes_the_job()
    {
        var tracker = new TaskbarJobTracker();
        tracker.Report(TaskbarJob.Running("a", TaskbarJobKind.Command, 0.5));
        tracker.Report(TaskbarJob.Completed("a", TaskbarJobKind.Command));

        Assert.Equal(TaskbarStatus.Idle, tracker.Status);
    }

    [Fact]
    public void Remove_drops_an_attention_job()
    {
        var tracker = new TaskbarJobTracker();
        tracker.Report(TaskbarJob.Failed("a", TaskbarJobKind.Sync));
        tracker.Remove("a");

        Assert.Equal(TaskbarStatus.Idle, tracker.Status);
    }

    [Fact]
    public void Clear_resets_to_idle()
    {
        var tracker = new TaskbarJobTracker();
        tracker.Report(TaskbarJob.Running("a", TaskbarJobKind.Command, 0.2));
        tracker.Report(TaskbarJob.Running("b", TaskbarJobKind.Export, 0.3));

        tracker.Clear();

        Assert.Equal(TaskbarStatus.Idle, tracker.Status);
    }

    [Fact]
    public void Report_null_throws() =>
        Assert.Throws<ArgumentNullException>(() => new TaskbarJobTracker().Report(null!));

    [Fact]
    public void Report_empty_id_throws() =>
        Assert.Throws<ArgumentException>(() => new TaskbarJobTracker().Report(new TaskbarJob(string.Empty, TaskbarJobKind.Command, TaskbarJobState.Running)));
}
