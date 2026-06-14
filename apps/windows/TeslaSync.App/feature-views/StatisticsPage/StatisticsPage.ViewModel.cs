using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="StatisticsPage"/> view — the native port of the web
/// page's hook composition (web/src/features/analytics/pages/StatisticsPage.tsx). It consumes the
/// cache-then-network <see cref="IStatisticsSource"/>, projects each snapshot through
/// <see cref="StatisticsProjection"/> with the active units + currency, and exposes the mutually-exclusive
/// <see cref="State"/> (loading / loaded / empty / error) plus the in-flight flag so the view is a thin
/// renderer. The page-level branch follows the web's primary <c>statsQuery</c>: a resolved snapshot with no
/// period-stats object becomes <see cref="StatisticsState.Empty"/>, a hard failure becomes
/// <see cref="StatisticsState.Error"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class StatisticsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IStatisticsSource _source;
    private readonly ILocalizer _localizer;
    private readonly StatisticsDiagnostics _diagnostics;

    private UnitPref _units;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<StatisticsSnapshot>? _last;
    private bool _disposed;

    private StatisticsState _state = StatisticsState.Loading;
    private StatisticsDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units, currency and diagnostics.</summary>
    /// <param name="source">The cache-then-network statistics source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="currencySymbol">The currency symbol for the cost tiles (web <c>useFormatting()</c>); null = "$".</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StatisticsPageViewModel(
        IStatisticsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        StatisticsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _diagnostics = diagnostics ?? new StatisticsDiagnostics();
        _display = StatisticsProjection.Project(StatisticsSnapshot.Empty, StatisticsState.Loading, _units, _currencySymbol, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public StatisticsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public StatisticsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a background refresh is in flight (keeps content while refreshing).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The localized page title (web <c>statistics.title</c>).</summary>
    public string Title => StatisticsRegistration.Title(_localizer);

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            UnitPref resolved = value ?? UnitPref.Metric;
            if (_units == resolved)
            {
                return;
            }

            _units = resolved;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>The currency symbol used for the cost tiles; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (string.Equals(_currencySymbol, resolved, StringComparison.Ordinal))
            {
                return;
            }

            _currencySymbol = resolved;
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the cache-then-network sequence is exhausted.</returns>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

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

    /// <summary>Retry after a failure — re-runs the load from the top (web <c>refetch</c>).</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
    public Task RefreshAsync() => LoadAsync();

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
    }

    private bool HasContent() => _state is StatisticsState.Loaded or StatisticsState.Empty;

    private void Apply(RepositoryResult<StatisticsSnapshot> result)
    {
        _last = result;
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Empty:
                SetEmpty();
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplySnapshot(StatisticsSnapshot snapshot, bool fetching)
    {
        if (!snapshot.HasData)
        {
            SetEmpty();
            return;
        }

        IsFetching = fetching;
        State = StatisticsState.Loaded;
        Display = StatisticsProjection.Project(snapshot, StatisticsState.Loaded, _units, _currencySymbol, _localizer);
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last && last.Value!.HasData)
        {
            Display = StatisticsProjection.Project(last.Value, _state, _units, _currencySymbol, _localizer);
        }
        else
        {
            Display = StatisticsProjection.Project(StatisticsSnapshot.Empty, _state, _units, _currencySymbol, _localizer);
        }
    }

    private void SetLoading()
    {
        IsFetching = false;
        State = StatisticsState.Loading;
        Display = StatisticsProjection.Project(StatisticsSnapshot.Empty, StatisticsState.Loading, _units, _currencySymbol, _localizer);
    }

    private void SetEmpty()
    {
        IsFetching = false;
        State = StatisticsState.Empty;
        Display = StatisticsProjection.Project(StatisticsSnapshot.Empty, StatisticsState.Empty, _units, _currencySymbol, _localizer);
    }

    private void SetError()
    {
        IsFetching = false;
        State = StatisticsState.Error;
        Display = StatisticsProjection.Project(StatisticsSnapshot.Empty, StatisticsState.Error, _units, _currencySymbol, _localizer);
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
