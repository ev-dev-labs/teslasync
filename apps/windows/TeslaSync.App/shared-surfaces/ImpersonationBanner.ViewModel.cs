using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ImpersonationBanner"/> view — the native port of the web
/// <c>ImpersonationBanner</c> body (web/src/components/feedback/ImpersonationBanner.tsx L44-134). It binds the i18n
/// facade (P1/S10) and the <see cref="IImpersonationBannerSource"/> (the P1/S8 status + end seam, the web
/// <c>useImpersonationStatus</c> / <c>useEndImpersonation</c> hooks). It drives the cache-then-network status read
/// to maintain the current impersonation claim and its freshness, recomputes the pure
/// <see cref="ImpersonationBannerProjection"/> on every status change and on every countdown <see cref="Tick"/>, and
/// runs the idempotent end mutation. The banner is shown only while the claim is <c>active</c> (web
/// <c>if (!isImpersonationActive(data)) return null</c>): the generic loading / empty / error / inactive / open-mode
/// states all collapse to the hidden state exactly as the web returns <c>null</c>, while the freshness states the
/// surface actually reaches over an active cached claim — <see cref="IsStale"/> and <see cref="IsOffline"/> — are
/// surfaced as a freshness chip beside the still-visible banner. <see cref="Tick"/> reprojects the countdown against
/// the injected clock (web 1-second <c>setInterval</c>); <see cref="RefreshAsync"/> re-runs the read (web 30-second
/// <c>refetchInterval</c>). <see cref="Dispose"/> cancels any in-flight read. The view performs no I/O itself. Drive
/// it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ImpersonationBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IImpersonationBannerSource _source;
    private readonly ILocalizer _localizer;
    private readonly ImpersonationBannerDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _statusCts;
    private ImpersonationStatusSnapshot _snapshot = ImpersonationStatusSnapshot.Unknown;
    private ImpersonationBannerProjection _projection;
    private bool _isEnding;
    private bool _isFetching;
    private bool _isStale;
    private bool _isOffline;
    private bool _isError;
    private bool _isRefreshing;
    private DateTimeOffset? _updatedAt;
    private bool _disposed;

    /// <summary>Creates the holder over its data source, localizer, diagnostics and (optional) clock.</summary>
    /// <param name="source">The status + end seam (web <c>useImpersonationStatus</c> / <c>useEndImpersonation</c>).</param>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the view-opened / end events.</param>
    /// <param name="clock">The "now" source the countdown is measured against (web <c>Date.now()</c>).</param>
    public ImpersonationBannerViewModel(
        IImpersonationBannerSource source,
        ILocalizer localizer,
        ImpersonationBannerDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ImpersonationBannerDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _projection = Compute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ImpersonationBanner</c>).</summary>
    public static string Slug => ImpersonationBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + title + body + countdown + end label + live setting + name).</summary>
    public ImpersonationBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown — the web <c>if (!isImpersonationActive(data)) return null</c> gate.</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The impersonated subject identifier (web <c>data.target</c>).</summary>
    public string Target => _projection.Target;

    /// <summary>The localized banner title (web <c>impersonation.banner.title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized banner body (web <c>impersonation.banner.body</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>Whether the remaining-lifetime line is shown (web <c>countdown !== null</c>).</summary>
    public bool HasCountdown => _projection.HasCountdown;

    /// <summary>The localized remaining-lifetime line (web <c>countdown</c>), or empty when <see cref="HasCountdown"/> is false.</summary>
    public string Countdown => _projection.Countdown;

    /// <summary>The localized end-button label — busy while ending, idle otherwise (web ternary).</summary>
    public string EndLabel => _projection.EndLabel;

    /// <summary>Whether the end mutation is in flight (web <c>endMut.isPending</c>) — drives the disabled button.</summary>
    public bool IsEnding => _projection.IsEnding;

    /// <summary>True when the end button is interactive — the banner is visible and no end is in flight.</summary>
    public bool IsEndEnabled => _projection.IsVisible && !_projection.IsEnding;

    /// <summary>The accessible name the polite alert region announces (title + body + countdown).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>True while the banner is visible and a remaining-lifetime countdown should keep ticking.</summary>
    public bool IsCountingDown => _projection.IsVisible && _projection.HasCountdown;

    /// <summary>Last successful status-fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt => _updatedAt;

    /// <summary>True while a background status (re)fetch is in flight.</summary>
    public bool IsFetching => _isFetching;

    /// <summary>True when the shown status is older than the freshness window (web 15-second <c>staleTime</c>).</summary>
    public bool IsStale => _isStale;

    /// <summary>True when the network is unreachable and a cached active claim is still shown.</summary>
    public bool IsOffline => _isOffline;

    /// <summary>True when the most recent status read failed with no usable cached claim.</summary>
    public bool IsError => _isError;

    /// <summary>Run (or re-run) the cache-then-network status read (web initial query).</summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamStatusAsync(cancellationToken);

    /// <summary>
    /// Re-run the status read with the fetching chip lit — the native analogue of the web 30-second
    /// <c>refetchInterval</c> poll that keeps the banner's claim and countdown current without a reload.
    /// </summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        _isRefreshing = true;
        SetFetching(true);
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
    /// Recompute the countdown against the current clock — the native analogue of the web 1-second
    /// <c>setInterval</c> tick that advances "Expires in {time}" toward "Session expired". Raises
    /// <see cref="PropertyChanged"/> only when the rendered projection actually changed.
    /// </summary>
    public void Tick() => Reproject();

    /// <summary>
    /// End the current impersonation session (web <c>handleEnd</c> → <c>endMut.mutate()</c>). Marks the button busy
    /// while the idempotent end mutation runs; on success the claim is cleared so the banner disappears (web
    /// parity: the status cache is primed with <c>{ mode: 'inactive' }</c>); on failure the banner stays visible with
    /// the button re-enabled. The subject is never logged — only success/failure counters are recorded.
    /// </summary>
    /// <param name="cancellationToken">Cancels the in-flight mutation.</param>
    public async Task EndImpersonationAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || _isEnding || _snapshot.Mode != ImpersonationMode.Active)
        {
            return;
        }

        SetEnding(true);
        _diagnostics.RecordEndRequested();

        ImpersonationEndOutcome outcome;
        try
        {
            outcome = await _source.EndAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            SetEnding(false);
            return;
        }

        if (outcome.Success)
        {
            // web onSuccess: setQueryData(status, { mode: 'inactive' }) — the banner disappears at once.
            _snapshot = Inactive;
            ResetFreshness();
            _diagnostics.RecordEndResolved(true);
            SetEnding(false);
        }
        else
        {
            _diagnostics.RecordEndResolved(false);
            SetEnding(false);
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

    private static readonly ImpersonationStatusSnapshot Inactive =
        new(ImpersonationMode.Inactive, null, null, null);

    private async Task StreamStatusAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _statusCts, cancellationToken);

        if (!_isRefreshing)
        {
            SetFetching(true);
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

        switch (result.Status)
        {
            case LoadStatus.Loading:
                SetFreshness(fetching: true, stale: _isStale, offline: false, error: false);
                break;

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
                SetFreshness(fetching: true, stale: result.IsStale, offline: false, error: false);
                SetUpdatedAt(result.FetchedAt);
                break;

            case LoadStatus.Loaded:
                SetFreshness(fetching: false, stale: false, offline: false, error: false);
                SetUpdatedAt(result.FetchedAt);
                break;

            case LoadStatus.Empty:
                SetFreshness(fetching: false, stale: false, offline: false, error: false);
                SetUpdatedAt(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                SetFreshness(fetching: false, stale: true, offline: true, error: false);
                SetUpdatedAt(result.FetchedAt);
                break;

            default:
                // A hard read failure (including the AUTH_MODE_OPEN open-mode signal) carries no active claim, so the
                // banner is hidden — web parity with the query throwing / returning { mode: 'open' }. The open-mode
                // case is classified, not surfaced as an error chip.
                var openMode = ImpersonationStatusResultMapper.IsOpenMode(result.Error);
                SetFreshness(fetching: false, stale: false, offline: false, error: !openMode);
                break;
        }

        Reproject();
    }

    private static ImpersonationStatusSnapshot NextSnapshot(
        RepositoryResult<ImpersonationStatusSnapshot> result,
        ImpersonationStatusSnapshot previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                                              // transient — keep prior claim
            LoadStatus.Empty or LoadStatus.Error => ImpersonationStatusSnapshot.Unknown,  // no active claim → hidden
            _ => result.Value ?? previous,                                               // cached / refreshing / loaded / offline
        };

    private ImpersonationBannerProjection Compute() =>
        ImpersonationBannerProjection.Project(_snapshot, _clock(), _isEnding, _localizer);

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        RaiseProjectionChanged();
    }

    private void SetEnding(bool value)
    {
        if (_isEnding == value)
        {
            return;
        }

        _isEnding = value;
        Reproject();
    }

    private void SetFetching(bool value)
    {
        if (_isFetching == value)
        {
            return;
        }

        _isFetching = value;
        Raise(nameof(IsFetching));
    }

    private void SetUpdatedAt(DateTimeOffset? value)
    {
        if (value is not { } ts || _updatedAt == ts)
        {
            return;
        }

        _updatedAt = ts;
        Raise(nameof(UpdatedAt));
    }

    private void SetFreshness(bool fetching, bool stale, bool offline, bool error)
    {
        SetFetching(fetching);

        if (_isStale != stale)
        {
            _isStale = stale;
            Raise(nameof(IsStale));
        }

        if (_isOffline != offline)
        {
            _isOffline = offline;
            Raise(nameof(IsOffline));
        }

        if (_isError != error)
        {
            _isError = error;
            Raise(nameof(IsError));
        }
    }

    private void ResetFreshness() => SetFreshness(fetching: false, stale: false, offline: false, error: false);

    private void RaiseProjectionChanged()
    {
        Raise(nameof(Projection));
        Raise(nameof(IsVisible));
        Raise(nameof(Target));
        Raise(nameof(Title));
        Raise(nameof(Body));
        Raise(nameof(HasCountdown));
        Raise(nameof(Countdown));
        Raise(nameof(EndLabel));
        Raise(nameof(IsEnding));
        Raise(nameof(IsEndEnabled));
        Raise(nameof(AccessibleName));
        Raise(nameof(IsCountingDown));
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

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
