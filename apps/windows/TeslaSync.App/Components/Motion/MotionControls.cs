using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Core.Motion;

namespace TeslaSync.App.Components.Motion;

/// <summary>
/// Fades (and gently rises) its content in on load (port of the web <c>FadeIn</c>).
/// Honours the OS reduce-motion setting: when animations are disabled the content
/// is shown immediately in its final position with no transition.
/// </summary>
public partial class TsFadeIn : ContentControl
{
    private readonly TranslateTransform _translate = new();

    public static readonly DependencyProperty DelayMsProperty = DependencyProperty.Register(
        nameof(DelayMs), typeof(int), typeof(TsFadeIn), new PropertyMetadata(0));

    public static readonly DependencyProperty DurationMsProperty = DependencyProperty.Register(
        nameof(DurationMs), typeof(int), typeof(TsFadeIn), new PropertyMetadata(MotionDuration.DefaultMs));

    public static readonly DependencyProperty OffsetYProperty = DependencyProperty.Register(
        nameof(OffsetY), typeof(double), typeof(TsFadeIn), new PropertyMetadata(12.0));

    public TsFadeIn()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        RenderTransform = _translate;
        Loaded += OnLoaded;
    }

    /// <summary>Delay before the entrance starts, in milliseconds.</summary>
    public int DelayMs
    {
        get => (int)GetValue(DelayMsProperty);
        set => SetValue(DelayMsProperty, value);
    }

    /// <summary>Entrance duration in milliseconds (collapses to 0 under reduce-motion).</summary>
    public int DurationMs
    {
        get => (int)GetValue(DurationMsProperty);
        set => SetValue(DurationMsProperty, value);
    }

    /// <summary>Initial vertical offset the content rises from, in pixels.</summary>
    public double OffsetY
    {
        get => (double)GetValue(OffsetYProperty);
        set => SetValue(OffsetYProperty, value);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        bool reduce = MotionPreference.ReduceMotion;
        int duration = MotionDuration.Resolve(reduce, DurationMs);

        if (!MotionDuration.ShouldAnimate(reduce) || duration == 0)
        {
            Opacity = 1;
            _translate.Y = 0;
            return;
        }

        Opacity = 0;
        _translate.Y = OffsetY;
        var begin = TimeSpan.FromMilliseconds(Math.Max(0, DelayMs));
        var span = new Duration(TimeSpan.FromMilliseconds(duration));

        var fade = new DoubleAnimation { From = 0, To = 1, Duration = span, BeginTime = begin, EnableDependentAnimation = true };
        Storyboard.SetTarget(fade, this);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var rise = new DoubleAnimation
        {
            From = OffsetY,
            To = 0,
            Duration = span,
            BeginTime = begin,
            EnableDependentAnimation = true,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(rise, _translate);
        Storyboard.SetTargetProperty(rise, "Y");

        var storyboard = new Storyboard();
        storyboard.Children.Add(fade);
        storyboard.Children.Add(rise);
        storyboard.Begin();
    }
}

/// <summary>
/// Cross-fades its content whenever <see cref="ContentControl.Content"/> changes
/// (port of the web <c>RouteTransition</c> used between page swaps). Reduce-motion
/// disables the fade and swaps content instantly.
/// </summary>
public partial class TsRouteTransition : ContentControl
{
    public static readonly DependencyProperty DurationMsProperty = DependencyProperty.Register(
        nameof(DurationMs), typeof(int), typeof(TsRouteTransition), new PropertyMetadata(180));

    public TsRouteTransition()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
    }

    /// <summary>Cross-fade duration in milliseconds.</summary>
    public int DurationMs
    {
        get => (int)GetValue(DurationMsProperty);
        set => SetValue(DurationMsProperty, value);
    }

    /// <summary>Replay the entrance fade for the current content.</summary>
    protected override void OnContentChanged(object oldContent, object newContent)
    {
        base.OnContentChanged(oldContent, newContent);

        bool reduce = MotionPreference.ReduceMotion;
        int duration = MotionDuration.Resolve(reduce, DurationMs);
        if (duration == 0)
        {
            Opacity = 1;
            return;
        }

        Opacity = 0;
        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = new Duration(TimeSpan.FromMilliseconds(duration)),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, this);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var storyboard = new Storyboard();
        storyboard.Children.Add(fade);
        storyboard.Begin();
    }
}

/// <summary>
/// A vertical stack that staggers the entrance of its children (port of the web
/// <c>StaggerContainer</c> + <c>StaggerItem</c>). Each direct child fades/rises in
/// with an increasing delay; reduce-motion shows them all at once. Add
/// <see cref="TsStaggerItem"/> children (or any element — they are wrapped).
/// </summary>
public partial class TsStaggerContainer : ContentControl
{
    private readonly StackPanel _stack = new() { Spacing = 12 };

    public static readonly DependencyProperty StepMsProperty = DependencyProperty.Register(
        nameof(StepMs), typeof(int), typeof(TsStaggerContainer), new PropertyMetadata(60));

    public static readonly DependencyProperty SpacingProperty = DependencyProperty.Register(
        nameof(Spacing), typeof(double), typeof(TsStaggerContainer),
        new PropertyMetadata(12.0, OnSpacingChanged));

    public TsStaggerContainer()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Content = _stack;
        Loaded += OnLoaded;
    }

    /// <summary>Per-child delay step in milliseconds (collapses to 0 under reduce-motion).</summary>
    public int StepMs
    {
        get => (int)GetValue(StepMsProperty);
        set => SetValue(StepMsProperty, value);
    }

    /// <summary>Vertical gap between staggered children.</summary>
    public double Spacing
    {
        get => (double)GetValue(SpacingProperty);
        set => SetValue(SpacingProperty, value);
    }

    /// <summary>The staggered children.</summary>
    public IList<UIElement> Items => _stack.Children;

    /// <summary>Add a child to the staggered stack.</summary>
    public void Add(UIElement child)
    {
        ArgumentNullException.ThrowIfNull(child);
        _stack.Children.Add(child);
    }

    private static void OnSpacingChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStaggerContainer)d)._stack.Spacing = (double)e.NewValue;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        bool reduce = MotionPreference.ReduceMotion;
        int step = MotionDuration.StaggerStepMs(reduce, StepMs);
        int duration = MotionDuration.Resolve(reduce);

        int index = 0;
        foreach (var child in _stack.Children)
        {
            if (child is not FrameworkElement fe)
            {
                index++;
                continue;
            }

            if (!MotionDuration.ShouldAnimate(reduce) || duration == 0)
            {
                fe.Opacity = 1;
                index++;
                continue;
            }

            AnimateChild(fe, (step * index) + 10, duration);
            index++;
        }
    }

    private static void AnimateChild(FrameworkElement child, int delayMs, int durationMs)
    {
        var translate = new TranslateTransform { Y = 10 };
        child.RenderTransform = translate;
        child.Opacity = 0;

        var begin = TimeSpan.FromMilliseconds(delayMs);
        var span = new Duration(TimeSpan.FromMilliseconds(durationMs));

        var fade = new DoubleAnimation { From = 0, To = 1, Duration = span, BeginTime = begin, EnableDependentAnimation = true };
        Storyboard.SetTarget(fade, child);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var rise = new DoubleAnimation
        {
            From = 10,
            To = 0,
            Duration = span,
            BeginTime = begin,
            EnableDependentAnimation = true,
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(rise, translate);
        Storyboard.SetTargetProperty(rise, "Y");

        var storyboard = new Storyboard();
        storyboard.Children.Add(fade);
        storyboard.Children.Add(rise);
        storyboard.Begin();
    }
}

/// <summary>
/// A single staggered item (port of the web <c>StaggerItem</c>). Hosts content for
/// a <see cref="TsStaggerContainer"/>; on its own it behaves as a plain content
/// holder so it is also usable standalone.
/// </summary>
public partial class TsStaggerItem : ContentControl
{
    public TsStaggerItem()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
    }
}
