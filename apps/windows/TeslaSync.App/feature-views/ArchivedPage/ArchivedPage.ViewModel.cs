using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ArchivedPage"/> view — the native port of the web
/// page's hook composition (web/src/features/notifications/pages/ArchivedPage.tsx). It consumes the
/// cache-then-network <see cref="IArchivedContextSource"/> (the page's <c>useVehicles</c> + <c>useAlertRules</c>
/// reads), projects each emission through <see cref="ArchivedProjection"/>, and exposes the mutually-exclusive
/// <see cref="State"/> (loading / loaded / empty / error) plus the in-flight flag so the view is a thin
/// renderer. The three header literals are bound here too. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class ArchivedPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IArchivedContextSource _source;
    private readonly ILocalizer _localizer;
    private readonly ArchivedDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private RepositoryResult<ArchivedContext>? _last;
    private bool _disposed;

    private ArchivedContextState _state = ArchivedContextState.Loading;
    private ArchivedDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network vehicle + rule context source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ArchivedPageViewModel(
        IArchivedContextSource source,
        ILocalizer localizer,
        ArchivedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new ArchivedDiagnostics();
        _display = ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Loading, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive context lifecycle state.</summary>
    public ArchivedContextState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public ArchivedDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a background refresh is in flight (keeps the inbox visible while refreshing).</summary>
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

    /// <summary>The localized page title (web <c>notifications.archived.title</c>).</summary>
    public string Title => ArchivedRegistration.Title(_localizer);

    /// <summary>The localized page sub-heading (web <c>notifications.archived.subtitle</c>).</summary>
    public string Subtitle => ArchivedRegistration.Subtitle(_localizer);

    /// <summary>The localized back-to-inbox action label (web <c>notifications.archived.backToInbox</c>).</summary>
    public string BackToInboxText => ArchivedRegistration.BackToInbox(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the loading state only when nothing is already
    /// resolved (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
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

    private bool HasContent() => _state is ArchivedContextState.Loaded or ArchivedContextState.Empty;

    private void Apply(RepositoryResult<ArchivedContext> result)
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
                ApplyContext(result.Value!, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplyContext(result.Value!, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplyContext(result.Value!, fetching: false);
                break;

            case LoadStatus.Offline:
                ApplyContext(result.Value!, fetching: false);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.Value ?? ArchivedContext.Empty);
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplyContext(ArchivedContext context, bool fetching)
    {
        if (!context.HasData)
        {
            SetEmpty(context);
            return;
        }

        IsFetching = fetching;
        State = ArchivedContextState.Loaded;
        Display = ArchivedProjection.Project(context, ArchivedContextState.Loaded, _localizer);
    }

    private void SetLoading()
    {
        IsFetching = false;
        State = ArchivedContextState.Loading;
        Display = ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Loading, _localizer);
    }

    private void SetEmpty(ArchivedContext context)
    {
        IsFetching = false;
        State = ArchivedContextState.Empty;
        Display = ArchivedProjection.Project(context, ArchivedContextState.Empty, _localizer);
    }

    private void SetError()
    {
        IsFetching = false;
        State = ArchivedContextState.Error;
        Display = ArchivedProjection.Project(ArchivedContext.Empty, ArchivedContextState.Error, _localizer);
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
