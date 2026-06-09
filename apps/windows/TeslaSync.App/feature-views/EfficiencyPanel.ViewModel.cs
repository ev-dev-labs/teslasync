using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EfficiencyPanel"/> view — the native port of the
/// web Charging-Efficiency panel
/// (web/src/features/charging/components/charging-list/EfficiencyPanel.tsx). The web component is a pure child
/// of the charging-list page (it takes a pre-computed <c>stats</c>); the native surface binds its own
/// cache-then-network <see cref="IEfficiencyPanelSource"/>, projects each snapshot through
/// <see cref="EfficiencyPanelProjection"/> (which computes the efficiency statistics), and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. The four
/// efficiency tiles always render for the <see cref="EfficiencyPanelState.Loaded"/>,
/// <see cref="EfficiencyPanelState.Stale"/> and <see cref="EfficiencyPanelState.Offline"/> states; a friendly
/// empty state covers <see cref="EfficiencyPanelState.Empty"/> (web parity — no session carries efficiency
/// data). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EfficiencyPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEfficiencyPanelSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private EfficiencyPanelState _state = EfficiencyPanelState.Loading;
    private EfficiencyPanelDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    public EfficiencyPanelViewModel(
        IEfficiencyPanelSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = EfficiencyPanelDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public EfficiencyPanelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the four efficiency tiles + header).</summary>
    public EfficiencyPanelDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
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

    /// <summary>True when the projection produced efficiency statistics (web <c>computeEfficiencyStats</c> non-null).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title.</summary>
    public string Title => EfficiencyPanelRegistration.Name(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is EfficiencyPanelState.Loaded
            or EfficiencyPanelState.Stale
            or EfficiencyPanelState.Offline
            or EfficiencyPanelState.Empty;

    private void Apply(RepositoryResult<IReadOnlyList<EfficiencyPanelSession>> result)
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
        IReadOnlyList<EfficiencyPanelSession> data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = EfficiencyPanelProjection.Project(data, _localizer, _clock());
        Display = display;

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Freshness wins over emptiness so the stale/offline chip survives an empty snapshot, while a fresh
        // snapshot with no efficiency data is classified Empty (web parity — the friendly empty state).
        State = offline
            ? EfficiencyPanelState.Offline
            : stale
                ? EfficiencyPanelState.Stale
                : display.HasData
                    ? EfficiencyPanelState.Loaded
                    : EfficiencyPanelState.Empty;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = EfficiencyPanelState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = EfficiencyPanelDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = EfficiencyPanelState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EfficiencyPanelState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                "charging.efficiency.offline",
                "You're offline — showing the last cached charging efficiency"),
            _ => _localizer.GetString(
                "charging.efficiency.error", "Couldn't load charging efficiency"),
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
