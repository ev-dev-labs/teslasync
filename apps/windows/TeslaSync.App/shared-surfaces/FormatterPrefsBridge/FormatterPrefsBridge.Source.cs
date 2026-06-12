using System.Text.Json;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The settings state-holder seam the formatter-preferences bridge consults (P1/S8) — the native analogue of the
/// TanStack Query result the web <c>FormatterPrefsBridge</c> reads through <c>useSettings()</c>
/// (web/src/api/hooks/useSettings.ts → <c>GET /settings</c>). It exposes the current resolved
/// <see cref="FormatterPrefsSnapshot"/> (the web query <c>data</c> projected to its locale + precision),
/// raising <see cref="Changed"/> whenever it moves, and a <see cref="Refresh"/> trigger (the web
/// <c>queryClient.invalidateQueries(['settings'])</c> that forces a refetch). A null <see cref="Current"/>
/// models the web <c>settings === undefined</c> state — no snapshot has resolved yet, so the bridge applies
/// nothing (the web effect's <c>if (!settings) return</c>). The view never reads a query or performs HTTP
/// itself — it binds to this seam, exactly as the web component subscribes to the settings query. The
/// production binding is <see cref="RepositoryFormatterPrefsSource"/> over the cache-then-network settings
/// stream; <see cref="StaticFormatterPrefsSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface IFormatterPrefsSource
{
    /// <summary>
    /// The current resolved snapshot, or <see langword="null"/> when settings have not resolved yet (web
    /// <c>settings === undefined</c>).
    /// </summary>
    FormatterPrefsSnapshot? Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Force a settings refetch — the native analogue of the web
    /// <c>queryClient.invalidateQueries({ queryKey: ['settings'] })</c> the bridge fires on a settings-changed
    /// broadcast. A no-op for sources without a live stream.
    /// </summary>
    void Refresh();
}

/// <summary>
/// An <see cref="IFormatterPrefsSource"/> with an explicit, caller-set snapshot and a counted
/// <see cref="Refresh"/> — the headless / unit-test default. It lets the bridge view-model be exercised for the
/// resolve / re-resolve / de-dupe branches (and the refetch forwarding) without a repository or a UI host. The
/// initial snapshot defaults to <see langword="null"/> (the web <c>settings === undefined</c> state); call
/// <see cref="Set"/> to resolve or move it (raising <see cref="Changed"/>); <see cref="Refresh"/> increments
/// <see cref="RefreshCount"/> and raises <see cref="Changed"/> so a test can assert the bridge forwarded a
/// refetch request.
/// </summary>
public sealed class StaticFormatterPrefsSource : IFormatterPrefsSource
{
    private FormatterPrefsSnapshot? _current;

    /// <summary>Creates a source over an optional initial snapshot (null = the unresolved state).</summary>
    /// <param name="current">The initial snapshot, or null for the web <c>settings === undefined</c> state.</param>
    public StaticFormatterPrefsSource(FormatterPrefsSnapshot? current = null) => _current = current;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public FormatterPrefsSnapshot? Current => _current;

    /// <summary>The number of times <see cref="Refresh"/> has been invoked (for refetch-forwarding assertions).</summary>
    public int RefreshCount { get; private set; }

    /// <summary>Resolve or move the snapshot and raise <see cref="Changed"/> (the web settings query re-resolving).</summary>
    /// <param name="snapshot">The new snapshot, or null to return to the unresolved state.</param>
    public void Set(FormatterPrefsSnapshot? snapshot)
    {
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Refresh()
    {
        RefreshCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IFormatterPrefsSource"/> — binds the bridge to the cache-then-network settings
/// stream, the native analogue of the web <c>useSettings()</c> query (<c>ISettingsRepository.GetSettingsAsync</c>
/// → <c>GET /settings</c>). The composition root supplies the stream factory
/// (<c>ct =&gt; settingsRepository.GetSettingsAsync(ct)</c>); each content-bearing
/// <see cref="RepositoryResult{T}"/> emission is projected to a <see cref="FormatterPrefsSnapshot"/> via
/// <see cref="FormatterPrefsSnapshot.FromJson"/> and surfaced through <see cref="Current"/> / <see cref="Changed"/>.
/// Value-less emissions (loading with no cache, empty, hard error) leave the last resolved snapshot in place —
/// the web query keeps its last <c>data</c> across a background refetch and stays <c>undefined</c> until the
/// first success. <see cref="Refresh"/> re-runs the stream (web <c>invalidateQueries(['settings'])</c>); a
/// monotonic generation guard discards emissions from a superseded run so the latest refresh wins. The whole
/// class is WinUI-free so it is unit-tested against an in-memory stream without a UI host.
/// </summary>
public sealed class RepositoryFormatterPrefsSource : IFormatterPrefsSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<JsonElement>>> _stream;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private FormatterPrefsSnapshot? _current;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a settings stream factory.</summary>
    /// <param name="stream">
    /// The cache-then-network settings stream factory (web query function), e.g.
    /// <c>ct =&gt; settingsRepository.GetSettingsAsync(ct)</c>.
    /// </param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    /// <exception cref="ArgumentNullException">The stream factory is null.</exception>
    public RepositoryFormatterPrefsSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<JsonElement>>> stream,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        _stream = stream;

        if (autoStart)
        {
            Refresh();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public FormatterPrefsSnapshot? Current
    {
        get
        {
            lock (_gate)
            {
                return _current;
            }
        }
    }

    /// <inheritdoc />
    public void Refresh()
    {
        if (_disposed)
        {
            return;
        }

        var generation = Interlocked.Increment(ref _generation);
        _ = PumpAsync(generation);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();
        _lifetime.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task PumpAsync(int generation)
    {
        try
        {
            await foreach (var result in _stream(_lifetime.Token).ConfigureAwait(false))
            {
                if (Volatile.Read(ref _generation) != generation)
                {
                    // A newer Refresh superseded this run; stop applying its emissions.
                    return;
                }

                // Only content-bearing emissions carry a settings document — Loading / Empty / Error do not, and
                // for a value-type payload (JsonElement) the generic `HasValue` cannot distinguish them, so gate
                // on the status. The web query likewise keeps its last `data` across these states.
                if (result.Status is LoadStatus.Loaded or LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Offline)
                {
                    Update(FormatterPrefsSnapshot.FromJson(result.Value));
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by Dispose (lifetime cancelled); nothing to surface.
        }
        catch (ObjectDisposedException)
        {
            // The lifetime token source was disposed mid-enumeration during Dispose; safe to ignore.
        }
    }

    private void Update(FormatterPrefsSnapshot snapshot)
    {
        lock (_gate)
        {
            if (_current == snapshot)
            {
                return;
            }

            _current = snapshot;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The settings-changed broadcast seam — the native analogue of the web <c>subscribe(... TOPICS.SETTINGS_CHANGED ...)</c>
/// channel the bridge listens on as defense-in-depth (web/src/lib/broadcast.ts). A peer that mutates settings
/// outside the query layer raises this signal, and the bridge responds by forcing a settings refetch
/// (<see cref="IFormatterPrefsSource.Refresh"/>), exactly as the web handler calls
/// <c>queryClient.invalidateQueries(['settings'])</c>. Optional: a bridge wired without a signal simply omits the
/// defense-in-depth path, the way a host that never broadcasts settings changes still gets correct sync from the
/// settings query alone.
/// </summary>
public interface ISettingsChangeSignal
{
    /// <summary>Raised when a settings-changed broadcast arrives (web <c>msg.type === TOPICS.SETTINGS_CHANGED</c>).</summary>
    event EventHandler? SettingsChanged;
}

/// <summary>
/// An <see cref="ISettingsChangeSignal"/> a host (or a test) raises explicitly via <see cref="Raise"/> — the
/// native analogue of a peer firing the <c>settings.changed</c> broadcast topic. Lets the bridge's
/// defense-in-depth refetch path be driven without a real cross-process broadcast bus.
/// </summary>
public sealed class StaticSettingsChangeSignal : ISettingsChangeSignal
{
    /// <inheritdoc />
    public event EventHandler? SettingsChanged;

    /// <summary>Raise the settings-changed signal (the web broadcast arriving).</summary>
    public void Raise() => SettingsChanged?.Invoke(this, EventArgs.Empty);
}
