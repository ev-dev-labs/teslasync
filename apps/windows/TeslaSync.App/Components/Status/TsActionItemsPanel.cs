using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.Components.Status;

/// <summary>
/// Operator task list (port of the web <c>ActionItemsPanel</c>). NEVER hides: when
/// there are no action items it shows an explicit "Nothing right now" success state
/// so the operator can tell "healthy" apart from "broken".
/// </summary>
public partial class TsActionItemsPanel : ContentControl
{
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 12 };
    private readonly PanelTitle _title = new() { Value = "Needs your attention" };
    private readonly StackPanel _items = new() { Spacing = 8 };
    private readonly Border _empty;
    private readonly Text _emptyText;

    private bool _forceEmpty;

    public TsActionItemsPanel()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var emptyRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        emptyRow.Children.Add(new FontIcon
        {
            Glyph = StatusPresentation.Glyph(HealthStatus.Healthy),
            FontSize = 18,
            Foreground = DisplayPrimitives.HexBrush(StatusPresentation.HealthyHex),
            VerticalAlignment = VerticalAlignment.Center,
        });
        _emptyText = new Text { Value = "Nothing right now", VerticalAlignment = VerticalAlignment.Center };
        emptyRow.Children.Add(_emptyText);

        _empty = new Border
        {
            Child = emptyRow,
            Padding = new Thickness(12),
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = DisplayPrimitives.HexBrush("#1022C55E"),
            BorderBrush = DisplayPrimitives.HexBrush("#3322C55E"),
            BorderThickness = new Thickness(1),
        };

        _root.Children.Add(_title);
        _root.Children.Add(_items);
        _root.Children.Add(_empty);
        _panel.Content = _root;
        Content = _panel;
        UpdateEmptyState();
    }

    /// <summary>Title shown at the top.</summary>
    public string Title
    {
        get => _title.Value;
        set => _title.Value = value ?? string.Empty;
    }

    /// <summary>Empty-state message.</summary>
    public string EmptyText
    {
        get => _emptyText.Value;
        set => _emptyText.Value = value ?? string.Empty;
    }

    /// <summary>Force the empty state regardless of items (tests / previews).</summary>
    public bool ForceEmpty
    {
        get => _forceEmpty;
        set
        {
            _forceEmpty = value;
            UpdateEmptyState();
        }
    }

    /// <summary>Replace the action items.</summary>
    public void SetItems(IEnumerable<UIElement> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        _items.Children.Clear();
        foreach (var item in items)
        {
            _items.Children.Add(item);
        }

        UpdateEmptyState();
    }

    /// <summary>Append a single action item.</summary>
    public void AddItem(UIElement item)
    {
        ArgumentNullException.ThrowIfNull(item);
        _items.Children.Add(item);
        UpdateEmptyState();
    }

    private void UpdateEmptyState()
    {
        bool hasItems = !_forceEmpty && _items.Children.Count > 0;
        _items.Visibility = hasItems ? Visibility.Visible : Visibility.Collapsed;
        _empty.Visibility = hasItems ? Visibility.Collapsed : Visibility.Visible;
        AutomationProperties.SetName(this, hasItems ? Title : $"{Title}: {EmptyText}");
    }
}
