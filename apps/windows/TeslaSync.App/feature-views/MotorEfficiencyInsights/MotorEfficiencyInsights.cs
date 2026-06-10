using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>MotorEfficiencyInsights</c> feature surface — a parity port of
/// web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx. It is a presentational
/// section of the Driving-Dynamics experience: assign a <see cref="Model"/> (the web <c>motorStats</c> /
/// <c>throttleStyle</c> props plus the active units and the parent-supplied lifecycle status) and it renders one
/// of the contract's states — <see cref="MotorEfficiencyInsightsState.Loading"/> (skeleton panels while the
/// query is in flight), <see cref="MotorEfficiencyInsightsState.Empty"/> (each panel's friendly "No motor data
/// recorded yet" surface when there are no stats), <see cref="MotorEfficiencyInsightsState.Error"/> (a retriable
/// <see cref="TsQueryError"/>), or the populated three-panel grid
/// (<see cref="MotorEfficiencyInsightsState.Ready"/> / <see cref="MotorEfficiencyInsightsState.Stale"/> /
/// <see cref="MotorEfficiencyInsightsState.Offline"/>) — the web composition: a Torque-Distribution panel
/// (lightning icon, avg / max torque, high-torque share), a Throttle-Behavior panel (gauge icon, avg power, a
/// style badge and a power metric bar) and a Motor-Thermal panel (thermometer icon, avg / max motor temperature
/// and a thermal badge), with a stale / offline freshness chip layered on the first panel header. The view never
/// performs HTTP; all branch selection, unit conversion, formatting and severity thresholding happen in the
/// WinUI-free <see cref="MotorEfficiencyInsightsProjection"/>. Entrances fade through <see cref="TsFadeIn"/>
/// (honouring reduce-motion), every string resolves through the i18n facade, and the surface plus each panel
/// carry a Narrator name. A failed snapshot's retry affordance raises <see cref="RetryRequested"/> for the host
/// to act on (the parent owns the query).
/// </summary>
public sealed partial class MotorEfficiencyInsights : ContentControl
{
    private const string TorqueGlyph = "\uE945";      // Segoe Fluent — LightningBolt (web lucide Zap)
    private const string ThrottleGlyph = "\uE9D9";    // Segoe Fluent — Speed (web lucide Gauge)
    private const string ThermalGlyph = "\uE9CA";     // Segoe Fluent — Thermometer (web lucide Thermometer)
    private const string EmptyGlyph = "\uE9D2";       // Segoe Fluent — activity / pulse (web lucide Activity)

    private const double PanelPadding = 20;            // web GlassPanel p-5
    private const double PanelSpacing = 12;            // web mb-3 between header and body
    private const double TorqueRowSpacing = 8;         // web space-y-2
    private const double WideRowSpacing = 12;          // web space-y-3 (throttle / thermal)
    private const double GridGutter = 16;              // web gap-4
    private const double PanelMinWidth = 240;          // collapse 3→2→1 columns when narrow (web grid-cols-1 md:grid-cols-3)
    private const int PanelColumns = 3;                // web md:grid-cols-3
    private const int SkeletonRowCount = 3;
    private const int FadeDelayMs = 350;               // web FadeIn delay 0.35

    private readonly ILocalizer _localizer;
    private readonly MotorEfficiencyInsightsDiagnostics _diagnostics;

    private MotorEfficiencyInsightsModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="MotorEfficiencyInsightsModel.Loading"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MotorEfficiencyInsights(
        ILocalizer localizer,
        MotorEfficiencyInsightsModel? model = null,
        MotorEfficiencyInsightsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? MotorEfficiencyInsightsModel.Loading();
        _diagnostics = diagnostics ?? new MotorEfficiencyInsightsDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MotorEfficiencyInsights</c>).</summary>
    public static string Slug => MotorEfficiencyInsightsRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public MotorEfficiencyInsightsModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference (web <c>useUnits</c>); reassigning re-projects in the new units.</summary>
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
        MotorEfficiencyInsightsDisplay display = MotorEfficiencyInsightsProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        ContentControl content = display.State switch
        {
            MotorEfficiencyInsightsState.Loading => BuildLoading(display),
            MotorEfficiencyInsightsState.Error => BuildError(display),
            _ => BuildContent(display),
        };
        Content = content;
    }

    // ── Ready / Empty / Stale / Offline (web fall-through: the three motor panels) ─────────────────────────
    private static TsFadeIn BuildContent(MotorEfficiencyInsightsDisplay display)
    {
        var grid = NewGrid();
        grid.Children.Add(BuildTorquePanel(display));
        grid.Children.Add(BuildThrottlePanel(display.Throttle));
        grid.Children.Add(BuildThermalPanel(display.Thermal));
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = grid };
    }

    private static TsGrid NewGrid() =>
        new() { Columns = PanelColumns, Gutter = GridGutter, ItemMinWidth = PanelMinWidth };

    // web: Torque Distribution — Zap icon + title, then Avg / Max torque and High-Torque-Time rows (or noData).
    private static TsGlassPanel BuildTorquePanel(MotorEfficiencyInsightsDisplay display)
    {
        MotorTorquePanelDisplay panel = display.Torque;
        FrameworkElement? chip = display.ShowFreshnessChip ? BuildFreshnessChip(display) : null;

        var content = new StackPanel { Spacing = PanelSpacing };
        content.Children.Add(PanelHeader(TorqueGlyph, panel.Title, chip));

        if (panel.HasData)
        {
            var rows = new StackPanel { Spacing = TorqueRowSpacing };
            rows.Children.Add(MetricRow(panel.AvgLabel, panel.AvgValueText));
            rows.Children.Add(MetricRow(panel.MaxLabel, panel.MaxValueText));
            rows.Children.Add(MetricRow(panel.HighLabel, panel.HighValueText));
            content.Children.Add(rows);
        }
        else
        {
            content.Children.Add(EmptyPanelState(panel.EmptyMessage));
        }

        return Box(content, panel.AutomationName);
    }

    // web: Throttle Behavior — Gauge icon + title, then Avg Power, a Style badge and the power MetricBar (or noData).
    private static TsGlassPanel BuildThrottlePanel(MotorThrottlePanelDisplay panel)
    {
        var content = new StackPanel { Spacing = PanelSpacing };
        content.Children.Add(PanelHeader(ThrottleGlyph, panel.Title, trailing: null));

        if (panel.HasData)
        {
            var body = new StackPanel { Spacing = WideRowSpacing };
            body.Children.Add(MetricRow(panel.AvgPowerLabel, panel.AvgPowerValueText));
            body.Children.Add(StyleRow(panel.StyleLabel, panel.StyleBadgeText, panel.StyleStatus));
            body.Children.Add(new TsMetricBar
            {
                Value = panel.BarValue,
                Max = panel.BarMax,
                AccentBrushKey = panel.BarAccentBrushKey,
                // web MetricBar label="" sublabel="" — empty label and no value readout beside the bar.
                Label = string.Empty,
            });
            content.Children.Add(body);
        }
        else
        {
            content.Children.Add(EmptyPanelState(panel.EmptyMessage));
        }

        return Box(content, panel.AutomationName);
    }

    // web: Motor Thermal — Thermometer icon + title, then Avg / Max motor temp and the thermal badge (or noData).
    private static TsGlassPanel BuildThermalPanel(MotorThermalPanelDisplay panel)
    {
        var content = new StackPanel { Spacing = PanelSpacing };
        content.Children.Add(PanelHeader(ThermalGlyph, panel.Title, trailing: null));

        if (panel.HasData)
        {
            var body = new StackPanel { Spacing = WideRowSpacing };
            body.Children.Add(MetricRow(panel.AvgTempLabel, panel.AvgTempValueText));
            body.Children.Add(MetricRow(panel.MaxTempLabel, panel.MaxTempValueText));
            var badge = StatusBadge(panel.ThermalBadgeText, panel.ThermalStatus);
            badge.HorizontalAlignment = HorizontalAlignment.Left;
            body.Children.Add(badge);
            content.Children.Add(body);
        }
        else
        {
            content.Children.Add(EmptyPanelState(panel.EmptyMessage));
        }

        return Box(content, panel.AutomationName);
    }

    private static Grid PanelHeader(string glyph, string title, FrameworkElement? trailing)
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(glyph, 16, DisplayTokens.TextMuted));
        titleRow.Children.Add(new PanelTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        header.Children.Add(titleRow);

        if (trailing is not null)
        {
            Grid.SetColumn(trailing, 1);
            header.Children.Add(trailing);
        }

        return header;
    }

    // web row: <div className="flex justify-between"><span>{label}</span><span className="font-mono">{value}</span></div>
    private static Grid MetricRow(string label, string value)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelText = SecondaryLabel(label);
        Grid.SetColumn(labelText, 0);
        grid.Children.Add(labelText);

        var valueText = MonoValue(value);
        Grid.SetColumn(valueText, 1);
        grid.Children.Add(valueText);

        AutomationProperties.SetName(grid, $"{label}: {value}");
        return grid;
    }

    // web style row: label on the left, the driving-style Badge on the right.
    private static Grid StyleRow(string label, string badgeText, StatusKind status)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var labelText = SecondaryLabel(label);
        Grid.SetColumn(labelText, 0);
        grid.Children.Add(labelText);

        var badge = StatusBadge(badgeText, status);
        badge.HorizontalAlignment = HorizontalAlignment.Right;
        Grid.SetColumn(badge, 1);
        grid.Children.Add(badge);

        AutomationProperties.SetName(grid, $"{label}: {badgeText}");
        return grid;
    }

    private static TsBadge StatusBadge(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private static TsEmptyState EmptyPanelState(string message) =>
        new() { IconGlyph = EmptyGlyph, Message = message };

    // ── Loading (parent still fetching the motor history) ──────────────────────────────────────────────────
    private static TsGrid BuildLoading(MotorEfficiencyInsightsDisplay display)
    {
        var grid = NewGrid();
        grid.Children.Add(BuildSkeletonPanel(display.Torque.Title));
        grid.Children.Add(BuildSkeletonPanel(display.Throttle.Title));
        grid.Children.Add(BuildSkeletonPanel(display.Thermal.Title));

        LiveRegion.Configure(grid);
        LiveRegion.Announce(grid);
        AutomationProperties.SetName(grid, display.AutomationName);
        return grid;
    }

    private static TsGlassPanel BuildSkeletonPanel(string title)
    {
        var content = new StackPanel { Spacing = PanelSpacing };
        content.Children.Add(new TsSkeleton
        {
            BlockWidth = 140,
            BlockHeight = 18,
            ReduceMotion = MotionPreference.ReduceMotion,
        });

        var rows = new StackPanel { Spacing = TorqueRowSpacing };
        for (int i = 0; i < SkeletonRowCount; i++)
        {
            rows.Children.Add(new TsSkeleton
            {
                BlockHeight = 14,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        content.Children.Add(rows);

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, title);
        return panel;
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────────
    private TsFadeIn BuildError(MotorEfficiencyInsightsDisplay display)
    {
        var error = new TsQueryError
        {
            Title = display.ErrorTitle,
            Message = display.ErrorMessage,
            ActionText = display.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetryInvoked;

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = error };
        AutomationProperties.SetName(panel, display.ErrorTitle);
        return new TsFadeIn { DelayMs = FadeDelayMs, Content = panel };
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static TsBadge BuildFreshnessChip(MotorEfficiencyInsightsDisplay display)
    {
        var badge = new TsBadge
        {
            Status = display.FreshnessChipStatus,
            Content = new TextBlock { Text = display.FreshnessChipText, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.FreshnessChipText);
        return badge;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }

    private static FontIcon DecorativeIcon(string glyph, double size, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative: the panel automation name already conveys the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static TextBlock SecondaryLabel(string text) => new()
    {
        Text = text,
        FontSize = 14,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    // web value: font-mono — a monospace, primary-coloured, right-aligned readout.
    private static TextBlock MonoValue(string text)
    {
        var block = new TextBlock
        {
            Text = text,
            FontSize = 14,
            Foreground = DisplayTokens.TextPrimary,
            HorizontalAlignment = HorizontalAlignment.Right,
            TextAlignment = TextAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (Application.Current?.Resources is { } resources
            && resources.TryGetValue("TsTypeFontFamilyMono", out object? value)
            && value is FontFamily mono)
        {
            block.FontFamily = mono;
        }

        return block;
    }
}
