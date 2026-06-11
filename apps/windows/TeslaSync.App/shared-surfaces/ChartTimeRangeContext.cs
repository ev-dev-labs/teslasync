using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.SharedSurfaces.ChartTimeRangeContextSurface;

/// <summary>
/// The native WinUI 3 ChartTimeRangeContext shared surface — a parity port of the web
/// <c>ChartTimeRangeProvider</c> (web/src/components/charts/ChartTimeRangeContext.tsx) in its cross-feature
/// role as the chart cursor-sync provider that stacked time-series sections wrap once. Like the web
/// provider it is a transparent wrapper: it renders its <see cref="ContentControl.Content"/> (the hosted
/// charts) unchanged, contributes no accessible node of its own (<see cref="AccessibilityView.Raw"/>), and
/// supplies a stable <see cref="ChartTimeRangeProviderViewModel"/> so every descendant chart shares one
/// <c>syncId</c> / <c>syncMethod</c> and one persistent vertical reference line via the
/// <see cref="ICursorSyncStore"/> seam. It emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/> and, mirroring the web unmount effect <c>clearCursorSync(syncId)</c>,
/// drops this <c>syncId</c>'s cursor on <see cref="FrameworkElement.Unloaded"/> so navigating between pages
/// never leaks a stale cursor.
/// </summary>
/// <remarks>
/// Because chart cursor sync is a synchronous in-process coordination primitive (the web source reads no
/// network — <c>cursorSync.ts</c> is a module-level external store, not a query), this surface has no
/// loading / error / stale / offline chrome. Its observable states mirror the web source exactly: the
/// <em>empty</em> state where no chart in the group has been hovered
/// (<see cref="ChartTimeRangeProviderViewModel.SyncedReferenceLineX"/> is
/// <see cref="CursorSyncValue.None"/>, so descendants draw no reference line), the <em>active</em> state
/// where a cursor value is set (a non-none X every synced chart renders), and the standalone-safe
/// outside-provider fallbacks resolved by <see cref="ChartSync"/>. A reference-line value change is raised
/// by the holder on whatever thread mutated the store; descendant charts that bind to
/// <see cref="ChartTimeRangeProviderViewModel.SyncedReferenceLineX"/> are marshalled to the UI thread by
/// the WinUI data-binding engine, so this transparent wrapper needs no dispatcher of its own.
/// </remarks>
public sealed partial class ChartTimeRangeContext : ContentControl, IDisposable
{
    /// <summary>
    /// The page-scoped <c>syncId</c> used when a host does not set <see cref="SyncId"/> (the web required
    /// prop). A host that places more than one provider on screen MUST give each a distinct id so groups
    /// never cross-sync, exactly as the web doc-comment instructs.
    /// </summary>
    public const string DefaultSyncId = "chart-time-range";

    private readonly ChartTimeRangeContextDiagnostics _diagnostics;
    private ChartTimeRangeProviderViewModel? _viewModel;
    private string _syncId = DefaultSyncId;
    private ChartSyncMethod _syncMethod = ChartSyncMethod.Index;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over the process-wide cursor-sync store.</summary>
    public ChartTimeRangeContext()
        : this(diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the surface over an optional PII-safe diagnostics collector (tests / headless hosts). The
    /// view-model binds to <see cref="CursorSyncStore.Shared"/>.
    /// </summary>
    public ChartTimeRangeContext(ChartTimeRangeContextDiagnostics? diagnostics)
    {
        _diagnostics = diagnostics ?? new ChartTimeRangeContextDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent provider wrapper: the web ChartTimeRangeProvider returns its children unchanged and
        // adds no node of its own, so hide the wrapper from Narrator and let the hosted charts carry semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>ChartTimeRangeContext</c>).</summary>
    public static string Slug => ChartTimeRangeContextRegistration.Slug;

    /// <summary>
    /// The stable, page-scoped sync identifier (the web required <c>syncId</c> prop). Setting it rebuilds
    /// the provider over the new id, clearing the previous id's cursor (the web key change).
    /// </summary>
    public string SyncId
    {
        get => _syncId;
        set
        {
            ArgumentException.ThrowIfNullOrEmpty(value);
            if (string.Equals(_syncId, value, StringComparison.Ordinal))
            {
                return;
            }

            _syncId = value;
            RebuildViewModel();
        }
    }

    /// <summary>The recharts sync method (the web <c>syncMethod</c> prop; defaults to <see cref="ChartSyncMethod.Index"/>).</summary>
    public ChartSyncMethod SyncMethod
    {
        get => _syncMethod;
        set
        {
            if (_syncMethod == value)
            {
                return;
            }

            _syncMethod = value;
            RebuildViewModel();
        }
    }

    /// <summary>
    /// The backing chart-sync state holder descendant charts bind to (created on first access). Exposes
    /// <see cref="ChartTimeRangeProviderViewModel.SyncedReferenceLineX"/> and the spreadable
    /// <see cref="ChartTimeRangeProviderViewModel.SyncedCursor"/> props.
    /// </summary>
    public ChartTimeRangeProviderViewModel ViewModel => _viewModel ??= CreateViewModel();

    /// <summary>Detach from the store and drop this id's cursor (the web unmount effect); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel?.Dispose();
        _viewModel = null;
        GC.SuppressFinalize(this);
    }

    private ChartTimeRangeProviderViewModel CreateViewModel() =>
        new(_syncId, _syncMethod, CursorSyncStore.Shared);

    private void RebuildViewModel()
    {
        if (_disposed)
        {
            return;
        }

        _viewModel?.Dispose();
        _viewModel = CreateViewModel();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // Ensure the provider context is live for descendant charts as soon as the surface mounts.
        _ = ViewModel;

        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web provider mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
