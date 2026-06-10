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
/// The native WinUI 3 <c>TemperatureGauges</c> feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx. It is a presentational section of
/// the Drivetrain-Health experience: assign a <see cref="Model"/> (the web <c>sensors: TempSensor[]</c> prop plus
/// the active units and the parent-supplied lifecycle status) and it renders one of the contract's states —
/// <see cref="TemperatureGaugesState.Loading"/> (skeleton gauges while the query is in flight),
/// <see cref="TemperatureGaugesState.Empty"/> (a friendly empty state when there are no sensors),
/// <see cref="TemperatureGaugesState.Error"/> (a retriable <see cref="TsQueryError"/>), or the populated panel
/// (<see cref="TemperatureGaugesState.Ready"/> / <see cref="TemperatureGaugesState.Stale"/> /
/// <see cref="TemperatureGaugesState.Offline"/>) — the glass panel the web renders: the Thermometer-icon title and
/// a responsive grid of radial gauges, each a severity-tinted value arc with a centred reading and a "Max: N°"
/// caption, with a stale / offline freshness chip layered on the cached gauges. The view never performs HTTP; all
/// branch selection, unit conversion, formatting and severity thresholding happen in the WinUI-free
/// <see cref="TemperatureGaugesProjection"/>. Each gauge arc is drawn from the shared
/// <see cref="ChartGeometry"/> / <see cref="ChartShapes"/> primitives (the same ones <c>TsRadialGauge</c> uses)
/// because the web colours every gauge by <c>tempSeverityColor</c> and the shared gauge control exposes only a
/// brand-palette role, not a semantic status. Entrances fade through <see cref="TsFadeIn"/> (honouring
/// reduce-motion), every string resolves through the i18n facade, and the surface + each gauge carry a Narrator
/// name. A failed snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the
/// parent owns the query).
/// </summary>
public sealed partial class TemperatureGauges : ContentControl
{
    private const string ThermometerGlyph = "\uE9CA"; // Segoe Fluent — Thermometer (web Thermometer)

    private const double GaugeDiameter = 120;   // web RadialGauge size default
    private const double GaugeStrokeWidth = 8;   // web RadialGauge STROKE_WIDTH
    private const double TrackSweep = 0.9999;     // full background ring (web full circle)
    private const double ContentSpacing = 16;     // web title mb-4
    private const double PanelPadding = 24;       // web p-6
    private const double GridGutter = 24;         // web gap-6
    private const double GaugeMinWidth = 150;     // collapse 4→2→1 columns when narrow (web grid-cols-2 md:grid-cols-4)
    private const int GaugeColumns = 4;            // web md:grid-cols-4
    private const int SkeletonGaugeCount = 4;      // skeleton chrome mirrors the canonical sensor count
    private const int FadeDelayMs = 150;           // web FadeIn delay 0.15

    private readonly ILocalizer _localizer;
    private readonly TemperatureGaugesDiagnostics _diagnostics;

    private TemperatureGaugesModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="TemperatureGaugesModel.Loading()"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TemperatureGauges(
        ILocalizer localizer,
        TemperatureGaugesModel? model = null,
        TemperatureGaugesDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? TemperatureGaugesModel.Loading();
        _diagnostics = diagnostics ?? new TemperatureGaugesDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TemperatureGauges</c>).</summary>
    public static string Slug => TemperatureGaugesRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public TemperatureGaugesModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference (web <c>useUnits</c>); reassigning re-projects the gauges in the new units.</summary>
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
        TemperatureGaugesDisplay display = TemperatureGaugesProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State switch
        {
            TemperatureGaugesState.Loading => BuildLoading(display),
            TemperatureGaugesState.Empty => BuildEmpty(display),
            TemperatureGaugesState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline (web fall-through: title + gauge grid) ─────────────────────────────────────
    private static TsFadeIn BuildContent(TemperatureGaugesDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(BuildGaugeGrid(display.Gauges));

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private static Grid BuildHeader(TemperatureGaugesDisplay display)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(ThermometerGlyph, 16, DisplayTokens.TextMuted));
        titleRow.Children.Add(new Label { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static TsBadge BuildChip(TemperatureGaugesDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock
            {
                Text = display.FreshnessChipText,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    private static TsGrid BuildGaugeGrid(IReadOnlyList<TemperatureGaugeDisplayItem> gauges)
    {
        var grid = NewGrid();
        foreach (TemperatureGaugeDisplayItem gauge in gauges)
        {
            grid.Children.Add(BuildGaugeTile(gauge));
        }

        return grid;
    }

    private static TsGrid NewGrid() =>
        new() { Columns = GaugeColumns, Gutter = GridGutter, ItemMinWidth = GaugeMinWidth };

    // web: <div className="flex flex-col items-center"> RadialGauge + <p>Max: …</p> </div>
    private static StackPanel BuildGaugeTile(TemperatureGaugeDisplayItem gauge)
    {
        var tile = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
        tile.Children.Add(BuildGaugeVisual(gauge));
        tile.Children.Add(new Caption { Value = gauge.MaxText, HorizontalAlignment = HorizontalAlignment.Center });

        AutomationProperties.SetName(tile, gauge.AutomationName);
        return tile;
    }

    // web RadialGauge: a tokenized background ring, a severity-coloured value arc swept by value/max, the
    // formatted value + small unit centred, and the label beneath — drawn from the shared gauge primitives.
    private static StackPanel BuildGaugeVisual(TemperatureGaugeDisplayItem gauge)
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

    private static StackPanel BuildCenterValue(TemperatureGaugeDisplayItem gauge)
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

    // ── Loading (parent still fetching the drivetrain health) ──────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(TemperatureGaugesDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(new TsSkeleton { BlockWidth = 160, BlockHeight = 20 });

        var grid = NewGrid();
        for (int i = 0; i < SkeletonGaugeCount; i++)
        {
            var column = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center };
            column.Children.Add(new TsSkeleton { BlockWidth = GaugeDiameter, BlockHeight = GaugeDiameter });
            column.Children.Add(new TsSkeleton { BlockWidth = 72, BlockHeight = 12 });
            grid.Children.Add(column);
        }

        stack.Children.Add(grid);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    // ── Empty (no temperature sensors to gauge) ────────────────────────────────────────────────────────────
    private static TsFadeIn BuildEmpty(TemperatureGaugesDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));
        stack.Children.Add(new TsEmptyState { IconGlyph = ThermometerGlyph, Message = display.EmptyMessage });

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError(TemperatureGaugesDisplay display)
    {
        var stack = new StackPanel { Spacing = ContentSpacing };
        stack.Children.Add(BuildHeader(display));

        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
        };
        error.ActionInvoked += OnRetryInvoked;
        stack.Children.Add(error);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = stack };
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

        // Decorative: the surface / tile automation name already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }
}
