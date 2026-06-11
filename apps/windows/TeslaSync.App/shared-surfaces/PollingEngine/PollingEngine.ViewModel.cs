using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PollingEngine"/> view — the native port of the web
/// <c>PollingEnginePanel</c>'s hook composition (web/src/components/data-display/PollingEngine.tsx). It consumes the
/// two cache-then-network reads exposed by <see cref="IPollingEngineSource"/> (status + savings), derives the
/// mutually-exclusive <see cref="State"/> from the status snapshot exactly as the web does
/// (<c>!status?.enabled</c> → <see cref="PollingEngineState.Disabled"/>; otherwise the savings card plus a vehicle
/// list or the friendly empty state), projects the savings card and per-vehicle rows, and surfaces the header
/// freshness flags so the view is a thin renderer. It performs no HTTP and references no view framework, so every
/// transition is asserted headlessly. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class PollingEngineViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPollingEngineSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private PollingEngineState _state = PollingEngineState.Loading;
    private IReadOnlyList<PollingVehicleRow> _vehicleRows = Array.Empty<PollingVehicleRow>();
    private PollingSavingsView? _savings;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    /// <param name="source">The cache-then-network data seam; never opened by the view.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">The wall clock for relative "Next: …" labels (injected for deterministic tests).</param>
    public PollingEngineViewModel(IPollingEngineSource source, ILocalizer localizer, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public PollingEngineState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                Raise(nameof(ShowPanel));
                Raise(nameof(ShowSkeleton));
                Raise(nameof(ShowError));
                Raise(nameof(IsCollapsed));
                Raise(nameof(ShowStaleChip));
                Raise(nameof(ShowOfflineChip));
            }
        }
    }

    /// <summary>The projected, localized vehicle rows (web vehicle list); empty when no vehicles are tracked.</summary>
    public IReadOnlyList<PollingVehicleRow> VehicleRows
    {
        get => _vehicleRows;
        private set
        {
            _vehicleRows = value;
            Raise(nameof(VehicleRows));
            Raise(nameof(HasVehicles));
        }
    }

    /// <summary>The projected savings card, or null when no savings snapshot is available (web <c>savings &amp;&amp; …</c>).</summary>
    public PollingSavingsView? Savings
    {
        get => _savings;
        private set
        {
            _savings = value;
            Raise(nameof(Savings));
            Raise(nameof(HasSavings));
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

    /// <summary>True when the last status load failed (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown status is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when showing cached status because the network is unreachable.</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => Set(ref _isOffline, value);
    }

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of status-load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when the panel chrome (header + savings + vehicle section) is rendered.</summary>
    public bool ShowPanel => _state is PollingEngineState.Loaded or PollingEngineState.Empty
        or PollingEngineState.Stale or PollingEngineState.Offline;

    /// <summary>True when the loading skeleton is rendered (no cached content yet).</summary>
    public bool ShowSkeleton => _state == PollingEngineState.Loading;

    /// <summary>True when the retry / error surface is rendered.</summary>
    public bool ShowError => _state == PollingEngineState.Error;

    /// <summary>True when the whole surface collapses (web <c>return null</c> for a disabled engine).</summary>
    public bool IsCollapsed => _state == PollingEngineState.Disabled;

    /// <summary>True when the stale chip is shown alongside the content.</summary>
    public bool ShowStaleChip => _state == PollingEngineState.Stale;

    /// <summary>True when the offline chip is shown alongside the content.</summary>
    public bool ShowOfflineChip => _state == PollingEngineState.Offline;

    /// <summary>True when there is at least one vehicle row to render.</summary>
    public bool HasVehicles => _vehicleRows.Count > 0;

    /// <summary>True when a savings card is available to render.</summary>
    public bool HasSavings => _savings is not null;

    /// <summary>Localized panel title (web "Adaptive Polling Engine").</summary>
    public string Title => _localizer.GetString(PollingEngineRegistration.TitleKey, PollingEngineRegistration.TitleFallback);

    /// <summary>Localized "Active" status-chip label (web "Active").</summary>
    public string ActiveLabel => _localizer.GetString(PollingEngineRegistration.ActiveKey, PollingEngineRegistration.ActiveFallback);

    /// <summary>Localized "Vehicle Activity" section title (web "Vehicle Activity").</summary>
    public string VehicleActivityLabel =>
        _localizer.GetString(PollingEngineRegistration.VehicleActivityKey, PollingEngineRegistration.VehicleActivityFallback);

    /// <summary>Localized empty-state message (web "No vehicles tracked yet…").</summary>
    public string EmptyMessage =>
        _localizer.GetString(PollingEngineRegistration.NoVehiclesKey, PollingEngineRegistration.NoVehiclesFallback);

    /// <summary>Localized loading label (announced while the skeleton shows).</summary>
    public string LoadingLabel => _localizer.GetString(PollingEngineRegistration.LoadingKey, PollingEngineRegistration.LoadingFallback);

    /// <summary>Localized retry button label.</summary>
    public string RetryLabel => _localizer.GetString(PollingEngineRegistration.RetryKey, PollingEngineRegistration.RetryFallback);

    /// <summary>Localized stale-chip label.</summary>
    public string StaleLabel => _localizer.GetString(PollingEngineRegistration.StaleKey, PollingEngineRegistration.StaleFallback);

    /// <summary>Localized short offline-chip label.</summary>
    public string OfflineChipLabel =>
        _localizer.GetString(PollingEngineRegistration.OfflineShortKey, PollingEngineRegistration.OfflineShortFallback);

    /// <summary>Localized "Next" next-poll prefix.</summary>
    public string NextLabel => _localizer.GetString(PollingEngineRegistration.NextKey, PollingEngineRegistration.NextFallback);

    /// <summary>Localized "Interval" detail prefix.</summary>
    public string IntervalLabel => _localizer.GetString(PollingEngineRegistration.IntervalKey, PollingEngineRegistration.IntervalFallback);

    /// <summary>Localized "Consecutive idle" detail prefix.</summary>
    public string ConsecutiveIdleLabel =>
        _localizer.GetString(PollingEngineRegistration.ConsecutiveIdleKey, PollingEngineRegistration.ConsecutiveIdleFallback);

    /// <summary>Localized "Battery" detail prefix.</summary>
    public string BatteryLabel => _localizer.GetString(PollingEngineRegistration.BatteryKey, PollingEngineRegistration.BatteryFallback);

    /// <summary>Localized "Based on" prediction-source prefix.</summary>
    public string BasedOnLabel => _localizer.GetString(PollingEngineRegistration.BasedOnKey, PollingEngineRegistration.BasedOnFallback);

    /// <summary>Localized confidence suffix ("conf").</summary>
    public string ConfidenceLabel => _localizer.GetString(PollingEngineRegistration.ConfidenceKey, PollingEngineRegistration.ConfidenceFallback);

    /// <summary>Localized "Prediction" label (reused for the disclosed prediction line + breakdown legend).</summary>
    public string PredictionLabel => _localizer.GetString(PollingEngineRegistration.PredictionKey, PollingEngineRegistration.PredictionFallback);

    /// <summary>The accessible name for the whole surface ("Adaptive Polling Engine, Active").</summary>
    public string AccessibleName => string.Concat(Title, ", ", ActiveLabel);

    /// <summary>The accessible name for a savings metric cell ("&lt;value&gt;&lt;suffix&gt; &lt;label&gt;").</summary>
    /// <param name="metric">The metric to describe.</param>
    /// <returns>The composed accessible name.</returns>
    public string MetricAccessibleName(PollingSavingsMetric metric)
    {
        ArgumentNullException.ThrowIfNull(metric);
        string label = _localizer.GetString(metric.LabelKey, metric.LabelFallback);
        string value = string.Concat(
            metric.Prefix,
            metric.Value.ToString("F" + metric.Precision.ToString(System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.CurrentCulture),
            metric.Suffix);
        return string.Concat(value, " ", label);
    }

    /// <summary>
    /// Run a cache-then-network load of both the polling status and the savings snapshot: counts the attempt, shows
    /// the skeleton only when no panel content is already visible (otherwise keeps content while refreshing), and
    /// folds every emission into the surface state. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    /// <returns>A task that completes when both streams settle.</returns>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        CancellationTokenSource? previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (ShowPanel)
        {
            IsFetching = true;
        }
        else
        {
            SetLoading();
        }

        try
        {
            await Task.WhenAll(
                PumpStatusAsync(cts.Token),
                PumpSavingsAsync(cts.Token)).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this run silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    /// <returns>A task that completes when the reload settles.</returns>
    public Task RetryAsync() => LoadAsync();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancellationTokenSource? cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task PumpStatusAsync(CancellationToken token)
    {
        await foreach (RepositoryResult<PollingStatusSnapshot> result in
            _source.StreamStatusAsync(token).ConfigureAwait(false))
        {
            ApplyStatus(result);
        }
    }

    private async Task PumpSavingsAsync(CancellationToken token)
    {
        await foreach (RepositoryResult<PollingSavings> result in
            _source.StreamSavingsAsync(token).ConfigureAwait(false))
        {
            ApplySavings(result);
        }
    }

    private void ApplyStatus(RepositoryResult<PollingStatusSnapshot> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!ShowPanel)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: result.Status == LoadStatus.Refreshing, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                // Absent body — web `!status?.enabled` collapses the whole surface.
                SetDisabled(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        PollingStatusSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        if (!snapshot.Enabled)
        {
            SetDisabled(fetchedAt);
            return;
        }

        DateTimeOffset now = _clock();
        var rows = new List<PollingVehicleRow>(snapshot.Vehicles.Count);
        foreach (PollingVehicleActivity vehicle in snapshot.Vehicles)
        {
            rows.Add(PollingVehicleRow.Project(vehicle, now, _localizer));
        }

        VehicleRows = rows;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsError = false;
        IsStale = stale || offline;
        IsOffline = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? PollingEngineState.Offline
            : stale
                ? PollingEngineState.Stale
                : rows.Count == 0
                    ? PollingEngineState.Empty
                    : PollingEngineState.Loaded;
    }

    private void ApplySavings(RepositoryResult<PollingSavings> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                break;
            case LoadStatus.Empty:
            case LoadStatus.Error:
                // web: a missing/failed savings query renders no card.
                Savings = null;
                break;
            default:
                Savings = result.HasValue ? PollingSavingsView.Project(result.Value!) : null;
                break;
        }
    }

    private void SetLoading()
    {
        VehicleRows = Array.Empty<PollingVehicleRow>();
        IsError = false;
        IsStale = false;
        IsOffline = false;
        ErrorMessage = null;
        State = PollingEngineState.Loading;
    }

    private void SetDisabled(DateTimeOffset? fetchedAt)
    {
        VehicleRows = Array.Empty<PollingVehicleRow>();
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsError = false;
        IsStale = false;
        IsOffline = false;
        ErrorMessage = null;
        State = PollingEngineState.Disabled;
    }

    private void SetError(RepositoryError? error)
    {
        VehicleRows = Array.Empty<PollingVehicleRow>();
        IsFetching = false;
        IsStale = false;
        IsOffline = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = PollingEngineState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        bool offline = error?.Kind is RepositoryErrorKind.Offline or RepositoryErrorKind.Network;
        return offline
            ? _localizer.GetString(PollingEngineRegistration.OfflineKey, PollingEngineRegistration.OfflineFallback)
            : _localizer.GetString(PollingEngineRegistration.ErrorKey, PollingEngineRegistration.ErrorFallback);
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
}
