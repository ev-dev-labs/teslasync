using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AddressInput"/> view — the native port of the web
/// component's data flow (web/src/features/driving/components/AddressInput.tsx, fed by
/// <c>useGeocodeSearch(debouncedQuery)</c>). It owns the geocode-search lifecycle for one query at a time:
/// queries shorter than <see cref="AddressInputRegistration.MinQueryLength"/> resolve to <see cref="State"/>
/// <see cref="AddressInputState.Idle"/> without touching the source (web <c>enabled: query.length &gt;= 3</c>);
/// longer queries run one cache-then-network read through the <see cref="IAddressGeocodeSource"/>, each emission
/// classified into the full state matrix (loading / ready / empty / stale / offline / error) so the view is a
/// thin renderer. The 400 ms keystroke debounce lives in the view; this holder gates and searches whatever query
/// it is handed. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AddressInputViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAddressGeocodeSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private string _query = string.Empty;
    private int _limit = AddressInputRegistration.DefaultLimit;
    private IReadOnlyList<GeocodeSuggestion> _suggestions = Array.Empty<GeocodeSuggestion>();

    private AddressInputState _state = AddressInputState.Idle;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    public AddressInputViewModel(IAddressGeocodeSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Request context ───────────────────────────────────────────────────────────────────────────────

    /// <summary>The last query the holder was handed (trimmed); empty before any input.</summary>
    public string Query
    {
        get => _query;
        private set => Set(ref _query, value);
    }

    /// <summary>The suggestion cap requested (web <c>limit=5</c>).</summary>
    public int Limit
    {
        get => _limit;
        set => Set(ref _limit, value <= 0 ? AddressInputRegistration.DefaultLimit : value);
    }

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (idle / loading / ready / empty / stale / offline / error).</summary>
    public AddressInputState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The suggestions to offer (web <c>options={results ?? []}</c>); never null.</summary>
    public IReadOnlyList<GeocodeSuggestion> Suggestions
    {
        get => _suggestions;
        private set
        {
            _suggestions = value ?? Array.Empty<GeocodeSuggestion>();
            Raise(nameof(Suggestions));
            Raise(nameof(HasSuggestions));
        }
    }

    /// <summary>True when there is at least one suggestion to show.</summary>
    public bool HasSuggestions => _suggestions.Count > 0;

    /// <summary>Last successful update timestamp (for the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>
    /// True while a geocode search is in flight for a searchable query (web
    /// <c>loading={isLoading &amp;&amp; debouncedQuery.length &gt;= 3}</c>); only ever set once the
    /// minimum-length gate has passed.
    /// </summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last search failed (hard error or offline-with-cache).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown suggestions are a cached value past the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the network failed but cached suggestions are still being shown.</summary>
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

    /// <summary>Search attempts so far (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized copy (web t(...) keys + native superset) ───────────────────────────────────────────────

    /// <summary>The field label (web <c>label ?? t('addressInput.label', 'Address')</c>).</summary>
    public string LabelText => AddressInputRegistration.LabelText(_localizer);

    /// <summary>"Searching addresses…" in-flight announcement.</summary>
    public string SearchingLabel => AddressInputRegistration.SearchingLabel(_localizer);

    /// <summary>"No matching addresses" empty-result hint.</summary>
    public string NoMatchesLabel => AddressInputRegistration.NoMatchesLabel(_localizer);

    /// <summary>"Type at least 3 characters" resting hint.</summary>
    public string TypeMoreHint => AddressInputRegistration.TypeMoreHint(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => AddressInputRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => AddressInputRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => AddressInputRegistration.RetryLabel(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        AddressInputState.Loading => SearchingLabel,
        AddressInputState.Stale => StaleLabel,
        AddressInputState.Offline => _errorMessage ?? AddressInputRegistration.OfflineText(_localizer),
        AddressInputState.Error => _errorMessage ?? AddressInputRegistration.ErrorText(_localizer),
        AddressInputState.Empty => NoMatchesLabel,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Search for <paramref name="query"/> (web's debounced effect target). A query shorter than the minimum
    /// resolves to <see cref="AddressInputState.Idle"/> with no source call (web hook <c>enabled:false</c>);
    /// otherwise it runs one cache-then-network geocode read, superseding any in-flight search.
    /// </summary>
    public async Task SetQueryAsync(string? query, CancellationToken cancellationToken = default)
    {
        string trimmed = (query ?? string.Empty).Trim();
        Query = trimmed;

        var cts = Supersede(ref _cts, cancellationToken);

        if (!AddressInputProjection.MeetsMinLength(trimmed))
        {
            // web parity: the geocode hook is disabled until the query reaches the minimum length — there is
            // nothing to fetch, so reset to the resting Idle surface rather than spinning.
            Suggestions = Array.Empty<GeocodeSuggestion>();
            ApplyIdle();
            return;
        }

        Attempts++;
        Suggestions = Array.Empty<GeocodeSuggestion>();
        State = AddressInputState.Loading;
        IsFetching = true;
        IsError = false;
        IsStale = false;
        IsOffline = false;
        ErrorMessage = null;
        Raise(nameof(StatusAnnouncement));

        try
        {
            await foreach (var result in _source
                .StreamAsync(trimmed, _limit, cts.Token)
                .ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer query (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Re-run the search for the current query after a failure (web <c>QueryError</c> retry → refetch).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) =>
        SetQueryAsync(_query, cancellationToken);

    /// <summary>Clear the query back to the resting Idle surface (web parity for an emptied input).</summary>
    public void Clear()
    {
        Cancel(ref _cts);
        Query = string.Empty;
        Suggestions = Array.Empty<GeocodeSuggestion>();
        ApplyIdle();
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

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<IReadOnlyList<GeocodeSuggestion>> result)
    {
        Suggestions = NextSuggestions(result, _suggestions);

        var outcome = Classify(result, _suggestions);
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

        Raise(nameof(StatusAnnouncement));
    }

    private void ApplyIdle()
    {
        State = AddressInputState.Idle;
        IsFetching = false;
        IsError = false;
        IsStale = false;
        IsOffline = false;
        ErrorMessage = null;
        UpdatedAt = null;
        Raise(nameof(StatusAnnouncement));
    }

    private AddressOutcome Classify(
        RepositoryResult<IReadOnlyList<GeocodeSuggestion>> result, IReadOnlyList<GeocodeSuggestion> suggestions)
    {
        bool hasItems = suggestions.Count > 0;

        return result.Status switch
        {
            LoadStatus.Loading => hasItems
                ? new AddressOutcome(AddressInputState.Ready, true, false, false, false, null, null)
                : new AddressOutcome(AddressInputState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new AddressOutcome(
                result.IsStale ? AddressInputState.Stale : ContentState(hasItems),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new AddressOutcome(
                result.IsStale ? AddressInputState.Stale : ContentState(hasItems),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new AddressOutcome(
                ContentState(hasItems), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new AddressOutcome(
                AddressInputState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasItems
                ? new AddressOutcome(
                    AddressInputState.Offline, false, true, true, true,
                    AddressInputRegistration.OfflineText(_localizer), result.FetchedAt)
                : new AddressOutcome(
                    AddressInputState.Error, false, true, false, false,
                    AddressInputRegistration.ErrorText(_localizer), result.FetchedAt),

            _ => new AddressOutcome(
                AddressInputState.Error, false, true, false, false,
                AddressInputRegistration.ErrorText(_localizer), null),
        };
    }

    private static AddressInputState ContentState(bool hasItems) =>
        hasItems ? AddressInputState.Ready : AddressInputState.Empty;

    private static IReadOnlyList<GeocodeSuggestion> NextSuggestions(
        RepositoryResult<IReadOnlyList<GeocodeSuggestion>> result, IReadOnlyList<GeocodeSuggestion> previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                          // transient — keep the prior list visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<GeocodeSuggestion>(),
            _ => result.Value ?? previous,                           // cached / refreshing / loaded / offline carry a list
        };

    private static CancellationTokenSource Supersede(
        ref CancellationTokenSource? slot, CancellationToken cancellationToken)
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

    private readonly record struct AddressOutcome(
        AddressInputState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
