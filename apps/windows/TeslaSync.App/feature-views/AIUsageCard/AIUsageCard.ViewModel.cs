using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AIUsageCard"/> view — the native port of the web
/// component's data composition (web/src/features/settings/components/AIUsageCard.tsx, which reads
/// <c>useAiUsageToday</c> + <c>useTranslation</c> + <c>useFormatting</c> and degrades every non-loaded branch
/// to an em-dash sentinel). It consumes the cache-then-network <see cref="IAiUsageTodaySource"/>, projects
/// each snapshot through <see cref="AiUsageCardProjection"/> with the active currency symbol, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AiUsageCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiUsageTodaySource _source;
    private readonly ILocalizer _localizer;

    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<AiUsageToday>? _last;
    private bool _disposed;

    private AiUsageCardState _state = AiUsageCardState.Loading;
    private AiUsageDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) currency symbol.</summary>
    /// <param name="source">The cache-then-network usage source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol for the cost cell; defaults to "$" when null/blank.</param>
    public AiUsageCardViewModel(
        IAiUsageTodaySource source,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? AiUsageCardProjection.DefaultCurrencySymbol
            : currencySymbol;
        _display = AiUsageCardProjection.EmptyDisplay(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AiUsageCardState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (title + three cells + caption).</summary>
    public AiUsageDisplay Display
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

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
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

    /// <summary>True when a usage snapshot is shown (loaded / stale / offline content states).</summary>
    public bool HasData =>
        _state is AiUsageCardState.Loaded
            or AiUsageCardState.Stale
            or AiUsageCardState.Offline;

    /// <summary>The localized card title (web "Usage today").</summary>
    public string Title => _localizer.GetString(AiUsageCardProjection.TitleKey, AiUsageCardProjection.TitleFallback);

    /// <summary>Localized empty-state message (the web empty-caption copy).</summary>
    public string EmptyMessage =>
        _localizer.GetString(AiUsageCardProjection.EmptyCaptionKey, AiUsageCardProjection.EmptyCaptionFallback);

    /// <summary>Localized loading announcement.</summary>
    public string LoadingLabel => _localizer.GetString("translation.common.loading", "Loading\u2026");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("translation.common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("translation.ai.settings.usage.error", "Couldn't load AI usage");

    /// <summary>The currency symbol used for the cost cell; reassigning re-projects the current snapshot.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string symbol = string.IsNullOrWhiteSpace(value) ? AiUsageCardProjection.DefaultCurrencySymbol : value;
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
        _state is AiUsageCardState.Loaded
            or AiUsageCardState.Stale
            or AiUsageCardState.Offline;

    private void Apply(RepositoryResult<AiUsageToday> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        AiUsageToday snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = AiUsageCardProjection.Project(snapshot, _localizer, _currencySymbol);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? AiUsageCardState.Offline
            : stale ? AiUsageCardState.Stale : AiUsageCardState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = AiUsageCardProjection.EmptyDisplay(_localizer);
        }
    }

    private void SetLoading()
    {
        Display = AiUsageCardProjection.EmptyDisplay(_localizer);
        IsFetching = true;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AiUsageCardState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = AiUsageCardProjection.EmptyDisplay(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AiUsageCardState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = AiUsageCardProjection.EmptyDisplay(_localizer);
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AiUsageCardState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "translation.ai.settings.usage.errorAuth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "translation.common.offline",
            _ => "translation.ai.settings.usage.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Helix is off — enable it in settings to see usage",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached usage",
            _ => "Couldn't load AI usage",
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
