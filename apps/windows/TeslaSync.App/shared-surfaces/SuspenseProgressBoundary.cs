using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.SharedSurfaces.SuspenseProgressBoundarySurface;

/// <summary>
/// The native WinUI 3 SuspenseProgressBoundary surface — a parity port of
/// <c>web/src/components/feedback/SuspenseProgressBoundary.tsx</c> in its cross-feature role as the
/// progress-tracking boundary wrapped around every code-split route. The web component wraps
/// <c>&lt;Suspense&gt;</c> so that while a lazy chunk is downloading the fallback is shown and the global
/// progress bar activates, and when the real component resolves the fallback is swapped for the children and
/// the bar deactivates. WinUI has no <c>Suspense</c>, so the host exposes a <see cref="IsPending"/> flag (the
/// "suspended" edge a route loader toggles): while pending it shows <see cref="Fallback"/> and, through the
/// shared <see cref="SuspenseProgressBoundaryViewModel"/>, holds a consumer on the global progress channel
/// (the web fallback's <c>globalProgress.start()</c>); when it resolves it shows <see cref="ResolvedContent"/>
/// and releases the consumer (the web fallback unmount → <c>stop()</c>). Because the web source is a
/// transparent presentational wrapper it has no data hooks, no charts/maps, no i18n keys, and only the two
/// branches it reproduces here — pending (fallback) and resolved (children); it has no empty / error / stale /
/// offline chrome, and fabricating any would be parity drift (the same anonymous-surface precedent as
/// VisuallyHidden / withAiFeature). The host contributes no accessible node of its own
/// (<see cref="AccessibilityView.Raw"/>, a nameless <see cref="AutomationControlType.Group"/> peer) — the
/// hosted fallback / content carries every semantic, exactly like the web bare fragment, and the decorative
/// global bar (the web <c>TopProgress</c>, the native atomic <c>TsTopProgress</c>) is the always-visible
/// busy affordance a host wires to the channel. It emits <c>view.opened</c> exactly once on
/// <see cref="FrameworkElement.Loaded"/>. All channel state flows through the view-model; the view never
/// reads the channel directly.
/// </summary>
public sealed partial class SuspenseProgressBoundary : ContentControl, IDisposable
{
    /// <summary>Whether the boundary is suspended (show <see cref="Fallback"/> and activate the channel).</summary>
    public static readonly DependencyProperty IsPendingProperty = DependencyProperty.Register(
        nameof(IsPending),
        typeof(bool),
        typeof(SuspenseProgressBoundary),
        new PropertyMetadata(false, OnRenderInputChanged));

    /// <summary>The fallback shown while <see cref="IsPending"/> (web <c>fallback</c> prop — a caller skeleton).</summary>
    public static readonly DependencyProperty FallbackProperty = DependencyProperty.Register(
        nameof(Fallback),
        typeof(object),
        typeof(SuspenseProgressBoundary),
        new PropertyMetadata(null, OnRenderInputChanged));

    /// <summary>The resolved content shown when not pending (web <c>children</c>).</summary>
    public static readonly DependencyProperty ResolvedContentProperty = DependencyProperty.Register(
        nameof(ResolvedContent),
        typeof(object),
        typeof(SuspenseProgressBoundary),
        new PropertyMetadata(null, OnRenderInputChanged));

    private readonly SuspenseProgressBoundaryViewModel _viewModel;
    private readonly SuspenseProgressBoundaryDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over the process-wide progress channel (the web global <c>globalProgress</c>).</summary>
    public SuspenseProgressBoundary()
        : this(GlobalProgress.Shared, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the surface over an explicit progress channel (tests / isolated hosts) and an optional PII-safe
    /// diagnostics collector.
    /// </summary>
    public SuspenseProgressBoundary(IGlobalProgress progress, SuspenseProgressBoundaryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(progress);

        _viewModel = new SuspenseProgressBoundaryViewModel(progress);
        _diagnostics = diagnostics ?? new SuspenseProgressBoundaryDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent structural wrapper: the web boundary renders a bare fragment, so the hosted fallback /
        // resolved content carries every visual + accessible semantic and this host stays out of the tab order.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics slug this surface registers under (<c>SuspenseProgressBoundary</c>).</summary>
    public static string Slug => SuspenseProgressBoundaryRegistration.Slug;

    /// <summary>The backing bridge state holder (exposed for hosting / diagnostics / tests).</summary>
    public SuspenseProgressBoundaryViewModel ViewModel => _viewModel;

    /// <summary>Whether the boundary is suspended (web Suspense fallback mounted).</summary>
    public bool IsPending
    {
        get => (bool)GetValue(IsPendingProperty);
        set => SetValue(IsPendingProperty, value);
    }

    /// <summary>The fallback shown while pending (web <c>fallback</c>).</summary>
    public object? Fallback
    {
        get => GetValue(FallbackProperty);
        set => SetValue(FallbackProperty, value);
    }

    /// <summary>The resolved content shown when not pending (web <c>children</c>).</summary>
    public object? ResolvedContent
    {
        get => GetValue(ResolvedContentProperty);
        set => SetValue(ResolvedContentProperty, value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SuspenseProgressBoundaryAutomationPeer(this);

    private static void OnRenderInputChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((SuspenseProgressBoundary)d).OnRenderInputChanged();

    private void OnRenderInputChanged()
    {
        // Drive the bridge from the pending edge (start/stop the channel), then render the matching child.
        _viewModel.IsPending = IsPending;
        Render();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        // Only the pending edge changes which child is shown; progress ticks are for hosts binding the bar.
        if (e.PropertyName == nameof(SuspenseProgressBoundaryViewModel.IsPending))
        {
            Marshal(Render);
        }
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

    private void Render()
    {
        // web SuspenseProgressBoundary: while suspended show the fallback, otherwise show the children.
        Content = _viewModel.IsPending ? Fallback : ResolvedContent;
    }

    /// <summary>
    /// A transparent group peer: the web boundary is a bare fragment with no role, so the host reports a
    /// nameless group and lets the hosted fallback / content carry the accessible semantics.
    /// </summary>
    private sealed class SuspenseProgressBoundaryAutomationPeer : FrameworkElementAutomationPeer
    {
        public SuspenseProgressBoundaryAutomationPeer(SuspenseProgressBoundary owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
