using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QuickStatsPage"/> view — the native port of the
/// web page's hook composition (web/src/features/dashboard/pages/QuickStatsPage.tsx). It consumes the
/// cache-then-network <see cref="IQuickStatsSource"/>, projects each snapshot through
/// <see cref="QuickStatsProjection"/> with the active units + currency, and exposes the mutually-exclusive
/// <see cref="State"/> (loading / loaded / empty / error) plus the in-flight flag so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class QuickStatsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IQuickStatsSource _source;
    private readonly ILocalizer _localizer;
    private readonly QuickStatsDiagnostics _diagnostics;

    private UnitPref _units;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<QuickStatsSnapshot>? _last;
    private bool _disposed;

    private QuickStatsState _state = QuickStatsState.Loading;
    private QuickStatsDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units, currency and diagnostics.</summary>
    /// <param name="source">The cache-then-network quick-stats source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="currencySymbol">The currency symbol for the cost tile (web <c>useFormatting()</c>); null = "$".</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QuickStatsPageViewModel(
        IQuickStatsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        QuickStatsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _diagnostics = diagnostics ?? new QuickStatsDiagnostics();
        _display = QuickStatsProjection.Project(QuickStatsSnapshot.Empty, QuickStatsState.Loading, _units, _currencySymbol, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public QuickStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public QuickStatsDisplay Display
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

    /// <summary>The localized page title (web <c>quickStats.title</c>).</summary>
    public string Title => QuickStatsRegistration.Title(_localizer);

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

    /// <summary>The currency symbol used for the cost tile; reassigning re-projects.</summary>
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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
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
    }

    private bool HasContent() => _state is QuickStatsState.Loaded or QuickStatsState.Empty;

    private void Apply(RepositoryResult<QuickStatsSnapshot> result)
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
                SetEmpty(result.Value ?? QuickStatsSnapshot.Empty);
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplySnapshot(QuickStatsSnapshot snapshot, bool fetching)
    {
        if (!snapshot.HasData)
        {
            SetEmpty(snapshot);
            return;
        }

        IsFetching = fetching;
        State = QuickStatsState.Loaded;
        Display = QuickStatsProjection.Project(snapshot, QuickStatsState.Loaded, _units, _currencySymbol, _localizer);
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last && last.Value!.HasData)
        {
            Display = QuickStatsProjection.Project(last.Value, _state, _units, _currencySymbol, _localizer);
        }
        else
        {
            Display = QuickStatsProjection.Project(QuickStatsSnapshot.Empty, _state, _units, _currencySymbol, _localizer);
        }
    }

    private void SetLoading()
    {
        IsFetching = false;
        State = QuickStatsState.Loading;
        Display = QuickStatsProjection.Project(QuickStatsSnapshot.Empty, QuickStatsState.Loading, _units, _currencySymbol, _localizer);
    }

    private void SetEmpty(QuickStatsSnapshot snapshot)
    {
        IsFetching = false;
        State = QuickStatsState.Empty;
        Display = QuickStatsProjection.Project(snapshot, QuickStatsState.Empty, _units, _currencySymbol, _localizer);
    }

    private void SetError()
    {
        IsFetching = false;
        State = QuickStatsState.Error;
        Display = QuickStatsProjection.Project(QuickStatsSnapshot.Empty, QuickStatsState.Error, _units, _currencySymbol, _localizer);
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
