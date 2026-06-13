using System.ComponentModel;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.IngestXRay;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>IngestXRayPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/IngestXRayPage.tsx). It owns the two web hooks as injected ports
/// (<c>useVehicles</c> + <c>useIngestXRay</c> → <see cref="IIngestXRayPageFeed"/>) and the page's selection state
/// (the web <c>useState</c> trio: <c>vehicleId</c>, <c>windowSel</c>, <c>bucketSel</c>), and projects them into
/// the render-ready child models the composed surfaces bind to: the <see cref="ControlsModel"/> (GlassPanel 1 —
/// XRayControls), the <see cref="HeaderDisplay"/> (the three stat tiles), the <see cref="BucketChartModel"/>
/// (GlassPanel 3 — XRayBucketChart) and the <see cref="FieldsTableModel"/> (GlassPanel 4 — XRayFieldsTable). It
/// reproduces the web page's gate exactly — with no vehicle selected the no-vehicle panel (GlassPanel 2) shows and
/// the X-Ray query stays disabled; once a vehicle is picked the X-Ray loads and its loading / empty / success /
/// error state drives the tiles, chart, table and the page-tier freshness chip. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class IngestXRayPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IIngestXRayPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly IngestXRayPageDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _vehiclesCts;
    private CancellationTokenSource? _xrayCts;
    private bool _disposed;

    private IReadOnlyList<VehicleOption> _vehicles = Array.Empty<VehicleOption>();
    private XRayVehiclesStatus _vehiclesStatus = XRayVehiclesStatus.Loading;

    private int? _vehicleId;
    private IngestXRayWindow _window = IngestXRayWindow.H1;
    private IngestXRayBucket _bucket = IngestXRayBucket.M1;
    private readonly int _limit = IngestXRayPageRegistration.DefaultLimit;

    private IngestXRayPageState _state = IngestXRayPageState.Empty;
    private IngestXRayPageData? _data;
    private bool _isFetching;
    private bool _isError;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data port, localizer and (optional) diagnostics / clock.</summary>
    /// <param name="feed">The page's read seam (web <c>useVehicles</c> + <c>useIngestXRay</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for deterministic freshness timestamps in tests.</param>
    public IngestXRayPageViewModel(
        IIngestXRayPageFeed feed,
        ILocalizer localizer,
        IngestXRayPageDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new IngestXRayPageDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Page chrome (web t(...) keys) ─────────────────────────────────────────────────────────────────────────────

    /// <summary>The localized page title (web <c>admin.xray.pageTitle</c>).</summary>
    public string Title => IngestXRayPageRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>admin.xray.subtitle</c>).</summary>
    public string Subtitle => IngestXRayPageRegistration.Subtitle(_localizer);

    /// <summary>The localized field-statistics panel title (web <c>admin.xray.panels.fields</c>).</summary>
    public string PanelFieldsTitle => IngestXRayPageRegistration.PanelFields(_localizer);

    /// <summary>The localized no-vehicle empty-state title (web <c>admin.xray.noVehicle.title</c>).</summary>
    public string NoVehicleTitle => IngestXRayPageRegistration.NoVehicleTitle(_localizer);

    /// <summary>The localized no-vehicle empty-state message (web <c>admin.xray.noVehicle.message</c>).</summary>
    public string NoVehicleMessage => IngestXRayPageRegistration.NoVehicleMessage(_localizer);

    /// <summary>The X-Ray-error surface message.</summary>
    public string LoadErrorMessage => IngestXRayPageRegistration.LoadErrorMessage(_localizer);

    /// <summary>The retry affordance label.</summary>
    public string RetryLabel => IngestXRayPageRegistration.RetryLabel(_localizer);

    // ── Header stat tiles (web XRayHeader labels) ─────────────────────────────────────────────────────────────────

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

    // ── Selection ─────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The selected vehicle id, or null for none (web <c>vehicleId</c>).</summary>
    public int? VehicleId => _vehicleId;

    /// <summary>The selected rolling window (web <c>windowSel</c>).</summary>
    public IngestXRayWindow Window => _window;

    /// <summary>The selected bucket granularity (web <c>bucketSel</c>).</summary>
    public IngestXRayBucket Bucket => _bucket;

    /// <summary>True when a vehicle is selected (web <c>vehicleId !== null</c>).</summary>
    public bool HasVehicle => _vehicleId is > 0;

    /// <summary>Whether the no-vehicle panel (GlassPanel 2) is shown (web <c>vehicleId === null</c>).</summary>
    public bool ShowNoVehicle => _vehicleId is null or <= 0;

    // ── X-Ray data state (the web PageContainer query={xray} indicator) ───────────────────────────────────────────

    /// <summary>The X-Ray query state (loading / empty / ready / error) once a vehicle is selected.</summary>
    public IngestXRayPageState State => _state;

    /// <summary>True while a (re)fetch is in flight (web <c>xray.isFetching</c>) — drives the freshness chip.</summary>
    public bool IsFetching => _isFetching;

    /// <summary>True when the X-Ray query failed (web <c>xray.isError</c>) — drives the freshness chip + the error surface.</summary>
    public bool IsError => _isError;

    /// <summary>The last successful X-Ray load instant, for the freshness chip (null until the first success).</summary>
    public DateTimeOffset? UpdatedAt => _updatedAt;

    /// <summary>Whether the retryable X-Ray-error surface is shown (the native InfoBar + Retry).</summary>
    public bool ShowXRayError => HasVehicle && _state == IngestXRayPageState.Error;

    // ── Composed child models ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The controls-bar model (web <c>&lt;XRayControls vehicles={vehicles.data ?? []} vehicleId={vehicleId}
    /// windowSel={windowSel} bucketSel={bucketSel} … /&gt;</c>), carrying the fleet, the live selections and the
    /// fleet-query lifecycle.
    /// </summary>
    public XRayControlsModel ControlsModel =>
        new(_vehicles, _vehicleId, _window, _bucket, _vehiclesStatus);

    /// <summary>
    /// The three stat-tile values (web <c>&lt;XRayHeader data={xray.data} loading={xray.isLoading}
    /// windowSel={windowSel} /&gt;</c>): em-dash while loading / failed, the grouped counts once resolved, and the
    /// selected window label throughout.
    /// </summary>
    public XRayHeaderDisplay HeaderDisplay =>
        XRayHeaderProjection.Project(ContentSummary, _window, _localizer);

    /// <summary>
    /// The bucket-chart model (web <c>&lt;XRayBucketChart buckets={xray.data?.buckets ?? []}
    /// loading={xray.isLoading} /&gt;</c>).
    /// </summary>
    public XRayBucketChartModel BucketChartModel =>
        new(_state == IngestXRayPageState.Loading, _data?.Buckets ?? Array.Empty<XRayBucketPoint>());

    /// <summary>
    /// The fields-table model (web <c>&lt;XRayFieldsTable rows={xray.data?.fields ?? []}
    /// loading={xray.isLoading} /&gt;</c>).
    /// </summary>
    public XRayFieldsTableModel FieldsTableModel =>
        new(_data?.Fields ?? Array.Empty<IngestXRayFieldStat>(), _state == IngestXRayPageState.Loading);

    // The summary the header tiles read — null while loading or after a hard failure (web loading ? '—' : value), so
    // the cards show the em-dash; the window label is resolved from windowSel independently of the summary.
    private IngestXRaySummary? ContentSummary =>
        _state is IngestXRayPageState.Ready or IngestXRayPageState.Empty ? _data?.Summary : null;

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run the initial loads (web mount): the fleet, plus the X-Ray when a vehicle is already selected.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        Task vehicles = LoadVehiclesAsync(cancellationToken);
        Task xray = HasVehicle ? LoadXRayAsync(reset: true, cancellationToken) : Task.CompletedTask;
        await Task.WhenAll(vehicles, xray).ConfigureAwait(false);
    }

    /// <summary>Refresh the current X-Ray (web query refetch) — keeps the shown data while the refetch runs.</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) =>
        HasVehicle ? LoadXRayAsync(reset: false, cancellationToken) : Task.CompletedTask;

    /// <summary>Retry the failed X-Ray load (web <c>QueryError</c> retry → refetch).</summary>
    public Task RetryXRayAsync(CancellationToken cancellationToken = default) =>
        HasVehicle ? LoadXRayAsync(reset: true, cancellationToken) : Task.CompletedTask;

    /// <summary>Retry the failed fleet load (web XRayControls error retry → refetch).</summary>
    public Task RetryVehiclesAsync(CancellationToken cancellationToken = default) =>
        LoadVehiclesAsync(cancellationToken);

    /// <summary>Pick a vehicle (web <c>setVehicleId</c>): resets the X-Ray and loads it, or shows the no-vehicle panel.</summary>
    public Task SelectVehicleAsync(int? vehicleId, CancellationToken cancellationToken = default)
    {
        _vehicleId = vehicleId is > 0 ? vehicleId : null;
        return ReloadSelectionAsync(cancellationToken);
    }

    /// <summary>Pick a rolling window (web <c>setWindowSel</c>): resets and reloads the X-Ray for the new key.</summary>
    public Task SelectWindowAsync(IngestXRayWindow window, CancellationToken cancellationToken = default)
    {
        _window = window;
        return ReloadSelectionAsync(cancellationToken);
    }

    /// <summary>Pick a bucket granularity (web <c>setBucketSel</c>): resets and reloads the X-Ray for the new key.</summary>
    public Task SelectBucketAsync(IngestXRayBucket bucket, CancellationToken cancellationToken = default)
    {
        _bucket = bucket;
        return ReloadSelectionAsync(cancellationToken);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _vehiclesCts);
        Cancel(ref _xrayCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────────────

    private Task ReloadSelectionAsync(CancellationToken cancellationToken)
    {
        if (!HasVehicle)
        {
            // web parity: useIngestXRay is disabled for a null vehicle id — drop any prior data and show the
            // no-vehicle panel rather than a stale X-Ray.
            Cancel(ref _xrayCts);
            _data = null;
            _state = IngestXRayPageState.Empty;
            _isFetching = false;
            _isError = false;
            _updatedAt = null;
            RaiseChanged();
            return Task.CompletedTask;
        }

        return LoadXRayAsync(reset: true, cancellationToken);
    }

    private async Task LoadVehiclesAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _vehiclesCts, cancellationToken);

        if (_vehicles.Count == 0)
        {
            _vehiclesStatus = XRayVehiclesStatus.Loading;
            RaiseChanged();
        }

        try
        {
            IReadOnlyList<VehicleOption> vehicles = await _feed.FetchVehiclesAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _vehicles = vehicles;
            _vehiclesStatus = XRayVehiclesStatus.Resolved;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web parity: a failed useVehicles leaves the picker in its error branch with a retry; the window and
            // bucket selectors stay interactive throughout (XRayControls handles that superset).
            _vehiclesStatus = _vehicles.Count > 0 ? XRayVehiclesStatus.Offline : XRayVehiclesStatus.Error;
        }
        finally
        {
            RaiseChanged();
        }
    }

    private async Task LoadXRayAsync(bool reset, CancellationToken cancellationToken)
    {
        if (!HasVehicle || _vehicleId is not { } id)
        {
            return;
        }

        var cts = Supersede(ref _xrayCts, cancellationToken);

        if (reset)
        {
            _data = null;
        }

        _isFetching = true;
        _isError = false;
        if (_data is null)
        {
            _state = IngestXRayPageState.Loading;
        }

        RaiseChanged();

        try
        {
            IngestXRayPageData data = await _feed
                .FetchXRayAsync(id, _window, _bucket, _limit, cts.Token)
                .ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _data = data;
            _state = data.HasNoData ? IngestXRayPageState.Empty : IngestXRayPageState.Ready;
            _isError = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _isError = true;
            _state = _data is null ? IngestXRayPageState.Error : IngestXRayPageState.Ready;
        }
        finally
        {
            _isFetching = false;
            RaiseChanged();
        }
    }

    private void RaiseChanged() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty));

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
}
