using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="XRayHeader"/> view — the native port of the web
/// component's data flow (web/src/features/admin/components/ingest-xray/XRayHeader.tsx, fed by
/// <c>useIngestXRay</c> on the IngestXRayPage). It drives one cache-then-network read through the
/// <see cref="IXRayHeaderSource"/>, retains the selected <see cref="Window"/> so the Window stat reads back
/// immediately (web parity — the <c>windowSel</c> prop drives that card independently of the data), projects
/// each emission through <see cref="XRayHeaderProjection"/>, and exposes the full state matrix
/// (loading / ready / empty / stale / offline / error) so the view is a thin renderer. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class XRayHeaderViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IXRayHeaderSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private IngestXRaySummary? _summary;
    private bool _disposed;

    private int _vehicleId;
    private IngestXRayWindow _window = IngestXRayWindow.H1;
    private IngestXRayBucket _bucket = IngestXRayBucket.M1;
    private int _limit = XRayHeaderRegistration.DefaultLimit;

    private XRayHeaderState _state = XRayHeaderState.Loading;
    private XRayHeaderDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    public XRayHeaderViewModel(IXRayHeaderSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = XRayHeaderProjection.Project(null, _window, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Request context ───────────────────────────────────────────────────────────────────────────────

    /// <summary>The vehicle the X-Ray is loaded for (web <c>vehicleId</c>); 0 = none selected.</summary>
    public int VehicleId
    {
        get => _vehicleId;
        private set => Set(ref _vehicleId, value);
    }

    /// <summary>The selected rolling window (web <c>windowSel</c>) — drives the Window stat directly.</summary>
    public IngestXRayWindow Window
    {
        get => _window;
        private set => Set(ref _window, value);
    }

    /// <summary>The selected bucket granularity (web <c>bucketSel</c>); carried for request fidelity.</summary>
    public IngestXRayBucket Bucket
    {
        get => _bucket;
        private set => Set(ref _bucket, value);
    }

    /// <summary>The <c>fields</c> row cap requested (web <c>limit</c>).</summary>
    public int Limit
    {
        get => _limit;
        private set => Set(ref _limit, value);
    }

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / ready / empty / stale / offline / error).</summary>
    public XRayHeaderState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready stat values (samples / fields / window).</summary>
    public XRayHeaderDisplay Display
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

    /// <summary>True when the shown value is a cached value past the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the network failed but a cached value is still being shown.</summary>
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

    // ── Localized copy (web t(...) keys) ────────────────────────────────────────────────────────────────

    /// <summary>"Total samples" stat label.</summary>
    public string SamplesLabel => XRayHeaderRegistration.SamplesLabel(_localizer);

    /// <summary>"within selected window" stat sub-label.</summary>
    public string SamplesSublabel => XRayHeaderRegistration.SamplesSublabel(_localizer);

    /// <summary>"Distinct fields" stat label.</summary>
    public string FieldsLabel => XRayHeaderRegistration.FieldsLabel(_localizer);

    /// <summary>"unique signal names" stat sub-label.</summary>
    public string FieldsSublabel => XRayHeaderRegistration.FieldsSublabel(_localizer);

    /// <summary>"Window" stat label.</summary>
    public string WindowTitle => XRayHeaderRegistration.WindowTitle(_localizer);

    /// <summary>"observation horizon" stat sub-label.</summary>
    public string WindowSublabel => XRayHeaderRegistration.WindowSublabel(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => XRayHeaderRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => XRayHeaderRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => XRayHeaderRegistration.RetryLabel(_localizer);

    /// <summary>Zero-sample empty hint.</summary>
    public string EmptyHint => XRayHeaderRegistration.EmptyHint(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        XRayHeaderState.Loading => XRayHeaderRegistration.LoadingLabel(_localizer),
        XRayHeaderState.Stale => StaleLabel,
        XRayHeaderState.Offline => _errorMessage ?? XRayHeaderRegistration.OfflineText(_localizer),
        XRayHeaderState.Error => _errorMessage ?? XRayHeaderRegistration.ErrorText(_localizer),
        XRayHeaderState.Empty => EmptyHint,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Point the surface at a vehicle + window + bucket + limit (web parity for the page's <c>useState</c>
    /// selections). Resets the retained summary so the cards show '—' until the next load resolves, while the
    /// Window stat updates to the new label immediately.
    /// </summary>
    public void Configure(int vehicleId, IngestXRayWindow window, IngestXRayBucket bucket, int limit)
    {
        VehicleId = vehicleId;
        Window = window;
        Bucket = bucket;
        Limit = limit;
        _summary = null;
        RefreshDisplay();
        Raise(nameof(StatusAnnouncement));
    }

    /// <summary>Run (or re-run) the cache-then-network ingest-xray load for the current context.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_vehicleId <= 0)
        {
            // web parity: useIngestXRay is enabled only for a positive vehicle id. With no vehicle there is
            // nothing to fetch — render the empty surface rather than a perpetual spinner.
            _summary = null;
            ApplyNoVehicle();
            return;
        }

        if (_summary is null)
        {
            State = XRayHeaderState.Loading;
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
            await foreach (var result in _source
                .StreamAsync(_vehicleId, _window, _bucket, _limit, cts.Token)
                .ConfigureAwait(false))
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

    private void Apply(RepositoryResult<IngestXRaySummary> result)
    {
        _summary = NextSummary(result, _summary);

        var outcome = Classify(result, _summary);
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

    private void ApplyNoVehicle()
    {
        State = XRayHeaderState.Empty;
        IsFetching = false;
        IsError = false;
        IsStale = false;
        IsOffline = false;
        ErrorMessage = null;
        UpdatedAt = null;
        RefreshDisplay();
        Raise(nameof(StatusAnnouncement));
    }

    private XRayOutcome Classify(RepositoryResult<IngestXRaySummary> result, IngestXRaySummary? summary)
    {
        bool hasValue = summary is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new XRayOutcome(ContentState(summary), true, false, false, false, null, null)
                : new XRayOutcome(XRayHeaderState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new XRayOutcome(
                result.IsStale ? XRayHeaderState.Stale : ContentState(summary),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new XRayOutcome(
                result.IsStale ? XRayHeaderState.Stale : ContentState(summary),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new XRayOutcome(
                ContentState(summary), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new XRayOutcome(
                XRayHeaderState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new XRayOutcome(
                    XRayHeaderState.Offline, false, true, true, true,
                    XRayHeaderRegistration.OfflineText(_localizer), result.FetchedAt)
                : new XRayOutcome(
                    XRayHeaderState.Error, false, true, false, false,
                    XRayHeaderRegistration.ErrorText(_localizer), result.FetchedAt),

            _ => new XRayOutcome(
                XRayHeaderState.Error, false, true, false, false,
                XRayHeaderRegistration.ErrorText(_localizer), null),
        };
    }

    private static XRayHeaderState ContentState(IngestXRaySummary? summary) =>
        summary is { TotalSamples: 0, UniqueFields: 0 } ? XRayHeaderState.Empty : XRayHeaderState.Ready;

    private static IngestXRaySummary? NextSummary(
        RepositoryResult<IngestXRaySummary> result, IngestXRaySummary? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                       // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null,         // resolved with nothing to show
            _ => result.Value ?? previous,                        // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = XRayHeaderProjection.Project(_summary, _window, _localizer);

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

    private readonly record struct XRayOutcome(
        XRayHeaderState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
