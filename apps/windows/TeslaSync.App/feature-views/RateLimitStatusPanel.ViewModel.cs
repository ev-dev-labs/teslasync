using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RateLimitStatusPanel"/> view — the native port
/// of the web component's hook composition (web/src/features/admin/components/RateLimitStatusPanel.tsx). It
/// drives the single cache-then-network read through the <see cref="IRateLimitStatusSource"/> (web
/// <c>useRateLimitStatus</c>), projects the snapshot through <see cref="RateLimitStatusProjection"/>, and
/// exposes the panel state + freshness so the view is a thin renderer. The web component is purely
/// presentational with a <c>testHookOverride</c>; this holder is the native equivalent so the surface logic
/// is verified without a UI host. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class RateLimitStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRateLimitStatusSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private RateLimitStatusSnapshot _snapshot = RateLimitStatusSnapshot.Empty;
    private bool _disposed;

    private RateLimitPanelState _state = RateLimitPanelState.Loading;
    private RateLimitPanelDisplay _display = RateLimitPanelDisplay.Empty;
    private string? _updatedLabel;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public RateLimitStatusViewModel(
        IRateLimitStatusSource source,
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
    public RateLimitPanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready budget rows.</summary>
    public RateLimitPanelDisplay Display
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

    /// <summary>True when the shown rows are older than the freshness window.</summary>
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

    /// <summary>Panel title (web <c>rateLimitStatus.title</c>).</summary>
    public string Title => RateLimitStatusRegistration.Title(_localizer);

    /// <summary>Panel subtitle (web <c>rateLimitStatus.subtitle</c>).</summary>
    public string Subtitle => RateLimitStatusRegistration.Subtitle(_localizer);

    /// <summary>"Refresh" button label (web <c>rateLimitStatus.refresh</c>).</summary>
    public string RefreshLabel => _localizer.GetString("rateLimitStatus.refresh", "Refresh");

    /// <summary>Loading announcement (web <c>rateLimitStatus.loading</c>).</summary>
    public string LoadingLabel =>
        _localizer.GetString("rateLimitStatus.loading", "Loading rate-limit status\u2026");

    /// <summary>Empty-state message (web <c>rateLimitStatus.empty</c>).</summary>
    public string EmptyMessage => _localizer.GetString(
        "rateLimitStatus.empty",
        "No rate-limited resources are currently observed. Counters appear here once the API has handled at least one request.");

    /// <summary>Hard-failure message (web <c>rateLimitStatus.error</c>).</summary>
    public string ErrorMessageDefault => _localizer.GetString(
        "rateLimitStatus.error",
        "Could not load rate-limit status. Check API logs and try again.");

    /// <summary>Retry affordance label — the web Refresh action doubles as the retry (no separate mutation).</summary>
    public string RetryLabel => RefreshLabel;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network load (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamAsync(cancellationToken);

    /// <summary>
    /// Manual "Refresh" — re-run the load with the button in its busy state (web <c>refetch()</c>). The
    /// GET endpoint is authoritative, so there is no mutation; the reload reflects current server state.
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
        if (_snapshot.Scopes.Count == 0 && !_isRefreshing)
        {
            State = RateLimitPanelState.Loading;
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

    private void Apply(RepositoryResult<RateLimitStatusSnapshot> result)
    {
        _snapshot = NextSnapshot(result, _snapshot);
        var now = _clock();
        Display = RateLimitStatusProjection.Project(_snapshot.Scopes, _localizer, now);
        UpdatedLabel = RateLimitStatusProjection.UpdatedLabel(_snapshot.GeneratedAtInstant, _localizer, now);

        var outcome = Classify(result, _snapshot.Scopes.Count);
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

    private SectionOutcome Classify(RepositoryResult<RateLimitStatusSnapshot> result, int rowCount)
    {
        bool hasRows = rowCount > 0;
        return result.Status switch
        {
            LoadStatus.Loading => hasRows
                ? new SectionOutcome(RateLimitPanelState.Loaded, true, false, false, null, null)
                : new SectionOutcome(RateLimitPanelState.Loading, true, false, false, null, null),

            LoadStatus.Cached => new SectionOutcome(
                hasRows ? StaleOrLoaded(result.IsStale) : RateLimitPanelState.Empty,
                true, false, hasRows && result.IsStale, null, result.FetchedAt),

            LoadStatus.Refreshing => new SectionOutcome(
                hasRows ? StaleOrLoaded(result.IsStale) : RateLimitPanelState.Empty,
                true, false, hasRows && result.IsStale, null, result.FetchedAt),

            LoadStatus.Loaded => new SectionOutcome(
                hasRows ? RateLimitPanelState.Loaded : RateLimitPanelState.Empty,
                false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                RateLimitPanelState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasRows
                ? new SectionOutcome(RateLimitPanelState.Offline, false, true, true, ErrorMessageDefault, result.FetchedAt)
                : new SectionOutcome(RateLimitPanelState.Error, false, true, false, ErrorMessageDefault, result.FetchedAt),

            _ => new SectionOutcome(RateLimitPanelState.Error, false, true, false, ErrorMessageDefault, null),
        };
    }

    private static RateLimitPanelState StaleOrLoaded(bool stale) =>
        stale ? RateLimitPanelState.Stale : RateLimitPanelState.Loaded;

    private static RateLimitStatusSnapshot NextSnapshot(
        RepositoryResult<RateLimitStatusSnapshot> result,
        RateLimitStatusSnapshot previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                              // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => RateLimitStatusSnapshot.Empty, // resolved with nothing to show
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
        RateLimitPanelState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
