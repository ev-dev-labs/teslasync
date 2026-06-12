using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ReleaseNotes"/> view — the native port of the web
/// <c>ReleaseNotes</c> component body (web/src/components/feedback/ReleaseNotes.tsx L70-123). It consumes the
/// shared cache-then-network <see cref="IChangelogSource"/> (the same P1/S8 seam the sibling ChangelogModal
/// binds, the native analogue of the web generated <c>CHANGELOG</c> import), projects each reading through
/// <see cref="ReleaseNotesProjection"/> capped to <see cref="Limit"/>, exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer, and owns the single-expansion
/// accordion state (<see cref="ExpandedVersion"/>, web <c>expanded</c> useState initialised to the newest
/// release). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ReleaseNotesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChangelogSource _source;
    private readonly ILocalizer _localizer;
    private readonly int _limit;

    private CancellationTokenSource? _cts;
    private bool _expandedInitialized;
    private bool _disposed;

    private ReleaseNotesState _state = ReleaseNotesState.Loading;
    private ReleaseNotesDisplay? _display;
    private string? _expandedVersion;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and the newest-first release cap.</summary>
    /// <param name="source">The shared cache-then-network changelog source (web generated <c>CHANGELOG</c>).</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="limit">The maximum number of releases to render (web <c>limit</c>, default 3).</param>
    public ReleaseNotesViewModel(
        IChangelogSource source,
        ILocalizer localizer,
        int limit = ReleaseNotesRegistration.DefaultLimit)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _limit = Math.Max(0, limit);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>ReleaseNotes</c>).</summary>
    public static string Slug => ReleaseNotesRegistration.Slug;

    /// <summary>The newest-first release cap applied by the projection (web <c>limit</c>).</summary>
    public int Limit => _limit;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ReleaseNotesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready release list (null until a reading resolves, or on the empty surface).</summary>
    public ReleaseNotesDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>
    /// The single expanded release version, or <see langword="null"/> when every entry is collapsed (web
    /// <c>expanded</c>). Initialised once to the newest release when the first non-empty list resolves, then
    /// driven by user toggles — a refresh never resets a user's choice (mirrors the web useState initialiser).
    /// </summary>
    public string? ExpandedVersion
    {
        get => _expandedVersion;
        private set => Set(ref _expandedVersion, value);
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

    /// <summary>True when the shown list is backed by a read older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
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

    /// <summary>True when a reading resolved and the list is renderable.</summary>
    public bool HasData => _display is { HasEntries: true };

    /// <summary>The localized per-release "What's New" heading (web <c>changelog.releaseNotes.heading</c>).</summary>
    public string Heading => ReleaseNotesRegistration.Heading(_localizer);

    /// <summary>Localized empty-surface message.</summary>
    public string EmptyMessage =>
        _localizer.GetString(ReleaseNotesRegistration.EmptyKey, ReleaseNotesRegistration.EmptyFallback);

    /// <summary>Localized retry affordance label.</summary>
    public string RetryText =>
        _localizer.GetString(ReleaseNotesRegistration.RetryKey, ReleaseNotesRegistration.RetryFallback);

    /// <summary>Localized stale chip label.</summary>
    public string StaleText =>
        _localizer.GetString(ReleaseNotesRegistration.StaleKey, ReleaseNotesRegistration.StaleFallback);

    /// <summary>Localized offline chip label.</summary>
    public string OfflineText =>
        _localizer.GetString(ReleaseNotesRegistration.OfflineKey, ReleaseNotesRegistration.OfflineFallback);

    /// <summary>Localized loading announcement.</summary>
    public string LoadingText =>
        _localizer.GetString(ReleaseNotesRegistration.LoadingKey, ReleaseNotesRegistration.LoadingFallback);

    /// <summary>Whether <paramref name="version"/> is the currently expanded release.</summary>
    /// <param name="version">The release version to test.</param>
    public bool IsExpanded(string version) =>
        _expandedVersion is { } current && string.Equals(current, version, StringComparison.Ordinal);

    /// <summary>
    /// Set the single expanded release (web setting <c>expanded</c>), or clear it with <see langword="null"/>.
    /// Marks the expansion as initialised so the next reading does not override the user's choice.
    /// </summary>
    /// <param name="version">The release version to expand, or null to collapse all.</param>
    public void SetExpanded(string? version)
    {
        _expandedInitialized = true;
        ExpandedVersion = version;
    }

    /// <summary>
    /// Toggle a release open/closed (web <c>setExpanded(isExpanded ? null : release.version)</c>): opening one
    /// implicitly collapses any other because a single version is tracked.
    /// </summary>
    /// <param name="version">The release version whose header was activated.</param>
    public void ToggleExpanded(string version)
    {
        ArgumentNullException.ThrowIfNull(version);
        SetExpanded(IsExpanded(version) ? null : version);
    }

    /// <summary>
    /// Run a load: counts the attempt, shows the skeleton only when nothing is already visible (otherwise keeps
    /// the list while refreshing), and folds every emission into <see cref="State"/> + <see cref="Display"/>. A
    /// superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load.</param>
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
        _state is ReleaseNotesState.Loaded or ReleaseNotesState.Stale or ReleaseNotesState.Offline;

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
        var display = ReleaseNotesProjection.Project(reading, _limit, _localizer);
        Display = display;
        InitializeExpansion(display);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? ReleaseNotesState.Offline
            : stale ? ReleaseNotesState.Stale : ReleaseNotesState.Loaded;
    }

    // Web parity: the accordion's `expanded` useState is seeded once with releases[0].version and is never
    // reset by a re-render. Seed it the first time a non-empty list resolves; afterwards leave the user's
    // choice untouched even across refreshes.
    private void InitializeExpansion(ReleaseNotesDisplay display)
    {
        if (_expandedInitialized || !display.HasEntries)
        {
            return;
        }

        _expandedInitialized = true;
        ExpandedVersion = display.Entries[0].Version;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        IsFetching = true;
        State = ReleaseNotesState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = ReleaseNotesState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = ReleaseNotesState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network =>
                _localizer.GetString(ReleaseNotesRegistration.OfflineKey, ReleaseNotesRegistration.OfflineFallback),
            _ => _localizer.GetString(ReleaseNotesRegistration.ErrorKey, ReleaseNotesRegistration.ErrorFallback),
        };
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
