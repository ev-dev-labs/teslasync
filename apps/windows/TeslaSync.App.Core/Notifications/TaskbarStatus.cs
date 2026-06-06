namespace TeslaSync.App.Core.Notifications;

/// <summary>The taskbar progress-bar mode the platform applies (P2/W8-0001).</summary>
public enum TaskbarProgressState
{
    /// <summary>No progress shown — the taskbar button is idle.</summary>
    None,

    /// <summary>A normal (green) determinate progress bar.</summary>
    Normal,

    /// <summary>An indeterminate (marquee) bar — work in progress, unknown fraction.</summary>
    Indeterminate,

    /// <summary>A paused (yellow) bar.</summary>
    Paused,

    /// <summary>An error (red) bar — a job failed.</summary>
    Error,
}

/// <summary>
/// The reduced taskbar state derived from the active jobs (P2/W8-0001): the progress-bar
/// <see cref="State"/> and <see cref="Progress"/>, plus the overlay <see cref="BadgeCount"/> and the
/// honest active/error tallies behind it. Produced by <see cref="TaskbarStatusReducer"/> and applied
/// by the platform taskbar service. <see cref="Idle"/> is the empty state — no jobs, no badge.
/// </summary>
public sealed record TaskbarStatus(
    TaskbarProgressState State,
    double Progress,
    int BadgeCount,
    int ActiveCount,
    int ErrorCount)
{
    /// <summary>The empty taskbar state: nothing running, no badge.</summary>
    public static TaskbarStatus Idle { get; } = new(TaskbarProgressState.None, 0, 0, 0, 0);

    /// <summary>True when an overlay badge should be shown.</summary>
    public bool HasBadge => BadgeCount > 0;
}
