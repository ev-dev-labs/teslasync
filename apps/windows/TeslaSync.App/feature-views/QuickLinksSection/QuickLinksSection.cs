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
/// The native WinUI 3 <c>QuickLinksSection</c> feature surface — a parity port of
/// web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx. It reproduces the web's outer
/// <c>GlassPanel</c> (a chevron-led "Quick Links" header over a responsive tile grid,
/// <c>grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3</c>) of six destination tiles (Drives, Charging, Battery,
/// Climate, Efficiency, Settings): each tile is the web <c>&lt;Link&gt;</c> wrapping a hover/cyan-glow
/// <see cref="TsGlassPanel"/> (the native <c>GlassPanel</c>) carrying the destination's muted Segoe Fluent glyph
/// above its localized label, centred — activating it navigates the shell to that page through the injected
/// <see cref="IQuickLinksNavigator"/>. The surface is presentational: it has no data source and no asynchronous
/// reads, so it renders the tile grid directly (the web's single visual state); a friendly empty surface renders
/// in the defensive case where no tiles resolve, never a blank panel. All projection flows through
/// <see cref="QuickLinksProjection"/>; the view never performs HTTP. The grid reflows between two, three and six
/// columns at the Tailwind <c>sm</c> and <c>lg</c> breakpoints (<see cref="QuickLinksLayout"/>) as the surface is
/// resized. Every string resolves through the i18n facade, the surface and every tile carry a Narrator name, and
/// the surface adds no custom motion — the tile button visual states are system-driven, so the reduced-motion
/// setting is honoured by construction.
/// </summary>
public sealed partial class QuickLinksSection : ContentControl
{
    private const double PanelPadding = 24;      // web GlassPanel p-6
    private const double HeaderGap = 16;         // web mb-4 between header and the grid
    private const double HeaderIconSpacing = 8;  // web gap-2 between the chevron and the heading
    private const double HeaderIconSize = 16;    // web ChevronRight h-4 w-4
    private const double Gap = 12;               // web gap-3
    private const double TilePadding = 16;       // web p-4
    private const double TileSpacing = 8;        // web gap-2 between the tile icon and label
    private const double IconSize = 20;          // web h-5 w-5
    private const double LabelSize = 12;         // web text-xs

    // The TsGlassPanel cyan-glow border (web glow="cyan") and the brighter hover/focus accent (web hover).
    private const string CyanGlowBrushKey = "TsChartSpeedBrush";
    private const string CyanAccentBrushKey = "TsColorInfoBrush";

    private readonly ILocalizer _localizer;
    private readonly IQuickLinksNavigator _navigator;
    private readonly QuickLinksDiagnostics _diagnostics;
    private readonly QuickLinksDisplay _display;
    private readonly Grid _grid = new();
    private readonly List<Button> _tiles = new();

    private int _columns = -1;
    private bool _opened;

    /// <summary>Creates the surface over its item source, navigator, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The quick-link entry source (the canonical list, or a test substitute).</param>
    /// <param name="navigator">The outbound navigation seam a tile activation drives.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QuickLinksSection(
        IQuickLinksItemSource source,
        IQuickLinksNavigator navigator,
        ILocalizer localizer,
        QuickLinksDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _navigator = navigator;
        _diagnostics = diagnostics ?? new QuickLinksDiagnostics();
        _display = QuickLinksProjection.Project(source.GetItems(), localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, _display.Title);

        Content = BuildSurface();
        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;
        ApplyColumns(ActualWidth);
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>QuickLinksSection</c>).</summary>
    public static string Slug => QuickLinksRegistration.Slug;

    /// <summary>
    /// Convenience factory that wires the canonical <see cref="QuickLinksItemSource"/> (the web
    /// <c>quickLinks</c> list) over the host's navigator and localizer.
    /// </summary>
    public static QuickLinksSection Create(
        IQuickLinksNavigator navigator,
        ILocalizer localizer,
        QuickLinksDiagnostics? diagnostics = null) =>
        new(new QuickLinksItemSource(), navigator, localizer, diagnostics);

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

    // web: <GlassPanel className="p-6"><header/><grid/></GlassPanel> — the header is always shown; the content
    // region is the tile grid, or the defensive empty surface when no tiles resolve.
    private TsGlassPanel BuildSurface()
    {
        var column = new StackPanel { Spacing = HeaderGap };
        column.Children.Add(BuildHeader());
        column.Children.Add(_display.HasTiles ? BuildGrid() : BuildEmpty());

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    // web header: <div className="mb-4 flex items-center gap-2"><ChevronRight className="text-neon-cyan"/><span>…</span></div>
    private StackPanel BuildHeader()
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderIconSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var chevron = new FontIcon
        {
            Glyph = QuickLinksProjection.ChevronGlyph,
            FontSize = HeaderIconSize,
            Foreground = DisplayTokens.Brush(CyanAccentBrushKey), // web text-[var(--neon-cyan)]
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        header.Children.Add(chevron);
        header.Children.Add(new SectionTitle { Value = _display.Title, VerticalAlignment = VerticalAlignment.Center });
        return header;
    }

    // web grid: <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{quickLinks.map(...)}</div>
    private Grid BuildGrid()
    {
        _grid.ColumnSpacing = Gap;
        _grid.RowSpacing = Gap;
        _grid.HorizontalAlignment = HorizontalAlignment.Stretch;
        _grid.VerticalAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(_grid, _display.Title);

        foreach (var tile in _display.Tiles)
        {
            var button = BuildTile(tile);
            _tiles.Add(button);
            _grid.Children.Add(button);
        }

        ApplyColumns(ActualWidth);
        return _grid;
    }

    // Reflow the existing tiles into the responsive column count (web grid-cols-2 sm:grid-cols-3 lg:grid-cols-6).
    private void ApplyColumns(double width)
    {
        int columns = QuickLinksLayout.ColumnsForWidth(width);
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

    // web tile: <Link><GlassPanel hover glow="cyan" className="flex flex-col items-center gap-2 p-4 text-center">
    //   <Icon className="h-5 w-5 text-[var(--text-muted)]"/><span className="text-xs font-medium">{label}</span>
    // </GlassPanel></Link>
    private Button BuildTile(QuickLinkTile tile)
    {
        var icon = new FontIcon
        {
            Glyph = tile.Glyph,
            FontSize = IconSize,
            Foreground = DisplayTokens.TextMuted, // web text-[var(--text-muted)]
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var label = new TextBlock
        {
            Text = tile.Label,
            FontSize = LabelSize,
            FontWeight = FontWeights.Medium, // web font-medium
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        // web flex flex-col items-center gap-2 text-center.
        var stack = new StackPanel
        {
            Spacing = TileSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        stack.Children.Add(icon);
        stack.Children.Add(label);

        // web GlassPanel hover glow="cyan" className="p-4".
        var panel = new TsGlassPanel { Glow = GlassGlow.Cyan, Content = stack, Padding = new Thickness(TilePadding) };

        // web <Link> wrapping the panel: a chromeless button supplies focus, keyboard activation and the
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

        // web hover (cursor-pointer transition-all): brighten the cyan-glow border on hover/focus, restore on
        // exit/blur. A plain colour swap (no animation) so the reduced-motion setting is honoured.
        button.PointerEntered += (_, _) => SetEmphasis(panel, true);
        button.PointerExited += (_, _) => SetEmphasis(panel, false);
        button.GotFocus += (_, _) => SetEmphasis(panel, true);
        button.LostFocus += (_, _) => SetEmphasis(panel, false);
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
            IconGlyph = QuickLinksProjection.ChevronGlyph,
            Message = QuickLinksRegistration.EmptyMessage(_localizer),
            VerticalAlignment = VerticalAlignment.Center,
        };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return empty;
    }

    private static void SetEmphasis(TsGlassPanel panel, bool emphasized) =>
        panel.BorderBrush = DisplayTokens.Brush(emphasized ? CyanAccentBrushKey : CyanGlowBrushKey);

    // Neutralize the WinUI button chrome in every visual state so the hosted TsGlassPanel is the only visible
    // surface (the web <Link> contributes no box of its own).
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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new QuickLinksSectionAutomationPeer(this);

    private sealed class QuickLinksSectionAutomationPeer(QuickLinksSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
