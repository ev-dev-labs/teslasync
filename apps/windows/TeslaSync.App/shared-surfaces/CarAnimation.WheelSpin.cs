using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using Line = Microsoft.UI.Xaml.Shapes.Line;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>WheelSpin</c> — a parity port of the fourth export of
/// <c>web/src/components/motion/CarAnimation.tsx</c>. The web component is a spinning-wheel loading indicator for
/// drive-related states: a muted tyre + hub with five spokes that rotate continuously. This surface reproduces it
/// from the geometry and timeline in <see cref="CarAnimationRegistration"/> using a <see cref="Viewbox"/>-scaled
/// set of shapes and a linear XAML Storyboard. All state flows through <see cref="WheelSpinViewModel"/>; the view
/// performs no I/O. It is reduced-motion-aware: under the OS "animations off" preference the wheel renders static
/// with no spin (the web <c>prefers-reduced-motion</c> short-circuit). It is an image (web <c>role="img"</c>)
/// named by the i18n <c>carAnimation.loading</c> label, and emits the <c>view.opened</c> diagnostic exactly once
/// on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class WheelSpin : CarAnimationControl
{
    private readonly WheelSpinViewModel _viewModel;

    private readonly Viewbox _viewbox = new()
    {
        Stretch = Stretch.Uniform,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Ellipse _tyre;
    private readonly Ellipse _hub;
    private readonly Canvas _spokes = new()
    {
        Width = CarAnimationRegistration.WheelSpinViewBox,
        Height = CarAnimationRegistration.WheelSpinViewBox,
    };

    private readonly RotateTransform _spin = new()
    {
        CenterX = CarAnimationRegistration.WheelSpinCenter,
        CenterY = CarAnimationRegistration.WheelSpinCenter,
    };

    private readonly List<Line> _spokeLines = new();

    private Storyboard? _storyboard;

    /// <summary>Creates the wheel over the i18n passthrough and the system reduce-motion preference.</summary>
    public WheelSpin()
        : this(CarAnimationRegistration.WheelSpinDefaultSize, localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the wheel over the web prop, the i18n facade and the system reduce-motion preference.</summary>
    /// <param name="size">The size (web <c>size</c>; defaults to 24).</param>
    /// <param name="localizer">The i18n facade the label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WheelSpin(double size, ILocalizer? localizer = null, CarAnimationDiagnostics? diagnostics = null)
        : this(
            new WheelSpinViewModel(size, localizer ?? PassthroughLocalizer.Instance, new CarAnimationMotionSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the wheel over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WheelSpin(WheelSpinViewModel viewModel, CarAnimationDiagnostics? diagnostics = null)
        : base(diagnostics)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        _viewModel = viewModel;

        _tyre = new Ellipse
        {
            Width = CarAnimationRegistration.WheelSpinTyreRadius * 2,
            Height = CarAnimationRegistration.WheelSpinTyreRadius * 2,
            StrokeThickness = CarAnimationRegistration.WheelSpinTyreStrokeWidth,
        };
        Canvas.SetLeft(_tyre, CarAnimationRegistration.WheelSpinCenter - CarAnimationRegistration.WheelSpinTyreRadius);
        Canvas.SetTop(_tyre, CarAnimationRegistration.WheelSpinCenter - CarAnimationRegistration.WheelSpinTyreRadius);

        _hub = new Ellipse
        {
            Width = CarAnimationRegistration.WheelSpinHubRadius * 2,
            Height = CarAnimationRegistration.WheelSpinHubRadius * 2,
            StrokeThickness = CarAnimationRegistration.WheelSpinHubStrokeWidth,
        };
        Canvas.SetLeft(_hub, CarAnimationRegistration.WheelSpinCenter - CarAnimationRegistration.WheelSpinHubRadius);
        Canvas.SetTop(_hub, CarAnimationRegistration.WheelSpinCenter - CarAnimationRegistration.WheelSpinHubRadius);

        foreach (double angle in CarAnimationRegistration.WheelSpinSpokeAngles)
        {
            var spoke = new Line
            {
                X1 = CarAnimationRegistration.WheelSpinCenter,
                Y1 = CarAnimationRegistration.WheelSpinSpokeInner,
                X2 = CarAnimationRegistration.WheelSpinCenter,
                Y2 = CarAnimationRegistration.WheelSpinSpokeOuter,
                StrokeThickness = CarAnimationRegistration.WheelSpinSpokeStrokeWidth,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                RenderTransform = new RotateTransform
                {
                    Angle = angle,
                    CenterX = CarAnimationRegistration.WheelSpinCenter,
                    CenterY = CarAnimationRegistration.WheelSpinCenter,
                },
            };
            _spokeLines.Add(spoke);
            _spokes.Children.Add(spoke);
        }

        _spokes.RenderTransform = _spin;

        var canvas = new Canvas
        {
            Width = CarAnimationRegistration.WheelSpinViewBox,
            Height = CarAnimationRegistration.WheelSpinViewBox,
        };
        canvas.Children.Add(_tyre);
        canvas.Children.Add(_hub);
        canvas.Children.Add(_spokes);
        _viewbox.Child = canvas;
        Content = _viewbox;

        AutomationProperties.SetAccessibilityView(_viewbox, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, CarAnimationRegistration.WheelSpinAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Render();
    }

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public WheelSpinViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the automation peer reports (the i18n <c>carAnimation.loading</c> label).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>The size (web <c>size</c> prop). Assigning a new value re-sizes the wheel.</summary>
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
        WheelSpinProjection projection = _viewModel.Projection;

        if (!IsLive || !projection.Animate)
        {
            StopStoryboard();
            _spin.Angle = 0;
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
        if (e.PropertyName == nameof(WheelSpinViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        WheelSpinProjection projection = _viewModel.Projection;

        Width = projection.Size;
        Height = projection.Size;
        _viewbox.Width = projection.Size;
        _viewbox.Height = projection.Size;

        Color textMuted = CarAnimationVisuals.TextMutedColor();
        _tyre.Fill = CarAnimationVisuals.Brush(CarAnimationVisuals.Surface3Color());
        _tyre.Stroke = CarAnimationVisuals.Brush(textMuted);
        _hub.Fill = CarAnimationVisuals.Brush(CarAnimationVisuals.Surface1Color());
        _hub.Stroke = CarAnimationVisuals.Brush(textMuted);
        SolidColorBrush spokeBrush = CarAnimationVisuals.Brush(textMuted);
        foreach (Line spoke in _spokeLines)
        {
            spoke.Stroke = spokeBrush;
        }

        AutomationProperties.SetName(this, projection.AccessibleName);

        ApplyMotionState();
    }

    private void StartStoryboard()
    {
        StopStoryboard();

        _spin.Angle = 0;

        var spin = new DoubleAnimation
        {
            From = 0,
            To = 360,
            Duration = new Duration(TimeSpan.FromMilliseconds(CarAnimationRegistration.WheelSpinDurationMs)),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(spin, _spin);
        Storyboard.SetTargetProperty(spin, "Angle");

        var storyboard = new Storyboard();
        storyboard.Children.Add(spin);
        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }
}
