using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AuditLogWidget"/> view — the native port of
/// the web <c>AuditLogWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/AuditLogWidget.tsx). It consumes the two cache-then-network
/// sequences of the <see cref="IAuditLogSource"/> (the admin audit trail and the per-vehicle
/// security/access feed), merges them through <see cref="AuditLogProjection"/>, and exposes the
/// combined <see cref="State"/> plus the header freshness flags so the view is a thin renderer. The two
/// streams are consumed sequentially within one confinement (the UI thread) so the holder needs no
/// internal synchronisation; the combined freshness mirrors the web's <c>auditX || secX</c> booleans.
/// </summary>
public sealed class AuditLogViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAuditLogSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private AuditLogSize _size;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<IReadOnlyList<AuditLogEntry>>? _auditResult;
    private RepositoryResult<IReadOnlyList<SecurityEvent>>? _securityResult;
    private IReadOnlyList<AuditLogEntry> _auditValue = Array.Empty<AuditLogEntry>();
    private IReadOnlyList<SecurityEvent> _securityValue = Array.Empty<SecurityEvent>();
    private bool _auditResolved;
    private bool _securityResolved;
    private bool _auditActive;
    private bool _securityActive;

    private AuditLogState _state = AuditLogState.Loading;
    private AuditLogDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public AuditLogViewModel(
        IAuditLogSource source,
        ILocalizer localizer,
        AuditLogSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = AuditLogProjection.Project(_auditValue, _securityValue, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current combined surface state.</summary>
    public AuditLogState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact stats + newest-first capped rows).</summary>
    public AuditLogDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasItems));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip (max of both sources).</summary>
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

    /// <summary>True when either source's last load failed (drives the header error chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when either source's shown rows are older than the freshness window.</summary>
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

    /// <summary>True when there is at least one merged event to render.</summary>
    public bool HasItems => _display.HasItems;

    /// <summary>Localized widget title (web <c>widget.auditLog</c>).</summary>
    public string Title => AuditLogRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noAuditEvents</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noAuditEvents", "No audit events");

    /// <summary>The widget footprint; reassigning re-projects the current rows for the new layout.</summary>
    public AuditLogSize Size
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
            Recompute();
        }
    }

    /// <summary>
    /// Run a cache-then-network load of both sources sequentially: counts the attempt, then folds each
    /// emission into <see cref="State"/> + <see cref="Display"/>. The skeleton shows only until BOTH
    /// sources have resolved at least once (web <c>auditLoading || secLoading</c>); thereafter content
    /// stays visible while refreshing. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        _auditActive = true;
        _securityActive = true;
        Recompute();

        try
        {
            await foreach (var result in _source.StreamAuditLogsAsync(cts.Token).ConfigureAwait(false))
            {
                _auditResult = result;
                _auditValue = NextValue(result, _auditValue);
                if (result.Status != LoadStatus.Loading)
                {
                    _auditResolved = true;
                }

                Recompute();
            }

            _auditActive = false;
            Recompute();

            await foreach (var result in _source.StreamSecurityEventsAsync(cts.Token).ConfigureAwait(false))
            {
                _securityResult = result;
                _securityValue = NextValue(result, _securityValue);
                if (result.Status != LoadStatus.Loading)
                {
                    _securityResolved = true;
                }

                Recompute();
            }

            _securityActive = false;
            Recompute();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop the remaining emissions silently.
        }
    }

    /// <summary>Retry both sources — re-runs the load from the top while keeping content visible.</summary>
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

    private void Recompute()
    {
        Display = AuditLogProjection.Project(_auditValue, _securityValue, _size, _localizer, _clock());

        UpdatedAt = MaxTime(_auditResult?.FetchedAt, _securityResult?.FetchedAt);
        bool stale = (_auditResult?.IsStale ?? false) || (_securityResult?.IsStale ?? false);
        bool error = IsErrorish(_auditResult) || IsErrorish(_securityResult);
        bool offline = _auditResult?.Status == LoadStatus.Offline || _securityResult?.Status == LoadStatus.Offline;
        bool bothResolved = _auditResolved && _securityResolved;

        IsStale = stale;
        IsError = error;
        IsFetching = bothResolved && (_auditActive || _securityActive);

        bool hasItems = _display.HasItems;
        State = !bothResolved
            ? AuditLogState.Loading
            : !hasItems && error
                ? AuditLogState.Error
                : !hasItems
                    ? AuditLogState.Empty
                    : offline
                        ? AuditLogState.Offline
                        : stale
                            ? AuditLogState.Stale
                            : AuditLogState.Loaded;
    }

    private static IReadOnlyList<T> NextValue<T>(RepositoryResult<IReadOnlyList<T>> result, IReadOnlyList<T> previous) => result.Status switch
    {
        LoadStatus.Loading => previous,                          // transient — keep the prior content visible
        LoadStatus.Empty or LoadStatus.Error => Array.Empty<T>(), // resolved with nothing to show for this source
        _ => result.Value ?? previous,                            // cached / loaded / offline carry a value
    };

    private static bool IsErrorish<T>(RepositoryResult<T>? result) =>
        result is { Status: LoadStatus.Error or LoadStatus.Offline };

    private static DateTimeOffset? MaxTime(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a.Value >= b.Value ? a : b;
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
