using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.HelpTooltipSurface;

/// <summary>
/// The native WinUI 3 <c>HelpTooltip</c> shared surface — a parity port of
/// <c>web/src/components/ui/HelpTooltip.tsx</c>. It is the compact "?" help affordance placed next to non-obvious
/// metric titles, setting labels and advanced concepts (e.g. "Vampire Drain", "Cooldown minutes"): assign a
/// <see cref="Model"/> (the web <c>text</c> / <c>i18nKey</c> / <c>defaultValue</c> / <c>placement</c> /
/// <c>learnMore</c> / <c>size</c> / <c>ariaLabel</c> props) and it renders a focusable trigger glyph that reveals
/// the resolved help body. The view performs no HTTP; the body resolution, the accessible-name composition, the
/// glyph sizing and the render-vs-collapse decision all happen in the WinUI-free <see cref="HelpTooltipProjection"/>,
/// resolved through the i18n facade (P1/S10).
///
/// <para>
/// Reveal mapping (Windows-idiomatic, faithful to the web): the web composes the shared <c>&lt;Tooltip&gt;</c>
/// (hover / focus / tap reveal, <c>role="tooltip"</c> + <c>aria-describedby</c>) and, when a <c>learnMore</c> link
/// is present, re-enables pointer events just for that link so it stays clickable. A WinUI <see cref="ToolTip"/> is
/// non-interactive (it dismisses as the pointer leaves the trigger), so this surface attaches a
/// <see cref="ToolTip"/> via <see cref="ToolTipService"/> for the hover / focus text reveal (mirroring the web
/// tooltip body and feeding <see cref="AutomationProperties.HelpTextProperty"/> so Narrator announces it like the
/// web <c>aria-describedby</c>), and — only when there is a learn-more link — additionally hangs a light-dismiss
/// <see cref="Flyout"/> off the trigger (opened by click / Enter / Space) whose body repeats the help text and adds
/// an interactive <see cref="HyperlinkButton"/> whose <c>NavigateUri</c> opens the external target in the default
/// browser (the web <c>target="_blank" rel="noopener noreferrer"</c> new tab). Both popups honour the web
/// <c>placement</c>.
/// </para>
///
/// <para>
/// State coverage: the web source is a presentational control with no data fetch — it resolves its body
/// synchronously through <c>useTranslation</c> and issues no query, so it has no loading / error / stale / offline
/// chrome to reproduce. The states it actually has are reproduced in full: the resolved-content state (trigger +
/// reveal), the empty state (web <c>if (!resolved) return null</c> — this surface collapses to nothing rather than
/// showing a blank box), the three size tiers, the four placements, and the optional learn-more link. The trigger
/// glyph honours the system font scale (it is a <see cref="FontIcon"/>) and the popups inherit the Fluent
/// reduced-motion behaviour; the trigger carries the localized accessible name so Narrator reads "More info"
/// (or the caller's override) before the help text.
/// </para>
/// </summary>
public sealed partial class HelpTooltip : ContentControl
{
    private const double TriggerPadding = 2;        // tight ghost padding around the glyph (web inline-flex trigger)
    private const double FlyoutBodyWidth = 260;      // web Tooltip multiline `max-w-[260px]`
    private const double FlyoutSpacing = 4;          // web `mt-1` gap above the learn-more link
    private const double LearnMoreSpacing = 4;       // web `gap-1` between the label and the external-link glyph
    private const string MutedBrushKey = "TsColorTextMutedBrush";        // web trigger `text-[var(--text-muted)]`
    private const string PrimaryBrushKey = "TsColorTextPrimaryBrush";    // web body `text-[var(--text-primary)]`
    private const string SecondaryBrushKey = "TsColorTextSecondaryBrush"; // web link `text-[var(--text-secondary)]`

    private readonly ILocalizer _localizer;
    private readonly HelpTooltipDiagnostics _diagnostics;

    private HelpTooltipModel _model;
    private object? _triggerContent;
    private bool _opened;

    /// <summary>Creates a gallery-safe surface over the passthrough localizer and the empty model.</summary>
    public HelpTooltip()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade (P1/S10) the body, accessible name and learn-more label resolve through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="HelpTooltipModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HelpTooltip(
        ILocalizer localizer,
        HelpTooltipModel? model = null,
        HelpTooltipDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? HelpTooltipModel.Empty;
        _diagnostics = diagnostics ?? new HelpTooltipDiagnostics();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Center;
        VerticalContentAlignment = VerticalAlignment.Center;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>HelpTooltip</c>).</summary>
    public static string Slug => HelpTooltipRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public HelpTooltipModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>
    /// Optional custom trigger content (the web <c>children</c> override). When set it replaces the default Segoe
    /// Fluent help glyph; null restores the default glyph. Reassigning re-renders the surface.
    /// </summary>
    public object? TriggerContent
    {
        get => _triggerContent;
        set
        {
            _triggerContent = value;
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

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void Render()
    {
        HelpTooltipDisplay display = HelpTooltipProjection.Project(_model, _localizer);

        // web L67: `if (!resolved) return null;` — collapse to nothing rather than render a blank affordance.
        if (display.RendersNothing)
        {
            Content = null;
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);
            return;
        }

        Visibility = Visibility.Visible;

        // Transparent structural wrapper: the web root is the trigger button itself, so the surface hides itself
        // from Narrator and lets the button carry the accessible name + help text.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Button trigger = BuildTrigger(display);
        Content = trigger;
    }

    private Button BuildTrigger(HelpTooltipDisplay display)
    {
        var trigger = new Button
        {
            Background = Transparent(),
            BorderBrush = Transparent(),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(TriggerPadding),
            MinWidth = 0,
            MinHeight = 0,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Content = BuildTriggerContent(display),
        };

        // web L98 `aria-label={label}`: the trigger's accessible name, independent of the visible glyph.
        AutomationProperties.SetName(trigger, display.AccessibleLabel);

        // web shared <Tooltip role="tooltip"> + aria-describedby: the resolved body is the trigger's help text,
        // and a hover / focus ToolTip surfaces it visually at the requested placement.
        AutomationProperties.SetHelpText(trigger, display.ResolvedText);
        ToolTipService.SetToolTip(trigger, BuildHoverToolTip(display));

        // web L75-90: the learn-more link must stay clickable, which a non-interactive WinUI ToolTip cannot host —
        // so attach an interactive light-dismiss Flyout (click / Enter / Space) carrying the body + the link.
        if (display.HasLearnMore)
        {
            trigger.Flyout = BuildLearnMoreFlyout(display);
        }

        return trigger;
    }

    private FrameworkElement BuildTriggerContent(HelpTooltipDisplay display)
    {
        if (_triggerContent is FrameworkElement custom)
        {
            return custom;
        }

        // web L110: default trigger is the Lucide <HelpCircle> sized by the size tier; here its Segoe Fluent stand-in.
        var glyph = new FontIcon
        {
            Glyph = display.Glyph,
            FontSize = display.IconSize,
            Foreground = DisplayTokens.Brush(MutedBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        // Decorative (web `aria-hidden`) — the trigger button already carries the accessible name + help text.
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        return glyph;
    }

    private static ToolTip BuildHoverToolTip(HelpTooltipDisplay display) => new()
    {
        Content = display.ResolvedText,
        Placement = ToPlacementMode(display.Placement),
    };

    private static Flyout BuildLearnMoreFlyout(HelpTooltipDisplay display)
    {
        // web L72-92: a multiline body paragraph with an optional "Learn more" link beneath it.
        var body = new StackPanel { Spacing = FlyoutSpacing, MaxWidth = FlyoutBodyWidth };

        var text = new TextBlock
        {
            Text = display.ResolvedText,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.Brush(PrimaryBrushKey),
        };
        body.Children.Add(text);

        if (!string.IsNullOrEmpty(display.LearnMoreUrl))
        {
            body.Children.Add(BuildLearnMoreLink(display));
        }

        var flyout = new Flyout
        {
            Content = body,
            Placement = ToFlyoutPlacementMode(display.Placement),
        };
        return flyout;
    }

    private static HyperlinkButton BuildLearnMoreLink(HelpTooltipDisplay display)
    {
        // web L76-89: `<a target="_blank" rel="noopener noreferrer">{label} <ExternalLink/></a>`.
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = LearnMoreSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        content.Children.Add(new TextBlock
        {
            Text = display.LearnMoreLabel,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var external = new FontIcon
        {
            Glyph = display.ExternalLinkGlyph,
            FontSize = HelpTooltipRegistration.ExternalLinkIconSize,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative (web `aria-hidden`) — the link's accessible name is the label below.
        AutomationProperties.SetAccessibilityView(external, AccessibilityView.Raw);
        content.Children.Add(external);

        var link = new HyperlinkButton
        {
            Content = content,
            Foreground = DisplayTokens.Brush(SecondaryBrushKey),
            Padding = new Thickness(0),
        };
        AutomationProperties.SetName(link, display.LearnMoreLabel);

        // A HyperlinkButton with an absolute NavigateUri opens the system browser itself (the web new-tab anchor);
        // only set it when the URL parses so a malformed target degrades to an inert, named link.
        if (Uri.TryCreate(display.LearnMoreUrl, UriKind.Absolute, out Uri? uri))
        {
            link.NavigateUri = uri;
        }

        return link;
    }

    private static SolidColorBrush Transparent() => new(Colors.Transparent);

    private static PlacementMode ToPlacementMode(HelpTooltipPlacement placement) => placement switch
    {
        HelpTooltipPlacement.Bottom => PlacementMode.Bottom,
        HelpTooltipPlacement.Left => PlacementMode.Left,
        HelpTooltipPlacement.Right => PlacementMode.Right,
        _ => PlacementMode.Top,
    };

    private static FlyoutPlacementMode ToFlyoutPlacementMode(HelpTooltipPlacement placement) => placement switch
    {
        HelpTooltipPlacement.Bottom => FlyoutPlacementMode.Bottom,
        HelpTooltipPlacement.Left => FlyoutPlacementMode.Left,
        HelpTooltipPlacement.Right => FlyoutPlacementMode.Right,
        _ => FlyoutPlacementMode.Top,
    };
}
