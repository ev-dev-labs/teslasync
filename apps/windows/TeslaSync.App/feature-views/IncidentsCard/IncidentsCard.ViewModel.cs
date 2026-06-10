using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="IncidentsCard"/> view — the native port of the web
/// IncidentsCard hook usage (web/src/features/system/components/status/IncidentsCard.tsx). It binds the shared
/// active-incidents seam (P1/S8), owns the cache-then-network read so the surface renders the full freshness
/// state matrix the P2 contract mandates (loading / loaded / empty / stale / offline / error), and projects every
/// change through <see cref="IncidentsProjection"/>. The log-incident and open-timeline affordances are pure
/// navigation/dialog intents surfaced by the view, so this holder is read-only. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class IncidentsCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IIncidentsSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IncidentsState _state = IncidentsState.Loading;
    private IncidentsDisplay _display;
    private IReadOnlyList<IncidentSummary> _incidents = Array.Empty<IncidentSummary>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the shared active-incidents seam and the i18n facade.</summary>
    /// <param name="source">The active-incidents cache-then-network source (web <c>useIncidents</c>).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public IncidentsCardViewModel(IIncidentsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive incidents-read freshness state.</summary>
    public IncidentsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (header + incident rows + empty copy).</summary>
    public IncidentsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>Last successful incidents-read timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background incidents refresh is in flight (the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown list is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the read failed with no cache (drives the error surface).</summary>
    public bool IsError => _state == IncidentsState.Error;

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of incidents-read attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The current active-incident list.</summary>
    public IReadOnlyList<IncidentSummary> Incidents => _incidents;

    /// <summary>
    /// Run a cache-then-network read of the active-incident list: counts the attempt, shows the skeleton only
    /// when nothing is already visible (otherwise keeps content while refreshing), and folds every emission into
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

    /// <summary>Retry after a failure — re-runs the incidents read from the top.</summary>
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
        _state is IncidentsState.Loaded or IncidentsState.Stale or IncidentsState.Offline or IncidentsState.Empty;

    private void Apply(RepositoryResult<IReadOnlyList<IncidentSummary>> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        IReadOnlyList<IncidentSummary> incidents,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _incidents = incidents;
        Raise(nameof(Incidents));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? IncidentsState.Offline
            : stale
                ? IncidentsState.Stale
                : IncidentsState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = IncidentsState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _incidents = Array.Empty<IncidentSummary>();
        Raise(nameof(Incidents));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = IncidentsState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = IncidentsState.Error;
        RaiseError();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => IncidentsStrings.ErrorAuth,
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => IncidentsStrings.ErrorOffline,
            _ => IncidentsStrings.ErrorLoad,
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view incidents",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved incidents",
            _ => "Couldn't load active incidents",
        };

        return _localizer.GetString(key, fallback);
    }

    private IncidentsDisplay Project() =>
        IncidentsProjection.Project(_incidents, _localizer, DateTimeOffset.Now);

    private void Reproject() => Display = Project();

    private void RaiseError() => Raise(nameof(IsError));

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
