using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="JobProgressDrawer"/> view — the native port
/// of the web <c>JobProgressDrawer</c>'s hook + state composition
/// (web/src/components/feedback/JobProgressDrawer.tsx). It consumes the single cache-then-network
/// sequence of the <see cref="IJobProgressDrawerSource"/> (the export-job list), projects it through
/// <see cref="JobProgressDrawerProjection"/>, and exposes the combined data <see cref="State"/> plus the
/// chrome <see cref="Presentation"/> (open / minimized / dismissed, persisted via
/// <see cref="IJobDrawerStateStore"/>) so the view is a thin renderer. The drawer auto-promotes a
/// dismissed state back to minimized when a new active job appears (web <c>useEffect</c>), and exposes
/// <see cref="IsVisible"/> to reproduce the web component's "render nothing" branches.
/// </summary>
public sealed class JobProgressDrawerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IJobProgressDrawerSource _source;
    private readonly ILocalizer _localizer;
    private readonly IJobDrawerStateStore _stateStore;
    private readonly Func<DateTimeOffset> _clock;
    private readonly int _maxRecent;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<IReadOnlyList<ExportJobRecord>>? _result;
    private IReadOnlyList<ExportJobRecord> _value = Array.Empty<ExportJobRecord>();
    private bool _resolved;
    private bool _active;

    private JobProgressState _state = JobProgressState.Loading;
    private JobDrawerDisplay _display;
    private JobDrawerPresentation _presentation;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isVisible;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, persistence store, recent cap and clock.</summary>
    public JobProgressDrawerViewModel(
        IJobProgressDrawerSource source,
        ILocalizer localizer,
        IJobDrawerStateStore? stateStore = null,
        int maxRecent = JobProgressDrawerRegistration.DefaultMaxRecent,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _stateStore = stateStore ?? new InMemoryJobDrawerStateStore();
        _maxRecent = Math.Max(0, maxRecent);
        _clock = clock ?? (() => DateTimeOffset.Now);
        _presentation = _stateStore.Load();
        _display = Project();
        _isVisible = ComputeVisible();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current data lifecycle state of the export-job read.</summary>
    public JobProgressState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (active + recent sections, counts, chip label).</summary>
    public JobDrawerDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasItems));
            Raise(nameof(ExpandLabel));
        }
    }

    /// <summary>The persisted chrome state (open / minimized / dismissed).</summary>
    public JobDrawerPresentation Presentation
    {
        get => _presentation;
        private set
        {
            if (_presentation == value)
            {
                return;
            }

            _presentation = value;
            Raise(nameof(Presentation));
            IsVisible = ComputeVisible();
        }
    }

    /// <summary>True when the drawer should occupy space (web "return null" branches map to <see langword="false"/>).</summary>
    public bool IsVisible
    {
        get => _isVisible;
        private set => Set(ref _isVisible, value);
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

    /// <summary>True when the last load failed or fell back to offline cache (drives the header error chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown rows are older than the freshness window.</summary>
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

    /// <summary>True when there is at least one job to render.</summary>
    public bool HasItems => _display.HasAnyJobs;

    /// <summary>Localized panel title (web <c>export.jobDrawer.title</c>).</summary>
    public string Title => JobProgressDrawerRegistration.Title(_localizer);

    /// <summary>Localized region label for the open panel (web <c>export.jobDrawer.label</c>).</summary>
    public string RegionLabel => JobProgressDrawerRegistration.Label(_localizer);

    /// <summary>Localized loading line shown before the first resolve (web <c>export.jobDrawer.loading</c>).</summary>
    public string LoadingText => _localizer.GetString("export.jobDrawer.loading", "Loading export jobs\u2026");

    /// <summary>Localized minimize-button label (web <c>export.jobDrawer.minimize</c>).</summary>
    public string MinimizeLabel => _localizer.GetString("export.jobDrawer.minimize", "Minimize");

    /// <summary>Localized dismiss-button label (web <c>export.jobDrawer.close</c>).</summary>
    public string DismissLabel => _localizer.GetString("export.jobDrawer.close", "Dismiss");

    /// <summary>Localized download-link label (web <c>export.jobDrawer.download</c>).</summary>
    public string DownloadLabel => _localizer.GetString("export.jobDrawer.download", "Download");

    /// <summary>Localized refresh/retry-button label (shared <c>common.refresh</c>).</summary>
    public string RefreshLabel => _localizer.GetString("common.refresh", "Refresh");

    /// <summary>Localized expand-affordance label with the active count interpolated (web <c>export.jobDrawer.expand</c>).</summary>
    public string ExpandLabel => JobProgressDrawerProjection.Fill(
        _localizer.GetString("export.jobDrawer.expand", "Show export jobs ({{count}} active)"),
        ("count", _display.ActiveCount.ToString(CultureInfo.CurrentCulture)));

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, then folds each emission into <see cref="State"/>
    /// + <see cref="Display"/>. The loading line shows only until the source resolves once (web
    /// <c>isLoading &amp;&amp; allJobs.length === 0</c>); thereafter content stays visible while refreshing.
    /// A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        _active = true;
        Recompute();

        try
        {
            await foreach (var result in _source.StreamJobsAsync(cts.Token).ConfigureAwait(false))
            {
                _result = result;
                _value = NextValue(result, _value);
                if (result.Status != LoadStatus.Loading)
                {
                    _resolved = true;
                }

                Recompute();
            }

            _active = false;
            Recompute();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop the remaining emissions silently.
        }
    }

    /// <summary>Retry the load — re-runs from the top while keeping any content visible.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>Expand the drawer to the full panel and persist the choice (web <c>persist('open')</c>).</summary>
    public void Expand() => SetPresentation(JobDrawerPresentation.Open);

    /// <summary>Collapse the drawer to the chip and persist the choice (web <c>persist('minimized')</c>).</summary>
    public void Minimize() => SetPresentation(JobDrawerPresentation.Minimized);

    /// <summary>Dismiss the drawer and persist the choice (web <c>persist('dismissed')</c>).</summary>
    public void Dismiss() => SetPresentation(JobDrawerPresentation.Dismissed);

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

    private void SetPresentation(JobDrawerPresentation next)
    {
        if (_presentation == next)
        {
            return;
        }

        Presentation = next;
        _stateStore.Save(next);
    }

    private void Recompute()
    {
        Display = Project();

        UpdatedAt = _result?.FetchedAt;
        bool stale = _result?.IsStale ?? false;
        bool offline = _result?.Status == LoadStatus.Offline;
        bool error = _result is { Status: LoadStatus.Error or LoadStatus.Offline };

        IsStale = stale;
        IsError = error;
        IsFetching = _resolved && _active;

        bool hasItems = _display.HasAnyJobs;
        State = !_resolved
            ? JobProgressState.Loading
            : !hasItems && error
                ? JobProgressState.Error
                : !hasItems
                    ? JobProgressState.Empty
                    : offline
                        ? JobProgressState.Offline
                        : stale
                            ? JobProgressState.Stale
                            : JobProgressState.Loaded;

        // Auto-promote a dismissed drawer back to minimized when a new active job appears (web useEffect).
        if (_display.ActiveCount > 0 && _presentation == JobDrawerPresentation.Dismissed)
        {
            SetPresentation(JobDrawerPresentation.Minimized);
        }

        IsVisible = ComputeVisible();
    }

    private JobDrawerDisplay Project() =>
        JobProgressDrawerProjection.Project(_value, _maxRecent, _localizer, _clock(), _source.DownloadBaseUri);

    private bool ComputeVisible()
    {
        bool loading = !_resolved;

        // Web: hide entirely while dismissed with nothing active to surface.
        if (_presentation == JobDrawerPresentation.Dismissed && _display.ActiveCount == 0)
        {
            return false;
        }

        // Web: hide the chip when there are no jobs at all and the first load has settled. The open panel
        // stays visible (rendering its empty sections) once the user has explicitly expanded it.
        if (!_display.HasAnyJobs && !loading && _presentation != JobDrawerPresentation.Open)
        {
            return false;
        }

        return true;
    }

    private static IReadOnlyList<ExportJobRecord> NextValue(
        RepositoryResult<IReadOnlyList<ExportJobRecord>> result,
        IReadOnlyList<ExportJobRecord> previous) => result.Status switch
        {
            LoadStatus.Loading => previous,                                       // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<ExportJobRecord>(), // resolved with nothing
            _ => result.Value ?? previous,                                        // cached / loaded / offline carry a value
        };

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
