using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Commands;

/// <summary>
/// The native WinUI 3 <c>CommandTile</c> feature surface — a parity port of
/// web/src/features/system/components/CommandTile.tsx. It is a pure presentational tile: assign a
/// <see cref="Model"/> (the web <c>CommandTileProps</c>) and it renders the web layout — a clickable glass
/// surface holding a tokenized icon chip (the per-command glyph, replaced by a busy spinner while
/// <c>loading</c>), the centred command label, an optional sublabel and an optional colour-coded last-status
/// caption, with the favorite <see cref="TsButton"/> overlaid top-left (the filled amber star when pinned,
/// the muted outline otherwise) and the decorative dangerous mark top-right. The view never performs HTTP;
/// the label/sublabel resolution, the last-status success/failure colouring, the variant hover accent, the
/// favorite glyph/brush and the click <see cref="CommandTileActivation"/> all happen in the WinUI-free
/// <see cref="CommandTileProjection"/>. Activating the tile raises <see cref="ExecuteRequested"/> (a direct
/// command) or <see cref="DialogRequested"/> (a dangerous command, the web <c>onRequestDialog</c>); a
/// loading tile is a no-op. Toggling the star raises <see cref="FavoriteToggleRequested"/>. Every string
/// resolves through the i18n facade, the icon chip / dangerous mark / spinner are hidden from Narrator, the
/// tile carries the command label as its Narrator name and the favorite control carries the localized
/// "Toggle favorite" label. The fetch-driven empty / error / stale / offline states belong to the parent
/// command-center surface (which owns the queries and re-renders the tile with resolved props), exactly as
/// the React parent does.
/// </summary>
public sealed partial class CommandTile : ContentControl
{
    private const double TileGap = 8;          // web gap-2
    private const double TilePadding = 16;     // web p-4
    private const double TileMinHeight = 100;  // web min-h-[100px]
    private const double TileCornerRadius = 12; // web GlassPanel rounding
    private const double TileBorderThickness = 1;
    private const double ChipPadding = 10;     // web p-2.5
    private const double ChipCornerRadius = 12; // web rounded-xl
    private const double IconFontSize = 20;    // web h-5 w-5
    private const double SpinnerSize = 20;     // web Loader2 h-5 w-5
    private const double LabelFontSize = 12;   // web text-xs
    private const double SublabelFontSize = 10; // web text-[10px]
    private const double StatusFontSize = 9;   // web text-[9px]
    private const double CornerMargin = 6;     // web left/right/top-1.5
    private const double DangerFontSize = 12;  // web h-3 w-3
    private const double LoadingOpacity = 0.5; // web opacity-50

    private const string GlassBrushKey = "TsColorSurfaceGlassBrush"; // web GlassPanel surface
    private const string ChipBrushKey = "TsColorSurfaceBrush";       // web bg-[var(--surface-2)]

    private readonly ILocalizer _localizer;
    private readonly CommandTileDiagnostics _diagnostics;

    private CommandTileModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="CommandTileModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CommandTile(
        ILocalizer localizer,
        CommandTileModel? model = null,
        CommandTileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? CommandTileModel.Empty;
        _diagnostics = diagnostics ?? new CommandTileDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when a non-dangerous tile is activated (web <c>onExecute(def.command, def.params)</c>).</summary>
    public event EventHandler<CommandTileCommandEventArgs>? ExecuteRequested;

    /// <summary>Raised when a dangerous tile is activated and a dialog must open (web <c>onRequestDialog(def)</c>).</summary>
    public event EventHandler<CommandTileCommandEventArgs>? DialogRequested;

    /// <summary>Raised when the favorite star is toggled (web <c>onToggleFavorite()</c>).</summary>
    public event EventHandler? FavoriteToggleRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>CommandTile</c>).</summary>
    public static string Slug => CommandTileRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public CommandTileModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
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

    private void Render()
    {
        CommandTileDisplay display = CommandTileProjection.Project(_model, _localizer);

        // Web: a single relative GlassPanel with the favorite button and dangerous mark absolutely
        // positioned over it — a single-cell Grid with the clickable tile filling it and the two corner
        // affordances overlaid on top.
        var root = new Grid { Opacity = display.ShowSpinner ? LoadingOpacity : 1.0 };
        root.Children.Add(BuildTile(display));
        root.Children.Add(BuildFavoriteButton(display));

        if (display.ShowDanger)
        {
            root.Children.Add(BuildDangerMark());
        }

        Content = root;
    }

    // ── The clickable glass tile (web GlassPanel onClick) ─────────────────────────────────────────────
    private Button BuildTile(CommandTileDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = TileGap,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(BuildIconChip(display));
        column.Children.Add(BuildLabel(display));

        if (display.ShowSublabel)
        {
            column.Children.Add(BuildSublabel(display));
        }

        if (display.ShowLastStatus)
        {
            column.Children.Add(BuildLastStatus(display));
        }

        var tile = new Button
        {
            Content = column,
            BorderThickness = new Thickness(TileBorderThickness),
            CornerRadius = new CornerRadius(TileCornerRadius),
            Padding = new Thickness(TilePadding),
            MinHeight = TileMinHeight,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
        };

        // Drive every Button visual state from the glass surface + variant accent so the tile keeps its
        // translucent background and only tints its border on pointer-over / pressed (web hover:border-…).
        Brush glass = DisplayTokens.Brush(GlassBrushKey);
        Brush accent = DisplayTokens.Brush(display.VariantAccentBrushKey);
        tile.Resources["ButtonBackground"] = glass;
        tile.Resources["ButtonBackgroundPointerOver"] = glass;
        tile.Resources["ButtonBackgroundPressed"] = glass;
        tile.Resources["ButtonBackgroundDisabled"] = glass;
        tile.Resources["ButtonBorderBrush"] = DisplayTokens.Border;
        tile.Resources["ButtonBorderBrushPointerOver"] = accent;
        tile.Resources["ButtonBorderBrushPressed"] = accent;

        AutomationProperties.SetName(tile, display.AutomationName);
        tile.Click += OnTileClick;
        return tile;
    }

    private static Border BuildIconChip(CommandTileDisplay display)
    {
        FrameworkElement inner = display.ShowSpinner
            ? new ProgressRing { IsActive = true, Width = SpinnerSize, Height = SpinnerSize }
            : new FontIcon
            {
                Glyph = display.IconGlyph,
                FontSize = IconFontSize,
                Foreground = DisplayTokens.TextMuted,
            };

        var chip = new Border
        {
            Background = DisplayTokens.Brush(ChipBrushKey),
            CornerRadius = new CornerRadius(ChipCornerRadius),
            Padding = new Thickness(ChipPadding),
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = inner,
        };

        // Decorative — the tile's Narrator name carries the command label, and the spinner's busy state is
        // conveyed by the surrounding command-center surface.
        AutomationProperties.SetAccessibilityView(chip, AccessibilityView.Raw);
        return chip;
    }

    private static TextBlock BuildLabel(CommandTileDisplay display) => new()
    {
        Text = display.Label,
        FontSize = LabelFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextPrimary,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock BuildSublabel(CommandTileDisplay display) => new()
    {
        Text = display.Sublabel,
        FontSize = SublabelFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextMuted,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock BuildLastStatus(CommandTileDisplay display) => new()
    {
        Text = display.LastStatus,
        FontSize = StatusFontSize,
        Foreground = DisplayTokens.Brush(display.LastStatusBrushKey),
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
        TextWrapping = TextWrapping.Wrap,
    };

    // ── Favorite toggle (web ControlButton variant="ghost" with the Star icon) ────────────────────────
    private TsButton BuildFavoriteButton(CommandTileDisplay display)
    {
        var favorite = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = display.FavoriteGlyph,
            Foreground = DisplayTokens.Brush(display.FavoriteBrushKey),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(CornerMargin),
        };

        AutomationProperties.SetName(favorite, display.FavoriteToggleLabel);
        favorite.Click += OnFavoriteClick;
        return favorite;
    }

    // ── Dangerous mark (web AlertTriangle, decorative) ────────────────────────────────────────────────
    private static FontIcon BuildDangerMark()
    {
        var mark = new FontIcon
        {
            Glyph = CommandTileRegistration.DangerGlyph,
            FontSize = DangerFontSize,
            Foreground = DisplayTokens.Brush(CommandTileProjection.DangerBrushKey),
            Opacity = LoadingOpacity, // web text-neon-red/50
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(CornerMargin),
        };

        AutomationProperties.SetAccessibilityView(mark, AccessibilityView.Raw);
        return mark;
    }

    private void OnTileClick(object sender, RoutedEventArgs e)
    {
        switch (CommandTileProjection.ActivationOf(_model))
        {
            case CommandTileActivation.Execute:
                ExecuteRequested?.Invoke(this, new CommandTileCommandEventArgs(_model.Command, _model.Params));
                break;
            case CommandTileActivation.Dialog:
                DialogRequested?.Invoke(this, new CommandTileCommandEventArgs(_model.Command, _model.Params));
                break;
            default:
                // Loading — the click is a no-op (web `if (loading) return`).
                break;
        }
    }

    private void OnFavoriteClick(object sender, RoutedEventArgs e) =>
        FavoriteToggleRequested?.Invoke(this, EventArgs.Empty);
}
