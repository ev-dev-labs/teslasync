using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="UserImpersonateButton"/> view — the native port
/// of the web component's hook composition
/// (web/src/features/admin/components/UserImpersonateButton.tsx). It drives the cache-then-network status read
/// through the <see cref="IImpersonationSource"/> (web <c>useImpersonationStatus</c>) to compute the surface
/// state, and runs the confirm → start mutation flow (web <c>useStartImpersonation</c> behind the
/// <c>ConfirmDialog</c>). The view is a thin renderer that reflects the exposed state, labels and freshness.
/// The web component is purely presentational; this holder is the native equivalent so the surface logic is
/// verified without a UI host. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class UserImpersonateButtonViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IImpersonationSource _source;
    private readonly ILocalizer _localizer;
    private readonly UserImpersonateButtonDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _statusCts;
    private ImpersonationStatusSnapshot _snapshot = ImpersonationStatusSnapshot.Unknown;
    private bool _disposed;

    private ImpersonateSurfaceState _statusState = ImpersonateSurfaceState.Loading;
    private ImpersonateActionPhase _phase = ImpersonateActionPhase.Idle;
    private string _subject = string.Empty;
    private bool _disabled;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private RepositoryError? _statusError;
    private RepositoryError? _startError;
    private DateTimeOffset? _updatedAt;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and (optional) clock.</summary>
    public UserImpersonateButtonViewModel(
        IImpersonationSource source,
        ILocalizer localizer,
        UserImpersonateButtonDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new UserImpersonateButtonDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Inputs (web props: subject, disabled) ────────────────────────────────────────────────────────

    /// <summary>The opaque proxy-issued subject identifier to impersonate (web <c>subject</c> prop).</summary>
    public string Subject
    {
        get => _subject;
        set
        {
            if (Set(ref _subject, value ?? string.Empty))
            {
                RaiseDerived();
            }
        }
    }

    /// <summary>
    /// Parent-owned disabled flag (web <c>disabled</c> prop) — e.g. this row IS the current admin or
    /// impersonation is already active for someone else. The surface honours it without re-deriving the
    /// decision (web parity: the parent owns the disabled-row choice).
    /// </summary>
    public bool Disabled
    {
        get => _disabled;
        set
        {
            if (Set(ref _disabled, value))
            {
                RaiseDerived();
            }
        }
    }

    // ── Composed surface state ───────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The effective top-level state the view renders. The action phase overrides the status-derived state
    /// while a start is in flight or has failed; otherwise the cache-then-network status read drives it.
    /// </summary>
    public ImpersonateSurfaceState State => _phase switch
    {
        ImpersonateActionPhase.Starting => ImpersonateSurfaceState.Starting,
        ImpersonateActionPhase.Failed => ImpersonateSurfaceState.Error,
        _ => _statusState,
    };

    /// <summary>The action lifecycle phase (idle / confirming / starting / started / failed).</summary>
    public ImpersonateActionPhase Phase => _phase;

    /// <summary>True while the confirmation dialog should be open (web <c>open</c> state).</summary>
    public bool IsConfirmOpen => _phase == ImpersonateActionPhase.Confirming;

    /// <summary>True while the start mutation is in flight (drives the button busy ring).</summary>
    public bool IsStarting => _phase == ImpersonateActionPhase.Starting;

    /// <summary>True once a start has succeeded (the global impersonation banner appears elsewhere).</summary>
    public bool IsStarted => _phase == ImpersonateActionPhase.Started;

    /// <summary>
    /// True when the action can be offered: a known subject, an actionable status (ready or stale), no
    /// parent-disable, and no action already in flight or completed. Mirrors the web guard
    /// <c>disabled || startMut.isPending</c> (extended with the subject + status preconditions the standalone
    /// surface owns).
    /// </summary>
    public bool CanStart =>
        !_disabled
        && !string.IsNullOrEmpty(_subject)
        && _phase == ImpersonateActionPhase.Idle
        && _statusState is ImpersonateSurfaceState.Ready or ImpersonateSurfaceState.Stale;

    /// <summary>True when the button is interactive (enabled). Always rendered; never hidden.</summary>
    public bool IsButtonEnabled => CanStart;

    /// <summary>Last successful status-fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt => _updatedAt;

    /// <summary>True while a background status (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the status read failed.</summary>
    public bool IsError => _isError;

    /// <summary>True when the shown status is older than the freshness window.</summary>
    public bool IsStale => _isStale;

    /// <summary>Load attempts so far (including retries).</summary>
    public int Attempts => _attempts;

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────

    /// <summary>The button label — busy while starting, idle otherwise (web ternary).</summary>
    public string ButtonLabel => IsStarting
        ? UserImpersonateButtonRegistration.StartingLabel(_localizer)
        : UserImpersonateButtonRegistration.StartLabel(_localizer);

    /// <summary>The accessible button name with the subject interpolated (web <c>aria-label</c>).</summary>
    public string ButtonAriaLabel => UserImpersonateButtonRegistration.AriaLabel(_localizer, _subject);

    /// <summary>Confirmation dialog title (web <c>impersonation.confirm.title</c>).</summary>
    public string ConfirmTitle => UserImpersonateButtonRegistration.ConfirmTitle(_localizer);

    /// <summary>Confirmation dialog message with the subject interpolated.</summary>
    public string ConfirmMessage => UserImpersonateButtonRegistration.ConfirmMessage(_localizer, _subject);

    /// <summary>Confirmation primary-button label (web <c>impersonation.confirm.confirm</c>).</summary>
    public string ConfirmConfirmLabel => UserImpersonateButtonRegistration.ConfirmConfirmLabel(_localizer);

    /// <summary>Confirmation cancel-button label (web <c>impersonation.confirm.cancel</c>).</summary>
    public string ConfirmCancelLabel => UserImpersonateButtonRegistration.ConfirmCancelLabel(_localizer);

    /// <summary>Retry affordance label for the error surfaces.</summary>
    public string RetryLabel => UserImpersonateButtonRegistration.RetryLabel(_localizer);

    /// <summary>Loading caption shown while the status read is in flight with no value yet.</summary>
    public string LoadingLabel => UserImpersonateButtonRegistration.LoadingLabel(_localizer);

    /// <summary>Success caption once a start has completed (web <c>impersonation.toast.started</c> default).</summary>
    public string StartedLabel => _localizer.GetString("impersonation.toast.started", "Impersonation started");

    /// <summary>
    /// The contextual hint shown beside / below the button for the non-actionable and freshness states, or
    /// null when no hint applies (ready / starting). Always non-collapsing copy so a region never blanks out.
    /// </summary>
    public string? HintMessage => State switch
    {
        ImpersonateSurfaceState.Loading => LoadingLabel,
        ImpersonateSurfaceState.Empty => UserImpersonateButtonRegistration.UnavailableLabel(_localizer),
        ImpersonateSurfaceState.Offline => UserImpersonateButtonRegistration.OfflineLabel(_localizer),
        ImpersonateSurfaceState.Stale => UserImpersonateButtonRegistration.StaleLabel(_localizer),
        _ => null,
    };

    /// <summary>
    /// The localized error message for the error surface (the action-failure message when a start failed, the
    /// status-failure message when the read failed), or null when not in an error state.
    /// </summary>
    public string? ErrorMessage
    {
        get
        {
            if (_phase == ImpersonateActionPhase.Failed)
            {
                return UserImpersonateButtonRegistration.StartFailedLabel(_localizer);
            }

            return _statusState == ImpersonateSurfaceState.Error
                ? UserImpersonateButtonRegistration.StatusErrorLabel(_localizer)
                : null;
        }
    }

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network status read (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamStatusAsync(cancellationToken);

    /// <summary>Manually re-run the status read with the fetching chip lit (web <c>refetch()</c>).</summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        _isRefreshing = true;
        IsFetching = true;
        try
        {
            await StreamStatusAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _isRefreshing = false;
        }
    }

    /// <summary>
    /// Open the confirmation dialog (web <c>handleClick</c>). No-ops when the action is not currently
    /// available so an accidental call can never start a session without a confirmable, actionable status.
    /// </summary>
    public void BeginConfirm()
    {
        if (!CanStart)
        {
            return;
        }

        SetPhase(ImpersonateActionPhase.Confirming);
    }

    /// <summary>Dismiss the confirmation dialog without starting (web <c>onCancel</c>).</summary>
    public void CancelStart()
    {
        if (_phase == ImpersonateActionPhase.Confirming)
        {
            SetPhase(ImpersonateActionPhase.Idle);
        }
    }

    /// <summary>
    /// Confirm and fire the start mutation (web <c>handleConfirm</c> → <c>startMut.mutate</c>). The subject is
    /// never logged; only success/failure counters are recorded.
    /// </summary>
    public async Task ConfirmStartAsync(CancellationToken cancellationToken = default)
    {
        if (_phase != ImpersonateActionPhase.Confirming || string.IsNullOrEmpty(_subject))
        {
            return;
        }

        SetStartError(null);
        SetPhase(ImpersonateActionPhase.Starting);
        _diagnostics.RecordStartRequested();

        ImpersonationStartOutcome outcome;
        try
        {
            outcome = await _source.StartAsync(_subject, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            SetPhase(ImpersonateActionPhase.Idle);
            return;
        }

        if (outcome.Success)
        {
            if (outcome.Status is { } status)
            {
                _snapshot = status;
            }

            SetPhase(ImpersonateActionPhase.Started);
            _diagnostics.RecordStartResolved(true);
        }
        else
        {
            SetStartError(outcome.Error);
            SetPhase(ImpersonateActionPhase.Failed);
            _diagnostics.RecordStartResolved(false);
        }
    }

    /// <summary>
    /// Retry from an error surface: a failed start re-opens the confirmation dialog, while a failed status
    /// read re-runs the load. The single affordance the view binds for either error origin.
    /// </summary>
    public async Task RetryAsync(CancellationToken cancellationToken = default)
    {
        if (_phase == ImpersonateActionPhase.Failed)
        {
            SetStartError(null);
            SetPhase(ImpersonateActionPhase.Idle);
            BeginConfirm();
            return;
        }

        await StreamStatusAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _statusCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private async Task StreamStatusAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _statusCts, cancellationToken);
        _attempts++;
        Raise(nameof(Attempts));

        if (_snapshot == ImpersonationStatusSnapshot.Unknown && !_isRefreshing)
        {
            SetStatusState(ImpersonateSurfaceState.Loading);
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamStatusAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void Apply(RepositoryResult<ImpersonationStatusSnapshot> result)
    {
        _snapshot = NextSnapshot(result, _snapshot);

        var outcome = Classify(result);
        SetStatusState(outcome.State);
        IsFetching = outcome.IsFetching;
        Set(ref _isError, outcome.IsError, nameof(IsError));
        Set(ref _isStale, outcome.IsStale, nameof(IsStale));
        _statusError = outcome.Error;
        if (outcome.UpdatedAt is { } ts)
        {
            Set(ref _updatedAt, ts, nameof(UpdatedAt));
        }

        RaiseDerived();
    }

    private StatusOutcome Classify(RepositoryResult<ImpersonationStatusSnapshot> result)
    {
        bool known = result.HasValue || _snapshot != ImpersonationStatusSnapshot.Unknown;
        return result.Status switch
        {
            LoadStatus.Loading => known
                ? new StatusOutcome(ImpersonateSurfaceState.Ready, true, false, false, null, null)
                : new StatusOutcome(ImpersonateSurfaceState.Loading, true, false, false, null, null),

            LoadStatus.Cached => new StatusOutcome(
                result.IsStale ? ImpersonateSurfaceState.Stale : ImpersonateSurfaceState.Ready,
                true, false, result.IsStale, null, result.FetchedAt),

            LoadStatus.Refreshing => new StatusOutcome(
                result.IsStale ? ImpersonateSurfaceState.Stale : ImpersonateSurfaceState.Ready,
                true, false, result.IsStale, null, result.FetchedAt),

            LoadStatus.Loaded => new StatusOutcome(
                ImpersonateSurfaceState.Ready, false, false, false, null, result.FetchedAt),

            // A null / non-object status body — treat as "no actionable status" (the empty surface).
            LoadStatus.Empty => new StatusOutcome(
                ImpersonateSurfaceState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => new StatusOutcome(
                ImpersonateSurfaceState.Offline, false, true, true, result.Error, result.FetchedAt),

            // The forward-auth-disabled (open-access) signal is not a fault — it is the empty surface.
            LoadStatus.Error when ImpersonationStatusResultMapper.IsOpenMode(result.Error) =>
                new StatusOutcome(ImpersonateSurfaceState.Empty, false, false, false, result.Error, null),

            _ => new StatusOutcome(ImpersonateSurfaceState.Error, false, true, false, result.Error, null),
        };
    }

    private static ImpersonationStatusSnapshot NextSnapshot(
        RepositoryResult<ImpersonationStatusSnapshot> result,
        ImpersonationStatusSnapshot previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                                  // transient — keep prior content
            LoadStatus.Empty or LoadStatus.Error => ImpersonationStatusSnapshot.Unknown, // nothing to show
            _ => result.Value ?? previous,                                  // cached / refreshing / loaded / offline
        };

    private void SetStatusState(ImpersonateSurfaceState value)
    {
        if (Set(ref _statusState, value, nameof(State)))
        {
            RaiseDerived();
        }
    }

    private void SetPhase(ImpersonateActionPhase value)
    {
        if (Set(ref _phase, value, nameof(Phase)))
        {
            RaiseDerived();
        }
    }

    private void SetStartError(RepositoryError? value)
    {
        _startError = value;
        Raise(nameof(ErrorMessage));
    }

    private void RaiseDerived()
    {
        Raise(nameof(State));
        Raise(nameof(IsConfirmOpen));
        Raise(nameof(IsStarting));
        Raise(nameof(IsStarted));
        Raise(nameof(CanStart));
        Raise(nameof(IsButtonEnabled));
        Raise(nameof(ButtonLabel));
        Raise(nameof(ButtonAriaLabel));
        Raise(nameof(ConfirmMessage));
        Raise(nameof(HintMessage));
        Raise(nameof(ErrorMessage));
    }

    private static CancellationTokenSource Supersede(
        ref CancellationTokenSource? slot,
        CancellationToken cancellationToken)
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

    private readonly record struct StatusOutcome(
        ImpersonateSurfaceState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        RepositoryError? Error,
        DateTimeOffset? UpdatedAt);
}
