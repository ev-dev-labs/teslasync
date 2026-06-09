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
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The native WinUI 3 <c>RecentActivity</c> feature surface — a parity port of
/// web/src/features/dashboard/components/RecentActivity.tsx. It is a presentational section: assign a
/// <see cref="Model"/> (the web <c>recentDrives</c> / <c>recentCharges</c> / <c>analytics</c> props plus the
/// distance unit and the parent's fetch flag) and it renders either the parent's skeleton hand-off
/// (<see cref="RecentActivityState.Loading"/>) or the web's three-panel composition
/// (<see cref="RecentActivityState.Ready"/>): the unified activity feed (the native <see cref="TsTimeline"/>
/// — the counterpart of the web <c>Timeline</c> — capped at eight rows in a scroll viewer, with a friendly
/// "No activity yet …" empty note when there is nothing to show), the battery-trend area chart (the native
/// <see cref="TsAreaChart"/> — the counterpart of the web <c>AreaChartWrapper</c> — with its own
/// "Charge data will appear here" empty note when there is at most one drive), and the fleet-performance
/// stats (total drives, charge sessions, total cost, CO₂ saved) with the optional most-efficient-vehicle
/// chip. The view never performs HTTP; all branch selection, unit conversion, currency / number formatting
/// and label resolution happen in the WinUI-free <see cref="RecentActivityProjection"/>. The Ready
/// composition fades in through <see cref="TsFadeIn"/> (honouring reduce-motion); every string resolves
/// through the i18n facade; and the surface, each panel, the "View all" affordance and the chart carry a
/// Narrator name.
/// </summary>
public sealed partial class RecentActivity : ContentControl
{
    private const int FadeDelayMs = 100;            // web FadeIn-equivalent reveal
    private const double PanelPadding = 20;         // web p-5
    private const double SectionGap = 24;           // web gap-6
    private const double PanelSpacing = 16;         // web space-y-4 inside panels
    private const double HeaderSpacing = 8;         // web gap-2
    private const double TitleFontSize = 14;        // web section-title
    private const double HeaderIconSize = 16;       // web h-4 w-4
    private const double ViewAllFontSize = 11;      // web text-[10px]
    private const double LabelFontSize = 12;        // web text-xs
    private const double ValueFontSize = 14;        // web text-sm
    private const double CaptionFontSize = 10;      // web text-[10px]
    private const double ChartHeight = 180;         // web AreaChartWrapper height={180}
    private const double ActivityMaxHeight = 320;   // web max-h-[320px]

    private readonly ILocalizer _localizer;
    private readonly RecentActivityDiagnostics _diagnostics;

    private RecentActivityModel _model;
    private string? _currencySymbol;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, optional diagnostics and currency.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="RecentActivityModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="currencySymbol">The active currency symbol for the cost figures (defaults to <c>$</c>).</param>
    public RecentActivity(
        ILocalizer localizer,
        RecentActivityModel? model = null,
        RecentActivityDiagnostics? diagnostics = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? RecentActivityModel.Pending;
        _diagnostics = diagnostics ?? new RecentActivityDiagnostics();
        _currencySymbol = currencySymbol;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the user invokes the "View all" affordance (web <c>&lt;Link to="/drives"&gt;</c>).</summary>
    public event EventHandler? ViewAllRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>RecentActivity</c>).</summary>
    public static string Slug => RecentActivityRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public RecentActivityModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The currency symbol used for the cost figures; reassigning re-projects the current model.</summary>
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
        var display = RecentActivityProjection.Project(_model, _localizer, _currencySymbol);
        AutomationProperties.SetName(this, display.AutomationName);

        Content = display.State == RecentActivityState.Loading
            ? BuildLoading(display)
            : new TsFadeIn { DelayMs = FadeDelayMs, Content = BuildReady(display) };
    }

    // ── Ready (web fall-through: activity feed + battery trend + fleet performance) ──────────────────────
    private Grid BuildReady(RecentActivityDisplay display)
    {
        // web: grid grid-cols-1 gap-6 lg:grid-cols-3 — activity (1/3) + a 2/3 container of two panels.
        var grid = new Grid { ColumnSpacing = SectionGap, RowSpacing = SectionGap };
        grid.ColumnDefinitions.Add(StarColumn());
        grid.ColumnDefinitions.Add(StarColumn());
        grid.ColumnDefinitions.Add(StarColumn());

        var activity = BuildActivityPanel(display);
        Grid.SetColumn(activity, 0);
        grid.Children.Add(activity);

        // web: lg:col-span-2 grid grid-cols-1 gap-6 sm:grid-cols-2 — battery trend + fleet performance.
        var right = new Grid { ColumnSpacing = SectionGap, RowSpacing = SectionGap };
        right.ColumnDefinitions.Add(StarColumn());
        right.ColumnDefinitions.Add(StarColumn());

        var battery = BuildBatteryPanel(display);
        Grid.SetColumn(battery, 0);
        right.Children.Add(battery);

        var performance = BuildPerformancePanel(display);
        Grid.SetColumn(performance, 1);
        right.Children.Add(performance);

        Grid.SetColumn(right, 1);
        Grid.SetColumnSpan(right, 2);
        grid.Children.Add(right);

        return grid;
    }

    // web: the Activity Feed GlassPanel — header (icon + title + "View all") over the Timeline / empty note.
    private TsGlassPanel BuildActivityPanel(RecentActivityDisplay display)
    {
        var column = new StackPanel { Spacing = PanelSpacing };

        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = HeaderRow(display.ActivityGlyph, display.ActivityTitle, ChartBrushes.ForStatus(StatusKind.Info));
        Grid.SetColumn(heading, 0);
        header.Children.Add(heading);

        var viewAll = BuildViewAll(display.ViewAllLabel);
        Grid.SetColumn(viewAll, 1);
        header.Children.Add(viewAll);

        column.Children.Add(header);

        if (display.HasActivity)
        {
            var timeline = new TsTimeline
            {
                Items = BuildEntries(display.Items),
                EmptyMessage = display.ActivityEmptyMessage,
            };

            column.Children.Add(new ScrollViewer
            {
                Content = timeline,
                MaxHeight = ActivityMaxHeight, // web max-h-[320px] overflow-y-auto
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            });
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                IconGlyph = RecentActivityProjection.ClockGlyph,
                Message = display.ActivityEmptyMessage,
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        return Panel(column, display.ActivityTitle);
    }

    // web: the Battery Trend GlassPanel — header over the AreaChartWrapper / empty note.
    private static TsGlassPanel BuildBatteryPanel(RecentActivityDisplay display)
    {
        var column = new StackPanel { Spacing = PanelSpacing };
        column.Children.Add(HeaderRow(display.BatteryGlyph, display.BatteryTitle, ChartBrushes.ForStatus(StatusKind.Success)));

        if (display.HasBatteryTrend)
        {
            column.Children.Add(BuildBatteryChart(display));
        }
        else
        {
            column.Children.Add(new TextBlock
            {
                Text = display.BatteryEmptyMessage,
                FontSize = LabelFontSize,
                Foreground = DisplayTokens.TextMuted,
                Height = ChartHeight,
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return Panel(column, display.BatteryTitle);
    }

    private static TsAreaChart BuildBatteryChart(RecentActivityDisplay display)
    {
        var points = new List<ChartPoint>(display.BatteryTrend.Count);
        foreach (var point in display.BatteryTrend)
        {
            points.Add(new ChartPoint(point.Index, point.Soc));
        }

        // web: series color #10b981 + yFormatter `${v}%` → battery-role brush, "%" unit, no decimals.
        var series = new ChartSeries(display.BatterySeriesLabel, points)
        {
            Kind = ChartSeriesKind.Area,
            Role = ChartRole.Battery,
            Unit = "%",
            Decimals = 0,
        };

        var chart = new TsAreaChart
        {
            Series = new[] { series },
            Title = display.BatteryTitle,
            Height = ChartHeight,
            ShowLegend = false, // web AreaChartWrapper renders no legend
            IncludeZero = false,
        };

        AutomationProperties.SetName(chart, display.BatteryChartSummary);
        return chart;
    }

    // web: the Fleet Performance GlassPanel — header over the four stat rows + the optional most-efficient block.
    private static TsGlassPanel BuildPerformancePanel(RecentActivityDisplay display)
    {
        var column = new StackPanel { Spacing = PanelSpacing };
        column.Children.Add(HeaderRow(display.PerfGlyph, display.PerfTitle, DisplayTokens.Accent));

        for (int i = 0; i < display.Stats.Count; i++)
        {
            column.Children.Add(BuildStatRow(display.Stats[i], ValueBrush(i)));
        }

        if (display.MostEfficient is { } vehicle)
        {
            column.Children.Add(BuildMostEfficient(display, vehicle));
        }

        return Panel(column, display.PerfTitle);
    }

    private static Grid BuildStatRow(RecentActivityStat stat, Brush valueBrush)
    {
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var label = new TextBlock
        {
            Text = stat.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextSecondary, // web text-xs text-[var(--text-secondary)]
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        Grid.SetColumn(label, 0);
        row.Children.Add(label);

        var value = new TextBlock
        {
            Text = stat.Value,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.Bold, // web text-sm font-bold
            Foreground = valueBrush,
            VerticalAlignment = VerticalAlignment.Center,
            TextAlignment = TextAlignment.Right,
        };
        Grid.SetColumn(value, 1);
        row.Children.Add(value);

        AutomationProperties.SetName(row, stat.AutomationName);
        AutomationProperties.SetAccessibilityView(row, AccessibilityView.Content);
        return row;
    }

    // web: <div className="mt-3 p-3 rounded-xl bg-neon-green/5 border border-neon-green/10"> label + name + value.
    private static TsGlassPanel BuildMostEfficient(RecentActivityDisplay display, RecentActivityMostEfficient vehicle)
    {
        var column = new StackPanel { Spacing = 2 };

        column.Children.Add(new TextBlock
        {
            Text = display.MostEfficientLabel,
            FontSize = CaptionFontSize,
            Foreground = DisplayTokens.TextMuted, // web text-[10px] text-[var(--text-muted)] uppercase
            CharacterSpacing = 60,
        });

        column.Children.Add(new TextBlock
        {
            Text = vehicle.Name,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = ChartBrushes.ForStatus(StatusKind.Success), // web text-sm font-semibold text-emerald-300
            TextWrapping = TextWrapping.Wrap,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.MostEfficientValue,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted, // web text-xs text-[var(--text-muted)]
            TextWrapping = TextWrapping.Wrap,
        });

        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = column }; // web p-3
        AutomationProperties.SetName(panel, $"{display.MostEfficientLabel}: {vehicle.Name}, {display.MostEfficientValue}");
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }

    // ── Loading (parent Dashboard still fetching) ────────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(RecentActivityDisplay display)
    {
        var grid = new Grid { ColumnSpacing = SectionGap, RowSpacing = SectionGap };
        grid.ColumnDefinitions.Add(StarColumn());
        grid.ColumnDefinitions.Add(StarColumn());
        grid.ColumnDefinitions.Add(StarColumn());

        var activity = LoadingPanel(rows: 5, chart: false);
        Grid.SetColumn(activity, 0);
        grid.Children.Add(activity);

        var right = new Grid { ColumnSpacing = SectionGap };
        right.ColumnDefinitions.Add(StarColumn());
        right.ColumnDefinitions.Add(StarColumn());

        var battery = LoadingPanel(rows: 0, chart: true);
        Grid.SetColumn(battery, 0);
        right.Children.Add(battery);

        var performance = LoadingPanel(rows: 4, chart: false);
        Grid.SetColumn(performance, 1);
        right.Children.Add(performance);

        Grid.SetColumn(right, 1);
        Grid.SetColumnSpan(right, 2);
        grid.Children.Add(right);

        var shell = Panel(grid, display.LoadingLabel);
        LiveRegion.Configure(shell);
        LiveRegion.Announce(shell);
        return shell;
    }

    private static TsGlassPanel LoadingPanel(int rows, bool chart)
    {
        var column = new StackPanel { Spacing = PanelSpacing };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = HeaderSpacing };
        header.Children.Add(new TsSkeleton { BlockWidth = HeaderIconSize, BlockHeight = HeaderIconSize, Radius = 6 });
        header.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = TitleFontSize });
        column.Children.Add(header);

        if (chart)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = ChartHeight, Radius = 10 });
        }

        for (int i = 0; i < rows; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 28, Radius = 6 });
        }

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // ── Shared helpers ───────────────────────────────────────────────────────────────────────────────────
    private static List<TsActivityEntry> BuildEntries(IReadOnlyList<RecentActivityItem> items)
    {
        var entries = new List<TsActivityEntry>(items.Count);
        foreach (var item in items)
        {
            // web Timeline item: icon (Route/Zap) + title + subtitle + relative time, accent-coloured by type.
            // The native TsTimeline encodes the per-row icon as its severity-accent marker (drive → info,
            // charge → success); the relative time is derived from the timestamp exactly as web formatTimeAgo.
            entries.Add(new TsActivityEntry(item.Title, item.Subtitle, item.Timestamp, item.Severity));
        }

        return entries;
    }

    private static StackPanel HeaderRow(string glyph, string title, Brush iconBrush)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = HeaderIconSize,
            Foreground = iconBrush,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative

        var text = new TextBlock
        {
            Text = title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        header.Children.Add(icon);
        header.Children.Add(text);
        AutomationProperties.SetAccessibilityView(header, AccessibilityView.Raw); // carried by the panel name
        return header;
    }

    private HyperlinkButton BuildViewAll(string label)
    {
        var button = new HyperlinkButton
        {
            Content = new TextBlock { Text = label, FontSize = ViewAllFontSize, Foreground = DisplayTokens.TextMuted },
            Padding = new Thickness(0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, label);
        button.Click += (_, _) => ViewAllRequested?.Invoke(this, EventArgs.Empty);
        return button;
    }

    private static Brush ValueBrush(int statIndex) => statIndex switch
    {
        2 => ChartBrushes.ForStatus(StatusKind.Warning), // Total Cost — web text-amber-300
        3 => ChartBrushes.ForStatus(StatusKind.Success), // CO₂ Saved — web text-emerald-300
        _ => DisplayTokens.TextPrimary,                  // Drives / Sessions — web text-[var(--text-primary)]
    };

    private static ColumnDefinition StarColumn() => new() { Width = new GridLength(1, GridUnitType.Star) };

    private static TsGlassPanel Panel(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding), // web p-5
            Content = content,
        };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }
}
