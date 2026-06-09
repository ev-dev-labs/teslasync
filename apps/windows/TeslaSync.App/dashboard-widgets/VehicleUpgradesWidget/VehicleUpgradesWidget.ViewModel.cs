using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleUpgradesWidget"/> view — the native port
/// of the web component's hook composition (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx). It
/// consumes the cache-then-network <see cref="IVehicleUpgradesSource"/>, projects each snapshot through
/// <see cref="VehicleUpgradesProjection"/> with an injected clock (so the share-link countdown is
/// deterministic in tests), and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags
/// so the view is a thin renderer. Unlike a single-list widget the loaded body always renders BOTH the
/// "Available Upgrades" and "Share Links" sections — the <see cref="VehicleUpgradesState.Empty"/> state (no
/// vehicle / no payload) projects an empty snapshot into the same two-section body rather than a blank box.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class VehicleUpgradesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleUpgradesSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _now;

    private VehicleUpgradesSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<VehicleUpgradesSnapshot>? _last;
    private bool _disposed;

    private VehicleUpgradesState _state = VehicleUpgradesState.Loading;
    private VehicleUpgradesDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    /// <param name="source">The cache-then-network upgrades + share-links source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact / wide branches).</param>
    /// <param name="now">Clock for the share-link countdown; defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    public VehicleUpgradesViewModel(
        IVehicleUpgradesSource source,
        ILocalizer localizer,
        VehicleUpgradesSize size,
        Func<DateTimeOffset>? now = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _display = VehicleUpgradesProjection.Project(VehicleUpgradesSnapshot.None, _size, _now(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public VehicleUpgradesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (upgrade rows + share-link summary).</summary>
    public VehicleUpgradesDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasUpgrades));
            Raise(nameof(HasActiveShareLinks));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surface.</summary>
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

    /// <summary>True when at least one upgrade parsed (web <c>upgrades.length &gt; 0</c>).</summary>
    public bool HasUpgrades => _display.HasUpgrades;

    /// <summary>True when at least one active share link parsed (web <c>activeShareLinks.length &gt; 0</c>).</summary>
    public bool HasActiveShareLinks => _display.HasActiveShareLinks;

    /// <summary>Localized widget title (web registry "Upgrades &amp; Sharing").</summary>
    public string Title => _localizer.GetString("widget.upgrades.title", "Upgrades & Sharing");

    /// <summary>Localized "available" caption under the compact eligible count.</summary>
    public string AvailableLabel => _localizer.GetString("widget.upgrades.available", "available");

    /// <summary>Localized "Up to date" badge shown compact when there are no upgrades.</summary>
    public string UpToDateLabel => _localizer.GetString("widget.upgrades.upToDate", "Up to date");

    /// <summary>Localized "Available Upgrades" section heading.</summary>
    public string UpgradesHeading => _localizer.GetString("widget.upgrades.upgradesHeading", "Available Upgrades");

    /// <summary>Localized "All upgrades applied" empty state shown when there are no upgrades.</summary>
    public string AllAppliedLabel => _localizer.GetString("widget.upgrades.allApplied", "All upgrades applied");

    /// <summary>Localized "Share Links" section heading.</summary>
    public string ShareLinksHeading => _localizer.GetString("widget.upgrades.shareLinksHeading", "Share Links");

    /// <summary>Localized "Active links" row label.</summary>
    public string ActiveLinksLabel => _localizer.GetString("widget.upgrades.activeLinks", "Active links");

    /// <summary>Localized "Nearest expiry" row label.</summary>
    public string NearestExpiryLabel => _localizer.GetString("widget.upgrades.nearestExpiry", "Nearest expiry");

    /// <summary>Localized "No active share links" empty-state message.</summary>
    public string NoShareLinksLabel => _localizer.GetString("widget.upgrades.noShareLinks", "No active share links");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public VehicleUpgradesSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
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

    /// <summary>Retry after a failure (or refresh on demand) — re-runs the load from the top.</summary>
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
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is VehicleUpgradesState.Loaded
            or VehicleUpgradesState.Empty
            or VehicleUpgradesState.Stale
            or VehicleUpgradesState.Offline;

    private void Apply(RepositoryResult<VehicleUpgradesSnapshot> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        VehicleUpgradesSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = VehicleUpgradesProjection.Project(snapshot, _size, _now(), _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: the two-section body always renders. A fetched-but-empty upgrades payload is still
        // Loaded (it shows the "All upgrades applied" + share-links empty states), preserving any share links;
        // only offline / stale freshness take precedence for the header chip.
        State = offline
            ? VehicleUpgradesState.Offline
            : stale
                ? VehicleUpgradesState.Stale
                : VehicleUpgradesState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last && last.Status is not LoadStatus.Loading and not LoadStatus.Error)
        {
            Apply(last);
        }
        else
        {
            Display = VehicleUpgradesProjection.Project(VehicleUpgradesSnapshot.None, _size, _now(), _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = VehicleUpgradesState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = VehicleUpgradesProjection.Project(VehicleUpgradesSnapshot.None, _size, _now(), _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VehicleUpgradesState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = VehicleUpgradesState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.upgrades.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.upgrades.error.offline",
            _ => "widget.upgrades.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view upgrades",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached upgrades",
            _ => "Couldn't load upgrades",
        };

        return _localizer.GetString(key, fallback);
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
