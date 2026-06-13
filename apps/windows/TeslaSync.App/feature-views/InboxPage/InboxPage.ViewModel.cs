using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="InboxPage"/> view — the native port of the web
/// page's hook composition (web/src/features/notifications/pages/InboxPage.tsx). It owns the two auxiliary
/// reads the web page performs — <c>useVehicles()</c> and <c>useAlertRules()</c> — over the cache-then-network
/// <see cref="IInboxPageSource"/>, exposing each read's lifecycle status plus the folded
/// <see cref="InboxPageState"/> (loading / loaded / empty / error) and the three ported header strings. The web
/// page defaults both queries to <c>[]</c> and renders the inbox unconditionally, so this state never hides the
/// body; it is the page-owned contract surfaced for diagnostics, the freshness affordance and tests. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class InboxPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IInboxPageSource _source;
    private readonly ILocalizer _localizer;
    private readonly InboxPageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private LoadStatus _vehiclesStatus = LoadStatus.Loading;
    private LoadStatus _alertRulesStatus = LoadStatus.Loading;
    private IReadOnlyList<InboxPageVehicle> _vehicles = Array.Empty<InboxPageVehicle>();
    private IReadOnlyList<InboxPageAlertRule> _alertRules = Array.Empty<InboxPageAlertRule>();
    private InboxPageState _state = InboxPageState.Loading;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and diagnostics.</summary>
    /// <param name="source">The cache-then-network vehicles + alert-rules source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public InboxPageViewModel(
        IInboxPageSource source,
        ILocalizer localizer,
        InboxPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new InboxPageDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The localized page title (web <c>notifications.inbox.title</c> → "Inbox").</summary>
    public string Title => InboxPageRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>notifications.inbox.subtitle</c>).</summary>
    public string Subtitle => InboxPageRegistration.Subtitle(_localizer);

    /// <summary>The localized "View archived" header-action label (web <c>notifications.inbox.viewArchived</c>).</summary>
    public string ViewArchivedLabel => InboxPageRegistration.ViewArchivedLabel(_localizer);

    /// <summary>The Narrator name for the page (the localized title).</summary>
    public string AutomationName => Title;

    /// <summary>The folded data state of the two auxiliary reads. Never hides the body (web renders <c>[]</c>).</summary>
    public InboxPageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The latest lifecycle status of the vehicles read (web <c>useVehicles</c>).</summary>
    public LoadStatus VehiclesStatus
    {
        get => _vehiclesStatus;
        private set => Set(ref _vehiclesStatus, value);
    }

    /// <summary>The latest lifecycle status of the alert-rules read (web <c>useAlertRules</c>).</summary>
    public LoadStatus AlertRulesStatus
    {
        get => _alertRulesStatus;
        private set => Set(ref _alertRulesStatus, value);
    }

    /// <summary>The fleet the page read (web <c>vehicles</c>); defaults to empty, as the web hook does.</summary>
    public IReadOnlyList<InboxPageVehicle> Vehicles
    {
        get => _vehicles;
        private set => Set(ref _vehicles, value);
    }

    /// <summary>The alert rules the page read (web <c>rules</c>); defaults to empty, as the web hook does.</summary>
    public IReadOnlyList<InboxPageAlertRule> AlertRules
    {
        get => _alertRules;
        private set => Set(ref _alertRules, value);
    }

    /// <summary>True while at least one read is refreshing behind already-visible content.</summary>
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

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run the page's two cache-then-network reads (web's <c>useVehicles</c> + <c>useAlertRules</c> queries),
    /// folding every emission into the per-read status, the read lists and the combined <see cref="State"/>.
    /// The reads are consumed on a single confinement (newest first per read); a superseding load cancels the
    /// prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when both cache-then-network sequences are exhausted.</returns>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;

        try
        {
            await foreach (var result in _source.StreamVehiclesAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyVehicles(result);
            }

            await foreach (var result in _source.StreamAlertRulesAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyAlertRules(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this attempt silently.
        }
    }

    /// <summary>Retry after a failure — re-runs both reads from the top.</summary>
    /// <returns>A task that completes when the retried sequences are exhausted.</returns>
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

    private void ApplyVehicles(RepositoryResult<IReadOnlyList<InboxPageVehicle>> result)
    {
        VehiclesStatus = result.Status;
        if (result.Value is { } vehicles)
        {
            Vehicles = vehicles;
        }

        RecomputeState();
    }

    private void ApplyAlertRules(RepositoryResult<IReadOnlyList<InboxPageAlertRule>> result)
    {
        AlertRulesStatus = result.Status;
        if (result.Value is { } rules)
        {
            AlertRules = rules;
        }

        RecomputeState();
    }

    private void RecomputeState()
    {
        ReadOutcome vehicles = Classify(_vehiclesStatus, _vehicles.Count);
        ReadOutcome rules = Classify(_alertRulesStatus, _alertRules.Count);

        if (vehicles == ReadOutcome.Pending || rules == ReadOutcome.Pending)
        {
            State = InboxPageState.Loading;
            IsFetching = false;
            return;
        }

        IsFetching = _vehiclesStatus is LoadStatus.Refreshing || _alertRulesStatus is LoadStatus.Refreshing;

        if (vehicles == ReadOutcome.Error && rules == ReadOutcome.Error)
        {
            State = InboxPageState.Error;
        }
        else if (vehicles == ReadOutcome.Data || rules == ReadOutcome.Data)
        {
            State = InboxPageState.Loaded;
        }
        else
        {
            State = InboxPageState.Empty;
        }
    }

    private static ReadOutcome Classify(LoadStatus status, int count) => status switch
    {
        LoadStatus.Loading => ReadOutcome.Pending,
        LoadStatus.Error => ReadOutcome.Error,
        LoadStatus.Empty => ReadOutcome.Empty,
        _ => count > 0 ? ReadOutcome.Data : ReadOutcome.Empty,
    };

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

    private enum ReadOutcome
    {
        Pending,
        Data,
        Empty,
        Error,
    }
}
