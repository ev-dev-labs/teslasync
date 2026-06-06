using System.Globalization;
using TeslaSync.App.Core.Auth;

namespace TeslaSync.App.Core.Push;

/// <summary>An immutable, PII-safe snapshot of the push diagnostics counters.</summary>
public sealed record PushDiagnosticsSnapshot(
    int RegisterCount,
    int RenewCount,
    int UnregisterCount,
    int FailureCount,
    long PayloadsRouted,
    string? LastAction,
    DateTimeOffset? LastActionAt);

/// <summary>
/// Collects PII-redacted diagnostics for the push layer (P2/W6-0002, ADR-016). It records only
/// operational counters and the last action name — never a channel URI, token, payload title/body,
/// VIN or location — and every emitted line is passed through <see cref="PushRedaction"/> and
/// <see cref="TokenRedaction"/> so a misrouted diagnostics line can never leak a secret.
/// </summary>
public sealed class PushDiagnostics
{
    private readonly object _gate = new();
    private readonly Action<string>? _sink;
    private readonly Func<DateTimeOffset> _clock;
    private int _registerCount;
    private int _renewCount;
    private int _unregisterCount;
    private int _failureCount;
    private long _payloadsRouted;
    private string? _lastAction;
    private DateTimeOffset? _lastActionAt;

    /// <summary>Creates the collector over an optional redacting sink and an optional clock seam.</summary>
    public PushDiagnostics(Action<string>? sink = null, Func<DateTimeOffset>? clock = null)
    {
        _sink = sink;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <summary>Records a successful device registration.</summary>
    public void RecordRegister() => Record("register", ref _registerCount);

    /// <summary>Records a channel renewal / re-registration.</summary>
    public void RecordRenew() => Record("renew", ref _renewCount);

    /// <summary>Records a device unregister / sign-out cleanup.</summary>
    public void RecordUnregister() => Record("unregister", ref _unregisterCount);

    /// <summary>Records a failed registration/renewal/unregister with a PII-free <paramref name="reason"/>.</summary>
    public void RecordFailure(string reason)
    {
        lock (_gate)
        {
            _failureCount++;
            _lastAction = "failure:" + reason;
            _lastActionAt = _clock();
        }

        Emit($"push failure reason={reason}");
    }

    /// <summary>Records that one foreground push payload was routed into the app.</summary>
    public void RecordPayloadRouted()
    {
        lock (_gate)
        {
            _payloadsRouted++;
            _lastAction = "payload_routed";
            _lastActionAt = _clock();
        }

        Emit("push payload routed");
    }

    /// <summary>Captures an immutable, PII-safe snapshot of the current counters.</summary>
    public PushDiagnosticsSnapshot Snapshot()
    {
        lock (_gate)
        {
            return new PushDiagnosticsSnapshot(
                _registerCount,
                _renewCount,
                _unregisterCount,
                _failureCount,
                _payloadsRouted,
                _lastAction,
                _lastActionAt);
        }
    }

    private void Record(string action, ref int counter)
    {
        int value;
        lock (_gate)
        {
            value = ++counter;
            _lastAction = action;
            _lastActionAt = _clock();
        }

        Emit($"push {action} count={value.ToString(CultureInfo.InvariantCulture)}");
    }

    private void Emit(string line)
    {
        if (_sink is null)
        {
            return;
        }

        _sink(PushRedaction.Redact(TokenRedaction.Redact(line)));
    }
}
