using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>VehiclePhotoGallery</c> feature surface — a parity port of
/// web/src/features/vehicles/components/VehiclePhotoGallery.tsx. It is a display-only "thin wrapper" around the
/// shared lightbox: assign a <see cref="Model"/> (the web <c>photos</c> + <c>vehicleName</c> props) and it renders one
/// of the web source's two conditional branches. <em>Empty</em> (<c>photos.length === 0</c>) shows a friendly
/// empty state — a picture glyph, the "No photos uploaded yet." heading and the muted "Photos uploaded for this
/// vehicle will appear here." helper line — via the shared <see cref="TsEmptyState"/> (the web dashed empty
/// card), never a blank box. <em>Populated</em> renders the web responsive grid (<c>grid-cols-2 sm:grid-cols-3
/// md:grid-cols-4</c>) of square thumbnails: each is a focusable, Narrator-named ghost <see cref="TsButton"/> (the web
/// <c>&lt;button&gt;</c>) hosting a corner-clipped <see cref="Image"/> (the web <c>&lt;img&gt;</c>), and selecting one
/// opens the shared <see cref="TsLightbox"/> (the web <c>Lightbox</c>) on that image. The grid reflows its column
/// count with the available width (the native idiom for the web's responsive breakpoints) instead of porting Tailwind
/// classes. Because the web source performs no fetching there is no loading / error / stale / offline branch to
/// reproduce — the only states are empty and populated. The view never performs HTTP; all branch selection, the
/// gallery's accessible name and every thumbnail label are computed in the WinUI-free
/// <see cref="VehiclePhotoGalleryProjection"/>. Entrances fade through <see cref="TsFadeIn"/> (honouring reduce-motion
/// via the shared motion controls), every label resolves through the i18n facade, decorative glyphs are hidden from
/// Narrator, and the surface carries a Narrator name in both states.
/// </summary>
public sealed partial class VehiclePhotoGallery : ContentControl
{
    private const string PhotoGlyph = "\uE91B";          // Segoe Fluent Icons — Photo2 (the web lucide Image icon)
    private const double GridSpacing = 12;                // web gap-3
    private const double ThumbnailCornerRadius = 8;       // web rounded-lg
    private const double ThumbnailBorderThickness = 1;    // web border
    private const double FallbackGlyphSize = 28;          // muted picture glyph for a source-less tile
    private const double ThreeColumnMinWidth = 480;       // web sm:grid-cols-3 breakpoint
    private const double FourColumnMinWidth = 640;        // web md:grid-cols-4 breakpoint
    private const int BaseColumns = 2;                    // web grid-cols-2 (base)
    private const string RootAutomationId = "vehicle-photo-gallery";       // web data-testid
    private const string ThumbAutomationIdPrefix = "vehicle-photo-thumb-"; // web data-testid

    private readonly ILocalizer _localizer;
    private readonly VehiclePhotoGalleryDiagnostics _diagnostics;

    private readonly Grid _root = new();
    private readonly Border _gridHost = new();
    private readonly TsLightbox _lightbox = new();

    private VehiclePhotoGalleryModel _model;
    private IReadOnlyList<VehiclePhotoGalleryItem> _items = Array.Empty<VehiclePhotoGalleryItem>();
    private int _columnBucket = -1;
    private bool _populated;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="VehiclePhotoGalleryModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public VehiclePhotoGallery(
        ILocalizer localizer,
        VehiclePhotoGalleryModel? model = null,
        VehiclePhotoGalleryDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? VehiclePhotoGalleryModel.Empty;
        _diagnostics = diagnostics ?? new VehiclePhotoGalleryDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, RootAutomationId);

        Content = _root;
        Loaded += OnLoaded;
        SizeChanged += OnSizeChanged;

        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>VehiclePhotoGallery</c>).</summary>
    public static string Slug => VehiclePhotoGalleryRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public VehiclePhotoGalleryModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void Render()
    {
        VehiclePhotoGalleryDisplay display = VehiclePhotoGalleryProjection.Project(_model, _localizer);
        AutomationProperties.SetName(this, display.AutomationName);

        _root.Children.Clear();

        if (display.IsEmpty)
        {
            _populated = false;
            _items = Array.Empty<VehiclePhotoGalleryItem>();
            _root.Children.Add(BuildEmpty(display));
            return;
        }

        // Populated: a faded-in responsive grid of thumbnails plus the (Popup-backed) shared lightbox overlay.
        _populated = true;
        _items = display.Items;
        _lightbox.CloseLabel = display.CloseLabel;
        AutomationProperties.SetName(_gridHost, display.GalleryLabel);

        _columnBucket = -1; // force a fresh layout for the current width
        RebuildGrid();

        _root.Children.Add(new TsFadeIn { Content = _gridHost });
        _root.Children.Add(_lightbox);
    }

    // ── Empty: the web dashed empty card (icon + "No photos uploaded yet." + helper line) ──────────────────
    private static TsFadeIn BuildEmpty(VehiclePhotoGalleryDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = PhotoGlyph,
            Title = display.EmptyTitle,
            Message = display.EmptyHelp,
        };

        return new TsFadeIn { Content = empty };
    }

    // ── Populated: the responsive thumbnail grid (web grid-cols-2 / sm:3 / md:4) ────────────────────────────
    private void RebuildGrid()
    {
        if (!_populated)
        {
            return;
        }

        int columns = ColumnsFor(AvailableWidth());
        if (columns == _columnBucket)
        {
            return;
        }

        _columnBucket = columns;
        _gridHost.Child = BuildGrid(columns);
    }

    private Grid BuildGrid(int columns)
    {
        var grid = new Grid { RowSpacing = GridSpacing, ColumnSpacing = GridSpacing };
        for (int c = 0; c < columns; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        int rows = (int)Math.Ceiling(_items.Count / (double)columns);
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < _items.Count; i++)
        {
            FrameworkElement tile = BuildThumbnail(_items[i]);
            Grid.SetRow(tile, i / columns);
            Grid.SetColumn(tile, i % columns);
            grid.Children.Add(tile);
        }

        return grid;
    }

    // ── One thumbnail: a focusable ghost button (web <button>) hosting a corner-clipped image (web <img>) ────
    private TsButton BuildThumbnail(VehiclePhotoGalleryItem item)
    {
        var tile = new Border
        {
            CornerRadius = new CornerRadius(ThumbnailCornerRadius),
            Background = DisplayTokens.Surface,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            Child = BuildTileContent(item),
        };

        // web `aspect-square`: keep the tile a square that tracks the (responsive) column width.
        tile.SizeChanged += OnTileSizeChanged;

        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Padding = new Thickness(0),
            CornerRadius = new CornerRadius(ThumbnailCornerRadius),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(ThumbnailBorderThickness),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
            Content = tile,
        };

        AutomationProperties.SetName(button, item.OpenLabel);
        AutomationProperties.SetAutomationId(button, ThumbAutomationIdPrefix + item.Index.ToString(System.Globalization.CultureInfo.InvariantCulture));
        button.Click += (_, _) => OpenLightbox(item);
        return button;
    }

    private static FrameworkElement BuildTileContent(VehiclePhotoGalleryItem item)
    {
        if (item.HasImage && TryCreateImageUri(item.Src, out Uri? uri))
        {
            var image = new Image
            {
                Source = new BitmapImage(uri),
                Stretch = Stretch.UniformToFill,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch,
            };

            // The alt text is announced by the owning button's Narrator name; the image itself is decorative.
            AutomationProperties.SetAccessibilityView(image, AccessibilityView.Raw);
            return image;
        }

        // Source-less tile: a muted picture glyph rather than a broken image (always show, never a blank box).
        var fallback = new FontIcon
        {
            Glyph = PhotoGlyph,
            FontSize = FallbackGlyphSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(fallback, AccessibilityView.Raw);
        return fallback;
    }

    private static void OnTileSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (sender is not Border tile)
        {
            return;
        }

        double side = e.NewSize.Width;
        if (side > 0 && Math.Abs(tile.Height - side) > 0.5)
        {
            tile.Height = side;
        }
    }

    private void OpenLightbox(VehiclePhotoGalleryItem item)
    {
        if (!item.HasImage || !TryCreateImageUri(item.Src, out Uri? uri))
        {
            return;
        }

        _lightbox.AltText = item.Alt;
        _lightbox.SourceUri = uri;
        _lightbox.IsOpen = true;
    }

    private static bool TryCreateImageUri(string src, out Uri? uri) =>
        Uri.TryCreate(src, UriKind.Absolute, out uri);

    private double AvailableWidth()
    {
        double width = ActualWidth > 0 ? ActualWidth : _root.ActualWidth;
        return Math.Max(0, width);
    }

    private static int ColumnsFor(double availableWidth)
    {
        if (availableWidth >= FourColumnMinWidth)
        {
            return 4;
        }

        return availableWidth >= ThreeColumnMinWidth ? 3 : BaseColumns;
    }

    private void OnSizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (_populated)
        {
            RebuildGrid();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new VehiclePhotoGalleryAutomationPeer(this);

    private sealed class VehiclePhotoGalleryAutomationPeer(VehiclePhotoGallery owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
