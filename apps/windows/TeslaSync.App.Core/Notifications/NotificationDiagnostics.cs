namespace TeslaSync.App.Core.Notifications;

/// <summary>An immutable, PII-safe snapshot of the notification-polish diagnostics counters.</summary>
public sealed record NotificationDiagnosticsSnapshot(
    long Ingested,
    long BannersRaised,
    long ToastsPresented,
    long ToastsSuppressed,
    long ActivationsRouted,
    long TaskbarUpdates,
    long JumpListBuilds);

/// <summary>
/// Collects PII-redacted diagnostics for the notification-polish surfaces (P2/W8-0001, ADR-016). Like
/// the push diagnostics it records only operational counters and the notification <em>kind</em> token
/// (never a title, body, VIN, location, route argument or any content), so a diagnostics line can
/// never leak what a notification was about. Thread-safe.
/// </summary>
public sealed class NotificationDiagnostics
{
    private readonly object _gate = new();
    private readonly Action<string>? _sink;
    private long _ingested;
    private long _bannersRaised;
    private long _toastsPresented;
    private long _toastsSuppressed;
    private long _activationsRouted;
    private long _taskbarUpdates;
    private long _jumpListBuilds;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public NotificationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Records that a notification was recorded in the inbox.</summary>
    public void RecordIngested(NotificationKind kind) => Bump(ref _ingested, "ingested", kind);

    /// <summary>Records that an in-app banner was raised.</summary>
    public void RecordBanner(NotificationKind kind) => Bump(ref _bannersRaised, "banner", kind);

    /// <summary>Records that an OS toast was presented.</summary>
    public void RecordToast(NotificationKind kind) => Bump(ref _toastsPresented, "toast", kind);

    /// <summary>Records that the user-facing surfaces were suppressed (inbox-only).</summary>
    public void RecordToastSuppressed(NotificationKind kind) => Bump(ref _toastsSuppressed, "suppressed", kind);

    /// <summary>Records that a toast activation was routed to a destination.</summary>
    public void RecordActivation(NotificationKind kind) => Bump(ref _activationsRouted, "activation", kind);

    /// <summary>Records that the taskbar status was updated from the active jobs.</summary>
    public void RecordTaskbarUpdate() => Bump(ref _taskbarUpdates, "taskbar", null);

    /// <summary>Records that the jump list was (re)built.</summary>
    public void RecordJumpListBuild() => Bump(ref _jumpListBuilds, "jumplist", null);

    /// <summary>Captures an immutable, PII-safe snapshot of the current counters.</summary>
    public NotificationDiagnosticsSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new NotificationDiagnosticsSnapshot(
                _ingested,
                _bannersRaised,
                _toastsPresented,
                _toastsSuppressed,
                _activationsRouted,
                _taskbarUpdates,
                _jumpListBuilds);
        }
    }

    private void Bump(ref long counter, string action, NotificationKind? kind)
    {
        lock (_gate)
        {
            counter++;
        }

        if (_sink is null)
        {
            return;
        }

        var line = kind is { } k ? $"notification {action} kind={NotificationKinds.ToWire(k)}" : $"notification {action}";
        _sink(line);
    }
}
