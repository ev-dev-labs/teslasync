using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BackupActionsCard"/> view — the native port of the
/// web component's hook composition
/// (web/src/features/system/components/status/BackupActionsCard.tsx). It runs the quick-backup mutation flow
/// (web <c>useMutation(triggerQuickBackup)</c>): a single in-flight guard, the busy button label, the success
/// confirmation (web <c>toast.success</c>), the permission-specific message on a 401/403 (web
/// <c>status === 401 || status === 403</c>) and the generic <c>Backup failed: …</c> message otherwise, and a
/// post-success refresh of the backup-status read (web <c>queryClient.invalidateQueries(['backup-runs'])</c>).
/// It also drives the cache-then-network backup-status read the standalone surface adds for completeness,
/// projecting each snapshot into the mutually-exclusive <see cref="State"/> (loading / ready / empty / error /
/// stale / offline) plus the freshness flags so the view is a thin renderer. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class BackupActionsCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBackupActionsSource _source;
    private readonly ILocalizer _localizer;
    private readonly BackupActionsDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _statusCts;
    private RepositoryResult<BackupActionsSnapshot>? _last;
    private bool _disposed;

    private BackupActionsState _state = BackupActionsState.Loading;
    private BackupActionsDisplay _display;
    private BackupActionPhase _phase = BackupActionPhase.Idle;
    private RepositoryError? _statusError;
    private RepositoryError? _actionError;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and (optional) clock.</summary>
    public BackupActionsCardViewModel(
        IBackupActionsSource source,
        ILocalizer localizer,
        BackupActionsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new BackupActionsDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = BackupActionsProjection.Project(BackupActionsSnapshot.Empty, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Backup-status read ───────────────────────────────────────────────────────────────────────────

    /// <summary>The current mutually-exclusive backup-status content state.</summary>
    public BackupActionsState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                RaiseDerived();
            }
        }
    }

    /// <summary>The projected, render-ready backup-status summary (the run-derived rows).</summary>
    public BackupActionsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasRuns));
        }
    }

    /// <summary>Last successful status-fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background status (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last status read failed.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown status is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Number of status-load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when at least one backup run is available to render.</summary>
    public bool HasRuns => _display.HasRuns;

    // ── Quick-backup action ──────────────────────────────────────────────────────────────────────────

    /// <summary>The quick-backup action phase (idle / running / succeeded / failed).</summary>
    public BackupActionPhase Phase => _phase;

    /// <summary>True while the quick-backup mutation is in flight (web <c>mutation.isPending</c>).</summary>
    public bool IsRunning => _phase == BackupActionPhase.Running;

    /// <summary>
    /// True when the quick-backup button is interactive. Mirrors the web guard <c>disabled={mutation.isPending}</c>
    /// exactly: enabled unless a backup is currently being triggered. Always rendered; never hidden.
    /// </summary>
    public bool IsButtonEnabled => !IsRunning;

    /// <summary>The quick-backup button label — busy "Starting…" while running, idle otherwise (web ternary).</summary>
    public string RunButtonLabel => IsRunning
        ? BackupActionsCardRegistration.StartingLabel(_localizer)
        : BackupActionsCardRegistration.RunLabel(_localizer);

    /// <summary>The "Manage backups &amp; restore" link label (web <c>&lt;Link to="/backup"&gt;</c>).</summary>
    public string ManageLabel => BackupActionsCardRegistration.ManageLabel(_localizer);

    /// <summary>The accessible surface name (web accordion section "Backups").</summary>
    public string SurfaceLabel => BackupActionsCardRegistration.SurfaceLabel(_localizer);

    /// <summary>The retry affordance label for the error surface.</summary>
    public string RetryLabel => BackupActionsCardRegistration.RetryLabel(_localizer);

    /// <summary>The loading caption shown while the status read is in flight with no value yet.</summary>
    public string LoadingLabel => BackupActionsCardRegistration.LoadingLabel(_localizer);

    /// <summary>The empty-state message shown when no backup runs exist yet.</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>
    /// The contextual freshness hint shown beside the rows for the stale / offline states, or null otherwise.
    /// Always non-collapsing copy so a region never blanks out.
    /// </summary>
    public string? StatusHint => _state switch
    {
        BackupActionsState.Stale => BackupActionsCardRegistration.StaleLabel(_localizer),
        BackupActionsState.Offline => BackupActionsCardRegistration.OfflineErrorLabel(_localizer),
        _ => null,
    };

    /// <summary>The localized read-failure message for the error surface, or null when not in the error state.</summary>
    public string? ReadErrorMessage => _state == BackupActionsState.Error
        ? BackupActionsCardRegistration.ReadErrorFor(_localizer, _statusError)
        : null;

    /// <summary>The tone of the inline action feedback (none / success / error).</summary>
    public BackupActionFeedbackTone FeedbackTone => _phase switch
    {
        BackupActionPhase.Succeeded => BackupActionFeedbackTone.Success,
        BackupActionPhase.Failed => BackupActionFeedbackTone.Error,
        _ => BackupActionFeedbackTone.None,
    };

    /// <summary>
    /// The inline action feedback message after a quick-backup settles (web toast copy): the success
    /// confirmation, the permission message for a 401/403, or the generic <c>Backup failed: …</c> message —
    /// null while idle or running.
    /// </summary>
    public string? FeedbackMessage => _phase switch
    {
        BackupActionPhase.Succeeded => BackupActionsCardRegistration.StartedLabel(_localizer),
        BackupActionPhase.Failed => FailureMessage(),
        _ => null,
    };

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network backup-status read (web initial query / refetch).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _statusCts, cancellationToken);

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

    /// <summary>Retry the backup-status read after a failure (or refresh on demand).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Trigger a quick backup (web <c>handleRun</c> → <c>mutation.mutate()</c>). No-ops while a backup is
    /// already in flight (web <c>if (mutation.isPending) return</c>). On success it records the success
    /// feedback and refreshes the backup-status read (web <c>invalidateQueries(['backup-runs'])</c>); on
    /// failure it records the permission-specific or generic failure feedback. Never throws for an HTTP fault.
    /// </summary>
    public async Task RunQuickBackupAsync(CancellationToken cancellationToken = default)
    {
        if (IsRunning)
        {
            return;
        }

        SetActionError(null);
        SetPhase(BackupActionPhase.Running);
        _diagnostics.RecordRunRequested();

        QuickBackupOutcome outcome;
        try
        {
            outcome = await _source.RunQuickBackupAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            SetPhase(BackupActionPhase.Idle);
            return;
        }

        if (outcome.Success)
        {
            SetPhase(BackupActionPhase.Succeeded);
            _diagnostics.RecordRunResolved(true);

            // Web parity: invalidate the backup-runs query so the section reflects the new run.
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        else
        {
            SetActionError(outcome.Error);
            SetPhase(BackupActionPhase.Failed);
            _diagnostics.RecordRunResolved(false);
        }
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

    private string FailureMessage()
    {
        if (_actionError?.Kind == RepositoryErrorKind.Unauthorized)
        {
            return BackupActionsCardRegistration.PermissionErrorLabel(_localizer);
        }

        string detail = string.IsNullOrWhiteSpace(_actionError?.Message)
            ? BackupActionsCardRegistration.UnknownErrorLabel(_localizer)
            : _actionError!.Message;
        return BackupActionsCardRegistration.FailedLabel(_localizer, detail);
    }

    private bool HasContent() =>
        _state is BackupActionsState.Ready
            or BackupActionsState.Empty
            or BackupActionsState.Stale
            or BackupActionsState.Offline;

    private void Apply(RepositoryResult<BackupActionsSnapshot> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(
                    result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        BackupActionsSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = BackupActionsProjection.Project(snapshot, _localizer, _clock());

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        _statusError = offline ? error : null;

        // Web parity: an empty runs list is its own empty surface. Offline / stale freshness take precedence
        // for the chrome; the body still renders the right empty/content via Display.
        State = offline
            ? BackupActionsState.Offline
            : stale
                ? BackupActionsState.Stale
                : !Display.HasRuns
                    ? BackupActionsState.Empty
                    : BackupActionsState.Ready;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // The source never reports the engine's generic Empty (it always yields a snapshot); honoured
        // defensively by rendering the same "no backups yet" empty surface.
        Display = BackupActionsProjection.Project(BackupActionsSnapshot.Empty with { HasData = true }, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        _statusError = null;
        State = BackupActionsState.Empty;
    }

    private void SetLoading()
    {
        IsError = false;
        _statusError = null;
        State = BackupActionsState.Loading;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        _statusError = error;
        State = BackupActionsState.Error;
    }

    private void SetPhase(BackupActionPhase value)
    {
        if (Set(ref _phase, value, nameof(Phase)))
        {
            RaiseDerived();
        }
    }

    private void SetActionError(RepositoryError? value)
    {
        _actionError = value;
        Raise(nameof(FeedbackMessage));
    }

    private void RaiseDerived()
    {
        Raise(nameof(State));
        Raise(nameof(IsRunning));
        Raise(nameof(IsButtonEnabled));
        Raise(nameof(RunButtonLabel));
        Raise(nameof(StatusHint));
        Raise(nameof(ReadErrorMessage));
        Raise(nameof(FeedbackTone));
        Raise(nameof(FeedbackMessage));
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
}
