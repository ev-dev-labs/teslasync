using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>HealthGaugeGrid</c> feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx. It is a presentational section of
/// the Drivetrain-Health experience: assign a <see cref="Model"/> (the web component's props plus the active
/// units and the parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="HealthGaugeGridState.Loading"/> (skeleton chrome while the query is in flight),
/// <see cref="HealthGaugeGridState.Empty"/> (a friendly empty state when there is no drivetrain data),
/// <see cref="HealthGaugeGridState.Error"/> (a retriable <see cref="TsQueryError"/>), or the populated three
/// panels (<see cref="HealthGaugeGridState.Ready"/> / <see cref="HealthGaugeGridState.Stale"/> /
/// <see cref="HealthGaugeGridState.Offline"/>) the web renders inside a responsive 1→3 column grid: a centred
/// health-score radial gauge with a muted description, a "Motor Details" key/value panel capped by a live
/// "Real-time telemetry active" line, and a "Drive Statistics" key/value panel that falls back to an inline
/// four-line skeleton while its stats are still loading — with a stale / offline freshness chip layered above
/// the cached grid. The view never performs HTTP; all branch selection, unit conversion, formatting and the
/// active-sensor count happen in the WinUI-free <see cref="HealthGaugeGridProjection"/>. The gauge arc is drawn
/// from the shared <see cref="ChartGeometry"/> / <see cref="ChartShapes"/> primitives (the same ones
/// <c>TsRadialGauge</c> uses) because the web colours the gauge by <c>HEALTH_COLOR[overallHealth]</c> — a
/// semantic status, not a brand-palette role. Entrances fade through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, and the surface carries a Narrator name. A
/// failed snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the parent
/// owns the query).
/// </summary>
public sealed partial class HealthGaugeGrid : ContentControl
{
    private const string ActivityGlyph = "\uE9D9"; // Segoe Fluent — Health/pulse (web lucide Activity)
    private const string EmptyGlyph = "\uE9D9";     // same health glyph for the empty surface

    private const double GaugeDiameter = 140;   // web RadialGauge size={140}
    private const double GaugeStrokeWidth = 8;   // web RadialGauge STROKE_WIDTH
    private const double TrackSweep = 0.9999;     // full background ring (web full circle)
    private const double PanelPadding = 24;       // web p-6
    private const double PanelSpacing = 12;       // web title mb-3 / description mt-3
    private const double GridGutter = 16;         // web gap={4}
    private const int GridColumns = 3;            // web md:grid-cols-3
    private const double PanelMinWidth = 280;     // collapse 3→1 columns when narrow (web grid-cols-1 md:grid-cols-3)
    private const int SkeletonRowCount = 4;       // web Skeleton lines={4}
    private const int FadeDelayMs = 100;          // web FadeIn delay={0.1}

    private readonly ILocalizer _localizer;
    private readonly HealthGaugeGridDiagnostics _diagnostics;

    private HealthGaugeGridModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="HealthGaugeGridModel.Loading()"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HealthGaugeGrid(
        ILocalizer localizer,
        HealthGaugeGridModel? model = null,
        HealthGaugeGridDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? HealthGaugeGridModel.Loading();
        _diagnostics = diagnostics ?? new HealthGaugeGridDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>HealthGaugeGrid</c>).</summary>
    public static string Slug => HealthGaugeGridRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public HealthGaugeGridModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference (web <c>useUnits</c>); reassigning re-projects the drive stats in the new units.</summary>
    public UnitPref Units
    {
        get => _model.Units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_model.Units == value)
            {
                return;
            }

            _model = _model with { Units = value };
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
        HealthGaugeGridDisplay display = HealthGaugeGridProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            HealthGaugeGridState.Loading => BuildLoading(display),
            HealthGaugeGridState.Empty => BuildEmpty(display),
            HealthGaugeGridState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: the three-panel grid) ───────────────────────────────────
    private static TsFadeIn BuildContent(HealthGaugeGridDisplay display)
    {
        var stack = new StackPanel { Spacing = PanelSpacing };
        if (display.ShowFreshnessChip)
        {
            stack.Children.Add(BuildChip(display));
        }

        stack.Children.Add(BuildGrid(display));
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = stack };
    }

    private static TsGrid BuildGrid(HealthGaugeGridDisplay display)
    {
        var grid = NewGrid();
        grid.Children.Add(BuildGaugePanel(display.Gauge));
        grid.Children.Add(BuildMotorPanel(display));
        grid.Children.Add(BuildDrivePanel(display));
        return grid;
    }

    private static TsGrid NewGrid() =>
        new() { Columns = GridColumns, Gutter = GridGutter, ItemMinWidth = PanelMinWidth };

    // web: <GlassPanel className="flex flex-col items-center justify-center p-6"> RadialGauge + <p>desc</p> </GlassPanel>
    private static TsGlassPanel BuildGaugePanel(HealthGaugeDisplayGauge gauge)
    {
        var column = new StackPanel
        {
            Spacing = PanelSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(BuildGaugeVisual(gauge));
        column.Children.Add(new Caption
        {
            Value = gauge.Description,
            HorizontalAlignment = HorizontalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        });

        AutomationProperties.SetName(column, gauge.AutomationName);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // web RadialGauge: a tokenized background ring, a semantic-coloured value arc swept by value/max, the
    // formatted value + small unit centred, and the label beneath — drawn from the shared gauge primitives.
    private static StackPanel BuildGaugeVisual(HealthGaugeDisplayGauge gauge)
    {
        double radius = (GaugeDiameter - GaugeStrokeWidth) / 2;
        var center = new PointD(GaugeDiameter / 2, GaugeDiameter / 2);

        var canvas = new Canvas { Width = GaugeDiameter, Height = GaugeDiameter };
        canvas.Children.Add(ChartShapes.ArcPath(
            ChartGeometry.RingArc(center, radius, TrackSweep), ChartBrushes.Border, GaugeStrokeWidth));

        if (gauge.Fraction > 0)
        {
            Brush arcBrush = ChartBrushes.Resolve(StatusResources.AccentBrushKey(gauge.Severity));
            canvas.Children.Add(ChartShapes.ArcPath(
                ChartGeometry.RingArc(center, radius, gauge.Fraction), arcBrush, GaugeStrokeWidth));
        }

        AutomationProperties.SetAccessibilityView(canvas, AccessibilityView.Raw);

        var ring = new Grid { Width = GaugeDiameter, Height = GaugeDiameter };
        ring.Children.Add(canvas);
        ring.Children.Add(BuildCenterValue(gauge));

        var column = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Center };
        column.Children.Add(ring);
        column.Children.Add(new Caption { Value = gauge.Label, HorizontalAlignment = HorizontalAlignment.Center });
        return column;
    }

    private static StackPanel BuildCenterValue(HealthGaugeDisplayGauge gauge)
    {
        var value = new TextBlock
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            FontSize = TypographyTokens.Size("TsTypeSectionFontSize", 18),
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        };
        value.Inlines.Add(new Run { Text = gauge.ValueText });
        value.Inlines.Add(new Run
        {
            Text = gauge.UnitLabel,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.Normal,
            Foreground = DisplayTokens.TextMuted,
        });

        var host = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        host.Children.Add(value);
        return host;
    }

    // web: <GlassPanel className="p-6"> <h3>Motor Details</h3> <KVList/> <Activity/> Real-time… </GlassPanel>
    private static TsGlassPanel BuildMotorPanel(HealthGaugeGridDisplay display)
    {
        var stack = new StackPanel { Spacing = PanelSpacing };
        stack.Children.Add(new Label { Value = display.MotorDetailsTitle });
        stack.Children.Add(new TsKVList { Items = ToKeyValues(display.MotorDetails) });
        stack.Children.Add(BuildRealTimeFooter(display.RealTimeText));

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static StackPanel BuildRealTimeFooter(string text)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(DecorativeIcon(ActivityGlyph, 16, DisplayTokens.TextMuted));
        row.Children.Add(new Caption { Value = text, VerticalAlignment = VerticalAlignment.Center });
        return row;
    }

    // web: <GlassPanel className="p-6"> <h3>Drive Statistics</h3> {stats ? <KVList/> : <Skeleton lines={4}/>} </GlassPanel>
    private static TsGlassPanel BuildDrivePanel(HealthGaugeGridDisplay display)
    {
        var stack = new StackPanel { Spacing = PanelSpacing };
        stack.Children.Add(new Label { Value = display.DriveStatsTitle });
        stack.Children.Add(display.ShowDriveStatsSkeleton
            ? BuildRowSkeletons(SkeletonRowCount)
            : new TsKVList { Items = ToKeyValues(display.DriveStats) });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static List<TsKeyValue> ToKeyValues(IReadOnlyList<HealthKeyValue> rows)
    {
        var items = new List<TsKeyValue>(rows.Count);
        foreach (HealthKeyValue row in rows)
        {
            items.Add(new TsKeyValue(row.Label, row.Value));
        }

        return items;
    }

    private static TsBadge BuildChip(HealthGaugeGridDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    // ── Loading (parent still fetching the drivetrain health) ──────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(HealthGaugeGridDisplay display)
    {
        var grid = NewGrid();
        grid.Children.Add(BuildGaugeSkeletonPanel());
        grid.Children.Add(BuildPanelSkeleton());
        grid.Children.Add(BuildPanelSkeleton());

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private static TsGlassPanel BuildGaugeSkeletonPanel()
    {
        var column = new StackPanel
        {
            Spacing = PanelSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(new TsSkeleton
        {
            BlockWidth = GaugeDiameter,
            BlockHeight = GaugeDiameter,
            Radius = GaugeDiameter / 2,
        });
        column.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 12 });

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static TsGlassPanel BuildPanelSkeleton()
    {
        var stack = new StackPanel { Spacing = PanelSpacing };
        stack.Children.Add(new TsSkeleton { BlockWidth = 140, BlockHeight = 14 });
        stack.Children.Add(BuildRowSkeletons(SkeletonRowCount));

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
    }

    private static StackPanel BuildRowSkeletons(int rows)
    {
        var stack = new StackPanel { Spacing = 8 };
        for (int i = 0; i < rows; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = 12 });
        }

        return stack;
    }

    // ── Empty (no drivetrain data to render) ───────────────────────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(HealthGaugeGridDisplay display)
    {
        var empty = new TsEmptyState { IconGlyph = EmptyGlyph, Message = display.EmptyMessage };
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = empty };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError(HealthGaugeGridDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the panel / row caption already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }
}
