namespace TeslaSync.App.Core.Notifications;

/// <summary>The category of a long-running job reflected on the taskbar (P2/W8-0001).</summary>
public enum TaskbarJobKind
{
    /// <summary>A vehicle command in flight (wake, lock, climate, …).</summary>
    Command,

    /// <summary>A data export being generated.</summary>
    Export,

    /// <summary>A backfill / sync / reconciliation job.</summary>
    Sync,
}

/// <summary>The state of a single taskbar job (P2/W8-0001).</summary>
public enum TaskbarJobState
{
    /// <summary>Running with a known fraction complete.</summary>
    Running,

    /// <summary>Running with an unknown fraction (the bar is a marquee).</summary>
    Indeterminate,

    /// <summary>Paused, awaiting input or a dependency.</summary>
    Paused,

    /// <summary>Failed — needs the user's attention.</summary>
    Error,

    /// <summary>Finished successfully (no longer contributes to the taskbar).</summary>
    Complete,
}

/// <summary>
/// One real, in-flight job whose progress is mirrored on the Windows taskbar (P2/W8-0001). Jobs are
/// reported by the feature that owns them (a command call, an export, a sync) — never fabricated — so
/// the taskbar only ever reflects work the app is genuinely doing. <see cref="Progress"/> is a
/// fraction in <c>[0, 1]</c> and is only meaningful for <see cref="TaskbarJobState.Running"/>.
/// </summary>
public sealed record TaskbarJob(string Id, TaskbarJobKind Kind, TaskbarJobState State, double Progress = 0)
{
    /// <summary>Creates a determinate running job at <paramref name="progress"/>.</summary>
    public static TaskbarJob Running(string id, TaskbarJobKind kind, double progress) =>
        new(id, kind, TaskbarJobState.Running, progress);

    /// <summary>Creates an indeterminate running job.</summary>
    public static TaskbarJob Indeterminate(string id, TaskbarJobKind kind) =>
        new(id, kind, TaskbarJobState.Indeterminate);

    /// <summary>Creates a failed job.</summary>
    public static TaskbarJob Failed(string id, TaskbarJobKind kind) =>
        new(id, kind, TaskbarJobState.Error);

    /// <summary>Creates a completed job (which no longer contributes to the taskbar).</summary>
    public static TaskbarJob Completed(string id, TaskbarJobKind kind) =>
        new(id, kind, TaskbarJobState.Complete);
}
