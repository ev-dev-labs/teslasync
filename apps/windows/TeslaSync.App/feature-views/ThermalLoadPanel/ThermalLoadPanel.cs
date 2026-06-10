using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ThermalLoadPanel</c> feature surface — a parity port of
/// web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx. It is a presentational summary
/// of the drivetrain's thermal load: assign a <see cref="Model"/> (the web <c>sensors</c> / <c>peakPower</c> /
/// <c>avgPowerMax</c> / <c>stats</c> props plus the parent-supplied lifecycle status) and a
/// <see cref="Units"/> preference (web <c>useUnits</c>), and it renders one of the contract's states — the
/// skeleton chrome while the parent query is in flight (<see cref="ThermalLoadPanelState.Loading"/>), a
/// friendly empty state when there is nothing to plot (<see cref="ThermalLoadPanelState.Empty"/>), a retriable
/// <see cref="TsQueryError"/> (<see cref="ThermalLoadPanelState.Error"/>), or the populated panel
/// (<see cref="ThermalLoadPanelState.Ready"/> / <see cref="ThermalLoadPanelState.Stale"/> /
/// <see cref="ThermalLoadPanelState.Offline"/>) — the web composition: the muted "Thermal Load Indicators"
/// header with the <c>Activity</c> icon, a column of severity-tinted <see cref="TsMetricBar"/> rows (one per
/// sensor, each with its user-unit temperature read-out), then a four-up grid of <see cref="TsInlineMetric"/>
/// tiles (Peak Power, Avg Power, Drives, Regen Ratio), with a stale / offline freshness chip layered on the
/// cached snapshot. The view never performs HTTP; all branch selection, severity resolution, copy resolution
/// and formatting happen in the WinUI-free <see cref="ThermalLoadPanelProjection"/>. Entrances fade through
/// <see cref="TsFadeIn"/> (honouring reduce-motion), every string resolves through the i18n facade, the
/// decorative icons are hidden from Narrator, and the surface plus each bar / tile / chip carries a Narrator
/// name. A failed snapshot's retry affordance raises <see cref="RetryRequested"/> for the host to act on (the
/// parent owns the query).
/// </summary>
public sealed partial class ThermalLoadPanel : ContentControl
{
    private const double PanelPadding = 24;     // web p-6
    private const double SectionSpacing = 16;   // web gap between header / bars / metrics
    private const double BarSpacing = 16;       // web space-y-4 between sensor bars
    private const double ClusterSpacing = 8;    // web icon ↔ text gap
    private const double MetricsTopMargin = 8;  // web mt-6 (beyond the section spacing)
    private const double IconSize = 16;         // web h-4 w-4
    private const double SkeletonIconSize = 16;
    private const int FadeDelayMs = 200;        // web FadeIn delay={0.2}

    private readonly ILocalizer _localizer;
    private readonly ThermalLoadPanelDiagnostics _diagnostics;
    private readonly TsFadeIn _fade = new() { DelayMs = FadeDelayMs };

    private ThermalLoadPanelModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, the user's units and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ThermalLoadPanelModel.Loading"/>.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ThermalLoadPanel(
        ILocalizer localizer,
        ThermalLoadPanelModel? model = null,
        UnitPref? units = null,
        ThermalLoadPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ThermalLoadPanelModel.Loading;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new ThermalLoadPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = _fade;
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the error surface's retry affordance is invoked (the host re-runs the query).</summary>
    public event EventHandler? RetryRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ThermalLoadPanel</c>).</summary>
    public static string Slug => ThermalLoadPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ThermalLoadPanelModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the temperature read-outs.</summary>
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
        var display = ThermalLoadPanelProjection.Project(_model, _units, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        _fade.Content = display.State switch
        {
            ThermalLoadPanelState.Loading => BuildLoading(display),
            ThermalLoadPanelState.Error => BuildError(display),
            _ => BuildContent(display),
        };
    }

    // ── Ready / Stale / Offline / Empty (web: header + sensor bars + inline metric grid) ───────────────
    private static TsGlassPanel BuildContent(ThermalLoadPanelDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader(display));

        if (display.HasData)
        {
            column.Children.Add(BuildSensorBars(display));
            column.Children.Add(BuildMetricsGrid(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = ThermalLoadPanelRegistration.ActivityGlyph,
                Message = display.EmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.AutomationName);
        return panel;
    }

    private static Grid BuildHeader(ThermalLoadPanelDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ClusterSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(DecorativeIcon(ThermalLoadPanelRegistration.ActivityGlyph, IconSize, DisplayTokens.TextMuted));
        titleRow.Children.Add(new Caption { Value = display.Title, VerticalAlignment = VerticalAlignment.Center });
        Grid.SetColumn(titleRow, 0);
        grid.Children.Add(titleRow);

        if (display.ShowFreshnessChip)
        {
            var chip = BuildChip(display.FreshnessChipText, display.FreshnessChipStatus);
            Grid.SetColumn(chip, 1);
            grid.Children.Add(chip);
        }

        return grid;
    }

    private static StackPanel BuildSensorBars(ThermalLoadPanelDisplay display)
    {
        var column = new StackPanel { Spacing = BarSpacing };
        foreach (var row in display.Sensors)
        {
            var bar = new TsMetricBar
            {
                Label = row.Label,
                Value = row.Value,
                Max = row.Max,
                ValueText = row.ValueText,
                AccentBrushKey = row.SeverityBrushKey,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };

            // Override the bar's default "%"-based name with the temperature read-out the web shows.
            AutomationProperties.SetName(bar, row.AutomationName);
            column.Children.Add(bar);
        }

        return column;
    }

    private static Grid BuildMetricsGrid(ThermalLoadPanelDisplay display)
    {
        var grid = new Grid
        {
            ColumnSpacing = SectionSpacing,
            RowSpacing = SectionSpacing,
            Margin = new Thickness(0, MetricsTopMargin, 0, 0),
        };

        int count = display.Metrics.Count;
        for (int c = 0; c < count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < count; i++)
        {
            var cell = BuildMetricCell(display.Metrics[i]);
            Grid.SetColumn(cell, i);
            grid.Children.Add(cell);
        }

        return grid;
    }

    private static StackPanel BuildMetricCell(ThermalInlineMetric metric)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ClusterSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(DecorativeIcon(metric.Glyph, IconSize, DisplayTokens.Brush(metric.IconBrushKey)));

        var inline = new TsInlineMetric
        {
            Label = metric.Label,
            Value = metric.Value,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(inline, metric.AutomationName);
        row.Children.Add(inline);

        AutomationProperties.SetName(row, metric.AutomationName);
        return row;
    }

    // ── Loading (parent still fetching the snapshot — skeleton chrome) ─────────────────────────────────
    private static TsGlassPanel BuildLoading(ThermalLoadPanelDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = ClusterSpacing };
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = SkeletonIconSize,
            BlockHeight = SkeletonIconSize,
            Radius = 6,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        header.Children.Add(new TsSkeleton
        {
            BlockWidth = 200,
            BlockHeight = 14,
            ReduceMotion = MotionPreference.ReduceMotion,
        });
        column.Children.Add(header);

        var bars = new StackPanel { Spacing = BarSpacing };
        for (int i = 0; i < SkeletonBarCount; i++)
        {
            bars.Children.Add(new TsSkeleton
            {
                BlockHeight = 28,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            });
        }

        column.Children.Add(bars);
        column.Children.Add(BuildMetricsSkeleton());

        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
        AutomationProperties.SetName(panel, display.LoadingLabel);
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        return panel;
    }

    private static Grid BuildMetricsSkeleton()
    {
        var grid = new Grid
        {
            ColumnSpacing = SectionSpacing,
            Margin = new Thickness(0, MetricsTopMargin, 0, 0),
        };
        for (int c = 0; c < SkeletonMetricCount; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < SkeletonMetricCount; i++)
        {
            var skeleton = new TsSkeleton
            {
                BlockHeight = 32,
                ReduceMotion = MotionPreference.ReduceMotion,
                HorizontalAlignment = HorizontalAlignment.Stretch,
            };
            Grid.SetColumn(skeleton, i);
            grid.Children.Add(skeleton);
        }

        return grid;
    }

    // ── Error (web QueryError equivalent with a retry affordance) ──────────────────────────────────────
    private TsGlassPanel BuildError(ThermalLoadPanelDisplay display)
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
        return panel;
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => RetryRequested?.Invoke(this, EventArgs.Empty);

    private static TsBadge BuildChip(string text, StatusKind status)
    {
        var chip = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    private static FontIcon DecorativeIcon(string glyph, double size, Brush brush)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = size,
            Foreground = brush,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — the surface name and the adjacent label/value already convey the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private const int SkeletonBarCount = 4;     // web plots four drivetrain sensors
    private const int SkeletonMetricCount = 4;  // web shows four inline metrics
}
