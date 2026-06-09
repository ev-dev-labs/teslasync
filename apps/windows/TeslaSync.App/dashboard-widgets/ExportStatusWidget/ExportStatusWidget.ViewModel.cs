using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ExportStatusWidget"/> view — the native port
/// of the web <c>ExportStatusWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/ExportStatusWidget.tsx). It consumes the two cache-then-network
/// sequences of the <see cref="IExportStatusSource"/> (the legacy and admin export-job lists), merges them
/// through <see cref="ExportStatusProjection"/>, and exposes the combined <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. The two streams are consumed sequentially within
/// one confinement (the UI thread) so the holder needs no internal synchronisation; the combined freshness
/// mirrors the web's <c>exportsX || adminX</c> booleans.
/// </summary>
public sealed class ExportStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IExportStatusSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private ExportStatusSize _size;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<IReadOnlyList<ExportJobRecord>>? _primaryResult;
    private RepositoryResult<IReadOnlyList<ExportJobRecord>>? _adminResult;
    private IReadOnlyList<ExportJobRecord> _primaryValue = Array.Empty<ExportJobRecord>();
    private IReadOnlyList<ExportJobRecord> _adminValue = Array.Empty<ExportJobRecord>();
    private bool _primaryResolved;
    private bool _adminResolved;
    private bool _primaryActive;
    private bool _adminActive;

    private ExportStatusState _state = ExportStatusState.Loading;
    private ExportStatusDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public ExportStatusViewModel(
        IExportStatusSource source,
        ILocalizer localizer,
        ExportStatusSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current combined surface state.</summary>
    public ExportStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact stats + status-ordered capped rows).</summary>
    public ExportStatusDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasItems));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip (max of both sources).</summary>
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

    /// <summary>True when either source's last load failed (drives the header error chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when either source's shown rows are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when there is at least one merged job to render.</summary>
    public bool HasItems => _display.HasItems;

    /// <summary>Localized widget title (web <c>widget.exportStatus</c>).</summary>
    public string Title => ExportStatusRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noExportJobs</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noExportJobs", "No export jobs");

    /// <summary>The widget footprint; reassigning re-projects the current jobs for the new layout.</summary>
    public ExportStatusSize Size
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
            Recompute();
        }
    }

    /// <summary>
    /// Run a cache-then-network load of both sources sequentially: counts the attempt, then folds each
    /// emission into <see cref="State"/> + <see cref="Display"/>. The skeleton shows only until BOTH
    /// sources have resolved at least once (web <c>exportsLoading || adminLoading</c>); thereafter content
    /// stays visible while refreshing. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        _primaryActive = true;
        _adminActive = true;
        Recompute();

        try
        {
            await foreach (var result in _source.StreamPrimaryJobsAsync(cts.Token).ConfigureAwait(false))
            {
                _primaryResult = result;
                _primaryValue = NextValue(result, _primaryValue);
                if (result.Status != LoadStatus.Loading)
                {
                    _primaryResolved = true;
                }

                Recompute();
            }

            _primaryActive = false;
            Recompute();

            await foreach (var result in _source.StreamAdminJobsAsync(cts.Token).ConfigureAwait(false))
            {
                _adminResult = result;
                _adminValue = NextValue(result, _adminValue);
                if (result.Status != LoadStatus.Loading)
                {
                    _adminResolved = true;
                }

                Recompute();
            }

            _adminActive = false;
            Recompute();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop the remaining emissions silently.
        }
    }

    /// <summary>Retry both sources — re-runs the load from the top while keeping content visible.</summary>
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
        Display = Project();

        UpdatedAt = MaxTime(_primaryResult?.FetchedAt, _adminResult?.FetchedAt);
        bool stale = (_primaryResult?.IsStale ?? false) || (_adminResult?.IsStale ?? false);
        bool error = IsErrorish(_primaryResult) || IsErrorish(_adminResult);
        bool offline = _primaryResult?.Status == LoadStatus.Offline || _adminResult?.Status == LoadStatus.Offline;
        bool bothResolved = _primaryResolved && _adminResolved;

        IsStale = stale;
        IsError = error;
        IsFetching = bothResolved && (_primaryActive || _adminActive);

        bool hasItems = _display.HasItems;
        State = !bothResolved
            ? ExportStatusState.Loading
            : !hasItems && error
                ? ExportStatusState.Error
                : !hasItems
                    ? ExportStatusState.Empty
                    : offline
                        ? ExportStatusState.Offline
                        : stale
                            ? ExportStatusState.Stale
                            : ExportStatusState.Loaded;
    }

    private ExportStatusDisplay Project() =>
        ExportStatusProjection.Project(_primaryValue, _adminValue, _size, _localizer, _clock(), _source.DownloadBaseUri);

    private static IReadOnlyList<ExportJobRecord> NextValue(
        RepositoryResult<IReadOnlyList<ExportJobRecord>> result,
        IReadOnlyList<ExportJobRecord> previous) => result.Status switch
        {
            LoadStatus.Loading => previous,                                       // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<ExportJobRecord>(), // resolved with nothing for this source
            _ => result.Value ?? previous,                                        // cached / loaded / offline carry a value
        };

    private static bool IsErrorish(RepositoryResult<IReadOnlyList<ExportJobRecord>>? result) =>
        result is { Status: LoadStatus.Error or LoadStatus.Offline };

    private static DateTimeOffset? MaxTime(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a.Value >= b.Value ? a : b;
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
