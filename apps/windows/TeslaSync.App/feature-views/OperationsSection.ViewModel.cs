using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="OperationsSection"/> view — the native port of
/// the web component's hook composition
/// (web/src/features/system/components/status/OperationsSection.tsx). It drives the three independent
/// cache-then-network reads through the <see cref="IOperationsSectionSource"/> — the notification-delivery
/// rollup (web <c>getNotificationStats</c>), the recent delivery log (web <c>getNotificationLogs</c>) and
/// the audit trail (web <c>getAuditLogs</c>) — folds them into a single section state
/// (loading / loaded / empty / error / stale / offline, where the combined initial loading mirrors the web
/// <c>statsLoading || logsLoading || auditLoading</c>), projects them through
/// <see cref="OperationsSectionProjection"/>, and exposes the projected display plus freshness so the view
/// is a thin renderer. The three streams pump concurrently, so result application is serialised through a
/// gate; raise/observe it from the UI thread.
/// </summary>
public sealed class OperationsSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IOperationsSectionSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private bool _disposed;

    // Latest typed emission per read (drives freshness classification once all three settle).
    private RepositoryResult<OperationsNotificationStats> _statsResult = RepositoryResult<OperationsNotificationStats>.Loading();
    private RepositoryResult<IReadOnlyList<OperationsNotificationLog>> _logsResult = RepositoryResult<IReadOnlyList<OperationsNotificationLog>>.Loading();
    private RepositoryResult<IReadOnlyList<OperationsAuditEntry>> _auditResult = RepositoryResult<IReadOnlyList<OperationsAuditEntry>>.Loading();

    // Last good snapshot per read (kept across transient Loading emissions to avoid content flicker).
    private OperationsNotificationStats _stats = OperationsNotificationStats.Empty;
    private IReadOnlyList<OperationsNotificationLog> _logs = Array.Empty<OperationsNotificationLog>();
    private IReadOnlyList<OperationsAuditEntry> _audit = Array.Empty<OperationsAuditEntry>();

    // Sticky "this read produced its first result" flags — the native analogue of TanStack's isLoading
    // (true only until the first settle). The web skeleton shows while ANY of the three is still loading.
    private bool _statsResolved;
    private bool _logsResolved;
    private bool _auditResolved;

    private OperationsSectionState _state = OperationsSectionState.Loading;
    private OperationsSectionDisplay _display = OperationsSectionDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching = true;
    private bool _isError;
    private bool _isStale;
    private bool _isRefreshing;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    /// <param name="source">The three-read data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">An injectable clock (defaults to <see cref="DateTimeOffset.Now"/>).</param>
    public OperationsSectionViewModel(
        IOperationsSectionSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Section state ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The section's current lifecycle state (loading / loaded / empty / error / stale / offline).</summary>
    public OperationsSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (tiles, gauge, badge, rows).</summary>
    public OperationsSectionDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown content is stale or the read is offline (drives the freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown content is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a manual refresh + reload is running (drives the button spinner).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>Localized error message for the error/offline states (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries / refreshes).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Localized chrome (web t(...) keys) ───────────────────────────────────────────────────────────

    /// <summary>Section title (web <c>t('Operations')</c>).</summary>
    public string Title => OperationsSectionRegistration.Title(_localizer);

    /// <summary>Section description (web accordion description).</summary>
    public string Description => OperationsSectionRegistration.Description(_localizer);

    /// <summary>"Notification Delivery" sub-header (web <c>t('Notification Delivery')</c>).</summary>
    public string NotificationDeliveryTitle =>
        _localizer.GetString("featureView.operations.notificationDelivery", "Notification Delivery");

    /// <summary>"Audit Log" sub-header (web <c>t('Audit Log')</c>).</summary>
    public string AuditLogTitle => _localizer.GetString("featureView.operations.auditLog", "Audit Log");

    /// <summary>Delivery-log "Status" column header.</summary>
    public string StatusHeader => _localizer.GetString("featureView.operations.col.status", "Status");

    /// <summary>Delivery-log "Title" column header.</summary>
    public string TitleHeader => _localizer.GetString("featureView.operations.col.title", "Title");

    /// <summary>Delivery-log "Message" column header.</summary>
    public string MessageHeader => _localizer.GetString("featureView.operations.col.message", "Message");

    /// <summary>Shared "Time" column header.</summary>
    public string TimeHeader => _localizer.GetString("featureView.operations.col.time", "Time");

    /// <summary>Audit "Action" column header.</summary>
    public string ActionHeader => _localizer.GetString("featureView.operations.col.action", "Action");

    /// <summary>Audit "Resource" column header.</summary>
    public string ResourceHeader => _localizer.GetString("featureView.operations.col.resource", "Resource");

    /// <summary>Audit "Details" column header.</summary>
    public string DetailsHeader => _localizer.GetString("featureView.operations.col.details", "Details");

    /// <summary>Empty surface for the recent delivery table (web <c>t('common.noData', 'No data available')</c>).</summary>
    public string NoNotificationDataMessage =>
        _localizer.GetString("featureView.operations.noData", "No data available");

    /// <summary>Empty surface for the audit table (web <c>t('No audit log entries')</c>).</summary>
    public string NoAuditMessage =>
        _localizer.GetString("featureView.operations.noAudit", "No audit log entries");

    /// <summary>Section-level empty message (no stats, no delivery rows and no audit at all).</summary>
    public string EmptyMessage => _localizer.GetString(
        "featureView.operations.empty",
        "No operations data is available yet. Notification delivery and the audit trail appear here once the API has reported in.");

    /// <summary>Loading announcement.</summary>
    public string LoadingLabel => _localizer.GetString("featureView.operations.loading", "Loading operations\u2026");

    /// <summary>Hard-failure message (the error surface default).</summary>
    public string ErrorMessageDefault => _localizer.GetString(
        "featureView.operations.error", "Could not load operations data. Check API logs and try again.");

    /// <summary>"Refresh" affordance label.</summary>
    public string RefreshLabel => _localizer.GetString("featureView.operations.refresh", "Refresh");

    /// <summary>Retry affordance label — the Refresh action doubles as the retry (no separate mutation).</summary>
    public string RetryLabel => RefreshLabel;

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the three cache-then-network loads (web initial queries).</summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public Task LoadAsync(CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

    /// <summary>Retry after a hard failure (web Refresh from the error surface).</summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public Task RetryAsync(CancellationToken cancellationToken = default) => RunAsync(cancellationToken);

    /// <summary>
    /// Manual "Refresh" — re-run the loads with the button in its busy state (web <c>refetch()</c>). The GET
    /// endpoints are authoritative, so there is no mutation; the reload reflects current server state.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load.</param>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        IsFetching = true;
        try
        {
            await RunAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
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
        Cancel(ref _cts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        var token = cts.Token;

        var pumps = new[]
        {
            PumpStatsAsync(token),
            PumpLogsAsync(token),
            PumpAuditAsync(token),
        };

        try
        {
            await Task.WhenAll(pumps).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop these emissions silently.
        }
    }

    private async Task PumpStatsAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamStatsAsync(token).ConfigureAwait(false))
        {
            ApplyStats(result);
        }
    }

    private async Task PumpLogsAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamLogsAsync(token).ConfigureAwait(false))
        {
            ApplyLogs(result);
        }
    }

    private async Task PumpAuditAsync(CancellationToken token)
    {
        await foreach (var result in _source.StreamAuditAsync(token).ConfigureAwait(false))
        {
            ApplyAudit(result);
        }
    }

    private void ApplyStats(RepositoryResult<OperationsNotificationStats> result)
    {
        lock (_gate)
        {
            _statsResult = result;
            if (result.Status != LoadStatus.Loading)
            {
                _statsResolved = true;
            }

            _stats = NextSnapshot(result, _stats, OperationsNotificationStats.Empty);
            Recompute();
        }
    }

    private void ApplyLogs(RepositoryResult<IReadOnlyList<OperationsNotificationLog>> result)
    {
        lock (_gate)
        {
            _logsResult = result;
            if (result.Status != LoadStatus.Loading)
            {
                _logsResolved = true;
            }

            _logs = NextSnapshot(result, _logs, Array.Empty<OperationsNotificationLog>());
            Recompute();
        }
    }

    private void ApplyAudit(RepositoryResult<IReadOnlyList<OperationsAuditEntry>> result)
    {
        lock (_gate)
        {
            _auditResult = result;
            if (result.Status != LoadStatus.Loading)
            {
                _auditResolved = true;
            }

            _audit = NextSnapshot(result, _audit, Array.Empty<OperationsAuditEntry>());
            Recompute();
        }
    }

    private void Recompute()
    {
        var now = _clock();
        var reading = new OperationsReading(_stats, _logs, _audit);
        Display = OperationsSectionProjection.Project(reading, _localizer, now);

        UpdatedAt = Latest(_statsResult.FetchedAt, _logsResult.FetchedAt, _auditResult.FetchedAt) ?? UpdatedAt;

        // Web parity: the skeleton shows while statsLoading || logsLoading || auditLoading — i.e. until every
        // read has produced its first result. Once a read resolves it never reverts to the loading surface.
        if (!_statsResolved || !_logsResolved || !_auditResolved)
        {
            State = OperationsSectionState.Loading;
            IsFetching = true;
            IsError = false;
            IsStale = false;
            ErrorMessage = null;
            return;
        }

        bool hasContent = Display.HasAnyContent;
        bool anyError = IsStatus(LoadStatus.Error);
        bool anyOffline = IsStatus(LoadStatus.Offline);
        bool anyStale = _statsResult.IsStale || _logsResult.IsStale || _auditResult.IsStale;
        bool anyFetching = IsAnyLoading();

        if (!hasContent)
        {
            State = (anyError || anyOffline) ? OperationsSectionState.Error : OperationsSectionState.Empty;
            IsFetching = anyFetching || _isRefreshing;
            IsError = State == OperationsSectionState.Error;
            IsStale = false;
            ErrorMessage = State == OperationsSectionState.Error ? ErrorMessageDefault : null;
            return;
        }

        if (anyOffline)
        {
            State = OperationsSectionState.Offline;
            IsError = true;
            IsStale = true;
            ErrorMessage = ErrorMessageDefault;
        }
        else if (anyStale)
        {
            State = OperationsSectionState.Stale;
            IsError = false;
            IsStale = true;
            ErrorMessage = null;
        }
        else
        {
            State = OperationsSectionState.Loaded;
            IsError = false;
            IsStale = false;
            ErrorMessage = null;
        }

        IsFetching = anyFetching || _isRefreshing;
    }

    private bool IsStatus(LoadStatus status) =>
        _statsResult.Status == status || _logsResult.Status == status || _auditResult.Status == status;

    private bool IsAnyLoading() =>
        _statsResult.IsLoading || _logsResult.IsLoading || _auditResult.IsLoading;

    private static T NextSnapshot<T>(RepositoryResult<T> result, T previous, T empty)
        where T : class =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                 // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => empty,  // resolved with nothing to show
            _ => result.Value ?? previous,                  // cached / loaded / offline carry the value
        };

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b, DateTimeOffset? c)
    {
        DateTimeOffset? best = a;
        if (b is { } bv && (best is not { } bestV || bv > bestV))
        {
            best = bv;
        }

        if (c is { } cv && (best is not { } bestV2 || cv > bestV2))
        {
            best = cv;
        }

        return best;
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

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
