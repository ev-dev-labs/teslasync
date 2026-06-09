using Microsoft.UI.Text;
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
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews.WeeklyDigest;

/// <summary>
/// The native WinUI 3 <c>AlertsSection</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/AlertsSection.tsx. It is a presentational section:
/// assign a <see cref="Model"/> (the web <c>metrics</c> prop, narrowed to the alert fields, plus the
/// parent's fetch flag) and it renders exactly one of three web-derived branches —
/// <see cref="AlertsSectionState.Loading"/> (skeleton chrome while the parent Weekly-Digest query is in
/// flight), <see cref="AlertsSectionState.Empty"/> (the header over a friendly "No alerts this week …"
/// empty state when <c>alertTotal === 0</c>), or <see cref="AlertsSectionState.Content"/> (the header with
/// the warning total badge, the "Alerts by Severity" glass cards, and the "Alert Distribution" donut with
/// its colour-keyed legend). The view never performs HTTP; all branch selection, label resolution,
/// classification and formatting happen in the WinUI-free <see cref="AlertsSectionProjection"/>. The
/// content panel enters through <see cref="TsFadeIn"/> (honouring reduce-motion); the donut is drawn from
/// the shared <see cref="ChartGeometry"/> + <see cref="ChartBrushes"/> primitives (the same toolkit
/// <c>TsPieChart</c> is built on) so each slice carries the web's <em>semantic</em> severity colour
/// (critical → danger, warning → warning, info → chart-0) rather than a flat palette; every string resolves
/// through the i18n facade; and the surface, each severity card and each legend entry carry a Narrator name.
/// </summary>
public sealed partial class AlertsSection : ContentControl
{
    private const double TitleFontSize = 18;       // web text-lg
    private const double TitleIconFontSize = 20;   // web h-5 w-5
    private const double SectionLabelFontSize = 14; // web text-sm
    private const double RowLabelFontSize = 14;    // web text-sm
    private const double RowIconFontSize = 16;     // web h-4 w-4
    private const double BadgeTextFontSize = 11;   // web Badge size="sm"
    private const double LegendLabelFontSize = 12; // web Legend wrapperStyle fontSize 12
    private const double LegendDotSize = 12;
    private const double DonutSize = 224;
    private const double DonutPadding = 8;
    private const double DonutInnerRadiusRatio = 0.611; // web innerRadius 55 / outerRadius 90

    private readonly ILocalizer _localizer;
    private readonly AlertsSectionDiagnostics _diagnostics;

    private AlertsSectionModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="AlertsSectionModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertsSection(
        ILocalizer localizer,
        AlertsSectionModel? model = null,
        AlertsSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? AlertsSectionModel.Pending;
        _diagnostics = diagnostics ?? new AlertsSectionDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AlertsSection</c>).</summary>
    public static string Slug => AlertsSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public AlertsSectionModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
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
        var display = AlertsSectionProjection.Project(_model, _localizer);

        TsGlassPanel panel = display.State switch
        {
            AlertsSectionState.Loading => BuildLoading(display),
            AlertsSectionState.Empty => BuildEmpty(display),
            _ => BuildContent(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);

        // Web parity: the whole GlassPanel is wrapped in <FadeIn delay={0.25}>. The loading branch is the
        // parent's skeleton hand-off, which is revealed immediately (a pulsing skeleton, never a fade-rise).
        Content = display.State == AlertsSectionState.Loading
            ? panel
            : new TsFadeIn { DelayMs = 250, Content = panel };
    }

    // ── Loading (parent Weekly-Digest still fetching) ────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(AlertsSectionDisplay display)
    {
        var body = SectionStack();
        body.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = TitleFontSize, Radius = 6 });

        var grid = TwoColumnGrid();

        var left = new StackPanel { Spacing = 12 };
        left.Children.Add(new TsSkeleton { BlockWidth = 140, BlockHeight = SectionLabelFontSize, Radius = 6 });
        for (int i = 0; i < 3; i++)
        {
            left.Children.Add(new TsSkeleton { BlockHeight = 48, Radius = 10 });
        }

        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center };
        right.Children.Add(new TsSkeleton { BlockWidth = 140, BlockHeight = SectionLabelFontSize, Radius = 6 });
        right.Children.Add(new TsSkeleton
        {
            BlockWidth = DonutSize,
            BlockHeight = DonutSize,
            Radius = DonutSize / 2,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        body.Children.Add(grid);

        var panel = Panel(body, display.AutomationName);
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        return panel;
    }

    // ── Empty (web metrics.alertTotal === 0) ─────────────────────────────────────────────────────────
    private static TsGlassPanel BuildEmpty(AlertsSectionDisplay display)
    {
        var body = SectionStack();
        body.Children.Add(BuildHeader(display));
        body.Children.Add(new TsEmptyState
        {
            IconGlyph = AlertsSectionRegistration.WarningTriangleGlyph,
            Message = display.EmptyMessage,
        });

        return Panel(body, display.AutomationName);
    }

    // ── Content (web fall-through: severity breakdown list + distribution donut) ──────────────────────
    private static TsGlassPanel BuildContent(AlertsSectionDisplay display)
    {
        var body = SectionStack();
        body.Children.Add(BuildHeader(display));

        var grid = TwoColumnGrid();

        var left = BuildSeverityList(display);
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = BuildDistribution(display);
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);

        body.Children.Add(grid);
        return Panel(body, display.AutomationName);
    }

    // Web: <span className="flex items-center gap-2 text-lg font-bold text-white"> AlertTriangle + title + Badge.
    private static StackPanel BuildHeader(AlertsSectionDisplay display)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        header.Children.Add(Icon(
            AlertsSectionRegistration.WarningTriangleGlyph,
            TitleIconFontSize,
            ChartBrushes.ForStatus(StatusKind.Warning))); // web text-neon-amber

        header.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        if (display.TotalBadgeText is { } total)
        {
            // Web: <Badge variant="warning" size="sm">{fmtInt(alertTotal)}</Badge>.
            header.Children.Add(CountBadge(total, StatusKind.Warning));
        }

        // The header's content is carried by the surface Narrator name; keep it out of the tree to avoid
        // a duplicate announcement of the title + count.
        AutomationProperties.SetAccessibilityView(header, AccessibilityView.Raw);
        return header;
    }

    private static StackPanel BuildSeverityList(AlertsSectionDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(SectionLabel(display.BySeverityLabel, HorizontalAlignment.Left));

        var cards = new StackPanel { Spacing = 12 };
        foreach (var row in display.Rows)
        {
            cards.Children.Add(BuildSeverityCard(row));
        }

        column.Children.Add(cards);
        return column;
    }

    // Web: <GlassPanel className="flex items-center justify-between px-4 py-3"> icon+label … Badge.
    private static TsGlassPanel BuildSeverityCard(AlertSeverityRow row)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (AlertsSectionRegistration.RowGlyph(row.Class) is { } glyph)
        {
            labelRow.Children.Add(Icon(glyph, RowIconFontSize, BrushFor(row.Class)));
        }

        labelRow.Children.Add(new TextBlock
        {
            Text = row.Label,
            FontSize = RowLabelFontSize,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        Grid.SetColumn(labelRow, 0);
        grid.Children.Add(labelRow);

        var badge = CountBadge(row.CountText, row.BadgeStatus);
        Grid.SetColumn(badge, 1);
        grid.Children.Add(badge);

        var card = new TsGlassPanel
        {
            Padding = new Thickness(16, 12, 16, 12), // web px-4 py-3
            Content = grid,
        };
        AutomationProperties.SetName(card, row.AutomationName);
        AutomationProperties.SetAccessibilityView(card, AccessibilityView.Content);
        return card;
    }

    private static StackPanel BuildDistribution(AlertsSectionDisplay display)
    {
        var column = new StackPanel { Spacing = 12, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(SectionLabel(display.DistributionLabel, HorizontalAlignment.Center));
        column.Children.Add(BuildDonut(display));
        column.Children.Add(BuildLegend(display));
        return column;
    }

    // Web: <ResponsiveContainer><PieChart><Pie innerRadius=55 outerRadius=90 …/> per-Cell entry.color.
    // TsPieChart colours slices by palette index only, so the donut is drawn here from the shared
    // ChartGeometry + ChartBrushes primitives to preserve the web's semantic per-severity colours.
    private static FrameworkElement BuildDonut(AlertsSectionDisplay display)
    {
        if (display.Rows.Count == 0)
        {
            return EmptyDonutNote(display.EmptyMessage);
        }

        var canvas = new Canvas
        {
            Width = DonutSize,
            Height = DonutSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var points = new List<ChartPoint>(display.Rows.Count);
        foreach (var row in display.Rows)
        {
            points.Add(new ChartPoint(0, row.Count, row.Label));
        }

        double radius = (DonutSize / 2) - DonutPadding;
        var center = new PointD(DonutSize / 2, DonutSize / 2);
        var slices = ChartGeometry.PieSlices(points);

        if (slices.Count == 1)
        {
            // A single severity is a full ring — an ArcSegment swept a full turn is degenerate, so draw a
            // solid disc that the inner hole turns into a ring.
            canvas.Children.Add(Disc(center, radius, BrushFor(display.Rows[0].Class)));
        }
        else
        {
            for (int i = 0; i < slices.Count; i++)
            {
                canvas.Children.Add(Wedge(center, radius, slices[i], BrushFor(display.Rows[i].Class)));
            }
        }

        double innerRadius = radius * DonutInnerRadiusRatio;
        var hole = new Ellipse
        {
            Width = innerRadius * 2,
            Height = innerRadius * 2,
            Fill = ChartBrushes.Surface,
        };
        Canvas.SetLeft(hole, center.X - innerRadius);
        Canvas.SetTop(hole, center.Y - innerRadius);
        canvas.Children.Add(hole);

        AutomationProperties.SetName(canvas, $"{display.DistributionLabel}. {display.ChartSummary}");
        return canvas;
    }

    // Web: <Legend iconType="circle"> over the pie entries (their names).
    private static StackPanel BuildLegend(AlertsSectionDisplay display)
    {
        var legend = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 16,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var row in display.Rows)
        {
            legend.Children.Add(BuildLegendItem(row));
        }

        return legend;
    }

    private static StackPanel BuildLegendItem(AlertSeverityRow row)
    {
        var item = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var dot = new Ellipse
        {
            Width = LegendDotSize,
            Height = LegendDotSize,
            Fill = BrushFor(row.Class),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = row.Label,
            FontSize = LegendLabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        item.Children.Add(dot);
        item.Children.Add(label);
        AutomationProperties.SetName(item, row.AutomationName);
        return item;
    }

    private static TextBlock EmptyDonutNote(string message) => new()
    {
        Text = message,
        FontSize = RowLabelFontSize,
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        Width = DonutSize,
        Height = DonutSize,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Microsoft.UI.Xaml.Shapes.Path Wedge(PointD center, double radius, PieSlice slice, Brush fill)
    {
        var start = ChartGeometry.PointOnCircle(center, radius, slice.StartAngleDeg);
        var end = ChartGeometry.PointOnCircle(center, radius, slice.StartAngleDeg + slice.SweepAngleDeg);

        var figure = new PathFigure { StartPoint = new Point(center.X, center.Y), IsClosed = true };
        figure.Segments.Add(new LineSegment { Point = new Point(start.X, start.Y) });
        figure.Segments.Add(new ArcSegment
        {
            Point = new Point(end.X, end.Y),
            Size = new Size(radius, radius),
            IsLargeArc = slice.SweepAngleDeg > 180,
            SweepDirection = SweepDirection.Clockwise,
        });

        var geometry = new PathGeometry();
        geometry.Figures.Add(figure);
        return new Microsoft.UI.Xaml.Shapes.Path { Data = geometry, Fill = fill };
    }

    private static Ellipse Disc(PointD center, double radius, Brush fill)
    {
        var disc = new Ellipse { Width = radius * 2, Height = radius * 2, Fill = fill };
        Canvas.SetLeft(disc, center.X - radius);
        Canvas.SetTop(disc, center.Y - radius);
        return disc;
    }

    // Severity colour map — the native port of the web ALERT_SEVERITY_COLORS + STATUS_COLORS tables:
    // critical → STATUS_COLORS.critical (danger), warning → STATUS_COLORS.warning, info → CHART_COLORS[0]
    // (categorical brush 0), and any other severity → CHART_COLORS[4] (categorical brush 4).
    private static Brush BrushFor(AlertSeverityClass severityClass) => severityClass switch
    {
        AlertSeverityClass.Critical => ChartBrushes.ForStatus(StatusKind.Danger),
        AlertSeverityClass.Warning => ChartBrushes.ForStatus(StatusKind.Warning),
        AlertSeverityClass.Info => ChartBrushes.ForIndex(0),
        _ => ChartBrushes.ForIndex(4),
    };

    private static TsBadge CountBadge(string text, StatusKind status) => new()
    {
        Status = status,
        Content = new TextBlock { Text = text, FontSize = BadgeTextFontSize },
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TextBlock SectionLabel(string text, HorizontalAlignment alignment) => new()
    {
        Text = text,
        FontSize = SectionLabelFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        HorizontalAlignment = alignment,
        TextAlignment = alignment == HorizontalAlignment.Center ? TextAlignment.Center : TextAlignment.Left,
    };

    private static FontIcon Icon(string glyph, double fontSize, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = fontSize,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — its meaning is carried by the adjacent text and the surface / card Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static StackPanel SectionStack() => new() { Spacing = 24 }; // web space-y-6

    private static Grid TwoColumnGrid()
    {
        // Web: grid grid-cols-1 gap-6 lg:grid-cols-2 — the wide-layout two-column breakdown.
        var grid = new Grid { ColumnSpacing = 24, RowSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        return grid;
    }

    private static TsGlassPanel Panel(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(24), // web p-6
            Content = content,
        };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }
}
