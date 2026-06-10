using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FrontendErrorsCard"/> view — the native port of
/// the web card's hook composition (web/src/features/system/components/status/FrontendErrorsCard.tsx, fed by
/// <c>useWebErrorsSummary</c>). It drives one cache-then-network read through the
/// <see cref="IFrontendErrorsSource"/>, projects each emission through <see cref="FrontendErrorsProjection"/>,
/// and exposes the full state matrix (loading / loaded / empty / stale / offline / error) plus freshness so the
/// view is a thin renderer. The web card is purely presentational; this holder is the native equivalent so the
/// surface logic is verified without a UI host. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class FrontendErrorsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFrontendErrorsSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private WebErrorsSummary? _data;
    private bool _disposed;

    private FrontendErrorsState _state = FrontendErrorsState.Loading;
    private FrontendErrorsDisplay _display = FrontendErrorsDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    public FrontendErrorsViewModel(IFrontendErrorsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / loaded / empty / stale / offline / error).</summary>
    public FrontendErrorsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready body (total text + offender rows).</summary>
    public FrontendErrorsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
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

    /// <summary>True when the last read failed (hard error or offline-with-cache).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown summary is a cached value past the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the network failed but cached content is still being shown.</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => Set(ref _isOffline, value);
    }

    /// <summary>Localized error message for the error/offline surfaces (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries) — drives "tried N times" messaging.</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized copy (web regions + native-superset chrome) ───────────────────────────────────────────

    /// <summary>Card title (web "Frontend errors (last hour)").</summary>
    public string SurfaceTitle => FrontendErrorsRegistration.Title(_localizer);

    /// <summary>Descriptive caption under the total (web "reported by browser sessions").</summary>
    public string Subtitle => FrontendErrorsRegistration.Subtitle(_localizer);

    /// <summary>Label above the rolling-hour total.</summary>
    public string TotalLabel => FrontendErrorsRegistration.TotalLabel(_localizer);

    /// <summary>Heading above the offenders list.</summary>
    public string TopOffendersLabel => FrontendErrorsRegistration.TopOffendersLabel(_localizer);

    /// <summary>"No errors" copy shown when the offenders list is empty (web <c>top.length === 0</c>).</summary>
    public string NoErrorsText => FrontendErrorsRegistration.NoErrorsText(_localizer);

    /// <summary>Whole-surface empty message — no usable summary envelope (web <c>!data</c>).</summary>
    public string EmptyText => FrontendErrorsRegistration.UnableToLoadText(_localizer);

    /// <summary>Hard-failure message (web <c>!data</c> "Unable to load…").</summary>
    public string ErrorMessageDefault => FrontendErrorsRegistration.UnableToLoadText(_localizer);

    /// <summary>Offline chip / announcement label.</summary>
    public string OfflineLabel => FrontendErrorsRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label for the hard-error branch.</summary>
    public string RetryLabel => FrontendErrorsRegistration.RetryLabel(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        FrontendErrorsState.Loading => FrontendErrorsRegistration.LoadingLabel(_localizer),
        FrontendErrorsState.Error => _errorMessage ?? ErrorMessageDefault,
        FrontendErrorsState.Offline => _errorMessage ?? OfflineLabel,
        FrontendErrorsState.Empty => EmptyText,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network web-errors summary load (web initial query).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = FrontendErrorsState.Loading;
            IsFetching = true;
            IsError = false;
            IsStale = false;
            IsOffline = false;
            ErrorMessage = null;
            RefreshDisplay();
        }
        else
        {
            IsFetching = true;
        }

        Raise(nameof(StatusAnnouncement));

        try
        {
            await foreach (var result in _source.StreamSummaryAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry the surface after a failure (web card has no refetch button; the native error branch does).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

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

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<WebErrorsSummary> result)
    {
        _data = NextData(result, _data);

        var outcome = Classify(result, _data);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        IsOffline = outcome.IsOffline;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }

        RefreshDisplay();
        Raise(nameof(StatusAnnouncement));
    }

    private FrontendErrorsOutcome Classify(RepositoryResult<WebErrorsSummary> result, WebErrorsSummary? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new FrontendErrorsOutcome(ContentState(data), true, false, false, false, null, null)
                : new FrontendErrorsOutcome(FrontendErrorsState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new FrontendErrorsOutcome(
                result.IsStale ? FrontendErrorsState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new FrontendErrorsOutcome(
                result.IsStale ? FrontendErrorsState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new FrontendErrorsOutcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new FrontendErrorsOutcome(
                FrontendErrorsState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new FrontendErrorsOutcome(
                    FrontendErrorsState.Offline, false, true, true, true,
                    FrontendErrorsRegistration.OfflineLabel(_localizer), result.FetchedAt)
                : new FrontendErrorsOutcome(
                    FrontendErrorsState.Error, false, true, false, false,
                    ErrorMessageDefault, result.FetchedAt),

            _ => new FrontendErrorsOutcome(
                FrontendErrorsState.Error, false, true, false, false, ErrorMessageDefault, null),
        };
    }

    // Web parity: whenever the summary envelope is present the card renders (the total plus either the
    // offenders list or the "No frontend errors…" copy), even at zero. An absent envelope is the
    // whole-surface "Unable to load error summary." treatment (web `!data`).
    private static FrontendErrorsState ContentState(WebErrorsSummary? data) =>
        data is null ? FrontendErrorsState.Empty : FrontendErrorsState.Loaded;

    private static WebErrorsSummary? NextData(RepositoryResult<WebErrorsSummary> result, WebErrorsSummary? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                  // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null,    // resolved with nothing to show
            _ => result.Value ?? previous,                   // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = FrontendErrorsProjection.Project(_data, _localizer);

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

    private readonly record struct FrontendErrorsOutcome(
        FrontendErrorsState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
