using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.YearReview;

/// <summary>
/// The native WinUI 3 <c>StatChartSlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/StatChartSlide.tsx. It is a pure presentational slide:
/// assign a <see cref="Model"/> (the slice of the web <c>YearReview</c> prop the slide reads) and it
/// renders exactly one of the branches the web data flow produces — <see cref="StatChartSlideState.Loading"/>
/// (skeleton chrome while the parent <c>YearReviewPage</c> resolves the review),
/// <see cref="StatChartSlideState.Empty"/> (a friendly "no drive data" surface when the year has no
/// activity), or <see cref="StatChartSlideState.Ready"/> (the calendar emoji, the count-up
/// <c>total_drives</c> headline beside the localized "drives" label, the avg-per-week sentence, and the
/// per-month drive <see cref="TsAnimatedNumber"/>-paced bar chart — the native analogue of the recharts
/// <c>BarChart</c> — plus the accessible Month/Drives table the bar chart exposes as its tabular fallback).
/// The view never performs HTTP; all branch selection, label resolution and formatting happen in the
/// WinUI-free <see cref="StatChartSlideProjection"/>. Every string resolves through the i18n facade, motion
/// honours the system reduce-motion preference, and every region/bar carries a Narrator name.
/// </summary>
public sealed partial class StatChartSlide : ContentControl
{
    private const double EmojiFontSize = 40;
    private const double TotalDrivesHeight = 56;
    private const double BarsAreaHeight = 180;
    private const double ChartMaxWidth = 512;
    private const int RowsPerPage = 12;

    // Segoe Fluent Icons — Calendar (the empty-state glyph; the slide's 🗓️ is decorative on the web).
    private const string CalendarGlyph = "\uE787";

    private readonly ILocalizer _localizer;
    private readonly StatChartSlideDiagnostics _diagnostics;
    private readonly CultureInfo _culture;
    private readonly bool _reduceMotion;

    private StatChartSlideModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and optional collaborators.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="StatChartSlideModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="culture">The culture whose abbreviated month names label the bars; defaults to the current UI culture.</param>
    /// <param name="reduceMotion">Overrides the system reduce-motion preference (for tests/hosting); defaults to the OS setting.</param>
    public StatChartSlide(
        ILocalizer localizer,
        StatChartSlideModel? model = null,
        StatChartSlideDiagnostics? diagnostics = null,
        CultureInfo? culture = null,
        bool? reduceMotion = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? StatChartSlideModel.Pending;
        _diagnostics = diagnostics ?? new StatChartSlideDiagnostics();
        _culture = culture ?? CultureInfo.CurrentCulture;
        _reduceMotion = reduceMotion ?? MotionPreference.ReduceMotion;

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>StatChartSlide</c>).</summary>
    public static string Slug => StatChartSlideRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public StatChartSlideModel Model
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
        var display = StatChartSlideProjection.Project(_model, _localizer, _culture);

        UIElement surface = display.State switch
        {
            StatChartSlideState.Loading => BuildLoading(display),
            StatChartSlideState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── Loading (parent fetch in flight) ─────────────────────────────────────────────────────────────
    private static StackPanel BuildLoading(StatChartSlideDisplay display)
    {
        var stack = NewSlideColumn();
        stack.Children.Add(new TsSkeleton { BlockWidth = 56, BlockHeight = 48, Radius = 12 });
        stack.Children.Add(new TsSkeleton { BlockWidth = 200, BlockHeight = 44 });
        stack.Children.Add(new TsSkeleton { BlockWidth = 240, BlockHeight = 14 });
        stack.Children.Add(new TsSkeleton { BlockWidth = ChartMaxWidth, BlockHeight = BarsAreaHeight, Radius = 10 });

        AutomationProperties.SetName(stack, display.AutomationName);
        LiveRegion.Configure(stack);
        LiveRegion.Announce(stack);
        return stack;
    }

    // ── Empty (resolved with no activity at all) ─────────────────────────────────────────────────────
    private static TsEmptyState BuildEmpty(StatChartSlideDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = CalendarGlyph,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(empty, display.AutomationName);
        return empty;
    }

    // ── Ready (the headline + monthly bar chart) ─────────────────────────────────────────────────────
    private StackPanel BuildReady(StatChartSlideDisplay display)
    {
        var stack = NewSlideColumn();
        stack.Children.Add(BuildEmoji(display.Emoji));
        stack.Children.Add(BuildHeadline(display));
        stack.Children.Add(new Caption
        {
            Value = display.AvgPerWeekText,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        stack.Children.Add(BuildChart(display));
        return stack;
    }

    private static TextBlock BuildEmoji(string emoji)
    {
        var glyph = new TextBlock
        {
            Text = emoji,
            FontSize = EmojiFontSize,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        return glyph;
    }

    private StackPanel BuildHeadline(StatChartSlideDisplay display)
    {
        var number = new TsAnimatedNumber
        {
            Value = display.TotalDrives,
            DurationSeconds = display.TotalDrivesDurationSeconds,
            Precision = 0,
            ReduceMotion = _reduceMotion,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        AutomationProperties.SetAccessibilityView(number, AccessibilityView.Raw);

        // The web renders total_drives at a dramatic 5xl/7xl; scale the tokenized number up via a Viewbox
        // rather than hard-coding a font size, so it stays crisp at any DPI / text-scale factor.
        var scaled = new Viewbox
        {
            Height = TotalDrivesHeight,
            Child = number,
            VerticalAlignment = VerticalAlignment.Bottom,
        };

        var label = new Subhead
        {
            Value = display.DrivesLabel,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        row.Children.Add(scaled);
        row.Children.Add(label);
        AutomationProperties.SetName(row, display.HeadlineAutomationName);
        return row;
    }

    private static StackPanel BuildChart(StatChartSlideDisplay display)
    {
        var container = new StackPanel
        {
            Spacing = 10,
            MaxWidth = ChartMaxWidth,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        if (!display.HasChartData)
        {
            container.Children.Add(new TsEmptyState
            {
                Message = display.ChartEmptyMessage,
                MinHeight = BarsAreaHeight,
                VerticalAlignment = VerticalAlignment.Center,
            });
            return container;
        }

        container.Children.Add(BuildBars(display));
        container.Children.Add(BuildTable(display));
        return container;
    }

    /// <summary>
    /// The drive-count bar strip — the native analogue of the web recharts <c>BarChart</c>. Each bar's
    /// height is scaled to the projected <see cref="StatChartSlideBar.HeightRatio"/> (0..1 of the busiest
    /// month) and filled with the violet power-chart token (the web bar fill); every bar shows its month
    /// tick beneath and carries a Narrator name with its full month + count.
    /// </summary>
    private static StackPanel BuildBars(StatChartSlideDisplay display)
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

            var lbl = new TextBlock
            {
                Text = bar.MonthLabel,
                FontSize = 11,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };
            AutomationProperties.SetAccessibilityView(lbl, AccessibilityView.Raw);
            Grid.SetColumn(lbl, i);
            labelsRow.Children.Add(lbl);
        }

        chart.Children.Add(barsArea);
        chart.Children.Add(labelsRow);
        return chart;
    }

    // The bar chart's accessible fallback table (Month / Drives), under a native Expander so the precise
    // per-month figures stay one toggle away from the visual bars for screen-reader users.
    private static Expander BuildTable(StatChartSlideDisplay display)
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
            PageSize = RowsPerPage,
            Selectable = false,
            EmptyMessage = display.ChartEmptyMessage,
        };

        var expander = new Expander
        {
            Header = display.TableLabel,
            Content = table,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
        };
        AutomationProperties.SetName(expander, display.TableLabel);
        return expander;
    }

    private static StackPanel NewSlideColumn() => new()
    {
        Spacing = 14,
        Padding = new Thickness(24, 0, 24, 0),
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Microsoft.UI.Xaml.Media.Brush BarBrush()
    {
        var brush = DisplayTokens.Brush("TsChartPowerBrush");
        if (brush is Microsoft.UI.Xaml.Media.SolidColorBrush { Color.A: > 0 })
        {
            return brush;
        }

        return DisplayTokens.Accent;
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
}
