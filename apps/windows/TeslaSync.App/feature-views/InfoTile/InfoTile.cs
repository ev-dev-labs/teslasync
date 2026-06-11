using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>InfoTile</c> feature surface — a parity port of
/// web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx. It is a pure presentational tile: assign a
/// <see cref="Model"/> (the web <c>InfoTileProps</c>) and it renders the web layout — a tokenized
/// <see cref="TsGlassPanel"/> holding a muted icon + caption row above the bold value, with an optional muted
/// sub line beneath. The view never performs HTTP; the boolean-to-Yes/No resolution, the number formatting, the
/// icon / value-colour fallbacks and the composed Narrator name all happen in the WinUI-free
/// <see cref="InfoTileProjection"/>. The value text tints from the supplied design token (so light / dark /
/// high-contrast all flow from the token set) and trims with an ellipsis exactly as the web <c>truncate</c> does,
/// carrying the full value as a hover tooltip (web <c>title={String(display)}</c>). The decorative icon and the
/// individual text runs are hidden from Narrator and the surface carries a single composed Narrator name. The
/// fetch-driven loading / empty / error / stale / offline states belong to the parent telemetry panel (which owns
/// the queries and re-renders the tile with resolved props), exactly as the React parent does.
/// </summary>
public sealed partial class InfoTile : ContentControl
{
    private const double PanelPadding = 16;       // web p-4
    private const double HeaderSpacing = 8;       // web gap-2
    private const double HeaderBottomMargin = 6;  // web mb-1.5
    private const double SubTopMargin = 2;        // web mt-0.5
    private const double IconFontSize = 14;       // web h-3.5 w-3.5
    private const double LabelFontSize = 12;      // web text-xs
    private const double ValueFontSize = 18;      // web text-lg
    private const double SubFontSize = 10;        // web text-[10px]

    private readonly ILocalizer _localizer;
    private readonly InfoTileDiagnostics _diagnostics;

    private InfoTileModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the Yes / No boolean words resolve through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="InfoTileModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public InfoTile(
        ILocalizer localizer,
        InfoTileModel? model = null,
        InfoTileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? InfoTileModel.Empty;
        _diagnostics = diagnostics ?? new InfoTileDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>InfoTile</c>).</summary>
    public static string Slug => InfoTileRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public InfoTileModel Model
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
        InfoTileDisplay display = InfoTileProjection.Project(_model, _localizer);

        // Web `<GlassPanel className="p-4 overflow-hidden">` wrapping a vertical column: the icon + caption row,
        // the value, and the optional sub line.
        var column = new StackPanel();
        column.Children.Add(BuildHeader(display));
        column.Children.Add(BuildValue(display));

        if (display.ShowSub)
        {
            column.Children.Add(BuildSub(display));
        }

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = column,
        };

        AutomationProperties.SetName(this, display.AutomationName);
        Content = panel;
    }

    // Web `<div class="flex items-center gap-2 text-[var(--text-muted)] text-xs mb-1.5 min-w-0">`: the muted icon
    // beside the truncating caption.
    private static StackPanel BuildHeader(InfoTileDisplay display)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            Margin = new Thickness(0, 0, 0, HeaderBottomMargin),
        };

        var icon = new FontIcon
        {
            Glyph = display.IconGlyph,
            FontSize = IconFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        header.Children.Add(icon);

        var label = new TextBlock
        {
            Text = display.Label,
            FontSize = LabelFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);
        header.Children.Add(label);

        // Decorative — the surface's Narrator name already carries the caption and value.
        AutomationProperties.SetAccessibilityView(header, AccessibilityView.Raw);
        return header;
    }

    // Web `<p className={cn('text-lg font-semibold truncate', color)} title={String(display)}>`: the bold,
    // token-coloured value that trims with an ellipsis and exposes the full text on hover.
    private static TextBlock BuildValue(InfoTileDisplay display)
    {
        var value = new TextBlock
        {
            Text = display.Value,
            FontSize = ValueFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.Brush(display.ColorBrushKey),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        ToolTipService.SetToolTip(value, display.ValueTooltip);
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);
        return value;
    }

    // Web `{sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</p>}`: the muted sub line.
    private static TextBlock BuildSub(InfoTileDisplay display)
    {
        var sub = new TextBlock
        {
            Text = display.Sub,
            FontSize = SubFontSize,
            Foreground = DisplayTokens.TextMuted,
            Margin = new Thickness(0, SubTopMargin, 0, 0),
            TextTrimming = TextTrimming.CharacterEllipsis,
            TextWrapping = TextWrapping.NoWrap,
        };

        AutomationProperties.SetAccessibilityView(sub, AccessibilityView.Raw);
        return sub;
    }
}
