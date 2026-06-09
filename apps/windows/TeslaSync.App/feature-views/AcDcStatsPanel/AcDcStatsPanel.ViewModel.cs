using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AcDcStatsPanel"/> view — the native port of the
/// web component's data flow (web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx, fed by the
/// parent <c>ChargingListPage</c>'s charging-sessions query). It drives one cache-then-network read through the
/// <see cref="IAcDcStatsSource"/>, projects each emission through <see cref="AcDcStatsProjection"/>, and exposes
/// the full state matrix (loading / ready / empty / stale / offline / error) plus freshness so the view is a
/// thin renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AcDcStatsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAcDcStatsSource _source;
    private readonly ILocalizer _localizer;
    private readonly string _currencySymbol;

    private CancellationTokenSource? _cts;
    private AcDcBreakdown? _data;
    private bool _disposed;

    private AcDcStatsState _state = AcDcStatsState.Loading;
    private AcDcStatsDisplay _display;
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
    public AcDcStatsViewModel(IAcDcStatsSource source, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? AcDcStatsRegistration.DefaultCurrencySymbol
            : currencySymbol;
        _display = AcDcStatsProjection.Project(null, _localizer, _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / ready / empty / stale / offline / error).</summary>
    public AcDcStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content (energy split + table rows + free footer).</summary>
    public AcDcStatsDisplay Display
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

    /// <summary>The accessible surface title (web "Charging Stats by Type").</summary>
    public string SurfaceTitle => AcDcStatsRegistration.Title(_localizer);

    /// <summary>The "Energy Split (AC vs DC)" caption.</summary>
    public string EnergySplitLabel => AcDcStatsRegistration.EnergySplitLabel(_localizer);

    /// <summary>The "Type" column header.</summary>
    public string TypeHeader => AcDcStatsRegistration.TypeHeader(_localizer);

    /// <summary>The "Sessions" column header.</summary>
    public string SessionsHeader => AcDcStatsRegistration.SessionsHeader(_localizer);

    /// <summary>The "Energy" column header.</summary>
    public string EnergyHeader => AcDcStatsRegistration.EnergyHeader(_localizer);

    /// <summary>The "Cost" column header.</summary>
    public string CostHeader => AcDcStatsRegistration.CostHeader(_localizer);

    /// <summary>The "$/kWh" column header.</summary>
    public string CostPerKwhHeader => AcDcStatsRegistration.CostPerKwhHeader(_localizer);

    /// <summary>The "Avg Energy" column header.</summary>
    public string AvgEnergyHeader => AcDcStatsRegistration.AvgEnergyHeader(_localizer);

    /// <summary>The "Avg Time" column header.</summary>
    public string AvgTimeHeader => AcDcStatsRegistration.AvgTimeHeader(_localizer);

    /// <summary>The "Free" column header.</summary>
    public string FreeHeader => AcDcStatsRegistration.FreeHeader(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => AcDcStatsRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => AcDcStatsRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => AcDcStatsRegistration.RetryLabel(_localizer);

    /// <summary>Whole-surface empty message (no charging sessions to break down).</summary>
    public string EmptyText => AcDcStatsRegistration.EmptyText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        AcDcStatsState.Loading => AcDcStatsRegistration.LoadingLabel(_localizer),
        AcDcStatsState.Stale => StaleLabel,
        AcDcStatsState.Offline => _errorMessage ?? AcDcStatsRegistration.OfflineText(_localizer),
        AcDcStatsState.Error => _errorMessage ?? AcDcStatsRegistration.ErrorText(_localizer),
        AcDcStatsState.Empty => EmptyText,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network AC/DC charging-stats load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = AcDcStatsState.Loading;
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

    private void Apply(RepositoryResult<AcDcBreakdown> result)
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

    private AcDcOutcome Classify(RepositoryResult<AcDcBreakdown> result, AcDcBreakdown? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new AcDcOutcome(ContentState(data), true, false, false, false, null, null)
                : new AcDcOutcome(AcDcStatsState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new AcDcOutcome(
                result.IsStale ? AcDcStatsState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new AcDcOutcome(
                result.IsStale ? AcDcStatsState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new AcDcOutcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new AcDcOutcome(
                AcDcStatsState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new AcDcOutcome(
                    AcDcStatsState.Offline, false, true, true, true,
                    AcDcStatsRegistration.OfflineText(_localizer), result.FetchedAt)
                : new AcDcOutcome(
                    AcDcStatsState.Error, false, true, false, false,
                    AcDcStatsRegistration.ErrorText(_localizer), result.FetchedAt),

            _ => new AcDcOutcome(
                AcDcStatsState.Error, false, true, false, false,
                AcDcStatsRegistration.ErrorText(_localizer), null),
        };
    }

    // Web parity: the panel only renders content when there is at least one AC/DC session (the parent's
    // `ac.count + dc.count >= 1` gate). An absent breakdown — or one with no rows — is the whole-surface empty.
    private static AcDcStatsState ContentState(AcDcBreakdown? data) =>
        data is null || data.TotalCount == 0 ? AcDcStatsState.Empty : AcDcStatsState.Ready;

    private static AcDcBreakdown? NextData(RepositoryResult<AcDcBreakdown> result, AcDcBreakdown? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                  // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null,    // resolved with nothing to show
            _ => result.Value ?? previous,                   // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = AcDcStatsProjection.Project(_data, _localizer, _currencySymbol);

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

    private readonly record struct AcDcOutcome(
        AcDcStatsState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
