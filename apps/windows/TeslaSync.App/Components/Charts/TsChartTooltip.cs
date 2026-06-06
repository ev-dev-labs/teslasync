using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Floating tooltip surface for a chart (mirrors the web <c>ChartTooltip</c>).
/// Rendered from a <see cref="ChartTooltipModel"/> so each visible series gets a
/// colour swatch, name and formatted value. The host positions it over the plot
/// near the active cursor; <see cref="Update"/> rebuilds the rows.
/// </summary>
public partial class TsChartTooltip : ContentControl
{
    private readonly StackPanel _rows = new() { Spacing = 2 };
    private readonly Caption _header = new();

    public TsChartTooltip()
    {
        IsTabStop = false;
        IsHitTestVisible = false;

        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(_header);
        panel.Children.Add(_rows);

        Content = new Border
        {
            Background = ChartBrushes.Surface,
            BorderBrush = ChartBrushes.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(10, 8, 10, 8),
            Child = panel,
        };

        Visibility = Visibility.Collapsed;
    }

    /// <summary>Rebuilds the tooltip body from a resolved model.</summary>
    public void Update(ChartTooltipModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        _header.Value = model.Header;
        _rows.Children.Clear();

        foreach (var row in model.Rows)
        {
            var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            line.Children.Add(new Ellipse
            {
                Width = 8,
                Height = 8,
                Fill = ChartBrushes.Resolve(row.ColorKey),
                VerticalAlignment = VerticalAlignment.Center,
            });

            var name = new TextBlock
            {
                Text = row.SeriesName,
                Foreground = ChartBrushes.TextMuted,
                FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            };
            var value = new TextBlock
            {
                Text = row.FormattedValue,
                Foreground = ChartBrushes.TextPrimary,
                FontWeight = TypographyTokens.Weight(600),
                Margin = new Thickness(8, 0, 0, 0),
                FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
            };

            line.Children.Add(name);
            line.Children.Add(value);
            _rows.Children.Add(line);
        }
    }

    /// <summary>Shows the tooltip.</summary>
    public void Show() => Visibility = Visibility.Visible;

    /// <summary>Hides the tooltip.</summary>
    public void Hide() => Visibility = Visibility.Collapsed;
}
