using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.ChartTimeRangeContextSurface;

/// <summary>
/// The chart-sync state holder bound to the cursor-sync store (P1/S8) — the native port of the web
/// <c>ChartTimeRangeProvider</c> plus its companion hooks <c>useChartSync</c>, <c>useSyncedCursor</c> and
/// <c>useSyncedReferenceLineX</c> (web/src/components/charts/ChartTimeRangeContext.tsx).
/// <list type="bullet">
///   <item><description>It exposes a stable <see cref="Context"/> (<c>useChartSync</c>): the
///     <see cref="ChartSyncContextValue"/> every descendant chart spreads onto its <c>syncId</c> /
///     <c>syncMethod</c> props.</description></item>
///   <item><description>It exposes <see cref="SyncedCursor"/> (<c>useSyncedCursor</c>): props whose
///     <see cref="SyncedCursorProps.OnMouseMove"/> feeds the active X-axis label into the store.</description></item>
///   <item><description>It exposes <see cref="SyncedReferenceLineX"/> (<c>useSyncedReferenceLineX</c>):
///     the persistent X value charts render as a vertical reference line, raised through
///     <see cref="INotifyPropertyChanged"/> exactly like the web hook's <c>useSyncExternalStore</c>
///     re-render — and only when this <c>syncId</c>'s value actually changes.</description></item>
/// </list>
/// Like the web provider's unmount effect (<c>clearCursorSync(syncId)</c>), <see cref="Dispose"/>
/// unsubscribes and drops this <c>syncId</c>'s entry so navigating between pages never leaks a stale
/// cursor. The holder performs no UI work; a view marshals <see cref="PropertyChanged"/> to the UI thread.
/// </summary>
public sealed class ChartTimeRangeProviderViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICursorSyncStore _store;
    private readonly IDisposable _subscription;
    private CursorSyncValue _syncedReferenceLineX;
    private bool _disposed;

    /// <summary>
    /// Creates the holder for <paramref name="syncId"/> (the web required prop) over an optional explicit
    /// store seam, defaulting to the process-wide <see cref="CursorSyncStore.Shared"/>. The reference-line
    /// value is seeded from any cursor a sibling chart in the same group has already set (the web initial
    /// <c>useSyncExternalStore</c> snapshot).
    /// </summary>
    public ChartTimeRangeProviderViewModel(
        string syncId,
        ChartSyncMethod syncMethod = ChartSyncMethod.Index,
        ICursorSyncStore? store = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(syncId);
        _store = store ?? CursorSyncStore.Shared;
        Context = new ChartSyncContextValue(syncId, syncMethod);
        SyncedCursor = new SyncedCursorProps(syncId, syncMethod, OnMouseMove);
        _syncedReferenceLineX = _store.GetPosition(syncId);
        _subscription = _store.Subscribe(OnStoreChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The chart-sync context value (the web <c>useChartSync</c> result inside a provider).</summary>
    public ChartSyncContextValue Context { get; }

    /// <summary>The recharts <c>syncId</c> shared with every descendant chart.</summary>
    public string SyncId => Context.SyncId;

    /// <summary>The recharts <c>syncMethod</c> shared with every descendant chart.</summary>
    public ChartSyncMethod SyncMethod => Context.SyncMethod;

    /// <summary>The props ready to spread onto a recharts chart (the web <c>useSyncedCursor</c> result).</summary>
    public SyncedCursorProps SyncedCursor { get; }

    /// <summary>
    /// The persistent reference-line X value for this group (the web <c>useSyncedReferenceLineX</c> result).
    /// <see cref="CursorSyncValue.None"/> before any chart in the group has been hovered.
    /// </summary>
    public CursorSyncValue SyncedReferenceLineX => _syncedReferenceLineX;

    /// <summary>
    /// Feed a recharts mouse-move into the cursor-sync store (the web <c>useSyncedCursor</c>
    /// <c>onMouseMove</c> handler). A <c>null</c> state or an absent active label clears the cursor,
    /// mirroring the web <c>state?.activeLabel ?? null</c> coalesce.
    /// </summary>
    public void OnMouseMove(ChartMouseState? state)
    {
        if (_disposed)
        {
            return;
        }

        CursorSyncValue next = state?.ActiveLabel ?? CursorSyncValue.None;
        _store.SetPosition(Context.SyncId, next);
    }

    /// <summary>
    /// Stop syncing and drop this <c>syncId</c>'s cursor (the web provider unmount effect
    /// <c>clearCursorSync(syncId)</c>); idempotent.
    /// </summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _subscription.Dispose();
        _store.Clear(Context.SyncId);
        GC.SuppressFinalize(this);
    }

    private void OnStoreChanged()
    {
        CursorSyncValue latest = _store.GetPosition(Context.SyncId);

        // web useSyncExternalStore bails out when this syncId's snapshot is unchanged, so a sibling group's
        // cursor move never re-renders this provider's consumers.
        if (latest.Equals(_syncedReferenceLineX))
        {
            return;
        }

        _syncedReferenceLineX = latest;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(SyncedReferenceLineX)));
    }
}

/// <summary>
/// The native analogue of the three web chart-sync hooks, resolving the nullable provider exactly as the
/// web hooks resolve the React context: outside a provider they return the standalone-safe fallbacks
/// (web <c>useChartSync() === null</c>, <c>useSyncedCursor() === {}</c>,
/// <c>useSyncedReferenceLineX() === null</c>) so a chart can opt in unconditionally without crashing on
/// standalone use.
/// </summary>
public static class ChartSync
{
    /// <summary>web <c>useChartSync</c>: the context value, or <c>null</c> outside a provider.</summary>
    public static ChartSyncContextValue? UseChartSync(ChartTimeRangeProviderViewModel? provider) =>
        provider?.Context;

    /// <summary>web <c>useSyncedCursor</c>: the spreadable props, or <see cref="SyncedCursorProps.Empty"/> outside a provider.</summary>
    public static SyncedCursorProps UseSyncedCursor(ChartTimeRangeProviderViewModel? provider) =>
        provider?.SyncedCursor ?? SyncedCursorProps.Empty;

    /// <summary>web <c>useSyncedReferenceLineX</c>: the persistent X value, or <see cref="CursorSyncValue.None"/> outside a provider.</summary>
    public static CursorSyncValue UseSyncedReferenceLineX(ChartTimeRangeProviderViewModel? provider) =>
        provider is null ? CursorSyncValue.None : provider.SyncedReferenceLineX;
}
