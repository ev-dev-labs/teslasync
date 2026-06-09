using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The DevTools tool card (native port of the web
/// <c>features/admin/components/devtools/ToolCard.tsx</c>). A tokenized glass surface
/// with an accent icon badge, a title and a secondary description above a content slot
/// (<see cref="Body"/>, the native analogue of the web <c>children</c>). It is a pure
/// presentational composition primitive: it owns no data source and no localized
/// strings — the caller supplies the (already-localized) <see cref="Title"/> and
/// <see cref="Description"/> exactly as the web component receives them as props. The
/// header always renders so the surface is never a blank box, and the accent resolves
/// through <see cref="ToolCardAccent"/> with the web cyan fallback.
/// </summary>
public partial class ToolCard : ContentControl
{
    private readonly ToolCardDiagnostics _diagnostics;

    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new();
    private readonly Grid _header = new();
    private readonly Border _iconBadge = new();
    private readonly FontIcon _icon = new();
    private readonly StackPanel _titleStack = new() { Spacing = 2 };
    private readonly TextBlock _title = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _description = new() { TextWrapping = TextWrapping.Wrap };
    private readonly ContentPresenter _bodyHost = new();

    private bool _opened;

    /// <summary>The Segoe Fluent Icons glyph shown in the accent badge.</summary>
    public static readonly DependencyProperty IconGlyphProperty = DependencyProperty.Register(
        nameof(IconGlyph), typeof(string), typeof(ToolCard),
        new PropertyMetadata(string.Empty, OnModelChanged));

    /// <summary>The accent name (cyan, green, purple, amber or red); unknown falls back to cyan.</summary>
    public static readonly DependencyProperty AccentProperty = DependencyProperty.Register(
        nameof(Accent), typeof(string), typeof(ToolCard),
        new PropertyMetadata(ToolCardAccent.Default, OnModelChanged));

    /// <summary>The card title (caller-supplied, already localized).</summary>
    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(ToolCard),
        new PropertyMetadata(string.Empty, OnModelChanged));

    /// <summary>The secondary description (caller-supplied, already localized).</summary>
    public static readonly DependencyProperty DescriptionProperty = DependencyProperty.Register(
        nameof(Description), typeof(string), typeof(ToolCard),
        new PropertyMetadata(string.Empty, OnModelChanged));

    /// <summary>The content slot rendered below the header (native analogue of web <c>children</c>).</summary>
    public static readonly DependencyProperty BodyProperty = DependencyProperty.Register(
        nameof(Body), typeof(object), typeof(ToolCard),
        new PropertyMetadata(null, OnBodyChanged));

    /// <summary>Creates the card over an optional PII-safe diagnostics collector.</summary>
    public ToolCard(ToolCardDiagnostics? diagnostics = null)
    {
        _diagnostics = diagnostics ?? new ToolCardDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildVisualTree();

        Loaded += OnLoaded;
        ApplyModel();
        ApplyBody();
    }

    /// <summary>The Segoe Fluent Icons glyph shown in the accent badge.</summary>
    public string IconGlyph
    {
        get => (string)GetValue(IconGlyphProperty);
        set => SetValue(IconGlyphProperty, value);
    }

    /// <summary>The accent name (cyan, green, purple, amber or red); unknown falls back to cyan.</summary>
    public string Accent
    {
        get => (string)GetValue(AccentProperty);
        set => SetValue(AccentProperty, value);
    }

    /// <summary>The card title (caller-supplied, already localized).</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>The secondary description (caller-supplied, already localized).</summary>
    public string Description
    {
        get => (string)GetValue(DescriptionProperty);
        set => SetValue(DescriptionProperty, value);
    }

    /// <summary>The content slot rendered below the header (native analogue of web <c>children</c>).</summary>
    public object? Body
    {
        get => GetValue(BodyProperty);
        set => SetValue(BodyProperty, value);
    }

    private static void OnModelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((ToolCard)d).ApplyModel();

    private static void OnBodyChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((ToolCard)d).ApplyBody();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void BuildVisualTree()
    {
        // GlassPanel p-5 (web) — TsGlassPanel default padding is 16; override to 20.
        _panel.Padding = new Thickness(TypographyTokens.Size("TsSpaceXl", 20));

        // Accent icon badge: 40x40, rounded-lg, tinted fill + ring, centered glyph (h-5 w-5).
        _iconBadge.Width = 40;
        _iconBadge.Height = 40;
        _iconBadge.CornerRadius = ResolveCorner("TsRadiusSm", 8);
        _iconBadge.BorderThickness = new Thickness(1);
        _iconBadge.HorizontalAlignment = HorizontalAlignment.Left;
        _iconBadge.VerticalAlignment = VerticalAlignment.Top;
        _icon.FontSize = 20;
        _icon.HorizontalAlignment = HorizontalAlignment.Center;
        _icon.VerticalAlignment = VerticalAlignment.Center;
        _iconBadge.Child = _icon;
        AutomationProperties.SetAccessibilityView(_iconBadge, AccessibilityView.Raw);

        // Title (text-sm / semibold / primary) + description (text-xs / secondary).
        _title.FontFamily = TypographyTokens.Sans;
        _title.FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14);
        _title.FontWeight = TypographyTokens.Weight(TypographyTokens.Size("TsTypeWeightSemibold", 600));
        _title.Foreground = TypographyTokens.Brush("TsColorTextPrimaryBrush");
        _description.FontFamily = TypographyTokens.Sans;
        _description.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        _description.Foreground = TypographyTokens.Brush("TsColorTextSecondaryBrush");
        _titleStack.VerticalAlignment = VerticalAlignment.Top;
        _titleStack.Children.Add(_title);
        _titleStack.Children.Add(_description);

        // Header row: [auto badge | * title] with a gap-3 (12) gutter, items-start.
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnSpacing = TypographyTokens.Size("TsSpaceMd", 12);
        Grid.SetColumn(_iconBadge, 0);
        Grid.SetColumn(_titleStack, 1);
        _header.Children.Add(_iconBadge);
        _header.Children.Add(_titleStack);

        // Root: header (mb-4 = 16 gutter) then the content slot.
        _root.Spacing = TypographyTokens.Size("TsSpaceLg", 16);
        _root.Children.Add(_header);
        _root.Children.Add(_bodyHost);

        _panel.Content = _root;
        Content = _panel;
    }

    private void ApplyModel()
    {
        var model = ToolCardModel.Create(Title, Description, IconGlyph, Accent);

        _icon.Glyph = model.IconGlyph;

        _title.Text = model.Title;
        _title.Visibility = model.HasTitle ? Visibility.Visible : Visibility.Collapsed;

        _description.Text = model.Description;
        _description.Visibility = model.HasDescription ? Visibility.Visible : Visibility.Collapsed;

        ApplyAccent(model.AccentBrushKey);
        AutomationProperties.SetName(this, model.AccessibilityName);
    }

    private void ApplyAccent(string brushKey)
    {
        var brush = TypographyTokens.Brush(brushKey);
        if (brush is null)
        {
            return;
        }

        _icon.Foreground = brush;
        if (brush is SolidColorBrush solid)
        {
            var c = solid.Color;
            _iconBadge.Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x1A, c.R, c.G, c.B));
            _iconBadge.BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x33, c.R, c.G, c.B));
        }
    }

    private void ApplyBody()
    {
        _bodyHost.Content = Body;
        _bodyHost.Visibility = Body is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private static CornerRadius ResolveCorner(string key, double fallback) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is CornerRadius corner
            ? corner
            : new CornerRadius(fallback);
}
