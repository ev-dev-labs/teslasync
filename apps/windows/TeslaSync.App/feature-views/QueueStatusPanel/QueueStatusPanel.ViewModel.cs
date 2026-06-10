using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QueueStatusPanel"/> view — the native port of the
/// web component's hook composition (web/src/features/admin/components/QueueStatusPanel.tsx). It drives the
/// single cache-then-network read through the <see cref="IQueueStatusSource"/> (web <c>useQueueStatus</c>),
/// projects the snapshot through <see cref="QueueStatusProjection"/>, and exposes the panel state + freshness
/// so the view is a thin renderer. The web component is purely presentational with a <c>testHookOverride</c>;
/// this holder is the native equivalent so the surface logic is verified without a UI host. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class QueueStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IQueueStatusSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private QueueStatusSnapshot _snapshot = QueueStatusSnapshot.Empty;
    private bool _disposed;

    private QueuePanelState _state = QueuePanelState.Loading;
    private QueuePanelDisplay _display = QueuePanelDisplay.Empty;
    private string? _updatedLabel;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public QueueStatusViewModel(
        IQueueStatusSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Panel state ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The panel's current lifecycle state (loading / loaded / empty / error / stale / offline).</summary>
    public QueuePanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready worker cards.</summary>
    public QueuePanelDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized "Updated {when}" caption (web <c>updatedLabel</c>), or null when unknown.</summary>
    public string? UpdatedLabel
    {
        get => _updatedLabel;
        private set => Set(ref _updatedLabel, value);
    }

    /// <summary>Last successful fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown cards are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a manual refresh + reload is running (drives the button spinner).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>Localized error message for the error/offline states (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>Panel title (web <c>queueStatus.title</c>).</summary>
    public string Title => QueueStatusRegistration.Title(_localizer);

    /// <summary>Panel subtitle (web <c>queueStatus.subtitle</c>).</summary>
    public string Subtitle => QueueStatusRegistration.Subtitle(_localizer);

    /// <summary>"Refresh" button label (web <c>queueStatus.refresh</c>).</summary>
    public string RefreshLabel => _localizer.GetString("queueStatus.refresh", "Refresh");

    /// <summary>Loading announcement (web <c>queueStatus.loading</c>).</summary>
    public string LoadingLabel =>
        _localizer.GetString("queueStatus.loading", "Loading worker status\u2026");

    /// <summary>Empty-state message (web <c>queueStatus.empty</c>).</summary>
    public string EmptyMessage => _localizer.GetString(
        "queueStatus.empty",
        "No workers are currently registered. The notification, export, and automation processes report here once they start.");

    /// <summary>Hard-failure message (web <c>queueStatus.error</c>).</summary>
    public string ErrorMessageDefault => _localizer.GetString(
        "queueStatus.error",
        "Could not load worker status. Check API logs and try again.");

    /// <summary>Retry affordance label — the web Refresh action doubles as the retry (no separate mutation).</summary>
    public string RetryLabel => RefreshLabel;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network load (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamAsync(cancellationToken);

    /// <summary>
    /// Manual "Refresh" — re-run the load with the button in its busy state (web <c>refetch()</c>). The GET
    /// endpoint is authoritative, so there is no mutation; the reload reflects current server state.
    /// </summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        try
        {
            await StreamAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <summary>Retry after a hard failure (web Refresh from the error surface).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => StreamAsync(cancellationToken);

    private async Task StreamAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        if (_snapshot.Workers.Count == 0 && !_isRefreshing)
        {
            State = QueuePanelState.Loading;
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamStatusAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
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
        Cancel(ref _cts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<QueueStatusSnapshot> result)
    {
        _snapshot = NextSnapshot(result, _snapshot);
        var now = _clock();
        Display = QueueStatusProjection.Project(_snapshot.Workers, _localizer, now);
        UpdatedLabel = QueueStatusProjection.UpdatedLabel(_snapshot.GeneratedAtInstant, _localizer, now);

        var outcome = Classify(result, _snapshot.Workers.Count);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }
    }

    private SectionOutcome Classify(RepositoryResult<QueueStatusSnapshot> result, int rowCount)
    {
        bool hasRows = rowCount > 0;
        return result.Status switch
        {
            LoadStatus.Loading => hasRows
                ? new SectionOutcome(QueuePanelState.Loaded, true, false, false, null, null)
                : new SectionOutcome(QueuePanelState.Loading, true, false, false, null, null),

            LoadStatus.Cached => new SectionOutcome(
                hasRows ? StaleOrLoaded(result.IsStale) : QueuePanelState.Empty,
                true, false, hasRows && result.IsStale, null, result.FetchedAt),

            LoadStatus.Refreshing => new SectionOutcome(
                hasRows ? StaleOrLoaded(result.IsStale) : QueuePanelState.Empty,
                true, false, hasRows && result.IsStale, null, result.FetchedAt),

            LoadStatus.Loaded => new SectionOutcome(
                hasRows ? QueuePanelState.Loaded : QueuePanelState.Empty,
                false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                QueuePanelState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasRows
                ? new SectionOutcome(QueuePanelState.Offline, false, true, true, ErrorMessageDefault, result.FetchedAt)
                : new SectionOutcome(QueuePanelState.Error, false, true, false, ErrorMessageDefault, result.FetchedAt),

            _ => new SectionOutcome(QueuePanelState.Error, false, true, false, ErrorMessageDefault, null),
        };
    }

    private static QueuePanelState StaleOrLoaded(bool stale) =>
        stale ? QueuePanelState.Stale : QueuePanelState.Loaded;

    private static QueueStatusSnapshot NextSnapshot(
        RepositoryResult<QueueStatusSnapshot> result,
        QueueStatusSnapshot previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                              // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => QueueStatusSnapshot.Empty, // resolved with nothing to show
            _ => result.Value ?? previous,                              // cached / refreshing / loaded / offline carry the snapshot
        };

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
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

    private readonly record struct SectionOutcome(
        QueuePanelState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
