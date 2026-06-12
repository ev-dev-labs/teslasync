using System.ComponentModel;
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
/// The native WinUI 3 StaggerItem surface — a parity port of <c>web/src/components/motion/StaggerItem.tsx</c>.
/// The web component is a pure presentational entrance wrapper: a <c>motion.div</c> that animates its child in
/// from a faded, slightly-below resting position (<c>hidden = { opacity: 0, y: 15 }</c>) up to its final place
/// (<c>show = { opacity: 1, y: 0 }</c>) over the duration returned by <c>useMotionPreference(350)</c>. This
/// surface reproduces that with a <see cref="ContentControl"/> that hosts the caller's content (the web
/// <c>children</c>) and runs a one-shot Storyboard over the host's <see cref="UIElement.Opacity"/> and a
/// <see cref="TranslateTransform"/> on load, driven entirely by the shared, unit-tested
/// <see cref="StaggerItemProjection"/> (the same reduce-motion / endpoint maths the web variants encode). All
/// state flows through <see cref="StaggerItemViewModel"/>; the view performs no I/O. It is reduced-motion-aware:
/// under the OS "animations off" preference (or a non-positive duration) the entrance is skipped and the child
/// renders straight in its final state — the web <c>prefers-reduced-motion</c> instant-settle behaviour. Because
/// the wrapper reads no network data (its only input is the caller's content and the motion preference), there
/// is no loading / error / stale / offline chrome; the reproduced branches are the full-motion fade-and-rise and
/// the reduced-motion / zero-duration snap. The wrapper is presentational and carries no accessible name of its
/// own — it is exposed as a transparent group so the hosted child's semantics flow through unchanged. The
/// <c>view.opened</c> diagnostic is emitted exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class StaggerItem : ContentControl, IDisposable
{
    private readonly StaggerItemViewModel _viewModel;
    private readonly StaggerItemDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TranslateTransform _translate = new();

    private Storyboard? _entrance;
    private bool _entered;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the wrapper with the web default entrance duration and the system reduce-motion preference (the
    /// parameterless host/designer entry point).
    /// </summary>
    public StaggerItem()
        : this(new StaggerItemViewModel(new SystemMotionPreferenceSource()), diagnostics: null)
    {
    }

    /// <summary>Creates the wrapper over an explicit entrance duration and the system reduce-motion preference.</summary>
    /// <param name="durationMs">The entrance duration in milliseconds (web <c>useMotionPreference</c> argument).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StaggerItem(int durationMs, StaggerItemDiagnostics? diagnostics = null)
        : this(new StaggerItemViewModel(durationMs, new SystemMotionPreferenceSource()), diagnostics)
    {
    }

    /// <summary>Creates the wrapper over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public StaggerItem(StaggerItemViewModel viewModel, StaggerItemDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new StaggerItemDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        RenderTransform = _translate;

        AutomationProperties.SetAutomationId(this, StaggerItemRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        // Seed the starting frame up front so an animating wrapper is hidden before its first paint (no flash).
        ApplyFromState();
    }

    /// <summary>The canonical surface slug (<c>StaggerItem</c>).</summary>
    public static string Slug => StaggerItemRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public StaggerItemViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopEntrance();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new StaggerAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        PlayEntrance();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(StaggerItemViewModel.Projection))
        {
            Marshal(OnProjectionChanged);
        }
    }

    private void OnProjectionChanged()
    {
        if (_disposed)
        {
            return;
        }

        // A runtime reduce-motion toggle. Once the entrance has played the child stays in its final state;
        // otherwise re-seed and (if now animating and live) start the entrance.
        if (_entered || !_viewModel.Projection.Animate)
        {
            StopEntrance();
            SettleFinal();
            _entered = true;
            return;
        }

        ApplyFromState();
        PlayEntrance();
    }

    private void PlayEntrance()
    {
        if (_disposed || _entered)
        {
            return;
        }

        StaggerItemProjection projection = _viewModel.Projection;

        if (!projection.Animate)
        {
            // Reduced motion / non-positive duration: snap straight to the final resting state.
            SettleFinal();
            _entered = true;
            return;
        }

        if (!IsLoaded)
        {
            // Storyboards can only begin once the element is in the live tree; OnLoaded re-applies.
            ApplyFromState();
            return;
        }

        StopEntrance();
        ApplyFromState();

        var span = new Duration(TimeSpan.FromMilliseconds(projection.DurationMs));

        var fade = new DoubleAnimation
        {
            From = projection.FromOpacity,
            To = projection.ToOpacity,
            Duration = span,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, this);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var rise = new DoubleAnimation
        {
            From = projection.FromOffsetY,
            To = projection.ToOffsetY,
            Duration = span,
            EnableDependentAnimation = true,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(rise, _translate);
        Storyboard.SetTargetProperty(rise, "Y");

        var storyboard = new Storyboard();
        storyboard.Children.Add(fade);
        storyboard.Children.Add(rise);
        storyboard.Completed += OnEntranceCompleted;
        _entrance = storyboard;
        storyboard.Begin();
    }

    private void OnEntranceCompleted(object? sender, object e)
    {
        SettleFinal();
        _entered = true;
    }

    private void ApplyFromState()
    {
        StaggerItemProjection projection = _viewModel.Projection;
        Opacity = projection.FromOpacity;
        _translate.Y = projection.FromOffsetY;
    }

    private void SettleFinal()
    {
        StopEntrance();
        StaggerItemProjection projection = _viewModel.Projection;
        Opacity = projection.ToOpacity;
        _translate.Y = projection.ToOffsetY;
    }

    private void StopEntrance()
    {
        if (_entrance is { } storyboard)
        {
            storyboard.Completed -= OnEntranceCompleted;
            storyboard.Stop();
            _entrance = null;
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

    /// <summary>
    /// A transparent group peer. The wrapper is presentational (the web <c>motion.div</c> styling/animation
    /// shell) and exposes no name of its own, so Narrator traverses into the hosted child for the meaningful
    /// content while the stable automation id remains queryable.
    /// </summary>
    private sealed class StaggerAutomationPeer : FrameworkElementAutomationPeer
    {
        public StaggerAutomationPeer(StaggerItem owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
