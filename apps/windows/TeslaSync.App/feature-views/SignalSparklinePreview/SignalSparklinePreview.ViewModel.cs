using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SignalSparklinePreview"/> view — the native port
/// of the web component's hook composition
/// (web/src/features/telemetry/components/SignalSparklinePreview.tsx). It owns the single cache-then-network
/// last-hour history read through the <see cref="ISignalSparklinePreviewSource"/> (web
/// <c>useSignalHistory</c>), reproduces the component's render gates — the <c>!enabled</c> short-circuit, the
/// non-numeric <c>(kind)</c> chip, the loading pulse, the <c>&lt; 2 samples</c> em-dash and the trend line —
/// and projects the cache-then-network status onto the section state + freshness so the view is a thin
/// renderer. The fetch is gated on <see cref="Enabled"/> &amp; numeric kind so a collapsed parent leaf fires no
/// request (web intent: "we don't fire 600+ requests on mount"). Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class SignalSparklinePreviewViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalSparklinePreviewSource _source;
    private readonly ILocalizer _localizer;
    private readonly long _vehicleId;
    private readonly string _signal;
    private readonly SignalKind _kind;
    private readonly bool _isNumeric;

    private CancellationTokenSource? _cts;
    private IReadOnlyList<double> _series = Array.Empty<double>();
    private bool _hasLoaded;
    private bool _disposed;

    private bool _enabled;
    private SignalSparklinePreviewState _state;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, the vehicle id, signal, kind, enabled gate and localizer.</summary>
    public SignalSparklinePreviewViewModel(
        ISignalSparklinePreviewSource source,
        long vehicleId,
        string signal,
        SignalKind valueKind,
        bool enabled,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrEmpty(signal);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _vehicleId = vehicleId;
        _signal = signal;
        _kind = valueKind;
        _isNumeric = SignalSparklineKinds.IsNumeric(valueKind);
        _localizer = localizer;
        _enabled = enabled;
        _state = ComputeBaseState();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The surface lifecycle state.</summary>
    public SignalSparklinePreviewState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The chartable numeric series (web <c>numericSeries</c>); empty until at least one load resolves.</summary>
    public IReadOnlyList<double> Series => _series;

    /// <summary>True when the series carries enough points to draw a trend (web <c>numericSeries.length &gt;= 2</c>).</summary>
    public bool HasTrend => _series.Count >= SignalSparklinePreviewQuery.MinSamples;

    /// <summary>The signal's value kind (web <c>valueKind</c> prop).</summary>
    public SignalKind Kind => _kind;

    /// <summary>True when the kind charts a trend line; false routes to the non-numeric chip.</summary>
    public bool IsNumericKind => _isNumeric;

    /// <summary>Last successful update timestamp.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed (hard error or offline).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown series is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Enabled gate (web `enabled` prop) ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Whether the preview is active (web <c>enabled</c> prop). The parent flips this on per-leaf as a
    /// category group expands. Flipping it off collapses the surface and cancels any in-flight load; flipping
    /// it on resets the section so the host can (re)start the fetch via <see cref="LoadAsync"/>.
    /// </summary>
    public bool Enabled => _enabled;

    /// <summary>
    /// Set the enabled gate (web prop change). Returns true when the value changed. Off → <see
    /// cref="SignalSparklinePreviewState.Disabled"/> and the in-flight load is cancelled; on → the non-data
    /// base state, leaving the host to drive <see cref="LoadAsync"/>.
    /// </summary>
    public bool SetEnabled(bool enabled)
    {
        if (_enabled == enabled)
        {
            return false;
        }

        _enabled = enabled;
        Raise(nameof(Enabled));

        if (!enabled)
        {
            Cancel(ref _cts);
            IsFetching = false;
            State = SignalSparklinePreviewState.Disabled;
            return true;
        }

        // Re-enabled: surface whatever we already have, else the loading base state pending the host's load.
        State = _hasLoaded && HasTrend
            ? (_isStale ? SignalSparklinePreviewState.Stale : SignalSparklinePreviewState.Loaded)
            : ComputeBaseState();
        return true;
    }

    // ── Localized copy (web string literals) ───────────────────────────────────────────────────────────

    /// <summary>The compact kind token shown in the non-numeric chip (web renders the raw <c>{valueKind}</c>).</summary>
    public string KindToken => SignalSparklineKinds.Token(_kind);

    /// <summary>The em-dash fallback tooltip when too few samples exist (web <c>title="No samples in last hour"</c>).</summary>
    public string EmptyLabel =>
        _localizer.GetString("telemetry.signalSparkline.empty", "No samples in last hour");

    /// <summary>The non-numeric chip tooltip (web <c>title={`Non-numeric signal (${valueKind})`}</c>).</summary>
    public string NonNumericTooltip => string.Format(
        CultureInfo.CurrentCulture,
        _localizer.GetString("telemetry.signalSparkline.nonNumeric", "Non-numeric signal ({0})"),
        KindToken);

    /// <summary>The hard-failure message shown by the compact retry affordance.</summary>
    public string ErrorLabel =>
        _localizer.GetString("telemetry.signalSparkline.error", "Couldn't load signal trend");

    /// <summary>The retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>The stale-cache chip label.</summary>
    public string StaleLabel => _localizer.GetString("telemetry.signalSparkline.stale", "Stale");

    /// <summary>The offline chip label.</summary>
    public string OfflineLabel => _localizer.GetString("common.offline", "Offline");

    /// <summary>The loading announcement label.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading...");

    /// <summary>The accessible name for the trend line (web has none; native gives Narrator a label).</summary>
    public string TrendLabel => _localizer.GetString("telemetry.signalSparkline.trend", "Signal trend, last hour");

    /// <summary>
    /// The Narrator name for the whole surface, composed per state so every rendered branch is announced with
    /// a meaningful label (the disabled/collapsed surface announces nothing).
    /// </summary>
    public string AccessibleName => _state switch
    {
        SignalSparklinePreviewState.Disabled => string.Empty,
        SignalSparklinePreviewState.NonNumeric => NonNumericTooltip,
        SignalSparklinePreviewState.Loading => LoadingLabel,
        SignalSparklinePreviewState.Empty => EmptyLabel,
        SignalSparklinePreviewState.Loaded => TrendLabel,
        SignalSparklinePreviewState.Stale => $"{TrendLabel}, {StaleLabel}",
        SignalSparklinePreviewState.Offline => $"{(HasTrend ? TrendLabel : EmptyLabel)}, {OfflineLabel}",
        SignalSparklinePreviewState.Error => ErrorLabel,
        _ => string.Empty,
    };

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Run (or re-run) the cache-then-network last-hour history load. No-ops to the gated state when the
    /// preview is disabled or the signal is non-numeric (web parity — those branches never consume the query).
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!_enabled)
        {
            State = SignalSparklinePreviewState.Disabled;
            return;
        }

        if (!_isNumeric)
        {
            State = SignalSparklinePreviewState.NonNumeric;
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        if (_series.Count == 0)
        {
            State = SignalSparklinePreviewState.Loading;
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamHistoryAsync(_vehicleId, _signal, cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disabled / disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the trend on the host's cadence. Identical to <see cref="LoadAsync"/>; named for intent.</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry the surface after a failure.</summary>
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

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────

    private SignalSparklinePreviewState ComputeBaseState()
    {
        if (!_enabled)
        {
            return SignalSparklinePreviewState.Disabled;
        }

        return _isNumeric ? SignalSparklinePreviewState.Loading : SignalSparklinePreviewState.NonNumeric;
    }

    private void Apply(RepositoryResult<IReadOnlyList<double>> result)
    {
        _hasLoaded = true;
        _series = NextSeries(result, _series);

        var outcome = Classify(result, _series.Count);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }

        Raise(nameof(Series));
        Raise(nameof(HasTrend));
    }

    private SectionOutcome Classify(RepositoryResult<IReadOnlyList<double>> result, int count)
    {
        bool has = count > 0;
        return result.Status switch
        {
            LoadStatus.Loading => has
                ? new SectionOutcome(SignalSparklinePreviewState.Loaded, true, false, false, null, null)
                : new SectionOutcome(SignalSparklinePreviewState.Loading, true, false, false, null, null),

            LoadStatus.Cached => has
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(SignalSparklinePreviewState.Empty, true, false, false, null, result.FetchedAt),

            LoadStatus.Refreshing => has
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(SignalSparklinePreviewState.Loading, true, false, false, null, result.FetchedAt),

            LoadStatus.Loaded => has
                ? new SectionOutcome(SignalSparklinePreviewState.Loaded, false, false, false, null, result.FetchedAt)
                : new SectionOutcome(SignalSparklinePreviewState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                SignalSparklinePreviewState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => new SectionOutcome(
                SignalSparklinePreviewState.Offline, false, true, true, null, result.FetchedAt),

            _ => new SectionOutcome(SignalSparklinePreviewState.Error, false, true, false, ErrorLabel, null),
        };
    }

    private static SignalSparklinePreviewState StaleOrLoaded(bool stale) =>
        stale ? SignalSparklinePreviewState.Stale : SignalSparklinePreviewState.Loaded;

    private static IReadOnlyList<double> NextSeries(
        RepositoryResult<IReadOnlyList<double>> result,
        IReadOnlyList<double> previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                          // transient — keep prior trend visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<double>(), // resolved with nothing to chart
            _ => result.Value ?? previous,                           // cached / refreshing / loaded / offline carry a series
        };

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

    private readonly record struct SectionOutcome(
        SignalSparklinePreviewState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
