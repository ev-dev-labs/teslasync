using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SecurityStatusCards"/> view — the native port of
/// the web Security-status cards (web/src/features/admin/components/security-access/SecurityStatusCards.tsx).
/// The web component is a pure child of the Security &amp; Access page; the native surface binds its own
/// cache-then-network <see cref="ISecurityStatusCardsSource"/>, projects each snapshot through
/// <see cref="SecurityStatusCardsProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus the
/// freshness flags so the view is a thin renderer. The six status cards always render (the web grid is never
/// hidden): the <see cref="SecurityStatusCardsState.Loaded"/>, <see cref="SecurityStatusCardsState.Stale"/>,
/// <see cref="SecurityStatusCardsState.Offline"/> and <see cref="SecurityStatusCardsState.Empty"/> states all
/// carry a populated <see cref="Display"/> (the cards fall back to their safe defaults). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SecurityStatusCardsViewModel : INotifyPropertyChanged, IDisposable
{
    private const string ErrorKey = "translation.admin.security.error";
    private const string ErrorFallback = "Couldn't load security status";
    private const string AuthErrorKey = "translation.admin.security.error.auth";
    private const string AuthErrorFallback = "Sign in to view security status";
    private const string OfflineErrorKey = "translation.admin.security.error.offline";
    private const string OfflineErrorFallback = "You're offline — showing the last cached security status";

    private readonly ISecurityStatusCardsSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private RepositoryResult<SecurityStatusCardsData>? _last;
    private bool _disposed;

    private SecurityStatusCardsState _state = SecurityStatusCardsState.Loading;
    private SecurityStatusCardsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public SecurityStatusCardsViewModel(ISecurityStatusCardsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = SecurityStatusCardsDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SecurityStatusCardsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six status cards + surface label).</summary>
    public SecurityStatusCardsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

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

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
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

    /// <summary>True when a live security signal backed the shown cards (web — a populated latest event).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (the Security &amp; Access heading).</summary>
    public string Title => SecurityStatusCardsRegistration.Name(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the card skeletons only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is SecurityStatusCardsState.Loaded
            or SecurityStatusCardsState.Stale
            or SecurityStatusCardsState.Offline
            or SecurityStatusCardsState.Empty;

    private void Apply(RepositoryResult<SecurityStatusCardsData> result)
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
        SecurityStatusCardsData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = SecurityStatusCardsProjection.Project(data, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // The six cards always render; freshness wins over emptiness so the stale/offline chip survives a
        // signal-less snapshot, while a fresh signal-less snapshot is classified Empty (the cards render their
        // safe defaults, web parity).
        State = offline
            ? SecurityStatusCardsState.Offline
            : stale
                ? SecurityStatusCardsState.Stale
                : data.HasData
                    ? SecurityStatusCardsState.Loaded
                    : SecurityStatusCardsState.Empty;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = SecurityStatusCardsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = SecurityStatusCardsDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SecurityStatusCardsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SecurityStatusCardsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        (string key, string fallback) = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => (AuthErrorKey, AuthErrorFallback),
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => (OfflineErrorKey, OfflineErrorFallback),
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
