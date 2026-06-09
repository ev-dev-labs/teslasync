using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TeslaChargingSessionsMap"/> view — the native port of
/// the web component's data flow (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx, fed the
/// <c>sessions</c> prop from the page's <c>useTeslaChargingSessions()</c> query). It drives one cache-then-network
/// read through the <see cref="ITeslaChargingSessionsMapSource"/>, projects each emission through
/// <see cref="TeslaChargingSessionsMapProjection"/>, and exposes the full state matrix
/// (loading / ready / empty / stale / offline / error) plus freshness so the view is a thin renderer. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TeslaChargingSessionsMapViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITeslaChargingSessionsMapSource _source;
    private readonly ILocalizer _localizer;
    private readonly string _currencySymbol;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private TeslaChargingSessionsMapData? _data;
    private bool _disposed;

    private TeslaChargingSessionsMapState _state = TeslaChargingSessionsMapState.Loading;
    private TeslaChargingSessionsMapDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, currency symbol and (optional) clock.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    /// <param name="clock">The clock used to format session start times; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public TeslaChargingSessionsMapViewModel(
        ITeslaChargingSessionsMapSource source,
        ILocalizer localizer,
        string? currencySymbol = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? TeslaChargingSessionsMapRegistration.DefaultCurrencySymbol
            : currencySymbol;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = ProjectCurrent();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / ready / empty / stale / offline / error).</summary>
    public TeslaChargingSessionsMapState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready viewport + marker set.</summary>
    public TeslaChargingSessionsMapDisplay Display
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

    // ── Localized copy ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The accessible map-region name (web <c>aria-label</c>).</summary>
    public string MapLabel => _display.MapLabel;

    /// <summary>The empty-overlay copy when no session has coordinates.</summary>
    public string EmptyText => TeslaChargingSessionsMapRegistration.NoMapData(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => TeslaChargingSessionsMapRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => TeslaChargingSessionsMapRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => TeslaChargingSessionsMapRegistration.RetryLabel(_localizer);

    /// <summary>Loading Narrator label.</summary>
    public string LoadingLabel => TeslaChargingSessionsMapRegistration.LoadingLabel(_localizer);

    /// <summary>Hard-error copy.</summary>
    public string ErrorText => TeslaChargingSessionsMapRegistration.ErrorText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        TeslaChargingSessionsMapState.Loading => LoadingLabel,
        TeslaChargingSessionsMapState.Stale => StaleLabel,
        TeslaChargingSessionsMapState.Offline => _errorMessage ?? OfflineLabel,
        TeslaChargingSessionsMapState.Error => _errorMessage ?? ErrorText,
        TeslaChargingSessionsMapState.Empty => EmptyText,
        _ => null,
    };

    // ── Commands ────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network charging-sessions load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = TeslaChargingSessionsMapState.Loading;
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

    // ── Internals ───────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<TeslaChargingSessionsMapData> result)
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

    private MapOutcome Classify(RepositoryResult<TeslaChargingSessionsMapData> result, TeslaChargingSessionsMapData? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new MapOutcome(TeslaChargingSessionsMapState.Ready, true, false, false, false, null, null)
                : new MapOutcome(TeslaChargingSessionsMapState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new MapOutcome(
                result.IsStale ? TeslaChargingSessionsMapState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new MapOutcome(
                result.IsStale ? TeslaChargingSessionsMapState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new MapOutcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new MapOutcome(
                TeslaChargingSessionsMapState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new MapOutcome(
                    TeslaChargingSessionsMapState.Offline, false, true, true, true,
                    OfflineLabel, result.FetchedAt)
                : new MapOutcome(
                    TeslaChargingSessionsMapState.Error, false, true, false, false,
                    ErrorText, result.FetchedAt),

            _ => new MapOutcome(
                TeslaChargingSessionsMapState.Error, false, true, false, false, ErrorText, null),
        };
    }

    // Web parity: the map renders whenever a sessions payload is present (even with zero markers — the empty
    // overlay then carries the "no location data" copy). Only a null body is a whole-surface empty.
    private static TeslaChargingSessionsMapState ContentState(TeslaChargingSessionsMapData? data) =>
        data is null ? TeslaChargingSessionsMapState.Empty : TeslaChargingSessionsMapState.Ready;

    private static TeslaChargingSessionsMapData? NextData(
        RepositoryResult<TeslaChargingSessionsMapData> result, TeslaChargingSessionsMapData? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,               // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null, // resolved with nothing to show
            _ => result.Value ?? previous,                // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = ProjectCurrent();

    private TeslaChargingSessionsMapDisplay ProjectCurrent() =>
        TeslaChargingSessionsMapProjection.Project(_data, _localizer, _clock(), _currencySymbol);

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

    private readonly record struct MapOutcome(
        TeslaChargingSessionsMapState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
