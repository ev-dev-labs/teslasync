using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Status;

namespace TeslaSync.App.Components.Status;

/// <summary>
/// Large at-a-glance status card (port of the web <c>StatusHero</c>). Answers
/// "is my instance healthy?" in under a second: <see cref="Status"/> drives the
/// icon, ring colour, headline and glow. Optionally shows a live indicator and a
/// call-to-action button (e.g. "Run health check").
/// </summary>
public partial class TsStatusHero : ContentControl
{
    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _row = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 20,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Grid _iconRing = new() { Width = 64, Height = 64 };
    private readonly Ellipse _ring = new() { Width = 64, Height = 64, StrokeThickness = 3 };
    private readonly FontIcon _icon = new() { FontSize = 28 };
    private readonly Heading _headline = new();
    private readonly Text _subline = new();
    private readonly StackPanel _liveRow = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly Ellipse _liveDot = new() { Width = 8, Height = 8 };
    private readonly Caption _liveLabel = new() { Value = "Live" };
    private readonly TsButton _cta = new() { Variant = TeslaSync.App.Core.ButtonVariant.Secondary, Visibility = Visibility.Collapsed };

    public static readonly DependencyProperty StatusProperty = DependencyProperty.Register(
        nameof(Status), typeof(HealthStatus), typeof(TsStatusHero),
        new PropertyMetadata(HealthStatus.Unknown, OnStatusChanged));

    public static readonly DependencyProperty HeadlineProperty = DependencyProperty.Register(
        nameof(Headline), typeof(string), typeof(TsStatusHero), new PropertyMetadata(string.Empty, OnStatusChanged));

    public static readonly DependencyProperty SublineProperty = DependencyProperty.Register(
        nameof(Subline), typeof(string), typeof(TsStatusHero), new PropertyMetadata(string.Empty, OnSublineChanged));

    public static readonly DependencyProperty LiveProperty = DependencyProperty.Register(
        nameof(Live), typeof(bool), typeof(TsStatusHero), new PropertyMetadata(false, OnLiveChanged));

    public TsStatusHero()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _iconRing.Children.Add(_ring);
        _icon.HorizontalAlignment = HorizontalAlignment.Center;
        _icon.VerticalAlignment = VerticalAlignment.Center;
        _iconRing.Children.Add(_icon);

        var textColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        _liveRow.Children.Add(_liveDot);
        _liveRow.Children.Add(_liveLabel);
        _liveRow.Visibility = Visibility.Collapsed;
        textColumn.Children.Add(_headline);
        textColumn.Children.Add(_subline);
        textColumn.Children.Add(_liveRow);

        _row.Children.Add(_iconRing);
        _row.Children.Add(textColumn);

        var outer = new Grid();
        outer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        outer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_row, 0);
        Grid.SetColumn(_cta, 1);
        _cta.VerticalAlignment = VerticalAlignment.Center;
        outer.Children.Add(_row);
        outer.Children.Add(_cta);

        _panel.Content = outer;
        Content = _panel;
        _cta.Click += (_, _) => CtaInvoked?.Invoke(this, EventArgs.Empty);
        ApplyStatus();
    }

    /// <summary>Raised when the call-to-action button is invoked.</summary>
    public event EventHandler? CtaInvoked;

    /// <summary>The overall health status.</summary>
    public HealthStatus Status
    {
        get => (HealthStatus)GetValue(StatusProperty);
        set => SetValue(StatusProperty, value);
    }

    /// <summary>Override headline; empty uses the status default.</summary>
    public string Headline
    {
        get => (string)GetValue(HeadlineProperty);
        set => SetValue(HeadlineProperty, value);
    }

    /// <summary>Sub-line beneath the headline.</summary>
    public string Subline
    {
        get => (string)GetValue(SublineProperty);
        set => SetValue(SublineProperty, value);
    }

    /// <summary>When true a "Live" indicator dot is shown.</summary>
    public bool Live
    {
        get => (bool)GetValue(LiveProperty);
        set => SetValue(LiveProperty, value);
    }

    /// <summary>Configure (and show) the call-to-action button.</summary>
    public void SetCta(string label, bool loading = false)
    {
        _cta.Text = label ?? string.Empty;
        _cta.IsLoading = loading;
        _cta.Visibility = string.IsNullOrEmpty(label) ? Visibility.Collapsed : Visibility.Visible;
    }

    private static void OnStatusChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStatusHero)d).ApplyStatus();

    private static void OnSublineChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsStatusHero)d)._subline.Value = (string)e.NewValue;

    private static void OnLiveChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var hero = (TsStatusHero)d;
        hero._liveRow.Visibility = (bool)e.NewValue ? Visibility.Visible : Visibility.Collapsed;
    }

    private void ApplyStatus()
    {
        var accent = DisplayPrimitives.HexBrush(StatusPresentation.AccentHex(Status));
        _ring.Stroke = accent;
        _icon.Foreground = accent;
        _icon.Glyph = StatusPresentation.Glyph(Status);
        _liveDot.Fill = DisplayPrimitives.HexBrush(StatusPresentation.HealthyHex);

        string heading = string.IsNullOrEmpty(Headline) ? StatusPresentation.DefaultHeadline(Status) : Headline;
        _headline.Value = heading;
        AutomationProperties.SetName(this, $"{StatusPresentation.Label(Status)}: {heading}");
    }
}
