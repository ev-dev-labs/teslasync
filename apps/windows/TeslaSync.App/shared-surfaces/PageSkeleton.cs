using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 PageSkeleton surface — a parity port of <c>web/src/components/feedback/PageSkeleton.tsx</c>.
/// The web source is a family of four shaped loading building blocks (<c>PageHeaderSkeleton</c>,
/// <c>StatGridSkeleton</c>, <c>ChartBlockSkeleton</c>, <c>TableSkeleton</c>) that mirror the structure of common
/// page regions so the loading UI claims the same space as the real content and layout shift stays near zero.
/// This surface renders one selected block, composing the shared <see cref="TsSkeleton"/> shimmer atom (the
/// native <c>&lt;Skeleton&gt;</c>) into the rows the <see cref="PageSkeletonProjection"/> describes: the page
/// header's title-over-subtitle pair, the stat grid's wrapping equal-width cards, the chart's single full-width
/// box and the table's header-over-body-cells lattice. All state flows through <see cref="PageSkeletonViewModel"/>;
/// the view performs no I/O. It is reduced-motion-aware — under the OS "animations off" preference each shimmer
/// atom suppresses its pulse (the web <c>animate-pulse</c> gate). Because the component reads no network data (its
/// only inputs are caller-supplied props), there is no loading / error / stale / offline chrome — the skeleton
/// <em>is</em> the loading state; the reproduced branches are the four building blocks, their configurable
/// parameters (card count, chart height, table rows / columns) and the full-motion vs reduced-motion shimmer.
/// Each block is a polite status live region (web <c>role="status"</c> / <c>aria-busy="true"</c>) named by its
/// fixed i18n label, stamped with the web <c>data-testid</c> as its automation id, and emits the
/// <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class PageSkeleton : ContentControl, IDisposable
{
    private readonly PageSkeletonViewModel _viewModel;
    private readonly PageSkeletonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Vertical,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a page-header loading block over the i18n passthrough and the system reduce-motion preference (the
    /// parameterless designer / host entry point).
    /// </summary>
    public PageSkeleton()
        : this(PageSkeletonBlock.PageHeader, PageSkeletonParameters.Default, localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the loading block over the web props, the i18n facade and the system reduce-motion preference.</summary>
    /// <param name="block">The building block to render (web exported function).</param>
    /// <param name="parameters">The block parameters (web props).</param>
    /// <param name="localizer">The i18n facade the accessible label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PageSkeleton(
        PageSkeletonBlock block,
        PageSkeletonParameters parameters,
        ILocalizer? localizer = null,
        PageSkeletonDiagnostics? diagnostics = null)
        : this(
            new PageSkeletonViewModel(
                block,
                parameters,
                localizer ?? PassthroughLocalizer.Instance,
                new SystemMotionPreferenceSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the loading block over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PageSkeleton(PageSkeletonViewModel viewModel, PageSkeletonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new PageSkeletonDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        Content = _root;

        // web role="status" aria-busy="true": a polite status live region named by the block's fixed label.
        LiveRegion.Configure(this);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>PageSkeleton</c>).</summary>
    public static string Slug => PageSkeletonRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public PageSkeletonViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the automation peer reports (the block's fixed i18n label).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>The rendered building block (web exported function). Assigning a new value rebuilds the surface.</summary>
    public PageSkeletonBlock Block
    {
        get => _viewModel.Block;
        set => _viewModel.SetBlock(value);
    }

    /// <summary>The block parameters (web props). Assigning a new value rebuilds the surface.</summary>
    public PageSkeletonParameters Parameters
    {
        get => _viewModel.Parameters;
        set => _viewModel.SetParameters(value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new PageSkeletonAutomationPeer(this);

    private static Grid BuildRow(SkeletonRow row, bool animate)
    {
        var grid = new Grid
        {
            ColumnSpacing = row.ColumnGap,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        for (var c = 0; c < row.Columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (var i = 0; i < row.Cells.Count; i++)
        {
            SkeletonCell cell = row.Cells[i];
            var block = new TsSkeleton
            {
                BlockHeight = cell.Height,
                BlockWidth = cell.Width ?? double.NaN,
                Radius = cell.Radius,
                ReduceMotion = !animate,
            };

            Grid.SetColumn(block, i);
            grid.Children.Add(block);
        }

        return grid;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        LiveRegion.Announce(this);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(PageSkeletonViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        PageSkeletonProjection projection = _viewModel.Projection;

        _root.Spacing = projection.RowGap;
        _root.Children.Clear();
        foreach (SkeletonRow row in projection.Rows)
        {
            _root.Children.Add(BuildRow(row, projection.Animate));
        }

        AutomationProperties.SetAutomationId(this, projection.AutomationId);
        AutomationProperties.SetName(this, projection.AccessibleName);
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    /// <summary>
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag once
    /// through <see cref="MotionPreference"/> (the read-once policy the peer motion-aware surfaces use; the
    /// runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change event).
    /// Lives with the view so the WinUI-free state-holder layer stays portable to the headless test host.
    /// </summary>
    private sealed class SystemMotionPreferenceSource : IMotionPreferenceSource
    {
        public bool ReduceMotion => MotionPreference.ReduceMotion;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            return InertSubscription.Instance;
        }

        private sealed class InertSubscription : IDisposable
        {
            public static InertSubscription Instance { get; } = new();

            private InertSubscription()
            {
            }

            public void Dispose()
            {
                // Read-once: the preference is not observed for runtime changes.
            }
        }
    }

    private sealed class PageSkeletonAutomationPeer : FrameworkElementAutomationPeer
    {
        public PageSkeletonAutomationPeer(PageSkeleton owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((PageSkeleton)Owner).AccessibleName : name;
        }
    }
}
