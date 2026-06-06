using System.Collections.Generic;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// A cartesian chart paired with a metric switcher (mirrors the web chart metric
/// switcher). The consumer registers several named metrics, each backed by its own
/// series set, via <see cref="AddMetric"/>; selecting one in the segmented control
/// swaps the hosted <see cref="TsCartesianChart"/>'s data. The inner chart is exposed
/// through <see cref="Chart"/> for further configuration (annotations, cursor sync).
/// </summary>
public partial class TsMetricSwitcherChart : ContentControl
{
    private readonly Dictionary<string, IReadOnlyList<ChartSeries>> _metrics = new(StringComparer.Ordinal);
    private readonly List<string> _order = [];
    private readonly TsSelect _selector = new() { Hint = "Metric", MinWidth = 180 };
    private readonly TsCartesianChart _chart = new TsLineChart();

    public TsMetricSwitcherChart()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _selector.SelectionChanged += OnMetricSelected;

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        header.Children.Add(_selector);

        var root = new StackPanel { Spacing = 8 };
        root.Children.Add(header);
        root.Children.Add(_chart);
        Content = root;
    }

    /// <summary>The hosted cartesian chart (configure annotations / cursor sync here).</summary>
    public TsCartesianChart Chart => _chart;

    /// <summary>Registers a named metric and its series; the first added is selected.</summary>
    public void AddMetric(string name, IReadOnlyList<ChartSeries> series)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentNullException.ThrowIfNull(series);

        if (!_metrics.ContainsKey(name))
        {
            _order.Add(name);
            _selector.Items.Add(name);
        }

        _metrics[name] = series;

        if (_selector.SelectedIndex < 0)
        {
            _selector.SelectedIndex = 0;
        }
    }

    /// <summary>Clears every registered metric.</summary>
    public void ClearMetrics()
    {
        _metrics.Clear();
        _order.Clear();
        _selector.Items.Clear();
        _chart.Series = [];
    }

    private void OnMetricSelected(object sender, SelectionChangedEventArgs e)
    {
        if (_selector.SelectedItem is string name && _metrics.TryGetValue(name, out var series))
        {
            _chart.Series = series;
        }
    }
}
