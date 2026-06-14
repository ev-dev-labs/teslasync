using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// A localized transient message for the toast surface — the native analogue of the web <c>useToast</c>
/// <c>toast.success</c> / <c>toast.error</c> calls the page raises after an append or resolve. <see cref="IsError"/>
/// selects the error vs. success presentation.
/// </summary>
public sealed record IncidentTimelineToast(string Message, bool IsError);

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="IncidentTimelinePage"/> view — the native port of the
/// web page's data flow (web/src/features/system/pages/IncidentTimelinePage.tsx). It reads one incident through
/// the injected <see cref="IIncidentTimelineSource"/> (the native <c>useIncident</c> hook), owns the two write
/// flows (<c>useAppendIncidentUpdate</c> + <c>usePatchIncident</c>) behind the same client-side guards the web
/// applies (a non-empty message; resolve via <c>{ resolved: true }</c>), holds the two editable form fields (the
/// web <c>message</c> / <c>nextStatus</c> <c>useState</c> values), and projects everything through
/// <see cref="IncidentTimelineProjection"/> so the view is a thin renderer. Toast + close feedback flows through
/// <see cref="ToastRequested"/> exactly like the web <c>useToast</c> path. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class IncidentTimelinePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IIncidentTimelineSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly IncidentTimelineDiagnostics _diagnostics;
    private readonly long _incidentId;
    private readonly CancellationTokenSource _lifetime = new();

    private CancellationTokenSource? _readCts;
    private bool _disposed;

    private IncidentDetail? _incident;
    private bool _loading = true;
    private RepositoryError? _error;

    private string _message = string.Empty;
    private IncidentStatus? _nextStatus;
    private bool _isAppending;
    private bool _isResolving;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    private IncidentTimelineState _state = IncidentTimelineState.Loading;
    private IncidentTimelineDisplay _display;

    /// <summary>Creates the holder over its data port, localizer, route incident id and (optional) clock / diagnostics.</summary>
    /// <param name="source">The three-hook incident data port (web <c>useIncident</c> + the two mutations).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="incidentId">The incident id from the route (web <c>:id</c> param).</param>
    /// <param name="clock">Injectable clock for deterministic freshness / date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public IncidentTimelinePageViewModel(
        IIncidentTimelineSource source,
        ILocalizer localizer,
        long incidentId,
        Func<DateTimeOffset>? clock = null,
        IncidentTimelineDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _incidentId = incidentId;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new IncidentTimelineDiagnostics();
        _display = IncidentTimelineProjection.Project(BuildModel(), _localizer, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized message for the toast surface (web <c>useToast</c> success / error).</summary>
    public event EventHandler<IncidentTimelineToast>? ToastRequested;

    /// <summary>The current top-level data state (loading / not-found / ready).</summary>
    public IncidentTimelineState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public IncidentTimelineDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _error is not null;

    /// <summary>Last successful read timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The incident id this holder is bound to (web <c>:id</c> param).</summary>
    public long IncidentId => _incidentId;

    /// <summary>The append-form message text (web <c>message</c> useState). Editing never re-projects.</summary>
    public string Message
    {
        get => _message;
        set => Set(ref _message, value ?? string.Empty);
    }

    /// <summary>The append-form status change (web <c>nextStatus</c> useState); null keeps the current status.</summary>
    public IncidentStatus? NextStatus
    {
        get => _nextStatus;
        set => Set(ref _nextStatus, value);
    }

    /// <summary>True while the append mutation is in flight (web <c>appendUpdate.isPending</c>): the Add button is busy.</summary>
    public bool IsAppending
    {
        get => _isAppending;
        private set => Set(ref _isAppending, value);
    }

    /// <summary>True while the resolve mutation is in flight (web <c>patch.isPending</c>): the Resolve button is busy.</summary>
    public bool IsResolving
    {
        get => _isResolving;
        private set => Set(ref _isResolving, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the incident read and fold the result into the data state (web <c>useIncident</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        var cts = Supersede(ref _readCts, cancellationToken);

        IsFetching = true;
        if (_incident is null)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var fetch = await _source.FetchAsync(_incidentId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            ApplyFetch(fetch);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <summary>Refresh the incident (web query refetch / the post-mutation invalidation).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Append a timeline update (web <c>handleAppend</c>). An empty trimmed message surfaces the validation toast
    /// without writing; otherwise the append mutation runs, a success clears the form, applies the refreshed
    /// incident and raises the success toast, and a failure raises the error toast. Returns true only when an
    /// update was appended.
    /// </summary>
    public async Task<bool> AppendUpdateAsync(CancellationToken cancellationToken = default)
    {
        if (_isAppending || _disposed || _incident is null)
        {
            return false;
        }

        string message = (_message ?? string.Empty).Trim();
        if (message.Length == 0)
        {
            RaiseToast(IncidentTimelineStrings.MessageRequired, "Update message is required.", isError: true);
            return false;
        }

        IsAppending = true;
        Reproject();
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, cancellationToken);
        try
        {
            string? status = _nextStatus is { } next ? IncidentStatuses.ToWire(next) : null;
            var outcome = await _source
                .AppendUpdateAsync(_incidentId, new AppendIncidentUpdateRequest(message, status), linked.Token)
                .ConfigureAwait(false);

            if (outcome.Success)
            {
                _diagnostics.RecordUpdateAppended();
                _message = string.Empty;
                _nextStatus = null;
                Raise(nameof(Message));
                Raise(nameof(NextStatus));
                ApplyMutationResult(outcome.Incident);
                RaiseToast(IncidentTimelineStrings.UpdateAdded, "Update added.", isError: false);
                return true;
            }

            RaiseToast(IncidentTimelineStrings.AppendFailed, "Failed to append update", isError: true);
            return false;
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — leave the form as-is (web no-ops on an aborted mutation).
            return false;
        }
        finally
        {
            IsAppending = false;
            Reproject();
        }
    }

    /// <summary>
    /// Resolve the incident (web <c>handleResolve</c>): PATCH <c>{ resolved: true }</c>. A success applies the
    /// refreshed incident and raises the success toast; a failure raises the error toast. Returns true only when
    /// the incident was resolved.
    /// </summary>
    public async Task<bool> ResolveAsync(CancellationToken cancellationToken = default)
    {
        if (_isResolving || _disposed || _incident is null)
        {
            return false;
        }

        IsResolving = true;
        Reproject();
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token, cancellationToken);
        try
        {
            var outcome = await _source
                .PatchAsync(_incidentId, new PatchIncidentRequest(true), linked.Token)
                .ConfigureAwait(false);

            if (outcome.Success)
            {
                _diagnostics.RecordIncidentResolved();
                ApplyMutationResult(outcome.Incident);
                RaiseToast(IncidentTimelineStrings.IncidentResolved, "Incident resolved.", isError: false);
                return true;
            }

            RaiseToast(IncidentTimelineStrings.ResolveFailed, "Failed to resolve", isError: true);
            return false;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        finally
        {
            IsResolving = false;
            Reproject();
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
        Cancel(ref _readCts);
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    private void ApplyFetch(IncidentTimelineFetch fetch)
    {
        if (fetch.Incident is { } incident)
        {
            _incident = incident;
            _error = null;
            _loading = false;
            _updatedAt = _clock();
        }
        else
        {
            _error = fetch.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error");
            _loading = false;
        }
    }

    private void ApplyMutationResult(IncidentDetail? incident)
    {
        if (incident is not null)
        {
            _incident = incident;
            _error = null;
            _loading = false;
            _updatedAt = _clock();
            UpdatedAt = _updatedAt;
        }
    }

    private IncidentTimelineModel BuildModel() => new(_incident, _loading, _error, _incidentId);

    private void Reproject()
    {
        var display = IncidentTimelineProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
        Raise(nameof(IsError));
    }

    private void RaiseToast(string key, string fallback, bool isError) =>
        ToastRequested?.Invoke(this, new IncidentTimelineToast(_localizer.GetString(key, fallback), isError));

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
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
