using System.Globalization;
using Microsoft.UI;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Windows.UI;
using static System.FormattableString;
using Ellipse = Microsoft.UI.Xaml.Shapes.Ellipse;
using Line = Microsoft.UI.Xaml.Shapes.Line;
using Path = Microsoft.UI.Xaml.Shapes.Path;
using Rectangle = Microsoft.UI.Xaml.Shapes.Rectangle;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>TeslaCarViz</c> shared surface — a parity port of
/// web/src/components/data-display/TeslaCarViz.tsx. It is the animated, state-rich vehicle schematic the web app
/// shows on the vehicle hero card / dashboard tiles: a per-model silhouette (Model 3 / S / Y / X, Cybertruck)
/// whose body, roof and windshield are drawn from the web SVG path data, with rotating wheels + headlight beam +
/// streaming speed lines when driving, a pulsing taillight, an animated charge cable + plug when charging, a
/// locked / unlocked lock glyph, climate waves, sentry rings, a battery bar coloured by state-of-charge, a
/// dominant ambient glow (sentry → charging → driving → idle) and a status legend of dots beneath the car. The
/// compact <see cref="TeslaCarVizVariant.Mini"/> reproduces the web <c>&lt;TeslaCarMini&gt;</c> export. Because
/// the web component is purely prop-driven (its parent owns any data fetching and feeds already-resolved live
/// values), it has no fetch-driven loading / error / stale / offline chrome — only the pure state branches above,
/// all of which always render, so this surface reproduces those branches and never hides itself. The structural
/// colours come from the theme-aware <see cref="TeslaCarVizPalette"/> (the web <c>useSvgPalette</c> seam, bound
/// through <see cref="ITeslaCarVizThemeSource"/>); the semantic state colours (battery, lock, charge, climate,
/// sentry) resolve through generated design tokens so they adapt under high contrast. Every animation honours the
/// OS reduce-motion preference. The surface carries a composed accessible description for Narrator and emits the
/// <c>view.opened</c> diagnostic once when shown. All state flows through <see cref="TeslaCarVizViewModel"/>; the
/// view performs no I/O and reads no stream itself.
/// </summary>
public sealed partial class TeslaCarViz : ContentControl, IDisposable
{
    private const int WheelSpinMs = 800;        // web wheel rotate duration
    private const int TaillightPulseMs = 2000;  // web taillight pulse
    private const int SentryRing1Ms = 20000;    // web sentry ring 1 rotation
    private const int SentryRing2Ms = 30000;    // web sentry ring 2 rotation
    private const int ClimateWaveMs = 2000;     // web climate wave rise
    private const int SpeedLineMs = 600;        // web speed line stream
    private const int ChargePulseMs = 1500;     // web charge plug pulse
    private const int BatteryFillMs = 1500;     // web battery bar fill entrance
    private const double ChipDotSize = 8;
    private const double ChipFontSize = 12;
    private const double ChipSpacing = 6;
    private const double LegendSpacing = 12;
    private const double RootSpacing = 8;

    private readonly TeslaCarVizViewModel _viewModel;
    private readonly TeslaCarVizDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Grid _carContainer = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Ellipse _glow = new()
    {
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        IsHitTestVisible = false,
    };

    private readonly Canvas _canvas = new()
    {
        Width = TeslaCarVizRegistration.LogicalWidth,
        Height = TeslaCarVizRegistration.LogicalHeight,
    };

    private readonly Viewbox _viewbox = new() { Stretch = Stretch.Uniform };
    private readonly StackPanel _legend = new() { Orientation = Orientation.Horizontal, Spacing = LegendSpacing };
    private readonly StackPanel _root = new() { Spacing = RootSpacing, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly List<Storyboard> _storyboards = new();
    private readonly bool _ownsElementTheme;

    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no bound seams (the designer / parameterless host entry point): it renders the
    /// <see cref="TeslaCarVizModel.Unknown"/> baseline (an empty, parked, unlocked Model 3) on the dark palette.
    /// Strings resolve through the passthrough localizer; supply an explicit <see cref="ILocalizer"/>, model and
    /// seams via the other constructor to drive i18n, data and theming from the composition root.
    /// </summary>
    public TeslaCarViz()
        : this(PassthroughLocalizer.Instance, TeslaCarVizModel.Unknown, themeSource: null, motionSource: null, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the surface over the i18n facade, an initial model and (optional) theme / motion seams and
    /// diagnostics. When the theme seam is omitted the production source reads the control's effective
    /// <c>ActualTheme</c>; when the motion seam is omitted it reads the OS reduce-motion preference.
    /// </summary>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    /// <param name="model">The initial render model (the web props).</param>
    /// <param name="themeSource">The colour-scheme seam (web <c>useTheme</c>); null binds the control's <c>ActualTheme</c>.</param>
    /// <param name="motionSource">The reduce-motion seam; null binds the OS preference.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaCarViz(
        ILocalizer localizer,
        TeslaCarVizModel model,
        ITeslaCarVizThemeSource? themeSource = null,
        IMotionPreferenceSource? motionSource = null,
        TeslaCarVizDiagnostics? diagnostics = null)
        : this(
            new TeslaCarVizViewModel(
                localizer,
                themeSource ?? new ElementThemeSource(),
                motionSource ?? new SystemMotionPreferenceSource(),
                model),
            diagnostics)
    {
        // When the theme source is the default element-bound one, wire it to this control's ActualTheme.
        if (themeSource is null)
        {
            _ownsElementTheme = true;
            ActualThemeChanged += OnActualThemeChanged;
        }
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaCarViz(TeslaCarVizViewModel viewModel, TeslaCarVizDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new TeslaCarVizDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Center;
        VerticalContentAlignment = VerticalAlignment.Center;

        _viewbox.Child = _canvas;
        _carContainer.Children.Add(_glow);
        _carContainer.Children.Add(_viewbox);
        _root.Children.Add(_carContainer);
        _root.Children.Add(_legend);
        Content = _root;

        // web role="img": the schematic is one decorative image whose accessible name describes the state.
        AutomationProperties.SetAutomationId(this, TeslaCarVizRegistration.RootAutomationId);
        AutomationProperties.SetAccessibilityView(_carContainer, AccessibilityView.Raw);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>TeslaCarViz</c>).</summary>
    public static string Slug => TeslaCarVizRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TeslaCarVizViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible description the automation peer reports.</summary>
    internal string AccessibleName => _viewModel.AutomationName;

    /// <summary>The render model (the web props); reassigning re-projects and re-renders.</summary>
    public TeslaCarVizModel Model
    {
        get => _viewModel.Model;
        set => _viewModel.Model = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopAnimations();
        if (_ownsElementTheme)
        {
            ActualThemeChanged -= OnActualThemeChanged;
        }

        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TeslaCarVizAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        // Sync the palette to the now-realized effective theme, then start the looping animations.
        if (_ownsElementTheme && _viewModel.ThemeSource is ElementThemeSource source)
        {
            source.Update(ActualTheme == ElementTheme.Light);
        }

        StartAnimations();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => StopAnimations();

    private void OnActualThemeChanged(FrameworkElement sender, object args)
    {
        if (_viewModel.ThemeSource is ElementThemeSource source)
        {
            source.Update(ActualTheme == ElementTheme.Light);
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        StopAnimations();
        _canvas.Children.Clear();
        _legend.Children.Clear();

        TeslaCarVizProjection projection = _viewModel.Projection;
        TeslaCarVizPalette palette = _viewModel.Palette;

        _viewbox.MaxWidth = projection.Width;

        if (projection.Variant == TeslaCarVizVariant.Mini)
        {
            RenderMini(projection, palette);
        }
        else
        {
            RenderFull(projection, palette);
        }

        AutomationProperties.SetName(this, projection.AutomationName);

        if (IsLoaded)
        {
            StartAnimations();
        }
    }

    private void RenderFull(TeslaCarVizProjection projection, TeslaCarVizPalette palette)
    {
        _canvas.Width = TeslaCarVizRegistration.LogicalWidth;
        _canvas.Height = TeslaCarVizRegistration.LogicalHeight;

        ConfigureGlow(projection, palette);

        TeslaCarVizGeometry g = projection.Geometry;
        bool cybertruck = projection.Model == TeslaModelFamily.Cybertruck;

        DrawShadow(projection, palette);
        DrawBody(g, palette);
        if (cybertruck)
        {
            DrawCybertruckDetails(palette);
        }
        else
        {
            DrawDetailLines(projection.Model, palette);
            if (projection.Model == TeslaModelFamily.ModelX)
            {
                DrawFalconWingHint(palette);
            }
        }

        DrawWheel(g.FrontWheelX, g.WheelY, cybertruck, projection.WheelsSpin, isFront: true, palette);
        DrawWheel(g.RearWheelX, g.WheelY, cybertruck, projection.WheelsSpin, isFront: false, palette);

        DrawHeadlight(g, cybertruck, projection.Driving, palette);
        if (projection.Driving)
        {
            DrawBeamCone(g, palette);
        }

        DrawTaillight(g, cybertruck, projection.TaillightPulses, palette);
        DrawDoorHandle(cybertruck, palette);
        DrawBatteryBar(projection, palette);

        if (projection.IsCharging)
        {
            DrawChargingCable(g, projection.ChargePulses);
        }

        DrawLock(g, projection.IsLocked);
        if (projection.IsClimateOn)
        {
            DrawClimateWaves(g, projection.ClimateWavesAnimate, palette);
        }

        if (projection.SentryMode)
        {
            DrawSentryRings(projection.SentryRingsRotate, palette);
        }

        if (projection.Driving)
        {
            DrawSpeedLines(projection.SpeedLinesPlay, palette);
        }

        BuildLegend(projection);
    }

    private void ConfigureGlow(TeslaCarVizProjection projection, TeslaCarVizPalette palette)
    {
        // web: a blurred radial-gradient glow sized to ~70% × 50% of the car, tinted by the dominant state.
        _glow.Width = projection.Width * 0.7;
        _glow.Height = projection.Height * 0.5;

        Color center = ParseCssColor(palette.Ambient(projection.Ambient));
        var brush = new RadialGradientBrush();
        brush.GradientStops.Add(new GradientStop { Color = center, Offset = 0 });
        brush.GradientStops.Add(new GradientStop { Color = Color.FromArgb(0, center.R, center.G, center.B), Offset = 1 });
        _glow.Fill = brush;
        _glow.Opacity = 0.6;
    }

    private void DrawShadow(TeslaCarVizProjection projection, TeslaCarVizPalette palette)
    {
        double rx = projection.Model == TeslaModelFamily.Cybertruck ? 240 : 220;
        var shadow = new Ellipse
        {
            Width = rx * 2,
            Height = 24,
            Fill = CssBrush(palette.Shadow),
            IsHitTestVisible = false,
        };
        Place(shadow, 280 - rx, 270 - 12);
        _canvas.Children.Add(shadow);
    }

    private void DrawBody(TeslaCarVizGeometry g, TeslaCarVizPalette palette)
    {
        _canvas.Children.Add(FillPath(g.BodyPath, palette.BodyFill, palette.BodyStroke, 1.5));
        _canvas.Children.Add(FillPath(g.RoofPath, palette.GlassFill, palette.GlassStroke, 1));
        _canvas.Children.Add(FillPath(g.WindPath, palette.WindFill, palette.WindStroke, 0.8));
    }

    private void DrawCybertruckDetails(TeslaCarVizPalette palette)
    {
        _canvas.Children.Add(StrokeLine(420, 152, 420, 200, palette.DetailLineFaint, 1));
        _canvas.Children.Add(StrokeLine(121, 180, 483, 170, palette.DetailLineSubtle, 0.5));
    }

    private void DrawFalconWingHint(TeslaCarVizPalette palette)
    {
        _canvas.Children.Add(StrokePath("M290 100 L290 85 C290 78 300 75 310 78 L340 88", palette.FalconWingMain, 0.8));
        _canvas.Children.Add(StrokePath("M340 88 L360 82 C365 80 370 82 370 87", palette.FalconWingTip, 0.8));
    }

    private void DrawDetailLines(TeslaModelFamily model, TeslaCarVizPalette palette)
    {
        bool s = model == TeslaModelFamily.ModelS;
        bool xy = model is TeslaModelFamily.ModelX or TeslaModelFamily.ModelY;

        string highlight = s ? "M220 112 Q296 106 390 108"
            : xy ? "M220 108 Q296 102 380 104"
            : "M220 112 Q296 108 380 110";
        _canvas.Children.Add(StrokePath(highlight, TeslaCarVizPalette.RoofHighlight, 1.5));

        double frontX1 = s ? 270 : 265;
        double frontY1 = model == TeslaModelFamily.ModelX ? 120 : model == TeslaModelFamily.ModelY ? 122 : 126;
        double frontX2 = s ? 268 : 260;
        _canvas.Children.Add(StrokeLine(frontX1, frontY1, frontX2, 205, palette.DetailLineFaint, 0.8));

        double rearX1 = s ? 355 : 345;
        double rearY1 = model == TeslaModelFamily.ModelX ? 122 : model == TeslaModelFamily.ModelY ? 124 : 128;
        double rearX2 = s ? 358 : 348;
        _canvas.Children.Add(StrokeLine(rearX1, rearY1, rearX2, 205, palette.DetailLineFaint, 0.8));

        string skirt = s ? "M120 202 Q200 208 296 208 Q430 208 498 202"
            : xy ? "M122 204 Q200 210 296 210 Q430 210 494 204"
            : "M120 202 Q200 208 296 208 Q430 208 496 202";
        _canvas.Children.Add(StrokePath(skirt, palette.DetailLineFaint, 0.8));
    }

    private void DrawWheel(double cx, double cy, bool cybertruck, bool spin, bool isFront, TeslaCarVizPalette palette)
    {
        var outer = new Ellipse { Width = 64, Height = 64, Fill = CssBrush(palette.WheelOuter), Stroke = CssBrush(palette.WheelOuterStroke), StrokeThickness = 1.5 };
        Place(outer, cx - 32, cy - 32);
        _canvas.Children.Add(outer);

        // The spinning sub-canvas: its origin sits at the wheel centre so a rotation about (0,0) spins the rim.
        var spinner = new Canvas();
        Canvas.SetLeft(spinner, cx);
        Canvas.SetTop(spinner, cy);
        double innerR = cybertruck ? 24 : 22;
        var inner = new Ellipse { Width = innerR * 2, Height = innerR * 2, Fill = CssBrush(palette.WheelInner), Stroke = CssBrush(palette.WheelInnerStroke), StrokeThickness = 2 };
        Canvas.SetLeft(inner, -innerR);
        Canvas.SetTop(inner, -innerR);
        spinner.Children.Add(inner);

        double spokeLen = cybertruck ? 22 : 20;
        foreach (int angle in new[] { 0, 72, 144, 216, 288 })
        {
            double rad = angle * Math.PI / 180.0;
            var spoke = new Line
            {
                X1 = 0,
                Y1 = 0,
                X2 = spokeLen * Math.Sin(rad),
                Y2 = -spokeLen * Math.Cos(rad),
                Stroke = CssBrush(palette.WheelHubStroke),
                StrokeThickness = 2.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
            };
            spinner.Children.Add(spoke);
        }

        var rotate = new RotateTransform();
        spinner.RenderTransform = rotate;
        _canvas.Children.Add(spinner);

        if (spin)
        {
            // Stagger the two wheels slightly so they don't lock-step (a subtle realism nicety).
            _storyboards.Add(BuildAngleSpin(rotate, WheelSpinMs, clockwise: true, beginMs: isFront ? 0 : 0));
        }

        var hub = new Ellipse { Width = 16, Height = 16, Fill = CssBrush(palette.WheelHub), Stroke = CssBrush(palette.WheelHubStroke), StrokeThickness = 1.5 };
        Place(hub, cx - 8, cy - 8);
        _canvas.Children.Add(hub);

        var cap = new Ellipse { Width = 6, Height = 6, Fill = CssBrush(palette.WheelHubStroke), Opacity = 0.5 };
        Place(cap, cx - 3, cy - 3);
        _canvas.Children.Add(cap);

        if (cybertruck && isFront)
        {
            foreach (int a in new[] { -18, -12, -6, 0, 6, 12, 18 })
            {
                _canvas.Children.Add(StrokeLine(cx + a, cy - 24, cx + a, cy - 20, palette.Tread, 2));
            }
        }
    }

    private void DrawHeadlight(TeslaCarVizGeometry g, bool cybertruck, bool driving, TeslaCarVizPalette palette)
    {
        string drl = cybertruck
            ? Invariant($"M{g.HeadlightX} {g.HeadlightY - 3} L{g.HeadlightX + 20} {g.HeadlightY - 5}")
            : Invariant($"M{g.HeadlightX - 2} {g.HeadlightY - 14} Q{g.HeadlightX - 6} {g.HeadlightY} {g.HeadlightX - 2} {g.HeadlightY + 14}");
        var strip = StrokePath(drl, driving ? palette.HeadlightOn : palette.HeadlightOff, cybertruck ? 3 : 2.5);
        _canvas.Children.Add(strip);

        var projector = new Ellipse
        {
            Width = (cybertruck ? 3 : 4) * 2,
            Height = (cybertruck ? 2.5 : 6) * 2,
            Fill = CssBrush(driving ? palette.ProjectorOn : palette.HeadlightOff),
            Opacity = driving ? 0.9 : 0.5,
        };
        Place(projector, g.HeadlightX + (cybertruck ? 5 : 2) - (cybertruck ? 3 : 4), g.HeadlightY - (cybertruck ? 2.5 : 6));
        _canvas.Children.Add(projector);

        var turn = new Ellipse
        {
            Width = (cybertruck ? 2 : 3) * 2,
            Height = (cybertruck ? 1.5 : 2) * 2,
            Fill = CssBrush(driving ? palette.TurnSignalOn : palette.HeadlightOff),
            Opacity = driving ? 0.5 : 0.2,
        };
        Place(turn, g.HeadlightX + (cybertruck ? 10 : 6) - (cybertruck ? 2 : 3), g.HeadlightY + (cybertruck ? 0 : 12) - (cybertruck ? 1.5 : 2));
        _canvas.Children.Add(turn);
    }

    private void DrawBeamCone(TeslaCarVizGeometry g, TeslaCarVizPalette palette)
    {
        string cone = Invariant($"M{g.HeadlightX - 5} {g.HeadlightY - 8} L{g.HeadlightX - 60} {g.HeadlightY - 40} L{g.HeadlightX - 60} {g.HeadlightY + 20} L{g.HeadlightX - 5} {g.HeadlightY + 8} Z");
        _canvas.Children.Add(FillPath(cone, TeslaCarVizPalette.BeamCone, null, 0));
    }

    private void DrawTaillight(TeslaCarVizGeometry g, bool cybertruck, bool pulse, TeslaCarVizPalette palette)
    {
        string strip = cybertruck
            ? Invariant($"M{g.TaillightX} {g.TaillightY - 8} L{g.TaillightX} {g.TaillightY + 12}")
            : Invariant($"M{g.TaillightX + 3} {g.TaillightY - 2} Q{g.TaillightX + 5} {g.TaillightY + 9} {g.TaillightX + 3} {g.TaillightY + 20}");
        var main = StrokePath(strip, TeslaCarVizPalette.Taillight, cybertruck ? 4 : 3);
        _canvas.Children.Add(main);

        string core = cybertruck
            ? Invariant($"M{g.TaillightX} {g.TaillightY - 4} L{g.TaillightX} {g.TaillightY + 8}")
            : Invariant($"M{g.TaillightX + 3} {g.TaillightY + 2} Q{g.TaillightX + 4} {g.TaillightY + 9} {g.TaillightX + 3} {g.TaillightY + 16}");
        _canvas.Children.Add(StrokePath(core, TeslaCarVizPalette.TaillightCore, 1.5, 0.8));

        var glow = new Ellipse { Width = 16, Height = 28, Fill = CssBrush(TeslaCarVizPalette.TaillightGlow), IsHitTestVisible = false };
        Place(glow, g.TaillightX + 3 - 8, g.TaillightY + 9 - 14);
        _canvas.Children.Add(glow);

        if (pulse)
        {
            _storyboards.Add(BuildOpacityPulse(main, 0.7, 1.0, TaillightPulseMs));
        }
    }

    private void DrawDoorHandle(bool cybertruck, TeslaCarVizPalette palette)
    {
        _canvas.Children.Add(cybertruck
            ? StrokeLine(210, 162, 380, 162, palette.DetailLineFaint, 1)
            : StrokeLine(250, 156, 340, 154, palette.DetailLine, 1));
    }

    private void DrawBatteryBar(TeslaCarVizProjection projection, TeslaCarVizPalette palette)
    {
        TeslaCarVizGeometry g = projection.Geometry;
        var bg = new Rectangle
        {
            Width = TeslaCarVizGeometry.BatteryBarWidth,
            Height = 8,
            RadiusX = 4,
            RadiusY = 4,
            Fill = CssBrush(palette.BatteryBackground),
        };
        Place(bg, g.BatteryX, g.BatteryY);
        _canvas.Children.Add(bg);

        double fillWidth = TeslaCarVizGeometry.BatteryBarWidth * projection.BatteryFraction;
        var fill = new Rectangle
        {
            Width = fillWidth,
            Height = 8,
            RadiusX = 4,
            RadiusY = 4,
            Fill = DisplayTokens.Brush(projection.BatteryBrushKey),
        };
        Place(fill, g.BatteryX, g.BatteryY);
        _canvas.Children.Add(fill);

        if (projection.EntranceAnimates && fillWidth > 0)
        {
            _storyboards.Add(BuildWidthGrow(fill, fillWidth, BatteryFillMs));
        }

        var text = new TextBlock
        {
            Text = projection.BatteryText,
            FontSize = 6,
            FontWeight = FontWeights.Bold,
            Foreground = CssBrush(palette.BatteryText),
            Opacity = 0.7,
            TextAlignment = TextAlignment.Center,
            Width = TeslaCarVizGeometry.BatteryBarWidth,
        };
        Place(text, g.BatteryX, g.BatteryY + 1);
        _canvas.Children.Add(text);
    }

    private void DrawChargingCable(TeslaCarVizGeometry g, bool pulse)
    {
        string cable = Invariant($"M{g.HeadlightX - 10} {g.HeadlightY + 5} L{g.HeadlightX - 50} {g.HeadlightY + 5} C{g.HeadlightX - 60} {g.HeadlightY + 5} {g.HeadlightX - 65} {g.HeadlightY} {g.HeadlightX - 65} {g.HeadlightY - 10} L{g.HeadlightX - 65} {g.HeadlightY - 45}");
        _canvas.Children.Add(StrokePath(cable, TeslaCarVizPalette.ChargeCable, 3));

        var plug = new Ellipse { Width = 12, Height = 12, Fill = CssBrush(TeslaCarVizPalette.ChargeCable) };
        Place(plug, g.HeadlightX - 65 - 6, g.HeadlightY - 50 - 6);
        var scale = new ScaleTransform { CenterX = 6, CenterY = 6 };
        plug.RenderTransform = scale;
        _canvas.Children.Add(plug);

        string bolt = Invariant($"M{g.HeadlightX - 67} {g.HeadlightY - 55} L{g.HeadlightX - 64} {g.HeadlightY - 51} L{g.HeadlightX - 66} {g.HeadlightY - 51} L{g.HeadlightX - 63} {g.HeadlightY - 46} L{g.HeadlightX - 66} {g.HeadlightY - 50} L{g.HeadlightX - 64} {g.HeadlightY - 50} Z");
        var lightning = FillPath(bolt, "#ffffff", null, 0);
        lightning.Opacity = 0.9;
        _canvas.Children.Add(lightning);

        if (pulse)
        {
            _storyboards.Add(BuildScalePulse(scale, 1.0, 1.3, ChargePulseMs));
            _storyboards.Add(BuildOpacityPulse(lightning, 0.6, 1.0, 1000));
        }
    }

    private void DrawLock(TeslaCarVizGeometry g, bool locked)
    {
        TeslaCarVizPalette palette = _viewModel.Palette;
        double lx = g.LockX;
        double ly = g.LockY;

        var bg = new Rectangle { Width = 20, Height = 16, RadiusX = 4, RadiusY = 4, Fill = CssBrush(palette.LockBackground) };
        Place(bg, lx - 10, ly - 8);
        _canvas.Children.Add(bg);

        Brush color = DisplayTokens.Brush(_viewModel.Projection.LockBrushKey);

        var body = new Rectangle { Width = 10, Height = 8, RadiusX = 2, RadiusY = 2, Stroke = color, StrokeThickness = 1.2, Fill = TransparentBrush() };
        Place(body, lx - 5, ly - 2);
        _canvas.Children.Add(body);

        string shackle = locked
            ? Invariant($"M{lx - 3} {ly - 2} L{lx - 3} {ly - 5} A3 3 0 0 1 {lx + 3} {ly - 5} L{lx + 3} {ly - 2}")
            : Invariant($"M{lx - 3} {ly - 2} L{lx - 3} {ly - 5} A3 3 0 0 1 {lx + 3} {ly - 5} L{lx + 3} {ly - 6}");
        var shacklePath = StrokePath(shackle, null, 1.2);
        shacklePath.Stroke = color;
        _canvas.Children.Add(shacklePath);

        var keyhole = new Ellipse { Width = 2, Height = 2, Fill = color };
        Place(keyhole, lx - 1, ly + 2 - 1);
        _canvas.Children.Add(keyhole);
    }

    private void DrawClimateWaves(TeslaCarVizGeometry g, bool animate, TeslaCarVizPalette palette)
    {
        double ox = g.LockX - 5;
        double oy = g.LockY + 18;
        for (int i = 0; i < 3; i++)
        {
            string wave = Invariant($"M{ox + (-15 + (i * 15))} {oy} C{ox + (-12 + (i * 15))} {oy - 4} {ox + (-8 + (i * 15))} {oy - 4} {ox + (-5 + (i * 15))} {oy}");
            var path = StrokePath(wave, palette.Climate, 1.2);
            path.Opacity = animate ? 0 : 0.6;
            var translate = new TranslateTransform();
            path.RenderTransform = translate;
            _canvas.Children.Add(path);

            if (animate)
            {
                _storyboards.Add(BuildClimateWave(path, translate, ClimateWaveMs, i * 300));
            }
        }
    }

    private void DrawSentryRings(bool rotate, TeslaCarVizPalette palette)
    {
        _canvas.Children.Add(BuildSentryRing(90, palette.SentryRing1, "4 4", rotate, SentryRing1Ms, clockwise: true));
        _canvas.Children.Add(BuildSentryRing(95, palette.SentryRing2, "8 8", rotate, SentryRing2Ms, clockwise: false));
    }

    private Ellipse BuildSentryRing(double radius, string color, string dash, bool rotate, int ms, bool clockwise)
    {
        var ring = new Ellipse
        {
            Width = radius * 2,
            Height = radius * 2,
            Stroke = CssBrush(color),
            StrokeThickness = 1,
            Fill = TransparentBrush(),
            StrokeDashArray = ParseDash(dash),
            IsHitTestVisible = false,
        };
        Place(ring, 280 - radius, 160 - radius);
        var transform = new RotateTransform { CenterX = radius, CenterY = radius };
        ring.RenderTransform = transform;

        if (rotate)
        {
            _storyboards.Add(BuildAngleSpin(transform, ms, clockwise, beginMs: 0));
        }

        return ring;
    }

    private void DrawSpeedLines(bool animate, TeslaCarVizPalette palette)
    {
        for (int i = 0; i < 4; i++)
        {
            double x1 = 530 + (i * 8);
            double y = 160 + (i * 12);
            var line = new Line
            {
                X1 = x1,
                Y1 = y,
                X2 = 560 + (i * 8),
                Y2 = y,
                Stroke = CssBrush(palette.SpeedLine),
                StrokeThickness = 1.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                Opacity = animate ? 0 : 0.6,
            };
            var translate = new TranslateTransform();
            line.RenderTransform = translate;
            _canvas.Children.Add(line);

            if (animate)
            {
                _storyboards.Add(BuildSpeedLine(line, translate, SpeedLineMs, i * 150));
            }
        }
    }

    private void BuildLegend(TeslaCarVizProjection projection)
    {
        foreach (TeslaCarVizStatusChip chip in projection.Chips)
        {
            Brush accent = chip.Active ? DisplayTokens.Brush(chip.ActiveBrushKey) : DisplayTokens.TextMuted;

            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = ChipSpacing, VerticalAlignment = VerticalAlignment.Center };
            var dot = new Ellipse { Width = ChipDotSize, Height = ChipDotSize, Fill = accent, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);
            row.Children.Add(dot);

            var label = new TextBlock { Text = chip.Label, FontSize = ChipFontSize, FontWeight = FontWeights.Medium, Foreground = accent, VerticalAlignment = VerticalAlignment.Center };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
            row.Children.Add(label);

            AutomationProperties.SetName(row, chip.Label);
            _legend.Children.Add(row);
        }
    }

    private void RenderMini(TeslaCarVizProjection projection, TeslaCarVizPalette palette)
    {
        bool modelX = projection.Model == TeslaModelFamily.ModelX;
        double height = modelX ? 34 : 32;
        _canvas.Width = 64;
        _canvas.Height = height;
        _viewbox.MaxWidth = 64;
        _glow.Fill = TransparentBrush();
        _glow.Width = 0;
        _glow.Height = 0;

        TeslaCarVizGeometry g = projection.Geometry;
        _canvas.Children.Add(FillPath(g.MiniPath, palette.MiniBodyFill, palette.MiniBodyStroke, 0.8));

        double wheelCy = modelX ? 24 : 22;
        foreach (double cx in new[] { 18.0, 50.0 })
        {
            var wheel = new Ellipse { Width = 8, Height = 8, Fill = CssBrush(palette.MiniWheelFill), Stroke = CssBrush(palette.MiniWheelStroke), StrokeThickness = 0.5 };
            Place(wheel, cx - 4, wheelCy - 4);
            _canvas.Children.Add(wheel);
        }

        double barY = modelX ? 19 : 17;
        var barBg = new Rectangle { Width = 28, Height = 2, RadiusX = 1, RadiusY = 1, Fill = CssBrush(palette.MiniBatteryBackground) };
        Place(barBg, 18, barY);
        _canvas.Children.Add(barBg);

        var barFill = new Rectangle { Width = 28 * projection.BatteryFraction, Height = 2, RadiusX = 1, RadiusY = 1, Fill = DisplayTokens.Brush(projection.BatteryBrushKey), Opacity = 0.8 };
        Place(barFill, 18, barY);
        _canvas.Children.Add(barFill);

        if (projection.IsCharging)
        {
            double dotY = modelX ? 20 : 18;
            var dot = new Ellipse { Width = 4, Height = 4, Fill = DisplayTokens.Brush(TeslaCarVizColors.Success), Opacity = 0.8 };
            Place(dot, 10 - 2, dotY - 2);
            _canvas.Children.Add(dot);

            if (projection.ChargePulses)
            {
                _storyboards.Add(BuildOpacityPulse(dot, 0.5, 1.0, ChargePulseMs));
            }
        }
    }

    // ── animation builders ──────────────────────────────────────────────────────────────────────────────────

    private static Storyboard BuildAngleSpin(RotateTransform target, int ms, bool clockwise, int beginMs)
    {
        var animation = new DoubleAnimation
        {
            From = 0,
            To = clockwise ? 360 : -360,
            Duration = new Duration(TimeSpan.FromMilliseconds(ms)),
            RepeatBehavior = RepeatBehavior.Forever,
            BeginTime = TimeSpan.FromMilliseconds(beginMs),
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, "Angle");
        var sb = new Storyboard();
        sb.Children.Add(animation);
        return sb;
    }

    private static Storyboard BuildOpacityPulse(UIElement target, double from, double to, int ms)
    {
        var animation = new DoubleAnimation
        {
            From = from,
            To = to,
            Duration = new Duration(TimeSpan.FromMilliseconds(ms)),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, "Opacity");
        var sb = new Storyboard();
        sb.Children.Add(animation);
        return sb;
    }

    private static Storyboard BuildScalePulse(ScaleTransform target, double from, double to, int ms)
    {
        var sb = new Storyboard();
        foreach (string axis in new[] { "ScaleX", "ScaleY" })
        {
            var animation = new DoubleAnimation
            {
                From = from,
                To = to,
                Duration = new Duration(TimeSpan.FromMilliseconds(ms)),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EnableDependentAnimation = true,
            };
            Storyboard.SetTarget(animation, target);
            Storyboard.SetTargetProperty(animation, axis);
            sb.Children.Add(animation);
        }

        return sb;
    }

    private static Storyboard BuildWidthGrow(Rectangle target, double to, int ms)
    {
        var animation = new DoubleAnimation
        {
            From = 0,
            To = to,
            Duration = new Duration(TimeSpan.FromMilliseconds(ms)),
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
            EnableDependentAnimation = true,
        };
        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, "Width");
        var sb = new Storyboard();
        sb.Children.Add(animation);
        return sb;
    }

    private static Storyboard BuildClimateWave(UIElement target, TranslateTransform translate, int ms, int beginMs)
    {
        var sb = new Storyboard();
        var fade = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever, BeginTime = TimeSpan.FromMilliseconds(beginMs), EnableDependentAnimation = true };
        fade.KeyFrames.Add(new DiscreteDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.Zero), Value = 0 });
        fade.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms / 2)), Value = 0.6 });
        fade.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms)), Value = 0 });
        Storyboard.SetTarget(fade, target);
        Storyboard.SetTargetProperty(fade, "Opacity");
        sb.Children.Add(fade);

        var rise = new DoubleAnimation { From = 0, To = -8, Duration = new Duration(TimeSpan.FromMilliseconds(ms)), RepeatBehavior = RepeatBehavior.Forever, BeginTime = TimeSpan.FromMilliseconds(beginMs), EnableDependentAnimation = true };
        Storyboard.SetTarget(rise, translate);
        Storyboard.SetTargetProperty(rise, "Y");
        sb.Children.Add(rise);
        return sb;
    }

    private static Storyboard BuildSpeedLine(UIElement target, TranslateTransform translate, int ms, int beginMs)
    {
        var sb = new Storyboard();
        var fade = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever, BeginTime = TimeSpan.FromMilliseconds(beginMs), EnableDependentAnimation = true };
        fade.KeyFrames.Add(new DiscreteDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.Zero), Value = 0 });
        fade.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms / 2)), Value = 0.6 });
        fade.KeyFrames.Add(new LinearDoubleKeyFrame { KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(ms)), Value = 0 });
        Storyboard.SetTarget(fade, target);
        Storyboard.SetTargetProperty(fade, "Opacity");
        sb.Children.Add(fade);

        var move = new DoubleAnimation { From = 0, To = 30, Duration = new Duration(TimeSpan.FromMilliseconds(ms)), RepeatBehavior = RepeatBehavior.Forever, BeginTime = TimeSpan.FromMilliseconds(beginMs), EnableDependentAnimation = true };
        Storyboard.SetTarget(move, translate);
        Storyboard.SetTargetProperty(move, "X");
        sb.Children.Add(move);
        return sb;
    }

    private void StartAnimations()
    {
        foreach (Storyboard sb in _storyboards)
        {
            sb.Begin();
        }
    }

    private void StopAnimations()
    {
        foreach (Storyboard sb in _storyboards)
        {
            sb.Stop();
        }

        _storyboards.Clear();
    }

    // ── shape helpers ───────────────────────────────────────────────────────────────────────────────────────

    private static Path FillPath(string data, string fill, string? stroke, double strokeThickness)
    {
        var path = new Path
        {
            Data = BuildGeometry(TeslaCarVizPathParser.Parse(data)),
            Fill = CssBrush(fill),
            IsHitTestVisible = false,
        };
        if (stroke is not null)
        {
            path.Stroke = CssBrush(stroke);
            path.StrokeThickness = strokeThickness;
        }

        return path;
    }

    private static Path StrokePath(string data, string? stroke, double strokeThickness, double opacity = 1.0)
    {
        var path = new Path
        {
            Data = BuildGeometry(TeslaCarVizPathParser.Parse(data)),
            StrokeThickness = strokeThickness,
            StrokeLineJoin = PenLineJoin.Round,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            Opacity = opacity,
            IsHitTestVisible = false,
        };
        if (stroke is not null)
        {
            path.Stroke = CssBrush(stroke);
        }

        return path;
    }

    private static Line StrokeLine(double x1, double y1, double x2, double y2, string stroke, double thickness)
    {
        return new Line
        {
            X1 = x1,
            Y1 = y1,
            X2 = x2,
            Y2 = y2,
            Stroke = CssBrush(stroke),
            StrokeThickness = thickness,
            IsHitTestVisible = false,
        };
    }

    private static void Place(UIElement element, double left, double top)
    {
        Canvas.SetLeft(element, left);
        Canvas.SetTop(element, top);
    }

    private static PathGeometry BuildGeometry(IReadOnlyList<TeslaCarVizSegment> segments)
    {
        var geometry = new PathGeometry();
        PathFigure? figure = null;

        foreach (TeslaCarVizSegment segment in segments)
        {
            IReadOnlyList<double> a = segment.Args;
            switch (segment.Kind)
            {
                case TeslaCarVizSegmentKind.MoveTo:
                    figure = new PathFigure { StartPoint = new Point(a[0], a[1]), IsClosed = false, IsFilled = true };
                    geometry.Figures.Add(figure);
                    break;
                case TeslaCarVizSegmentKind.LineTo:
                    figure?.Segments.Add(new LineSegment { Point = new Point(a[0], a[1]) });
                    break;
                case TeslaCarVizSegmentKind.QuadraticBezier:
                    figure?.Segments.Add(new QuadraticBezierSegment { Point1 = new Point(a[0], a[1]), Point2 = new Point(a[2], a[3]) });
                    break;
                case TeslaCarVizSegmentKind.CubicBezier:
                    figure?.Segments.Add(new BezierSegment { Point1 = new Point(a[0], a[1]), Point2 = new Point(a[2], a[3]), Point3 = new Point(a[4], a[5]) });
                    break;
                case TeslaCarVizSegmentKind.Arc:
                    figure?.Segments.Add(new ArcSegment
                    {
                        Size = new Size(a[0], a[1]),
                        RotationAngle = a[2],
                        IsLargeArc = a[3] != 0,
                        SweepDirection = a[4] != 0 ? SweepDirection.Clockwise : SweepDirection.Counterclockwise,
                        Point = new Point(a[5], a[6]),
                    });
                    break;
                case TeslaCarVizSegmentKind.Close:
                    if (figure is not null)
                    {
                        figure.IsClosed = true;
                    }

                    break;
                default:
                    break;
            }
        }

        return geometry;
    }

    private static DoubleCollection ParseDash(string dash)
    {
        var collection = new DoubleCollection();
        foreach (string part in dash.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (double.TryParse(part, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
            {
                collection.Add(value);
            }
        }

        return collection;
    }

    private static SolidColorBrush TransparentBrush() => new(Colors.Transparent);

    private static SolidColorBrush CssBrush(string css) => new(ParseCssColor(css));

    private static Color ParseCssColor(string css)
    {
        if (string.IsNullOrWhiteSpace(css))
        {
            return Colors.Transparent;
        }

        string value = css.Trim();
        if (string.Equals(value, "white", StringComparison.OrdinalIgnoreCase))
        {
            return Colors.White;
        }

        if (value.StartsWith('#'))
        {
            return ParseHexColor(value);
        }

        if (value.StartsWith("rgba(", StringComparison.OrdinalIgnoreCase) || value.StartsWith("rgb(", StringComparison.OrdinalIgnoreCase))
        {
            return ParseRgbaColor(value);
        }

        return Colors.Transparent;
    }

    private static Color ParseHexColor(string hex)
    {
        string h = hex.TrimStart('#');
        if (h.Length == 3)
        {
            h = string.Concat(h[0], h[0], h[1], h[1], h[2], h[2]);
        }

        if (h.Length < 6
            || !byte.TryParse(h.AsSpan(0, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte r)
            || !byte.TryParse(h.AsSpan(2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte g)
            || !byte.TryParse(h.AsSpan(4, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out byte b))
        {
            return Colors.Transparent;
        }

        return Color.FromArgb(255, r, g, b);
    }

    private static Color ParseRgbaColor(string rgba)
    {
        int open = rgba.IndexOf('(', StringComparison.Ordinal);
        int close = rgba.IndexOf(')', StringComparison.Ordinal);
        if (open < 0 || close <= open)
        {
            return Colors.Transparent;
        }

        string[] parts = rgba[(open + 1)..close].Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3
            || !byte.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out byte r)
            || !byte.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out byte g)
            || !byte.TryParse(parts[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out byte b))
        {
            return Colors.Transparent;
        }

        double alpha = 1.0;
        if (parts.Length >= 4)
        {
            double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out alpha);
        }

        byte a = (byte)Math.Clamp(Math.Round(alpha * 255), 0, 255);
        return Color.FromArgb(a, r, g, b);
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
    /// The production colour-scheme source backing the view — reflects the control's effective
    /// <see cref="FrameworkElement.ActualTheme"/>, updated by the view from <c>ActualThemeChanged</c>. WinUI-free
    /// so the state-holder layer stays portable to the headless test host.
    /// </summary>
    private sealed class ElementThemeSource : ITeslaCarVizThemeSource
    {
        private bool _isLight;

        public event EventHandler? Changed;

        public bool IsLight => _isLight;

        public void Update(bool isLight)
        {
            if (_isLight == isLight)
            {
                return;
            }

            _isLight = isLight;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>
    /// The system reduce-motion source backing the production view — reads the OS "show animations" flag through
    /// <see cref="MotionPreference"/> (the read-once policy every motion-aware control in this app uses; the
    /// runtime-change subscription is intentionally inert to avoid the platform-gated UISettings change event).
    /// </summary>
    private sealed class SystemMotionPreferenceSource : IMotionPreferenceSource
    {
        public bool ReduceMotion => MotionPreference.ReduceMotion;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            return NoOpSubscription.Instance;
        }

        private sealed class NoOpSubscription : IDisposable
        {
            public static NoOpSubscription Instance { get; } = new();

            private NoOpSubscription()
            {
            }

            public void Dispose()
            {
                // Read-once: the preference is not observed for runtime changes.
            }
        }
    }

    private sealed class TeslaCarVizAutomationPeer : FrameworkElementAutomationPeer
    {
        public TeslaCarVizAutomationPeer(TeslaCarViz owner)
            : base(owner)
        {
        }

        private TeslaCarViz Surface => (TeslaCarViz)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Image;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}
