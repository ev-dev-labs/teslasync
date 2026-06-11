using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TelemetryPipelineCard"/> view — the native port
/// of the web component's hook composition
/// (web/src/features/system/components/status/TelemetryPipelineCard.tsx). It drives two independent
/// cache-then-network reads through the <see cref="ITelemetryPipelineCardSource"/> — the Fleet Telemetry
/// streaming status (web <c>useMQTTStatus</c>) and the polling-engine status (web
/// <c>useQuery(getPollingStatus)</c>) — joins them against the host-supplied fleet roster + count context
/// (the web component's props), projects everything through <see cref="TelemetryPipelineProjection"/>, and
/// exposes the overall <see cref="State"/> plus per-read freshness so the view is a thin renderer. The
/// streaming read drives the card chrome (loading / error / stale / offline); polling is a non-fatal
/// enrichment. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TelemetryPipelineCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITelemetryPipelineCardSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _streamCts;
    private CancellationTokenSource? _pollingCts;
    private bool _disposed;

    // Fleet-context inputs (the web component's props).
    private IReadOnlyList<TelemetryPipelineVehicle> _vehicles = Array.Empty<TelemetryPipelineVehicle>();
    private long _positionCount;
    private long _drivesCount;
    private long? _chargingSessionsCount;
    private long? _signalLogCount;

    // Latest snapshots.
    private TelemetryStreamSnapshot? _stream;
    private PollingEngineSnapshot? _polling;
    private bool _pollingAvailable;

    // Streaming read freshness (drives the chrome).
    private bool _streamResolved;
    private bool _streamIsFetching;
    private bool _streamIsError;
    private bool _streamIsStale;
    private bool _streamOffline;
    private bool _streamHardFailedNoCache;
    private DateTimeOffset? _streamUpdatedAt;
    private string? _streamErrorMessage;
    private int _streamAttempts;

    // Projected, render-ready state.
    private TelemetryPipelineState _state = TelemetryPipelineState.Loading;
    private TelemetryPipelineDisplay _display = TelemetryPipelineDisplay.Empty;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public TelemetryPipelineCardViewModel(
        ITelemetryPipelineCardSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Projected state ───────────────────────────────────────────────────────────────────────────────

    /// <summary>The overall card chrome state.</summary>
    public TelemetryPipelineState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The fully projected, render-ready display (fleet rollup, chips, per-vehicle rows).</summary>
    public TelemetryPipelineDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful streaming-status update timestamp.</summary>
    public DateTimeOffset? StreamUpdatedAt
    {
        get => _streamUpdatedAt;
        private set => Set(ref _streamUpdatedAt, value);
    }

    /// <summary>True while a streaming-status background refresh is in flight.</summary>
    public bool StreamIsFetching
    {
        get => _streamIsFetching;
        private set => Set(ref _streamIsFetching, value);
    }

    /// <summary>True when the last streaming-status read failed.</summary>
    public bool StreamIsError
    {
        get => _streamIsError;
        private set => Set(ref _streamIsError, value);
    }

    /// <summary>True when the shown streaming status is older than the freshness window.</summary>
    public bool StreamIsStale
    {
        get => _streamIsStale;
        private set => Set(ref _streamIsStale, value);
    }

    /// <summary>Localized error message for the streaming read (null when not errored).</summary>
    public string? StreamErrorMessage
    {
        get => _streamErrorMessage;
        private set => Set(ref _streamErrorMessage, value);
    }

    /// <summary>Streaming-status load attempts (including retries).</summary>
    public int StreamAttempts
    {
        get => _streamAttempts;
        private set => Set(ref _streamAttempts, value);
    }

    /// <summary>True when the polling-engine read produced a usable snapshot (web parity for a non-undefined query).</summary>
    public bool PollingAvailable
    {
        get => _pollingAvailable;
        private set => Set(ref _pollingAvailable, value);
    }

    // ── Localized copy (web literal strings, routed through the i18n facade) ────────────────────────────

    /// <summary>The surface's accessible name.</summary>
    public string AccessibleName => TelemetryPipelineCardRegistration.AccessibleName(_localizer);

    /// <summary>The "Liveness" sub-header label.</summary>
    public string LivenessHeaderLabel => _localizer.GetString("telemetry.pipeline.livenessHeader", "Liveness");

    /// <summary>The empty-state title (no vehicles configured).</summary>
    public string EmptyTitle => _localizer.GetString("telemetry.pipeline.emptyTitle", "No vehicles");

    /// <summary>The empty-state message (no vehicles configured).</summary>
    public string EmptyMessage => _localizer.GetString(
        "telemetry.pipeline.emptyMessage",
        "No vehicles configured yet. Add a vehicle from the Tesla account page to see per-vehicle telemetry status.");

    /// <summary>The loading announcement.</summary>
    public string LoadingLabel => _localizer.GetString("telemetry.pipeline.loading", "Loading telemetry pipeline");

    /// <summary>The error message (streaming read failed).</summary>
    public string ErrorMessage => _streamErrorMessage
        ?? _localizer.GetString("telemetry.pipeline.error", "Couldn't load telemetry pipeline status");

    /// <summary>The retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("telemetry.pipeline.retry", "Retry");

    /// <summary>The "stale cache" chip label.</summary>
    public string StaleLabel => _localizer.GetString("telemetry.pipeline.stale", "Showing cached data");

    /// <summary>The "offline" chip label.</summary>
    public string OfflineLabel => _localizer.GetString("telemetry.pipeline.offline", "Offline — showing cached data");

    /// <summary>The per-row "last seen" prefix.</summary>
    public string LastPrefix => _localizer.GetString("telemetry.pipeline.lastPrefix", "last:");

    /// <summary>The per-row "next poll" prefix.</summary>
    public string NextPrefix => _localizer.GetString("telemetry.pipeline.nextPrefix", "next:");

    /// <summary>The "Open Telemetry Coverage" footer link label.</summary>
    public string CoverageLinkLabel => _localizer.GetString("telemetry.pipeline.openCoverage", "Open Telemetry Coverage");

    /// <summary>The "MQTT Inspector" footer link label.</summary>
    public string MqttInspectorLinkLabel => _localizer.GetString("telemetry.pipeline.mqttInspector", "MQTT Inspector");

    /// <summary>The "All vehicles" footer link label.</summary>
    public string AllVehiclesLinkLabel => _localizer.GetString("telemetry.pipeline.allVehicles", "All vehicles");

    // ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Set the host-supplied fleet context (the web component's props: the roster + the four counts) and
    /// re-project. Re-derives the overall <see cref="State"/> (an empty roster is the empty state).
    /// </summary>
    public void SetFleetContext(
        IReadOnlyList<TelemetryPipelineVehicle> vehicles,
        long positionCount,
        long drivesCount,
        long? chargingSessionsCount,
        long? signalLogCount)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        _vehicles = vehicles;
        _positionCount = positionCount;
        _drivesCount = drivesCount;
        _chargingSessionsCount = chargingSessionsCount;
        _signalLogCount = signalLogCount;
        Display = Project();
        RecomputeState();
    }

    /// <summary>Re-project the relative-time labels against the current clock (the web's 5-second <c>now</c> tick).</summary>
    public void Tick()
    {
        Display = Project();
    }

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Load both reads concurrently (web parity — the two queries run independently).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) =>
        Task.WhenAll(
            LoadStreamingAsync(cancellationToken),
            LoadPollingAsync(cancellationToken));

    /// <summary>Run (or re-run) the Fleet Telemetry streaming-status cache-then-network read.</summary>
    public async Task LoadStreamingAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _streamCts, cancellationToken);
        StreamAttempts++;
        StreamIsFetching = true;

        try
        {
            await foreach (var result in _source.StreamStreamingStatusAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyStreaming(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Run (or re-run) the polling-engine-status cache-then-network read (non-fatal enrichment).</summary>
    public async Task LoadPollingAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _pollingCts, cancellationToken);

        try
        {
            await foreach (var result in _source.StreamPollingStatusAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyPolling(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry both reads after a failure.</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _streamCts);
        Cancel(ref _pollingCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ───────────────────────────────────────────────────────────────────────────────────────

    private void ApplyStreaming(RepositoryResult<TelemetryStreamSnapshot> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                StreamIsFetching = true;
                break;

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
                _stream = result.Value ?? _stream;
                _streamResolved = true;
                StreamIsFetching = true;
                StreamIsStale = result.IsStale;
                _streamOffline = false;
                _streamHardFailedNoCache = false;
                StreamIsError = false;
                StreamErrorMessage = null;
                if (result.FetchedAt is { } cachedAt)
                {
                    StreamUpdatedAt = cachedAt;
                }

                break;

            case LoadStatus.Loaded:
                _stream = result.Value;
                _streamResolved = true;
                StreamIsFetching = false;
                StreamIsStale = false;
                StreamIsError = false;
                _streamOffline = false;
                _streamHardFailedNoCache = false;
                StreamErrorMessage = null;
                StreamUpdatedAt = result.FetchedAt;
                break;

            case LoadStatus.Empty:
                // A null/absent body is a meaningful "disconnected, no streaming vehicles" status.
                _stream = TelemetryStreamSnapshot.Empty;
                _streamResolved = true;
                StreamIsFetching = false;
                StreamIsStale = false;
                StreamIsError = false;
                _streamOffline = false;
                _streamHardFailedNoCache = false;
                StreamErrorMessage = null;
                StreamUpdatedAt = result.FetchedAt;
                break;

            case LoadStatus.Offline:
                _stream = result.Value ?? _stream;
                _streamResolved = true;
                StreamIsFetching = false;
                StreamIsStale = true;
                StreamIsError = true;
                _streamOffline = true;
                _streamHardFailedNoCache = false;
                StreamErrorMessage = ErrorTextFor(result.Error);
                if (result.FetchedAt is { } offlineAt)
                {
                    StreamUpdatedAt = offlineAt;
                }

                break;

            default:
                StreamIsFetching = false;
                StreamIsError = true;
                if (_stream is not null)
                {
                    _streamOffline = true;
                    StreamIsStale = true;
                    _streamHardFailedNoCache = false;
                }
                else
                {
                    _streamHardFailedNoCache = true;
                }

                StreamErrorMessage = ErrorTextFor(result.Error);
                break;
        }

        Display = Project();
        RecomputeState();
    }

    private void ApplyPolling(RepositoryResult<PollingEngineSnapshot> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
            case LoadStatus.Loaded:
                _polling = result.Value ?? _polling;
                PollingAvailable = _polling is not null;
                break;

            case LoadStatus.Offline:
                _polling = result.Value ?? _polling;
                PollingAvailable = _polling is not null;
                break;

            case LoadStatus.Empty:
                // web parity: an undefined polling query is treated as "enabled" with no per-vehicle data.
                _polling = null;
                PollingAvailable = false;
                break;

            case LoadStatus.Error:
                // Non-fatal: keep any prior cached snapshot; absence simply means streaming-only.
                PollingAvailable = _polling is not null;
                break;

            case LoadStatus.Loading:
            default:
                break;
        }

        Display = Project();
    }

    private TelemetryPipelineDisplay Project() => TelemetryPipelineProjection.Project(
        _vehicles,
        _stream,
        _polling,
        _positionCount,
        _drivesCount,
        _chargingSessionsCount,
        _signalLogCount,
        _localizer,
        _clock());

    private void RecomputeState()
    {
        TelemetryPipelineState next;
        if (!_streamResolved && _stream is null && !_streamHardFailedNoCache)
        {
            next = TelemetryPipelineState.Loading;
        }
        else if (_streamHardFailedNoCache)
        {
            next = TelemetryPipelineState.Error;
        }
        else if (_vehicles.Count == 0)
        {
            next = TelemetryPipelineState.Empty;
        }
        else if (_streamOffline)
        {
            next = TelemetryPipelineState.Offline;
        }
        else if (_streamIsStale)
        {
            next = TelemetryPipelineState.Stale;
        }
        else
        {
            next = TelemetryPipelineState.Ready;
        }

        State = next;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "telemetry.pipeline.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "telemetry.pipeline.error.offline",
            _ => "telemetry.pipeline.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the telemetry pipeline",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached data",
            _ => "Couldn't load telemetry pipeline status",
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

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        return true;
    }
}
