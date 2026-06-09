using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>MiniGridPreview</c> feature surface — a parity port of
/// web/src/features/dashboard/components/MiniGridPreview.tsx. It renders a scaled-down thumbnail of a saved
/// dashboard's <c>lg</c> grid: a tokenized rounded container (web <c>bg-white/[0.02]</c> +
/// <c>border-white/[0.06]</c> + <c>rounded-lg</c>, clipped like web <c>overflow-hidden</c>) whose
/// width-to-height ratio is locked to <c>cols / safeMaxY</c> (web <c>aspectRatio</c>), holding one absolutely
/// positioned cell per placed widget (web <c>bg-white/[0.06]</c> + <c>border-white/[0.08]</c> +
/// <c>rounded-sm</c>) centred on the widget's catalog icon at 12px in the muted token (web <c>Icon</c> at
/// <c>h-3 w-3 text-[var(--text-muted)]</c>). The surface is purely presentational and fetches nothing, so —
/// like the web source — it has no loading / error / stale / offline branch; the only content states are
/// populated (cells laid out from the projection) and empty (a friendly centred stand-in, never a blank
/// box). All UI-free decisions (geometry, the icon join, copy resolution) live in
/// <see cref="MiniGridPreviewProjection"/> / <see cref="MiniGridWidgetIcons"/> so they are verified without a
/// UI host. The preview carries a single localized Narrator name; the decorative cells and glyphs are hidden
/// from Narrator, and the empty state announces through a polite live region.
/// </summary>
public sealed partial class MiniGridPreview : ContentControl
{
    private const double ContainerRadius = 8;     // web rounded-lg
    private const double TileRadius = 2;          // web rounded-sm
    private const double TilePadding = 2;         // web padding: '2px'
    private const double TileBorderThickness = 1; // web border
    private const double IconSize = 12;           // web h-3 w-3
    private const double EmptyIconSize = 24;
    private const double EmptySpacing = 8;
    private const double EmptyPadding = 12;
    private const double AspectEpsilon = 0.5;
    private const string GlassBrushKey = "TsColorSurfaceGlassBrush";

    private readonly ILocalizer _localizer;
    private readonly MiniGridPreviewDiagnostics _diagnostics;
    private readonly Border _container;
    private readonly Canvas _canvas = new();
    private readonly List<(FrameworkElement Element, MiniGridTile Tile)> _tiles = new();

    private MiniGridPreviewModel _model;
    private MiniGridPreviewDisplay _display;
    private FrameworkElement? _liveRegion;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the accessible name / empty caption resolve through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="MiniGridPreviewModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MiniGridPreview(
        ILocalizer localizer,
        MiniGridPreviewModel? model = null,
        MiniGridPreviewDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? MiniGridPreviewModel.Empty;
        _diagnostics = diagnostics ?? new MiniGridPreviewDiagnostics();
        _display = MiniGridPreviewProjection.Project(_model, _localizer);

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Top;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        _container = new Border
        {
            Background = DisplayTokens.Brush(GlassBrushKey),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(ContainerRadius),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Top,
        };
        _container.SizeChanged += OnContainerSizeChanged;

        Content = _container;
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>MiniGridPreview</c>).</summary>
    public static string Slug => MiniGridPreviewRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public MiniGridPreviewModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _display = MiniGridPreviewProjection.Project(_model, _localizer);
            Render();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_liveRegion is not null)
        {
            LiveRegion.Announce(_liveRegion);
        }

        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        _tiles.Clear();
        _canvas.Children.Clear();
        _liveRegion = null;

        AutomationProperties.SetName(this, _display.AutomationName);
        AutomationProperties.SetName(_container, _display.AutomationName);

        if (_display.IsEmpty)
        {
            // web renders an empty bordered box; we keep the box but never leave it blank.
            _container.Child = BuildEmpty();
        }
        else
        {
            foreach (var tile in _display.Tiles)
            {
                var element = BuildTile(tile);
                _tiles.Add((element, tile));
                _canvas.Children.Add(element);
            }

            _container.Child = _canvas;
        }

        if (_container.ActualWidth > 0)
        {
            ApplyLayout(_container.ActualWidth);
        }
    }

    // ── One cell: a tokenized rounded rectangle centred on its (decorative) widget glyph ─────────────────
    private static Border BuildTile(MiniGridTile tile)
    {
        var border = new Border
        {
            Background = DisplayTokens.Brush(GlassBrushKey),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(TileBorderThickness),
            CornerRadius = new CornerRadius(TileRadius),
            Padding = new Thickness(TilePadding),
        };

        if (tile.IconGlyph is { } glyph)
        {
            var icon = new FontIcon
            {
                Glyph = glyph,
                FontSize = IconSize,
                Foreground = DisplayTokens.TextMuted,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
            };

            // Decorative — the preview's single Narrator name carries the meaning (web aria-hidden).
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            border.Child = icon;
        }

        AutomationProperties.SetAccessibilityView(border, AccessibilityView.Raw);
        return border;
    }

    // ── Empty state: a centred glyph + localized caption, announced politely (never a blank box) ─────────
    private StackPanel BuildEmpty()
    {
        var stack = new StackPanel
        {
            Orientation = Orientation.Vertical,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = EmptySpacing,
            Padding = new Thickness(EmptyPadding),
        };

        var icon = new FontIcon
        {
            Glyph = MiniGridPreviewRegistration.EmptyGlyph,
            FontSize = EmptyIconSize,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        stack.Children.Add(icon);

        stack.Children.Add(new TextBlock
        {
            Text = _display.EmptyMessage,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        });

        AutomationProperties.SetName(stack, _display.EmptyMessage);
        LiveRegion.Configure(stack);
        _liveRegion = stack;
        return stack;
    }

    private void OnContainerSizeChanged(object sender, SizeChangedEventArgs e) => ApplyLayout(e.NewSize.Width);

    // Lock the container to the web aspect ratio (width : height = cols : safeMaxY) and position every cell
    // from its 0..1 fractions against the rendered size, clipping to the bounds (web overflow-hidden).
    private void ApplyLayout(double width)
    {
        if (width <= 0 || double.IsNaN(width) || double.IsInfinity(width))
        {
            return;
        }

        double height = width * _display.RowSpan / _display.Columns;
        if (double.IsNaN(_container.Height) || Math.Abs(_container.Height - height) > AspectEpsilon)
        {
            _container.Height = height; // re-fires SizeChanged; the epsilon guard prevents a feedback loop
        }

        _canvas.Clip = new RectangleGeometry { Rect = new Rect(0, 0, width, height) };

        foreach (var (element, tile) in _tiles)
        {
            Canvas.SetLeft(element, tile.LeftFraction * width);
            Canvas.SetTop(element, tile.TopFraction * height);
            element.Width = Math.Max(0, tile.WidthFraction * width);
            element.Height = Math.Max(0, tile.HeightFraction * height);
        }
    }
}
