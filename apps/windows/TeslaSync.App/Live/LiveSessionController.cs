using TeslaSync.App.Core.Live;

namespace TeslaSync.App.Live;

/// <summary>
/// The foreground composition glue that runs a live SSE session for the Windows shell
/// (P2/W6-0001): it opens a cold <see cref="LiveSubscription"/>, binds its connection state to the
/// W2 live chrome via a <see cref="LiveConnectionPresenter"/>, and pumps every decoded event into
/// the <see cref="LiveSignalStore"/> on a background task so the UI thread is never blocked.
/// Historical series remain a W5 REST/<c>signal_log</c> responsibility — this controller only
/// maintains current live state and never reconstructs history from the stream.
///
/// <para><see cref="Start"/> is idempotent: it stops any running session first. <see cref="Stop"/>
/// cancels the pump and detaches the chrome; <see cref="Diagnostics"/> exposes the PII-redacted
/// counters for the active subscription.</para>
/// </summary>
public sealed class LiveSessionController : IDisposable
{
    private readonly ISseClient _client;
    private readonly LiveSignalStore _store;
    private readonly LiveConnectionPresenter _presenter;
    private readonly object _gate = new();
    private CancellationTokenSource? _cts;
    private Task? _pump;
    private LiveSubscription? _subscription;
    private bool _disposed;

    /// <summary>Creates the controller over the SSE client, the live store, and the chrome presenter.</summary>
    public LiveSessionController(ISseClient client, LiveSignalStore store, LiveConnectionPresenter presenter)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(presenter);
        _client = client;
        _store = store;
        _presenter = presenter;
    }

    /// <summary>The PII-redacted diagnostics of the active subscription, or <see langword="null"/> when stopped.</summary>
    public SseDiagnostics? Diagnostics
    {
        get
        {
            lock (_gate)
            {
                return _subscription?.Diagnostics;
            }
        }
    }

    /// <summary>Opens a live subscription, binds the chrome, and starts pumping events into the store.</summary>
    public void Start(string? path = null)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        Stop();

        var subscription = _client.Subscribe(path);
        var cts = new CancellationTokenSource();
        lock (_gate)
        {
            _subscription = subscription;
            _cts = cts;
        }

        _presenter.Bind(subscription.Connection);
        _pump = Task.Run(() => PumpAsync(subscription, cts.Token));
    }

    /// <summary>Cancels the active pump and detaches the chrome; safe to call when already stopped.</summary>
    public void Stop()
    {
        CancellationTokenSource? cts;
        lock (_gate)
        {
            cts = _cts;
            _cts = null;
            _subscription = null;
        }

        if (cts is null)
        {
            return;
        }

        cts.Cancel();
        cts.Dispose();
        _presenter.Unbind();
    }

    private async Task PumpAsync(LiveSubscription subscription, CancellationToken cancellationToken)
    {
        try
        {
            await _store.BindAsync(subscription, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown via Stop()/Dispose().
        }
    }

    /// <summary>Stops the session and releases the presenter.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Stop();
        _presenter.Dispose();
    }
}
