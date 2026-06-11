using System.Windows.Input;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using Windows.UI;

namespace TeslaSync.App.SharedSurfaces.InlineCalloutSurface;

/// <summary>
/// The native WinUI 3 <c>InlineCallout</c> shared surface — a parity port of
/// <c>web/src/components/feedback/InlineCallout.tsx</c>. It is a single-line, low-chrome callout for surfacing one
/// actionable insight inside a larger card (e.g. "1 anomaly in this range — Apr 24 →"): assign a
/// <see cref="Model"/> (the web <c>variant</c> / <c>icon</c> / <c>children</c> / <c>action</c> / <c>testId</c>
/// props) and it renders the web layout — an accent-tinted, ring-bordered row of an optional leading glyph, the
/// body message, and an optional trailing action label + chevron. The view never performs HTTP; the variant accent
/// / body colour, the render-branch selection and the accessible-name composition all happen in the WinUI-free
/// <see cref="InlineCalloutProjection"/>. Reproducing the web's three branches exactly: an <c>action.href</c>
/// renders an in-app navigation link (a <see cref="HyperlinkButton"/>, role link, raising <see cref="ActionInvoked"/>
/// with the href so the host routes), an <c>action.onClick</c> renders an action <see cref="Button"/> (role button),
/// and the absence of either renders a non-interactive <see cref="Border"/> exposed as a polite <c>status</c> live
/// region. Because the web component is synchronous and prop-driven (its parent card owns any data fetching), it has
/// no loading / error / stale / offline chrome — only the four variants, the optional icon and the three action
/// modes — so this surface reproduces those branches and always renders rather than hiding itself. The variant tint
/// is materialised from the shared accent token brush at the web <c>bg-*/5</c> / <c>ring-*/20</c>–<c>/25</c> alphas;
/// ambient theming otherwise flows through the token brushes. The web's only motion is the hover <c>transition-colors</c>,
/// which the platform button visual states already provide, so there is no entrance animation to gate on
/// reduce-motion. The leading icon and trailing chevron are decorative (the web <c>aria-hidden</c>); the surface
/// carries the composed body + action label as its accessible name so Narrator reads the announcement once.
/// </summary>
public sealed partial class InlineCallout : ContentControl
{
    private const double RowSpacing = 8;            // web `gap-2`
    private const double ActionSpacing = 2;          // web `gap-0.5`
    private const double PaddingHorizontal = 12;     // web `px-3`
    private const double PaddingVertical = 8;        // web `py-2`
    private const double CalloutCornerRadius = 8;    // web `rounded-lg`
    private const double RingThickness = 1;          // web `ring-1`

    private readonly ILocalizer _localizer;
    private readonly InlineCalloutDiagnostics _diagnostics;

    private InlineCalloutModel _model;
    private ButtonBase? _interactiveHost;
    private InlineCalloutInteraction _interaction = InlineCalloutInteraction.None;
    private string? _href;
    private string _composedName = string.Empty;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade (P1/S10); this anonymous surface carries no inherent strings, so it is reserved for parity with the surface family.</param>
    /// <param name="model">The initial render model; defaults to <see cref="InlineCalloutModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public InlineCallout(
        ILocalizer localizer,
        InlineCalloutModel? model = null,
        InlineCalloutDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? InlineCalloutModel.Empty;
        _diagnostics = diagnostics ?? new InlineCalloutDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Center;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>Raised when the interactive (button / link) callout is invoked; carries the interaction kind and href.</summary>
    public event EventHandler<InlineCalloutActionInvokedEventArgs>? ActionInvoked;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>InlineCallout</c>).</summary>
    public static string Slug => InlineCalloutRegistration.Slug;

    /// <summary>Optional MVVM command invoked alongside <see cref="ActionInvoked"/>; the href is passed as the parameter.</summary>
    public ICommand? ActionCommand { get; set; }

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public InlineCalloutModel Model
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
    protected override AutomationPeer OnCreateAutomationPeer() => new InlineCalloutAutomationPeer(this);

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
        InlineCalloutDisplay display = InlineCalloutProjection.Project(_model, _localizer);
        _interaction = display.Interaction;
        _href = display.Href;
        _composedName = display.AutomationName;

        DetachInteractive();

        Grid content = BuildContent(display);
        Brush tint = TintBrush(display, display.BackgroundTintOpacity);
        Brush ring = TintBrush(display, display.RingOpacity);

        switch (display.Interaction)
        {
            case InlineCalloutInteraction.Navigate:
                var link = NewInteractiveHost<HyperlinkButton>(content, tint, ring);
                AutomationProperties.SetName(link, display.AutomationName);
                Content = link;
                AutomationProperties.SetName(this, string.Empty);
                break;

            case InlineCalloutInteraction.Invoke:
                var button = NewInteractiveHost<Button>(content, tint, ring);
                AutomationProperties.SetName(button, display.AutomationName);
                Content = button;
                AutomationProperties.SetName(this, string.Empty);
                break;

            default:
                // web `<div role="status">`: a non-interactive, polite live region named by this surface.
                Content = new Border
                {
                    Child = content,
                    Background = tint,
                    BorderBrush = ring,
                    BorderThickness = new Thickness(RingThickness),
                    CornerRadius = new CornerRadius(CalloutCornerRadius),
                    Padding = new Thickness(PaddingHorizontal, PaddingVertical, PaddingHorizontal, PaddingVertical),
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                };
                AutomationProperties.SetName(this, display.AutomationName);
                LiveRegion.Configure(this);
                break;
        }

        // web `data-testid` lives on the rendered element regardless of branch — here the outer surface.
        AutomationProperties.SetAutomationId(this, display.AutomationId ?? string.Empty);
    }

    private static Grid BuildContent(InlineCalloutDisplay display)
    {
        // web `inline-flex w-full items-center gap-2`: icon (auto) | body (flex-1) | action (auto).
        var grid = new Grid
        {
            ColumnSpacing = RowSpacing,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Center,
        };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Brush accent = DisplayTokens.Brush(display.AccentBrushKey);

        if (display.HasIcon)
        {
            var icon = new FontIcon
            {
                Glyph = display.IconGlyph,
                FontSize = InlineCalloutProjection.IconSize,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Center,
            };

            // Decorative (web `aria-hidden`) — the surface's accessible name already carries the announcement.
            AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
            Grid.SetColumn(icon, 0);
            grid.Children.Add(icon);
        }

        var body = new TextBlock
        {
            Text = display.Body,
            FontSize = InlineCalloutProjection.BodyFontSize,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.Brush(display.BodyBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };

        // The composed name on the surface is authoritative, so the visible text adds no separate accessible node.
        AutomationProperties.SetAccessibilityView(body, AccessibilityView.Raw);
        Grid.SetColumn(body, 1);
        grid.Children.Add(body);

        if (display.HasAction)
        {
            var action = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = ActionSpacing,
                VerticalAlignment = VerticalAlignment.Center,
            };

            var label = new TextBlock
            {
                Text = display.ActionLabel,
                FontSize = InlineCalloutProjection.BodyFontSize,
                FontWeight = FontWeights.Medium,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

            var chevron = new FontIcon
            {
                Glyph = InlineCalloutRegistration.ChevronGlyph,
                FontSize = InlineCalloutProjection.ChevronSize,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

            action.Children.Add(label);
            action.Children.Add(chevron);
            Grid.SetColumn(action, 2);
            grid.Children.Add(action);
        }

        return grid;
    }

    private T NewInteractiveHost<T>(Grid content, Brush tint, Brush ring)
        where T : ButtonBase, new()
    {
        var host = new T
        {
            Content = content,
            Background = tint,
            BorderBrush = ring,
            BorderThickness = new Thickness(RingThickness),
            CornerRadius = new CornerRadius(CalloutCornerRadius),
            Padding = new Thickness(PaddingHorizontal, PaddingVertical, PaddingHorizontal, PaddingVertical),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Center,
        };

        host.Click += OnInteractiveClick;
        _interactiveHost = host;
        return host;
    }

    private void OnInteractiveClick(object sender, RoutedEventArgs e)
    {
        var args = new InlineCalloutActionInvokedEventArgs(_interaction, _href);
        ActionInvoked?.Invoke(this, args);

        if (ActionCommand is { } command && command.CanExecute(_href))
        {
            command.Execute(_href);
        }
    }

    private void DetachInteractive()
    {
        if (_interactiveHost is { } host)
        {
            host.Click -= OnInteractiveClick;
            _interactiveHost = null;
        }
    }

    private static SolidColorBrush TintBrush(InlineCalloutDisplay display, double opacity) =>
        new(AccentColor(display.AccentBrushKey, display.Variant)) { Opacity = opacity };

    private static Color AccentColor(string accentKey, CalloutVariant variant)
    {
        if (DisplayTokens.Brush(accentKey) is SolidColorBrush brush && brush.Color.A != 0)
        {
            return brush.Color;
        }

        // Token resolution miss (no XAML host / absent resource): fall back to the variant's web accent hue so the
        // tint still reads, mirroring BrowserCompatBanner's colour fallback.
        return variant switch
        {
            CalloutVariant.Success => Color.FromArgb(0xFF, 0x34, 0xD3, 0x99), // emerald-400
            CalloutVariant.Warning => Color.FromArgb(0xFF, 0xFB, 0xBF, 0x24), // amber-400
            CalloutVariant.Danger => Color.FromArgb(0xFF, 0xFB, 0x71, 0x85),  // rose-400
            _ => Color.FromArgb(0xFF, 0x22, 0xD3, 0xEE),                       // cyan-400 (info)
        };
    }

    private sealed class InlineCalloutAutomationPeer : FrameworkElementAutomationPeer
    {
        public InlineCalloutAutomationPeer(InlineCallout owner)
            : base(owner)
        {
        }

        private InlineCallout Surface => (InlineCallout)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            Surface._interaction == InlineCalloutInteraction.None
                ? AutomationControlType.Text
                : AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }

            // Only the status branch names this surface directly; the interactive branches name their inner control.
            return Surface._interaction == InlineCalloutInteraction.None ? Surface._composedName : name;
        }
    }
}

/// <summary>
/// The payload raised by <see cref="InlineCallout.ActionInvoked"/> — the native analogue of the web
/// <c>action.onClick</c> callback firing / the <c>action.href</c> link being followed. Carries which branch was
/// activated and, for the navigation branch, the <see cref="Href"/> the host should route to (the web client-side
/// route), so the view stays free of navigation policy.
/// </summary>
public sealed class InlineCalloutActionInvokedEventArgs : EventArgs
{
    /// <summary>Creates the payload for an invoked callout action.</summary>
    /// <param name="interaction">Which render branch was activated (button / link).</param>
    /// <param name="href">The navigation target for the link branch (web <c>action.href</c>); null for the button branch.</param>
    public InlineCalloutActionInvokedEventArgs(InlineCalloutInteraction interaction, string? href)
    {
        Interaction = interaction;
        Href = href;
    }

    /// <summary>Which render branch was activated (web <c>onClick</c> button / <c>href</c> link).</summary>
    public InlineCalloutInteraction Interaction { get; }

    /// <summary>The navigation target for the link branch (web <c>action.href</c>); null for the button branch.</summary>
    public string? Href { get; }
}
