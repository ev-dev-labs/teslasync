namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The single source of truth for the taskbar's badge / progress (P2/W8-0001). Real features report
/// their long-running jobs here — a vehicle command, an export, a sync — and the tracker reduces them
/// into a <see cref="TaskbarStatus"/> the platform service applies. It is deliberately empty until a
/// real job is reported (no demo / fabricated work), and a job reported as
/// <see cref="TaskbarJobState.Complete"/> is dropped so the taskbar only ever reflects in-flight or
/// attention-needing work. Thread-safe: features may report from any thread.
/// </summary>
public sealed class TaskbarJobTracker
{
    private readonly object _gate = new();
    private readonly Dictionary<string, TaskbarJob> _jobs = new(StringComparer.Ordinal);

    /// <summary>Raised after any change with the newly-reduced status (marshal to the UI thread to apply).</summary>
    public event EventHandler<TaskbarStatus>? Changed;

    /// <summary>The current reduced taskbar status.</summary>
    public TaskbarStatus Status
    {
        get
        {
            lock (_gate)
            {
                return TaskbarStatusReducer.Reduce(_jobs.Values);
            }
        }
    }

    /// <summary>
    /// Reports (inserts or updates) a job. A <see cref="TaskbarJobState.Complete"/> report removes the
    /// job from the taskbar. Raises <see cref="Changed"/> only when the reduced status actually moved.
    /// </summary>
    public void Report(TaskbarJob job)
    {
        ArgumentNullException.ThrowIfNull(job);
        if (string.IsNullOrEmpty(job.Id))
        {
            throw new ArgumentException("A taskbar job requires a non-empty id.", nameof(job));
        }

        TaskbarStatus status;
        lock (_gate)
        {
            if (job.State == TaskbarJobState.Complete)
            {
                _jobs.Remove(job.Id);
            }
            else
            {
                _jobs[job.Id] = job;
            }

            status = TaskbarStatusReducer.Reduce(_jobs.Values);
        }

        Changed?.Invoke(this, status);
    }

    /// <summary>Removes a job by id (e.g. after acknowledging a failure). Idempotent.</summary>
    public void Remove(string id)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);

        TaskbarStatus status;
        lock (_gate)
        {
            if (!_jobs.Remove(id))
            {
                return;
            }

            status = TaskbarStatusReducer.Reduce(_jobs.Values);
        }

        Changed?.Invoke(this, status);
    }

    /// <summary>Clears every tracked job and returns the taskbar to idle.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            if (_jobs.Count == 0)
            {
                return;
            }

            _jobs.Clear();
        }

        Changed?.Invoke(this, TaskbarStatus.Idle);
    }
}
