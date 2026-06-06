using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the honest reduction of taskbar jobs into a single status (P2/W8-0001).</summary>
public sealed class TaskbarStatusReducerTests
{
    [Fact]
    public void Empty_is_idle() =>
        Assert.Equal(TaskbarStatus.Idle, TaskbarStatusReducer.Reduce(Array.Empty<TaskbarJob>()));

    [Fact]
    public void Single_running_reports_normal_progress()
    {
        var status = TaskbarStatusReducer.Reduce(new[] { TaskbarJob.Running("a", TaskbarJobKind.Command, 0.5) });

        Assert.Equal(TaskbarProgressState.Normal, status.State);
        Assert.Equal(0.5, status.Progress, 3);
        Assert.Equal(1, status.BadgeCount);
        Assert.True(status.HasBadge);
    }

    [Fact]
    public void Two_running_average_their_progress()
    {
        var status = TaskbarStatusReducer.Reduce(new[]
        {
            TaskbarJob.Running("a", TaskbarJobKind.Command, 0.2),
            TaskbarJob.Running("b", TaskbarJobKind.Export, 0.8),
        });

        Assert.Equal(0.5, status.Progress, 3);
        Assert.Equal(2, status.BadgeCount);
    }

    [Fact]
    public void Error_takes_precedence()
    {
        var status = TaskbarStatusReducer.Reduce(new[]
        {
            TaskbarJob.Running("a", TaskbarJobKind.Command, 0.5),
            TaskbarJob.Failed("b", TaskbarJobKind.Sync),
        });

        Assert.Equal(TaskbarProgressState.Error, status.State);
        Assert.Equal(1, status.ErrorCount);
        Assert.Equal(2, status.ActiveCount);
    }

    [Fact]
    public void Paused_outranks_indeterminate()
    {
        var status = TaskbarStatusReducer.Reduce(new[]
        {
            new TaskbarJob("a", TaskbarJobKind.Sync, TaskbarJobState.Paused, 0.3),
            TaskbarJob.Indeterminate("b", TaskbarJobKind.Command),
        });

        Assert.Equal(TaskbarProgressState.Paused, status.State);
    }

    [Fact]
    public void Only_indeterminate_jobs_yield_indeterminate_with_zero_progress()
    {
        var status = TaskbarStatusReducer.Reduce(new[] { TaskbarJob.Indeterminate("a", TaskbarJobKind.Command) });

        Assert.Equal(TaskbarProgressState.Indeterminate, status.State);
        Assert.Equal(0, status.Progress);
    }

    [Fact]
    public void Mixed_running_and_indeterminate_is_indeterminate()
    {
        var status = TaskbarStatusReducer.Reduce(new[]
        {
            TaskbarJob.Running("a", TaskbarJobKind.Command, 0.9),
            TaskbarJob.Indeterminate("b", TaskbarJobKind.Sync),
        });

        Assert.Equal(TaskbarProgressState.Indeterminate, status.State);
    }

    [Fact]
    public void Completed_jobs_are_excluded()
    {
        var status = TaskbarStatusReducer.Reduce(new[]
        {
            TaskbarJob.Completed("a", TaskbarJobKind.Command),
            TaskbarJob.Running("b", TaskbarJobKind.Export, 0.4),
        });

        Assert.Equal(1, status.BadgeCount);
        Assert.Equal(0.4, status.Progress, 3);
    }

    [Fact]
    public void All_completed_is_idle() =>
        Assert.Equal(TaskbarStatus.Idle, TaskbarStatusReducer.Reduce(new[] { TaskbarJob.Completed("a", TaskbarJobKind.Command) }));

    [Fact]
    public void Out_of_range_progress_is_clamped()
    {
        var status = TaskbarStatusReducer.Reduce(new[] { TaskbarJob.Running("a", TaskbarJobKind.Command, 5.0) });
        Assert.Equal(1.0, status.Progress, 3);
    }
}
