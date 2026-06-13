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
/// The native WinUI 3 <c>ToggleCommandTile</c> feature surface — a parity port of
/// web/src/features/system/components/ToggleCommandTile.tsx. It is the Vehicle-Commands grid tile for a
/// stateful on / off command: a tokenized glass card carrying a command icon badge, the command label, an
/// ON / OFF caption and an optional last-command status caption, with a status dot pinned top-right and a
/// favorite-toggle star pinned top-left. While on, the variant accent (web <c>onStyles</c>: default → cyan,
/// danger → red, success → green) tints the card border + fill, the dot, the icon badge and the ON caption;
/// while off the surface collapses to the muted / surface tokens (web <c>--surface-2</c> / <c>--text-muted</c>)
/// and the icon swaps to the off glyph (web <c>def.iconOff ?? def.icon</c>). The whole card is the click target
/// (the native analogue of the clickable web <c>GlassPanel</c>): activating it dispatches — when off — either
/// the on command (web <c>onExecute(def.command, def.params)</c>) or, for an input-backed command, the input
/// dialog (web <c>onRequestDialog(def)</c>); when on it dispatches the off command
/// (web <c>onExecute(def.commandOff!)</c>). A dispatch in flight (web <c>loading</c>) swaps the icon for a busy
/// indicator, dims the card and suppresses the click. For commands without a backing vehicle state field the
/// view keeps the web optimistic local toggle (web <c>setLocalToggle</c>); for state-field-backed commands the
/// on / off state is driven entirely by the host-supplied <see cref="ToggleCommandTileModel.IsOn"/>. The star
/// raises <see cref="FavoriteToggled"/> (web <c>onToggleFavorite</c>) as a separate, always-reachable control so
/// it stays keyboard- and Narrator-accessible (the web hides it behind <c>opacity-0 group-hover</c>, which is
/// not discoverable for assistive tech). The view performs no HTTP and owns no business logic: all branch
/// selection, tone, accent and copy resolution happen in the WinUI-free <see cref="ToggleCommandTileProjection"/>.
/// Every string resolves through the i18n facade, the interactive elements carry a Narrator name, the decorative
/// dot and icon are hidden from Narrator, the status caption is a polite live region so command results are
/// announced, and the surface adds no bespoke looping motion (the busy ring is the system progress indicator),
/// so reduced-motion preferences are honoured by construction.
/// </summary>
public sealed partial class ToggleCommandTile : ContentControl
{
    private const double CardMinHeight = 100;       // web min-h-[100px]
    private const double CardPadding = 16;          // web p-4
    private const double CardCornerRadius = 12;     // web rounded-xl
    private const double ContentSpacing = 8;        // web gap-2
    private const double TextSpacing = 2;           // web gap inside the text block
    private const double IconBoxPadding = 10;       // web p-2.5
    private const double IconBoxCornerRadius = 12;  // web rounded-xl
    private const double IconFontSize = 20;         // web icon h-5 w-5
    private const double FavoriteIconSize = 14;     // web star h-3 w-3 (bumped slightly for a Windows-min target)
    private const double FavoriteMargin = 6;        // web left-1.5 top-1.5
    private const double DotSize = 8;               // web h-2 w-2
    private const double DotMargin = 8;             // web top-2 right-2
    private const double LabelFontSize = 12;        // web text-xs
    private const double ToggleStateFontSize = 10;  // web text-[10px]
    private const double StatusFontSize = 9;        // web text-[9px]
    private const double LoadingOpacity = 0.5;      // web opacity-50
    private const byte OnBorderAlpha = 0x33;        // web on border-neon-{accent}/20
    private const byte OnFillAlpha = 0x0D;          // web on bg-neon-{accent}/5
    private const byte OnIconBoxAlpha = 0x33;       // web on icon bg-neon-{accent}/20
    private const byte HoverSubtleAlpha = 0x40;     // web off hover:border-[var(--border-subtle)]

    private readonly ILocalizer _localizer;
    private readonly ToggleCommandTileDiagnostics _diagnostics;

    private readonly Button _tile = new();
    private readonly TsGlassPanel _panel = new();
    private readonly Border _fill = new();
    private readonly Grid _inner = new();
    private readonly StackPanel _content = new();
    private readonly Border _iconBox = new();
    private readonly FontIcon _icon = new();
    private readonly TsSpinner _spinner = new() { Size = ControlSize.Small };
    private readonly Border _dot = new();
    private readonly StackPanel _texts = new();
    private readonly TextBlock _label = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center };
    private readonly TextBlock _toggleState = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center };
    private readonly TextBlock _status = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center };
    private readonly TsButton _favorite = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small };
    private readonly FontIcon _favoriteIcon = new() { FontSize = FavoriteIconSize };

    private ToggleCommandTileModel _model;
    private ToggleCommandTileDisplay _display;
    private bool _effectiveOn;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ToggleCommandTileModel.Idle"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the operational events.</param>
    public ToggleCommandTile(
        ILocalizer localizer,
        ToggleCommandTileModel? model = null,
        ToggleCommandTileDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ToggleCommandTileModel.Idle;
        _diagnostics = diagnostics ?? new ToggleCommandTileDiagnostics();
        _effectiveOn = _model.IsOn;
        _display = ToggleCommandTileProjection.Project(_model, _localizer);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildVisualTree();
        Loaded += OnLoaded;
        ApplyDisplay();
    }

    /// <summary>Raised when the tile dispatches a command — the native analogue of the web <c>onExecute</c>.</summary>
    public event EventHandler<ToggleCommandExecutedEventArgs>? CommandExecuted;

    /// <summary>Raised when an input-backed command is turned on — the native analogue of the web <c>onRequestDialog(def)</c>.</summary>
    public event EventHandler? DialogRequested;

    /// <summary>Raised when the favorite star is activated — the native analogue of the web <c>onToggleFavorite</c>.</summary>
    public event EventHandler? FavoriteToggled;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ToggleCommandTile</c>).</summary>
    public static string Slug => ToggleCommandTileRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface, resetting the optimistic toggle.</summary>
    public ToggleCommandTileModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            _effectiveOn = value.IsOn;
            Render();
        }
    }

    private void BuildVisualTree()
    {
        // Glass card visual (web GlassPanel). Padding moves to the inner fill border so the on-state accent fill
        // covers the whole card; the panel keeps only the tokenized glass surface + the (variant-tinted) border.
        _panel.MinHeight = CardMinHeight;
        _panel.Padding = new Thickness(0);
        _panel.BorderBrush = DisplayTokens.Border;

        // On-state accent fill (web bg-neon-{accent}/5), transparent while off so the glass surface shows through.
        _fill.Padding = new Thickness(CardPadding);
        _fill.CornerRadius = DisplayTokens.Radius("TsRadiusLg", CardCornerRadius);
        _fill.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent);

        // Accent icon badge (web rounded-xl p-2.5): a tinted box holding the command glyph or the in-flight ring.
        _iconBox.CornerRadius = new CornerRadius(IconBoxCornerRadius);
        _iconBox.Padding = new Thickness(IconBoxPadding);
        _iconBox.HorizontalAlignment = HorizontalAlignment.Center;
        _icon.FontSize = IconFontSize;
        _icon.HorizontalAlignment = HorizontalAlignment.Center;
        _icon.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_iconBox, AccessibilityView.Raw);

        // Label (web text-xs medium primary), ON / OFF caption (web text-[10px] medium, accent / muted) and
        // last-command status (web text-[9px], success/danger tinted). The status is a polite live region.
        _label.FontSize = LabelFontSize;
        _label.FontWeight = FontWeights.Medium;
        _label.Foreground = DisplayTokens.TextPrimary;
        _toggleState.FontSize = ToggleStateFontSize;
        _toggleState.FontWeight = FontWeights.Medium;
        _toggleState.Margin = new Thickness(0, TextSpacing, 0, 0);
        _status.FontSize = StatusFontSize;
        _status.Margin = new Thickness(0, TextSpacing, 0, 0);
        LiveRegion.Configure(_status);

        _texts.HorizontalAlignment = HorizontalAlignment.Center;
        _texts.Children.Add(_label);
        _texts.Children.Add(_toggleState);
        _texts.Children.Add(_status);

        // Centered content column (web flex-col items-center justify-center gap-2).
        _content.Spacing = ContentSpacing;
        _content.HorizontalAlignment = HorizontalAlignment.Center;
        _content.VerticalAlignment = VerticalAlignment.Center;
        _iconBox.Child = _icon;
        _content.Children.Add(_iconBox);
        _content.Children.Add(_texts);

        // Status dot (web absolute top-2 right-2 h-2 w-2 rounded-full): decorative, hidden from Narrator since the
        // on / off state is already announced through the ON / OFF caption + the composed tile name.
        _dot.Width = DotSize;
        _dot.Height = DotSize;
        _dot.CornerRadius = new CornerRadius(DotSize / 2);
        _dot.HorizontalAlignment = HorizontalAlignment.Right;
        _dot.VerticalAlignment = VerticalAlignment.Top;
        _dot.Margin = new Thickness(0, DotMargin, DotMargin, 0);
        AutomationProperties.SetAccessibilityView(_dot, AccessibilityView.Raw);

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
        _inner.Children.Add(_dot);
        _inner.Children.Add(_favorite);
        _fill.Child = _inner;
        _panel.Content = _fill;

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

        // Off-state subtle border on hover / keyboard focus (web hover:border-[var(--border-subtle)]); the on-state
        // already carries the accent border, so the resting border is restored on leave / blur.
        _tile.PointerEntered += OnTileHoverOn;
        _tile.PointerExited += OnTileHoverOff;
        _tile.GotFocus += OnTileHoverOn;
        _tile.LostFocus += OnTileHoverOff;

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

    private void Render()
    {
        // Project against the effective on / off state (the host model overridden by any optimistic local toggle).
        _display = ToggleCommandTileProjection.Project(_model with { IsOn = _effectiveOn }, _localizer);
        ApplyDisplay();
    }

    private void ApplyDisplay()
    {
        // Icon badge: the on / off command glyph, or a busy ring while a dispatch is in flight (web Loader2).
        if (_display.IsLoading)
        {
            _iconBox.Child = _spinner;
        }
        else
        {
            _icon.Glyph = _display.IconGlyph;
            _icon.Foreground = DisplayTokens.Brush(_display.IconForegroundKey);
            _iconBox.Child = _icon;
        }

        // Icon badge background (web on: bg-neon-{accent}/20, off: bg-[var(--surface-2)]).
        _iconBox.Background = _display.IsOn
            ? AccentBrush(_display.AccentKey, OnIconBoxAlpha)
            : DisplayTokens.Brush(ToggleCommandTileRegistration.OffSurfaceKey);

        _label.Text = _display.Label;
        _label.Visibility = string.IsNullOrEmpty(_display.Label) ? Visibility.Collapsed : Visibility.Visible;

        // ON / OFF caption (web on: text-neon-{accent}, off: text-[var(--text-muted)]).
        _toggleState.Text = _display.ToggleStateText;
        _toggleState.Foreground = DisplayTokens.Brush(_display.ToggleStateAccentKey);

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

        // Status dot (web on: bg-neon-{accent} solid, off: bg-[var(--surface-2)]).
        _dot.Background = DisplayTokens.Brush(_display.DotBrushKey);

        // Favorite star: filled amber when pinned, muted outline otherwise (web Star + fill-current / amber-300).
        _favoriteIcon.Glyph = _display.FavoriteGlyph;
        _favoriteIcon.Foreground = DisplayTokens.Brush(_display.FavoriteAccentKey);
        AutomationProperties.SetName(_favorite, _display.FavoriteToggleLabel);

        // Card border + accent fill (web on: border-neon-{accent}/20 + bg-neon-{accent}/5).
        _panel.BorderBrush = RestingBorder();
        _fill.Background = _display.IsOn
            ? AccentBrush(_display.AccentKey, OnFillAlpha)
            : new SolidColorBrush(Microsoft.UI.Colors.Transparent);

        // Dim while in flight (web opacity-50); the click is suppressed in the handler, not by disabling, so the
        // favorite star stays operable exactly as the web tile keeps it.
        _panel.Opacity = _display.IsLoading ? LoadingOpacity : 1.0;

        AutomationProperties.SetName(_tile, _display.AutomationName);
        AutomationProperties.SetName(this, _display.AutomationName);
    }

    private void OnTileClick(object sender, RoutedEventArgs e)
    {
        // web handleClick: a dispatch in flight swallows the activation.
        if (_display.IsLoading)
        {
            return;
        }

        if (_effectiveOn)
        {
            // Turn off (web: onExecute(def.commandOff!)). Optimistically flip when there is no backing state field.
            if (!_model.HasStateField)
            {
                SetLocalToggle(false);
            }

            _diagnostics.RecordCommandExecuted();
            string offCommand = string.IsNullOrEmpty(_model.CommandOff) ? _model.Command : _model.CommandOff!;
            CommandExecuted?.Invoke(this, new ToggleCommandExecutedEventArgs(offCommand, null));
            return;
        }

        // Turn on. An input-backed command opens its dialog (web onRequestDialog); otherwise it dispatches the
        // on command (web onExecute(def.command, def.params)), optimistically flipping when unbacked.
        if (_model.HasInputConfig)
        {
            _diagnostics.RecordDialogRequested();
            DialogRequested?.Invoke(this, EventArgs.Empty);
            return;
        }

        if (!_model.HasStateField)
        {
            SetLocalToggle(true);
        }

        _diagnostics.RecordCommandExecuted();
        CommandExecuted?.Invoke(this, new ToggleCommandExecutedEventArgs(_model.Command, _model.Parameters));
    }

    private void SetLocalToggle(bool on)
    {
        // web setLocalToggle: the optimistic on / off for commands without a backing vehicle state field.
        _effectiveOn = on;
        Render();
    }

    private void OnFavoriteClick(object sender, RoutedEventArgs e)
    {
        _diagnostics.RecordFavoriteToggled();
        FavoriteToggled?.Invoke(this, EventArgs.Empty);
    }

    private void OnTileHoverOn(object sender, RoutedEventArgs e) => ApplyHoverBorder();

    private void OnTileHoverOn(object sender, PointerRoutedEventArgs e) => ApplyHoverBorder();

    private void OnTileHoverOff(object sender, RoutedEventArgs e) => _panel.BorderBrush = RestingBorder();

    private void OnTileHoverOff(object sender, PointerRoutedEventArgs e) => _panel.BorderBrush = RestingBorder();

    private void ApplyHoverBorder()
    {
        // web off-state hover:border-[var(--border-subtle)] — only the off state brightens on hover; the on state
        // already carries the accent border.
        if (_display.IsOn)
        {
            return;
        }

        _panel.BorderBrush = SubtleBorder();
    }

    private Brush RestingBorder() => _display.IsOn
        ? AccentBrush(_display.AccentKey, OnBorderAlpha)
        : DisplayTokens.Border;

    private static Brush SubtleBorder()
    {
        // web --border-subtle — the muted foreground token at a low alpha for the off-state hover hairline.
        if (DisplayTokens.Brush(ToggleCommandTileRegistration.OffForegroundKey) is SolidColorBrush solid)
        {
            var c = solid.Color;
            return new SolidColorBrush(Windows.UI.Color.FromArgb(HoverSubtleAlpha, c.R, c.G, c.B));
        }

        return DisplayTokens.Border;
    }

    private static Brush AccentBrush(string accentKey, byte alpha)
    {
        // web bg-neon-{accent}/{N} / border-neon-{accent}/{N} — the variant accent at the given alpha.
        Brush token = DisplayTokens.Brush(accentKey);
        if (token is SolidColorBrush solid)
        {
            var c = solid.Color;
            return new SolidColorBrush(Windows.UI.Color.FromArgb(alpha, c.R, c.G, c.B));
        }

        return token;
    }
}
