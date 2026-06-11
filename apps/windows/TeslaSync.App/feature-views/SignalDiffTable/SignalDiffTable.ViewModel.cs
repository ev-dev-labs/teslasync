using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Event payload for a pin toggle — the signal name and whether it is pinned after the toggle. The host
/// page persists this through the unified pinned-items API (web <c>useTogglePin</c>); the surface itself
/// stays HTTP-free.
/// </summary>
public sealed record SignalDiffPinChange(string Signal, bool IsPinned);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SignalDiffTable"/> view — the native port of the
/// web component's composition (web/src/features/telemetry/components/SignalDiffTable.tsx and its parent
/// SignalDiffPage). It drives the single cache-then-network diff read through the
/// <see cref="ISignalDiffTableSource"/> (web <c>useSignalDiffServer</c>), holds the client-side name filter
/// (the parent page's search → <c>filterActive</c>), the multi-row selection (web
/// <c>selectedSignals</c> / <c>onSelectionChange</c>) and the pinned-signal set (web <c>pinnedSignals</c>),
/// projects the rows through <see cref="SignalDiffProjection"/> (pinned-first, then name), and exposes the
/// section state + freshness so the view is a thin renderer. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class SignalDiffTableViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISignalDiffTableSource _source;
    private readonly ILocalizer _localizer;
    private readonly long _vehicleId;

    private CancellationTokenSource? _cts;
    private IReadOnlyList<SignalDiffRow> _rows = Array.Empty<SignalDiffRow>();
    private readonly HashSet<string> _pinned = new(StringComparer.Ordinal);
    private readonly List<string> _selected = new();
    private bool _disposed;

    private string _filter = string.Empty;

    private SignalDiffSectionState _state = SignalDiffSectionState.Loading;
    private SignalDiffDisplay _display = SignalDiffDisplay.Empty;
    private bool _hasDiffs;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, the vehicle id and localizer.</summary>
    public SignalDiffTableViewModel(ISignalDiffTableSource source, long vehicleId, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _vehicleId = vehicleId;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the selected-signal set changes (web <c>onSelectionChange</c>).</summary>
    public event EventHandler<IReadOnlyList<string>>? SelectionChanged;

    /// <summary>Raised when a row's pin is toggled, so the host can persist it (web <c>useTogglePin</c>).</summary>
    public event EventHandler<SignalDiffPinChange>? PinToggled;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The surface lifecycle state.</summary>
    public SignalDiffSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected (filtered + pinned-first-sorted) display rows.</summary>
    public SignalDiffDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True when the diff carried at least one differing signal (web <c>rows.length &gt; 0</c>).</summary>
    public bool HasDiffs
    {
        get => _hasDiffs;
        private set => Set(ref _hasDiffs, value);
    }

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

    /// <summary>True when the last read failed.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown diff is older than the freshness window.</summary>
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

    // ── Filter (parent page search → filterActive) ─────────────────────────────────────────────────────

    /// <summary>The signal-name filter text. Setting it re-projects without refetching.</summary>
    public string Filter => _filter;

    /// <summary>
    /// True when a filter narrows the rows — drives the empty-message choice exactly as the web
    /// <c>filterActive</c> prop does (filtered-empty → "No signals match the current filter"; otherwise the
    /// surface is in its <see cref="SignalDiffSectionState.Empty"/> state).
    /// </summary>
    public bool FilterActive => _filter.Trim().Length > 0;

    /// <summary>
    /// Apply a new filter (the parent page's search). Pure client-side: it re-projects the cached rows
    /// rather than refetching, exactly as the web <c>useMemo</c> chain does.
    /// </summary>
    public void SetFilter(string filter)
    {
        ArgumentNullException.ThrowIfNull(filter);
        if (string.Equals(_filter, filter, StringComparison.Ordinal))
        {
            return;
        }

        _filter = filter;
        Raise(nameof(Filter));
        Raise(nameof(FilterActive));
        Reproject();
    }

    // ── Selection (web selectedSignals / onSelectionChange) ──────────────────────────────────────────────

    /// <summary>The selected signal names, in selection order.</summary>
    public IReadOnlyList<string> SelectedSignals => _selected.AsReadOnly();

    /// <summary>Number of selected signals.</summary>
    public int SelectedCount => _selected.Count;

    /// <summary>True when <paramref name="signal"/> is selected.</summary>
    public bool IsSelected(string signal) => _selected.Contains(signal);

    /// <summary>Replace the selection wholesale (web controlled <c>selectedSignals</c> prop).</summary>
    public void SetSelection(IEnumerable<string> signals)
    {
        ArgumentNullException.ThrowIfNull(signals);
        _selected.Clear();
        foreach (var s in signals)
        {
            if (!_selected.Contains(s))
            {
                _selected.Add(s);
            }
        }

        RaiseSelection();
    }

    /// <summary>Toggle one row's selection (web checkbox toggle).</summary>
    public void ToggleSelection(string signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        if (!_selected.Remove(signal))
        {
            _selected.Add(signal);
        }

        RaiseSelection();
    }

    /// <summary>Select every currently-visible (projected) row (web select-all header checkbox).</summary>
    public void SelectAllVisible()
    {
        _selected.Clear();
        foreach (var row in _display.Rows)
        {
            _selected.Add(row.Name);
        }

        RaiseSelection();
    }

    /// <summary>Clear the selection (web bulk-bar clear).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        RaiseSelection();
    }

    // ── Pinned signals (web pinnedSignals + useTogglePin) ────────────────────────────────────────────────

    /// <summary>The pinned signal names.</summary>
    public IReadOnlyCollection<string> PinnedSignals => _pinned;

    /// <summary>Number of pinned signals.</summary>
    public int PinnedCount => _pinned.Count;

    /// <summary>True when <paramref name="signal"/> is pinned.</summary>
    public bool IsPinned(string signal) => _pinned.Contains(signal);

    /// <summary>
    /// Seed the pinned set from the host's persisted pins (web <c>pinnedSignals</c> prop). Re-projects so the
    /// pinned-first sort reflects the new set; does not raise <see cref="PinToggled"/> (no user action).
    /// </summary>
    public void SetPinned(IEnumerable<string> signals)
    {
        ArgumentNullException.ThrowIfNull(signals);
        _pinned.Clear();
        foreach (var s in signals)
        {
            _pinned.Add(s);
        }

        Raise(nameof(PinnedSignals));
        Raise(nameof(PinnedCount));
        Reproject();
    }

    /// <summary>
    /// Toggle one signal's pin (web <c>PinButton</c>): updates the local set, re-projects (pinned rows float
    /// to the top), and raises <see cref="PinToggled"/> so the host persists it through the pinned-items API.
    /// </summary>
    public void TogglePin(string signal)
    {
        ArgumentNullException.ThrowIfNull(signal);
        bool pinnedNow;
        if (_pinned.Remove(signal))
        {
            pinnedNow = false;
        }
        else
        {
            _pinned.Add(signal);
            pinnedNow = true;
        }

        Raise(nameof(PinnedSignals));
        Raise(nameof(PinnedCount));
        Reproject();
        PinToggled?.Invoke(this, new SignalDiffPinChange(signal, pinnedNow));
    }

    // ── Localized copy (web t(...) strings) ────────────────────────────────────────────────────────────

    /// <summary>Surface title for the control's Narrator name (web page <c>signalDiff.title</c>).</summary>
    public string Title => _localizer.GetString("signalDiff.title", "Signal Diff");

    /// <summary>"Signal" column header.</summary>
    public string SignalHeader => _localizer.GetString("signalDiff.signal", "Signal");

    /// <summary>"Window A" column header.</summary>
    public string WindowAHeader => _localizer.GetString("signalDiff.valueA", "Window A");

    /// <summary>"Window B" column header.</summary>
    public string WindowBHeader => _localizer.GetString("signalDiff.valueB", "Window B");

    /// <summary>"Δ" column header.</summary>
    public string DeltaHeader => _localizer.GetString("signalDiff.delta", "\u0394");

    /// <summary>"Src A" column header.</summary>
    public string SourceAHeader => _localizer.GetString("signalDiff.sourceA", "Src A");

    /// <summary>"Src B" column header.</summary>
    public string SourceBHeader => _localizer.GetString("signalDiff.sourceB", "Src B");

    /// <summary>Legend "Δ" label.</summary>
    public string LegendDelta => _localizer.GetString("signalDiff.legend.delta", "\u0394");

    /// <summary>Legend "Src A / Src B" label.</summary>
    public string LegendSource => _localizer.GetString("signalDiff.legend.source", "Src A / Src B");

    /// <summary>Δ-column help tooltip text.</summary>
    public string DeltaHelp => _localizer.GetString(
        "help.signal.deltaCol",
        "Numeric difference (and percent change) between Window A and Window B for this signal. 'changed' is shown for non-numeric values that differ.");

    /// <summary>Source-layer-column help tooltip text.</summary>
    public string SourceHelp => _localizer.GetString(
        "help.signal.sourceLayer",
        "The layer that supplied this value: L1 (in-process), L2 (Redis), LOG (TimescaleDB history), or STALE (older than 2 minutes).");

    /// <summary>Narrator label for the Δ help affordance.</summary>
    public string DeltaAria => _localizer.GetString("signalDiff.legend.deltaAria", "More info about the \u0394 column");

    /// <summary>Narrator label for the source-layer help affordance.</summary>
    public string SourceAria =>
        _localizer.GetString("signalDiff.legend.sourceAria", "More info about the source-layer column");

    /// <summary>Empty-state copy (no differing signals).</summary>
    public string EmptyMessage =>
        _localizer.GetString("signalDiff.tableEmpty", "No differences between the two snapshots");

    /// <summary>In-table message when no signal matches the active filter.</summary>
    public string FilteredEmptyMessage =>
        _localizer.GetString("signalDiff.tableNoMatches", "No signals match the current filter");

    /// <summary>In-table message while the first diff loads.</summary>
    public string LoadingLabel => _localizer.GetString("signalDiff.tableLoading", "Loading\u2026");

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("signalDiff.retry", "Retry");

    /// <summary>Pin affordance label (web <c>pin.pin</c>).</summary>
    public string PinLabel => _localizer.GetString("pin.pin", "Pin");

    /// <summary>Unpin affordance label (web <c>pin.unpin</c>).</summary>
    public string UnpinLabel => _localizer.GetString("pin.unpin", "Unpin");

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network diff load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        if (_rows.Count == 0)
        {
            State = SignalDiffSectionState.Loading;
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamDiffAsync(_vehicleId, cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the diff (identical to <see cref="LoadAsync"/>; named for caller intent).</summary>
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

    private void Apply(RepositoryResult<IReadOnlyList<SignalDiffRow>> result)
    {
        _rows = NextRows(result, _rows);
        HasDiffs = _rows.Count > 0;
        Reproject();

        var outcome = Classify(result, _rows.Count);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }
    }

    private void Reproject() =>
        Display = SignalDiffProjection.Project(_rows, _filter, _pinned, _localizer);

    private static SignalDiffSectionState ClassifyState(LoadStatus status, bool hasRows, bool stale) => status switch
    {
        LoadStatus.Loading => hasRows ? SignalDiffSectionState.Loaded : SignalDiffSectionState.Loading,
        LoadStatus.Cached or LoadStatus.Refreshing => hasRows
            ? (stale ? SignalDiffSectionState.Stale : SignalDiffSectionState.Loaded)
            : SignalDiffSectionState.Empty,
        LoadStatus.Loaded => hasRows ? SignalDiffSectionState.Loaded : SignalDiffSectionState.Empty,
        LoadStatus.Empty => SignalDiffSectionState.Empty,
        LoadStatus.Offline => hasRows ? SignalDiffSectionState.Offline : SignalDiffSectionState.Error,
        _ => SignalDiffSectionState.Error,
    };

    private SectionOutcome Classify(RepositoryResult<IReadOnlyList<SignalDiffRow>> result, int rowCount)
    {
        bool hasRows = rowCount > 0;
        var state = ClassifyState(result.Status, hasRows, result.IsStale);

        return result.Status switch
        {
            LoadStatus.Loading => new SectionOutcome(state, true, false, false, null, null),
            LoadStatus.Cached => new SectionOutcome(state, true, false, hasRows && result.IsStale, null, result.FetchedAt),
            LoadStatus.Refreshing => new SectionOutcome(state, true, false, hasRows && result.IsStale, null, result.FetchedAt),
            LoadStatus.Loaded => new SectionOutcome(state, false, false, false, null, result.FetchedAt),
            LoadStatus.Empty => new SectionOutcome(state, false, false, false, null, result.FetchedAt),
            LoadStatus.Offline => new SectionOutcome(
                state, false, true, hasRows, ErrorTextFor(result.Error), result.FetchedAt),
            _ => new SectionOutcome(state, false, true, false, ErrorTextFor(result.Error), null),
        };
    }

    private static IReadOnlyList<SignalDiffRow> NextRows(
        RepositoryResult<IReadOnlyList<SignalDiffRow>> result,
        IReadOnlyList<SignalDiffRow> previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                                  // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<SignalDiffRow>(), // resolved with nothing to show
            _ => result.Value ?? previous,                                  // cached / refreshing / loaded / offline carry rows
        };

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "signalDiff.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "signalDiff.error.offline",
            _ => "signalDiff.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the signal diff",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached diff",
            _ => "Failed to load diff",
        };

        return _localizer.GetString(key, fallback);
    }

    private void RaiseSelection()
    {
        Raise(nameof(SelectedSignals));
        Raise(nameof(SelectedCount));
        SelectionChanged?.Invoke(this, SelectedSignals);
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

    private readonly record struct SectionOutcome(
        SignalDiffSectionState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
