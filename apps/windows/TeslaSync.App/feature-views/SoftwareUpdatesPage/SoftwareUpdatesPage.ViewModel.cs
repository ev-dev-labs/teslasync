using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SoftwareUpdatesPage"/> view — the native port of
/// the web page's hook composition (web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx). It
/// consumes the cache-then-network <see cref="ISoftwareUpdatesSource"/>, projects each snapshot through
/// <see cref="SoftwareUpdatesProjection"/> against the injected clock, and exposes the mutually-exclusive
/// <see cref="State"/> (loading / loaded / empty / error) plus the in-flight flag so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SoftwareUpdatesPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISoftwareUpdatesSource _source;
    private readonly ILocalizer _localizer;
    private readonly SoftwareUpdatesDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SoftwareUpdatesState _state = SoftwareUpdatesState.Loading;
    private SoftwareUpdatesDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, clock and diagnostics.</summary>
    /// <param name="source">The cache-then-network software-updates source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="clock">The clock the relative dates are projected against; null = <see cref="DateTimeOffset.Now"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SoftwareUpdatesPageViewModel(
        ISoftwareUpdatesSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SoftwareUpdatesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SoftwareUpdatesDiagnostics();
        _display = SoftwareUpdatesProjection.Project(
            SoftwareUpdatesSnapshot.Empty, SoftwareUpdatesState.Loading, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public SoftwareUpdatesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public SoftwareUpdatesDisplay Display
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

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The localized document/window title (web <c>softwareUpdates.title</c>).</summary>
    public string Title => SoftwareUpdatesRegistration.Title(_localizer);

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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
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

    private bool HasContent() => _state is SoftwareUpdatesState.Loaded or SoftwareUpdatesState.Empty;

    private void Apply(RepositoryResult<SoftwareUpdatesSnapshot> result)
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
                SetEmpty(result.Value ?? SoftwareUpdatesSnapshot.Empty);
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplySnapshot(SoftwareUpdatesSnapshot snapshot, bool fetching)
    {
        if (!snapshot.HasData)
        {
            SetEmpty(snapshot);
            return;
        }

        IsFetching = fetching;
        State = SoftwareUpdatesState.Loaded;
        Display = SoftwareUpdatesProjection.Project(snapshot, SoftwareUpdatesState.Loaded, _localizer, _clock());
    }

    private void SetLoading()
    {
        IsFetching = false;
        State = SoftwareUpdatesState.Loading;
        Display = SoftwareUpdatesProjection.Project(SoftwareUpdatesSnapshot.Empty, SoftwareUpdatesState.Loading, _localizer, _clock());
    }

    private void SetEmpty(SoftwareUpdatesSnapshot snapshot)
    {
        IsFetching = false;
        State = SoftwareUpdatesState.Empty;
        Display = SoftwareUpdatesProjection.Project(snapshot, SoftwareUpdatesState.Empty, _localizer, _clock());
    }

    private void SetError()
    {
        IsFetching = false;
        State = SoftwareUpdatesState.Error;
        Display = SoftwareUpdatesProjection.Project(SoftwareUpdatesSnapshot.Empty, SoftwareUpdatesState.Error, _localizer, _clock());
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
