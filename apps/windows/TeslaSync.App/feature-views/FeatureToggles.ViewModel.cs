using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FeatureToggles"/> view — the native port of the
/// web component's hook composition (web/src/features/settings/components/FeatureToggles.tsx). It drives the
/// cache-then-network read through the <see cref="IFeatureTogglesSource"/> (web <c>useTeslaFeatureConfig</c>),
/// runs the refresh mutation (web <c>useRefreshTeslaFeatureConfig</c>) raising a localized
/// <see cref="ToastRequested"/> on success/failure, projects the snapshot through
/// <see cref="FeatureTogglesProjection"/>, and exposes the panel state + freshness so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FeatureTogglesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFeatureTogglesSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private FeatureConfigSnapshot _snapshot = FeatureConfigSnapshot.Empty;
    private bool _disposed;

    private FeatureTogglesState _state = FeatureTogglesState.Loading;
    private FeatureTogglesDisplay _display = FeatureTogglesDisplay.Empty;
    private string? _lastSyncedLabel;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public FeatureTogglesViewModel(
        IFeatureTogglesSource source,
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

    /// <summary>Raised when the refresh mutation completes (web <c>toast.success</c> / <c>toast.error</c>).</summary>
    public event EventHandler<FeatureToggleToast>? ToastRequested;

    // ── Panel state ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>The panel's current lifecycle state (loading / loaded / empty / error / stale / offline).</summary>
    public FeatureTogglesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready table model.</summary>
    public FeatureTogglesDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized "Synced {when}" caption (web <c>lastSynced</c>), or null when unknown.</summary>
    public string? LastSyncedLabel
    {
        get => _lastSyncedLabel;
        private set => Set(ref _lastSyncedLabel, value);
    }

    /// <summary>Last successful client fetch timestamp (drives the freshness chip).</summary>
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

    /// <summary>True when the shown entries are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a manual refresh mutation is running (drives the button spinner).</summary>
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

    /// <summary>Load attempts so far (including retries and refresh-triggered reloads).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>Panel title (web <c>featureConfig.title</c>).</summary>
    public string Title => FeatureTogglesRegistration.Title(_localizer);

    /// <summary>Panel subtitle (web <c>featureConfig.subtitle</c>).</summary>
    public string Subtitle => FeatureTogglesRegistration.Subtitle(_localizer);

    /// <summary>"Refresh" button label (web <c>featureConfig.refresh</c>).</summary>
    public string RefreshLabel => _localizer.GetString("translation.featureConfig.refresh", "Refresh");

    /// <summary>Loading announcement (shared <c>common.loading</c>).</summary>
    public string LoadingLabel => _localizer.GetString("translation.common.loading", "Loading\u2026");

    /// <summary>Empty-state message (web <c>featureConfig.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString(
        "translation.featureConfig.noData",
        "No feature config data yet. Click Refresh to fetch from Tesla.");

    /// <summary>Hard-failure default message (web <c>toast.featureConfigFailed</c>).</summary>
    public string ErrorMessageDefault =>
        _localizer.GetString("translation.toast.featureConfigFailed", "Failed to refresh feature config");

    /// <summary>Retry affordance label (shared <c>common.retry</c>).</summary>
    public string RetryLabel => _localizer.GetString("translation.common.retry", "Retry");

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network load (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamAsync(cancellationToken);

    /// <summary>
    /// Manual "Refresh" — run the refresh mutation, then (on success) reload from the network so the table and
    /// freshness reflect the re-pulled config. Mirrors the web mutation's <c>onSuccess</c>
    /// (toast + <c>invalidateQueries</c> refetch) and <c>onError</c> (toast) exactly. A failed mutation leaves
    /// the current table untouched, surfacing only the error toast.
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
            var outcome = await _source.RefreshAsync(cancellationToken).ConfigureAwait(false);
            if (outcome.Succeeded)
            {
                RaiseToast(FeatureToggleToast.Success(_localizer));
                await StreamAsync(cancellationToken).ConfigureAwait(false);
            }
            else
            {
                RaiseToast(FeatureToggleToast.Failure(_localizer, outcome.Error));
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer run (or disposed) — drop this refresh silently.
        }
        finally
        {
            IsRefreshing = false;
            IsFetching = false;
        }
    }

    /// <summary>Retry after a hard failure (web Refresh from the error surface re-runs the query).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => StreamAsync(cancellationToken);

    private async Task StreamAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        if (_snapshot.Entries.Count == 0 && !_isRefreshing)
        {
            State = FeatureTogglesState.Loading;
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamConfigAsync(cts.Token).ConfigureAwait(false))
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

    private void Apply(RepositoryResult<FeatureConfigSnapshot> result)
    {
        _snapshot = NextSnapshot(result, _snapshot);
        var now = _clock();
        Display = FeatureTogglesProjection.Project(_snapshot.Entries, _localizer);
        LastSyncedLabel = FeatureTogglesProjection.LastSyncedLabel(_snapshot.FetchedAtInstant, _localizer, now);

        var outcome = Classify(result, _snapshot.Entries.Count);
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

    private SectionOutcome Classify(RepositoryResult<FeatureConfigSnapshot> result, int rowCount)
    {
        bool hasRows = rowCount > 0;
        return result.Status switch
        {
            LoadStatus.Loading => hasRows
                ? new SectionOutcome(FeatureTogglesState.Loaded, true, false, false, null, null)
                : new SectionOutcome(FeatureTogglesState.Loading, true, false, false, null, null),

            LoadStatus.Cached => new SectionOutcome(
                hasRows ? StaleOrLoaded(result.IsStale) : FeatureTogglesState.Empty,
                true, false, hasRows && result.IsStale, null, result.FetchedAt),

            LoadStatus.Refreshing => new SectionOutcome(
                hasRows ? StaleOrLoaded(result.IsStale) : FeatureTogglesState.Empty,
                true, false, hasRows && result.IsStale, null, result.FetchedAt),

            LoadStatus.Loaded => new SectionOutcome(
                hasRows ? FeatureTogglesState.Loaded : FeatureTogglesState.Empty,
                false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                FeatureTogglesState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasRows
                ? new SectionOutcome(FeatureTogglesState.Offline, false, true, true, ErrorMessageDefault, result.FetchedAt)
                : new SectionOutcome(FeatureTogglesState.Error, false, true, false, ErrorMessageDefault, result.FetchedAt),

            _ => new SectionOutcome(FeatureTogglesState.Error, false, true, false, ErrorMessageOf(result), null),
        };
    }

    private string ErrorMessageOf(RepositoryResult<FeatureConfigSnapshot> result) =>
        result.Error?.Message is { Length: > 0 } message ? message : ErrorMessageDefault;

    private static FeatureTogglesState StaleOrLoaded(bool stale) =>
        stale ? FeatureTogglesState.Stale : FeatureTogglesState.Loaded;

    private static FeatureConfigSnapshot NextSnapshot(
        RepositoryResult<FeatureConfigSnapshot> result,
        FeatureConfigSnapshot previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                                          // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => FeatureConfigSnapshot.Empty,     // resolved with nothing to show
            _ => result.Value ?? previous,                                           // cached / refreshing / loaded / offline carry the snapshot
        };

    private void RaiseToast(FeatureToggleToast toast) => ToastRequested?.Invoke(this, toast);

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
        FeatureTogglesState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
