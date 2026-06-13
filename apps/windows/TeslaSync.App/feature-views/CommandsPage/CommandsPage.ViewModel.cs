using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Commands;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CommandsPage"/> view — the native port of the web
/// page's hook composition (web/src/features/system/pages/CommandsPage.tsx). It consumes the cache-then-network
/// <see cref="ICommandsSource"/>, projects each snapshot through <see cref="CommandsProjection"/> with the
/// active units, and exposes the mutually-exclusive <see cref="State"/> (loading / loaded / empty) plus the
/// in-flight flag so the view is a thin renderer. The non-fatal per-vehicle states-error surfaces through the
/// projected <see cref="CommandsDisplay.HasStatesError"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class CommandsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICommandsSource _source;
    private readonly ILocalizer _localizer;
    private readonly CommandsDiagnostics _diagnostics;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<CommandsSnapshot>? _last;
    private bool _disposed;

    private CommandsState _state = CommandsState.Loading;
    private CommandsDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units and diagnostics.</summary>
    /// <param name="source">The cache-then-network commands source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CommandsPageViewModel(
        ICommandsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        CommandsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new CommandsDiagnostics();
        _display = CommandsProjection.Project(CommandsSnapshot.Empty, CommandsState.Loading, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public CommandsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public CommandsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a background refresh is in flight (keeps content while refreshing).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>Number of load attempts started (including the 15-second refreshes and retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The localized document/nav title (web <c>commands.title</c>).</summary>
    public string Title => CommandsRegistration.Title(_localizer);

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            UnitPref resolved = value ?? UnitPref.Metric;
            if (_units == resolved)
            {
                return;
            }

            _units = resolved;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the cache-then-network sequence is exhausted.</returns>
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

    /// <summary>Retry / refresh — re-runs the load from the top (web 15s refetch + manual retry share this path).</summary>
    /// <returns>A task that completes when the refreshed load's sequence is exhausted.</returns>
    public Task RefreshAsync() => LoadAsync();

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

    private bool HasContent() => _state is CommandsState.Loaded or CommandsState.Empty;

    private void Apply(RepositoryResult<CommandsSnapshot> result)
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
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.Value ?? CommandsSnapshot.Empty);
                break;

            default:
                // The web page has no error boundary over useVehicles — a hard failure shows the empty state.
                SetEmpty(CommandsSnapshot.Empty);
                break;
        }
    }

    private void ApplySnapshot(CommandsSnapshot snapshot, bool fetching)
    {
        if (!snapshot.HasData)
        {
            SetEmpty(snapshot);
            return;
        }

        IsFetching = fetching;
        State = CommandsState.Loaded;
        Display = CommandsProjection.Project(snapshot, CommandsState.Loaded, _units, _localizer);
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last && last.Value!.HasData)
        {
            Display = CommandsProjection.Project(last.Value, _state, _units, _localizer);
        }
        else
        {
            Display = CommandsProjection.Project(CommandsSnapshot.Empty, _state, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsFetching = false;
        State = CommandsState.Loading;
        Display = CommandsProjection.Project(CommandsSnapshot.Empty, CommandsState.Loading, _units, _localizer);
    }

    private void SetEmpty(CommandsSnapshot snapshot)
    {
        IsFetching = false;
        State = CommandsState.Empty;
        Display = CommandsProjection.Project(snapshot, CommandsState.Empty, _units, _localizer);
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
