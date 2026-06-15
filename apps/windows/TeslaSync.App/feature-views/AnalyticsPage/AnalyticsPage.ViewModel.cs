using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AnalyticsPage</c> view — the native port of the web
/// page's data flow (<c>web/src/features/analytics/pages/AnalyticsPage.tsx</c>). It reads the fleet analytics
/// snapshot through the injected <see cref="IAnalyticsFleetFeed"/> (the native <c>useFleetAnalytics</c>
/// hook), projects the shell through <see cref="AnalyticsProjection"/>, and surfaces the three web data
/// states (loading / error / success) plus the active-tab selection and the header freshness flags so the
/// view is a thin renderer. The resolved <see cref="Snapshot"/> is exposed so the view can compose the hero
/// gauges and each tab from the page's single read. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class AnalyticsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAnalyticsFleetFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly AnalyticsPageDiagnostics _diagnostics;

    private UnitPref _units;
    private string _currencySymbol = AnalyticsRegistration.DefaultCurrencySymbol;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private AnalyticsFleetSnapshot _snapshot = AnalyticsFleetSnapshot.Empty;
    private bool _hasFleet;
    private bool _loading = true;
    private string? _errorDetail;
    private AnalyticsTabKey _activeTab = AnalyticsTabKey.Overview;

    private AnalyticsPageState _state = AnalyticsPageState.Loading;
    private AnalyticsDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;
    private int _dataVersion;

    /// <summary>Creates the holder over its data feed, localizer, units and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The fleet-analytics data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AnalyticsPageViewModel(
        IAnalyticsFleetFeed feed,
        ILocalizer localizer,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        AnalyticsPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new AnalyticsPageDiagnostics();
        _display = AnalyticsProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / error / success).</summary>
    public AnalyticsPageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready shell the view binds to (header + state flags + tab strip).</summary>
    public AnalyticsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The current resolved fleet snapshot — the view composes the hero + tabs from this.</summary>
    public AnalyticsFleetSnapshot Snapshot
    {
        get => _snapshot;
        private set => Set(ref _snapshot, value);
    }

    /// <summary>A monotonically increasing token bumped on every resolved load — the view rebuilds the tab body when it changes.</summary>
    public int DataVersion
    {
        get => _dataVersion;
        private set => Set(ref _dataVersion, value);
    }

    /// <summary>The selected analytics tab (web <c>activeTab</c>).</summary>
    public AnalyticsTabKey ActiveTab
    {
        get => _activeTab;
        private set => Set(ref _activeTab, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The localized page title (web <c>t('analytics.title')</c>).</summary>
    public string Title => _localizer.GetString("analytics.title", "Fleet Analytics");

    /// <summary>The currency symbol the hero / charging surfaces format with (web <c>formatCurrency</c>).</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? AnalyticsRegistration.DefaultCurrencySymbol : value;
            if (_currencySymbol == resolved)
            {
                return;
            }

            _currencySymbol = resolved;
            Raise(nameof(CurrencySymbol));
            DataVersion++;
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects and re-composes the tab surfaces.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Raise(nameof(Units));
            DataVersion++;
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Select a tab (web <c>setActiveTab</c>) — re-projects so the active selection is reflected.</summary>
    /// <param name="tab">The tab to activate.</param>
    public void SetActiveTab(AnalyticsTabKey tab)
    {
        if (_activeTab == tab)
        {
            return;
        }

        _activeTab = tab;
        ActiveTab = tab;
        Reproject();
    }

    /// <summary>Run (or re-run) the fleet analytics load and fold the result into the data state.</summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the load resolves.</returns>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasFleet)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasFleet = snapshot.HasFleet;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            SetError(ex.Message);
        }
        catch (Exception ex)
        {
            SetError(ex.Message);
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Snapshot = _snapshot;
        DataVersion++;
        Reproject();
    }

    /// <summary>Refresh the analytics (web query refetch / Retry).</summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the load resolves.</returns>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = AnalyticsFleetSnapshot.Empty;
        _hasFleet = false;
        _loading = false;
    }

    private AnalyticsPageModel BuildModel() => new(_snapshot, _loading, _errorDetail, _activeTab);

    private void Reproject()
    {
        var display = AnalyticsProjection.Project(BuildModel(), _localizer);
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
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
