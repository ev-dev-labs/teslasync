using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.Motion;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>RouteTransition</c> shared surface — a parity port of
/// web/src/components/motion/RouteTransition.tsx. It wraps the routed page body (the navigation host's content,
/// the native analogue of the router <c>&lt;Outlet /&gt;</c>) and cross-fades it whenever the location pathname
/// changes: a 120ms ease-out fade plus a 4px vertical translate, reproducing the web <c>mode="wait"</c> sequence
/// where the outgoing page lifts and fades out before the incoming page rises and fades in. The behaviour mirrors
/// the web source exactly — it skips the very first mount (<c>initial={false}</c>), never re-fades on a
/// query / search / hash change (re-key by pathname only), collapses to an instant swap under
/// <c>prefers-reduced-motion</c>, and suppresses the fade for list↔detail navigations
/// (<c>/drives/:id</c> and back) so those feel snappy. All of that decision logic lives in the UI-thread-free
/// <see cref="RouteTransitionViewModel"/> + <see cref="RouteTransitionPlan"/>; this view only owns the WinUI
/// wiring — it hosts the page body in a transform-backed presenter, plays (or skips) the cross-fade storyboard
/// when the holder raises <see cref="RouteTransitionViewModel.TransitionRequested"/>, and starts / disposes the
/// holder on load / unload. There is no loading / error / stale / offline chrome because the web source has no
/// data fetch. The wrapper is accessibility-transparent: it takes no tab stop and contributes no Narrator node
/// (<see cref="AccessibilityView.Raw"/>), so the hosted page body is announced directly with no extra container
/// to step through, and it carries no static copy and so no i18n keys.
/// </summary>
public sealed partial class RouteTransition : ContentControl, IDisposable
{
    private readonly RouteTransitionViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly ContentPresenter _host = new();
    private readonly TranslateTransform _translate = new();

    private Storyboard? _storyboard;
    private double _enterOffset;
    private int _enterDuration;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with a non-navigating location source and the system reduce-motion preference (the
    /// parameterless host / designer entry point). Real navigation flows in through the location-source
    /// constructors the shell uses.
    /// </summary>
    public RouteTransition()
        : this(new RouteTransitionViewModel(NullRouteLocationSource.Instance, new SystemMotionPreferenceSource()))
    {
    }

    /// <summary>
    /// Creates the surface over the location seam (web <c>useLocation</c>) and the system reduce-motion
    /// preference, with optional fade duration, skip patterns, translate offset and diagnostics.
    /// </summary>
    /// <param name="location">The current-location port the shell adapter supplies.</param>
    /// <param name="skipPattern">The list↔detail patterns whose navigations are not animated; null uses the web defaults.</param>
    /// <param name="durationMs">The fade duration in milliseconds; null uses the web 120ms default.</param>
    /// <param name="offsetY">The vertical translate magnitude in pixels; null uses the web 4px default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public RouteTransition(
        IRouteLocationSource location,
        IReadOnlyList<string>? skipPattern = null,
        int? durationMs = null,
        double? offsetY = null,
        RouteTransitionDiagnostics? diagnostics = null)
        : this(new RouteTransitionViewModel(
            location,
            new SystemMotionPreferenceSource(),
            durationMs ?? RouteTransitionRegistration.DefaultDurationMs,
            skipPattern,
            offsetY ?? RouteTransitionRegistration.DefaultOffsetY,
            diagnostics))
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts).</summary>
    /// <param name="viewModel">The backing state holder.</param>
    public RouteTransition(RouteTransitionViewModel viewModel)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _host.RenderTransform = _translate;
        _host.HorizontalAlignment = HorizontalAlignment.Stretch;
        _host.VerticalAlignment = VerticalAlignment.Stretch;

        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        MinHeight = 0;
        IsTabStop = false;
        Content = _host;

        // web motion.div has no ARIA role: the wrapper is a passthrough, so it stays out of the tab order and the
        // Narrator control view while the hosted page body is announced directly.
        AutomationProperties.SetAutomationId(this, RouteTransitionRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        _viewModel.TransitionRequested += OnTransitionRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical surface slug (<c>RouteTransition</c>).</summary>
    public static string Slug => RouteTransitionRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RouteTransitionViewModel ViewModel => _viewModel;

    /// <summary>
    /// The routed page body the surface wraps and cross-fades (web <c>children</c> / the router
    /// <c>&lt;Outlet /&gt;</c>). The shell assigns the destination page here as part of each navigation.
    /// </summary>
    public UIElement? RouteContent
    {
        get => _host.Content as UIElement;
        set => _host.Content = value;
    }

    /// <summary>Detach from the holder, stop any in-flight fade and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopStoryboard();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.TransitionRequested -= OnTransitionRequested;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RouteTransitionAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // The mount shows the initial page settled, with no entry animation (web initial={false}).
        SettleContent();
        _viewModel.Start();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnTransitionRequested(object? sender, RouteTransitionPlan plan) => Marshal(() => PlayTransition(plan));

    private void PlayTransition(RouteTransitionPlan plan)
    {
        StopStoryboard();

        if (!plan.Animate || !IsLoaded)
        {
            // Reduced motion, a list↔detail skip, or not yet live: snap to the settled state (web instant swap).
            SettleContent();
            return;
        }

        // web mode="wait": play the outgoing page out first, then bring the incoming page in.
        _enterOffset = plan.OffsetY;
        _enterDuration = plan.DurationMs;

        Storyboard exit = BuildPhase(fromOpacity: 1, toOpacity: 0, fromY: 0, toY: -plan.OffsetY, plan.DurationMs);
        exit.Completed += OnExitCompleted;
        _storyboard = exit;
        exit.Begin();
    }

    private void OnExitCompleted(object? sender, object e)
    {
        StopStoryboard();

        if (_disposed || !IsLoaded)
        {
            SettleContent();
            return;
        }

        // The shell has swapped RouteContent to the destination page during the exit; rise it in from +offset.
        Storyboard enter = BuildPhase(fromOpacity: 0, toOpacity: 1, fromY: _enterOffset, toY: 0, _enterDuration);
        _storyboard = enter;
        enter.Begin();
    }

    private Storyboard BuildPhase(double fromOpacity, double toOpacity, double fromY, double toY, int durationMs)
    {
        var span = new Duration(TimeSpan.FromMilliseconds(durationMs));

        var fade = new DoubleAnimation
        {
            From = fromOpacity,
            To = toOpacity,
            Duration = span,
            EnableDependentAnimation = true,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(fade, _host);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var slide = new DoubleAnimation
        {
            From = fromY,
            To = toY,
            Duration = span,
            EnableDependentAnimation = true,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(slide, _translate);
        Storyboard.SetTargetProperty(slide, "Y");

        var storyboard = new Storyboard();
        storyboard.Children.Add(fade);
        storyboard.Children.Add(slide);
        return storyboard;
    }

    private void StopStoryboard()
    {
        if (_storyboard is null)
        {
            return;
        }

        _storyboard.Completed -= OnExitCompleted;
        _storyboard.Stop();
        _storyboard = null;
    }

    private void SettleContent()
    {
        _host.Opacity = 1;
        _translate.Y = 0;
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
    /// runtime-change subscription is intentionally a no-op to avoid the platform-gated UISettings change event).
    /// Lives with the view so the WinUI-free state-holder layer stays portable to the headless test host.
    /// </summary>
    private sealed class SystemMotionPreferenceSource : IMotionPreferenceSource
    {
        public bool ReduceMotion => MotionPreference.ReduceMotion;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            return NoOpSubscription.Instance;
        }

        private sealed class NoOpSubscription : IDisposable
        {
            public static NoOpSubscription Instance { get; } = new();

            private NoOpSubscription()
            {
            }

            public void Dispose()
            {
                // Read-once: the preference is not observed for runtime changes.
            }
        }
    }

    /// <summary>
    /// The non-navigating location source backing the parameterless designer constructor — a fixed root path that
    /// never raises <see cref="IRouteLocationSource.Changed"/>, so the designer surface simply hosts its content
    /// with no fade. The shell drives real navigation through the location-source constructor.
    /// </summary>
    private sealed class NullRouteLocationSource : IRouteLocationSource
    {
        public static NullRouteLocationSource Instance { get; } = new();

        private NullRouteLocationSource()
        {
        }

        public string Path => "/";

        public event EventHandler? Changed
        {
            add { /* The designer source never navigates, so there is nothing to subscribe to. */ }
            remove { /* No subscription was ever added. */ }
        }
    }

    private sealed class RouteTransitionAutomationPeer : FrameworkElementAutomationPeer
    {
        public RouteTransitionAutomationPeer(RouteTransition owner)
            : base(owner)
        {
        }

        // web motion.div is a transparent wrapper: expose it as a plain group with no name of its own so the
        // hosted page body's own peers carry the accessible content.
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override bool IsControlElementCore() => false;
    }
}
