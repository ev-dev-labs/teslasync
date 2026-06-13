using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DataPipelineSection"/> view — the native port of
/// the web component's hook composition
/// (web/src/features/system/components/status/DataPipelineSection.tsx). It drives the two independent
/// cache-then-network reads through the <see cref="IDataPipelineSectionSource"/> — the compression-savings
/// rollup (web <c>getCompressionStats</c>) and the export-job queue (web <c>getExportJobs</c>) — folds them
/// into a single section state (loading / loaded / empty / error / stale / offline, where the combined
/// initial loading mirrors the web <c>compLoading || exportLoading</c>), projects them through
/// <see cref="DataPipelineSectionProjection"/>, and exposes the projected display plus freshness so the view
/// is a thin renderer. The two streams pump concurrently, so result application is serialised through a gate;
/// raise/observe it from the UI thread.
/// </summary>
public sealed class DataPipelineSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDataPipelineSectionSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private bool _disposed;

    // Latest typed emission per read (drives freshness classification once both settle).
    private RepositoryResult<CompressionStatsSnapshot> _compressionResult = RepositoryResult<CompressionStatsSnapshot>.Loading();
    private RepositoryResult<IReadOnlyList<ExportJobSnapshot>> _exportResult = RepositoryResult<IReadOnlyList<ExportJobSnapshot>>.Loading();

    // Last good snapshot per read (kept across transient Loading emissions to avoid content flicker).
    private CompressionStatsSnapshot _compression = CompressionStatsSnapshot.Empty;
    private IReadOnlyList<ExportJobSnapshot> _exportJobs = Array.Empty<ExportJobSnapshot>();

    // Sticky "this read produced its first result" flags — the native analogue of TanStack's isLoading
    // (true only until the first settle). The web skeleton shows while EITHER of the two is still loading.
    private bool _compressionResolved;
    private bool _exportResolved;

    private DataPipelineSectionState _state = DataPipelineSectionState.Loading;
    private DataPipelineSectionDisplay _display = DataPipelineSectionDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching = true;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    /// <param name="source">The two-read data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">An injectable clock (defaults to <see cref="DateTimeOffset.Now"/>).</param>
    public DataPipelineSectionViewModel(
        IDataPipelineSectionSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Section state ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The section's current lifecycle state (loading / loaded / empty / error / stale / offline).</summary>
    public DataPipelineSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (tiles, gauge, badges, rows).</summary>
    public DataPipelineSectionDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the read is errored or offline (drives the freshness chip's error tone).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown content is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a manual refresh + reload is running (drives the button spinner).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>Localized error message for the error/offline states (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries / refreshes).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized chrome (web t(...) keys) ───────────────────────────────────────────────────────────

    /// <summary>Section title (web <c>t('Data Pipeline')</c>).</summary>
    public string Title => DataPipelineSectionRegistration.Title(_localizer);

    /// <summary>Section description (web accordion description).</summary>
    public string Description => DataPipelineSectionRegistration.Description(_localizer);

    /// <summary>"Compression Statistics" sub-header (web <c>t('Compression Statistics')</c>).</summary>
    public string CompressionStatisticsTitle =>
        _localizer.GetString("featureView.dataPipeline.compressionStatistics", "Compression Statistics");

    /// <summary>"Export Job Queue" sub-header (web <c>t('Export Job Queue')</c>).</summary>
    public string ExportJobQueueTitle =>
        _localizer.GetString("featureView.dataPipeline.exportJobQueue", "Export Job Queue");

    /// <summary>Export-table "Status" column header.</summary>
    public string StatusHeader => _localizer.GetString("featureView.dataPipeline.col.status", "Status");

    /// <summary>Export-table "Type" column header.</summary>
    public string TypeHeader => _localizer.GetString("featureView.dataPipeline.col.type", "Type");

    /// <summary>Export-table "Format" column header.</summary>
    public string FormatHeader => _localizer.GetString("featureView.dataPipeline.col.format", "Format");

    /// <summary>Export-table "File" column header.</summary>
    public string FileHeader => _localizer.GetString("featureView.dataPipeline.col.file", "File");

    /// <summary>Export-table "Records" column header.</summary>
    public string RecordsHeader => _localizer.GetString("featureView.dataPipeline.col.records", "Records");

    /// <summary>Export-table "Created" column header.</summary>
    public string CreatedHeader => _localizer.GetString("featureView.dataPipeline.col.created", "Created");

    /// <summary>Inline empty surface for the export table (web <c>t('No export jobs in queue')</c>).</summary>
    public string NoExportJobsMessage =>
        _localizer.GetString("featureView.dataPipeline.noExportJobs", "No export jobs in queue");

    /// <summary>Section-level empty message (no compression body and no export jobs at all).</summary>
    public string EmptyMessage => _localizer.GetString(
        "featureView.dataPipeline.empty",
        "No data pipeline information is available yet. Compression statistics and the export job queue appear here once the API has reported in.");

    /// <summary>Loading announcement.</summary>
    public string LoadingLabel => _localizer.GetString("featureView.dataPipeline.loading", "Loading data pipeline\u2026");

    /// <summary>Hard-failure message (the error surface default).</summary>
    public string ErrorMessageDefault => _localizer.GetString(
        "featureView.dataPipeline.error", "Could not load data pipeline status. Check API logs and try again.");

    /// <summary>"Refresh" affordance label.</summary>
    public string RefreshLabel => _localizer.GetString("featureView.dataPipeline.refresh", "Refresh");

    /// <summary>Retry affordance label — the Refresh action doubles as the retry (no separate mutation).</summary>
    public string RetryLabel => RefreshLabel;

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the two cache-then-network loads (web initial queries).</summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public Task LoadAsync(CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

    /// <summary>Retry after a hard failure (web Refresh from the error surface).</summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public Task RetryAsync(CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

    /// <summary>
    /// Manual "Refresh" — re-run the loads with the button in its busy state (web <c>refetch()</c>). The GET
    /// endpoints are authoritative, so there is no mutation; the reload reflects current server state.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        try
        {
            await RunAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
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

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        var token = cts.Token;

        var pumps = new[]
        {
            PumpCompressionAsync(token),
            PumpExportJobsAsync(token),
        };

        try
        {
            await Task.WhenAll(pumps).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop these emissions silently.
        }
    }

    private async Task PumpCompressionAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamCompressionAsync(token).ConfigureAwait(false))
        {
            ApplyCompression(result);
        }
    }

    private async Task PumpExportJobsAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamExportJobsAsync(token).ConfigureAwait(false))
        {
            ApplyExportJobs(result);
        }
    }

    private void ApplyCompression(RepositoryResult<CompressionStatsSnapshot> result)
    {
        lock (_gate)
        {
            _compressionResult = result;
            if (result.Status != LoadStatus.Loading)
            {
                _compressionResolved = true;
            }

            _compression = NextSnapshot(result, _compression, CompressionStatsSnapshot.Empty);
            Recompute();
        }
    }

    private void ApplyExportJobs(RepositoryResult<IReadOnlyList<ExportJobSnapshot>> result)
    {
        lock (_gate)
        {
            _exportResult = result;
            if (result.Status != LoadStatus.Loading)
            {
                _exportResolved = true;
            }

            _exportJobs = NextSnapshot(result, _exportJobs, Array.Empty<ExportJobSnapshot>());
            Recompute();
        }
    }

    private void Recompute()
    {
        var now = _clock();
        var reading = new DataPipelineReading(_compression, _exportJobs);
        Display = DataPipelineSectionProjection.Project(reading, _localizer, now);

        UpdatedAt = Latest(_compressionResult.FetchedAt, _exportResult.FetchedAt) ?? UpdatedAt;

        // Web parity: the skeleton shows while compLoading || exportLoading — i.e. until both reads have
        // produced their first result. Once a read resolves it never reverts to the loading surface.
        if (!_compressionResolved || !_exportResolved)
        {
            State = DataPipelineSectionState.Loading;
            IsFetching = true;
            IsError = false;
            IsStale = false;
            ErrorMessage = null;
            return;
        }

        bool hasContent = Display.HasAnyContent;
        bool anyError = IsStatus(LoadStatus.Error);
        bool anyOffline = IsStatus(LoadStatus.Offline);
        bool anyStale = _compressionResult.IsStale || _exportResult.IsStale;
        bool anyFetching = IsAnyLoading();

        if (!hasContent)
        {
            State = (anyError || anyOffline) ? DataPipelineSectionState.Error : DataPipelineSectionState.Empty;
            IsFetching = anyFetching || _isRefreshing;
            IsError = State == DataPipelineSectionState.Error;
            IsStale = false;
            ErrorMessage = State == DataPipelineSectionState.Error ? ErrorMessageDefault : null;
            return;
        }

        if (anyOffline)
        {
            State = DataPipelineSectionState.Offline;
            IsError = true;
            IsStale = true;
            ErrorMessage = ErrorMessageDefault;
        }
        else if (anyStale)
        {
            State = DataPipelineSectionState.Stale;
            IsError = false;
            IsStale = true;
            ErrorMessage = null;
        }
        else
        {
            State = DataPipelineSectionState.Loaded;
            IsError = false;
            IsStale = false;
            ErrorMessage = null;
        }

        IsFetching = anyFetching || _isRefreshing;
    }

    private bool IsStatus(LoadStatus status) =>
        _compressionResult.Status == status || _exportResult.Status == status;

    private bool IsAnyLoading() =>
        _compressionResult.IsLoading || _exportResult.IsLoading;

    private static T NextSnapshot<T>(RepositoryResult<T> result, T previous, T empty)
        where T : class =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                 // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => empty,  // resolved with nothing to show
            _ => result.Value ?? previous,                  // cached / loaded / offline carry the value
        };

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is { } av && b is { } bv)
        {
            return av >= bv ? a : b;
        }

        return a ?? b;
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
}
