using Microsoft.UI.Dispatching;
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
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.WeeklyDigest;

/// <summary>
/// The native WinUI 3 <c>DrivingSection</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/DrivingSection.tsx. It is a pure presentational
/// section: assign a <see cref="Model"/> (the slice of the web <c>metrics</c> / <c>dailyDistanceData</c>
/// props the section reads) and it renders exactly one of the branches the web data flow produces —
/// <see cref="DrivingSectionState.Loading"/> (skeleton chrome while the parent <c>WeeklyDigestPage</c>
/// resolves the week) or <see cref="DrivingSectionState.Ready"/> (the "Driving" title, the daily-distance
/// bar chart — the native analogue of the recharts <c>BarChart</c>, with its accessible Day/Distance
/// fallback table — or its friendly empty surface, the four efficiency mini-stats, and the Top Drive
/// glass card or its friendly empty surface). The view never performs HTTP; all branch selection,
/// formatting and unit-symbol composition happen in the WinUI-free <see cref="DrivingSectionProjection"/>.
/// The section fades in through <see cref="TsFadeIn"/> (which honours the OS reduce-motion setting), every
/// surface is a tokenized <see cref="TsGlassPanel"/>, every string resolves through the i18n facade, the
/// decorative icons are hidden from Narrator, and the surface and each region carry a Narrator name.
/// </summary>
public sealed partial class DrivingSection : ContentControl
{
    private const double TitleIconFontSize = 18;
    private const double MiniStatIconFontSize = 14;
    private const double BarsAreaHeight = 220;
    private const int TableRowsPerPage = 7;

    // Responsive breakpoints for the mini-stat grid (web grid-cols-1 / sm:grid-cols-2 / lg:grid-cols-4).
    private const double StatsTwoColBreakpoint = 540;
    private const double StatsFourColBreakpoint = 960;

    // Responsive breakpoint for the top-drive field grid (web grid-cols-2 / sm:grid-cols-4).
    private const double TopDriveFourColBreakpoint = 540;

    private readonly ILocalizer _localizer;
    private readonly DrivingSectionDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly bool _reduceMotion;
    private readonly DispatcherQueue? _dispatcher;

    private DrivingSectionModel _model;
    private bool _opened;
    private bool _renderQueued;
    private int _statColumns = -1;
    private int _topDriveColumns = -1;

    /// <summary>Creates the surface over its i18n facade, an initial model, and optional collaborators.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="DrivingSectionModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="reduceMotion">Overrides the system reduce-motion preference (for tests/hosting); defaults to the OS setting.</param>
    /// <param name="clock">The clock used to format the top-drive date; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public DrivingSection(
        ILocalizer localizer,
        DrivingSectionModel? model = null,
        DrivingSectionDiagnostics? diagnostics = null,
        bool? reduceMotion = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DrivingSectionModel.Pending;
        _diagnostics = diagnostics ?? new DrivingSectionDiagnostics();
        _reduceMotion = reduceMotion ?? MotionPreference.ReduceMotion;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DrivingSection</c>).</summary>
    public static string Slug => DrivingSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public DrivingSectionModel Model
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

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (e.PreviousSize.Width == e.NewSize.Width || _model.Loading)
        {
            return;
        }

        // Re-flow the responsive grids only when a width bucket actually changes, coalesced to one render.
        if (StatColumnsFor(e.NewSize.Width) != _statColumns || TopDriveColumnsFor(e.NewSize.Width) != _topDriveColumns)
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(() =>
            {
                _renderQueued = false;
                Render();
            });
        }
        else
        {
            _renderQueued = false;
            Render();
        }
    }

    private void Render()
    {
        var display = DrivingSectionProjection.Project(_model, _localizer, _clock());

        AutomationProperties.SetName(this, display.AutomationName);
        if (display.State == DrivingSectionState.Loading)
        {
            Content = BuildLoading(display);
        }
        else
        {
            Content = BuildReady(display);
        }
    }

    // ── Loading (parent fetch in flight) ─────────────────────────────────────────────────────────────
    private TsGlassPanel BuildLoading(DrivingSectionDisplay display)
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(new TsSkeleton { BlockWidth = 120, BlockHeight = 24, ReduceMotion = _reduceMotion });
        column.Children.Add(new TsChartSkeleton());

        var statsRow = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            statsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var skeleton = new TsSkeleton { BlockHeight = 56, ReduceMotion = _reduceMotion };
            Grid.SetColumn(skeleton, i);
            statsRow.Children.Add(skeleton);
        }

        column.Children.Add(statsRow);
        column.Children.Add(new TsSkeleton { BlockHeight = 72, ReduceMotion = _reduceMotion });

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = column };
        AutomationProperties.SetName(panel, display.AutomationName);
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);
        return panel;
    }

    // ── Ready (the full section) ─────────────────────────────────────────────────────────────────────
    private TsFadeIn BuildReady(DrivingSectionDisplay display)
    {
        var body = new StackPanel { Spacing = 24 };
        body.Children.Add(BuildTitle(display.Title));
        body.Children.Add(BuildChartPanel(display));
        body.Children.Add(BuildStats(display));
        body.Children.Add(BuildTopDrivePanel(display));

        var panel = new TsGlassPanel { Padding = new Thickness(24), Content = body };
        AutomationProperties.SetName(panel, display.Title);

        return new TsFadeIn { DelayMs = 100, Content = panel };
    }

    private static StackPanel BuildTitle(string title)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(Icon(DrivingSectionRegistration.CarGlyph, TitleIconFontSize, AccentBrush()));
        row.Children.Add(new SectionTitle { Value = title, VerticalAlignment = VerticalAlignment.Center });

        AutomationProperties.SetName(row, title);
        return row;
    }

    // ── Daily-distance bar chart (or its empty surface) ──────────────────────────────────────────────
    private static TsGlassPanel BuildChartPanel(DrivingSectionDisplay display)
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new Subhead { Value = display.DailyDistanceLabel });

        if (display.HasDailyDistance)
        {
            column.Children.Add(BuildBars(display));
            column.Children.Add(BuildTable(display));
        }
        else
        {
            column.Children.Add(new TsEmptyState
            {
                Message = display.NoDailyDistanceMessage,
                MinHeight = 140,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return new TsGlassPanel { Padding = new Thickness(16), Content = column };
    }

    /// <summary>
    /// The daily-distance bar strip — the native analogue of the web recharts <c>BarChart</c>. Each bar's
    /// height is scaled to the projected <see cref="DrivingDailyBar.HeightRatio"/> (0..1 of the busiest day)
    /// and filled with the first categorical chart token (the web <c>CHART_COLORS[0]</c> bar fill); every
    /// bar shows its weekday tick beneath and carries a Narrator name with its day + distance.
    /// </summary>
    private static StackPanel BuildBars(DrivingSectionDisplay display)
    {
        var bars = display.Bars;
        var chart = new StackPanel { Spacing = 4, HorizontalAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(chart, display.ChartAriaLabel);

        var barsArea = new Grid { Height = BarsAreaHeight, VerticalAlignment = VerticalAlignment.Bottom };
        var labelsRow = new Grid();
        for (int i = 0; i < bars.Count; i++)
        {
            barsArea.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            labelsRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];

            var inner = new Grid();
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, 1 - bar.HeightRatio), GridUnitType.Star) });
            inner.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Math.Max(0.0, bar.HeightRatio), GridUnitType.Star) });

            var fill = new Border
            {
                Background = BarBrush(),
                CornerRadius = new CornerRadius(4, 4, 0, 0),
                Margin = new Thickness(3, 0, 3, 0),
                VerticalAlignment = VerticalAlignment.Stretch,
                MinHeight = bar.HeightRatio > 0 ? 2 : 0,
            };
            Grid.SetRow(fill, 1);
            inner.Children.Add(fill);

            Grid.SetColumn(inner, i);
            barsArea.Children.Add(inner);
            AutomationProperties.SetName(inner, bar.AutomationName);

            var tick = new TextBlock
            {
                Text = bar.DayLabel,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(tick, AccessibilityView.Raw);
            Grid.SetColumn(tick, i);
            labelsRow.Children.Add(tick);
        }

        chart.Children.Add(barsArea);
        chart.Children.Add(labelsRow);
        return chart;
    }

    // The bar chart's accessible fallback table (Day / Distance), under a native Expander so the precise
    // per-day figures stay one toggle away from the visual bars for screen-reader users.
    private static Expander BuildTable(DrivingSectionDisplay display)
    {
        var columns = new List<TsDataColumn>(display.Columns.Count);
        foreach (var column in display.Columns)
        {
            columns.Add(new TsDataColumn { Key = column.Key, Header = column.Header });
        }

        var rows = new List<TsDataRow>(display.Rows.Count);
        foreach (var row in display.Rows)
        {
            rows.Add(new TsDataRow(row.RowKey, ToValues(row.Cells)));
        }

        var table = new TsDataTable
        {
            Columns = columns,
            Rows = rows,
            PageSize = TableRowsPerPage,
            Selectable = false,
            EmptyMessage = display.NoDailyDistanceMessage,
        };

        var expander = new Expander
        {
            Header = display.ChartTableLabel,
            Content = table,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.ChartTableLabel);
        return expander;
    }

    // ── Efficiency mini-stats ────────────────────────────────────────────────────────────────────────
    private Grid BuildStats(DrivingSectionDisplay display)
    {
        int columns = StatColumnsFor(AvailableWidth());
        _statColumns = columns;

        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.Stats.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.Stats.Count; i++)
        {
            var tile = BuildMiniStat(display.Stats[i]);
            Grid.SetColumn(tile, i % columns);
            Grid.SetRow(tile, i / columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    // Mirrors the web MiniStat: a glass tile with a leading icon and a label-over-value column.
    private static TsGlassPanel BuildMiniStat(DrivingMiniStat stat)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(Icon(stat.Glyph, MiniStatIconFontSize, TrendBrush(stat.Trend)));

        var textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(new Caption { Value = stat.Label });
        textColumn.Children.Add(new TextBlock
        {
            Text = stat.Value,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        row.Children.Add(textColumn);

        var tile = new TsGlassPanel { Padding = new Thickness(16, 12, 16, 12), Content = row };
        AutomationProperties.SetName(tile, stat.AutomationName);
        return tile;
    }

    // ── Top drive card (or its empty surface) ────────────────────────────────────────────────────────
    private TsGlassPanel BuildTopDrivePanel(DrivingSectionDisplay display)
    {
        UIElement content = display.HasTopDrive
            ? BuildTopDrive(display)
            : new TsEmptyState
            {
                Message = display.NoTopDriveMessage,
                MinHeight = 120,
                VerticalAlignment = VerticalAlignment.Center,
            };

        return new TsGlassPanel { Padding = new Thickness(16), Content = content };
    }

    private StackPanel BuildTopDrive(DrivingSectionDisplay display)
    {
        var badge = new TsBadge
        {
            Status = TeslaSync.App.Core.StatusKind.Success,
            Content = display.TopDriveBadge,
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Left,
        };

        var fields = BuildTopDriveFields(display);

        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(badge);
        column.Children.Add(fields);

        var summary = string.Join(
            ", ",
            display.TopDriveFields.Select(f => string.Concat(f.Label, " ", f.Value)));
        AutomationProperties.SetName(column, string.Concat(display.TopDriveBadge, ". ", summary));
        return column;
    }

    private Grid BuildTopDriveFields(DrivingSectionDisplay display)
    {
        int columns = TopDriveColumnsFor(AvailableWidth());
        _topDriveColumns = columns;

        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 12 };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(display.TopDriveFields.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < display.TopDriveFields.Count; i++)
        {
            var field = display.TopDriveFields[i];
            var cell = new StackPanel { Spacing = 2 };
            cell.Children.Add(new Caption { Value = field.Label });
            cell.Children.Add(new TextBlock
            {
                Text = field.Value,
                FontSize = 14,
                FontWeight = FontWeights.SemiBold,
                Foreground = DisplayTokens.TextPrimary,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });

            Grid.SetColumn(cell, i % columns);
            Grid.SetRow(cell, i / columns);
            grid.Children.Add(cell);
        }

        return grid;
    }

    // ── Shared helpers ───────────────────────────────────────────────────────────────────────────────
    private static FontIcon Icon(string glyph, double fontSize, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = fontSize,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — the surface / region Narrator names already carry the meaning.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private double AvailableWidth()
    {
        double width = ActualWidth;
        return width > 0 ? width : double.PositiveInfinity;
    }

    private static int StatColumnsFor(double width) => width switch
    {
        <= 0 => 4,
        < StatsTwoColBreakpoint => 1,
        < StatsFourColBreakpoint => 2,
        _ => 4,
    };

    private static int TopDriveColumnsFor(double width) =>
        width is > 0 and < TopDriveFourColBreakpoint ? 2 : 4;

    private static Brush TrendBrush(DrivingTrend trend) => trend switch
    {
        DrivingTrend.Down => Resolve("TsColorSuccessBrush", DisplayTokens.TextMuted),
        DrivingTrend.Up => Resolve("TsColorDangerBrush", DisplayTokens.TextMuted),
        _ => DisplayTokens.TextMuted,
    };

    private static Brush AccentBrush() => Resolve("TsChartSpeedBrush", DisplayTokens.Accent);

    private static Brush BarBrush()
    {
        var brush = ChartBrushes.ForIndex(0);
        if (brush is SolidColorBrush { Color.A: > 0 })
        {
            return brush;
        }

        return DisplayTokens.Accent;
    }

    private static Brush Resolve(string key, Brush fallback)
    {
        if (Application.Current?.Resources is { } res && res.TryGetValue(key, out var value) && value is Brush brush)
        {
            return brush;
        }

        return fallback;
    }

    private static Dictionary<string, object?> ToValues(IReadOnlyDictionary<string, string> cells)
    {
        var values = new Dictionary<string, object?>(cells.Count, StringComparer.Ordinal);
        foreach (var cell in cells)
        {
            values[cell.Key] = cell.Value;
        }

        return values;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new DrivingSectionAutomationPeer(this);

    private sealed class DrivingSectionAutomationPeer(DrivingSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
