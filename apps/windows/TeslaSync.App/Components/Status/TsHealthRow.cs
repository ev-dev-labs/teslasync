using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.Components.Status;

/// <summary>
/// Single-line health summary row (port of the web <c>HealthRow</c>): a status dot,
/// optional icon, label, a right-aligned summary (e.g. "12 / 12 healthy") tinted by
/// <see cref="Status"/>, and a chevron when it is actionable. Stack several inside a
/// panel for a high-density at-a-glance health grid.
/// </summary>
public partial class TsHealthRow : ContentControl
{
    private readonly Ellipse _dot = new() { Width = 10, Height = 10, VerticalAlignment = VerticalAlignment.Center };
    private readonly FontIcon _icon = new() { FontSize = 14, Foreground = DisplayTokens.TextSecondary, Visibility = Visibility.Collapsed };
    private readonly Text _label = new();
    private readonly TextBlock _summary = new() { FontSize = 12 };
    private readonly FontIcon _chevron = new() { Glyph = "\uE76C", FontSize = 12, Foreground = DisplayTokens.TextMuted, Visibility = Visibility.Collapsed };

    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
        nameof(Status), typeof(HealthStatus), typeof(TsHealthRow),
        new PropertyMetadata(HealthStatus.Unknown, OnChanged));

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsHealthRow), new PropertyMetadata(string.Empty, OnChanged));

    public static readonly DependencyProperty SummaryProperty = DependencyProperty.Register(
        nameof(Summary), typeof(string), typeof(TsHealthRow), new PropertyMetadata(string.Empty, OnChanged));

    public static readonly DependencyProperty IconGlyphProperty = DependencyProperty.Register(
        nameof(IconGlyph), typeof(string), typeof(TsHealthRow), new PropertyMetadata(string.Empty, OnChanged));

    public static readonly DependencyProperty ActionableProperty = DependencyProperty.Register(
        nameof(Actionable), typeof(bool), typeof(TsHealthRow), new PropertyMetadata(false, OnChanged));

    public TsHealthRow()
    {
        IsTabStop = true;
        UseSystemFocusVisuals = true;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var grid = new Grid { ColumnSpacing = 10, Padding = new Thickness(4, 6, 4, 6) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        _label.VerticalAlignment = VerticalAlignment.Center;
        _summary.VerticalAlignment = VerticalAlignment.Center;
        _icon.VerticalAlignment = VerticalAlignment.Center;
        _chevron.VerticalAlignment = VerticalAlignment.Center;

        Grid.SetColumn(_dot, 0);
        Grid.SetColumn(_icon, 1);
        Grid.SetColumn(_label, 2);
        Grid.SetColumn(_summary, 3);
        Grid.SetColumn(_chevron, 4);
        grid.Children.Add(_dot);
        grid.Children.Add(_icon);
        grid.Children.Add(_label);
        grid.Children.Add(_summary);
        grid.Children.Add(_chevron);

        Content = grid;
        Tapped += (_, _) => RaiseIfActionable();
        KeyDown += OnKeyDown;
        Apply();
    }

    /// <summary>Raised when an actionable row is activated.</summary>
    public event EventHandler? Activated;

    /// <summary>The row's health status (drives the dot + summary colour).</summary>
    public HealthStatus Status
    {
        get => (HealthStatus)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    /// <summary>Primary label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Right-aligned summary text.</summary>
    public string Summary
    {
        get => (string)GetValue(SummaryProperty);
        set => SetValue(SummaryProperty, value);
    }

    /// <summary>Optional leading icon glyph.</summary>
    public string IconGlyph
    {
        get => (string)GetValue(IconGlyphProperty);
        set => SetValue(IconGlyphProperty, value);
    }

    /// <summary>When true the row shows a chevron and raises <see cref="Activated"/>.</summary>
    public bool Actionable
    {
        get => (bool)GetValue(ActionableProperty);
        set => SetValue(ActionableProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsHealthRow)d).Apply();

    private void OnKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key is Windows.System.VirtualKey.Enter or Windows.System.VirtualKey.Space)
        {
            RaiseIfActionable();
            e.Handled = true;
        }
    }

    private void RaiseIfActionable()
    {
        if (Actionable)
        {
            Activated?.Invoke(this, EventArgs.Empty);
        }
    }

    private void Apply()
    {
        var accent = DisplayPrimitives.HexBrush(StatusPresentation.AccentHex(Status));
        _dot.Fill = accent;
        _label.Value = Label;
        _summary.Text = Summary;
        _summary.Foreground = accent;

        _icon.Glyph = IconGlyph;
        _icon.Visibility = string.IsNullOrEmpty(IconGlyph) ? Visibility.Collapsed : Visibility.Visible;
        _chevron.Visibility = Actionable ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(this, $"{Label}: {Summary}, {StatusPresentation.Label(Status)}");
    }
}
