using System.ComponentModel;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Windows.UI;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 Spinner surface — a parity port of <c>web/src/components/feedback/Spinner.tsx</c>. The web
/// component is the brand loading mark: a lightning bolt that draws itself like a strike, fills to solid, holds,
/// then fades and redraws, lit by a cyan/emerald electrical glow (the web <c>.spinner-bolt-glow</c> drop-shadow
/// stack over <c>--theme-primary</c> / <c>--theme-accent</c>). There is no spinning ring and no background tile —
/// just the bolt, optionally captioned. This surface reproduces it with a closed, filled
/// <see cref="Path"/> built from the bolt vertices, two thicker colour-tinted stroke copies behind it for the
/// glow halo (the native stand-in for the web blur drop-shadow, since the platform animation idiom here is
/// XAML Storyboards rather than Composition), and a 2-second looping Storyboard that reproduces the web
/// <c>@keyframes boltDraw</c> timeline by animating each copy's stroke-dash offset (the draw), the white fill's
/// opacity (the fill-in) and the mark's overall opacity (the fade). All state flows through
/// <see cref="SpinnerViewModel"/>; the view performs no I/O. It is reduced-motion-aware: under the OS
/// "animations off" preference the bolt snaps to a solid filled mark with no draw cycle (the web
/// <c>prefers-reduced-motion</c> short-circuit). Because the component reads no network data (its only inputs are
/// caller-supplied props), there is no loading / error / stale / offline chrome — the spinner <em>is</em> the
/// loading state; the reproduced branches are the full-motion self-drawing bolt, the reduced-motion static fill,
/// the with/without caption variants and the three size variants. It is a polite status live region (web
/// <c>role="status"</c>) named by the caller's label or the i18n default ("Loading"), and emits the
/// <c>view.opened</c> diagnostic exactly once on <see cref="FrameworkElement.Loaded"/>.
/// </summary>
public sealed partial class Spinner : ContentControl, IDisposable
{
    private const double RootSpacing = 12;        // web gap-3 between the bolt and the caption
    private const double LabelFontSize = 14;      // web text-sm caption
    private const double CyanGlowExtraStroke = 8; // inner cyan halo thickness over the main stroke (200-space)
    private const double EmeraldGlowExtraStroke = 18; // outer emerald halo thickness over the main stroke
    private const double CyanGlowOpacity = 0.55;  // inner halo strength (web ~4px drop-shadow)
    private const double EmeraldGlowOpacity = 0.38; // outer halo strength (web ~10px drop-shadow)

    private readonly SpinnerViewModel _viewModel;
    private readonly SpinnerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Vertical,
        Spacing = RootSpacing,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Viewbox _boltBox = new()
    {
        Stretch = Stretch.Uniform,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private readonly Grid _boltCanvas = new()
    {
        Width = SpinnerRegistration.ViewBoxSize,
        Height = SpinnerRegistration.ViewBoxSize,
    };

    private readonly SolidColorBrush _mainStrokeBrush = new(Colors.White);
    private readonly SolidColorBrush _mainFillBrush = new(Colors.White) { Opacity = 0 };
    private readonly Path _emeraldGlow;
    private readonly Path _cyanGlow;
    private readonly Path _mainBolt;

    private readonly TextBlock _label = new()
    {
        FontSize = LabelFontSize,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private Storyboard? _storyboard;
    private bool _loaded;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates a medium, captionless loading mark over the i18n passthrough and the system reduce-motion
    /// preference (the parameterless designer / host entry point).
    /// </summary>
    public Spinner()
        : this(SpinnerSize.Medium, label: null, localizer: null, diagnostics: null)
    {
    }

    /// <summary>Creates the loading mark over the web props, the i18n facade and the system reduce-motion preference.</summary>
    /// <param name="size">The size (web <c>size</c>; defaults to medium).</param>
    /// <param name="label">The caption shown beneath the bolt, or null for none (web <c>label</c>).</param>
    /// <param name="localizer">The i18n facade the default label resolves through; null uses the passthrough.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Spinner(
        SpinnerSize size,
        string? label = null,
        ILocalizer? localizer = null,
        SpinnerDiagnostics? diagnostics = null)
        : this(
            new SpinnerViewModel(size, label, localizer ?? PassthroughLocalizer.Instance, new SystemMotionPreferenceSource()),
            diagnostics)
    {
    }

    /// <summary>Creates the loading mark over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public Spinner(SpinnerViewModel viewModel, SpinnerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new SpinnerDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _emeraldGlow = BuildBoltPath(ColorFromHex(SpinnerRegistration.GlowAccentHex), EmeraldGlowOpacity);
        _cyanGlow = BuildBoltPath(ColorFromHex(SpinnerRegistration.GlowPrimaryHex), CyanGlowOpacity);
        _mainBolt = new Path
        {
            Data = BuildBoltGeometry(),
            Stroke = _mainStrokeBrush,
            Fill = _mainFillBrush,
            StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeDashCap = PenLineCap.Round,
        };

        IsTabStop = false;

        _boltCanvas.Children.Add(_emeraldGlow);
        _boltCanvas.Children.Add(_cyanGlow);
        _boltCanvas.Children.Add(_mainBolt);
        _boltBox.Child = _boltCanvas;

        _root.Children.Add(_boltBox);
        _root.Children.Add(_label);
        Content = _root;

        // web role="status" aria-live="polite": a polite status live region. The bolt + caption are decorative
        // for navigation; the control's Narrator name (the label, or the i18n "Loading" default) is authoritative.
        LiveRegion.Configure(this);
        AutomationProperties.SetAccessibilityView(_boltBox, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_label, AccessibilityView.Raw);
        AutomationProperties.SetAutomationId(this, SpinnerRegistration.RootAutomationId);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>Spinner</c>).</summary>
    public static string Slug => SpinnerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SpinnerViewModel ViewModel => _viewModel;

    /// <summary>The accessible name the automation peer reports (the caption or the i18n "Loading" default).</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>The size (web <c>size</c> prop). Assigning a new value re-sizes the bolt.</summary>
    public SpinnerSize Size
    {
        get => _viewModel.Size;
        set => _viewModel.SetSize(value);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopDraw();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Set the caption shown beneath the bolt (web <c>label</c> prop); null/blank hides it.</summary>
    /// <param name="label">The new caption, or null/blank for none.</param>
    public void SetLabel(string? label) => _viewModel.SetLabel(label);

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SpinnerAutomationPeer(this);

    private static PathGeometry BuildBoltGeometry()
    {
        IReadOnlyList<BoltPoint> vertices = SpinnerRegistration.BoltVertices;
        var figure = new PathFigure
        {
            StartPoint = new Point(vertices[0].X, vertices[0].Y),
            IsClosed = true,
            IsFilled = true,
        };

        var segment = new PolyLineSegment();
        for (var i = 1; i < vertices.Count; i++)
        {
            segment.Points.Add(new Point(vertices[i].X, vertices[i].Y));
        }

        figure.Segments.Add(segment);
        var geometry = new PathGeometry();
        geometry.Figures.Add(figure);
        return geometry;
    }

    private static Path BuildBoltPath(Color color, double opacity) => new()
    {
        Data = BuildBoltGeometry(),
        Stroke = new SolidColorBrush(color),
        StrokeLineJoin = PenLineJoin.Round,
        StrokeStartLineCap = PenLineCap.Round,
        StrokeEndLineCap = PenLineCap.Round,
        StrokeDashCap = PenLineCap.Round,
        Opacity = opacity,
    };

    private static Color ColorFromHex(string hex)
    {
        string value = hex.TrimStart('#');
        byte r = Convert.ToByte(value.Substring(0, 2), 16);
        byte g = Convert.ToByte(value.Substring(2, 2), 16);
        byte b = Convert.ToByte(value.Substring(4, 2), 16);
        return Color.FromArgb(0xFF, r, g, b);
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
        LiveRegion.Announce(this);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SpinnerViewModel.Projection))
        {
            Marshal(Render);
        }
    }

    private void Render()
    {
        SpinnerProjection projection = _viewModel.Projection;

        _boltBox.Width = projection.Pixels;
        _boltBox.Height = projection.Pixels;

        _label.Foreground = DisplayTokens.TextSecondary;
        _label.Text = projection.Label;
        _label.Visibility = projection.HasLabel ? Visibility.Visible : Visibility.Collapsed;

        ConfigureStatic(projection);

        AutomationProperties.SetName(this, projection.AccessibleName);

        ApplyMotionState();
    }

    private void ConfigureStatic(SpinnerProjection projection)
    {
        // The initial / reduced-motion frame: solid (or undrawn) stroke + the static fill opacity, before any
        // Storyboard takes over. Mirrors the web inline strokeDasharray / strokeDashoffset / fillOpacity values.
        ConfigureDash(_mainBolt, projection.StrokeWidth, projection.StrokeDashed, projection.InitialDashProgress);
        ConfigureDash(_cyanGlow, projection.StrokeWidth + CyanGlowExtraStroke, projection.StrokeDashed, projection.InitialDashProgress);
        ConfigureDash(_emeraldGlow, projection.StrokeWidth + EmeraldGlowExtraStroke, projection.StrokeDashed, projection.InitialDashProgress);
        _mainFillBrush.Opacity = projection.FillOpacity;
        _boltCanvas.Opacity = 1;
    }

    private void ApplyMotionState()
    {
        SpinnerProjection projection = _viewModel.Projection;

        if (!_loaded || !projection.Animate)
        {
            // Reduced motion (or not yet live): snap to the static filled bolt, no draw cycle.
            StopDraw();
            ConfigureStatic(projection);
            return;
        }

        StartDraw(projection);
    }

    private void StartDraw(SpinnerProjection projection)
    {
        StopDraw();

        var duration = new Duration(TimeSpan.FromMilliseconds(SpinnerRegistration.DrawDurationMs));
        var storyboard = new Storyboard { RepeatBehavior = RepeatBehavior.Forever };

        AddDashAnimation(storyboard, _mainBolt, projection.StrokeWidth, duration);
        AddDashAnimation(storyboard, _cyanGlow, projection.StrokeWidth + CyanGlowExtraStroke, duration);
        AddDashAnimation(storyboard, _emeraldGlow, projection.StrokeWidth + EmeraldGlowExtraStroke, duration);
        AddFillAnimation(storyboard, duration);
        AddOpacityAnimation(storyboard, duration);

        _storyboard = storyboard;
        storyboard.Begin();
    }

    private void StopDraw()
    {
        _storyboard?.Stop();
        _storyboard = null;
    }

    private static void AddDashAnimation(Storyboard storyboard, Path path, double thickness, Duration duration)
    {
        double dashUnit = DashUnit(thickness);
        var animation = new DoubleAnimationUsingKeyFrames { EnableDependentAnimation = true, Duration = duration };
        foreach (SpinnerKeyframe frame in SpinnerRegistration.DrawKeyframes)
        {
            animation.KeyFrames.Add(new EasingDoubleKeyFrame
            {
                KeyTime = KeyTimeFor(frame.Time),
                Value = frame.DashProgress * dashUnit,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            });
        }

        Storyboard.SetTarget(animation, path);
        Storyboard.SetTargetProperty(animation, "StrokeDashOffset");
        storyboard.Children.Add(animation);
    }

    private void AddFillAnimation(Storyboard storyboard, Duration duration)
    {
        var animation = new DoubleAnimationUsingKeyFrames { EnableDependentAnimation = true, Duration = duration };
        foreach (SpinnerKeyframe frame in SpinnerRegistration.DrawKeyframes)
        {
            animation.KeyFrames.Add(new LinearDoubleKeyFrame
            {
                KeyTime = KeyTimeFor(frame.Time),
                Value = frame.FillOpacity,
            });
        }

        Storyboard.SetTarget(animation, _mainFillBrush);
        Storyboard.SetTargetProperty(animation, "Opacity");
        storyboard.Children.Add(animation);
    }

    private void AddOpacityAnimation(Storyboard storyboard, Duration duration)
    {
        var animation = new DoubleAnimationUsingKeyFrames { Duration = duration };
        foreach (SpinnerKeyframe frame in SpinnerRegistration.DrawKeyframes)
        {
            animation.KeyFrames.Add(new LinearDoubleKeyFrame
            {
                KeyTime = KeyTimeFor(frame.Time),
                Value = frame.Opacity,
            });
        }

        Storyboard.SetTarget(animation, _boltCanvas);
        Storyboard.SetTargetProperty(animation, "Opacity");
        storyboard.Children.Add(animation);
    }

    private static void ConfigureDash(Path path, double thickness, bool dashed, double dashProgress)
    {
        path.StrokeThickness = thickness;
        if (dashed)
        {
            double dashUnit = DashUnit(thickness);

            // Dash units are multiples of the stroke thickness; one full-length dash + gap means the whole bolt
            // is either drawn or hidden as the offset sweeps — the native form of the web pathLength=100 trick.
            path.StrokeDashArray = new DoubleCollection { dashUnit, dashUnit };
            path.StrokeDashOffset = dashProgress * dashUnit;
        }
        else
        {
            path.StrokeDashArray = new DoubleCollection();
            path.StrokeDashOffset = 0;
        }
    }

    private static double DashUnit(double thickness) =>
        thickness > 0 ? SpinnerRegistration.BoltPathLength / thickness : SpinnerRegistration.BoltPathLength;

    private static KeyTime KeyTimeFor(double normalisedTime) =>
        KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(normalisedTime * SpinnerRegistration.DrawDurationMs));

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

    private sealed class SpinnerAutomationPeer : FrameworkElementAutomationPeer
    {
        public SpinnerAutomationPeer(Spinner owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((Spinner)Owner).AccessibleName : name;
        }
    }
}
