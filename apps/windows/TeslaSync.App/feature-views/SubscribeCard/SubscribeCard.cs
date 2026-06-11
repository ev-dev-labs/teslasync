using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>SubscribeCard</c> feature surface — a parity port of
/// web/src/features/system/components/status/SubscribeCard.tsx. It reproduces the web discoverability tile on
/// /system-status: a translucent <see cref="TsGlassPanel"/> (the web <c>GlassPanel</c>) headed by an accent bell
/// glyph and the "Get notified about incidents" heading, a muted self-hosted sub-line, and the web responsive
/// grid (<c>grid-cols-1 sm:grid-cols-2 gap-2</c>) of five channel tiles (Email, Slack, Discord, Webhook, Browser
/// push). Each tile is the web <c>&lt;Link&gt;</c> wrapping a bordered row carrying the channel's cyan accent
/// glyph, the localized label and a muted description; activating it navigates the shell to that destination
/// through the injected <see cref="ISubscribeCardNavigator"/>. The surface is presentational: it has no data
/// source and no asynchronous reads, so it renders the tile grid directly (the web's single visual state); a
/// friendly empty surface renders in the defensive case where no channels resolve, never a blank panel — there
/// is deliberately no loading / error / stale / offline branch because the web source has none. All projection
/// flows through <see cref="SubscribeCardProjection"/>; the view never performs HTTP. The grid reflows between
/// one and two columns at the Tailwind <c>sm</c> breakpoint (<see cref="SubscribeCardLayout"/>) as the surface is
/// resized. Every string resolves through the i18n facade, the heading carries the surface Narrator name, every
/// tile exposes a label-plus-description Narrator name, the accent glyphs are hidden from Narrator, and the
/// surface adds no custom motion — the tile interaction visuals are system-driven, so the reduced-motion setting
/// is honoured by construction and the font sizes scale with the system text-scaling setting.
/// </summary>
public sealed partial class SubscribeCard : ContentControl
{
    private const double PanelPadding = 12;       // web GlassPanel p-3
    private const double HeaderSpacing = 8;        // web header gap-2 (bell -> heading)
    private const double HeaderInset = 8;          // web header/sub-line px-2
    private const double HeaderBottom = 8;         // web header pb-2
    private const double SubtitleBottom = 12;      // web sub-line pb-3
    private const double GridGap = 8;              // web grid gap-2
    private const double TileCornerRadius = 8;     // web tile rounded-lg
    private const double TileBorderThickness = 1;  // web tile border
    private const double TilePaddingH = 12;        // web tile px-3
    private const double TilePaddingV = 10;        // web tile py-2.5
    private const double TileIconTextGap = 12;     // web tile gap-3 (icon -> text)
    private const double IconSize = 16;            // web icon h-4 w-4
    private const double IconTopMargin = 2;        // web icon mt-0.5

    // web tile fill `bg-white/[0.02]` resting -> `bg-white/[0.05]` hover/focus: a faint scrim derived from the
    // themed border token so it stays visible in light, dark and high-contrast (a white wash in dark, a dark
    // wash in light) and is always a touch lighter than the hosting glass panel.
    private const byte RestingScrimAlpha = 8;
    private const byte EmphasisScrimAlpha = 16;

    // web icon `text-cyan-300` and focus ring `ring-cyan-400/50`: the semantic cyan (info) token.
    private const string CyanAccentKey = "TsColorInfoBrush";

    private readonly ILocalizer _localizer;
    private readonly ISubscribeCardNavigator _navigator;
    private readonly SubscribeCardDiagnostics _diagnostics;
    private readonly SubscribeCardDisplay _display;
    private readonly Grid _grid = new();
    private readonly List<Button> _tiles = new();

    private int _columns = -1;
    private bool _opened;

    /// <summary>Creates the surface over its channel source, navigator, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The channel entry source (the canonical catalog, or a test substitute).</param>
    /// <param name="navigator">The outbound navigation seam a tile activation drives.</param>
    /// <param name="localizer">The i18n facade every label, description and heading resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SubscribeCard(
        ISubscribeCardChannelSource source,
        ISubscribeCardNavigator navigator,
        ILocalizer localizer,
        SubscribeCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _navigator = navigator;
        _diagnostics = diagnostics ?? new SubscribeCardDiagnostics();
        _display = SubscribeCardProjection.Project(source.GetChannels(), localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, SubscribeCardRegistration.Title(localizer));

        Content = BuildChrome();
        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SubscribeCard</c>).</summary>
    public static string Slug => SubscribeCardRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="SubscribeCardChannelSource"/> (the web five
    /// <c>ChannelTile</c>s) over the host's navigator and localizer.
    /// </summary>
    public static SubscribeCard Create(
        ISubscribeCardNavigator navigator,
        ILocalizer localizer,
        SubscribeCardDiagnostics? diagnostics = null) =>
        new(new SubscribeCardChannelSource(), navigator, localizer, diagnostics);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e) => ApplyColumns(e.NewSize.Width);

    private TsGlassPanel BuildChrome()
    {
        var column = new StackPanel { HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildSubtitle());
        column.Children.Add(_display.State == SubscribeCardState.Empty ? BuildEmpty() : BuildGrid());

        return new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = column,
        };
    }

    // web `<h3 className="px-2 pb-2 text-sm font-semibold inline-flex items-center gap-2"><Bell/>…</h3>`.
    private StackPanel BuildHeader()
    {
        var bell = new FontIcon
        {
            Glyph = SubscribeCardRegistration.BellGlyph,
            FontSize = IconSize,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.TextPrimary,
        };
        AutomationProperties.SetAccessibilityView(bell, AccessibilityView.Raw);

        var title = new TextBlock
        {
            Text = SubscribeCardRegistration.Title(_localizer),
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            Margin = new Thickness(HeaderInset, 0, HeaderInset, HeaderBottom),
        };
        header.Children.Add(bell);
        header.Children.Add(title);
        return header;
    }

    // web `<p className="px-2 pb-3 text-xs text-[var(--text-muted)]">…</p>`.
    private TextBlock BuildSubtitle() => new()
    {
        Text = SubscribeCardRegistration.Subtitle(_localizer),
        FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(HeaderInset, 0, HeaderInset, SubtitleBottom),
    };

    // web `<div className="grid grid-cols-1 sm:grid-cols-2 gap-2">…</div>`.
    private Grid BuildGrid()
    {
        _grid.ColumnSpacing = GridGap;
        _grid.RowSpacing = GridGap;
        _grid.HorizontalAlignment = HorizontalAlignment.Stretch;

        foreach (var tile in _display.Tiles)
        {
            var button = BuildTile(tile);
            _tiles.Add(button);
            _grid.Children.Add(button);
        }

        ApplyColumns(ActualWidth);
        return _grid;
    }

    // Reflow the existing tiles into the responsive column count (web `grid-cols-1 sm:grid-cols-2`).
    private void ApplyColumns(double width)
    {
        int columns = SubscribeCardLayout.ColumnsForWidth(width);
        if (columns == _columns || _tiles.Count == 0)
        {
            return;
        }

        _columns = columns;
        int rows = (_tiles.Count + columns - 1) / columns;

        _grid.ColumnDefinitions.Clear();
        _grid.RowDefinitions.Clear();
        for (int c = 0; c < columns; c++)
        {
            _grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < rows; r++)
        {
            _grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < _tiles.Count; i++)
        {
            Grid.SetColumn(_tiles[i], i % columns);
            Grid.SetRow(_tiles[i], i / columns);
        }
    }

    // web `<Link className="flex items-start gap-3 rounded-lg border bg-white/[0.02] px-3 py-2.5 text-left …">`.
    private Button BuildTile(SubscribeCardTile tile)
    {
        var icon = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.Brush(CyanAccentKey),
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, IconTopMargin, 0, 0), // web mt-0.5
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = tile.Label,
            FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };

        var description = new TextBlock
        {
            Text = tile.Description,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        };

        var texts = new StackPanel { VerticalAlignment = VerticalAlignment.Top };
        texts.Children.Add(label);
        texts.Children.Add(description);

        // web `flex items-start gap-3`: accent icon | flex-1 min-w-0 text column.
        var content = new Grid { ColumnSpacing = TileIconTextGap };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(icon, 0);
        Grid.SetColumn(texts, 1);
        content.Children.Add(icon);
        content.Children.Add(texts);

        var surface = new Border
        {
            CornerRadius = new CornerRadius(TileCornerRadius),
            BorderThickness = new Thickness(TileBorderThickness),
            BorderBrush = DisplayTokens.Border,
            Background = TileScrim(emphasized: false),
            Padding = new Thickness(TilePaddingH, TilePaddingV, TilePaddingH, TilePaddingV),
            Child = content,
        };

        // web `<Link>` wrapping the row: a chromeless button supplies focus, keyboard activation and the
        // Narrator name while the bordered Border renders the visible surface.
        var button = new Button
        {
            Content = surface,
            Padding = new Thickness(0),
            BorderThickness = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
            DataContext = tile.RouteName,
        };
        MakeChromeless(button);
        AutomationProperties.SetName(button, tile.AutomationName);
        button.Click += OnTileClick;
        WireTileInteraction(button, surface);
        return button;
    }

    // web `hover:bg-white/[0.05]` + `focus-visible:ring-2 ring-cyan-400/50`: lighten the scrim on hover/focus and
    // raise the border to the cyan accent on focus (the focus ring), restoring the resting visuals on exit/blur.
    private static void WireTileInteraction(Button button, Border surface)
    {
        bool hovered = false;
        bool focused = false;

        void Apply()
        {
            surface.Background = TileScrim(hovered || focused);
            surface.BorderBrush = focused ? DisplayTokens.Brush(CyanAccentKey) : DisplayTokens.Border;
        }

        button.PointerEntered += (_, _) =>
        {
            hovered = true;
            Apply();
        };
        button.PointerExited += (_, _) =>
        {
            hovered = false;
            Apply();
        };
        button.GotFocus += (_, _) =>
        {
            focused = true;
            Apply();
        };
        button.LostFocus += (_, _) =>
        {
            focused = false;
            Apply();
        };
    }

    private void OnTileClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { DataContext: string routeName } && !string.IsNullOrEmpty(routeName))
        {
            _diagnostics.RecordNavigated();
            _navigator.Navigate(routeName);
        }
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = SubscribeCardRegistration.BellGlyph,
            Message = SubscribeCardRegistration.EmptyMessage(_localizer),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return empty;
    }

    // web tile fill: a faint themed-foreground wash, a touch stronger on hover/focus (web white/[0.02] -> [0.05]).
    private static SolidColorBrush TileScrim(bool emphasized)
    {
        byte alpha = emphasized ? EmphasisScrimAlpha : RestingScrimAlpha;
        if (DisplayTokens.Border is SolidColorBrush solid && solid.Color.A != 0)
        {
            Color c = solid.Color;
            return new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B));
        }

        return new SolidColorBrush(Color.FromArgb(alpha, 255, 255, 255));
    }

    // Neutralize the WinUI button chrome in every visual state so the hosted bordered Border is the only visible
    // surface (the web `<Link>` contributes no box of its own).
    private static void MakeChromeless(Button button)
    {
        var transparent = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        string[] brushKeys =
        {
            "ButtonBackground", "ButtonBackgroundPointerOver", "ButtonBackgroundPressed", "ButtonBackgroundDisabled",
            "ButtonBorderBrush", "ButtonBorderBrushPointerOver", "ButtonBorderBrushPressed", "ButtonBorderBrushDisabled",
        };
        foreach (var key in brushKeys)
        {
            button.Resources[key] = transparent;
        }
    }
}
