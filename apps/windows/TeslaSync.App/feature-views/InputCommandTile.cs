using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>InputCommandTile</c> feature surface — a parity port of
/// web/src/features/system/components/InputCommandTile.tsx. It is the Vehicle-Commands grid tile: a tokenized
/// glass card carrying a command icon badge, the command label, an optional sublabel and an optional
/// last-command status caption, with a favorite-toggle star pinned to the top-left. The whole card is the
/// click target (the native analogue of the web clickable <c>GlassPanel</c>): activating it raises
/// <see cref="DialogRequested"/> (web <c>onRequestDialog(def)</c>) unless a command dispatch is already in
/// flight, in which case the icon swaps for a busy indicator, the card dims and the click is suppressed (web
/// <c>loading</c>). The star raises <see cref="FavoriteToggled"/> (web <c>onToggleFavorite</c>) — a separate,
/// always-reachable control so it stays keyboard- and Narrator-accessible (the web hides it behind
/// <c>opacity-0 group-hover</c>, which is not discoverable for assistive tech). The variant tints the card's
/// hover / focus border (web <c>hoverStyles</c>: default → cyan, danger → red, success → green). The web
/// source's only data dependency is <c>useTranslation</c>, so — like the sibling <c>ToolCard</c> /
/// <c>HighlightCard</c> / <c>AddWidgetButton</c> ports — there is no fetch-driven empty / error / stale /
/// offline branch; the single lifecycle branch is the in-flight <see cref="InputCommandTileState.Loading"/>.
/// The view performs no HTTP and owns no business logic: all branch selection, tone, accent and copy
/// resolution happen in the WinUI-free <see cref="InputCommandTileProjection"/>. Every string resolves through
/// the i18n facade, both interactive elements carry a Narrator name, the decorative icon is hidden from
/// Narrator, the status caption is a polite live region so command results are announced, and the surface adds
/// no bespoke looping motion (the busy ring is the system progress indicator), so reduced-motion preferences
/// are honoured by construction.
/// </summary>
public sealed partial class InputCommandTile : ContentControl
{
    private const double CardMinHeight = 100;     // web min-h-[100px]
    private const double CardPadding = 16;        // web p-4
    private const double CardCornerRadius = 12;   // web rounded-xl
    private const double ContentSpacing = 8;      // web gap-2
    private const double TextSpacing = 2;         // web gap inside the text block
    private const double IconBoxPadding = 10;     // web p-2.5
    private const double IconBoxCornerRadius = 12; // web rounded-xl
    private const double IconFontSize = 20;       // web icon h-5 w-5
    private const double FavoriteIconSize = 14;   // web star h-3 w-3 (bumped slightly for a Windows-min target)
    private const double FavoriteMargin = 6;      // web left-1.5 top-1.5
    private const double LabelFontSize = 12;      // web text-xs
    private const double SublabelFontSize = 10;   // web text-[10px]
    private const double StatusFontSize = 9;      // web text-[9px]
    private const double LoadingOpacity = 0.5;    // web opacity-50
    private const byte HoverBorderAlpha = 0x4D;   // web /30 hover-border opacity (~30%)

    private readonly ILocalizer _localizer;
    private readonly InputCommandTileDiagnostics _diagnostics;

    private readonly Button _tile = new();
    private readonly TsGlassPanel _panel = new();
    private readonly Grid _inner = new();
    private readonly StackPanel _content = new();
    private readonly Border _iconBox = new();
    private readonly FontIcon _icon = new();
    private readonly StackPanel _texts = new();
    private readonly TextBlock _label = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center };
    private readonly TextBlock _sublabel = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center };
    private readonly TextBlock _status = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center };
    private readonly TsButton _favorite = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small };
    private readonly FontIcon _favoriteIcon = new() { FontSize = FavoriteIconSize };

    private InputCommandTileModel _model;
    private InputCommandTileDisplay _display;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="InputCommandTileModel.Idle"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the operational events.</param>
    public InputCommandTile(
        ILocalizer localizer,
        InputCommandTileModel? model = null,
        InputCommandTileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? InputCommandTileModel.Idle;
        _diagnostics = diagnostics ?? new InputCommandTileDiagnostics();
        _display = InputCommandTileProjection.Project(_model, _localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildVisualTree();
        Loaded += OnLoaded;
        ApplyDisplay();
    }

    /// <summary>Raised when the tile is activated — the native analogue of the web <c>onRequestDialog(def)</c>.</summary>
    public event EventHandler? DialogRequested;

    /// <summary>Raised when the favorite star is activated — the native analogue of the web <c>onToggleFavorite</c>.</summary>
    public event EventHandler? FavoriteToggled;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>InputCommandTile</c>).</summary>
    public static string Slug => InputCommandTileRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public InputCommandTileModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _display = InputCommandTileProjection.Project(_model, _localizer);
            ApplyDisplay();
        }
    }

    private void BuildVisualTree()
    {
        // Glass card visual (web GlassPanel). The card lives inside a chrome-less Button so the whole surface is
        // a single focusable, Narrator-announced, keyboard-invokable command — while the card Border below stays
        // fully under our control for the variant hover / focus accent.
        _panel.MinHeight = CardMinHeight;
        _panel.Padding = new Thickness(CardPadding);
        _panel.BorderBrush = DisplayTokens.Border;

        // Accent icon badge (web rounded-xl p-2.5 bg surface-2): a tinted box holding the command glyph or the
        // in-flight busy ring.
        _iconBox.CornerRadius = new CornerRadius(IconBoxCornerRadius);
        _iconBox.Padding = new Thickness(IconBoxPadding);
        _iconBox.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _iconBox.HorizontalAlignment = HorizontalAlignment.Center;
        _icon.FontSize = IconFontSize;
        _icon.Foreground = DisplayTokens.TextMuted;
        _icon.HorizontalAlignment = HorizontalAlignment.Center;
        _icon.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_iconBox, AccessibilityView.Raw);

        // Label (web text-xs medium primary), sublabel (web text-[10px] muted) and last-command status (web
        // text-[9px], success/danger tinted). The status is a polite live region so a result change is announced.
        _label.FontSize = LabelFontSize;
        _label.FontWeight = FontWeights.Medium;
        _label.Foreground = DisplayTokens.TextPrimary;
        _sublabel.FontSize = SublabelFontSize;
        _sublabel.FontWeight = FontWeights.Medium;
        _sublabel.Foreground = DisplayTokens.TextMuted;
        _sublabel.Margin = new Thickness(0, TextSpacing, 0, 0);
        _status.FontSize = StatusFontSize;
        _status.Margin = new Thickness(0, TextSpacing, 0, 0);
        LiveRegion.Configure(_status);

        _texts.HorizontalAlignment = HorizontalAlignment.Center;
        _texts.Children.Add(_label);
        _texts.Children.Add(_sublabel);
        _texts.Children.Add(_status);

        // Centered content column (web flex-col items-center justify-center gap-2).
        _content.Spacing = ContentSpacing;
        _content.HorizontalAlignment = HorizontalAlignment.Center;
        _content.VerticalAlignment = VerticalAlignment.Center;
        _iconBox.Child = _icon;
        _content.Children.Add(_iconBox);
        _content.Children.Add(_texts);

        // Favorite star (web ghost Button, top-left). A separate, always-reachable control rather than a
        // hover-revealed one, so it stays keyboard- and Narrator-accessible.
        _favorite.HorizontalAlignment = HorizontalAlignment.Left;
        _favorite.VerticalAlignment = VerticalAlignment.Top;
        _favorite.Margin = new Thickness(FavoriteMargin);
        _favorite.Padding = new Thickness(2);
        AutomationProperties.SetAccessibilityView(_favoriteIcon, AccessibilityView.Raw);
        _favorite.Content = _favoriteIcon;
        _favorite.Click += OnFavoriteClick;

        _inner.Children.Add(_content);
        _inner.Children.Add(_favorite);
        _panel.Content = _inner;

        // Chrome-less click target hosting the glass card.
        _tile.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);
        _tile.BorderThickness = new Thickness(0);
        _tile.Padding = new Thickness(0);
        _tile.CornerRadius = new CornerRadius(CardCornerRadius);
        _tile.HorizontalAlignment = HorizontalAlignment.Stretch;
        _tile.VerticalAlignment = VerticalAlignment.Stretch;
        _tile.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _tile.VerticalContentAlignment = VerticalAlignment.Stretch;
        _tile.Content = _panel;
        _tile.Click += OnTileClick;

        // Variant accent on hover / keyboard focus (web hoverStyles border tint), reset on leave / blur.
        _tile.PointerEntered += OnTileAccentOn;
        _tile.PointerExited += OnTileAccentOff;
        _tile.GotFocus += OnTileAccentOn;
        _tile.LostFocus += OnTileAccentOff;

        Content = _tile;
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

    private void ApplyDisplay()
    {
        // Icon badge: the command glyph, or a busy ring while a dispatch is in flight (web Loader2).
        if (_display.IsLoading)
        {
            _iconBox.Child = new TsSpinner { Size = ControlSize.Small };
        }
        else
        {
            _icon.Glyph = _display.IconGlyph;
            _iconBox.Child = _icon;
        }

        _label.Text = _display.Label;
        _label.Visibility = string.IsNullOrEmpty(_display.Label) ? Visibility.Collapsed : Visibility.Visible;

        _sublabel.Text = _display.Sublabel;
        _sublabel.Visibility = _display.HasSublabel ? Visibility.Visible : Visibility.Collapsed;

        _status.Text = _display.StatusText;
        if (_display.HasStatus)
        {
            _status.Foreground = DisplayTokens.Brush(_display.StatusAccentKey);
            _status.Visibility = Visibility.Visible;
            LiveRegion.Announce(_status);
        }
        else
        {
            _status.Visibility = Visibility.Collapsed;
        }

        // Favorite star: filled amber when pinned, muted outline otherwise (web Star + fill-current / amber-300).
        _favoriteIcon.Glyph = _display.FavoriteGlyph;
        _favoriteIcon.Foreground = DisplayTokens.Brush(_display.FavoriteAccentKey);
        AutomationProperties.SetName(_favorite, _display.FavoriteToggleLabel);

        // Dim while in flight (web opacity-50); the click is suppressed in the handler, not by disabling, so the
        // favorite star stays operable exactly as the web tile keeps it.
        _panel.Opacity = _display.IsLoading ? LoadingOpacity : 1.0;

        AutomationProperties.SetName(_tile, _display.AutomationName);
        AutomationProperties.SetName(this, _display.AutomationName);
    }

    private void OnTileClick(object sender, RoutedEventArgs e)
    {
        // web handleClick: a dispatch in flight swallows the open-dialog request.
        if (_display.IsLoading)
        {
            return;
        }

        _diagnostics.RecordDialogRequested();
        DialogRequested?.Invoke(this, EventArgs.Empty);
    }

    private void OnFavoriteClick(object sender, RoutedEventArgs e)
    {
        _diagnostics.RecordFavoriteToggled();
        FavoriteToggled?.Invoke(this, EventArgs.Empty);
    }

    private void OnTileAccentOn(object sender, RoutedEventArgs e) =>
        _panel.BorderBrush = AccentBorder(_display.HoverAccentKey);

    private void OnTileAccentOn(object sender, PointerRoutedEventArgs e) =>
        _panel.BorderBrush = AccentBorder(_display.HoverAccentKey);

    private void OnTileAccentOff(object sender, RoutedEventArgs e) =>
        _panel.BorderBrush = DisplayTokens.Border;

    private void OnTileAccentOff(object sender, PointerRoutedEventArgs e) =>
        _panel.BorderBrush = DisplayTokens.Border;

    private static Brush AccentBorder(string accentKey)
    {
        // web hover:border-neon-{color}/30 — the variant accent at ~30% alpha.
        if (DisplayTokens.Brush(accentKey) is SolidColorBrush solid)
        {
            var c = solid.Color;
            return new SolidColorBrush(Windows.UI.Color.FromArgb(HoverBorderAlpha, c.R, c.G, c.B));
        }

        return DisplayTokens.Border;
    }
}
