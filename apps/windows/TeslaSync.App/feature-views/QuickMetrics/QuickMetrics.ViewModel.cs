using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QuickMetrics"/> view — the native port of the web
/// component's data flow (web/src/features/charging/components/charging-list/QuickMetrics.tsx, fed by the parent
/// <c>ChargingListPage</c>'s charging-sessions query). It drives one cache-then-network read through the
/// <see cref="IQuickMetricsSource"/>, projects each emission through <see cref="QuickMetricsProjection"/>, and
/// exposes the full state matrix (loading / ready / empty / stale / offline / error) plus freshness so the view
/// is a thin renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class QuickMetricsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IQuickMetricsSource _source;
    private readonly ILocalizer _localizer;
    private readonly string _currencySymbol;

    private CancellationTokenSource? _cts;
    private QuickMetricsStats? _data;
    private bool _disposed;

    private QuickMetricsState _state = QuickMetricsState.Loading;
    private QuickMetricsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) currency symbol.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public QuickMetricsViewModel(IQuickMetricsSource source, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? QuickMetricsRegistration.DefaultCurrencySymbol
            : currencySymbol;
        _display = QuickMetricsProjection.Project(null, _localizer, _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / ready / empty / stale / offline / error).</summary>
    public QuickMetricsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content (the six metric cells).</summary>
    public QuickMetricsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful update timestamp (for the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
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

    /// <summary>True when the shown content is a cached value past the freshness window.</summary>
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

    /// <summary>Localized error message (null when not errored).</summary>
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

    // ── Localized copy (web t(...) keys + native-superset chrome) ───────────────────────────────────────

    /// <summary>The accessible surface title.</summary>
    public string SurfaceTitle => QuickMetricsRegistration.Title(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => QuickMetricsRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => QuickMetricsRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => QuickMetricsRegistration.RetryLabel(_localizer);

    /// <summary>Whole-surface empty message (web <c>charging.noMetrics</c>).</summary>
    public string EmptyText => QuickMetricsRegistration.EmptyText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        QuickMetricsState.Loading => QuickMetricsRegistration.LoadingLabel(_localizer),
        QuickMetricsState.Stale => StaleLabel,
        QuickMetricsState.Offline => _errorMessage ?? QuickMetricsRegistration.OfflineText(_localizer),
        QuickMetricsState.Error => _errorMessage ?? QuickMetricsRegistration.ErrorText(_localizer),
        QuickMetricsState.Empty => EmptyText,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network QuickMetrics load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = QuickMetricsState.Loading;
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
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry the surface after a failure (web <c>QueryError</c> retry → refetch).</summary>
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

    private void Apply(RepositoryResult<QuickMetricsStats> result)
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

    private QuickMetricsOutcome Classify(RepositoryResult<QuickMetricsStats> result, QuickMetricsStats? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new QuickMetricsOutcome(ContentState(data), true, false, false, false, null, null)
                : new QuickMetricsOutcome(QuickMetricsState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new QuickMetricsOutcome(
                result.IsStale ? QuickMetricsState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new QuickMetricsOutcome(
                result.IsStale ? QuickMetricsState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new QuickMetricsOutcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new QuickMetricsOutcome(
                QuickMetricsState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new QuickMetricsOutcome(
                    QuickMetricsState.Offline, false, true, true, true,
                    QuickMetricsRegistration.OfflineText(_localizer), result.FetchedAt)
                : new QuickMetricsOutcome(
                    QuickMetricsState.Error, false, true, false, false,
                    QuickMetricsRegistration.ErrorText(_localizer), result.FetchedAt),

            _ => new QuickMetricsOutcome(
                QuickMetricsState.Error, false, true, false, false,
                QuickMetricsRegistration.ErrorText(_localizer), null),
        };
    }

    // Web parity: the grid only renders when computeStats produced stats (at least one session). An absent or
    // empty (zero-session) stats value is the whole-surface empty treatment.
    private static QuickMetricsState ContentState(QuickMetricsStats? data) =>
        data is null || data.IsEmpty ? QuickMetricsState.Empty : QuickMetricsState.Ready;

    private static QuickMetricsStats? NextData(RepositoryResult<QuickMetricsStats> result, QuickMetricsStats? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                  // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null,    // resolved with nothing to show
            _ => result.Value ?? previous,                   // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = QuickMetricsProjection.Project(_data, _localizer, _currencySymbol);

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

    private readonly record struct QuickMetricsOutcome(
        QuickMetricsState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
