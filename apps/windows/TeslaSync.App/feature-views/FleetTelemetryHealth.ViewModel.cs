using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FleetTelemetryHealth"/> view — the native port
/// of the web component's hook composition
/// (web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx). It drives two independent
/// cache-then-network sections through the <see cref="IFleetTelemetryHealthSource"/> — the error-VIN list
/// (web <c>useFleetTelemetryErrorVINs</c>) and the per-VIN error feed (web
/// <c>useFleetTelemetryErrors(selectedVin)</c>) — holds the <see cref="SelectedVin"/> filter the web keeps
/// in <c>useState</c>, projects each section through <see cref="FleetTelemetryHealthProjection"/>, and
/// exposes per-section state + freshness so the view is a thin renderer. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class FleetTelemetryHealthViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetTelemetryHealthSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _vinsCts;
    private CancellationTokenSource? _errorsCts;
    private IReadOnlyList<FleetTelemetryErrorVin> _vins = Array.Empty<FleetTelemetryErrorVin>();
    private IReadOnlyList<FleetTelemetryError> _errors = Array.Empty<FleetTelemetryError>();
    private bool _disposed;

    private string _selectedVin = string.Empty;

    private FleetTelemetrySectionState _vinsState = FleetTelemetrySectionState.Loading;
    private FleetTelemetryErrorVinsDisplay _vinsDisplay = FleetTelemetryErrorVinsDisplay.Empty;
    private DateTimeOffset? _vinsUpdatedAt;
    private bool _vinsIsFetching;
    private bool _vinsIsError;
    private bool _vinsIsStale;
    private bool _isRefreshingVins;
    private string? _vinsErrorMessage;
    private int _vinsAttempts;

    private FleetTelemetrySectionState _errorsState = FleetTelemetrySectionState.Loading;
    private FleetTelemetryErrorsDisplay _errorsDisplay = FleetTelemetryErrorsDisplay.Empty;
    private DateTimeOffset? _errorsUpdatedAt;
    private bool _errorsIsFetching;
    private bool _errorsIsError;
    private bool _errorsIsStale;
    private bool _isRefreshingErrors;
    private string? _errorsErrorMessage;
    private int _errorsAttempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public FleetTelemetryHealthViewModel(
        IFleetTelemetryHealthSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Selection ───────────────────────────────────────────────────────────────────────────────────

    /// <summary>The selected VIN filter ("" = none) — web <c>selectedVin</c>.</summary>
    public string SelectedVin
    {
        get => _selectedVin;
        private set
        {
            if (Set(ref _selectedVin, value))
            {
                Raise(nameof(HasVinFilter));
            }
        }
    }

    /// <summary>True when a VIN filter is active (web <c>selectedVin</c> truthy).</summary>
    public bool HasVinFilter => _selectedVin.Length > 0;

    // ── Error-VINs section ──────────────────────────────────────────────────────────────────────────

    /// <summary>The Error-VINs section state.</summary>
    public FleetTelemetrySectionState VinsState
    {
        get => _vinsState;
        private set => Set(ref _vinsState, value);
    }

    /// <summary>The projected Error-VINs display (count badge + table rows).</summary>
    public FleetTelemetryErrorVinsDisplay VinsDisplay
    {
        get => _vinsDisplay;
        private set => Set(ref _vinsDisplay, value);
    }

    /// <summary>Last successful Error-VINs update timestamp.</summary>
    public DateTimeOffset? VinsUpdatedAt
    {
        get => _vinsUpdatedAt;
        private set => Set(ref _vinsUpdatedAt, value);
    }

    /// <summary>True while an Error-VINs background refresh is in flight.</summary>
    public bool VinsIsFetching
    {
        get => _vinsIsFetching;
        private set => Set(ref _vinsIsFetching, value);
    }

    /// <summary>True when the last Error-VINs read failed.</summary>
    public bool VinsIsError
    {
        get => _vinsIsError;
        private set => Set(ref _vinsIsError, value);
    }

    /// <summary>True when the shown Error-VINs are older than the freshness window.</summary>
    public bool VinsIsStale
    {
        get => _vinsIsStale;
        private set => Set(ref _vinsIsStale, value);
    }

    /// <summary>True while the "Refresh from Tesla" mutation + reload runs for the Error-VINs card.</summary>
    public bool IsRefreshingVins
    {
        get => _isRefreshingVins;
        private set => Set(ref _isRefreshingVins, value);
    }

    /// <summary>Localized error message for the Error-VINs section (null when not errored).</summary>
    public string? VinsErrorMessage
    {
        get => _vinsErrorMessage;
        private set => Set(ref _vinsErrorMessage, value);
    }

    /// <summary>Error-VINs load attempts (including retries).</summary>
    public int VinsAttempts
    {
        get => _vinsAttempts;
        private set => Set(ref _vinsAttempts, value);
    }

    // ── Error-Log section ───────────────────────────────────────────────────────────────────────────

    /// <summary>The Error-Log section state.</summary>
    public FleetTelemetrySectionState ErrorsState
    {
        get => _errorsState;
        private set => Set(ref _errorsState, value);
    }

    /// <summary>The projected Error-Log display (table rows).</summary>
    public FleetTelemetryErrorsDisplay ErrorsDisplay
    {
        get => _errorsDisplay;
        private set => Set(ref _errorsDisplay, value);
    }

    /// <summary>Last successful Error-Log update timestamp.</summary>
    public DateTimeOffset? ErrorsUpdatedAt
    {
        get => _errorsUpdatedAt;
        private set => Set(ref _errorsUpdatedAt, value);
    }

    /// <summary>True while an Error-Log background refresh is in flight.</summary>
    public bool ErrorsIsFetching
    {
        get => _errorsIsFetching;
        private set => Set(ref _errorsIsFetching, value);
    }

    /// <summary>True when the last Error-Log read failed.</summary>
    public bool ErrorsIsError
    {
        get => _errorsIsError;
        private set => Set(ref _errorsIsError, value);
    }

    /// <summary>True when the shown Error-Log rows are older than the freshness window.</summary>
    public bool ErrorsIsStale
    {
        get => _errorsIsStale;
        private set => Set(ref _errorsIsStale, value);
    }

    /// <summary>True while the "Refresh from Tesla" mutation + reload runs for the Error-Log card.</summary>
    public bool IsRefreshingErrors
    {
        get => _isRefreshingErrors;
        private set => Set(ref _isRefreshingErrors, value);
    }

    /// <summary>Localized error message for the Error-Log section (null when not errored).</summary>
    public string? ErrorsErrorMessage
    {
        get => _errorsErrorMessage;
        private set => Set(ref _errorsErrorMessage, value);
    }

    /// <summary>Error-Log load attempts (including retries).</summary>
    public int ErrorsAttempts
    {
        get => _errorsAttempts;
        private set => Set(ref _errorsAttempts, value);
    }

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>Error-VINs card title.</summary>
    public string ErrorVinsTitle => FleetTelemetryHealthRegistration.ErrorVinsTitle(_localizer);

    /// <summary>Error-VINs card description.</summary>
    public string ErrorVinsDescription => FleetTelemetryHealthRegistration.ErrorVinsDescription(_localizer);

    /// <summary>Error-Log card title.</summary>
    public string ErrorLogTitle => FleetTelemetryHealthRegistration.ErrorLogTitle(_localizer);

    /// <summary>Error-Log card description.</summary>
    public string ErrorLogDescription => FleetTelemetryHealthRegistration.ErrorLogDescription(_localizer);

    /// <summary>"VIN" column header.</summary>
    public string VinHeader => _localizer.GetString("devtools.health.vin", "VIN");

    /// <summary>"First Seen" column header.</summary>
    public string FirstSeenHeader => _localizer.GetString("devtools.health.firstSeen", "First Seen");

    /// <summary>"Last Seen" column header.</summary>
    public string LastSeenHeader => _localizer.GetString("devtools.health.lastSeen", "Last Seen");

    /// <summary>"Error Code" column header.</summary>
    public string ErrorCodeHeader => _localizer.GetString("devtools.health.errorCode", "Error Code");

    /// <summary>"Message" column header.</summary>
    public string MessageHeader => _localizer.GetString("devtools.health.message", "Message");

    /// <summary>"Reported At" column header.</summary>
    public string ReportedAtHeader => _localizer.GetString("devtools.health.reportedAt", "Reported At");

    /// <summary>"Refresh from Tesla" button label.</summary>
    public string RefreshLabel => _localizer.GetString("devtools.health.refreshVins", "Refresh from Tesla");

    /// <summary>"Filtered" chip label (prefix for the active VIN filter).</summary>
    public string FilteredByLabel => _localizer.GetString("devtools.health.filteredBy", "Filtered");

    /// <summary>"Clear VIN filter" accessibility label.</summary>
    public string ClearVinFilterLabel => _localizer.GetString("devtools.health.clearVinFilter", "Clear VIN filter");

    /// <summary>Empty-state message for the Error-VINs card.</summary>
    public string NoErrorVinsMessage =>
        _localizer.GetString("devtools.health.noErrorVins", "No vehicles with telemetry errors");

    /// <summary>Empty-state message for the Error-Log card.</summary>
    public string NoErrorsMessage =>
        _localizer.GetString("devtools.health.noErrors", "No fleet telemetry errors recorded");

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("devtools.health.retry", "Retry");

    /// <summary>Loading announcement for the Error-VINs card.</summary>
    public string VinsLoadingLabel => _localizer.GetString("devtools.health.loadingVins", "Loading error VINs");

    /// <summary>Loading announcement for the Error-Log card.</summary>
    public string ErrorsLoadingLabel => _localizer.GetString("devtools.health.loadingErrors", "Loading error log");

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Load both sections concurrently (web parity — the two queries run independently).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) =>
        Task.WhenAll(
            LoadVinsAsync(cancellationToken),
            LoadErrorsAsync(resetContent: true, cancellationToken));

    /// <summary>Run (or re-run) the Error-VINs cache-then-network load.</summary>
    public async Task LoadVinsAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _vinsCts, cancellationToken);
        VinsAttempts++;
        if (_vins.Count == 0)
        {
            VinsState = FleetTelemetrySectionState.Loading;
        }
        else
        {
            VinsIsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamErrorVinsAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyVins(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Run (or re-run) the Error-Log cache-then-network load for the current <see cref="SelectedVin"/>.</summary>
    public async Task LoadErrorsAsync(bool resetContent = false, CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _errorsCts, cancellationToken);
        ErrorsAttempts++;

        if (resetContent)
        {
            // web: a new selectedVin changes the query key, so the section shows its skeleton, not the
            // previously-filtered rows.
            _errors = Array.Empty<FleetTelemetryError>();
            ErrorsDisplay = FleetTelemetryErrorsDisplay.Empty;
            ErrorsState = FleetTelemetrySectionState.Loading;
        }
        else if (_errors.Count == 0)
        {
            ErrorsState = FleetTelemetrySectionState.Loading;
        }
        else
        {
            ErrorsIsFetching = true;
        }

        string vin = _selectedVin;
        try
        {
            await foreach (var result in _source.StreamErrorsAsync(vin.Length == 0 ? null : vin, cts.Token).ConfigureAwait(false))
            {
                ApplyErrors(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>
    /// Toggle the VIN filter to <paramref name="vin"/> (clearing it when it is already selected, web parity
    /// for <c>setSelectedVin(r.vin === selectedVin ? '' : r.vin)</c>) and reload the Error-Log section.
    /// </summary>
    public Task SelectVinAsync(string vin, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(vin);
        SelectedVin = string.Equals(_selectedVin, vin, StringComparison.Ordinal) ? string.Empty : vin;
        return LoadErrorsAsync(resetContent: true, cancellationToken);
    }

    /// <summary>Clear the VIN filter (web <c>setSelectedVin('')</c>) and reload the Error-Log section.</summary>
    public Task ClearVinAsync(CancellationToken cancellationToken = default)
    {
        if (_selectedVin.Length == 0)
        {
            return Task.CompletedTask;
        }

        SelectedVin = string.Empty;
        return LoadErrorsAsync(resetContent: true, cancellationToken);
    }

    /// <summary>
    /// "Refresh from Tesla" for the Error-VINs card — POST the refresh mutation, then reload the list (web
    /// <c>refreshVINs.mutate()</c> → invalidate → refetch). The POST is best-effort: a failure does not
    /// block the reload, which reflects the authoritative server state.
    /// </summary>
    public async Task RefreshVinsAsync(CancellationToken cancellationToken = default)
    {
        if (IsRefreshingVins)
        {
            return;
        }

        IsRefreshingVins = true;
        VinsIsFetching = true;
        try
        {
            try
            {
                await _source.RefreshErrorVinsAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // web shows a toast on POST failure; the reload below still surfaces the current state.
            }

            await LoadVinsAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshingVins = false;
        }
    }

    /// <summary>
    /// "Refresh from Tesla" for the Error-Log card — POST the refresh mutation, then reload the feed (web
    /// <c>refreshErrors.mutate()</c> → invalidate → refetch), keeping the current VIN filter.
    /// </summary>
    public async Task RefreshErrorsAsync(CancellationToken cancellationToken = default)
    {
        if (IsRefreshingErrors)
        {
            return;
        }

        IsRefreshingErrors = true;
        ErrorsIsFetching = true;
        try
        {
            try
            {
                await _source.RefreshErrorsAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // web shows a toast on POST failure; the reload below still surfaces the current state.
            }

            await LoadErrorsAsync(resetContent: false, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshingErrors = false;
        }
    }

    /// <summary>Retry the Error-VINs section after a failure.</summary>
    public Task RetryVinsAsync(CancellationToken cancellationToken = default) => LoadVinsAsync(cancellationToken);

    /// <summary>Retry the Error-Log section after a failure.</summary>
    public Task RetryErrorsAsync(CancellationToken cancellationToken = default) =>
        LoadErrorsAsync(resetContent: false, cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _vinsCts);
        Cancel(ref _errorsCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private void ApplyVins(RepositoryResult<IReadOnlyList<FleetTelemetryErrorVin>> result)
    {
        _vins = NextRows(result, _vins);
        VinsDisplay = FleetTelemetryHealthProjection.ProjectVins(_vins, _localizer, _clock());

        var outcome = Classify(result, _vins.Count);
        VinsState = outcome.State;
        VinsIsFetching = outcome.IsFetching || _isRefreshingVins;
        VinsIsError = outcome.IsError;
        VinsIsStale = outcome.IsStale;
        VinsErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            VinsUpdatedAt = ts;
        }
    }

    private void ApplyErrors(RepositoryResult<IReadOnlyList<FleetTelemetryError>> result)
    {
        _errors = NextRows(result, _errors);
        ErrorsDisplay = FleetTelemetryHealthProjection.ProjectErrors(_errors, _localizer, _clock());

        var outcome = Classify(result, _errors.Count);
        ErrorsState = outcome.State;
        ErrorsIsFetching = outcome.IsFetching || _isRefreshingErrors;
        ErrorsIsError = outcome.IsError;
        ErrorsIsStale = outcome.IsStale;
        ErrorsErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            ErrorsUpdatedAt = ts;
        }
    }

    private SectionOutcome Classify<T>(RepositoryResult<IReadOnlyList<T>> result, int rowCount)
    {
        bool hasRows = rowCount > 0;
        return result.Status switch
        {
            LoadStatus.Loading => hasRows
                ? new SectionOutcome(FleetTelemetrySectionState.Loaded, true, false, false, null, null)
                : new SectionOutcome(FleetTelemetrySectionState.Loading, true, false, false, null, null),

            LoadStatus.Cached => hasRows
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(FleetTelemetrySectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Refreshing => hasRows
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(FleetTelemetrySectionState.Empty, true, false, false, null, result.FetchedAt),

            LoadStatus.Loaded => hasRows
                ? new SectionOutcome(FleetTelemetrySectionState.Loaded, false, false, false, null, result.FetchedAt)
                : new SectionOutcome(FleetTelemetrySectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                FleetTelemetrySectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasRows
                ? new SectionOutcome(FleetTelemetrySectionState.Offline, false, true, true, ErrorTextFor(result.Error), result.FetchedAt)
                : new SectionOutcome(FleetTelemetrySectionState.Error, false, true, false, ErrorTextFor(result.Error), result.FetchedAt),

            _ => new SectionOutcome(
                FleetTelemetrySectionState.Error, false, true, false, ErrorTextFor(result.Error), null),
        };
    }

    private static FleetTelemetrySectionState StaleOrLoaded(bool stale) =>
        stale ? FleetTelemetrySectionState.Stale : FleetTelemetrySectionState.Loaded;

    private static IReadOnlyList<T> NextRows<T>(RepositoryResult<IReadOnlyList<T>> result, IReadOnlyList<T> previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                          // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<T>(), // resolved with nothing to show
            _ => result.Value ?? previous,                            // cached / refreshing / loaded / offline carry rows
        };

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "devtools.health.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "devtools.health.error.offline",
            _ => "devtools.health.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view fleet telemetry health",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached data",
            _ => "Couldn't load fleet telemetry health",
        };

        return _localizer.GetString(key, fallback);
    }

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

    private readonly record struct SectionOutcome(
        FleetTelemetrySectionState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
