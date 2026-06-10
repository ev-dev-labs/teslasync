using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state a <see cref="FsmStateDiagramViewModel"/> can be in — the native
/// superset of the branches FSMStateDiagram.tsx renders. The web component is a pure child fed
/// <c>transitions</c> as a prop; the native surface binds its own cache-then-network read, so it owns the full
/// loading / loaded / empty / error / stale / offline matrix the P2 state contract requires. <see cref="Empty"/>
/// mirrors the web's <c>!states || !edges</c> gate (an FSM type with no registered diagram); a supported type
/// with zero transitions still renders the (dimmed) diagram as <see cref="Loaded"/>, exactly as the web does.
/// </summary>
public enum FsmStateDiagramState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A resolved snapshot for a supported FSM type — render the diagram (dimmed when idle).</summary>
    Loaded,

    /// <summary>The FSM type has no registered diagram — render the "select a type" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the diagram plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the diagram plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FSMStateDiagram"/> view — the native port of the
/// data composition that feeds FSMStateDiagram.tsx. It projects each cache-then-network snapshot through
/// <see cref="FsmStateDiagramProjection"/> for a fixed <c>fsmType</c> and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. An unsupported FSM type
/// short-circuits to <see cref="FsmStateDiagramState.Empty"/> without a network read (the web shows the empty
/// state regardless of data). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FsmStateDiagramViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<FsmTransition> NoTransitions = Array.Empty<FsmTransition>();

    private readonly IFsmStateDiagramSource _source;
    private readonly string _fsmType;
    private readonly ILocalizer _localizer;
    private readonly bool _supported;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private FsmStateDiagramState _state;
    private FsmStateDiagramDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, FSM type and localizer.</summary>
    /// <param name="source">The cache-then-network transition source.</param>
    /// <param name="fsmType">The FSM type to diagram (web's resolved <c>fsmType</c>, e.g. <c>vehicle</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public FsmStateDiagramViewModel(IFsmStateDiagramSource source, string fsmType, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(fsmType);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _fsmType = fsmType;
        _localizer = localizer;
        _supported = FsmStateDiagramRegistry.HasDiagram(fsmType);
        _display = FsmStateDiagramDisplay.Empty(localizer);
        _state = _supported ? FsmStateDiagramState.Loading : FsmStateDiagramState.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public FsmStateDiagramState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready diagram model.</summary>
    public FsmStateDiagramDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
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

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The FSM type this surface diagrams.</summary>
    public string FsmType => _fsmType;

    /// <summary>True when the FSM type has a registered diagram (the surface ever loads data).</summary>
    public bool IsSupported => _supported;

    /// <summary>Localized surface title.</summary>
    public string Title => FsmStateDiagramRegistration.Name(_localizer);

    /// <summary>Localized loading announcement.</summary>
    public string LoadingMessage =>
        _localizer.GetString(FsmStateDiagramText.LoadingKey, FsmStateDiagramText.LoadingFallback);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. Unsupported FSM types are a no-op (the empty state is already shown). A superseding
    /// load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!_supported)
        {
            return;
        }

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

    private bool HasContent() =>
        _state is FsmStateDiagramState.Loaded or FsmStateDiagramState.Stale or FsmStateDiagramState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<FsmTransition>> result)
    {
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
                ApplySnapshot(result.Value ?? NoTransitions, result.FetchedAt, result.IsStale, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value ?? NoTransitions, result.FetchedAt, result.IsStale, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value ?? NoTransitions, result.FetchedAt, stale: false, fetching: false);
                break;

            case LoadStatus.Empty:
                // A supported FSM type with no rows still renders the (dimmed) diagram, exactly as the web does.
                ApplySnapshot(NoTransitions, result.FetchedAt, stale: false, fetching: false);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value ?? NoTransitions, result.FetchedAt, stale: true, fetching: false, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        IReadOnlyList<FsmTransition> transitions,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline = false)
    {
        Display = FsmStateDiagramProjection.Project(_fsmType, transitions, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline
            ? _localizer.GetString(FsmStateDiagramText.OfflineKey, FsmStateDiagramText.OfflineFallback)
            : null;
        State = offline
            ? FsmStateDiagramState.Offline
            : stale
                ? FsmStateDiagramState.Stale
                : FsmStateDiagramState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = FsmStateDiagramState.Loading;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = FsmStateDiagramState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        if (error?.Kind is RepositoryErrorKind.Offline or RepositoryErrorKind.Network)
        {
            return _localizer.GetString(FsmStateDiagramText.OfflineKey, FsmStateDiagramText.OfflineFallback);
        }

        return _localizer.GetString(FsmStateDiagramText.ErrorKey, FsmStateDiagramText.ErrorFallback);
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
