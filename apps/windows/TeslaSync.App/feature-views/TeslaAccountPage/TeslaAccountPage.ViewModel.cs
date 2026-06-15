using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TeslaAccountPage</c> view — the native port of the web
/// page's hook composition (web/src/features/system/pages/TeslaAccountPage.tsx). It drives the
/// cache-then-network profile read through the <see cref="ITeslaAccountSource"/> (web
/// <c>useTeslaUserProfile</c>) to compute the surface state, runs the "Refresh from Tesla" mutation (web
/// <c>useRefreshTeslaProfile</c>) and exposes a transient post-refresh notice (the native analogue of the web
/// toast). The view is a thin renderer that reflects the exposed state, labels, values and sync caption. The
/// web page composes the hooks declaratively; this holder is the native equivalent so the surface logic is
/// verified without a UI host. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class TeslaAccountPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITeslaAccountSource _source;
    private readonly ILocalizer _localizer;
    private readonly TeslaAccountDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _profileCts;
    private TeslaProfile _profile = TeslaProfile.Empty;
    private bool _disposed;

    private TeslaAccountSurfaceState _state = TeslaAccountSurfaceState.Loading;
    private bool _isFetching;
    private bool _isRefreshing;
    private DateTimeOffset? _updatedAt;
    private int _attempts;
    private TeslaProfileRefreshNotice? _refreshNotice;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and (optional) clock.</summary>
    /// <param name="source">The profile data port (web <c>useTeslaUserProfile</c> / <c>useRefreshTeslaProfile</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink; null uses a fresh collector.</param>
    /// <param name="clock">The wall-clock used for the relative sync caption; null uses <see cref="DateTimeOffset.Now"/>.</param>
    public TeslaAccountPageViewModel(
        ITeslaAccountSource source,
        ILocalizer localizer,
        TeslaAccountDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new TeslaAccountDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Composed surface state ───────────────────────────────────────────────────────────────────────

    /// <summary>The effective top-level state the view renders (always one visible surface).</summary>
    public TeslaAccountSurfaceState State
    {
        get => _state;
        private set
        {
            if (Set(ref _state, value))
            {
                Raise(nameof(IsLoading));
                Raise(nameof(HasError));
                Raise(nameof(IsEmpty));
                Raise(nameof(HasProfile));
            }
        }
    }

    /// <summary>The current profile snapshot the view renders (never null — <see cref="TeslaProfile.Empty"/>).</summary>
    public TeslaProfile Profile
    {
        get => _profile;
        private set
        {
            if (!Equals(_profile, value))
            {
                _profile = value;
                Raise(nameof(Profile));
                RaiseValues();
            }
        }
    }

    /// <summary>True while the first profile read is in flight with no cached value (web <c>isLoading</c>).</summary>
    public bool IsLoading => _state == TeslaAccountSurfaceState.Loading;

    /// <summary>True when the read failed with no cached value to fall back to (web <c>error</c>).</summary>
    public bool HasError => _state == TeslaAccountSurfaceState.Error;

    /// <summary>True when the read resolved with no profile (web <c>profile == null</c> → EmptyState).</summary>
    public bool IsEmpty => _state == TeslaAccountSurfaceState.Empty;

    /// <summary>True when a profile is present and the populated card is shown (web <c>profile != null</c>).</summary>
    public bool HasProfile => _state == TeslaAccountSurfaceState.Ready;

    /// <summary>Last successful profile-fetch timestamp (exposed for hosting / diagnostics).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background profile (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>Profile load attempts so far (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True while the "Refresh" mutation + reload runs (drives the button busy ring).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set
        {
            if (Set(ref _isRefreshing, value))
            {
                Raise(nameof(IsRefreshEnabled));
            }
        }
    }

    /// <summary>True when the refresh action can be invoked (web parity: disabled while the mutation is pending).</summary>
    public bool IsRefreshEnabled => !_isRefreshing;

    /// <summary>
    /// The transient post-refresh notice (success / failure), or null before any refresh resolves — the native
    /// analogue of the web toast. The view announces it through an assertive live region.
    /// </summary>
    public TeslaProfileRefreshNotice? RefreshNotice
    {
        get => _refreshNotice;
        private set => Set(ref _refreshNotice, value);
    }

    // ── Values (web profile.full_name / profile.email / profile.fetched_at / fetched_at) ───────────────

    /// <summary>The account name shown in the Name row (web <c>profile.full_name || '—'</c>).</summary>
    public string NameValue =>
        string.IsNullOrWhiteSpace(_profile.FullName) ? TeslaAccountRegistration.EmDash : _profile.FullName!;

    /// <summary>The account email shown in the Email row (web <c>profile.email || '—'</c>).</summary>
    public string EmailValue =>
        string.IsNullOrWhiteSpace(_profile.Email) ? TeslaAccountRegistration.EmDash : _profile.Email!;

    /// <summary>The formatted profile fetch time shown in the Fetched At row (web <c>formatDateTime(profile.fetched_at)</c>).</summary>
    public string FetchedAtValue =>
        DateTimeFormatting.Format(_profile.ProfileFetchedInstant, DateTimeVariant.Full, _clock());

    /// <summary>The avatar image URL (web <c>profile.profile_image_url</c>), or null when absent.</summary>
    public string? AvatarUrl => _profile.HasAvatar ? _profile.ProfileImageUrl : null;

    /// <summary>True when an avatar image is available (web <c>profile.profile_image_url</c> guard).</summary>
    public bool HasAvatar => _profile.HasAvatar;

    /// <summary>True when the envelope carries a sync time (web <c>fetchedAt</c> guard on the sync bar).</summary>
    public bool HasSyncTime => _profile.HasSyncTime;

    /// <summary>
    /// The sync-bar caption — the relative "Last synced: {time}" line when the envelope carries a sync time,
    /// otherwise the "Never synced" prompt (web <c>fetchedAt ? lastSynced(...) : neverSynced</c>).
    /// </summary>
    public string SyncCaption => _profile.HasSyncTime
        ? TeslaAccountRegistration.LastSynced(_localizer, RelativeSyncTime)
        : TeslaAccountRegistration.NeverSynced(_localizer);

    private string RelativeSyncTime =>
        DateTimeFormatting.Format(_profile.SyncedInstant, DateTimeVariant.Relative, _clock());

    // ── Localized copy (web t('teslaAccount.*') keys) ──────────────────────────────────────────────────

    /// <summary>Page title (web <c>teslaAccount.title</c>) — also the surface's accessible name.</summary>
    public string Title => TeslaAccountRegistration.Title(_localizer);

    /// <summary>Page subtitle (web <c>teslaAccount.subtitle</c>).</summary>
    public string Subtitle => TeslaAccountRegistration.Subtitle(_localizer);

    /// <summary>Refresh button label (web <c>teslaAccount.refresh</c>).</summary>
    public string RefreshLabel => TeslaAccountRegistration.Refresh(_localizer);

    /// <summary>Profile-card title (web <c>teslaAccount.profile</c>).</summary>
    public string ProfileTitle => TeslaAccountRegistration.ProfileTitle(_localizer);

    /// <summary>Avatar accessible name (web <c>teslaAccount.avatar</c>).</summary>
    public string AvatarLabel => TeslaAccountRegistration.Avatar(_localizer);

    /// <summary>"Name" row label (web <c>teslaAccount.name</c>).</summary>
    public string NameLabel => TeslaAccountRegistration.Name(_localizer);

    /// <summary>"Email" row label (web <c>teslaAccount.email</c>).</summary>
    public string EmailLabel => TeslaAccountRegistration.Email(_localizer);

    /// <summary>"Fetched At" row label (web <c>teslaAccount.fetchedAt</c>).</summary>
    public string FetchedAtLabel => TeslaAccountRegistration.FetchedAt(_localizer);

    /// <summary>Empty-surface message (web <c>teslaAccount.noProfile</c>).</summary>
    public string NoProfileMessage => TeslaAccountRegistration.NoProfile(_localizer);

    /// <summary>Loading caption shown while the first read is in flight.</summary>
    public string LoadingLabel => TeslaAccountRegistration.Loading(_localizer);

    /// <summary>Retry affordance label for the error surface.</summary>
    public string RetryLabel => TeslaAccountRegistration.Retry(_localizer);

    /// <summary>Hard-failure message for the error surface (web <c>PageContainer error</c>).</summary>
    public string ErrorMessage => TeslaAccountRegistration.LoadFailed(_localizer);

    /// <summary>Success notice copy after a refresh (web <c>toast.user.teslaProfile.success</c>).</summary>
    public string RefreshSucceededMessage => TeslaAccountRegistration.RefreshSucceeded(_localizer);

    /// <summary>Failure notice copy after a refresh (web <c>toast.user.teslaProfile.error</c>).</summary>
    public string RefreshFailedMessage => TeslaAccountRegistration.RefreshFailed(_localizer);

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network profile read (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamProfileAsync(cancellationToken);

    /// <summary>
    /// "Refresh from Tesla" — POST the refresh mutation, surface the success/failure notice (web toast), then
    /// re-read the profile to reflect the authoritative state (web <c>invalidateQueries</c> → refetch). The
    /// POST resolves to a notice, never an unhandled rejection; the subsequent reload always reflects the
    /// current server state.
    /// </summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        _diagnostics.RecordRefreshRequested();

        TeslaProfileRefreshOutcome outcome;
        try
        {
            outcome = await _source.RefreshAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsRefreshing = false;
            return;
        }

        RefreshNotice = outcome.Success
            ? new TeslaProfileRefreshNotice(TeslaProfileRefreshNoticeKind.Success, RefreshSucceededMessage)
            : new TeslaProfileRefreshNotice(TeslaProfileRefreshNoticeKind.Error, RefreshFailedMessage);
        _diagnostics.RecordRefreshResolved(outcome.Success);

        try
        {
            await StreamProfileAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <summary>Retry from the error surface — re-run the profile read (web parity for a manual refetch).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => StreamProfileAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _profileCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────

    private async Task StreamProfileAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _profileCts, cancellationToken);
        Attempts++;

        try
        {
            await foreach (var result in _source.StreamProfileAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void Apply(RepositoryResult<TeslaProfile> result)
    {
        Profile = NextProfile(result, _profile);

        var outcome = Classify(result);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }
    }

    private TeslaAccountOutcome Classify(RepositoryResult<TeslaProfile> result)
    {
        bool known = _profile.HasProfile;
        return result.Status switch
        {
            LoadStatus.Loading => known
                ? new TeslaAccountOutcome(TeslaAccountSurfaceState.Ready, true, _updatedAt)
                : new TeslaAccountOutcome(TeslaAccountSurfaceState.Loading, true, null),

            LoadStatus.Cached => new TeslaAccountOutcome(ContentState(), true, result.FetchedAt),

            LoadStatus.Refreshing => new TeslaAccountOutcome(ContentState(), true, result.FetchedAt),

            LoadStatus.Loaded => new TeslaAccountOutcome(ContentState(), false, result.FetchedAt),

            LoadStatus.Empty => new TeslaAccountOutcome(TeslaAccountSurfaceState.Empty, false, result.FetchedAt),

            // Offline keeps a cached profile visible (web parity: TanStack serves cache, no error surface);
            // with nothing cached it falls back to the hard-error surface.
            LoadStatus.Offline => known
                ? new TeslaAccountOutcome(TeslaAccountSurfaceState.Ready, false, result.FetchedAt)
                : new TeslaAccountOutcome(TeslaAccountSurfaceState.Error, false, null),

            _ => new TeslaAccountOutcome(TeslaAccountSurfaceState.Error, false, null),
        };
    }

    // A cached/refreshing/loaded emission shows the populated card when a profile is known, or the friendly
    // empty surface when the row carries no profile (web parity: the `profile` guard).
    private TeslaAccountSurfaceState ContentState() =>
        _profile.HasProfile ? TeslaAccountSurfaceState.Ready : TeslaAccountSurfaceState.Empty;

    private static TeslaProfile NextProfile(RepositoryResult<TeslaProfile> result, TeslaProfile previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                               // transient — keep prior content
            LoadStatus.Empty or LoadStatus.Error => TeslaProfile.Empty,   // nothing to show
            _ => result.Value ?? previous,                               // cached / refreshing / loaded / offline
        };

    private void RaiseValues()
    {
        Raise(nameof(NameValue));
        Raise(nameof(EmailValue));
        Raise(nameof(FetchedAtValue));
        Raise(nameof(AvatarUrl));
        Raise(nameof(HasAvatar));
        Raise(nameof(HasSyncTime));
        Raise(nameof(SyncCaption));
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

    private readonly record struct TeslaAccountOutcome(
        TeslaAccountSurfaceState State,
        bool IsFetching,
        DateTimeOffset? UpdatedAt);
}
