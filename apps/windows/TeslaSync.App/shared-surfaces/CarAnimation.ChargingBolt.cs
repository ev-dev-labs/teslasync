using System.ComponentModel;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>ChargingBolt</c> — a parity port of the second export of
/// <c>web/src/components/motion/CarAnimation.tsx</c>. The web component is an animated charging-bolt icon for
/// charging-related pages: a theme-tinted lightning glyph that slides up into view, then pulses its fill opacity
/// on a loop. This surface reproduces it from the bolt geometry and timeline in
/// <see cref="CarAnimationRegistration"/> using a <see cref="Viewbox"/>-scaled <see cref="Path"/> and XAML
/// Storyboards. All state flows through <see cref="ChargingBoltViewModel"/>; the view performs no I/O. It is
/// reduced-motion-aware: under the OS "animations off" preference the bolt renders statically at its rest fill
/// opacity with no entry slide or pulse (the web <c>prefers-reduced-motion</c> short-circuit). It is an image
/// (web <c>role="img"</c>) named by the i18n <c>carAnimation.charging</c> label, and emits the <c>view.opened</c>
/// diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class ChargingBolt : CarAnimationControl
{
    private readonly ChargingBoltViewModel _viewModel;

    private readonly Viewbox _viewbox = new()
    {
        Stretch = Stretch.Uniform,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
    };

    private readonly TranslateTransform _entry = new();
    private readonly SolidColorBrush _fill;
    private readonly Path _bolt;

    private Storyboard? _storyboard;

    /// <summary>Creates the bolt over the i18n passthrough and the system reduce-motion preference.</summary>
    public ChargingBolt()
        : this(CarAnimationRegistration.ChargingBoltDefaultSize, localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the bolt over the web prop, the i18n facade and the system reduce-motion preference.</summary>
    /// <param name="size">The size (web <c>size</c>; defaults to 32).</param>
    /// <param name="localizer">The i18n facade the label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingBolt(double size, ILocalizer? localizer = null, CarAnimationDiagnostics? diagnostics = null)
        : this(
            new ChargingBoltViewModel(size, localizer ?? PassthroughLocalizer.Instance, new CarAnimationMotionSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the bolt over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingBolt(ChargingBoltViewModel viewModel, CarAnimationDiagnostics? diagnostics = null)
        : base(diagnostics)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        _viewModel = viewModel;

        _fill = new SolidColorBrush(Colors.Transparent) { Opacity = CarAnimationRegistration.BoltFillOpacity };
        _bolt = new Path
        {
            Data = CarAnimationVisuals.ParseGeometry(CarAnimationRegistration.BoltPathData),
            Fill = _fill,
            StrokeThickness = CarAnimationRegistration.BoltStrokeWidth,
            StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
        };

        var canvas = new Canvas
        {
            Width = CarAnimationRegistration.ChargingBoltViewBox,
            Height = CarAnimationRegistration.ChargingBoltViewBox,
        };
        canvas.Children.Add(_bolt);
        _viewbox.Child = canvas;
        _viewbox.RenderTransform = _entry;
        Content = _viewbox;

        AutomationProperties.SetAccessibilityView(_viewbox, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, CarAnimationRegistration.ChargingBoltAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Render();
    }

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public ChargingBoltViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the automation peer reports (the i18n <c>carAnimation.charging</c> label).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>The size (web <c>size</c> prop). Assigning a new value re-sizes the bolt.</summary>
    public double Size
    {
        get => _viewModel.Projection.Size;
        set => _viewModel.SetSize(value);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ImageAutomationPeer(this, () => AccessibleName);

    /// <inheritdoc />
    protected override void ApplyMotionState()
    {
        ChargingBoltProjection projection = _viewModel.Projection;

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

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ChargingBoltViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        ChargingBoltProjection projection = _viewModel.Projection;

        Width = projection.Size;
        Height = projection.Size;
        _viewbox.Width = projection.Size;
        _viewbox.Height = projection.Size;

        Color themePrimary = CarAnimationVisuals.ThemePrimaryColor();
        _fill.Color = themePrimary;
        _bolt.Stroke = CarAnimationVisuals.Brush(themePrimary);

        AutomationProperties.SetName(this, projection.AccessibleName);

        ApplyMotionState();
    }

    private void ApplyStaticFrame()
    {
        _entry.Y = 0;
        _viewbox.Opacity = 1;
        _fill.Opacity = CarAnimationRegistration.BoltFillOpacity;
    }

    private void StartStoryboard()
    {
        StopStoryboard();

        _entry.Y = CarAnimationRegistration.BoltEntryRise;
        _viewbox.Opacity = 0;
        _fill.Opacity = CarAnimationRegistration.BoltPulse[0];

        var storyboard = new Storyboard();

        var slide = new DoubleAnimation
        {
            From = CarAnimationRegistration.BoltEntryRise,
            To = 0,
            Duration = Ms(CarAnimationRegistration.BoltEntryDurationMs),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(slide, _entry);
        Storyboard.SetTargetProperty(slide, "Y");
        storyboard.Children.Add(slide);

        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            Duration = Ms(CarAnimationRegistration.BoltEntryDurationMs),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, _viewbox);
        Storyboard.SetTargetProperty(fade, "Opacity");
        storyboard.Children.Add(fade);

        var pulse = new DoubleAnimationUsingKeyFrames
        {
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        IReadOnlyList<double> keyframes = CarAnimationRegistration.BoltPulse;
        for (var i = 0; i < keyframes.Count; i++)
        {
            double fraction = keyframes.Count == 1 ? 1 : (double)i / (keyframes.Count - 1);
            pulse.KeyFrames.Add(new EasingDoubleKeyFrame
            {
                KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(fraction * CarAnimationRegistration.BoltPulseDurationMs)),
                Value = keyframes[i],
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            });
        }

        Storyboard.SetTarget(pulse, _fill);
        Storyboard.SetTargetProperty(pulse, "Opacity");
        storyboard.Children.Add(pulse);

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
