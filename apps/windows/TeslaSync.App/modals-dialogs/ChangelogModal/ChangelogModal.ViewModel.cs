using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Canonical metadata for the Changelog modal surface — the native mirror of the web
/// <c>ChangelogModal</c> (web/src/components/feedback/ChangelogModal.tsx) and its
/// <c>useChangelog</c> constants (web/src/hooks/useChangelog.ts).
/// </summary>
public static class ChangelogModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChangelogModal";

    /// <summary>The full-changelog destination opened by "View full changelog" (web releases URL).</summary>
    public const string ReleasesUrl = "https://github.com/ev-dev-labs/teslasync/releases";

    /// <summary>The auto-show throttle window (web <c>AUTO_SHOW_THROTTLE_MS</c> = 24h).</summary>
    public static TimeSpan AutoShowThrottle => TimeSpan.FromHours(24);
}

/// <summary>
/// PII-safe diagnostics for the Changelog modal (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a version, count or acknowledgement state — so a
/// diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class ChangelogModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChangelogModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChangelogModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChangelogModalRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChangelogModal"/> view — the native port of the
/// web <c>ChangelogModal</c> component logic plus its <c>useChangelog</c> hook
/// (web/src/components/feedback/ChangelogModal.tsx, web/src/hooks/useChangelog.ts). It consumes the
/// cache-then-network <see cref="IChangelogSource"/>, projects each reading through
/// <see cref="ChangelogModalProjection"/>, exposes the mutually-exclusive <see cref="State"/> plus the
/// freshness flags so the view is a thin renderer, and owns the acknowledgement actions (<see cref="MarkSeen"/>,
/// <see cref="StampShown"/>) and the auto-show gating predicate (<see cref="ShouldAutoShow"/>). Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChangelogModalViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChangelogSource _source;
    private readonly IChangelogAcknowledgementStore _store;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private string? _latestVersion;
    private bool _disposed;

    private ChangelogModalState _state = ChangelogModalState.Loading;
    private ChangelogModalDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _acknowledged;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, acknowledgement store, localizer and clock.</summary>
    /// <param name="source">The cache-then-network changelog source.</param>
    /// <param name="store">The seen-version / throttle persistence seam.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="clock">The clock used for the auto-show throttle (defaults to <see cref="DateTimeOffset.UtcNow"/>).</param>
    public ChangelogModalViewModel(
        IChangelogSource source,
        IChangelogAcknowledgementStore store,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _store = store;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ChangelogModalState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready body (null until a reading resolves, or on the empty surface).</summary>
    public ChangelogModalDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the read failed (drives the error chip / surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown body is backed by a read older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>
    /// True once the user has acknowledged the modal via "Got it" / "View full changelog" (web
    /// <c>acknowledged</c>). A dismiss via Esc / backdrop leaves this false so the seen-version is untouched.
    /// </summary>
    public bool Acknowledged
    {
        get => _acknowledged;
        private set => Set(ref _acknowledged, value);
    }

    /// <summary>Localized error message shown in the error surface.</summary>
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

    /// <summary>True when a reading resolved and the body is renderable.</summary>
    public bool HasData => _display is { HasEntries: true };

    /// <summary>Localized modal title (web <c>changelog.modal.title</c>).</summary>
    public string Title => _localizer.GetString("changelog.modal.title", "What's new in TeslaSync");

    /// <summary>Localized "Got it" primary action label (web <c>changelog.modal.gotIt</c>).</summary>
    public string GotItText => _localizer.GetString("changelog.modal.gotIt", "Got it");

    /// <summary>Localized "View full changelog" action label (web <c>changelog.modal.viewFull</c>).</summary>
    public string ViewFullText => _localizer.GetString("changelog.modal.viewFull", "View full changelog");

    /// <summary>Localized empty-surface message.</summary>
    public string EmptyMessage => _localizer.GetString("common.noData", "No data available");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryText => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized close affordance label.</summary>
    public string CloseText => _localizer.GetString("common.close", "Close");

    /// <summary>Localized stale chip label.</summary>
    public string StaleText => _localizer.GetString("common.stale", "Stale");

    /// <summary>Localized offline chip label.</summary>
    public string OfflineText => _localizer.GetString("common.offline", "Offline");

    /// <summary>Localized loading announcement.</summary>
    public string LoadingText => _localizer.GetString("common.loading", "Loading...");

    /// <summary>
    /// True when at least one release shipped after the acknowledged version (web <c>hasUnseen</c>). Reads the
    /// store live so it reflects a just-written <see cref="MarkSeen"/>.
    /// </summary>
    public bool HasUnseen
    {
        get
        {
            if (_latestVersion is not { } latest)
            {
                return false;
            }

            string? seen = _store.GetSeenVersion();
            return string.IsNullOrEmpty(seen) || ChangelogModalProjection.CompareVersions(latest, seen) > 0;
        }
    }

    /// <summary>True once the user has finished onboarding (web <c>hasCompletedOnboarding</c>).</summary>
    public bool HasCompletedOnboarding => _store.HasCompletedOnboarding();

    /// <summary>True when enough time has passed since the last auto-show (web <c>canAutoShow</c>).</summary>
    public bool CanAutoShow
    {
        get
        {
            if (!HasUnseen)
            {
                return false;
            }

            DateTimeOffset? last = _store.GetLastShownAt();
            return last is not { } shown || _clock() - shown >= ChangelogModalRegistration.AutoShowThrottle;
        }
    }

    /// <summary>
    /// The native auto-show gating predicate (web auto-show effect): there are unseen entries, onboarding is
    /// finished and the throttle has elapsed. The host decides whether to actually present the modal (the web
    /// also probes for an active tour overlay, which is a host concern).
    /// </summary>
    public bool ShouldAutoShow => HasUnseen && HasCompletedOnboarding && CanAutoShow;

    /// <summary>
    /// Run a load: counts the attempt, shows the skeleton only when nothing is already visible (otherwise keeps
    /// the body while refreshing), and folds every emission into <see cref="State"/> + <see cref="Display"/>. A
    /// superseding load cancels the prior one.
    /// </summary>
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
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Acknowledge the latest release (web "Got it" / "View full changelog"): records the seen-version and
    /// stamps the auto-show throttle so the unseen indicator clears across the app.
    /// </summary>
    public void MarkSeen()
    {
        if (_latestVersion is { } latest)
        {
            _store.SetSeenVersion(latest);
        }

        _store.SetLastShownAt(_clock());
        Acknowledged = true;
        RaiseAutoShowState();
    }

    /// <summary>
    /// Stamp the auto-show throttle without acknowledging (web <c>stampShown</c>, fired when the modal opens).
    /// </summary>
    public void StampShown()
    {
        _store.SetLastShownAt(_clock());
        RaiseAutoShowState();
    }

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
        _state is ChangelogModalState.Loaded or ChangelogModalState.Stale or ChangelogModalState.Offline;

    private void Apply(RepositoryResult<ChangelogReading> result)
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
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReading(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReading(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReading(
        ChangelogReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _latestVersion = reading.LatestVersion;
        Display = ChangelogModalProjection.Project(reading, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? ChangelogModalState.Offline
            : stale ? ChangelogModalState.Stale : ChangelogModalState.Loaded;
        RaiseAutoShowState();
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = ChangelogModalState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ChangelogModalState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ChangelogModalState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "common.offline",
            _ => "common.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "Offline",
            _ => "Something went wrong",
        };

        return _localizer.GetString(key, fallback);
    }

    private void RaiseAutoShowState()
    {
        Raise(nameof(HasUnseen));
        Raise(nameof(CanAutoShow));
        Raise(nameof(ShouldAutoShow));
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
