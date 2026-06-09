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

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>QuickNav</c> feature surface — a parity port of
/// web/src/features/dashboard/components/QuickNav.tsx. It reproduces the web's responsive grid
/// (<c>grid-cols-2 sm:grid-cols-4 gap-3</c>) of four navigation tiles (Drives, Charging, Analytics, Battery):
/// each tile is the web <c>&lt;Link&gt;</c> wrapping a <see cref="TsGlassPanel"/> (the native
/// <c>GlassPanel</c>) carrying the destination's accent-tinted Segoe Fluent glyph in a faint accent chip, the
/// localized title and description, and a trailing chevron — activating it navigates the shell to that page
/// through the injected <see cref="IQuickNavNavigator"/>. The surface is presentational: it has no data
/// source and no asynchronous reads, so it renders the tile grid directly (the web's single visual state); a
/// friendly empty surface renders in the defensive case where no tiles resolve, never a blank panel. All
/// projection flows through <see cref="QuickNavProjection"/>; the view never performs HTTP. The grid reflows
/// between two and four columns at the Tailwind <c>sm</c> breakpoint (<see cref="QuickNavLayout"/>) as the
/// surface is resized. Every string resolves through the i18n facade, every tile carries a Narrator name, and
/// the surface adds no custom motion — the tile button visual states are system-driven, so the reduced-motion
/// setting is honoured by construction.
/// </summary>
public sealed partial class QuickNav : ContentControl
{
    private const double IconChipPadding = 8;   // web `p-2`
    private const double TilePadding = 16;       // web `p-4`
    private const double Gap = 12;               // web `gap-3`
    private const double IconSize = 20;          // web `h-5 w-5`

    private readonly ILocalizer _localizer;
    private readonly IQuickNavNavigator _navigator;
    private readonly QuickNavDiagnostics _diagnostics;
    private readonly QuickNavDisplay _display;
    private readonly Grid _grid = new();
    private readonly List<Button> _tiles = new();

    private int _columns = -1;
    private bool _opened;

    /// <summary>Creates the surface over its item source, navigator, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The navigation entry source (the canonical catalog, or a test substitute).</param>
    /// <param name="navigator">The outbound navigation seam a tile activation drives.</param>
    /// <param name="localizer">The i18n facade every label and description resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QuickNav(
        IQuickNavItemSource source,
        IQuickNavNavigator navigator,
        ILocalizer localizer,
        QuickNavDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _navigator = navigator;
        _diagnostics = diagnostics ?? new QuickNavDiagnostics();
        _display = QuickNavProjection.Project(source.GetItems(), localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, QuickNavRegistration.GroupName(localizer));

        BuildGrid();
        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>QuickNav</c>).</summary>
    public static string Slug => QuickNavRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="QuickNavItemSource"/> (the web
    /// <c>NAV_ITEMS</c> catalog) over the host's navigator and localizer.
    /// </summary>
    public static QuickNav Create(
        IQuickNavNavigator navigator,
        ILocalizer localizer,
        QuickNavDiagnostics? diagnostics = null) =>
        new(new QuickNavItemSource(), navigator, localizer, diagnostics);

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

    private void Render()
    {
        Content = _display.State == QuickNavState.Empty ? BuildEmpty() : _grid;
    }

    private void BuildGrid()
    {
        _grid.ColumnSpacing = Gap;
        _grid.RowSpacing = Gap;
        _grid.VerticalAlignment = VerticalAlignment.Top;
        _grid.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_grid, QuickNavRegistration.GroupName(_localizer));

        foreach (var tile in _display.Tiles)
        {
            var button = BuildTile(tile);
            _tiles.Add(button);
            _grid.Children.Add(button);
        }

        ApplyColumns(ActualWidth);
    }

    // Reflow the existing tiles into the responsive column count (web `grid-cols-2 sm:grid-cols-4`).
    private void ApplyColumns(double width)
    {
        int columns = QuickNavLayout.ColumnsForWidth(width);
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

    private Button BuildTile(QuickNavTile tile)
    {
        var iconChip = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Background = AccentChip(tile.AccentBrushKey),
            Padding = new Thickness(IconChipPadding),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon
            {
                Glyph = tile.Glyph,
                FontSize = IconSize,
                Foreground = DisplayTokens.Brush(tile.AccentBrushKey),
            },
        };
        AutomationProperties.SetAccessibilityView(iconChip, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = tile.Label,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var description = new TextBlock
        {
            Text = tile.Description,
            FontSize = 10,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        var texts = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        texts.Children.Add(label);
        texts.Children.Add(description);

        var chevron = new FontIcon
        {
            Glyph = QuickNavProjection.ChevronGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        // web `flex items-center gap-3`: icon chip | flex-1 text | trailing chevron.
        var content = new Grid { ColumnSpacing = Gap, VerticalAlignment = VerticalAlignment.Center };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(iconChip, 0);
        Grid.SetColumn(texts, 1);
        Grid.SetColumn(chevron, 2);
        content.Children.Add(iconChip);
        content.Children.Add(texts);
        content.Children.Add(chevron);

        // web `GlassPanel hover className="p-4"`.
        var panel = new TsGlassPanel { Content = content, Padding = new Thickness(TilePadding) };

        // web `<Link>` wrapping the panel: a chromeless button supplies focus, keyboard activation and the
        // Narrator name while the TsGlassPanel renders the visible surface.
        var button = new Button
        {
            Content = panel,
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

        // web `group-hover:border-white/[0.12]` + the focus ring: lift the panel border to the tile accent
        // on hover/focus, restore the hairline border on exit/blur.
        button.PointerEntered += (_, _) => SetEmphasis(panel, tile.AccentBrushKey, true);
        button.PointerExited += (_, _) => SetEmphasis(panel, tile.AccentBrushKey, false);
        button.GotFocus += (_, _) => SetEmphasis(panel, tile.AccentBrushKey, true);
        button.LostFocus += (_, _) => SetEmphasis(panel, tile.AccentBrushKey, false);
        return button;
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
            IconGlyph = QuickNavProjection.ChevronGlyph,
            Message = QuickNavRegistration.EmptyMessage(_localizer),
            VerticalAlignment = VerticalAlignment.Center,
        };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return empty;
    }

    private static void SetEmphasis(TsGlassPanel panel, string accentBrushKey, bool emphasized) =>
        panel.BorderBrush = emphasized ? DisplayTokens.Brush(accentBrushKey) : DisplayTokens.Border;

    // web `bg-{color}/10`: the accent at low opacity for the icon chip fill.
    private static Brush AccentChip(string accentBrushKey)
    {
        var brush = DisplayTokens.Brush(accentBrushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = 0.12 }
            : brush;
    }

    // Neutralize the WinUI button chrome in every visual state so the hosted TsGlassPanel is the only
    // visible surface (the web `<Link>` contributes no box of its own).
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
