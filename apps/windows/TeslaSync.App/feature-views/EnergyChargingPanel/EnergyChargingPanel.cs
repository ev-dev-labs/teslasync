using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>EnergyChargingPanel</c> feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/EnergyChargingPanel.tsx. It is a presentational panel:
/// assign a <see cref="Model"/> (the web <c>chargingTelemetry</c> prop, plus the parent's loading flag) and it
/// renders inside a <see cref="TsGlassPanel"/> a persistent header (the cyan battery glyph + the "Energy &amp;
/// Charging" title) above one of three web-derived branches — <see cref="EnergyChargingState.Loading"/> (skeleton
/// chrome while the parent resolves live telemetry), <see cref="EnergyChargingState.Empty"/> (the friendly "No
/// charging telemetry available" surface for the web <c>: &lt;EmptyState /&gt;</c> branch), or
/// <see cref="EnergyChargingState.Ready"/> (the two <see cref="TsStatCard"/> metric tiles — Charger Voltage,
/// Charger Current — above the Charger Power, Energy Added, Charging State chip, Battery Level and Charge Rate
/// rows). The view never performs HTTP; all branch selection, label resolution and SI→display unit conversion
/// happen in the WinUI-free <see cref="EnergyChargingPanelProjection"/>. Every string resolves through the i18n
/// facade, and the surface plus each row carry a Narrator name.
/// </summary>
public sealed partial class EnergyChargingPanel : ContentControl
{
    private const double PanelPadding = 24;        // web p-6
    private const double HeaderGap = 8;            // web gap-2
    private const double HeaderToBodyGap = 20;     // web mb-5
    private const double BodyGap = 16;             // web space-y-4
    private const double MetricGridGap = 12;       // web gap-3
    private const double RowLabelGap = 4;          // web gap-1 (Charge Rate icon → label)
    private const double HeaderIconSize = 16;      // web h-4 w-4
    private const double RowIconSize = 12;         // web h-3 w-3
    private const double LabelFontSize = 12;       // web text-xs
    private const double ValueFontSize = 14;       // web text-sm
    private const double ChipFontSize = 11;        // web text-[11px]
    private const double ChipPaddingX = 12;        // web px-3
    private const double ChipPaddingY = 4;         // web py-1
    private const double MetricSkeletonHeight = 56;
    private const double RowSkeletonHeight = 14;
    private const int RowSkeletonCount = 5;
    private const string HeaderAccentBrushKey = "TsChartSpeedBrush";   // cyan, web text-cyan-300
    private const string ChargingToneBrushKey = "TsChartSpeedBrush";  // cyan, web Charging chip
    private const string CompleteToneBrushKey = "TsChartBatteryBrush"; // green, web Complete chip

    private readonly ILocalizer _localizer;
    private readonly EnergyChargingPanelDiagnostics _diagnostics;

    private readonly TsGlassPanel _panel = new() { Padding = new Thickness(PanelPadding) };
    private readonly StackPanel _root = new() { Spacing = HeaderToBodyGap };
    private readonly Border _bodyHost = new();
    private readonly FontIcon _headerIcon = new() { FontSize = HeaderIconSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly SectionTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };

    private EnergyChargingPanelModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, unit preference and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="EnergyChargingPanelModel.Pending"/>.</param>
    /// <param name="units">The user's display preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EnergyChargingPanel(
        ILocalizer localizer,
        EnergyChargingPanelModel? model = null,
        UnitPref? units = null,
        EnergyChargingPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? EnergyChargingPanelModel.Pending;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new EnergyChargingPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>EnergyChargingPanel</c>).</summary>
    public static string Slug => EnergyChargingPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public EnergyChargingPanelModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the rows in the new locale / precision / speed unit.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
            Render();
        }
    }

    private void BuildChrome()
    {
        _headerIcon.Foreground = ChartBrushes.Resolve(HeaderAccentBrushKey);
        AutomationProperties.SetAccessibilityView(_headerIcon, AccessibilityView.Raw);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(_headerIcon);
        header.Children.Add(_title);

        _root.Children.Add(header);
        _root.Children.Add(_bodyHost);
        _panel.Content = _root;
        Content = _panel;
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
        EnergyChargingPanelDisplay display = EnergyChargingPanelProjection.Project(_model, _localizer, _units);

        _headerIcon.Glyph = display.HeaderGlyph;
        _title.Value = display.Title;

        _bodyHost.Child = display.State switch
        {
            EnergyChargingState.Loading => BuildLoading(),
            EnergyChargingState.Ready => BuildContent(display),
            _ => BuildEmpty(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
    }

    // ── Ready: the metric body (web truthy chargingTelemetry branch) ─────────────────────────────────
    private static StackPanel BuildContent(EnergyChargingPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = BodyGap };

        stack.Children.Add(BuildMetricGrid(display.Voltage, display.Current));
        stack.Children.Add(BuildStatRow(display.Power));
        stack.Children.Add(BuildStatRow(display.Energy));
        stack.Children.Add(BuildChipRow(display.ChargingState));
        stack.Children.Add(BuildStatRow(display.Battery));
        stack.Children.Add(BuildStatRow(display.ChargeRate));

        return stack;
    }

    // Web grid grid-cols-2 gap-3 of two <MetricCard> tiles.
    private static Grid BuildMetricGrid(EnergyChargingMetric voltage, EnergyChargingMetric current)
    {
        var grid = new Grid { ColumnSpacing = MetricGridGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        TsStatCard voltageCard = BuildMetricCard(voltage);
        TsStatCard currentCard = BuildMetricCard(current);
        Grid.SetColumn(voltageCard, 0);
        Grid.SetColumn(currentCard, 1);
        grid.Children.Add(voltageCard);
        grid.Children.Add(currentCard);

        return grid;
    }

    // Web <MetricCard label value subtitle />. The native TsStatCard is the data-display tile that carries a value
    // sub-line (Sublabel), so the web card's subtitle (the unit symbol) maps onto it.
    private static TsStatCard BuildMetricCard(EnergyChargingMetric metric)
    {
        var card = new TsStatCard
        {
            Label = metric.Label,
            Value = metric.Value,
            Sublabel = metric.Subtitle,
        };

        AutomationProperties.SetName(card, metric.AutomationName);
        return card;
    }

    // Web "flex items-center justify-between" row: a muted label on the left, a mono value on the right.
    private static Grid BuildStatRow(EnergyChargingStat stat)
    {
        var grid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        FrameworkElement label = BuildRowLabel(stat.Glyph, stat.Label);
        TextBlock value = BuildRowValue(stat.Value);
        Grid.SetColumn(label, 0);
        Grid.SetColumn(value, 1);
        grid.Children.Add(label);
        grid.Children.Add(value);

        AutomationProperties.SetName(grid, stat.AutomationName);
        return grid;
    }

    // Web "Charging State" row: a muted label on the left, a tone-coloured rounded chip on the right.
    private static Grid BuildChipRow(EnergyChargingChip chip)
    {
        var grid = new Grid { VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        FrameworkElement label = BuildRowLabel(string.Empty, chip.Label);
        Border pill = BuildChip(chip);
        Grid.SetColumn(label, 0);
        Grid.SetColumn(pill, 1);
        grid.Children.Add(label);
        grid.Children.Add(pill);

        AutomationProperties.SetName(grid, chip.AutomationName);
        return grid;
    }

    private static Border BuildChip(EnergyChargingChip chip)
    {
        Brush tone = ToneBrush(chip.Tone);

        var text = new TextBlock
        {
            Text = chip.Value,
            FontSize = ChipFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = tone,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Child = text,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 999),
            BorderBrush = tone,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(ChipPaddingX, ChipPaddingY, ChipPaddingX, ChipPaddingY),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private static FrameworkElement BuildRowLabel(string glyph, string label)
    {
        var text = new TextBlock
        {
            Text = label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (string.IsNullOrEmpty(glyph))
        {
            return text;
        }

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = RowIconSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowLabelGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(icon);
        row.Children.Add(text);
        return row;
    }

    private static TextBlock BuildRowValue(string value)
    {
        var text = new TextBlock
        {
            Text = value,
            FontSize = ValueFontSize,
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        FontFamily? mono = TypographyTokens.Mono;
        if (mono is not null)
        {
            text.FontFamily = mono;
        }

        return text;
    }

    private static Brush ToneBrush(ChargingStateTone tone) => tone switch
    {
        ChargingStateTone.Charging => ChartBrushes.Resolve(ChargingToneBrushKey),
        ChargingStateTone.Complete => ChartBrushes.Resolve(CompleteToneBrushKey),
        _ => DisplayTokens.TextSecondary,
    };

    // ── Empty: the web : <EmptyState /> branch (inside the panel, under the header) ──────────────────
    private static TsEmptyState BuildEmpty(EnergyChargingPanelDisplay display) => new()
    {
        Message = display.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    // ── Loading: a skeleton mirroring the populated layout (metric grid + label/value rows) ──────────
    private StackPanel BuildLoading()
    {
        var stack = new StackPanel { Spacing = BodyGap };

        var grid = new Grid { ColumnSpacing = MetricGridGap };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var leftTile = new TsSkeleton { BlockHeight = MetricSkeletonHeight };
        var rightTile = new TsSkeleton { BlockHeight = MetricSkeletonHeight };
        Grid.SetColumn(leftTile, 0);
        Grid.SetColumn(rightTile, 1);
        grid.Children.Add(leftTile);
        grid.Children.Add(rightTile);
        stack.Children.Add(grid);

        for (int i = 0; i < RowSkeletonCount; i++)
        {
            stack.Children.Add(new TsSkeleton { BlockHeight = RowSkeletonHeight });
        }

        AutomationProperties.SetName(stack, _title.Value);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new EnergyChargingPanelAutomationPeer(this);

    private sealed class EnergyChargingPanelAutomationPeer(EnergyChargingPanel owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
