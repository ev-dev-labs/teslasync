using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SignalChartPanel</c> feature surface — a parity port of
/// web/src/features/telemetry/components/SignalChartPanel.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>selectedSignals</c> / <c>data</c> / <c>stats</c> props plus the live +
/// loading flags and header counters) and it renders the web fragment inside a translucent
/// <see cref="TsGlassPanel"/> faded in on load — a header row (the live <c>Radio</c> / historical
/// <c>BarChart3</c> icon, the section title, and the right-aligned annotation: the pulsing live
/// "events · points" counters or the historical "points loaded" note) above exactly one of the web body
/// branches: <see cref="SignalChartPanelState.Loading"/> (skeleton chrome while the parent fetches),
/// <see cref="SignalChartPanelState.Overlay"/> (the stacked multi-line chart — the recharts
/// <c>LineChart</c>), <see cref="SignalChartPanelState.Grid"/> (the small-multiples grid — the recharts
/// <c>SmallMultiplesChart</c>), <see cref="SignalChartPanelState.LiveWaiting"/> (the pulsing "waiting for
/// signal data" notice) or <see cref="SignalChartPanelState.Empty"/> (the "no data for this time range"
/// notice). The view never performs HTTP; all branch selection, the dual-axis decision, the overlay/grid
/// resolution, label resolution and counter formatting happen in the WinUI-free
/// <see cref="SignalChartPanelProjection"/>. The live pulse honours <see cref="ReduceMotion"/>, every string
/// resolves through the i18n facade, decorative icons/dots are hidden from Narrator and the surface carries
/// the composed Narrator name.
/// </summary>
public sealed partial class SignalChartPanel : ContentControl
{
    /// <summary>Web default chart body height (<c>height = 350</c>).</summary>
    public const double DefaultChartHeight = 350;

    /// <summary>Small-multiples cell width — sized so a grid cell roughly matches the web <c>gridCellHeight</c> footprint.</summary>
    public const double DefaultGridCellWidth = 220;

    private const double PanelPadding = 20;        // web GlassPanel p-4 sm:p-5
    private const double IconFontSize = 16;        // web h-4 w-4
    private const double AnnotationFontSize = 11;  // web text-[10px]
    private const double DotSize = 6;              // web h-1.5 w-1.5
    private const double SkeletonRadius = 10;
    private const string RadioGlyph = "\uE93C";    // Segoe Fluent Radio (web lucide Radio)
    private const string BarChartGlyph = "\uE9D9"; // Segoe Fluent BarChart (web lucide BarChart3)
    private const string ActivityGlyph = "\uE9D2"; // Segoe Fluent activity/pulse (web lucide Activity)

    private readonly ILocalizer _localizer;
    private readonly SignalChartPanelDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new();

    private SignalChartPanelModel _model;
    private double _chartHeight = DefaultChartHeight;
    private double _gridCellWidth = DefaultGridCellWidth;
    private bool _reduceMotion = MotionPreference.ReduceMotion;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="SignalChartPanelModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SignalChartPanel(
        ILocalizer localizer,
        SignalChartPanelModel? model = null,
        SignalChartPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SignalChartPanelModel.Pending;
        _diagnostics = diagnostics ?? new SignalChartPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SignalChartPanel</c>).</summary>
    public static string Slug => SignalChartPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public SignalChartPanelModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The chart body height in pixels (web <c>height</c>); reassigning re-renders.</summary>
    public double ChartHeight
    {
        get => _chartHeight;
        set
        {
            _chartHeight = value;
            Render();
        }
    }

    /// <summary>The small-multiples cell width in pixels; reassigning re-renders.</summary>
    public double GridCellWidth
    {
        get => _gridCellWidth;
        set
        {
            _gridCellWidth = value;
            Render();
        }
    }

    /// <summary>When true, suppress the live pulse (system / accessibility reduced-motion setting); reassigning re-renders.</summary>
    public bool ReduceMotion
    {
        get => _reduceMotion;
        set
        {
            _reduceMotion = value;
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        SignalChartPanelDisplay display = SignalChartPanelProjection.Project(_model, _localizer);

        var root = new StackPanel { Spacing = 16 };
        root.Children.Add(BuildHeader(display));
        root.Children.Add(BuildBody(display));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = root };
        AutomationProperties.SetName(panel, display.AutomationName);
        AutomationProperties.SetName(this, display.AutomationName);
        _fade.Content = panel;
    }

    // web `<div className="flex items-center gap-2 mb-4">`: icon · title · (ml-auto) annotation.
    private Grid BuildHeader(SignalChartPanelDisplay display)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = display.IsLive ? RadioGlyph : BarChartGlyph,
            FontSize = IconFontSize,
            Foreground = display.IsLive ? DangerBrush() : InfoBrush(),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        if (display.ShowLivePulse && !_reduceMotion)
        {
            PulseHelper.Attach(icon);
        }

        left.Children.Add(icon);
        left.Children.Add(new PanelTitle { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(left, 0);
        header.Children.Add(left);

        FrameworkElement? annotation = BuildAnnotation(display);
        if (annotation is not null)
        {
            Grid.SetColumn(annotation, 1);
            header.Children.Add(annotation);
        }

        return header;
    }

    // web right-aligned annotation: the live pulse-dot + "events · points" counters, or the historical
    // "points loaded" note. Decorative — the composed surface Narrator name carries the same text.
    private FrameworkElement? BuildAnnotation(SignalChartPanelDisplay display)
    {
        if (string.IsNullOrEmpty(display.HeaderAnnotation))
        {
            return null;
        }

        if (display.IsLive)
        {
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                HorizontalAlignment = HorizontalAlignment.Right,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var dot = new Ellipse
            {
                Width = DotSize,
                Height = DotSize,
                Fill = DangerBrush(),
                VerticalAlignment = VerticalAlignment.Center,
            };
            if (display.ShowLivePulse && !_reduceMotion)
            {
                PulseHelper.Attach(dot);
            }

            row.Children.Add(dot);
            row.Children.Add(new TextBlock
            {
                Text = display.HeaderAnnotation,
                FontSize = AnnotationFontSize,
                Foreground = DangerBrush(),
                VerticalAlignment = VerticalAlignment.Center,
            });

            AutomationProperties.SetAccessibilityView(row, AccessibilityView.Raw);
            return row;
        }

        var caption = new TextBlock
        {
            Text = display.HeaderAnnotation,
            FontSize = AnnotationFontSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(caption, AccessibilityView.Raw);
        return caption;
    }

    private UIElement BuildBody(SignalChartPanelDisplay display) => display.State switch
    {
        SignalChartPanelState.Loading => BuildLoading(display),
        SignalChartPanelState.Grid => BuildGrid(display),
        SignalChartPanelState.LiveWaiting => BuildNotice(RadioGlyph, display.WaitingMessage, DangerBrush(), pulse: display.ShowLivePulse),
        SignalChartPanelState.Empty => BuildNotice(ActivityGlyph, display.EmptyMessage, DisplayTokens.TextMuted, pulse: false),
        _ => BuildOverlay(display),
    };

    // ── Loading (parent's first historical fetch in flight) ───────────────────────────────────────────
    private TsSkeleton BuildLoading(SignalChartPanelDisplay display)
    {
        var skeleton = new TsSkeleton { BlockHeight = _chartHeight, Radius = SkeletonRadius };
        LiveRegion.Configure(skeleton);
        LiveRegion.Announce(skeleton);
        AutomationProperties.SetName(skeleton, display.LoadingLabel);
        return skeleton;
    }

    /// <summary>
    /// The stacked multi-line chart — the native analogue of the web recharts <c>LineChart</c> with its built-in
    /// <c>&lt;Legend /&gt;</c>. The projection already built one render-ready <see cref="ChartSeries"/> per pinned
    /// signal (palette index by selection order, null readings dropped as gaps). The web's auto dual-Y-axis
    /// (<c>useRightAxis</c>) is preserved as <see cref="SignalChartPanelDisplay.UseRightAxis"/> for parity and is
    /// verified by the headless tests; the shared native cartesian surface presents a single auto-scaled Y domain
    /// that fits every series, so a second axis is not drawn (a platform mapping, not a parity shortcut). The web
    /// disables series animation in live mode (<c>isAnimationActive={!isLive}</c>); the native chart draws static
    /// polylines, so the live treatment matches without extra work.
    /// </summary>
    private TsLineChart BuildOverlay(SignalChartPanelDisplay display)
    {
        var chart = new TsLineChart
        {
            Series = display.Series,
            Title = display.Title,
            Height = _chartHeight,
            ShowLegend = true,   // web recharts <Legend />
            IncludeZero = false, // web YAxis auto-domain (no forced zero baseline)
        };
        AutomationProperties.SetName(chart, display.AutomationName);
        return chart;
    }

    // ── Grid (web SmallMultiplesChart — one cell per pinned signal) ───────────────────────────────────
    private TsSmallMultiplesChart BuildGrid(SignalChartPanelDisplay display)
    {
        var grid = new TsSmallMultiplesChart
        {
            Series = display.Series,
            CellWidth = _gridCellWidth,
        };
        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    // web `<div className="flex items-center justify-center" style={{ height }}>`: a centred icon + muted
    // message standing in for an empty / waiting chart, never a blank box. The icon pulses red while live.
    private Grid BuildNotice(string glyph, string message, Brush iconBrush, bool pulse)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = IconFontSize,
            Foreground = iconBrush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        if (pulse && !_reduceMotion)
        {
            PulseHelper.Attach(icon);
        }

        row.Children.Add(icon);
        row.Children.Add(new TextBlock
        {
            Text = message,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var host = new Grid { Height = _chartHeight };
        host.Children.Add(row);
        LiveRegion.Configure(host);
        LiveRegion.Announce(host);
        AutomationProperties.SetName(host, message);
        return host;
    }

    // web `text-red-500` / `text-red-400` mapped to the theme-aware danger token (light / dark / high-contrast).
    private static Brush DangerBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Danger));

    // web `text-neon-cyan` mapped to the theme-aware info/cyan token rather than a hard-coded neon hex.
    private static Brush InfoBrush() => DisplayTokens.Brush(StatusResources.AccentBrushKey(StatusKind.Info));

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SignalChartPanelAutomationPeer(this);

    private sealed class SignalChartPanelAutomationPeer(SignalChartPanel owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
