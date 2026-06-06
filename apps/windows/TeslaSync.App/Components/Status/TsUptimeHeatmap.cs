using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.Components.Status;

/// <summary>
/// Rolling N-day status grid (port of the web <c>UptimeHeatmap</c>). Renders one
/// square per day (oldest on the left) tinted by that day's status, with a tooltip
/// exposing the date + status + summary, and a caption showing the overall uptime %
/// across the window (healthy + maintenance days count as up).
/// </summary>
public partial class TsUptimeHeatmap : ContentControl
{
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly PanelTitle _heading = new();
    private readonly Text _uptime = new();
    private readonly StackPanel _squares = new() { Orientation = Orientation.Horizontal, Spacing = 3 };
    private readonly Caption _footnote = new();

    private IReadOnlyList<UptimeDay> _days = [];
    private string? _title;

    public TsUptimeHeatmap()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_heading, 0);
        Grid.SetColumn(_uptime, 1);
        headerRow.Children.Add(_heading);
        headerRow.Children.Add(_uptime);

        var scroller = new ScrollViewer
        {
            Content = _squares,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        };

        _root.Children.Add(headerRow);
        _root.Children.Add(scroller);
        _root.Children.Add(_footnote);
        _panel.Content = _root;
        Content = _panel;
        Render();
    }

    /// <summary>Optional footnote shown beneath the squares.</summary>
    public string Footnote
    {
        get => _footnote.Value;
        set => _footnote.Value = value ?? string.Empty;
    }

    /// <summary>Override the heading text (defaults to "Uptime — last N days").</summary>
    public void SetTitle(string? title)
    {
        _title = title;
        Render();
    }

    /// <summary>Set the day window and redraw.</summary>
    public void SetDays(IReadOnlyList<UptimeDay> days)
    {
        ArgumentNullException.ThrowIfNull(days);
        _days = days;
        Render();
    }

    private void Render()
    {
        _heading.Value = _title ?? string.Create(CultureInfo.InvariantCulture, $"Uptime — last {_days.Count} days");

        double? pct = StatusPresentation.UptimePercent(_days);
        _uptime.Value = pct is { } p
            ? string.Create(CultureInfo.InvariantCulture, $"{p:0.0}% uptime")
            : "—";

        _squares.Children.Clear();
        foreach (var day in _days)
        {
            var square = new Rectangle
            {
                Width = 14,
                Height = 14,
                RadiusX = 3,
                RadiusY = 3,
                Fill = DisplayPrimitives.HexBrush(StatusPresentation.AccentHex(day.Status)),
            };

            string tip = string.IsNullOrEmpty(day.Summary)
                ? $"{day.Date}: {StatusPresentation.Label(day.Status)}"
                : $"{day.Date}: {StatusPresentation.Label(day.Status)} — {day.Summary}";
            ToolTipService.SetToolTip(square, tip);
            AutomationProperties.SetName(square, tip);
            _squares.Children.Add(square);
        }

        AutomationProperties.SetName(this, $"{_heading.Value}. {_uptime.Value}");
    }
}
