using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="CommandQuickActionsViewModel"/> binds to for the vehicle it commands (P1/S8
/// state-holder seam). It yields the cache-then-network sequence that resolves the primary (or explicit)
/// vehicle from <c>GET /vehicles</c> — the native analogue of the web <c>useVehicles</c> hook that both
/// resolves <c>vehicleId ?? vehicles?.[0]?.id</c> and drives the <c>WidgetShell</c> freshness chrome. The
/// view never performs HTTP itself; the concrete <see cref="CommandQuickActionsSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface ICommandQuickActionsSource
{
    /// <summary>Stream the cache-then-network vehicle resolution, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<CommandQuickActionsReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The command-mutation port the <see cref="CommandQuickActionsViewModel"/> fires a quick action through
/// (P1/S8 state-holder seam) — the native analogue of the web <c>useVehicleCommand</c> mutation
/// (<c>POST /vehicles/{id}/command</c>). The view never performs HTTP itself; the concrete
/// <see cref="VehicleCommandSender"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleCommandSender
{
    /// <summary>Send <paramref name="command"/> to <paramref name="vehicleId"/> and return the parsed result.</summary>
    Task<CommandResult> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Quick Actions surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/commands.ts (<c>command-quick-actions</c>). The dashboard
/// grid system binds this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class CommandQuickActionsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "command-quick-actions";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "commands";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CommandQuickActionsWidget";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static CommandQuickActionsSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static CommandQuickActionsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static CommandQuickActionsSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Quick Actions").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.quickActions.name", "Quick Actions");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.quickActions.description",
            "Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(CommandQuickActionsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static CommandQuickActionsSize Clamp(CommandQuickActionsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Quick Actions surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, VIN, command name or
/// command outcome — so a diagnostics line can never leak fleet data or a control action. Thread-safe.
/// </summary>
public sealed class CommandQuickActionsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CommandQuickActionsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CommandQuickActionsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CommandQuickActionsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CommandQuickActionsWidget"/> view — the native
/// port of the web <c>CommandQuickActionsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx). It consumes the cache-then-network
/// <see cref="ICommandQuickActionsSource"/> to resolve the vehicle the grid commands (and to drive the
/// freshness chrome), projects the size-driven command tiles through <see cref="CommandQuickActionsProjection"/>,
/// and fires each tile through the <see cref="IVehicleCommandSender"/> mutation while tracking the single
/// <see cref="ActiveCommand"/> so the view can spin that tile and disable the whole grid (web
/// <c>disabled={!!activeCommand}</c>). The mutually-exclusive <see cref="State"/> plus the freshness flags
/// make the view a thin renderer. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class CommandQuickActionsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICommandQuickActionsSource _source;
    private readonly IVehicleCommandSender _commandSender;
    private readonly ILocalizer _localizer;

    private CommandQuickActionsSize _size;
    private CancellationTokenSource? _cts;
    private CancellationTokenSource? _commandCts;
    private RepositoryResult<CommandQuickActionsReading>? _last;
    private bool _disposed;

    private CommandQuickActionsState _state = CommandQuickActionsState.Loading;
    private CommandQuickActionsReading? _reading;
    private CommandQuickActionsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;
    private string? _activeCommand;
    private string? _lastCommandAnnouncement;

    /// <summary>Creates the holder over its data source, command sender, localizer and footprint.</summary>
    /// <param name="source">The cache-then-network vehicle-resolution source.</param>
    /// <param name="commandSender">The command-mutation port (web <c>useVehicleCommand</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the compact / wide branch + the command slice).</param>
    public CommandQuickActionsViewModel(
        ICommandQuickActionsSource source,
        IVehicleCommandSender commandSender,
        ILocalizer localizer,
        CommandQuickActionsSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commandSender);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _commandSender = commandSender;
        _localizer = localizer;
        _size = size;
        _display = CommandQuickActionsProjection.Project(size, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (derived from the vehicles read).</summary>
    public CommandQuickActionsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The resolved vehicle (null until a vehicle resolves; null in the empty/error/loading states).</summary>
    public CommandQuickActionsReading? Reading
    {
        get => _reading;
        private set
        {
            _reading = value;
            Raise(nameof(Reading));
            Raise(nameof(VehicleId));
            Raise(nameof(HasVehicle));
        }
    }

    /// <summary>The projected, render-ready command grid (size-driven; always present).</summary>
    public CommandQuickActionsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(VisibleCommands));
        }
    }

    /// <summary>The visible command tiles for the current footprint.</summary>
    public IReadOnlyList<CommandTile> VisibleCommands => _display.Tiles;

    /// <summary>The resolved vehicle id, or 0 when none (web <c>id</c>).</summary>
    public long VehicleId => _reading?.VehicleId ?? 0;

    /// <summary>True when a vehicle is resolved and the grid is enabled (web truthy <c>id</c>).</summary>
    public bool HasVehicle => VehicleId > 0;

    /// <summary>The command currently in flight, or null (web <c>activeCommand</c>).</summary>
    public string? ActiveCommand
    {
        get => _activeCommand;
        private set
        {
            if (string.Equals(_activeCommand, value, StringComparison.Ordinal))
            {
                return;
            }

            _activeCommand = value;
            Raise(nameof(ActiveCommand));
            Raise(nameof(IsBusy));
        }
    }

    /// <summary>True while any command is in flight — disables the whole grid (web <c>disabled={!!activeCommand}</c>).</summary>
    public bool IsBusy => _activeCommand is not null;

    /// <summary>The last command outcome message for the accessibility live region (null until a command settles).</summary>
    public string? LastCommandAnnouncement
    {
        get => _lastCommandAnnouncement;
        private set => Set(ref _lastCommandAnnouncement, value);
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

    /// <summary>True when the last vehicles load failed (drives the freshness "Error" chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown vehicle list is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline chip.</summary>
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

    /// <summary>True for the compact branch — icon-only tiles, no header (web <c>isCompact</c>).</summary>
    public bool IsCompact => _size.IsCompact;

    /// <summary>True for the wide branch — all eight commands (web <c>isWide</c>).</summary>
    public bool IsWide => _size.IsWide;

    /// <summary>Whether the header (title + icon) is shown (web shows it only when not compact).</summary>
    public bool ShowHeader => !_size.IsCompact;

    /// <summary>Localized widget title (web <c>widget.quickActions.title</c> "Quick Actions").</summary>
    public string Title => _localizer.GetString("widget.quickActions.title", "Quick Actions");

    /// <summary>Localized empty-state message (web <c>widget.quickActions.noVehicle</c> "No vehicle selected").</summary>
    public string EmptyMessage => _localizer.GetString("widget.quickActions.noVehicle", "No vehicle selected");

    /// <summary>Localized refresh-button Narrator name.</summary>
    public string RefreshLabel => _localizer.GetString("widget.quickActions.refresh", "Refresh quick actions");

    /// <summary>Localized loading Narrator name for the skeleton.</summary>
    public string LoadingLabel => _localizer.GetString("widget.quickActions.loading", "Loading quick actions");

    /// <summary>
    /// The widget footprint. The command tiles are re-projected on reassignment so the grid re-renders
    /// (compact ⇄ wide ⇄ default) and the visible-command slice updates.
    /// </summary>
    public CommandQuickActionsSize Size
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
            Raise(nameof(IsCompact));
            Raise(nameof(IsWide));
            Raise(nameof(ShowHeader));
            Display = CommandQuickActionsProjection.Project(_size, _localizer);
        }
    }

    /// <summary>
    /// Run a cache-then-network load of the vehicle the grid commands: counts the attempt, shows the
    /// skeleton only when nothing is already visible (otherwise keeps the grid while refreshing), and folds
    /// every emission into <see cref="State"/> + <see cref="Reading"/>. A superseding load cancels the prior one.
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

    /// <summary>True when <paramref name="command"/> can be fired now (a vehicle is resolved and no command is in flight).</summary>
    public bool CanExecute(string command) =>
        !string.IsNullOrEmpty(command) && HasVehicle && !IsBusy;

    /// <summary>
    /// Fire a quick-action command — the native port of the web <c>handleCommand</c>: no-ops without a
    /// resolved vehicle or while another command runs (web <c>if (!id) return</c> + <c>disabled</c>), marks
    /// the tile active (so the view spins it and disables the grid), sends it through the mutation port, and
    /// — like the web <c>onSettled</c> — clears the active tile on both success and failure, announcing the
    /// outcome to the accessibility live region.
    /// </summary>
    public async Task ExecuteCommandAsync(string command, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);
        if (!HasVehicle || IsBusy)
        {
            return;
        }

        long vehicleId = VehicleId;
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _commandCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        ActiveCommand = command;
        LastCommandAnnouncement = null;
        try
        {
            var result = await _commandSender.SendAsync(vehicleId, command, cts.Token).ConfigureAwait(false);
            LastCommandAnnouncement = AnnouncementFor(result);
        }
        catch (OperationCanceledException)
        {
            // Superseded or disposed — drop silently (no settle announcement).
        }
        catch (Exception ex)
        {
            LastCommandAnnouncement = CommandFailedText(ApiErrorMapper.Map(ex));
        }
        finally
        {
            if (ReferenceEquals(Volatile.Read(ref _commandCts), cts))
            {
                ActiveCommand = null;
                Interlocked.CompareExchange(ref _commandCts, null, cts);
                cts.Dispose();
            }
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
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        var commandCts = Interlocked.Exchange(ref _commandCts, null);
        commandCts?.Cancel();
        commandCts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is CommandQuickActionsState.Loaded or CommandQuickActionsState.Stale or CommandQuickActionsState.Offline;

    private void Apply(RepositoryResult<CommandQuickActionsReading> result)
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
        CommandQuickActionsReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Reading = reading;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? CommandQuickActionsState.Offline
            : stale ? CommandQuickActionsState.Stale : CommandQuickActionsState.Loaded;
    }

    private void SetLoading()
    {
        Reading = null;
        IsError = false;
        ErrorMessage = null;
        State = CommandQuickActionsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Reading = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = CommandQuickActionsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Reading = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = CommandQuickActionsState.Error;
    }

    private string AnnouncementFor(CommandResult result) =>
        result.Success
            ? (string.IsNullOrEmpty(result.Message)
                ? _localizer.GetString("widget.quickActions.commandSent", "Command sent successfully")
                : result.Message)
            : (string.IsNullOrEmpty(result.Message)
                ? _localizer.GetString("widget.quickActions.commandFailed", "Command failed")
                : result.Message);

    private string CommandFailedText(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.quickActions.commandFailed.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.quickActions.commandFailed.offline",
            _ => "widget.quickActions.commandFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Reconnect Tesla to send commands",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — command not sent",
            _ => "Command failed",
        };

        return _localizer.GetString(key, fallback);
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.quickActions.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.quickActions.error.offline",
            _ => "widget.quickActions.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view vehicles",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached vehicles",
            _ => "Couldn't load vehicles",
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
