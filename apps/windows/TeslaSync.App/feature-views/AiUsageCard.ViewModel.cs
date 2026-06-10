using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AiUsageDetailCard"/> view — the native port of the web
/// component's data composition (web/src/features/system/components/status/AiUsageCard.tsx, which reads
/// today's rollup plus the per-feature and recent breakdowns and gates the card on today's call count). It
/// consumes the cache-then-network <see cref="IAiUsageDetailSource"/>, projects each overview through
/// <see cref="AiUsageDetailProjection"/> with the active currency symbol and wall clock, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AiUsageDetailViewModel : INotifyPropertyChanged, IDisposable
{
    /// <summary>i18n key for the generic load-failure message.</summary>
    public const string ErrorKey = "translation.system.status.aiUsage.error";

    /// <summary>English fallback for <see cref="ErrorKey"/>.</summary>
    public const string ErrorFallback = "Couldn't load Helix usage";

    /// <summary>i18n key for the unauthorized (Helix off) message.</summary>
    public const string ErrorAuthKey = "translation.system.status.aiUsage.errorAuth";

    /// <summary>English fallback for <see cref="ErrorAuthKey"/>.</summary>
    public const string ErrorAuthFallback = "Helix is off \u2014 enable it in settings to see usage";

    /// <summary>i18n key for the offline message.</summary>
    public const string OfflineKey = "translation.common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "You're offline \u2014 showing the last cached usage";

    /// <summary>i18n key for the retry affordance label.</summary>
    public const string RetryKey = "translation.common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the loading announcement.</summary>
    public const string LoadingAnnounceKey = "translation.common.loading";

    /// <summary>English fallback for <see cref="LoadingAnnounceKey"/>.</summary>
    public const string LoadingAnnounceFallback = "Loading\u2026";

    private readonly IAiUsageDetailSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<AiUsageOverview>? _last;
    private bool _disposed;

    private AiUsageDetailState _state = AiUsageDetailState.Loading;
    private AiUsageDetailDisplay _display = AiUsageDetailProjection.EmptyDisplay();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, clock and (optional) currency symbol.</summary>
    /// <param name="source">The cache-then-network usage source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol for the cost band; defaults to "$" when null/blank.</param>
    /// <param name="clock">The wall clock for relative-time labels; defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    public AiUsageDetailViewModel(
        IAiUsageDetailSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? AiUsageDetailProjection.DefaultCurrencySymbol
            : currencySymbol;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AiUsageDetailState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (bands + details + top-lists).</summary>
    public AiUsageDetailDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown overview is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when a usage overview is shown (loaded / stale / offline content states).</summary>
    public bool HasData =>
        _state is AiUsageDetailState.Loaded
            or AiUsageDetailState.Stale
            or AiUsageDetailState.Offline;

    /// <summary>The localized card title (native chrome).</summary>
    public string Title => AiUsageDetailProjection.Title(_localizer);

    /// <summary>Localized loading-surface message (web loading <c>emptyMessage</c>).</summary>
    public string LoadingMessage => AiUsageDetailProjection.LoadingMessage(_localizer);

    /// <summary>Localized empty-surface message (web empty <c>emptyMessage</c>).</summary>
    public string EmptyMessage => AiUsageDetailProjection.EmptyMessage(_localizer);

    /// <summary>Localized loading announcement (for the skeleton live region).</summary>
    public string LoadingAnnouncement => _localizer.GetString(LoadingAnnounceKey, LoadingAnnounceFallback);

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString(RetryKey, RetryFallback);

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle => _localizer.GetString(ErrorKey, ErrorFallback);

    /// <summary>The currency symbol used for the cost band; reassigning re-projects the current overview.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string symbol = string.IsNullOrWhiteSpace(value)
                ? AiUsageDetailProjection.DefaultCurrencySymbol
                : value;
            if (string.Equals(_currencySymbol, symbol, StringComparison.Ordinal))
            {
                return;
            }

            _currencySymbol = symbol;
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

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

    private bool HasContent() =>
        _state is AiUsageDetailState.Loaded
            or AiUsageDetailState.Stale
            or AiUsageDetailState.Offline;

    private void Apply(RepositoryResult<AiUsageOverview> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyOverview(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyOverview(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyOverview(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyOverview(
                    result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyOverview(
        AiUsageOverview overview,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // A cached overview can carry today.call_count == 0 (the engine only applies the empty gate to fresh
        // fetches); the web treats that as the empty surface, so route it there regardless of freshness.
        if (!overview.HasUsage)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = AiUsageDetailProjection.Project(overview, _localizer, _clock(), _currencySymbol);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? AiUsageDetailState.Offline
            : stale ? AiUsageDetailState.Stale : AiUsageDetailState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
    }

    private void SetLoading()
    {
        Display = AiUsageDetailProjection.EmptyDisplay();
        IsFetching = true;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AiUsageDetailState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = AiUsageDetailProjection.EmptyDisplay();
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AiUsageDetailState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = AiUsageDetailProjection.EmptyDisplay();
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AiUsageDetailState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        (string key, string fallback) = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => (ErrorAuthKey, ErrorAuthFallback),
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => (OfflineKey, OfflineFallback),
            _ => (ErrorKey, ErrorFallback),
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
