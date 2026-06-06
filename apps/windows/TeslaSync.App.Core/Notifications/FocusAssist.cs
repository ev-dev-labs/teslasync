namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The OS-level "do not disturb" state that gates whether an ordinary toast may be shown
/// (P2/W8-0001). It is the cross-cutting Windows Focus Assist / quiet-hours signal; the platform
/// reads it from the shell notification state, and the delivery policy suppresses ordinary OS toasts
/// while it is <see cref="PriorityOnly"/> or <see cref="AlarmsOnly"/>.
/// </summary>
public enum FocusAssistState
{
    /// <summary>Focus Assist is off — notifications are allowed.</summary>
    Off = 0,

    /// <summary>Only priority notifications are shown — suppress ordinary toasts.</summary>
    PriorityOnly,

    /// <summary>Only alarms are shown — suppress all toasts.</summary>
    AlarmsOnly,

    /// <summary>The state could not be determined — treated as <see cref="Off"/> (allow).</summary>
    Unknown,
}

/// <summary>
/// The seam over the platform Focus Assist / quiet-hours query (P2/W8-0001). The Windows
/// implementation reads <c>SHQueryUserNotificationState</c>; the headless default
/// (<see cref="AvailableFocusAssist"/>) reports <see cref="FocusAssistState.Off"/> so notifications
/// flow in tests and on hosts without the shell API.
/// </summary>
public interface IFocusAssistProvider
{
    /// <summary>The current Focus Assist / quiet-hours state.</summary>
    FocusAssistState Current { get; }
}

/// <summary>An <see cref="IFocusAssistProvider"/> that always reports <see cref="FocusAssistState.Off"/>.</summary>
public sealed class AvailableFocusAssist : IFocusAssistProvider
{
    /// <summary>The shared singleton instance.</summary>
    public static AvailableFocusAssist Instance { get; } = new();

    private AvailableFocusAssist()
    {
    }

    /// <inheritdoc />
    public FocusAssistState Current => FocusAssistState.Off;
}
