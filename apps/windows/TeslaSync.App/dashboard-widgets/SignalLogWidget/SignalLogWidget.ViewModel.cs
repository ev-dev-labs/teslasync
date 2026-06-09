using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="SignalLogViewModel"/> binds to for the feed (P1/S8 state-holder seam).
/// It yields the cache-then-network sequence of parsed observation snapshots for
/// <c>GET /signals/observations</c> — the native analogue of the web <c>useVehicles</c> +
/// <c>useSignalObservations</c> hook composition
/// (web/src/features/dashboard/widgets/SignalLogWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="SignalLogSource"/> (or a test fake) drives this.
/// </summary>
public interface ISignalLogSource
{
    /// <summary>Stream the cache-then-network observation snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalLogObservation>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The data port supplying the compact view's signals/second rate (P1/S8 state-holder seam) — the
/// native analogue of the web <c>useMQTTStatus</c> hook (web/src/features/dashboard/widgets/SignalLogWidget.tsx).
/// Best-effort: the feed never depends on it, and the view-model leaves the rate unchanged on a failed
/// emission. The concrete <see cref="SignalRateSource"/> (or a test fake) drives this.
/// </summary>
public interface ISignalRateSource
{
    /// <summary>Stream the cache-then-network aggregate signals/second rate.</summary>
    IAsyncEnumerable<RepositoryResult<double>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Signal Log surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/telemetry.ts (<c>signal-log</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class SignalLogRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "signal-log";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "telemetry";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalLogWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SignalLogSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static SignalLogSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SignalLogSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Signal Log").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.signalLog.title", "Signal Log");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.signalLog.description",
            "Live feed of raw signal updates: timestamp, signal, old\u2192new value, source");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SignalLogSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SignalLogSize Clamp(SignalLogSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Signal Log surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, value, VIN or
/// vehicle id — so a diagnostics line can never leak what a vehicle was reporting. Thread-safe.
/// </summary>
public sealed class SignalLogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalLogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalLogWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalLogRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SignalLogWidget"/> view — the native port
/// of the web <c>SignalLogWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SignalLogWidget.tsx). It consumes the cache-then-network
/// <see cref="ISignalLogSource"/> (projecting each snapshot through <see cref="SignalLogProjection"/>),
/// optionally the <see cref="ISignalRateSource"/> for the compact signals/second readout, and exposes the
/// mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer.
/// The <see cref="IsPaused"/> toggle freezes the displayed feed on the latest snapshot (web
/// <c>pausedDataRef</c>). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SignalLogViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalLogSource _source;
    private readonly ISignalRateSource? _rateSource;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private SignalLogSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<SignalLogObservation>>? _last;
    private bool _disposed;

    private SignalLogState _state = SignalLogState.Loading;
    private IReadOnlyList<SignalLogRow> _liveRows = Array.Empty<SignalLogRow>();
    private IReadOnlyList<SignalLogRow> _displayRows = Array.Empty<SignalLogRow>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _paused;
    private double _rate;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its feed source, optional rate source, localizer, footprint and clock.</summary>
    /// <param name="source">The cache-then-network observation feed source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    /// <param name="rateSource">Optional signals/second source for the compact view; null disables the readout.</param>
    /// <param name="clock">Injected clock for deterministic relative-time projection; defaults to the wall clock.</param>
    public SignalLogViewModel(
        ISignalLogSource source,
        ILocalizer localizer,
        SignalLogSize size,
        ISignalRateSource? rateSource = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _rateSource = rateSource;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SignalLogState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The rows currently shown — the live projection, or the frozen snapshot while paused.</summary>
    public IReadOnlyList<SignalLogRow> Rows => _displayRows;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last feed load failed (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown rows are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while the feed is frozen on its last snapshot (web <c>paused</c>).</summary>
    public bool IsPaused
    {
        get => _paused;
        private set
        {
            if (Set(ref _paused, value))
            {
                Raise(nameof(PauseToggleLabel));
            }
        }
    }

    /// <summary>The aggregate signals/second shown in the compact view (web <c>rate</c>); 0 until known.</summary>
    public double Rate
    {
        get => _rate;
        private set => Set(ref _rate, value);
    }

    /// <summary>Localized error message shown in the error surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of feed load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when there is at least one row to render.</summary>
    public bool HasRows => _displayRows.Count > 0;

    /// <summary>True at a single column: the compact signals/second big number replaces the feed.</summary>
    public bool IsCompact => _size.IsCompact;

    /// <summary>Localized widget title (web <c>widget.signalLog.title</c>).</summary>
    public string Title => _localizer.GetString("widget.signalLog.title", "Signal Log");

    /// <summary>Localized empty-state message (web <c>widget.signalLog.noSignals</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.signalLog.noSignals", "No signal updates yet");

    /// <summary>Localized units label under the compact big number (web <c>widget.signalLog.signalsPerSec</c>).</summary>
    public string RatePerSecLabel => _localizer.GetString("widget.signalLog.signalsPerSec", "signals/sec");

    /// <summary>Localized pause/resume action label, flipping with <see cref="IsPaused"/> (web aria-label).</summary>
    public string PauseToggleLabel => _paused
        ? _localizer.GetString("widget.signalLog.resume", "Resume")
        : _localizer.GetString("widget.signalLog.pause", "Pause");

    /// <summary>The widget footprint; reassigning re-projects the current rows and re-evaluates the compact branch.</summary>
    public SignalLogSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            bool compactChanged = _size.IsCompact != value.IsCompact;
            _size = value;
            Raise(nameof(Size));
            if (compactChanged)
            {
                // The view swaps between the feed and the signals/sec big number on this change.
                Raise(nameof(IsCompact));
            }
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when no rows are
    /// already visible (otherwise keeps content while refreshing), folds every feed emission into
    /// <see cref="State"/> + <see cref="Rows"/>, and concurrently tracks the best-effort signals/second
    /// rate. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasRows)
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await Task.WhenAll(
                ConsumeFeedAsync(cts.Token),
                ConsumeRateAsync(cts.Token)).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>Toggle the paused state — freezing or thawing the displayed feed (web <c>handleTogglePause</c>).</summary>
    public void TogglePause()
    {
        IsPaused = !_paused;
        if (!_paused && _last is { } last)
        {
            // Resuming: re-fold the latest snapshot so the now-thawed feed catches up.
            Apply(last);
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task ConsumeFeedAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _source.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            Apply(result);
        }
    }

    private async Task ConsumeRateAsync(CancellationToken cancellationToken)
    {
        if (_rateSource is null)
        {
            return;
        }

        await foreach (var result in _rateSource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            // Best-effort: only content-bearing statuses move the readout (RepositoryResult.HasValue
            // is unreliable for value-type payloads); a loading / empty / failed emission leaves it as-is.
            if (result.Status is LoadStatus.Loaded or LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Offline)
            {
                Rate = result.Value;
            }
        }
    }

    private void Apply(RepositoryResult<IReadOnlyList<SignalLogObservation>> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasRows)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyRows(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyRows(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyRows(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                ApplyRows(Array.Empty<SignalLogObservation>(), result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Offline:
                ApplyRows(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyRows(
        IReadOnlyList<SignalLogObservation> observations,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _liveRows = SignalLogProjection.Project(observations, _clock());

        // Web parity (pausedDataRef): the displayed feed only follows the live projection while running;
        // paused, it stays frozen on the snapshot captured when the pause began.
        if (!_paused)
        {
            SetDisplayRows(_liveRows);
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // With no rows to show (and not frozen on a prior snapshot) the feed renders its empty state.
        State = _displayRows.Count == 0
            ? SignalLogState.Empty
            : offline ? SignalLogState.Offline : stale ? SignalLogState.Stale : SignalLogState.Loaded;
    }

    private void SetDisplayRows(IReadOnlyList<SignalLogRow> rows)
    {
        _displayRows = rows;
        Raise(nameof(Rows));
        Raise(nameof(HasRows));
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SignalLogState.Loading;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SignalLogState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.signalLog.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.signalLog.error.offline",
            _ => "widget.signalLog.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the signal log",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached signals",
            _ => "Couldn't load the signal log",
        };

        return _localizer.GetString(key, fallback);
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
