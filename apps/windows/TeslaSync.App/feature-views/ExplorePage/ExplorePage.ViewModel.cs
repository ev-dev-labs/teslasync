using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Explore;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ExplorePage</c> view — the native port of the web page's data
/// flow (web/src/features/explore/pages/ExplorePage.tsx). It owns the URL-equivalent <see cref="Query"/>
/// (web <c>?q=</c>), reads the two gating sources (web <c>useVehicles</c> + <c>useIsForwardAuth</c>) through the
/// injected <see cref="IExploreFeed"/> and the recently-visited list through the <see cref="IExploreRecentSource"/>
/// (web <c>getRecentPages</c> / <c>subscribeRecentPages</c>), and projects the result through
/// <see cref="ExploreProjection"/> so the view is a thin renderer. It exposes <see cref="SetQuery"/> /
/// <see cref="ClearQuery"/> (the filter field + the empty-state clear), <see cref="LoadAsync"/> and
/// <see cref="RefreshAsync"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ExplorePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IExploreFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly IExploreRecentSource _recentSource;
    private readonly ExploreDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private int _vehicleCount;
    private bool _isForwardAuth;
    private string _query = string.Empty;
    private IReadOnlyList<string> _recentPaths;

    private ExploreState _state;
    private ExploreDisplay _display;

    /// <summary>Creates the holder over the default empty feed, the passthrough localizer and the empty recent source.</summary>
    public ExplorePageViewModel()
        : this(EmptyExploreFeed.Instance, PassthroughLocalizer.Instance, EmptyExploreRecentSource.Instance)
    {
    }

    /// <summary>Creates the holder over its data feed, localizer, recent source and (optional) diagnostics.</summary>
    /// <param name="feed">The vehicle-count / forward-auth gating feed (web <c>useVehicles</c> + <c>useIsForwardAuth</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="recentSource">The recently-visited registry (web <c>getRecentPages</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ExplorePageViewModel(
        IExploreFeed feed,
        ILocalizer localizer,
        IExploreRecentSource? recentSource = null,
        ExploreDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _recentSource = recentSource ?? EmptyExploreRecentSource.Instance;
        _diagnostics = diagnostics ?? new ExploreDiagnostics();
        _recentPaths = _recentSource.RecentPaths;

        _recentSource.Changed += OnRecentChanged;

        _display = ExploreProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (success / empty).</summary>
    public ExploreState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ExploreDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The active filter text (web <c>?q=</c>).</summary>
    public string Query => _query;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the two gating reads and refresh the recently-visited strip, then reproject.</summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        int vehicleCount = 0;
        try
        {
            vehicleCount = await _feed.FetchVehicleCountAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: an unresolved useVehicles query is treated as zero vehicles (the minVehicles entries stay hidden).
            vehicleCount = 0;
        }

        bool isForwardAuth = false;
        try
        {
            isForwardAuth = await _feed.FetchIsForwardAuthAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // web: an unresolved useIsForwardAuth query is treated as open mode (the requiresAuth entries stay hidden).
            isForwardAuth = false;
        }

        cts.Token.ThrowIfCancellationRequested();

        _vehicleCount = vehicleCount;
        _isForwardAuth = isForwardAuth;
        _recentPaths = _recentSource.RecentPaths;
        Reproject();
    }

    /// <summary>Refresh the gating reads and recently-visited list (web auto-refetch + store subscription).</summary>
    /// <param name="cancellationToken">Cancels the refresh.</param>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the active filter (web <c>updateQuery</c> writing <c>?q=</c>); reprojects.</summary>
    /// <param name="query">The new filter text.</param>
    public void SetQuery(string? query)
    {
        string next = query ?? string.Empty;
        if (string.Equals(next, _query, StringComparison.Ordinal))
        {
            return;
        }

        _query = next;
        Reproject();
    }

    /// <summary>Clear the active filter (web empty-state "Clear filter" + <c>updateQuery('')</c>); reprojects.</summary>
    public void ClearQuery() => SetQuery(string.Empty);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _recentSource.Changed -= OnRecentChanged;
        Cancel(ref _cts);
    }

    private void OnRecentChanged(object? sender, EventArgs e)
    {
        _recentPaths = _recentSource.RecentPaths;
        Reproject();
    }

    private ExploreModel BuildModel() =>
        new(_vehicleCount, _isForwardAuth, _query, _recentPaths);

    private void Reproject()
    {
        var display = ExploreProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
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

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
