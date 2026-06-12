using System.ComponentModel;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Windows.UI;
using Rectangle = Microsoft.UI.Xaml.Shapes.Rectangle;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>BatteryFillAnimation</c> — a parity port of the third export of
/// <c>web/src/components/motion/CarAnimation.tsx</c>. The web component is an animated battery fill gauge: a
/// muted outline + terminal nub with a coloured fill bar that grows to the battery level, where the colour is
/// green / amber / red by the level band. This surface reproduces it from the geometry, colour bands and
/// timeline in <see cref="CarAnimationRegistration"/> using a <see cref="Viewbox"/>-scaled set of
/// <see cref="Rectangle"/>s and XAML Storyboards. All state flows through <see cref="BatteryFillViewModel"/>; the
/// view performs no I/O. It is reduced-motion-aware: under the OS "animations off" preference the fill jumps
/// straight to its target width with no entry fade or grow (the web <c>prefers-reduced-motion</c> short-circuit).
/// The gauge is decorative in the web source (no <c>role</c> / <c>aria-label</c>), so it is exposed to assistive
/// tech as a raw, unnamed element. It emits the <c>view.opened</c> diagnostic exactly once on
/// <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class BatteryFillAnimation : CarAnimationControl
{
    private readonly BatteryFillViewModel _viewModel;

    private readonly Viewbox _viewbox = new()
    {
        Stretch = Stretch.Uniform,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Rectangle _outline;
    private readonly Rectangle _terminal;
    private readonly Rectangle _fill;
    private readonly SolidColorBrush _fillBrush = new(Colors.Transparent);

    private Storyboard? _storyboard;

    /// <summary>Creates the gauge over the system reduce-motion preference, at the web prop defaults.</summary>
    public BatteryFillAnimation()
        : this(
            new BatteryFillViewModel(CarAnimationRegistration.BatteryDefaultLevel, CarAnimationRegistration.BatteryDefaultSize, new CarAnimationMotionSource()),
            diagnostics: null)
    {
    }

    /// <summary>Creates the gauge over the web props and the system reduce-motion preference.</summary>
    /// <param name="level">The battery level percentage (web <c>level</c>; defaults to 80).</param>
    /// <param name="size">The size (web <c>size</c>; defaults to 48).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryFillAnimation(double level, double size, CarAnimationDiagnostics? diagnostics = null)
        : this(new BatteryFillViewModel(level, size, new CarAnimationMotionSource()), diagnostics)
    {
    }

    /// <summary>Creates the gauge over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BatteryFillAnimation(BatteryFillViewModel viewModel, CarAnimationDiagnostics? diagnostics = null)
        : base(diagnostics)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        _viewModel = viewModel;

        _outline = RoundedRect(CarAnimationRegistration.BatteryOutline);
        _outline.StrokeThickness = CarAnimationRegistration.BatteryOutlineStrokeWidth;

        _terminal = RoundedRect(CarAnimationRegistration.BatteryTerminal);

        _fill = new Rectangle
        {
            Height = CarAnimationRegistration.BatteryFillHeight,
            RadiusX = CarAnimationRegistration.BatteryFillCornerRadius,
            RadiusY = CarAnimationRegistration.BatteryFillCornerRadius,
            Fill = _fillBrush,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Canvas.SetLeft(_fill, CarAnimationRegistration.BatteryFillX);
        Canvas.SetTop(_fill, CarAnimationRegistration.BatteryFillY);

        var canvas = new Canvas
        {
            Width = CarAnimationRegistration.BatteryViewBoxWidth,
            Height = CarAnimationRegistration.BatteryViewBoxHeight,
        };
        canvas.Children.Add(_outline);
        canvas.Children.Add(_terminal);
        canvas.Children.Add(_fill);
        _viewbox.Child = canvas;
        Content = _viewbox;

        // web: the gauge declares no role / aria-label — it is purely decorative.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_viewbox, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, CarAnimationRegistration.BatteryFillAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Render();
    }

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public BatteryFillViewModel ViewModel => _viewModel;

    /// <summary>The battery level percentage (web <c>level</c> prop). Assigning a new value re-fills the gauge.</summary>
    public double Level
    {
        set => _viewModel.SetLevel(value);
    }

    /// <summary>The size (web <c>size</c> prop). Assigning a new value re-sizes the gauge.</summary>
    public double Size
    {
        get => _viewModel.Projection.Size;
        set => _viewModel.SetSize(value);
    }

    /// <inheritdoc />
    protected override void ApplyMotionState()
    {
        BatteryFillProjection projection = _viewModel.Projection;

        if (!IsLive || !projection.Animate)
        {
            StopStoryboard();
            ApplyStaticFrame();
            return;
        }

        StartStoryboard();
    }

    /// <inheritdoc />
    protected override void DisposeCore()
    {
        StopStoryboard();
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
    }

    private static Rectangle RoundedRect(RectSpec spec)
    {
        var rect = new Rectangle
        {
            Width = spec.Width,
            Height = spec.Height,
            RadiusX = spec.CornerRadius,
            RadiusY = spec.CornerRadius,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
        };
        Canvas.SetLeft(rect, spec.X);
        Canvas.SetTop(rect, spec.Y);
        return rect;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(BatteryFillViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        BatteryFillProjection projection = _viewModel.Projection;

        Width = projection.Width;
        Height = projection.Height;
        _viewbox.Width = projection.Width;
        _viewbox.Height = projection.Height;

        Color textMuted = CarAnimationVisuals.TextMutedColor();
        _outline.Stroke = CarAnimationVisuals.Brush(textMuted);
        _terminal.Fill = CarAnimationVisuals.Brush(textMuted, CarAnimationRegistration.BatteryTerminalOpacity);
        _fillBrush.Color = CarAnimationVisuals.HexColor(projection.FillColorHex);

        ApplyMotionState();
    }

    private void ApplyStaticFrame()
    {
        _viewbox.Opacity = 1;
        _fill.Width = _viewModel.Projection.FillWidth;
    }

    private void StartStoryboard()
    {
        StopStoryboard();

        double target = _viewModel.Projection.FillWidth;
        _viewbox.Opacity = 0;
        _fill.Width = 0;

        var storyboard = new Storyboard();

        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = Ms(CarAnimationRegistration.BatteryEntryDurationMs),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, _viewbox);
        Storyboard.SetTargetProperty(fade, "Opacity");
        storyboard.Children.Add(fade);

        var grow = new DoubleAnimation
        {
            From = 0,
            To = target,
            BeginTime = TimeSpan.FromMilliseconds(CarAnimationRegistration.BatteryFillDelayMs),
            Duration = Ms(CarAnimationRegistration.BatteryFillDurationMs),
            EnableDependentAnimation = true,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(grow, _fill);
        Storyboard.SetTargetProperty(grow, "Width");
        storyboard.Children.Add(grow);

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private static Duration Ms(int milliseconds) => new(TimeSpan.FromMilliseconds(milliseconds));
}
