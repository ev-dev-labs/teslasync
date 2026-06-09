using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SignalCatalogWidget"/> view — the native
/// port of the web <c>SignalCatalogWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx). It consumes the
/// <see cref="ISignalCatalogSource"/>'s two cache-then-network sequences: the global catalog drives the
/// surface <see cref="State"/> and the header freshness (web <c>catalogLoading</c> /
/// <c>catalogFetching</c> / <c>catalogStale</c> / <c>catalogError</c>), while the per-vehicle
/// observations are folded in best-effort to supply the per-row counts (web <c>observationCounts</c>)
/// and never gate a state. The search term and footprint re-project the grouped display without a
/// reload. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SignalCatalogViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyDictionary<string, long> EmptyCounts =
        new Dictionary<string, long>(StringComparer.Ordinal);

    private readonly ISignalCatalogSource _source;
    private readonly ILocalizer _localizer;

    private SignalCatalogSize _size;
    private string _search = string.Empty;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>? _catalogResult;
    private IReadOnlyList<SignalCatalogEntryModel> _entries = Array.Empty<SignalCatalogEntryModel>();
    private IReadOnlyDictionary<string, long> _observationCounts = EmptyCounts;
    private bool _catalogResolved;
    private bool _catalogActive;

    private SignalCatalogState _state = SignalCatalogState.Loading;
    private SignalCatalogDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network catalog + observations source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata).</param>
    public SignalCatalogViewModel(ISignalCatalogSource source, ILocalizer localizer, SignalCatalogSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _display = BuildDisplay();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current catalog-driven surface state.</summary>
    public SignalCatalogState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready grouped catalog (filtered + counted for the current search/footprint).</summary>
    public SignalCatalogDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasEntries));
        }
    }

    /// <summary>Last successful catalog update timestamp surfaced in the header freshness chip (web <c>catalogUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a catalog refresh is in flight (web <c>catalogFetching</c>; the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the catalog read failed (web <c>catalogError</c>; drives the error chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown catalog is backed by a read older than the freshness window (web <c>catalogStale</c>).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message (surfaced by the error/offline chip).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of catalog load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when the catalog carries at least one signal (web <c>entries.length &gt; 0</c>).</summary>
    public bool HasEntries => _display.HasEntries;

    /// <summary>Localized widget title (web <c>widget.signalCatalog.title</c> "Signal Catalog").</summary>
    public string Title => _localizer.GetString("widget.signalCatalog.title", "Signal Catalog");

    /// <summary>Localized empty-catalog message (web <c>widget.signalCatalog.noData</c> "No signals in catalog").</summary>
    public string EmptyMessage => _localizer.GetString("widget.signalCatalog.noData", "No signals in catalog");

    /// <summary>Localized no-search-match message (web <c>widget.signalCatalog.noResults</c> "No matching signals").</summary>
    public string NoResultsMessage => _localizer.GetString("widget.signalCatalog.noResults", "No matching signals");

    /// <summary>Localized search-field prompt (the web search input hint).</summary>
    public string SearchHint => _localizer.GetString("widget.signalCatalog.searchPlaceholder", "Search signals\u2026"); // parity:allow canonical i18n key name defined by the web source + P1/S10 catalog

    /// <summary>The free-text search term; reassigning re-projects the filtered + grouped display without a reload.</summary>
    public string Search
    {
        get => _search;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_search, next, StringComparison.Ordinal))
            {
                return;
            }

            _search = next;
            Raise(nameof(Search));
            ReprojectDisplay();
        }
    }

    /// <summary>The widget footprint; reassigning re-projects the current catalog for the new layout (compact vs standard).</summary>
    public SignalCatalogSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            ReprojectDisplay();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, folds every catalog emission into
    /// <see cref="State"/> + <see cref="Display"/> (the skeleton shows only until the catalog first
    /// resolves; thereafter the list stays visible while refreshing), then folds the per-vehicle
    /// observations into the per-row counts without disturbing the catalog-driven state. A superseding
    /// load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        _catalogActive = true;
        Recompute();

        try
        {
            await foreach (var result in _source.StreamCatalogAsync(cts.Token).ConfigureAwait(false))
            {
                _catalogResult = result;
                _entries = NextEntries(result, _entries);
                if (result.Status != LoadStatus.Loading)
                {
                    _catalogResolved = true;
                }

                Recompute();
            }

            _catalogActive = false;
            Recompute();

            // Observations are best-effort: they only supply the per-row counts and never change the
            // catalog-driven state (web: useSignalObservations feeds observationCounts only).
            await foreach (var result in _source.StreamObservationsAsync(cts.Token).ConfigureAwait(false))
            {
                _observationCounts = NextCounts(result, _observationCounts);
                ReprojectDisplay();
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop the remaining emissions silently.
        }
    }

    /// <summary>Retry the catalog + observations — re-runs the load from the top while keeping content visible.</summary>
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

    private void Recompute()
    {
        Display = BuildDisplay();

        var status = _catalogResult?.Status;
        bool stale = _catalogResult?.IsStale ?? false;
        bool offline = status == LoadStatus.Offline;
        bool error = status is LoadStatus.Error or LoadStatus.Offline;
        bool hasEntries = _entries.Count > 0;

        UpdatedAt = _catalogResult?.FetchedAt;
        IsStale = stale;
        IsError = error;
        IsFetching = _catalogResolved && _catalogActive;
        ErrorMessage = error ? ErrorTextFor(_catalogResult?.Error) : null;

        State = !_catalogResolved
            ? SignalCatalogState.Loading
            : !hasEntries && error
                ? SignalCatalogState.Error
                : !hasEntries
                    ? SignalCatalogState.Empty
                    : offline
                        ? SignalCatalogState.Offline
                        : stale
                            ? SignalCatalogState.Stale
                            : SignalCatalogState.Loaded;
    }

    private void ReprojectDisplay() => Display = BuildDisplay();

    private SignalCatalogDisplay BuildDisplay() =>
        SignalCatalogProjection.Project(_entries, _observationCounts, _size, _search, _localizer);

    private static IReadOnlyList<SignalCatalogEntryModel> NextEntries(
        RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>> result,
        IReadOnlyList<SignalCatalogEntryModel> previous) => result.Status switch
        {
            LoadStatus.Loading => previous,                                       // transient — keep the prior content
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<SignalCatalogEntryModel>(), // resolved with nothing
            _ => result.Value ?? previous,                                        // cached / loaded / offline carry a value
        };

    private static IReadOnlyDictionary<string, long> NextCounts(
        RepositoryResult<IReadOnlyList<SignalObservationModel>> result,
        IReadOnlyDictionary<string, long> previous) => result.Status switch
        {
            LoadStatus.Loading => previous,        // transient — keep the prior counts
            LoadStatus.Empty or LoadStatus.Error => EmptyCounts, // no observations → all zero (web `?? []`)
            _ => result.HasValue ? SignalCatalogProjection.CountByField(result.Value!) : previous,
        };

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.signalCatalog.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.signalCatalog.error.offline",
            _ => "widget.signalCatalog.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the signal catalog",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached catalog",
            _ => "Couldn't load the signal catalog",
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
