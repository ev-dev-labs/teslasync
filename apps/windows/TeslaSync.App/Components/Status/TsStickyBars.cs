using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.Components.Status;

/// <summary>A "jump to" chip for <see cref="TsStickyChipBar"/>.</summary>
/// <param name="Id">Anchor id the chip scrolls to.</param>
/// <param name="Label">Chip label.</param>
public sealed record TsChipItem(string Id, string Label);

/// <summary>
/// Horizontal "jump to" navigation (port of the web <c>StickyChipBar</c>). Renders a
/// scrollable row of chips; selecting one highlights it and raises
/// <see cref="ChipSelected"/> with the anchor id so the host can scroll its content.
/// Hosts keep the active chip in sync via <see cref="ActiveId"/>.
/// </summary>
public partial class TsStickyChipBar : ContentControl
{
    private readonly StackPanel _row = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private bool _suppress;

    public static readonly DependencyProperty ActiveIdProperty = DependencyProperty.Register(
        nameof(ActiveId), typeof(string), typeof(TsStickyChipBar), new PropertyMetadata(string.Empty, OnActiveIdChanged));

    public TsStickyChipBar()
    {
        IsTabStop = false;
        AutomationProperties.SetName(this, "Section navigation");
        Content = new ScrollViewer
        {
            Content = _row,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        };
    }

    /// <summary>Raised when the user selects a chip; the argument is the anchor id.</summary>
    public event EventHandler<string>? ChipSelected;

    /// <summary>The currently active chip id.</summary>
    public string ActiveId
    {
        get => (string)GetValue(ActiveIdProperty);
        set => SetValue(ActiveIdProperty, value);
    }

    /// <summary>Replace the chips.</summary>
    public void SetChips(IReadOnlyList<TsChipItem> chips)
    {
        ArgumentNullException.ThrowIfNull(chips);
        _row.Children.Clear();
        foreach (var chip in chips)
        {
            var button = new ToggleButton { Content = chip.Label, Tag = chip.Id };
            AutomationProperties.SetName(button, chip.Label);
            button.Checked += OnChipChecked;
            button.Unchecked += OnChipUnchecked;
            _row.Children.Add(button);
        }

        if (chips.Count > 0 && string.IsNullOrEmpty(ActiveId))
        {
            ActiveId = chips[0].Id;
        }

        Sync();
    }

    private static void OnActiveIdChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStickyChipBar)d).Sync();

    private void OnChipChecked(object sender, RoutedEventArgs e)
    {
        if (_suppress || sender is not ToggleButton { Tag: string id })
        {
            return;
        }

        ActiveId = id;
        ChipSelected?.Invoke(this, id);
    }

    private void OnChipUnchecked(object sender, RoutedEventArgs e)
    {
        if (_suppress || sender is not ToggleButton { Tag: string id })
        {
            return;
        }

        if (id == ActiveId)
        {
            Sync();
        }
    }

    private void Sync()
    {
        _suppress = true;
        foreach (var button in _row.Children.OfType<ToggleButton>())
        {
            button.IsChecked = button.Tag is string id && id == ActiveId;
        }

        _suppress = false;
    }
}

/// <summary>
/// Collapsed-on-scroll hero bar (port of the web <c>StickyCompactHero</c>). Shows a
/// compact status summary with the short headline, a last-checked label and refresh /
/// scroll-to-top actions. The host toggles <see cref="IsCollapsed"/> when the full
/// hero scrolls out of view; tapping the up action raises
/// <see cref="ScrollToTopRequested"/>.
/// </summary>
public partial class TsStickyCompactHero : ContentControl
{
    private readonly TsGlassPanel _panel = new();
    private readonly FontIcon _icon = new() { FontSize = 16, VerticalAlignment = VerticalAlignment.Center };
    private readonly Text _headline = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _lastChecked = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refresh = new() { Variant = TeslaSync.App.Core.ButtonVariant.Icon, IconGlyph = "\uE72C" };
    private readonly TsButton _toTop = new() { Variant = TeslaSync.App.Core.ButtonVariant.Icon, IconGlyph = "\uE74A" };

    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
        nameof(Status), typeof(HealthStatus), typeof(TsStickyCompactHero),
        new PropertyMetadata(HealthStatus.Unknown, OnStatusChanged));

    public static readonly DependencyProperty LastCheckedLabelProperty = DependencyProperty.Register(
        nameof(LastCheckedLabel), typeof(string), typeof(TsStickyCompactHero),
        new PropertyMetadata(string.Empty, OnLastCheckedChanged));

    public static readonly DependencyProperty IsCollapsedProperty = DependencyProperty.Register(
        nameof(IsCollapsed), typeof(bool), typeof(TsStickyCompactHero),
        new PropertyMetadata(false, OnCollapsedChanged));

    public static readonly DependencyProperty RefreshingProperty = DependencyProperty.Register(
        nameof(Refreshing), typeof(bool), typeof(TsStickyCompactHero),
        new PropertyMetadata(false, OnRefreshingChanged));

    public TsStickyCompactHero()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        Visibility = Visibility.Collapsed;

        var row = new Grid { ColumnSpacing = 10 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_headline, 1);
        Grid.SetColumn(_lastChecked, 2);
        Grid.SetColumn(_toTop, 3);
        Grid.SetColumn(_refresh, 4);
        row.Children.Add(_icon);
        row.Children.Add(_headline);
        row.Children.Add(_lastChecked);
        row.Children.Add(_toTop);
        row.Children.Add(_refresh);

        _refresh.Click += (_, _) => RefreshRequested?.Invoke(this, EventArgs.Empty);
        _toTop.Click += (_, _) => ScrollToTopRequested?.Invoke(this, EventArgs.Empty);

        _panel.Content = row;
        Content = _panel;
        ApplyStatus();
    }

    /// <summary>Raised when the refresh action is invoked.</summary>
    public event EventHandler? RefreshRequested;

    /// <summary>Raised when the scroll-to-top action is invoked.</summary>
    public event EventHandler? ScrollToTopRequested;

    /// <summary>The current health status.</summary>
    public HealthStatus Status
    {
        get => (HealthStatus)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    /// <summary>Relative last-checked label (e.g. "12s ago").</summary>
    public string LastCheckedLabel
    {
        get => (string)GetValue(LastCheckedLabelProperty);
        set => SetValue(LastCheckedLabelProperty, value);
    }

    /// <summary>When true the compact bar is shown (the full hero is off-screen).</summary>
    public bool IsCollapsed
    {
        get => (bool)GetValue(IsCollapsedProperty);
        set => SetValue(IsCollapsedProperty, value);
    }

    /// <summary>When true the refresh button shows a spinner.</summary>
    public bool Refreshing
    {
        get => (bool)GetValue(RefreshingProperty);
        set => SetValue(RefreshingProperty, value);
    }

    private static void OnStatusChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStickyCompactHero)d).ApplyStatus();

    private static void OnLastCheckedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStickyCompactHero)d)._lastChecked.Value = (string)e.NewValue;

    private static void OnCollapsedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStickyCompactHero)d).Visibility = (bool)e.NewValue ? Visibility.Visible : Visibility.Collapsed;

    private static void OnRefreshingChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStickyCompactHero)d)._refresh.IsLoading = (bool)e.NewValue;

    private void ApplyStatus()
    {
        _icon.Glyph = StatusPresentation.Glyph(Status);
        _icon.Foreground = DisplayPrimitives.HexBrush(StatusPresentation.AccentHex(Status));
        _headline.Value = StatusPresentation.ShortHeadline(Status);
        AutomationProperties.SetName(this, StatusPresentation.ShortHeadline(Status));
    }
}
