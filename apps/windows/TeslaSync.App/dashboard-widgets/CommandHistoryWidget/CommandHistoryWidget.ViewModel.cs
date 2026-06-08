using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="CommandHistoryViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed command-log snapshots for
/// <c>GET /vehicles/{vehicleID}/commands/history</c> — the native analogue of the web
/// <c>useCommandHistory</c> hook (scoped to the primary or explicit vehicle, exactly as the web component
/// resolves <c>vehicleId ?? vehicles?.[0]?.id</c>). The view never performs HTTP itself; the concrete
/// <see cref="CommandHistorySource"/> (or a test fake) drives this.
/// </summary>
public interface ICommandHistorySource
{
    /// <summary>Stream the cache-then-network command-log snapshots.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<CommandLogEntry>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Command History surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/commands.ts. The dashboard grid system binds this
/// surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class CommandHistoryRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "command-history";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "commands";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CommandHistoryWidget";

    /// <summary>The page-size the web hook requests (<c>…/commands/history?limit=200</c>).</summary>
    public const int DefaultLimit = 200;

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static CommandHistorySize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static CommandHistorySize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static CommandHistorySize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Command History").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.commandHistory", "Command History");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.commandHistory.description",
            "Recent vehicle commands: lock, unlock, climate \u2014 with success/fail status");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(CommandHistorySize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static CommandHistorySize Clamp(CommandHistorySize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Command History surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a command name, status, VIN, or
/// vehicle id — so a diagnostics line can never leak what a driver did to their car. Thread-safe.
/// </summary>
public sealed class CommandHistoryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CommandHistoryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandHistoryWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CommandHistoryRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CommandHistoryWidget"/> view — the native
/// port of the web <c>CommandHistoryWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/CommandHistoryWidget.tsx). It consumes the cache-then-network
/// <see cref="ICommandHistorySource"/>, projects each snapshot through
/// <see cref="CommandHistoryProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. Faithful to the web component, a fetch failure
/// never replaces the body: it flips <see cref="IsError"/> (the header "Error" chip) and leaves the feed
/// or empty state visible, with the refresh button as the retry affordance. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CommandHistoryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICommandHistorySource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CommandHistorySize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<CommandLogEntry>>? _last;
    private IReadOnlyList<CommandLogEntry> _value = Array.Empty<CommandLogEntry>();
    private bool _disposed;

    private CommandHistoryState _state = CommandHistoryState.Loading;
    private CommandHistoryDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public CommandHistoryViewModel(
        ICommandHistorySource source,
        ILocalizer localizer,
        CommandHistorySize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = CommandHistoryProjection.Project(_value, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public CommandHistoryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (feed rows + compact last-command chip).</summary>
    public CommandHistoryDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasItems));
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

    /// <summary>True when the last load failed (drives the header error chip; never replaces the body).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown rows are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when there is at least one command row to render.</summary>
    public bool HasItems => _display.HasItems;

    /// <summary>Localized widget title (web <c>widget.commandHistory</c>).</summary>
    public string Title => CommandHistoryRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noCommands</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noCommands", "No commands sent");

    /// <summary>The widget footprint; reassigning re-projects the current rows for the new layout.</summary>
    public CommandHistorySize Size
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
        _state is CommandHistoryState.Loaded or CommandHistoryState.Stale or CommandHistoryState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<CommandLogEntry>> result)
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
                ApplyValue(result.Value!, result.FetchedAt, result.IsStale, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplyValue(result.Value!, result.FetchedAt, result.IsStale, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplyValue(result.Value!, result.FetchedAt, stale: false, fetching: false);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyValue(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true);
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplyValue(
        IReadOnlyList<CommandLogEntry> value,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline = false)
    {
        _value = value;
        Display = CommandHistoryProjection.Project(_value, _size, _localizer, _clock());

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        State = offline
            ? CommandHistoryState.Offline
            : !Display.HasItems
                ? CommandHistoryState.Empty
                : stale
                    ? CommandHistoryState.Stale
                    : CommandHistoryState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true })
        {
            Display = CommandHistoryProjection.Project(_value, _size, _localizer, _clock());
        }
        else
        {
            Display = CommandHistoryProjection.Project(Array.Empty<CommandLogEntry>(), _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        State = CommandHistoryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _value = Array.Empty<CommandLogEntry>();
        Display = CommandHistoryProjection.Project(_value, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        State = CommandHistoryState.Empty;
    }

    private void SetError()
    {
        // Web parity: an error never replaces the body — it flips the header "Error" chip and leaves the
        // current rows (or the friendly empty state) visible, with the refresh button as the retry path.
        IsFetching = false;
        IsStale = false;
        IsError = true;
        State = CommandHistoryState.Error;
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
