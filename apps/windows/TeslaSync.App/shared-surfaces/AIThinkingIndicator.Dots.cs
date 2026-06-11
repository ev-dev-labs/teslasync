using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The compact in-button thinking indicator — a parity port of the web <c>AIThinkingDots</c> sibling exported
/// from <c>web/src/components/ai/AIThinkingIndicator.tsx</c>. It renders a caller-supplied label followed by
/// three small bouncing dots, sized for an action-button row where the full skeleton-line
/// <see cref="AIThinkingIndicator"/> is too tall (the web doc-comment's exact rationale). The dots take the
/// current foreground colour (web <c>bg-current</c>) so they match the surrounding button text, and the label
/// is the accessible name (the dots are decorative, the web <c>aria-hidden</c> span). It is reduced-motion-aware
/// the same way as the full indicator: under the OS reduce-motion preference the dots are static (the web
/// <c>motion-safe:animate-bounce</c>). The label is already-translated by the caller, mirroring the web prop
/// (the component performs no i18n of its own).
/// </summary>
public sealed partial class AIThinkingDots : ContentControl
{
    private const double DotSpacing = 2;        // web gap-0.5
    private const double LabelDotsSpacing = 6;  // web gap-1.5
    private const double DotSize = 4;           // web h-1 w-1
    private const double DotBounceOffset = -3;  // web animate-bounce rise
    private const int DotCount = 3;             // web three dots
    private const int DotBounceMs = 600;
    private const int DotStaggerMs = 150;       // web -0.15s cadence between dots

    /// <summary>The already-translated leading label (web required <c>label</c> prop).</summary>
    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label),
        typeof(string),
        typeof(AIThinkingDots),
        new PropertyMetadata(string.Empty, OnLabelChanged));

    private readonly TextBlock _label = new()
    {
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _dots = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = DotSpacing,
        VerticalAlignment = VerticalAlignment.Bottom,
    };

    private readonly List<TranslateTransform> _dotTransforms = new();
    private readonly List<Ellipse> _dotShapes = new();

    private Storyboard? _bounceStoryboard;
    private long _foregroundToken;

    /// <summary>Creates the compact dots indicator with an empty label.</summary>
    public AIThinkingDots()
        : this(string.Empty)
    {
    }

    /// <summary>Creates the compact dots indicator with the supplied already-translated label.</summary>
    /// <param name="label">The leading label shown before the bouncing dots.</param>
    public AIThinkingDots(string label)
    {
        IsTabStop = false;
        VerticalContentAlignment = VerticalAlignment.Center;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LabelDotsSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        BuildDots();
        row.Children.Add(_label);
        row.Children.Add(_dots);

        // The label is the accessible text; the dots are decorative (the web aria-hidden span).
        AutomationProperties.SetAccessibilityView(_dots, AccessibilityView.Raw);

        Content = row;
        Label = label;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The already-translated leading label shown before the dots.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DotsAutomationPeer(this);

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((AIThinkingDots)d).ApplyLabel();

    private void BuildDots()
    {
        for (var i = 0; i < DotCount; i++)
        {
            var transform = new TranslateTransform();
            _dotTransforms.Add(transform);
            var dot = new Ellipse
            {
                Width = DotSize,
                Height = DotSize,
                VerticalAlignment = VerticalAlignment.Bottom,
                RenderTransform = transform,
            };
            _dotShapes.Add(dot);
            _dots.Children.Add(dot);
        }
    }

    private void ApplyLabel()
    {
        var label = Label ?? string.Empty;
        _label.Text = label;
        AutomationProperties.SetName(this, label);
    }

    private void ApplyDotTint()
    {
        // web bg-current: the dots inherit the surrounding text colour. Fall back to the accent tint when no
        // foreground has been set so the dots stay visible in isolation.
        var brush = Foreground ?? DisplayTokens.Accent;
        foreach (var dot in _dotShapes)
        {
            dot.Fill = brush;
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        ApplyLabel();
        ApplyDotTint();
        _foregroundToken = RegisterPropertyChangedCallback(ForegroundProperty, OnForegroundChanged);
        StartBounce(!MotionPreference.ReduceMotion);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e)
    {
        UnregisterPropertyChangedCallback(ForegroundProperty, _foregroundToken);
        StopBounce();
    }

    private void OnForegroundChanged(DependencyObject sender, DependencyProperty dp) => ApplyDotTint();

    private void StartBounce(bool animate)
    {
        StopBounce();
        if (!animate)
        {
            foreach (var transform in _dotTransforms)
            {
                transform.Y = 0;
            }

            return;
        }

        var storyboard = new Storyboard();
        for (var i = 0; i < _dotTransforms.Count; i++)
        {
            var animation = new DoubleAnimation
            {
                From = 0,
                To = DotBounceOffset,
                Duration = new Duration(TimeSpan.FromMilliseconds(DotBounceMs)),
                BeginTime = TimeSpan.FromMilliseconds((long)i * DotStaggerMs),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EnableDependentAnimation = true,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            };
            Storyboard.SetTarget(animation, _dotTransforms[i]);
            Storyboard.SetTargetProperty(animation, "Y");
            storyboard.Children.Add(animation);
        }

        _bounceStoryboard = storyboard;
        storyboard.Begin();
    }

    private void StopBounce()
    {
        _bounceStoryboard?.Stop();
        _bounceStoryboard = null;
    }

    private sealed class DotsAutomationPeer : FrameworkElementAutomationPeer
    {
        public DotsAutomationPeer(AIThinkingDots owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Text;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIThinkingDots)Owner).Label
                : name;
        }
    }
}
