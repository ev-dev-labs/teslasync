using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;
using Path = Microsoft.UI.Xaml.Shapes.Path;

namespace TeslaSync.App.SharedSurfaces.DriveScoreSurface;

/// <summary>
/// The native WinUI 3 <c>DriveScore</c> shared surface — a parity port of
/// <c>web/src/components/data-display/DriveScore.tsx</c>. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>drive</c> prop's SI fields) and it renders the web layout — a translucent
/// <see cref="TsGlassPanel"/> hosting a circular score gauge beside a four-row breakdown (efficiency, speed
/// discipline, range preservation, trip length). The view never performs HTTP; the four-part score, the threshold
/// gauge colour, the bar fractions, the gauge sweep and every accessible name are derived by the WinUI-free
/// <see cref="DriveScoreProjection"/>. The gauge is drawn with the shared chart geometry
/// (<see cref="ChartGeometry.RingArc"/> + <see cref="ChartShapes.ArcPath"/>) so it reuses the same 12-o'clock,
/// clockwise sweep the native radial gauges use; the arc and the centred score figure are tinted by the web
/// threshold palette (<c>getScoreColor</c>) through <see cref="DisplayPrimitives.HexBrush"/> — a semantic data
/// colour shared with the web, while ambient theming still flows through the token brushes. Because the web
/// component is synchronous and prop-driven (its parent Drive row / header owns any data fetching), it has no
/// loading / error / stale / offline chrome — it always renders the gauge and the breakdown for whatever drive it
/// is given (an absent field falls back to the same SI default the web uses, so the surface is never blank) — so
/// this surface reproduces that single populated branch and never hides itself. The web framer-motion entrance
/// (the arc drawing in, the score figure fading in and the bars growing from zero) is reproduced once on first
/// load as an XAML Storyboard and is reduced-motion-aware: under the OS "animations off" preference the gauge,
/// score and bars snap to their settled state with no entrance (the web <c>prefers-reduced-motion</c>
/// short-circuit). The gauge is a single Narrator node ("Score 87"), the panel title is a level-3 heading (the
/// web <c>h3</c>) and each breakdown bar carries its own composed accessible name; the decorative shapes and
/// inner figures are hidden from assistive tech.
/// </summary>
public sealed partial class DriveScore : ContentControl, IDisposable
{
    private const double PanelPadding = 20;       // web GlassPanel p-5
    private const double RowSpacing = 24;          // web flex gap-6
    private const double GaugeSize = 130;          // web svg 130x130
    private const double GaugeRadius = 52;         // web circle r=52
    private const double GaugeStroke = 10;         // web strokeWidth 10
    private const double ScoreFontSize = 30;       // web text-3xl
    private const double CaptionFontSize = 10;     // web text-[10px]
    private const double TitleFontSize = 14;       // web text-sm
    private const double LabelFontSize = 11;       // web text-[11px]
    private const double TrackHeight = 6;          // web h-1.5
    private const double TrackRadius = 3;          // web rounded-full on a 6px track
    private const double BreakdownSpacing = 8;     // web space-y-2
    private const double CaptionTracking = 50;     // web tracking-wider (~0.05em)

    private static readonly TimeSpan ArcDrawDuration = TimeSpan.FromMilliseconds(1200);   // web 1.2s
    private static readonly TimeSpan BarGrowDuration = TimeSpan.FromMilliseconds(800);    // web 0.8s
    private static readonly TimeSpan BarGrowDelay = TimeSpan.FromMilliseconds(300);       // web delay 0.3s
    private static readonly TimeSpan ScoreFadeDuration = TimeSpan.FromMilliseconds(600);
    private static readonly TimeSpan ScoreFadeDelay = TimeSpan.FromMilliseconds(500);     // web delay 0.5s

    private readonly ILocalizer _localizer;
    private readonly DriveScoreDiagnostics _diagnostics;
    private readonly List<BarAnimationTarget> _bars = new();

    private DriveScoreModel _model;
    private TextBlock? _scoreFigure;
    private Path? _valueArc;
    private double _valueArcDashUnit;
    private Storyboard? _entrance;
    private bool _entrancePending;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the labels and accessible names resolve through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="DriveScoreModel.Unknown"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DriveScore(
        ILocalizer localizer,
        DriveScoreModel? model = null,
        DriveScoreDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DriveScoreModel.Unknown;
        _diagnostics = diagnostics ?? new DriveScoreDiagnostics();

        // The web framer-motion entrance only plays when motion is allowed; read the preference once up front so
        // the first render starts from the pre-entrance frame rather than flashing the settled state.
        _entrancePending = !MotionPreference.ReduceMotion;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DriveScore</c>).</summary>
    public static string Slug => DriveScoreRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public DriveScoreModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>Stop the entrance Storyboard and detach the load handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        StopEntrance();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        if (_entrancePending)
        {
            StartEntrance();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void Render()
    {
        StopEntrance();
        _bars.Clear();
        _scoreFigure = null;
        _valueArc = null;
        _valueArcDashUnit = 0;

        DriveScoreDisplay display = DriveScoreProjection.Project(_model, _localizer);

        var row = new Grid { ColumnSpacing = RowSpacing, VerticalAlignment = VerticalAlignment.Center };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        Grid gauge = BuildGauge(display);
        Grid.SetColumn(gauge, 0);
        row.Children.Add(gauge);

        StackPanel breakdown = BuildBreakdown(display);
        Grid.SetColumn(breakdown, 1);
        row.Children.Add(breakdown);

        Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = row };

        ApplyEntranceState();
    }

    private Grid BuildGauge(DriveScoreDisplay display)
    {
        Brush scoreBrush = DisplayPrimitives.HexBrush(display.ScoreColorHex);

        var canvas = new Canvas { Width = GaugeSize, Height = GaugeSize };

        // web: the background <circle> in the glass-border colour, full ring.
        var track = new Ellipse
        {
            Width = GaugeRadius * 2,
            Height = GaugeRadius * 2,
            Stroke = DisplayTokens.Border,
            StrokeThickness = GaugeStroke,
        };
        Canvas.SetLeft(track, (GaugeSize / 2) - GaugeRadius);
        Canvas.SetTop(track, (GaugeSize / 2) - GaugeRadius);
        AutomationProperties.SetAccessibilityView(track, AccessibilityView.Raw);
        canvas.Children.Add(track);

        // web: the animated score arc — start at 12 o'clock, sweep clockwise score/100 of the ring.
        if (display.GaugeFraction > 0)
        {
            double arcFraction = Math.Min(display.GaugeFraction, 0.9999);
            ArcGeometry geometry = ChartGeometry.RingArc(new PointD(GaugeSize / 2, GaugeSize / 2), GaugeRadius, arcFraction);
            Path arc = ChartShapes.ArcPath(geometry, scoreBrush, GaugeStroke);

            // WinUI dash lengths are multiples of the stroke thickness; one dash + gap as long as the arc means
            // the whole arc is either drawn (offset 0) or hidden (offset = one dash) — the native form of the web
            // strokeDasharray / strokeDashoffset draw.
            double arcLength = arcFraction * 2 * Math.PI * GaugeRadius;
            _valueArcDashUnit = arcLength / GaugeStroke;
            arc.StrokeDashArray = new DoubleCollection { _valueArcDashUnit, _valueArcDashUnit };
            arc.StrokeDashOffset = 0;
            AutomationProperties.SetAccessibilityView(arc, AccessibilityView.Raw);
            canvas.Children.Add(arc);
            _valueArc = arc;
        }

        var figure = new TextBlock
        {
            Text = display.TotalText,
            FontSize = ScoreFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = scoreBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(figure, AccessibilityView.Raw);
        _scoreFigure = figure;

        var caption = new TextBlock
        {
            Text = display.ScoreCaption.ToUpper(CultureInfo.CurrentCulture),
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.TextMuted,
            CharacterSpacing = (int)CaptionTracking,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);

        var center = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        center.Children.Add(figure);
        center.Children.Add(caption);

        var grid = new Grid { Width = GaugeSize, Height = GaugeSize, VerticalAlignment = VerticalAlignment.Center };
        grid.Children.Add(canvas);
        grid.Children.Add(center);

        // The gauge reads as one Narrator node ("Score 87"); its inner figures are decorative for assistive tech.
        AutomationProperties.SetName(grid, display.GaugeAccessibleName);
        return grid;
    }

    private StackPanel BuildBreakdown(DriveScoreDisplay display)
    {
        var breakdown = new StackPanel { Spacing = BreakdownSpacing, VerticalAlignment = VerticalAlignment.Center };

        var title = new TextBlock
        {
            Text = display.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
        };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level3);
        breakdown.Children.Add(title);

        foreach (DriveScoreComponent component in display.Components)
        {
            breakdown.Children.Add(BuildBar(component));
        }

        return breakdown;
    }

    private StackPanel BuildBar(DriveScoreComponent component)
    {
        Brush colorBrush = DisplayPrimitives.HexBrush(component.ColorHex);

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = component.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextSecondary,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        Grid.SetColumn(label, 0);
        header.Children.Add(label);

        var value = new TextBlock
        {
            Text = component.ValueText,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = colorBrush,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        Grid.SetColumn(value, 1);
        header.Children.Add(value);

        // web: a full-width fill scaled to value/max from the left edge — animatable via a horizontal scale.
        var scale = new ScaleTransform { ScaleX = component.Fraction, ScaleY = 1 };
        var fill = new Border
        {
            Background = colorBrush,
            CornerRadius = new CornerRadius(TrackRadius),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            RenderTransform = scale,
            RenderTransformOrigin = new Point(0, 0.5),
        };

        var trackBar = new Border
        {
            Height = TrackHeight,
            CornerRadius = new CornerRadius(TrackRadius),
            Background = DisplayTokens.Border,
            Child = fill,
        };

        _bars.Add(new BarAnimationTarget(scale, component.Fraction));

        var bar = new StackPanel { Spacing = 2 };
        bar.Children.Add(header);
        bar.Children.Add(trackBar);
        AutomationProperties.SetName(bar, component.AccessibleName);
        return bar;
    }

    private void ApplyEntranceState()
    {
        // The settled values are already set during the build; only the pre-entrance frame needs overriding, and
        // only while the entrance is still pending and allowed.
        if (!_entrancePending)
        {
            return;
        }

        if (_scoreFigure is { } figure)
        {
            figure.Opacity = 0;
        }

        if (_valueArc is { } arc)
        {
            arc.StrokeDashOffset = _valueArcDashUnit;
        }

        foreach (BarAnimationTarget bar in _bars)
        {
            bar.Scale.ScaleX = 0;
        }
    }

    private void StartEntrance()
    {
        StopEntrance();

        var storyboard = new Storyboard();

        if (_scoreFigure is { } figure)
        {
            var fade = new DoubleAnimation
            {
                From = 0,
                To = 1,
                Duration = new Duration(ScoreFadeDuration),
                BeginTime = ScoreFadeDelay,
            };
            Storyboard.SetTarget(fade, figure);
            Storyboard.SetTargetProperty(fade, "Opacity");
            storyboard.Children.Add(fade);
        }

        if (_valueArc is { } arc)
        {
            var draw = new DoubleAnimation
            {
                From = _valueArcDashUnit,
                To = 0,
                Duration = new Duration(ArcDrawDuration),
                EnableDependentAnimation = true,
                EasingFunction = new ExponentialEase { EasingMode = EasingMode.EaseOut },
            };
            Storyboard.SetTarget(draw, arc);
            Storyboard.SetTargetProperty(draw, "StrokeDashOffset");
            storyboard.Children.Add(draw);
        }

        foreach (BarAnimationTarget bar in _bars)
        {
            var grow = new DoubleAnimation
            {
                From = 0,
                To = bar.Fraction,
                Duration = new Duration(BarGrowDuration),
                BeginTime = BarGrowDelay,
                EasingFunction = new ExponentialEase { EasingMode = EasingMode.EaseOut },
            };
            Storyboard.SetTarget(grow, bar.Scale);
            Storyboard.SetTargetProperty(grow, "ScaleX");
            storyboard.Children.Add(grow);
        }

        _entrance = storyboard;
        storyboard.Completed += OnEntranceCompleted;
        storyboard.Begin();
    }

    private void OnEntranceCompleted(object? sender, object e)
    {
        _entrancePending = false;
        StopEntrance();
    }

    private void StopEntrance()
    {
        if (_entrance is { } storyboard)
        {
            storyboard.Completed -= OnEntranceCompleted;
            storyboard.Stop();
            _entrance = null;
        }
    }

    /// <summary>A breakdown bar's horizontal scale plus the settled fraction the entrance animates toward.</summary>
    /// <param name="Scale">The fill's horizontal scale transform (origin at the left edge).</param>
    /// <param name="Fraction">The settled fill fraction [0,1] (web <c>value / max</c>).</param>
    private sealed record BarAnimationTarget(ScaleTransform Scale, double Fraction);
}
