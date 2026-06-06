using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// The tabular, screen-reader-friendly alternative every chart exposes. Projects
/// the bound <see cref="Series"/> through <see cref="ChartAccessibility.ToDataView"/>
/// into a real grid (header row plus one row per X value) so the same data the
/// chart draws visually is available as text.
/// </summary>
public partial class TsChartDataView : ContentControl
{
    private readonly Grid _grid = new() { ColumnSpacing = 16, RowSpacing = 2 };

    public static readonly DependencyProperty SeriesProperty = DependencyProperty.Register(
        nameof(Series), typeof(IReadOnlyList<ChartSeries>), typeof(TsChartDataView),
        new PropertyMetadata(null, OnSeriesChanged));

    public static readonly DependencyProperty XLabelProperty = DependencyProperty.Register(
        nameof(XLabel), typeof(string), typeof(TsChartDataView),
        new PropertyMetadata("x", OnSeriesChanged));

    public TsChartDataView()
    {
        IsTabStop = false;
        Content = new ScrollViewer
        {
            Content = _grid,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = 240,
        };
    }

    /// <summary>The series to tabulate (mirror the chart's data).</summary>
    public IReadOnlyList<ChartSeries>? Series
    {
        get => (IReadOnlyList<ChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    /// <summary>Header label for the X column.</summary>
    public string XLabel
    {
        get => (string)GetValue(XLabelProperty);
        set => SetValue(XLabelProperty, value);
    }

    private static void OnSeriesChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsChartDataView)d).Rebuild();

    private void Rebuild()
    {
        _grid.Children.Clear();
        _grid.ColumnDefinitions.Clear();
        _grid.RowDefinitions.Clear();

        var series = Series ?? [];
        var view = ChartAccessibility.ToDataView(series, XLabel);

        for (var c = 0; c < view.Columns.Count; c++)
        {
            _grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        _grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var c = 0; c < view.Columns.Count; c++)
        {
            var head = new Label { Value = view.Columns[c] };
            Grid.SetRow(head, 0);
            Grid.SetColumn(head, c);
            _grid.Children.Add(head);
        }

        for (var r = 0; r < view.Rows.Count; r++)
        {
            _grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var row = view.Rows[r];
            for (var c = 0; c < row.Count; c++)
            {
                var cell = new TextBlock
                {
                    Text = string.IsNullOrEmpty(row[c]) ? "\u2014" : row[c],
                    Foreground = c == 0 ? ChartBrushes.TextMuted : ChartBrushes.TextPrimary,
                    FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
                };
                Grid.SetRow(cell, r + 1);
                Grid.SetColumn(cell, c);
                _grid.Children.Add(cell);
            }
        }
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new DataViewAutomationPeer(this);

    private sealed class DataViewAutomationPeer(TsChartDataView owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Table;
    }
}
