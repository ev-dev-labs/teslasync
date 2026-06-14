using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI notifications <c>AuditLogPage</c> view — the native port of the web
/// page's data flow (web/src/features/notifications/pages/AuditLogPage.tsx). It owns the fetched audit trail, the
/// controlled search string and the in-flight / error markers, reads the trail through the injected
/// <see cref="IAuditLogsFeed"/> and projects the result through <see cref="NotificationsAuditLogProjection"/> so the
/// view is a thin renderer. It surfaces the four web data states (loading / empty / error / success) plus an in-flight
/// flag; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class NotificationsAuditLogPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAuditLogsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly NotificationsAuditLogDiagnostics _diagnostics;

    private CancellationTokenSource? _listCts;
    private bool _disposed;

    private IReadOnlyList<AuditLogEntry> _entries = Array.Empty<AuditLogEntry>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private string _search = string.Empty;

    private NotificationsAuditLogState _state;
    private NotificationsAuditLogDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The audit-log data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public NotificationsAuditLogPageViewModel(
        IAuditLogsFeed feed,
        ILocalizer localizer,
        NotificationsAuditLogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new NotificationsAuditLogDiagnostics();
        _display = NotificationsAuditLogProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public NotificationsAuditLogState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public NotificationsAuditLogDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the list is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>t('Audit Log')</c>).</summary>
    public string Title => NotificationsAuditLogRegistration.Title(_localizer);

    /// <summary>The current controlled search string (web <c>search</c>).</summary>
    public string Search => _search;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the audit-trail load (web <c>useAuditLogs</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _listCts, cancellationToken);

        IsFetching = true;
        if (_entries.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var entries = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _entries = entries ?? Array.Empty<AuditLogEntry>();
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            _hasError = true;
            _errorDetail = ex.Message;
            _entries = Array.Empty<AuditLogEntry>();
            _loading = false;
        }

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the audit trail (web <c>refetch</c> / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the controlled search string and re-project (web <c>setSearch</c>); no reload.</summary>
    public void SetSearch(string value)
    {
        var next = value ?? string.Empty;
        if (string.Equals(_search, next, StringComparison.Ordinal))
        {
            return;
        }

        _search = next;
        Reproject();
    }

    /// <summary>Clear the search filter (web active-filter chip remove / clear-all).</summary>
    public void ClearSearch() => SetSearch(string.Empty);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _listCts);
    }

    private NotificationsAuditLogModel BuildModel() => new(_entries, _loading, _hasError, _errorDetail, _search);

    private void Reproject()
    {
        var display = NotificationsAuditLogProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
    }

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
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
