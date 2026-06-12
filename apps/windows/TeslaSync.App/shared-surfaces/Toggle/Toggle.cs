using System.ComponentModel;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using Windows.System;
using UiaToggleState = Microsoft.UI.Xaml.Automation.ToggleState;

namespace TeslaSync.App.SharedSurfaces.ToggleSurface;

/// <summary>
/// The native WinUI 3 <c>Toggle</c> shared surface — a parity port of the web <c>Toggle</c> primitive
/// (<c>web/src/components/ui/Toggle.tsx</c>), the shared accessible switch used by settings rows and feature
/// flags. Like the web source it composes its own control — a tokenized rounded pill <see cref="Border"/>
/// track hosting a white knob <see cref="Border"/> thumb, with an optional inline label to its right — rather
/// than retemplating the platform <see cref="ToggleSwitch"/>, so the track tint, thumb and label all flow from
/// the generated design tokens (P1/S9) and light / dark / high-contrast themes follow automatically. It binds
/// the <see cref="ToggleViewModel"/> and reproduces every state the web switch renders: the neutral off track
/// with the thumb at the start (web <c>bg-gray-300 dark:bg-gray-600</c>), the accent on track with the thumb
/// slid to the end (web <c>bg-cyan-500 dark:bg-cyan-600</c> + the <c>translate-x</c> shift) and the keyboard
/// focus ring (the system focus visual, the native analogue of the web <c>focus-visible:ring</c>).
///
/// <para>
/// The surface carries first-class switch accessibility: its automation peer reports
/// <see cref="AutomationControlType.Button"/> with the label as its accessible name and an
/// <see cref="IToggleProvider"/> exposing the two-state <see cref="UiaToggleState"/> — the same UIA mapping
/// the platform <see cref="ToggleSwitch"/> uses and the faithful native analogue of the web
/// <c>role="switch"</c> + <c>aria-checked</c>, so Narrator announces "&lt;label&gt;, button, on / off" and
/// assistive tech can toggle it. Space and Enter both toggle (the web control is a real <c>&lt;button&gt;</c>,
/// which fires on both keys); a pointer tap anywhere on the track or label toggles (the web wrapper's
/// <c>onClick</c>). The thumb slides with a short animation that collapses to an instant move under the
/// Windows "show animations" accessibility setting (the native <c>prefers-reduced-motion</c>). The composed
/// track / thumb / label add no separate accessible nodes. The web component is presentational and prop-driven
/// (its consuming page owns any data fetching), so — like the shipped <c>Checkbox</c> / <c>ScoreBadge</c>
/// surfaces — it has no loading / error / stale / offline chrome to reproduce, and (unlike the web
/// <c>Checkbox</c>) the web <c>Toggle</c> has no disabled state to mirror. The view performs no I/O and emits
/// the <c>view.opened</c> diagnostic once when shown.
/// </para>
/// </summary>
public sealed partial class Toggle : ContentControl, IDisposable
{
    private static readonly TimeSpan SlideDuration = TimeSpan.FromMilliseconds(167);  // web `duration-normal` thumb slide.
    private const double BorderThicknessPx = 1;  // hairline track + thumb stroke (also the web forced-colors border intent).

    private readonly ToggleViewModel _viewModel;
    private readonly ToggleDiagnostics _diagnostics;
    // Fully qualified: Windows.System (imported for VirtualKey) also declares a DispatcherQueue.
    private readonly Microsoft.UI.Dispatching.DispatcherQueue? _dispatcher;
    private readonly SolidColorBrush _thumbFill = new(Colors.White);

    private readonly StackPanel _layout = new()
    {
        Orientation = Orientation.Horizontal,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Grid _trackHost = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _track = new();

    private readonly Border _thumb = new()
    {
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TranslateTransform _thumbTransform = new();
    private readonly DoubleAnimation _slideAnimation;
    private readonly Storyboard _slideStoryboard;

    private readonly TextBlock _label = new() { VerticalAlignment = VerticalAlignment.Center };

    private double _currentThumbX;
    private bool _loaded;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over a default (off, medium, unlabeled) state — the native analogue of
    /// mounting the web component in an isolated gallery host. Production callers use the seam constructor.
    /// </summary>
    public Toggle()
        : this(new ToggleViewModel())
    {
    }

    /// <summary>Creates the surface over its state holder and an optional PII-safe diagnostics collector.</summary>
    /// <param name="viewModel">The bound state holder (the web props); the surface's P1/S8 seam.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event (P1/S11).</param>
    public Toggle(ToggleViewModel viewModel, ToggleDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new ToggleDiagnostics();
        _dispatcher = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();

        _thumb.RenderTransform = _thumbTransform;
        _thumb.Background = _thumbFill;
        _thumb.BorderThickness = new Thickness(BorderThicknessPx);
        _track.BorderThickness = new Thickness(BorderThicknessPx);

        _trackHost.Children.Add(_track);
        _trackHost.Children.Add(_thumb);
        _layout.Children.Add(_trackHost);
        _layout.Children.Add(_label);
        Content = _layout;

        _slideAnimation = new DoubleAnimation
        {
            Duration = new Duration(SlideDuration),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(_slideAnimation, _thumbTransform);
        Storyboard.SetTargetProperty(_slideAnimation, "X");
        _slideStoryboard = new Storyboard();
        _slideStoryboard.Children.Add(_slideAnimation);

        IsTabStop = true;
        UseSystemFocusVisuals = true;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;

        // The composed track / thumb / label carry no separate accessible nodes — the surface's automation
        // peer is the single Button node Narrator reads (name + toggle state), exactly as the web track and
        // thumb are aria-hidden and the button carries the semantics.
        AutomationProperties.SetAccessibilityView(_trackHost, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_track, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_thumb, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        KeyDown += OnKeyDown;
        Tapped += OnTapped;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(animate: false);
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>Toggle</c>).</summary>
    public static string Slug => ToggleRegistration.Slug;

    /// <summary>The bound state holder (exposed for hosting / diagnostics / tests).</summary>
    public ToggleViewModel ViewModel => _viewModel;

    /// <summary>Detach from the state holder and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _slideStoryboard.Stop();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        KeyDown -= OnKeyDown;
        Tapped -= OnTapped;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ToggleAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _loaded = true;

        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => Marshal(() => Render(animate: true));

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        // The web Toggle is a real <button>, which natively toggles on both Space and Enter.
        if (e.Key is VirtualKey.Space or VirtualKey.Enter)
        {
            e.Handled = true;
            ToggleFromUser();
        }
    }

    private void OnTapped(object sender, TappedRoutedEventArgs e)
    {
        e.Handled = true;
        ToggleFromUser();
    }

    // Routes an assistive-technology Toggle request through the same path as a click (the web onChange).
    internal void ToggleFromAutomation() => ToggleFromUser();

    // Maps the projected view-model state to the WinUI automation toggle enum.
    internal UiaToggleState ResolveToggleState() =>
        _viewModel.VisualState == ToggleVisualState.On ? UiaToggleState.On : UiaToggleState.Off;

    private void ToggleFromUser()
    {
        if (!IsEnabled)
        {
            return;
        }

        UiaToggleState previous = ResolveToggleState();
        _viewModel.Toggle();
        RaiseToggleStateChanged(previous, ResolveToggleState());
    }

    private void RaiseToggleStateChanged(UiaToggleState previous, UiaToggleState current)
    {
        if (previous == current)
        {
            return;
        }

        if (FrameworkElementAutomationPeer.FromElement(this) is ToggleAutomationPeer peer)
        {
            peer.RaisePropertyChangedEvent(TogglePatternIdentifiers.ToggleStateProperty, previous, current);
        }
    }

    private void Render(bool animate)
    {
        ToggleMetrics metrics = ToggleMetricsTable.For(_viewModel.Size);

        _trackHost.Width = metrics.TrackWidth;
        _trackHost.Height = metrics.TrackHeight;

        _track.CornerRadius = new CornerRadius(metrics.TrackCornerRadius);

        _thumb.Width = metrics.ThumbSize;
        _thumb.Height = metrics.ThumbSize;
        _thumb.CornerRadius = new CornerRadius(metrics.ThumbCornerRadius);
        _thumb.Margin = new Thickness(metrics.ThumbInset, 0, 0, 0);
        _thumb.BorderBrush = DisplayTokens.Border;

        bool hasLabel = !string.IsNullOrEmpty(_viewModel.Label);
        _label.Text = _viewModel.Label ?? string.Empty;
        _label.FontSize = metrics.LabelFontSize;
        _label.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
        _label.Foreground = DisplayTokens.TextSecondary;
        _label.Margin = new Thickness(metrics.Gap, 0, 0, 0);
        _label.Visibility = hasLabel ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, _viewModel.State.AccessibleName);

        ApplyTrackVisual(_viewModel.VisualState);

        double targetX = _viewModel.VisualState == ToggleVisualState.On ? metrics.ThumbTravel : 0;
        PositionThumb(targetX, animate);
    }

    // web on track: the accent-filled pill (a solid Fluent fill, the Windows-idiomatic mapping of the web
    // translucent cyan track); off track: the subtle glass surface with a hairline border (web
    // `bg-gray-300 dark:bg-gray-600`, kept token-driven so both themes follow the design system).
    private void ApplyTrackVisual(ToggleVisualState state)
    {
        if (state == ToggleVisualState.On)
        {
            _track.Background = DisplayTokens.Accent;
            _track.BorderBrush = DisplayTokens.Accent;
        }
        else
        {
            _track.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
            _track.BorderBrush = DisplayTokens.Border;
        }
    }

    private void PositionThumb(double targetX, bool animate)
    {
        if (Math.Abs(_currentThumbX - targetX) < 0.5)
        {
            return;
        }

        if (animate && _loaded && !MotionPreference.ReduceMotion)
        {
            _slideStoryboard.Stop();
            _slideAnimation.From = _currentThumbX;
            _slideAnimation.To = targetX;
            _thumbTransform.X = targetX;
            _currentThumbX = targetX;
            _slideStoryboard.Begin();
        }
        else
        {
            _slideStoryboard.Stop();
            _thumbTransform.X = targetX;
            _currentThumbX = targetX;
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
    /// Reports the surface as a native <see cref="AutomationControlType.Button"/> with an
    /// <see cref="IToggleProvider"/> exposing the two-state <see cref="UiaToggleState"/> — the UIA mapping the
    /// platform <see cref="ToggleSwitch"/> uses and the faithful analogue of the web <c>role="switch"</c> (with
    /// its <c>aria-checked</c> state), so Narrator announces the toggle state and assistive tech can flip it.
    /// </summary>
    private sealed partial class ToggleAutomationPeer : FrameworkElementAutomationPeer, IToggleProvider
    {
        public ToggleAutomationPeer(Toggle owner)
            : base(owner)
        {
        }

        public UiaToggleState ToggleState => ((Toggle)Owner).ResolveToggleState();

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Button;

        protected override string GetClassNameCore() => nameof(Toggle);

        protected override object? GetPatternCore(PatternInterface patternInterface) =>
            patternInterface == PatternInterface.Toggle ? this : base.GetPatternCore(patternInterface);

        public void Toggle() => ((Toggle)Owner).ToggleFromAutomation();
    }
}
