namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// Reduces a set of <see cref="TaskbarJob"/>s into a single <see cref="TaskbarStatus"/> (P2/W8-0001).
/// The reduction is deliberately honest: only non-<see cref="TaskbarJobState.Complete"/> jobs count, so
/// the badge and progress reflect work the app is genuinely doing right now. State precedence is
/// error → paused → indeterminate → normal; the determinate progress is the mean fraction of the jobs
/// with a known fraction, and the badge is the count of active jobs. With no active jobs the result is
/// <see cref="TaskbarStatus.Idle"/>. Pure so every combination is unit-tested.
/// </summary>
public static class TaskbarStatusReducer
{
    /// <summary>Reduces <paramref name="jobs"/> into the taskbar status to apply.</summary>
    public static TaskbarStatus Reduce(IEnumerable<TaskbarJob> jobs)
    {
        ArgumentNullException.ThrowIfNull(jobs);

        int active = 0;
        int errors = 0;
        int paused = 0;
        int indeterminate = 0;
        int determinate = 0;
        double progressSum = 0;

        foreach (var job in jobs)
        {
            if (job is null || job.State == TaskbarJobState.Complete)
            {
                continue;
            }

            active++;
            switch (job.State)
            {
                case TaskbarJobState.Error:
                    errors++;
                    determinate++;
                    progressSum += Clamp(job.Progress);
                    break;
                case TaskbarJobState.Paused:
                    paused++;
                    determinate++;
                    progressSum += Clamp(job.Progress);
                    break;
                case TaskbarJobState.Indeterminate:
                    indeterminate++;
                    break;
                default:
                    determinate++;
                    progressSum += Clamp(job.Progress);
                    break;
            }
        }

        if (active == 0)
        {
            return TaskbarStatus.Idle;
        }

        var state = errors > 0 ? TaskbarProgressState.Error
            : paused > 0 ? TaskbarProgressState.Paused
            : indeterminate > 0 ? TaskbarProgressState.Indeterminate
            : TaskbarProgressState.Normal;

        double progress = determinate > 0 ? Clamp(progressSum / determinate) : 0;
        return new TaskbarStatus(state, progress, active, active, errors);
    }

    private static double Clamp(double value)
    {
        if (double.IsNaN(value))
        {
            return 0;
        }

        return Math.Clamp(value, 0.0, 1.0);
    }
}
