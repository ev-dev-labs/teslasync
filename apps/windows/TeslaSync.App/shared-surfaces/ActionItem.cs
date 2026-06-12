using System.Windows.Input;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces.ActionItemSurface;

/// <summary>
/// The native WinUI 3 <c>ActionItem</c> shared surface — a parity port of
/// <c>web/src/components/status/ActionItem.tsx</c>. It is a single operator-task row used inside the
/// <c>ActionItemsPanel</c>: assign a <see cref="Model"/> (the web <c>severity</c> / <c>title</c> /
/// <c>description</c> / <c>cta</c> props) and it renders the web layout — a severity-tinted, ring-bordered card
/// of a leading severity glyph, a stacked title + optional description, and an optional right-aligned CTA. The
/// view never performs HTTP; the severity accent / glyph, the CTA render-branch selection and the accessible-name
/// composition all happen in the WinUI-free <see cref="ActionItemProjection"/>. Reproducing the web's
/// <c>ActionCTA</c> branches exactly (<c>ActionItem.tsx</c> L59-93): a <c>cta.to</c> renders a link
/// (a <see cref="HyperlinkButton"/>, role link, raising <see cref="ActionInvoked"/> with the href + the
/// <c>external</c> flag so the host opens a new tab or routes in-app), a <c>cta.onClick</c> renders an action
/// <see cref="Button"/> (role button), and a <c>cta</c> with neither — or no <c>cta</c> at all — renders no CTA
/// (the web <c>ActionCTA</c> returns <c>null</c>). The row itself is never interactive (the web outer element is a
/// plain <c>div</c>); only the CTA is focusable. Because the web component is synchronous and prop-driven (the
/// panel owns any data fetching), it has no loading / error / stale / offline chrome — only the three severities,
/// the optional description and the three CTA modes — so this surface reproduces those branches and always renders
/// rather than hiding itself. The severity tint is materialised from the shared accent token brush at the web
/// <c>bg-*-500/10</c> / <c>ring-*-400/20</c> alphas, falling back to the web accent hue when no XAML host has the
/// token; ambient theming otherwise flows through the token brushes. The web's only motion is the CTA hover
/// <c>transition-colors</c>, which the platform button visual states already provide, so there is no entrance
/// animation to gate on reduce-motion. The leading icon and trailing chevron are decorative (the web Lucide icons
/// carry no text); the row carries the composed title + description as its accessible name and the CTA carries its
/// label, so Narrator reads the task then lets the user tab to the action.
/// </summary>
public sealed partial class ActionItem : ContentControl
{
    private const double ColumnSpacing = 12;        // web `gap-3`
    private const double TitleDescriptionSpacing = 2; // web `space-y-0.5`
    private const double CardPadding = 12;          // web `p-3`
    private const double CardCornerRadius = 8;      // web `rounded-lg`
    private const double RingThickness = 1;         // web `ring-1`
    private const double IconTopNudge = 2;          // web `mt-0.5` on the leading icon
    private const double CtaSpacing = 4;            // web CTA `gap-1`
    private const double CtaCornerRadius = 6;       // web CTA `rounded-md`
    private const double CtaPaddingHorizontal = 12;  // web CTA `px-3`
    private const double CtaPaddingVertical = 6;     // web CTA `py-1.5`

    private readonly ILocalizer _localizer;
    private readonly ActionItemDiagnostics _diagnostics;

    private ActionItemModel _model;
    private ButtonBase? _ctaHost;
    private ActionItemInteraction _interaction = ActionItemInteraction.None;
    private string? _ctaHref;
    private bool _ctaIsExternal;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade (P1/S10); this anonymous surface carries no inherent strings (title / description / CTA label are caller-supplied), so it is reserved for parity with the surface family.</param>
    /// <param name="model">The initial render model; defaults to <see cref="ActionItemModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ActionItem(
        ILocalizer localizer,
        ActionItemModel? model = null,
        ActionItemDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? ActionItemModel.Empty;
        _diagnostics = diagnostics ?? new ActionItemDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the CTA (button / link) is invoked; carries the interaction kind, href and external flag.</summary>
    public event EventHandler<ActionItemInvokedEventArgs>? ActionInvoked;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ActionItem</c>).</summary>
    public static string Slug => ActionItemRegistration.Slug;

    /// <summary>Optional MVVM command invoked alongside <see cref="ActionInvoked"/>; the CTA href is passed as the parameter.</summary>
    public ICommand? ActionCommand { get; set; }

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public ActionItemModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new ActionItemAutomationPeer(this);

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
        ActionItemDisplay display = ActionItemProjection.Project(_model, _localizer);
        _interaction = display.Interaction;
        _ctaHref = display.CtaHref;
        _ctaIsExternal = display.CtaIsExternal;

        DetachCta();

        Color accentColor = AccentColor(display.AccentBrushKey, display.Severity);
        SolidColorBrush accent = AccentBrush(display.AccentBrushKey, accentColor);

        // web `flex items-start gap-3`: icon (auto) | title + description (flex-1) | CTA (auto), all top-aligned.
        var grid = new Grid
        {
            ColumnSpacing = ColumnSpacing,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // web `<Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden>`: the severity glyph, decorative.
        var icon = new FontIcon
        {
            Glyph = display.IconGlyph,
            FontSize = ActionItemProjection.IconSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, IconTopNudge, 0, 0),
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        StackPanel textColumn = BuildTextColumn(display);
        Grid.SetColumn(textColumn, 1);
        grid.Children.Add(textColumn);

        if (display.HasCta)
        {
            ButtonBase cta = BuildCta(display, accent);
            Grid.SetColumn(cta, 2);
            grid.Children.Add(cta);
        }

        Content = new Border
        {
            Child = grid,
            Background = new SolidColorBrush(accentColor) { Opacity = display.BackgroundTintOpacity },
            BorderBrush = new SolidColorBrush(accentColor) { Opacity = display.RingOpacity },
            BorderThickness = new Thickness(RingThickness),
            CornerRadius = new CornerRadius(CardCornerRadius),
            Padding = new Thickness(CardPadding),
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        AutomationProperties.SetName(this, display.AutomationName);
    }

    private static StackPanel BuildTextColumn(ActionItemDisplay display)
    {
        // web `flex-1 min-w-0 space-y-0.5`: the title and the optional description, stacked.
        var column = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = TitleDescriptionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var title = new TextBlock
        {
            Text = display.Title,
            FontSize = ActionItemProjection.TitleFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.Brush(display.TitleBrushKey),
            TextWrapping = TextWrapping.Wrap,
        };

        // The composed name on the surface is authoritative, so the visible text adds no separate accessible node.
        AutomationProperties.SetAccessibilityView(title, AccessibilityView.Raw);
        column.Children.Add(title);

        if (display.HasDescription)
        {
            var description = new TextBlock
            {
                Text = display.Description,
                FontSize = ActionItemProjection.DescriptionFontSize,
                Foreground = DisplayTokens.Brush(display.DescriptionBrushKey),
                TextWrapping = TextWrapping.Wrap,
            };
            AutomationProperties.SetAccessibilityView(description, AccessibilityView.Raw);
            column.Children.Add(description);
        }

        return column;
    }

    private ButtonBase BuildCta(ActionItemDisplay display, SolidColorBrush accent)
    {
        // web CTA `inline-flex items-center gap-1`: the label then the decorative chevron.
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = CtaSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var label = new TextBlock
        {
            Text = display.CtaLabel,
            FontSize = ActionItemProjection.CtaFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        var chevron = new FontIcon
        {
            Glyph = ActionItemRegistration.ChevronGlyph,
            FontSize = ActionItemProjection.ChevronSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        content.Children.Add(label);
        content.Children.Add(chevron);

        // web: an external/internal `to` renders an anchor/Link (role link); an `onClick` renders a button.
        ButtonBase host = display.Interaction == ActionItemInteraction.Navigate
            ? new HyperlinkButton()
            : new Button();

        host.Content = content;
        host.Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent); // web base is transparent; hover tints `--surface-2`.
        host.BorderThickness = new Thickness(0);
        host.Foreground = accent;
        host.MinHeight = ActionItemProjection.CtaMinHeight; // web `min-h-[36px]`
        host.CornerRadius = new CornerRadius(CtaCornerRadius);
        host.Padding = new Thickness(CtaPaddingHorizontal, CtaPaddingVertical, CtaPaddingHorizontal, CtaPaddingVertical);
        host.VerticalAlignment = VerticalAlignment.Top; // web row `items-start`
        AutomationProperties.SetName(host, display.CtaAccessibleName);

        host.Click += OnCtaClick;
        _ctaHost = host;
        return host;
    }

    private void OnCtaClick(object sender, RoutedEventArgs e)
    {
        var args = new ActionItemInvokedEventArgs(_interaction, _ctaHref, _ctaIsExternal);
        ActionInvoked?.Invoke(this, args);

        if (ActionCommand is { } command && command.CanExecute(_ctaHref))
        {
            command.Execute(_ctaHref);
        }
    }

    private void DetachCta()
    {
        if (_ctaHost is { } host)
        {
            host.Click -= OnCtaClick;
            _ctaHost = null;
        }
    }

    private static SolidColorBrush AccentBrush(string accentKey, Color fallback)
    {
        if (DisplayTokens.Brush(accentKey) is SolidColorBrush brush && brush.Color.A != 0)
        {
            return brush;
        }

        return new SolidColorBrush(fallback);
    }

    private static Color AccentColor(string accentKey, ActionSeverity severity)
    {
        if (DisplayTokens.Brush(accentKey) is SolidColorBrush brush && brush.Color.A != 0)
        {
            return brush.Color;
        }

        // Token resolution miss (no XAML host / absent resource): fall back to the severity's web accent hue so the
        // tint still reads, mirroring InlineCallout's colour fallback.
        return severity switch
        {
            ActionSeverity.Warn => Color.FromArgb(0xFF, 0xFB, 0xBF, 0x24),  // amber-400
            ActionSeverity.Error => Color.FromArgb(0xFF, 0xF8, 0x71, 0x71), // red-400
            _ => Color.FromArgb(0xFF, 0x60, 0xA5, 0xFA),                     // blue-400 (info)
        };
    }

    private sealed class ActionItemAutomationPeer : FrameworkElementAutomationPeer
    {
        public ActionItemAutomationPeer(ActionItem owner)
            : base(owner)
        {
        }

        private ActionItem Surface => (ActionItem)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            // web outer `<div>`: a group when it hosts a focusable CTA, otherwise a labelled text region.
            Surface._interaction == ActionItemInteraction.None
                ? AutomationControlType.Text
                : AutomationControlType.Group;
    }
}

/// <summary>
/// The payload raised by <see cref="ActionItem.ActionInvoked"/> — the native analogue of the web
/// <c>cta.onClick</c> callback firing / the <c>cta.to</c> link being followed (<c>ActionItem.tsx</c> L67-91).
/// Carries which branch was activated and, for the navigation branch, the <see cref="Href"/> the host should
/// route to and whether it <see cref="IsExternal"/> (the web <c>cta.to</c> + <c>external</c>, where an external
/// target opens in a new tab and an internal one routes in-app), so the view stays free of navigation policy.
/// </summary>
public sealed class ActionItemInvokedEventArgs : EventArgs
{
    /// <summary>Creates the payload for an invoked CTA.</summary>
    /// <param name="interaction">Which render branch was activated (button / link).</param>
    /// <param name="href">The navigation target for the link branch (web <c>cta.to</c>); null for the button branch.</param>
    /// <param name="isExternal">Whether the navigation target opens externally in a new tab (web <c>cta.external</c>).</param>
    public ActionItemInvokedEventArgs(ActionItemInteraction interaction, string? href, bool isExternal)
    {
        Interaction = interaction;
        Href = href;
        IsExternal = isExternal;
    }

    /// <summary>Which render branch was activated (web <c>onClick</c> button / <c>to</c> link).</summary>
    public ActionItemInteraction Interaction { get; }

    /// <summary>The navigation target for the link branch (web <c>cta.to</c>); null for the button branch.</summary>
    public string? Href { get; }

    /// <summary>Whether the navigation target opens externally in a new tab (web <c>cta.external</c>).</summary>
    public bool IsExternal { get; }
}
