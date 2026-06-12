using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using Windows.UI;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using Path = Microsoft.UI.Xaml.Shapes.Path;
using Rectangle = Microsoft.UI.Xaml.Shapes.Rectangle;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>CarAnimation</c> silhouette — a parity port of the first export of
/// <c>web/src/components/motion/CarAnimation.tsx</c>. The web component is a decorative animated Tesla
/// silhouette for loading states and hero sections: a cyan outline that draws itself around a surface-filled
/// body, windshield + rear window that fade in, four wheels that pop in on a spring, a head/tail-light pair that
/// pulse on a loop and a ground shadow that grows. This surface reproduces it from the geometry and timeline in
/// <see cref="CarAnimationRegistration"/> using a <see cref="Viewbox"/>-scaled <see cref="Canvas"/> of shapes and
/// XAML Storyboards (the platform animation idiom here). All state flows through
/// <see cref="CarAnimationViewModel"/>; the view performs no I/O. It is reduced-motion-aware: under the OS
/// "animations off" preference every element renders in its final state with no draw-in, pop, pulse or grow (the
/// web <c>prefers-reduced-motion</c> short-circuit). Because the component reads no network data (its only inputs
/// are caller-supplied props), there is no loading / error / stale / offline chrome — the reproduced branches are
/// the full-motion animated illustration and the reduced-motion static one. It is an image
/// (web <c>role="img"</c>) named by the i18n <c>carAnimation.tesla</c> label, and emits the <c>view.opened</c>
/// diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class CarAnimation : CarAnimationControl
{
    private readonly CarAnimationViewModel _viewModel;

    private readonly Viewbox _viewbox = new()
    {
        Stretch = Stretch.Uniform,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Canvas _canvas = new()
    {
        Width = CarAnimationRegistration.CarViewBoxWidth,
        Height = CarAnimationRegistration.CarViewBoxHeight,
    };

    private readonly Path _body;
    private readonly Path _windshield;
    private readonly Path _rearWindow;
    private readonly Ellipse _frontTyre;
    private readonly Ellipse _frontHub;
    private readonly Ellipse _rearTyre;
    private readonly Ellipse _rearHub;
    private readonly Ellipse _headlight;
    private readonly Rectangle _taillight;
    private readonly Ellipse _groundShadow;

    private readonly ScaleTransform _frontTyreScale = CenterScale();
    private readonly ScaleTransform _frontHubScale = CenterScale();
    private readonly ScaleTransform _rearTyreScale = CenterScale();
    private readonly ScaleTransform _rearHubScale = CenterScale();
    private readonly ScaleTransform _shadowScale = new() { ScaleX = 1, ScaleY = 1 };

    private Storyboard? _storyboard;

    /// <summary>Creates the silhouette over the i18n passthrough and the system reduce-motion preference.</summary>
    public CarAnimation()
        : this(CarAnimationRegistration.CarDefaultSize, localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the silhouette over the web prop, the i18n facade and the system reduce-motion preference.</summary>
    /// <param name="size">The width (web <c>size</c>; defaults to 120).</param>
    /// <param name="localizer">The i18n facade the label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CarAnimation(double size, Core.Notifications.ILocalizer? localizer = null, CarAnimationDiagnostics? diagnostics = null)
        : this(
            new CarAnimationViewModel(size, localizer ?? Core.Notifications.PassthroughLocalizer.Instance, new CarAnimationMotionSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the silhouette over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CarAnimation(CarAnimationViewModel viewModel, CarAnimationDiagnostics? diagnostics = null)
        : base(diagnostics)
    {
        ArgumentNullException.ThrowIfNull(viewModel);
        _viewModel = viewModel;

        _body = new Path
        {
            Data = CarAnimationVisuals.ParseGeometry(CarAnimationRegistration.BodyPathData),
            StrokeThickness = CarAnimationRegistration.BodyStrokeWidth,
            StrokeLineJoin = PenLineJoin.Round,
        };
        _windshield = new Path
        {
            Data = CarAnimationVisuals.ParseGeometry(CarAnimationRegistration.WindshieldPathData),
            StrokeThickness = CarAnimationRegistration.WindshieldStrokeWidth,
            StrokeLineJoin = PenLineJoin.Round,
        };
        _rearWindow = new Path
        {
            Data = CarAnimationVisuals.ParseGeometry(CarAnimationRegistration.RearWindowPathData),
            StrokeThickness = CarAnimationRegistration.RearWindowStrokeWidth,
            StrokeLineJoin = PenLineJoin.Round,
        };

        _frontTyre = Tyre(_frontTyreScale, CarAnimationRegistration.FrontWheelCenterX);
        _frontHub = Hub(_frontHubScale, CarAnimationRegistration.FrontWheelCenterX);
        _rearTyre = Tyre(_rearTyreScale, CarAnimationRegistration.RearWheelCenterX);
        _rearHub = Hub(_rearHubScale, CarAnimationRegistration.RearWheelCenterX);

        _headlight = new Ellipse
        {
            Width = CarAnimationRegistration.Headlight.RadiusX * 2,
            Height = CarAnimationRegistration.Headlight.RadiusY * 2,
        };
        Canvas.SetLeft(_headlight, CarAnimationRegistration.Headlight.CenterX - CarAnimationRegistration.Headlight.RadiusX);
        Canvas.SetTop(_headlight, CarAnimationRegistration.Headlight.CenterY - CarAnimationRegistration.Headlight.RadiusY);

        _taillight = new Rectangle
        {
            Width = CarAnimationRegistration.Taillight.Width,
            Height = CarAnimationRegistration.Taillight.Height,
            RadiusX = CarAnimationRegistration.Taillight.CornerRadius,
            RadiusY = CarAnimationRegistration.Taillight.CornerRadius,
        };
        Canvas.SetLeft(_taillight, CarAnimationRegistration.Taillight.X);
        Canvas.SetTop(_taillight, CarAnimationRegistration.Taillight.Y);

        _groundShadow = new Ellipse
        {
            Width = CarAnimationRegistration.GroundShadow.RadiusX * 2,
            Height = CarAnimationRegistration.GroundShadow.RadiusY * 2,
            RenderTransform = _shadowScale,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
        };
        Canvas.SetLeft(_groundShadow, CarAnimationRegistration.GroundShadow.CenterX - CarAnimationRegistration.GroundShadow.RadiusX);
        Canvas.SetTop(_groundShadow, CarAnimationRegistration.GroundShadow.CenterY - CarAnimationRegistration.GroundShadow.RadiusY);

        // web SVG paint order: body, windshield, rear window, wheels, headlight, taillight, ground shadow.
        _canvas.Children.Add(_body);
        _canvas.Children.Add(_windshield);
        _canvas.Children.Add(_rearWindow);
        _canvas.Children.Add(_rearTyre);
        _canvas.Children.Add(_rearHub);
        _canvas.Children.Add(_frontTyre);
        _canvas.Children.Add(_frontHub);
        _canvas.Children.Add(_headlight);
        _canvas.Children.Add(_taillight);
        _canvas.Children.Add(_groundShadow);

        _viewbox.Child = _canvas;
        Content = _viewbox;

        // web role="img": the silhouette is a single named image; its shapes are decorative.
        AutomationProperties.SetAccessibilityView(_viewbox, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, CarAnimationRegistration.CarAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Render();
    }

    /// <summary>The canonical surface slug (<c>CarAnimation</c>).</summary>
    public static string Slug => CarAnimationRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public CarAnimationViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the automation peer reports (the i18n <c>carAnimation.tesla</c> label).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>The width (web <c>size</c> prop). Assigning a new value re-sizes the silhouette.</summary>
    public double Size
    {
        get => _viewModel.Projection.Width;
        set => _viewModel.SetSize(value);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ImageAutomationPeer(this, () => AccessibleName);

    /// <inheritdoc />
    protected override void ApplyMotionState()
    {
        CarAnimationProjection projection = _viewModel.Projection;

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

    private static ScaleTransform CenterScale() => new() { ScaleX = 1, ScaleY = 1 };

    private static Ellipse Tyre(ScaleTransform scale, double centerX)
    {
        var tyre = new Ellipse
        {
            Width = CarAnimationRegistration.WheelTyreRadius * 2,
            Height = CarAnimationRegistration.WheelTyreRadius * 2,
            StrokeThickness = CarAnimationRegistration.WheelTyreStrokeWidth,
            RenderTransform = scale,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
        };
        Canvas.SetLeft(tyre, centerX - CarAnimationRegistration.WheelTyreRadius);
        Canvas.SetTop(tyre, CarAnimationRegistration.WheelCenterY - CarAnimationRegistration.WheelTyreRadius);
        return tyre;
    }

    private static Ellipse Hub(ScaleTransform scale, double centerX)
    {
        var hub = new Ellipse
        {
            Width = CarAnimationRegistration.WheelHubRadius * 2,
            Height = CarAnimationRegistration.WheelHubRadius * 2,
            StrokeThickness = CarAnimationRegistration.WheelHubStrokeWidth,
            RenderTransform = scale,
            RenderTransformOrigin = new Windows.Foundation.Point(0.5, 0.5),
        };
        Canvas.SetLeft(hub, centerX - CarAnimationRegistration.WheelHubRadius);
        Canvas.SetTop(hub, CarAnimationRegistration.WheelCenterY - CarAnimationRegistration.WheelHubRadius);
        return hub;
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(CarAnimationViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        CarAnimationProjection projection = _viewModel.Projection;

        Width = projection.Width;
        Height = projection.Height;
        _viewbox.Width = projection.Width;
        _viewbox.Height = projection.Height;

        Color themePrimary = CarAnimationVisuals.ThemePrimaryColor();
        Color textMuted = CarAnimationVisuals.TextMutedColor();

        _body.Fill = CarAnimationVisuals.Brush(CarAnimationVisuals.Surface2Color());
        _body.Stroke = CarAnimationVisuals.Brush(themePrimary);

        _windshield.Fill = CarAnimationVisuals.Brush(themePrimary, CarAnimationRegistration.WindshieldFillOpacity);
        _windshield.Stroke = CarAnimationVisuals.Brush(themePrimary, CarAnimationRegistration.WindshieldStrokeOpacity);

        _rearWindow.Fill = CarAnimationVisuals.Brush(themePrimary, CarAnimationRegistration.RearWindowFillOpacity);
        _rearWindow.Stroke = CarAnimationVisuals.Brush(themePrimary, CarAnimationRegistration.RearWindowStrokeOpacity);

        Color surface3 = CarAnimationVisuals.Surface3Color();
        Color surface1 = CarAnimationVisuals.Surface1Color();
        _frontTyre.Fill = CarAnimationVisuals.Brush(surface3);
        _frontTyre.Stroke = CarAnimationVisuals.Brush(textMuted);
        _rearTyre.Fill = CarAnimationVisuals.Brush(surface3);
        _rearTyre.Stroke = CarAnimationVisuals.Brush(textMuted);
        _frontHub.Fill = CarAnimationVisuals.Brush(surface1);
        _frontHub.Stroke = CarAnimationVisuals.Brush(textMuted);
        _rearHub.Fill = CarAnimationVisuals.Brush(surface1);
        _rearHub.Stroke = CarAnimationVisuals.Brush(textMuted);

        _headlight.Fill = CarAnimationVisuals.Brush(themePrimary, CarAnimationRegistration.HeadlightOpacity);
        _taillight.Fill = CarAnimationVisuals.Brush(CarAnimationVisuals.HexColor(CarAnimationRegistration.TaillightHex), CarAnimationRegistration.TaillightOpacity);
        _groundShadow.Fill = CarAnimationVisuals.Brush(textMuted, CarAnimationRegistration.GroundShadowOpacity);

        AutomationProperties.SetName(this, projection.AccessibleName);

        ApplyMotionState();
    }

    private void ApplyStaticFrame()
    {
        // The reduced-motion / pre-load frame: every element in its final, fully-revealed state.
        _body.StrokeDashArray = new DoubleCollection();
        _body.StrokeDashOffset = 0;
        _windshield.Opacity = 1;
        _rearWindow.Opacity = 1;
        SetScale(_frontTyreScale, 1);
        SetScale(_frontHubScale, 1);
        SetScale(_rearTyreScale, 1);
        SetScale(_rearHubScale, 1);
        _headlight.Opacity = CarAnimationRegistration.HeadlightOpacity;
        _taillight.Opacity = CarAnimationRegistration.TaillightOpacity;
        _shadowScale.ScaleX = 1;
        _shadowScale.ScaleY = 1;
    }

    private void StartStoryboard()
    {
        StopStoryboard();

        // Set the pre-animation initial frame so the entrances start hidden / collapsed.
        double dashUnit = CarAnimationVisuals.DashUnits(CarAnimationRegistration.BodyOutlineDrawUnits, CarAnimationRegistration.BodyStrokeWidth);
        _body.StrokeDashArray = new DoubleCollection { dashUnit, dashUnit };
        _body.StrokeDashOffset = dashUnit;
        _windshield.Opacity = 0;
        _rearWindow.Opacity = 0;
        SetScale(_frontTyreScale, 0);
        SetScale(_frontHubScale, 0);
        SetScale(_rearTyreScale, 0);
        SetScale(_rearHubScale, 0);
        _headlight.Opacity = 0;
        _taillight.Opacity = 0;
        _shadowScale.ScaleX = 0;
        _shadowScale.ScaleY = 1;

        var storyboard = new Storyboard();

        // Body: the cyan outline draws itself (web pathLength 0 -> 1).
        var draw = new DoubleAnimation
        {
            From = dashUnit,
            To = 0,
            Duration = Ms(CarAnimationRegistration.BodyDrawDurationMs),
            EnableDependentAnimation = true,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
        };
        Storyboard.SetTarget(draw, _body);
        Storyboard.SetTargetProperty(draw, "StrokeDashOffset");
        storyboard.Children.Add(draw);

        AddFade(storyboard, _windshield, CarAnimationRegistration.WindshieldDelayMs, CarAnimationRegistration.WindshieldDurationMs);
        AddFade(storyboard, _rearWindow, CarAnimationRegistration.RearWindowDelayMs, CarAnimationRegistration.RearWindowDurationMs);

        AddPop(storyboard, _frontTyreScale, CarAnimationRegistration.FrontTyreDelayMs);
        AddPop(storyboard, _frontHubScale, CarAnimationRegistration.FrontHubDelayMs);
        AddPop(storyboard, _rearTyreScale, CarAnimationRegistration.RearTyreDelayMs);
        AddPop(storyboard, _rearHubScale, CarAnimationRegistration.RearHubDelayMs);

        AddPulse(storyboard, _headlight, CarAnimationRegistration.HeadlightPulse, CarAnimationRegistration.HeadlightPulseDelayMs);
        AddPulse(storyboard, _taillight, CarAnimationRegistration.TaillightPulse, CarAnimationRegistration.TaillightPulseDelayMs);

        AddShadowGrow(storyboard);

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopStoryboard()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private static void AddFade(Storyboard storyboard, UIElement target, int delayMs, int durationMs)
    {
        var fade = new DoubleAnimation
        {
            From = 0,
            To = 1,
            BeginTime = TimeSpan.FromMilliseconds(delayMs),
            Duration = Ms(durationMs),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(fade, target);
        Storyboard.SetTargetProperty(fade, "Opacity");
        storyboard.Children.Add(fade);
    }

    private static void AddPop(Storyboard storyboard, ScaleTransform target, int delayMs)
    {
        // web spring pop-in: a back-eased scale from 0 to 1 (the native stand-in for the framer spring).
        foreach (string property in new[] { "ScaleX", "ScaleY" })
        {
            var pop = new DoubleAnimation
            {
                From = 0,
                To = 1,
                BeginTime = TimeSpan.FromMilliseconds(delayMs),
                Duration = Ms(CarAnimationRegistration.WheelPopDurationMs),
                EnableDependentAnimation = true,
                EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.4 },
            };
            Storyboard.SetTarget(pop, target);
            Storyboard.SetTargetProperty(pop, property);
            storyboard.Children.Add(pop);
        }
    }

    private static void AddPulse(Storyboard storyboard, UIElement target, IReadOnlyList<double> keyframes, int delayMs)
    {
        var pulse = new DoubleAnimationUsingKeyFrames
        {
            BeginTime = TimeSpan.FromMilliseconds(delayMs),
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        for (var i = 0; i < keyframes.Count; i++)
        {
            double fraction = keyframes.Count == 1 ? 1 : (double)i / (keyframes.Count - 1);
            pulse.KeyFrames.Add(new LinearDoubleKeyFrame
            {
                KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(fraction * CarAnimationRegistration.LightPulseDurationMs)),
                Value = keyframes[i],
            });
        }

        Storyboard.SetTarget(pulse, target);
        Storyboard.SetTargetProperty(pulse, "Opacity");
        storyboard.Children.Add(pulse);
    }

    private void AddShadowGrow(Storyboard storyboard)
    {
        var grow = new DoubleAnimation
        {
            From = 0,
            To = 1,
            BeginTime = TimeSpan.FromMilliseconds(CarAnimationRegistration.GroundShadowDelayMs),
            Duration = Ms(CarAnimationRegistration.GroundShadowDurationMs),
            EnableDependentAnimation = true,
            EasingFunction = new SineEase { EasingMode = EasingMode.EaseOut },
        };
        Storyboard.SetTarget(grow, _shadowScale);
        Storyboard.SetTargetProperty(grow, "ScaleX");
        storyboard.Children.Add(grow);
    }

    private static void SetScale(ScaleTransform transform, double value)
    {
        transform.ScaleX = value;
        transform.ScaleY = value;
    }

    private static Duration Ms(int milliseconds) => new(TimeSpan.FromMilliseconds(milliseconds));
}

/// <summary>
/// Shared lifecycle for the CarAnimation surface's image controls — the native stand-in for the web components'
/// mount/unmount effects. Wires the <see cref="FrameworkElement.Loaded"/> / <see cref="FrameworkElement.Unloaded"/>
/// pair, emits the <c>view.opened</c> diagnostic exactly once on first load, marshals view-model callbacks onto
/// the UI thread and disposes deterministically on unload. Derived controls implement
/// <see cref="ApplyMotionState"/> (start/stop their Storyboards for the full-motion / reduced-motion branch) and
/// <see cref="DisposeCore"/> (release their state holder + animations).
/// </summary>
public abstract partial class CarAnimationControl : ContentControl, IDisposable
{
    private readonly CarAnimationDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private bool _loaded;
    private bool _opened;
    private bool _disposed;

    /// <summary>Initialises the shared lifecycle over an optional PII-safe diagnostics sink.</summary>
    /// <param name="diagnostics">The diagnostics collector for the <c>view.opened</c> event.</param>
    protected CarAnimationControl(CarAnimationDiagnostics? diagnostics)
    {
        _diagnostics = diagnostics ?? new CarAnimationDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Center;
        VerticalContentAlignment = VerticalAlignment.Center;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Whether the control is currently loaded into the visual tree (animations only run when live).</summary>
    protected bool IsLive => _loaded;

    /// <summary>Start or stop the control's animations for the current motion / projection state.</summary>
    protected abstract void ApplyMotionState();

    /// <summary>Release the control's state holder and animations (called once on unload / dispose).</summary>
    protected abstract void DisposeCore();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        DisposeCore();
        GC.SuppressFinalize(this);
    }

    /// <summary>Marshal <paramref name="action"/> onto the control's UI thread when invoked from elsewhere.</summary>
    /// <param name="action">The work to run on the UI thread.</param>
    protected void Marshal(Action action)
    {
        ArgumentNullException.ThrowIfNull(action);
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        _loaded = true;

        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mount: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        ApplyMotionState();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}

/// <summary>
/// The automation peer the CarAnimation surface's labelled illustrations expose — an image control type
/// (web <c>role="img"</c>) named by the surface's resolved i18n label.
/// </summary>
public sealed class ImageAutomationPeer : FrameworkElementAutomationPeer
{
    private readonly Func<string> _name;

    /// <summary>Creates the peer over its owner and a callback that resolves the current accessible name.</summary>
    /// <param name="owner">The owning control.</param>
    /// <param name="name">A callback returning the current accessible name.</param>
    public ImageAutomationPeer(FrameworkElement owner, Func<string> name)
        : base(owner)
    {
        _name = name ?? (static () => string.Empty);
    }

    /// <inheritdoc />
    protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

    /// <inheritdoc />
    protected override string GetNameCore()
    {
        string name = base.GetNameCore();
        return string.IsNullOrEmpty(name) ? _name() : name;
    }
}

/// <summary>
/// Shape / brush helpers shared by the CarAnimation surface's views. Resolves the web theme CSS variables the
/// illustrations paint with to the generated design tokens — <c>--theme-primary</c> → the accent token,
/// <c>--surface-1</c> → the surface token (with <c>--surface-2</c> / <c>--surface-3</c> derived as progressive
/// white-overlay elevations so light/dark both track the token), <c>--text-muted</c> → the muted-text token —
/// falling back to the web dark-theme hex when a token is unavailable (the headless / unhosted case). The
/// taillight and battery-band colours are intentionally fixed literals (the web uses semantic colours there, not
/// theme tokens).
/// </summary>
internal static class CarAnimationVisuals
{
    /// <summary>Parse SVG path-markup into a WinUI <see cref="Geometry"/> (the shared path-data convention).</summary>
    /// <param name="path">The SVG path-markup string.</param>
    public static Geometry ParseGeometry(string path) =>
        (Geometry)XamlBindingHelper.ConvertValue(typeof(Geometry), path);

    /// <summary>Resolve the web <c>--theme-primary</c> colour (the accent token; falls back to <c>#00F0FF</c>).</summary>
    public static Color ThemePrimaryColor() => ColorOf(DisplayTokens.Accent, "#00F0FF");

    /// <summary>Resolve the web <c>--surface-1</c> colour (the surface token; falls back to <c>#0F1019</c>).</summary>
    public static Color Surface1Color() => ColorOf(DisplayTokens.Surface, "#0F1019");

    /// <summary>Resolve the web <c>--text-muted</c> colour (the muted-text token; falls back to <c>#8A95A6</c>).</summary>
    public static Color TextMutedColor() => ColorOf(DisplayTokens.TextMuted, "#8A95A6");

    /// <summary>Derive the web <c>--surface-2</c> elevation (a subtle white overlay over surface-1).</summary>
    public static Color Surface2Color() => Lighten(Surface1Color(), 0.06);

    /// <summary>Derive the web <c>--surface-3</c> elevation (a larger white overlay over surface-1).</summary>
    public static Color Surface3Color() => Lighten(Surface1Color(), 0.12);

    /// <summary>Build a <see cref="SolidColorBrush"/> over <paramref name="color"/> at <paramref name="opacity"/>.</summary>
    /// <param name="color">The brush colour.</param>
    /// <param name="opacity">The brush opacity (0..1).</param>
    public static SolidColorBrush Brush(Color color, double opacity = 1) => new(color) { Opacity = opacity };

    /// <summary>Parse a <c>#RRGGBB</c> hex string into an opaque <see cref="Color"/> (transparent on malformed input).</summary>
    /// <param name="hex">The hex string.</param>
    public static Color HexColor(string hex)
    {
        if (hex.Length == 7 && hex[0] == '#'
            && byte.TryParse(hex.AsSpan(1, 2), System.Globalization.NumberStyles.HexNumber, null, out byte r)
            && byte.TryParse(hex.AsSpan(3, 2), System.Globalization.NumberStyles.HexNumber, null, out byte g)
            && byte.TryParse(hex.AsSpan(5, 2), System.Globalization.NumberStyles.HexNumber, null, out byte b))
        {
            return Color.FromArgb(0xFF, r, g, b);
        }

        return Color.FromArgb(0, 0, 0, 0);
    }

    /// <summary>The dash length, in stroke-thickness units, for a draw-on stroke of <paramref name="userLength"/>.</summary>
    /// <param name="userLength">The dash length in canvas user units.</param>
    /// <param name="thickness">The stroke thickness in canvas user units.</param>
    public static double DashUnits(double userLength, double thickness) =>
        thickness > 0 ? userLength / thickness : userLength;

    private static Color ColorOf(Brush brush, string fallbackHex) =>
        brush is SolidColorBrush solid && solid.Color.A != 0 ? solid.Color : HexColor(fallbackHex);

    private static Color Lighten(Color color, double amount)
    {
        byte Mix(byte channel) => (byte)Math.Clamp(channel + ((255 - channel) * amount), 0, 255);
        return Color.FromArgb(color.A, Mix(color.R), Mix(color.G), Mix(color.B));
    }
}

/// <summary>
/// The system reduce-motion source backing the production CarAnimation views — reads the OS "show animations"
/// flag once through <see cref="MotionPreference"/> (the read-once policy the peer motion-aware surfaces use; the
/// runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change event). Lives
/// with the views so the WinUI-free state-holder layer stays portable to the headless test host.
/// </summary>
internal sealed class CarAnimationMotionSource : IMotionPreferenceSource
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
