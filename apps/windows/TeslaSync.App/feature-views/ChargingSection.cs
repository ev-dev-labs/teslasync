using System.Collections.Generic;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Charts;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>ChargingSection</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/ChargingSection.tsx. It is a presentational section:
/// assign a <see cref="Model"/> (the web <c>metrics</c> + <c>dailyEnergyData</c> props the Weekly-Digest page
/// feeds in) and it renders exactly one of three web-derived branches — <see cref="ChargingSectionState.Loading"/>
/// (skeleton chrome while the parent's drives/charging/alerts queries load),
/// <see cref="ChargingSectionState.Empty"/> (a friendly empty state when the week has no charging activity), or
/// <see cref="ChargingSectionState.Ready"/> (the web composition: the "Charging" header, the Daily-Energy-Added
/// bar chart — the native analogue of the recharts <c>BarChart</c> via <see cref="TsBarChart"/> — the four
/// MiniStats, and the week-over-week energy chip). The view never performs HTTP; all branch selection, label
/// resolution and number formatting happen in the WinUI-free <see cref="ChargingSectionProjection"/>. The Ready
/// composition fades in through <see cref="TsFadeIn"/> (honouring reduce-motion, the web <c>FadeIn delay=0.15</c>),
/// every string resolves through the i18n facade, and the surface, chart, each MiniStat and the chip carry a
/// Narrator name.
/// </summary>
public sealed partial class ChargingSection : ContentControl
{
    private const int FadeDelayMs = 150;               // web FadeIn delay={0.15}
    private const double OuterPadding = 24;            // web p-6
    private const double SectionSpacing = 24;          // web space-y-6
    private const double PanelPadding = 16;            // web p-4
    private const double ChartHeight = 260;            // web ResponsiveContainer height={260}
    private const double SkeletonChartHeight = 220;
    private const int EnergyColorIndex = 1;            // web CHART_COLORS[1]
    private const int EnergyDecimals = 1;              // web YAxis tickFormatter fmtNumber(v, 1)
    private const double TitleIconSize = 20;           // web h-5 w-5
    private const double StatIconSize = 16;            // web h-4 w-4
    private const double TitleFontSize = 18;           // web text-lg
    private const double LabelFontSize = 12;           // web text-xs
    private const double ValueFontSize = 14;           // web text-sm

    private readonly ILocalizer _localizer;
    private readonly ChargingSectionDiagnostics _diagnostics;

    private ChargingSectionModel _model;
    private string? _currencySymbol;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, optional diagnostics and currency.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ChargingSectionModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The active currency symbol for the Total Cost stat (defaults to <c>$</c>).</param>
    public ChargingSection(
        ILocalizer localizer,
        ChargingSectionModel? model = null,
        ChargingSectionDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ChargingSectionModel.Pending;
        _diagnostics = diagnostics ?? new ChargingSectionDiagnostics();
        _currencySymbol = currencySymbol;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChargingSection</c>).</summary>
    public static string Slug => ChargingSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ChargingSectionModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The currency symbol used for the Total Cost stat; reassigning re-projects the current model.</summary>
    public string? CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            _currencySymbol = value;
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
        var display = ChargingSectionProjection.Project(_model, _localizer, _currencySymbol);
        AutomationProperties.SetName(this, display.AutomationName);

        UIElement surface = display.State switch
        {
            ChargingSectionState.Loading => BuildLoading(display),
            ChargingSectionState.Empty => BuildEmpty(display),
            _ => new TsFadeIn { DelayMs = FadeDelayMs, Content = BuildReady(display) },
        };

        Content = surface;
    }

    // ── Ready (web fall-through: header + bar chart + mini-stats + week-over-week chip) ──────────────────

    private static TsGlassPanel BuildReady(ChargingSectionDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader(display));
        column.Children.Add(BuildChartPanel(display));
        column.Children.Add(BuildStatsGrid(display));
        column.Children.Add(BuildWeekOverWeek(display));
        return Shell(column);
    }

    private static StackPanel BuildHeader(ChargingSectionDisplay display)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = display.TitleGlyph,
            FontSize = TitleIconSize,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"), // web text-neon-green Zap
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = display.Title,
            FontSize = TypographyTokens.Size("TsTypeSectionFontSize", TitleFontSize),
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        header.Children.Add(icon);
        header.Children.Add(title);
        return header;
    }

    private static TsGlassPanel BuildChartPanel(ChargingSectionDisplay display)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TextBlock
        {
            Text = display.ChartTitle,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", ValueFontSize),
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary, // web text-[var(--text-secondary)]
        });

        if (display.HasChart)
        {
            content.Children.Add(BuildChart(display));
        }
        else
        {
            content.Children.Add(ChartEmptyNote(display.EmptyMessage));
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
    }

    private static TsBarChart BuildChart(ChargingSectionDisplay display)
    {
        var points = new List<ChartPoint>(display.DailyEnergy.Count);
        for (int i = 0; i < display.DailyEnergy.Count; i++)
        {
            var bucket = display.DailyEnergy[i];
            points.Add(new ChartPoint(i, bucket.Energy, bucket.Day));
        }

        var series = new ChartSeries(display.EnergySeriesLabel, points)
        {
            Kind = ChartSeriesKind.Bar,
            ColorIndex = EnergyColorIndex,
            Decimals = EnergyDecimals,
        };

        var chart = new TsBarChart
        {
            Series = new[] { series },
            Title = display.ChartTitle,
            Height = ChartHeight,
            IncludeZero = true,
            ShowLegend = false, // web BarChart has no <Legend>
        };
        AutomationProperties.SetName(chart, display.ChartSummary);
        return chart;
    }

    private static Grid BuildStatsGrid(ChargingSectionDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < display.Stats.Count; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < display.Stats.Count; i++)
        {
            var card = BuildMiniStat(display.Stats[i]);
            Grid.SetColumn(card, i);
            grid.Children.Add(card);
        }

        return grid;
    }

    private static TsGlassPanel BuildMiniStat(ChargingSectionStat stat)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = stat.Glyph,
            FontSize = StatIconSize,
            Foreground = DisplayTokens.TextMuted, // web text-[var(--text-muted)]
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var column = new StackPanel { Spacing = 2 };
        column.Children.Add(new TextBlock
        {
            Text = stat.Label,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", LabelFontSize),
            Foreground = DisplayTokens.TextSecondary, // web text-xs text-[var(--text-secondary)]
            TextWrapping = TextWrapping.Wrap,
        });
        column.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", ValueFontSize),
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary, // web text-sm font-semibold text-white
            TextWrapping = TextWrapping.Wrap,
        });

        row.Children.Add(icon);
        row.Children.Add(column);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding, 12, PanelPadding, 12), // web px-4 py-3
            Content = row,
        };
        AutomationProperties.SetName(panel, stat.AutomationName);
        return panel;
    }

    private static TsGlassPanel BuildWeekOverWeek(ChargingSectionDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(new TextBlock
        {
            Text = display.WeekOverWeekLabel,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", LabelFontSize),
            Foreground = DisplayTokens.TextSecondary, // web text-xs text-[var(--text-secondary)]
            VerticalAlignment = VerticalAlignment.Center,
        });

        var badge = new TsBadge
        {
            Status = display.WeekOverWeekStatus,
            Content = new TextBlock
            {
                Text = display.WeekOverWeekText,
                FontSize = LabelFontSize,
            },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, display.WeekOverWeekAutomationName);
        row.Children.Add(badge);

        return new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding, 12, PanelPadding, 12), // web px-4 py-3
            Content = row,
        };
    }

    // ── Empty (web parity: no charging activity → friendly titled empty state, never a blank box) ────────

    private static TsGlassPanel BuildEmpty(ChargingSectionDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };
        column.Children.Add(BuildHeader(display));
        column.Children.Add(new TsEmptyState
        {
            IconGlyph = ChargingSectionProjection.ZapGlyph,
            Message = display.EmptyMessage,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        return Shell(column);
    }

    // ── Loading (parent still fetching the Weekly-Digest queries) ───────────────────────────────────────

    private static TsGlassPanel BuildLoading(ChargingSectionDisplay display)
    {
        var column = new StackPanel { Spacing = SectionSpacing };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(new TsSkeleton { BlockWidth = TitleIconSize, BlockHeight = TitleIconSize, Radius = 6 });
        header.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = TitleIconSize });
        column.Children.Add(header);

        var chart = new StackPanel { Spacing = 12 };
        chart.Children.Add(new TsSkeleton { BlockWidth = 180, BlockHeight = 14 });
        chart.Children.Add(new TsSkeleton { BlockHeight = SkeletonChartHeight });
        column.Children.Add(new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = chart });

        var stats = new Grid { ColumnSpacing = 12 };
        for (int c = 0; c < 4; c++)
        {
            stats.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var card = new TsGlassPanel
            {
                Padding = new Thickness(PanelPadding, 12, PanelPadding, 12),
                Content = new TsSkeleton { BlockHeight = 40 },
            };
            Grid.SetColumn(card, c);
            stats.Children.Add(card);
        }

        column.Children.Add(stats);

        var wow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        wow.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 14 });
        wow.Children.Add(new TsSkeleton { BlockWidth = 48, BlockHeight = 20, Radius = 10 });
        column.Children.Add(new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding, 12, PanelPadding, 12),
            Content = wow,
        });

        AutomationProperties.SetName(column, display.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return Shell(column);
    }

    // ── Shared ──────────────────────────────────────────────────────────────────────────────────────────

    private static TextBlock ChartEmptyNote(string message) => new()
    {
        Text = message,
        Foreground = DisplayTokens.TextMuted,
        Height = ChartHeight,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
        TextAlignment = TextAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TsGlassPanel Shell(UIElement content) => new()
    {
        Padding = new Thickness(OuterPadding),
        Content = content,
    };
}
