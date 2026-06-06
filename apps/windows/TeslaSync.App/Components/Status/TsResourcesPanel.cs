using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.Components.Status;

/// <summary>One resource row for <see cref="TsResourcesPanel"/> (port of the web <c>ResourceRow</c>).</summary>
/// <param name="Label">Row label (e.g. "Memory").</param>
/// <param name="ValueText">Display value (e.g. "1.8 GB").</param>
/// <param name="MetaText">Optional sub-label (e.g. "of 8 GB").</param>
/// <param name="Percent">Optional 0–100 percent driving a bar + severity.</param>
/// <param name="IconGlyph">Optional leading glyph.</param>
public sealed record TsResourceRow(
    string Label,
    string ValueText,
    string? MetaText = null,
    double? Percent = null,
    string? IconGlyph = null);

/// <summary>
/// Server resources at-a-glance (port of the web <c>ResourcesPanel</c>). Renders a
/// row per supplied <see cref="TsResourceRow"/>; rows with a percent show a bar whose
/// colour follows the warn (≥70%) / critical (≥90%) thresholds from
/// <see cref="StatusPresentation.Severity"/>.
/// </summary>
public partial class TsResourcesPanel : ContentControl
{
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly PanelTitle _title = new() { Value = "Resources" };
    private readonly StackPanel _rows = new() { Spacing = 12 };
    private readonly Caption _footnote = new() { Visibility = Visibility.Collapsed };

    public TsResourcesPanel()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _root.Children.Add(_title);
        _root.Children.Add(_rows);
        _root.Children.Add(_footnote);
        _panel.Content = _root;
        Content = _panel;
    }

    /// <summary>Optional footnote text beneath the rows.</summary>
    public string Footnote
    {
        get => _footnote.Value;
        set
        {
            _footnote.Value = value ?? string.Empty;
            _footnote.Visibility = string.IsNullOrEmpty(value) ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    /// <summary>Replace the resource rows.</summary>
    public void SetRows(IEnumerable<TsResourceRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        _rows.Children.Clear();
        foreach (var row in rows)
        {
            _rows.Children.Add(BuildRow(row));
        }
    }

    private static StackPanel BuildRow(TsResourceRow row)
    {
        var severity = StatusPresentation.Severity(row.Percent);
        var accent = DisplayPrimitives.HexBrush(StatusPresentation.SeverityHex(severity));

        var column = new StackPanel { Spacing = 4 };

        var header = new Grid { ColumnSpacing = 8 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        if (!string.IsNullOrEmpty(row.IconGlyph))
        {
            var icon = new FontIcon { Glyph = row.IconGlyph, FontSize = 14, Foreground = DisplayTokens.TextSecondary, VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(icon, 0);
            header.Children.Add(icon);
        }

        var label = new Text { Value = row.Label, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, 1);
        header.Children.Add(label);

        var valueText = new TextBlock
        {
            Text = string.IsNullOrEmpty(row.MetaText) ? row.ValueText : $"{row.ValueText} {row.MetaText}",
            FontSize = 13,
            Foreground = row.Percent is null ? DisplayTokens.TextPrimary : accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(valueText, 2);
        header.Children.Add(valueText);

        column.Children.Add(header);

        if (row.Percent is { } percent)
        {
            double clamped = Math.Clamp(percent, 0, 100);
            var track = new Grid { Height = 6, CornerRadius = new CornerRadius(3), Background = DisplayTokens.Border };
            var fill = new Rectangle
            {
                Height = 6,
                RadiusX = 3,
                RadiusY = 3,
                Fill = accent,
                HorizontalAlignment = HorizontalAlignment.Left,
                Width = 0,
            };
            track.SizeChanged += (_, args) => fill.Width = args.NewSize.Width * (clamped / 100.0);
            track.Children.Add(fill);
            column.Children.Add(track);
            AutomationProperties.SetName(
                column,
                string.Create(CultureInfo.InvariantCulture, $"{row.Label}: {row.ValueText}, {clamped:0}%"));
        }
        else
        {
            AutomationProperties.SetName(column, $"{row.Label}: {row.ValueText}");
        }

        return column;
    }
}
