using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SavingsCalculator"/> view — the native port of the
/// web component's data flow (web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx, fed by
/// the parent <c>CostAnalysisPage</c>'s charging-sessions query + <c>useCostAnalysisData</c>). It drives one
/// cache-then-network read through the <see cref="ISavingsCalculatorSource"/>, holds the three editable
/// assumptions (gas price, MPG, electricity rate) the user tweaks, recomputes the comparison through
/// <see cref="SavingsCalculatorProjection"/> on every data or input change, and exposes the full state matrix
/// (loading / loaded / empty / stale / offline / error) plus freshness so the view is a thin renderer. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SavingsCalculatorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISavingsCalculatorSource _source;
    private readonly ILocalizer _localizer;
    private readonly DistanceUnit _distanceUnit;
    private readonly string _currencySymbol;

    private CancellationTokenSource? _cts;
    private SavingsCostAggregate? _data;
    private SavingsCalculatorInputs _inputs;
    private bool _disposed;

    private SavingsCalculatorState _state = SavingsCalculatorState.Loading;
    private SavingsCalculatorDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, display distance unit and currency symbol.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="distanceUnit">The display distance unit (web <c>unitPrefs.distance</c>; default miles).</param>
    /// <param name="currencySymbol">The currency symbol (web hardcodes "$"; default "$").</param>
    public SavingsCalculatorViewModel(
        ISavingsCalculatorSource source,
        ILocalizer localizer,
        DistanceUnit distanceUnit = DistanceUnit.Mi,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _distanceUnit = distanceUnit;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? SavingsCalculatorRegistration.DefaultCurrencySymbol
            : currencySymbol;
        _inputs = SavingsCalculatorInputs.Default;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / loaded / empty / stale / offline / error).</summary>
    public SavingsCalculatorState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content (labels + the four comparison readouts + a11y names).</summary>
    public SavingsCalculatorDisplay Display
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

    /// <summary>True when the shown content is a cached value past the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the network failed but cached content is still being shown.</summary>
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

    /// <summary>Load attempts so far (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when a comparison payload is shown (loaded / stale / offline content states).</summary>
    public bool HasData =>
        _state is SavingsCalculatorState.Loaded or SavingsCalculatorState.Stale or SavingsCalculatorState.Offline;

    // ── Editable assumptions (web gasPrice / mpg / electricityRate state) ──────────────────────────────

    /// <summary>The gas pump price in $/gallon; assigning recomputes the comparison (web <c>onGasPriceChange</c>).</summary>
    public double GasPrice
    {
        get => _inputs.GasPrice;
        set => UpdateInputs(_inputs with { GasPrice = value });
    }

    /// <summary>The gas-car economy in MPG; assigning recomputes the comparison (web <c>onMpgChange</c>).</summary>
    public double Mpg
    {
        get => _inputs.Mpg;
        set => UpdateInputs(_inputs with { Mpg = value });
    }

    /// <summary>The electricity price in $/kWh; assigning recomputes the comparison (web <c>onElectricityRateChange</c>).</summary>
    public double ElectricityRate
    {
        get => _inputs.ElectricityRate;
        set => UpdateInputs(_inputs with { ElectricityRate = value });
    }

    /// <summary>Restore the three assumptions to their seeded defaults (web "Reset Defaults" button).</summary>
    public void ResetInputs() => UpdateInputs(SavingsCalculatorInputs.Default);

    // ── Localized copy (web t(...) keys + native-superset chrome) ───────────────────────────────────────

    /// <summary>The accessible surface title (web "Gas vs Electric Savings Calculator").</summary>
    public string Title => SavingsCalculatorRegistration.Title(_localizer);

    /// <summary>Whole-surface empty-state title (web page "No Charging Data").</summary>
    public string EmptyTitle => SavingsCalculatorRegistration.EmptyTitle(_localizer);

    /// <summary>Whole-surface empty-state message.</summary>
    public string EmptyMessage => SavingsCalculatorRegistration.EmptyMessage(_localizer);

    /// <summary>Loading announcement.</summary>
    public string LoadingLabel => SavingsCalculatorRegistration.LoadingLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => SavingsCalculatorRegistration.RetryLabel(_localizer);

    /// <summary>Refresh affordance label.</summary>
    public string RefreshLabel => SavingsCalculatorRegistration.RefreshLabel(_localizer);

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => SavingsCalculatorRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => SavingsCalculatorRegistration.OfflineLabel(_localizer);

    /// <summary>Hard-error surface title/message.</summary>
    public string ErrorTitle => SavingsCalculatorRegistration.ErrorText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        SavingsCalculatorState.Loading => LoadingLabel,
        SavingsCalculatorState.Stale => StaleLabel,
        SavingsCalculatorState.Offline => _errorMessage ?? SavingsCalculatorRegistration.OfflineText(_localizer),
        SavingsCalculatorState.Error => _errorMessage ?? SavingsCalculatorRegistration.ErrorText(_localizer),
        SavingsCalculatorState.Empty => EmptyTitle,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network charging-cost load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = SavingsCalculatorState.Loading;
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

    private void UpdateInputs(SavingsCalculatorInputs next)
    {
        if (_inputs == next)
        {
            return;
        }

        var previous = _inputs;
        _inputs = next;
        if (previous.GasPrice != next.GasPrice)
        {
            Raise(nameof(GasPrice));
        }

        if (previous.Mpg != next.Mpg)
        {
            Raise(nameof(Mpg));
        }

        if (previous.ElectricityRate != next.ElectricityRate)
        {
            Raise(nameof(ElectricityRate));
        }

        RefreshDisplay();
    }

    private void Apply(RepositoryResult<SavingsCostAggregate> result)
    {
        _data = NextData(result, _data);

        var outcome = Classify(result, _data);
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

    private Outcome Classify(RepositoryResult<SavingsCostAggregate> result, SavingsCostAggregate? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new Outcome(ContentState(data), true, false, false, false, null, null)
                : new Outcome(SavingsCalculatorState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new Outcome(
                result.IsStale ? SavingsCalculatorState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new Outcome(
                result.IsStale ? SavingsCalculatorState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new Outcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new Outcome(
                SavingsCalculatorState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new Outcome(
                    SavingsCalculatorState.Offline, false, true, true, true,
                    SavingsCalculatorRegistration.OfflineText(_localizer), result.FetchedAt)
                : new Outcome(
                    SavingsCalculatorState.Error, false, true, false, false,
                    SavingsCalculatorRegistration.ErrorText(_localizer), result.FetchedAt),

            _ => new Outcome(
                SavingsCalculatorState.Error, false, true, false, false,
                SavingsCalculatorRegistration.ErrorText(_localizer), null),
        };
    }

    // Web parity: the calculator is mounted only when there is at least one charging session (otherwise the
    // page above renders its own "No Charging Data" empty state). An absent aggregate — or one with no
    // sessions — is the whole-surface empty.
    private static SavingsCalculatorState ContentState(SavingsCostAggregate? data) =>
        data is null || !data.HasData ? SavingsCalculatorState.Empty : SavingsCalculatorState.Loaded;

    private static SavingsCostAggregate? NextData(RepositoryResult<SavingsCostAggregate> result, SavingsCostAggregate? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                  // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null,    // resolved with nothing to show
            _ => result.Value ?? previous,                   // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = Project();

    private SavingsCalculatorDisplay Project() => SavingsCalculatorProjection.Project(
        _data ?? SavingsCostAggregate.Empty, _inputs, _distanceUnit, _localizer, _currencySymbol);

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

    private readonly record struct Outcome(
        SavingsCalculatorState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
