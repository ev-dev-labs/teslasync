using System.ComponentModel;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Motion;
using Windows.Foundation;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 SwipeRow surface — a parity port of <c>web/src/components/mobile/SwipeRow.tsx</c>. The web
/// component is a swipe-to-action row primitive that mirrors the iOS Mail / Apple Notes gesture: drag left to
/// reveal a right-edge action, drag right to reveal a left-edge action, release short of half the row width to
/// leave the action "peeked" (tappable), release past half width to auto-fire it, and let a dominant vertical
/// drag abort so the parent list keeps scrolling. Crossing the reveal threshold for the first time fires a single
/// haptic blip, and the snap-back honours the OS reduce-motion preference. It is touch-only by default: on a fine
/// (mouse) pointer — or when no action is wired — it renders its child straight through with no gesture attached,
/// exactly as the web returns <c>&lt;&gt;{children}&lt;/&gt;</c>.
///
/// <para>
/// State coverage: the web source is a controlled interaction primitive whose only inputs are its props plus the
/// CSS-evaluated coarse-pointer / reduce-motion preferences; it performs no data fetch, so — like the peer
/// presentational surfaces (TimelineScrubber / Spinner) — it has no loading / error / stale / offline chrome to
/// reproduce. Every branch it does have is reproduced in full: the inactive passthrough, the active drag with the
/// per-side clamp, the first-threshold-cross haptic, the auto-fire-past-half-width and peek-past-threshold
/// releases, the tap-the-peeked-button fire, and the reduced-motion (instant) vs animated snap-back.
/// </para>
///
/// <para>
/// All interaction maths live in the UI-thread-free <see cref="SwipeGeometry"/> + <see cref="SwipeRowProjection"/>
/// / <see cref="SwipeRowViewModel"/>; the view only lays out the action panels + the translating content host and
/// forwards pointer input. The action buttons expose their localized accessible name (web
/// <c>aria-label={ariaLabel ?? label}</c>) to Narrator and become tab stops only while their side is revealed
/// (web <c>tabIndex</c>). The surface emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </para>
/// </summary>
public sealed partial class SwipeRow : ContentControl, IDisposable
{
    private const double LabelFontSize = 12;   // web text-xs action label.
    private const double IconFontSize = 16;    // web h-4 w-4 lucide icon.
    private const double ToneBackgroundAlpha = 0.20 * 255; // web bg-{tone}-500/20.

    private readonly SwipeRowViewModel _viewModel;
    private readonly ISwipeHaptic _haptic;
    private readonly SwipeRowDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _root = new();
    private readonly Border _leftPanel = new() { HorizontalAlignment = HorizontalAlignment.Left, Visibility = Visibility.Collapsed };
    private readonly Border _rightPanel = new() { HorizontalAlignment = HorizontalAlignment.Right, Visibility = Visibility.Collapsed };
    private readonly Button _leftButton;
    private readonly Button _rightButton;
    private readonly FontIcon _leftIcon = NewIcon();
    private readonly FontIcon _rightIcon = NewIcon();
    private readonly TextBlock _leftLabel = NewLabel();
    private readonly TextBlock _rightLabel = NewLabel();
    private readonly Border _contentHost = new();
    private readonly TranslateTransform _translate = new();

    private double _startX;
    private double _startY;
    private bool _dragging;
    private bool _cancelled;
    private bool _hapticFired;
    private double _restingOffset;
    private Storyboard? _snap;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates an empty passthrough row over the system pointer / motion preferences (the designer / host entry point).</summary>
    public SwipeRow()
        : this(content: null, leftAction: null, onLeftAction: null, rightAction: null, onRightAction: null)
    {
    }

    /// <summary>Creates the row over the web props, the system coarse-pointer + reduce-motion preferences and the default (inert) haptic.</summary>
    /// <param name="content">The wrapped row content (web <c>children</c>).</param>
    /// <param name="leftAction">The left-edge action display model, or null (web <c>leftAction</c>).</param>
    /// <param name="onLeftAction">The left action callback, or null (web <c>leftAction.onAction</c>).</param>
    /// <param name="rightAction">The right-edge action display model, or null (web <c>rightAction</c>).</param>
    /// <param name="onRightAction">The right action callback, or null (web <c>rightAction.onAction</c>).</param>
    /// <param name="enabled">The explicit touch opt-in (web <c>enabled</c>); null defers to the coarse-pointer source.</param>
    /// <param name="revealThreshold">The per-row reveal distance (web <c>revealThreshold</c>); non-positive uses the default 64 px.</param>
    /// <param name="haptic">The haptic sink for the threshold-cross blip; null uses the inert desktop default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SwipeRow(
        UIElement? content,
        SwipeActionModel? leftAction,
        Action? onLeftAction,
        SwipeActionModel? rightAction,
        Action? onRightAction,
        bool? enabled = null,
        double revealThreshold = SwipeRowRegistration.DefaultRevealThreshold,
        ISwipeHaptic? haptic = null,
        SwipeRowDiagnostics? diagnostics = null)
        : this(
            new SwipeRowViewModel(
                leftAction,
                onLeftAction,
                rightAction,
                onRightAction,
                new SystemCoarsePointerSource(),
                new SystemMotionPreferenceSource(),
                enabled,
                revealThreshold),
            content,
            haptic,
            diagnostics)
    {
    }

    /// <summary>Creates the row over an explicit state holder (tests / headless hosts), wrapped content, haptic and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="content">The wrapped row content (web <c>children</c>).</param>
    /// <param name="haptic">The haptic sink for the threshold-cross blip; null uses the inert desktop default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SwipeRow(SwipeRowViewModel viewModel, UIElement? content = null, ISwipeHaptic? haptic = null, SwipeRowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _haptic = haptic ?? NoopSwipeHaptic.Instance;
        _diagnostics = diagnostics ?? new SwipeRowDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _leftButton = NewActionButton(_leftIcon, _leftLabel);
        _rightButton = NewActionButton(_rightIcon, _rightLabel);
        _leftPanel.Child = _leftButton;
        _rightPanel.Child = _rightButton;

        _contentHost.RenderTransform = _translate;
        _contentHost.Child = content;

        // Action panels render behind the content host; the content occludes them until it slides (web absolute
        // underlay + the translating foreground row). Children added later sit on top in a Grid.
        _root.Children.Add(_rightPanel);
        _root.Children.Add(_leftPanel);
        _root.Children.Add(_contentHost);
        Content = _root;

        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        IsTabStop = false;
        AutomationProperties.SetAutomationId(this, SwipeRowRegistration.RootAutomationId);

        _leftButton.Click += OnLeftActionClick;
        _rightButton.Click += OnRightActionClick;
        SizeChanged += OnSizeChanged;
        PointerPressed += OnPointerPressed;
        PointerMoved += OnPointerMoved;
        PointerReleased += OnPointerReleased;
        PointerCanceled += OnPointerCanceled;
        PointerCaptureLost += OnPointerCanceled;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>SwipeRow</c>).</summary>
    public static string Slug => SwipeRowRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SwipeRowViewModel ViewModel => _viewModel;

    /// <summary>The wrapped row content (web <c>children</c>). Assigning a new value re-hosts it.</summary>
    public UIElement? SwipeContent
    {
        get => _contentHost.Child;
        set => _contentHost.Child = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopSnap();
        _leftButton.Click -= OnLeftActionClick;
        _rightButton.Click -= OnRightActionClick;
        SizeChanged -= OnSizeChanged;
        PointerPressed -= OnPointerPressed;
        PointerMoved -= OnPointerMoved;
        PointerReleased -= OnPointerReleased;
        PointerCanceled -= OnPointerCanceled;
        PointerCaptureLost -= OnPointerCanceled;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SwipeRowAutomationPeer(this);

    private static FontIcon NewIcon() => new()
    {
        FontFamily = new FontFamily("Segoe Fluent Icons"),
        FontSize = IconFontSize,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private static TextBlock NewLabel() => new()
    {
        FontSize = LabelFontSize,
        FontWeight = Microsoft.UI.Text.FontWeights.Medium,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private static Button NewActionButton(FontIcon icon, TextBlock label)
    {
        var stack = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        stack.Children.Add(icon);
        stack.Children.Add(label);

        return new Button
        {
            Content = stack,
            Background = new SolidColorBrush(Colors.Transparent),
            BorderThickness = new Thickness(0),
            CornerRadius = new CornerRadius(0),
            Padding = new Thickness(8, 0, 8, 0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            IsTabStop = false,
        };
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SwipeRowViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        // web overflow-hidden: clip the revealed underlay + the overshooting content to the row bounds.
        _root.Clip = new RectangleGeometry { Rect = new Rect(0, 0, e.NewSize.Width, e.NewSize.Height) };
    }

    private void Render()
    {
        SwipeRowProjection projection = _viewModel.Projection;

        ConfigureActionPanel(_rightPanel, _rightButton, _rightIcon, _rightLabel, projection.RightAction);
        ConfigureActionPanel(_leftPanel, _leftButton, _leftIcon, _leftLabel, projection.LeftAction);

        bool active = projection.IsActive;

        // Inactive (fine pointer / no action): the content host is a transparent passthrough and the underlay is
        // hidden — visually identical to rendering the bare child (web `if (!active) return <>{children}</>`).
        _contentHost.Background = active ? DisplayTokens.Surface : new SolidColorBrush(Colors.Transparent);

        if (!active)
        {
            ResetGesture();
            _translate.X = 0;
            _restingOffset = 0;
        }

        UpdateActionReachability(_restingOffset);
    }

    private void ConfigureActionPanel(Border panel, Button button, FontIcon icon, TextBlock label, SwipeActionModel? action)
    {
        if (action is null)
        {
            panel.Visibility = Visibility.Collapsed;
            return;
        }

        panel.Width = _viewModel.ActionWidth;
        panel.Visibility = _viewModel.IsActive ? Visibility.Visible : Visibility.Collapsed;

        (Brush background, Brush foreground) = ResolveToneBrushes(action.Tone);
        panel.Background = background;
        icon.Foreground = foreground;
        icon.Glyph = action.Glyph;
        label.Foreground = foreground;
        label.Text = action.Label;

        AutomationProperties.SetName(button, action.AccessibleName);
    }

    private static (Brush Background, Brush Foreground) ResolveToneBrushes(SwipeActionTone tone)
    {
        // web actionPanelClasses: danger paints rose, default paints cyan — a translucent tone background (/20)
        // with a same-tone foreground for the icon + label.
        string key = tone == SwipeActionTone.Danger ? "TsColorDangerBrush" : "TsColorInfoBrush";
        Brush foreground = DisplayTokens.Brush(key);
        Color toneColor = foreground is SolidColorBrush solid ? solid.Color : Colors.Gray;
        var background = new SolidColorBrush(Color.FromArgb((byte)ToneBackgroundAlpha, toneColor.R, toneColor.G, toneColor.B));
        return (background, foreground);
    }

    private void UpdateActionReachability(double offset)
    {
        // web tabIndex: each action button is reachable only while its side is revealed (offset sign), and the
        // closed side is occluded by the content host so it cannot be tapped.
        bool rightRevealed = offset < 0 && _viewModel.HasRightAction;
        bool leftRevealed = offset > 0 && _viewModel.HasLeftAction;
        _rightButton.IsTabStop = rightRevealed;
        _leftButton.IsTabStop = leftRevealed;
    }

    private double RowWidth => ActualWidth > 0 ? ActualWidth : 320;

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsActive)
        {
            return;
        }

        PointerPoint point = e.GetCurrentPoint(this);
        if (point.Properties.IsRightButtonPressed || point.Properties.IsMiddleButtonPressed)
        {
            return;
        }

        StopSnap();
        Point position = point.Position;
        _startX = position.X;
        _startY = position.Y;
        _dragging = false;
        _cancelled = false;
        _hapticFired = false;
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsActive || _cancelled)
        {
            return;
        }

        Point position = e.GetCurrentPoint(this).Position;
        double dx = position.X - _startX;
        double dy = position.Y - _startY;

        // Dominant vertical drift before engaging: abandon so the parent list keeps scrolling (web vertical abort).
        if (!_dragging && SwipeGeometry.IsVerticalCancel(dx, dy))
        {
            _cancelled = true;
            return;
        }

        // Lock onto the horizontal axis only once the user has moved past the engage threshold (web 8 px guard).
        if (!_dragging && !SwipeGeometry.IsHorizontalEngaged(dx))
        {
            return;
        }

        if (!_dragging)
        {
            _dragging = true;
            CapturePointer(e.Pointer);
        }

        double offset = SwipeGeometry.ClampOffset(dx, RowWidth, _viewModel.HasLeftAction, _viewModel.HasRightAction);

        // Fire a single haptic blip the first time the reveal threshold is crossed (web navigator.vibrate(10)).
        if (!_hapticFired && SwipeGeometry.CrossedReveal(offset, _viewModel.RevealThreshold))
        {
            _hapticFired = true;
            _haptic.Pulse(SwipeRowRegistration.HapticPulseMs);
        }

        _translate.X = offset;
        UpdateActionReachability(offset);
        e.Handled = true;
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsActive)
        {
            return;
        }

        bool wasDragging = _dragging;
        bool wasCancelled = _cancelled;
        double finalOffset = _translate.X;
        ResetGesture();
        ReleasePointerCaptures();

        if (wasCancelled || !wasDragging)
        {
            SettleTo(0);
            return;
        }

        SwipeRelease release = SwipeGeometry.ResolveRelease(
            finalOffset,
            RowWidth,
            _viewModel.RevealThreshold,
            _viewModel.HasLeftAction,
            _viewModel.HasRightAction);

        switch (release.Outcome)
        {
            case SwipeOutcome.FireRight:
                _viewModel.InvokeRightAction();
                SettleTo(0);
                break;
            case SwipeOutcome.FireLeft:
                _viewModel.InvokeLeftAction();
                SettleTo(0);
                break;
            case SwipeOutcome.PeekRight:
            case SwipeOutcome.PeekLeft:
            case SwipeOutcome.None:
            default:
                SettleTo(release.RestingOffset);
                break;
        }

        e.Handled = true;
    }

    private void OnPointerCanceled(object sender, PointerRoutedEventArgs e)
    {
        if (!_viewModel.IsActive)
        {
            return;
        }

        ResetGesture();
        ReleasePointerCaptures();
        SettleTo(0);
    }

    private void OnLeftActionClick(object sender, RoutedEventArgs e)
    {
        _viewModel.InvokeLeftAction();
        SettleTo(0);
    }

    private void OnRightActionClick(object sender, RoutedEventArgs e)
    {
        _viewModel.InvokeRightAction();
        SettleTo(0);
    }

    private void ResetGesture()
    {
        _dragging = false;
        _cancelled = false;
        _hapticFired = false;
    }

    private void SettleTo(double target)
    {
        StopSnap();
        _restingOffset = target;
        UpdateActionReachability(target);

        int duration = MotionDuration.Resolve(_viewModel.ReduceMotion, SwipeRowRegistration.SnapDurationMs);
        if (duration <= 0)
        {
            // Reduced motion (web duration-fast -> 0ms): snap straight to the resting offset.
            _translate.X = target;
            return;
        }

        var animation = new DoubleAnimation
        {
            To = target,
            Duration = new Duration(TimeSpan.FromMilliseconds(duration)),
            EnableDependentAnimation = true,
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(animation, _translate);
        Storyboard.SetTargetProperty(animation, "X");

        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);
        _snap = storyboard;
        storyboard.Begin();
    }

    private void StopSnap()
    {
        _snap?.Stop();
        _snap = null;
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
    /// The system coarse-pointer source backing the production view — reports whether a touch digitizer is present
    /// (the native proxy for the web <c>(pointer: coarse)</c> media query) via
    /// <see cref="Windows.Devices.Input.TouchCapabilities"/>. The capability does not change at runtime on a fixed
    /// device, so the change subscription is intentionally inert (the read-once policy the peer surfaces use).
    /// </summary>
    private sealed class SystemCoarsePointerSource : ICoarsePointerSource
    {
        public bool IsCoarsePointer => new Windows.Devices.Input.TouchCapabilities().TouchPresent != 0;

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
                // Read-once: the touch capability is not observed for runtime changes.
            }
        }
    }

    /// <summary>
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag once
    /// through <see cref="MotionPreference"/> (the read-once policy every motion-aware control in this app uses;
    /// the runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change event).
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

    private sealed class SwipeRowAutomationPeer : FrameworkElementAutomationPeer
    {
        public SwipeRowAutomationPeer(SwipeRow owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetClassNameCore() => nameof(SwipeRow);
    }
}
