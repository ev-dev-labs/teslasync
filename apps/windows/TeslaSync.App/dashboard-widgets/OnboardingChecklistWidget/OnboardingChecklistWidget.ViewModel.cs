using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="OnboardingChecklistViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of combined list counts (vehicles + alert rules +
/// notification channels) — the native analogue of the three <c>useVehicles</c>/<c>useAlertRules</c>/
/// <c>useNotificationChannels</c> hooks the web <c>useChecklistTasks</c> composes. The view never
/// performs HTTP itself; the concrete <see cref="OnboardingChecklistSource"/> (or a test fake) drives this.
/// </summary>
public interface IOnboardingChecklistSource
{
    /// <summary>Stream the combined cache-then-network count snapshots, best-available counts first.</summary>
    IAsyncEnumerable<RepositoryResult<OnboardingChecklistRemoteCounts>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Onboarding Checklist surface — the native mirror of the web
/// registry entry in web/src/features/dashboard/widgets/registry/system.ts. The dashboard grid binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class OnboardingChecklistRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "onboarding-checklist";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "system";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "OnboardingChecklistWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static OnboardingChecklistSize DefaultSize => OnboardingChecklistSize.Default;

    /// <summary>Minimum footprint: 2 columns × 3 rows.</summary>
    public static OnboardingChecklistSize MinSize => OnboardingChecklistSize.Min;

    /// <summary>Maximum footprint: 4 columns × 8 rows.</summary>
    public static OnboardingChecklistSize MaxSize => OnboardingChecklistSize.Max;

    /// <summary>Localized registry display name (web registry "Setup Checklist").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("checklist.widgetName", "Setup Checklist");
    }

    /// <summary>Localized registry description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "checklist.widgetDescription",
            "First-run setup checklist: connect Tesla, pick a theme, create an alert, and more");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(OnboardingChecklistSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static OnboardingChecklistSize Clamp(OnboardingChecklistSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Onboarding Checklist surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a task title, route, or
/// any user state — so a diagnostics line can never leak what the user has or hasn't configured.
/// Thread-safe.
/// </summary>
public sealed class OnboardingChecklistDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public OnboardingChecklistDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OnboardingChecklistWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OnboardingChecklistRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="OnboardingChecklistWidget"/> view — the
/// native port of the web <c>OnboardingChecklistWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/OnboardingChecklistWidget.tsx +
/// web/src/features/onboarding/checklist.ts). It folds the cache-then-network counts from
/// <see cref="IOnboardingChecklistSource"/> together with the locally-tracked
/// <see cref="ChecklistLocalState"/> into a projected checklist, decides the
/// <see cref="OnboardingChecklistState"/> (active / empty / hidden), stamps the celebration timestamp
/// the first render it reaches 100 %, and exposes the dismiss/restart commands. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class OnboardingChecklistViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IOnboardingChecklistSource _source;
    private readonly IChecklistStateStore _store;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private ChecklistLocalState _local;
    private OnboardingChecklistRemoteCounts _counts = OnboardingChecklistRemoteCounts.Zero;
    private bool _suppressChanged;
    private bool _disposed;

    private OnboardingChecklistState _state = OnboardingChecklistState.Active;
    private OnboardingChecklistSnapshot _snapshot;
    private bool _isSyncing;
    private bool _isStale;
    private bool _isOffline;
    private bool _hasSyncError;
    private bool _hasSyncedOnce;

    /// <summary>Creates the holder over its data source, state store, localizer and (optional) clock.</summary>
    public OnboardingChecklistViewModel(
        IOnboardingChecklistSource source,
        IChecklistStateStore store,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _store = store;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _local = store.Read();
        _snapshot = OnboardingChecklistProjection.Project(default, localizer);

        _store.Changed += OnStoreChanged;
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (active / empty / hidden).</summary>
    public OnboardingChecklistState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, display-ready task rows.</summary>
    public IReadOnlyList<ChecklistTaskView> Tasks => _snapshot.Tasks;

    /// <summary>Number of completed tasks.</summary>
    public int CompleteCount => _snapshot.CompleteCount;

    /// <summary>Total number of tasks.</summary>
    public int TotalCount => _snapshot.TotalCount;

    /// <summary>Completion percentage (0–100) for the progress bar.</summary>
    public int ProgressPercent => _snapshot.ProgressPercent;

    /// <summary>True when every task is complete — drives the celebration footer + gradient.</summary>
    public bool AllComplete => _snapshot.AllComplete;

    /// <summary>True while a background read is in flight (web parity: never hides the checklist).</summary>
    public bool IsSyncing
    {
        get => _isSyncing;
        private set => Set(ref _isSyncing, value);
    }

    /// <summary>True when the shown counts are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the last read fell back to a cached value because the network was unreachable.</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => Set(ref _isOffline, value);
    }

    /// <summary>True when every backing read failed with no cached counts to fall back to.</summary>
    public bool HasSyncError
    {
        get => _hasSyncError;
        private set => Set(ref _hasSyncError, value);
    }

    /// <summary>True once at least one read has settled (used to distinguish first-load from refresh).</summary>
    public bool HasSyncedOnce
    {
        get => _hasSyncedOnce;
        private set => Set(ref _hasSyncedOnce, value);
    }

    /// <summary>Whether the user has explicitly dismissed the checklist.</summary>
    public bool Dismissed => _local.Dismissed;

    /// <summary>Epoch the checklist first reached 100 %, or <see langword="null"/>.</summary>
    public DateTimeOffset? CompletedAt => _local.CompletedAt;

    /// <summary>Localized widget header title (web <c>checklist.title</c> → "Get started").</summary>
    public string Title => _localizer.GetString("checklist.title", "Get started");

    /// <summary>Localized "{{done}}/{{total}} complete" progress label.</summary>
    public string ProgressText => OnboardingChecklistProjection.FormatProgress(_localizer, CompleteCount, TotalCount);

    /// <summary>Localized empty-state message (web <c>checklist.empty</c>).</summary>
    public string EmptyMessage => _localizer.GetString("checklist.empty", "No setup steps available right now.");

    /// <summary>Localized hidden-state title — celebratory when finished, otherwise the dismissed title.</summary>
    public string HiddenTitle => AllComplete
        ? _localizer.GetString("checklist.completeMessage", "You're all set! \U0001F389")
        : _localizer.GetString("checklist.dismissedTitle", "Setup checklist hidden");

    /// <summary>Localized hidden-state message (web <c>checklist.dismissedMessage</c>).</summary>
    public string HiddenMessage => _localizer.GetString(
        "checklist.dismissedMessage",
        "Remove this widget from your dashboard or restart the checklist to see your remaining setup steps.");

    /// <summary>Localized celebratory completion message (web <c>checklist.completeMessage</c>).</summary>
    public string CompleteMessage => _localizer.GetString("checklist.completeMessage", "You're all set! \U0001F389");

    /// <summary>Localized "Restart checklist" affordance label.</summary>
    public string RestartLabel => _localizer.GetString("checklist.restart", "Restart checklist");

    /// <summary>Localized "Dismiss" affordance label.</summary>
    public string DismissLabel => _localizer.GetString("checklist.dismiss", "Dismiss");

    /// <summary>
    /// Run the cache-then-network load: subscribes to the combined count stream and folds every
    /// emission into the projected checklist + freshness signals. The checklist stays rendered
    /// throughout (web parity). A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

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

    /// <summary>Retry after a sync failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>Dismiss the checklist (web <c>dismiss</c>) — collapses to the hidden/restart state.</summary>
    public void Dismiss() => _store.SetDismissed(true);

    /// <summary>Restart the checklist (web <c>restart</c> → <c>restartChecklist</c>) — clears dismissed + completion.</summary>
    public void Restart()
    {
        _suppressChanged = true;
        try
        {
            _store.SetDismissed(false);
            _store.SetCompletedAt(null);
        }
        finally
        {
            _suppressChanged = false;
        }

        _local = _store.Read();
        Recompute();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.Changed -= OnStoreChanged;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private void Apply(RepositoryResult<OnboardingChecklistRemoteCounts> result)
    {
        if (result.HasValue)
        {
            _counts = result.Value!;
        }
        else if (result.Status is LoadStatus.Empty)
        {
            _counts = OnboardingChecklistRemoteCounts.Zero;
        }

        IsSyncing = result.Status is LoadStatus.Loading or LoadStatus.Refreshing;
        IsOffline = result.Status is LoadStatus.Offline;
        IsStale = result.IsStale || result.Status is LoadStatus.Offline;
        HasSyncError = result.Status is LoadStatus.Error;
        if (result.Status is not LoadStatus.Loading)
        {
            HasSyncedOnce = true;
        }

        Recompute();
    }

    private void OnStoreChanged(object? sender, EventArgs e)
    {
        if (_suppressChanged || _disposed)
        {
            return;
        }

        _local = _store.Read();
        Recompute();
    }

    private void Recompute()
    {
        var inputs = new ChecklistInputs(
            _counts.VehicleCount,
            _counts.AlertRuleCount,
            _counts.ChannelCount,
            _local.ThemePicked,
            _local.CommandPaletteDiscovered,
            _local.WebPushGranted,
            _local.DashboardCustomized);

        var snapshot = OnboardingChecklistProjection.Project(inputs, _localizer);

        // Web parity: stamp completedAt the first recompute we hit 100 %, clear it if we drop below.
        if (snapshot.AllComplete && _local.CompletedAt is null)
        {
            StampCompletedAt(_clock());
        }
        else if (!snapshot.AllComplete && _local.CompletedAt is not null)
        {
            StampCompletedAt(null);
        }

        bool hidden = OnboardingChecklistVisibility.ShouldHide(
            _local.Dismissed, snapshot.AllComplete, _local.CompletedAt, _clock());

        var nextState = hidden
            ? OnboardingChecklistState.Hidden
            : snapshot.TotalCount == 0
                ? OnboardingChecklistState.Empty
                : OnboardingChecklistState.Active;

        ApplySnapshot(snapshot);
        State = nextState;
    }

    private void StampCompletedAt(DateTimeOffset? at)
    {
        _suppressChanged = true;
        try
        {
            _store.SetCompletedAt(at);
        }
        finally
        {
            _suppressChanged = false;
        }

        _local = _store.Read();
    }

    private void ApplySnapshot(OnboardingChecklistSnapshot snapshot)
    {
        _snapshot = snapshot;
        Raise(nameof(Tasks));
        Raise(nameof(CompleteCount));
        Raise(nameof(TotalCount));
        Raise(nameof(ProgressPercent));
        Raise(nameof(AllComplete));
        Raise(nameof(ProgressText));
        Raise(nameof(HiddenTitle));
        Raise(nameof(Dismissed));
        Raise(nameof(CompletedAt));
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
