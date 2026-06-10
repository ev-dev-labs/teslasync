using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>AccordionSection</c> feature surface — a parity port of
/// web/src/features/system/components/status/AccordionSection.tsx. It is a purely presentational disclosure: it heads
/// a section with an optional accent glyph, a title and a muted description, reveals optional header badges, and
/// discloses the supplied body (the web <c>children</c>) when expanded. The web custom <c>role="button"</c> header +
/// <c>aria-expanded</c> + rotating <c>ChevronDown</c> + Enter/Space keyboard toggling is realised idiomatically with
/// the shared Fluent <see cref="TsAccordion"/> (an <c>Expander</c>), which contributes the disclosure chevron, the
/// expand/collapse animation, keyboard toggling and Narrator expanded-state for free; the web translucent
/// <c>GlassPanel</c> surface is the shared <see cref="TsGlassPanel"/> (the Expander's own header/content fills are
/// flattened so the glass card is the only surface); and the revealed body fades in via the reduce-motion-aware
/// <see cref="TsFadeIn"/> (the web <c>FadeIn</c>). The web source has no fetch lifecycle, so there is no loading /
/// error / stale / offline branch to reproduce — the two states are collapsed and expanded, plus a friendly empty
/// caption when an expanded section has no body (so the revealed region is never a blank box). The view never
/// performs HTTP; all icon / title / description resolution and the header Narrator name are computed in the
/// WinUI-free <see cref="AccordionSectionProjection"/>. The accent glyph is hidden from Narrator, the disclosure
/// header carries a composed Narrator name, and the open/closed state is spoken by the Expander itself.
/// </summary>
public sealed partial class AccordionSection : ContentControl
{
    private const double HeaderIconSize = 16;  // web icon h-4 w-4
    private const double HeaderSpacing = 12;    // web gap-3 (icon -> title column -> badges)
    private const double TitleGap = 2;          // web mt-0.5 (title -> description)
    private const double BadgeSpacing = 8;      // web badges gap-2
    private const double BodySpacing = 16;      // web body space-y-4
    private const double BodyPadding = 16;      // web body px-5 py-4
    private const double DividerThickness = 1;  // web body border-t

    private readonly ILocalizer _localizer;
    private readonly AccordionSectionDiagnostics _diagnostics;

    private readonly TsAccordion _expander = new();
    private readonly FontIcon _icon = new() { FontSize = HeaderIconSize, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _title = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _description = new() { TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _badgeHost = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = BadgeSpacing,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly TsFadeIn _fade = new();
    private readonly StackPanel _bodyStack = new() { Spacing = BodySpacing };
    private readonly TsEmptyState _empty = new();

    private readonly List<UIElement> _badges = [];

    private AccordionSectionModel _model;
    private UIElement? _body;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, a model, the optional body and header badges, and diagnostics.</summary>
    /// <param name="localizer">The i18n facade the empty-body caption resolves through.</param>
    /// <param name="model">The render model (icon glyph, title, description, default-open).</param>
    /// <param name="body">The content revealed when expanded (the web <c>children</c>), or null.</param>
    /// <param name="badges">The header badges shown beside the chevron (the web <c>badges</c>), or null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AccordionSection(
        ILocalizer localizer,
        AccordionSectionModel model,
        UIElement? body = null,
        IReadOnlyList<UIElement>? badges = null,
        AccordionSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(model);

        _localizer = localizer;
        _model = model;
        _diagnostics = diagnostics ?? new AccordionSectionDiagnostics();
        _body = body;
        if (badges is not null)
        {
            _badges.AddRange(badges);
        }

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();

        Loaded += OnLoaded;

        Render();
        _expander.IsExpanded = _model.DefaultOpen;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>AccordionSection</c>).</summary>
    public static string Slug => AccordionSectionRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the header.</summary>
    public AccordionSectionModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The content revealed when expanded (the web <c>children</c>); reassigning re-renders the body.</summary>
    public UIElement? Body
    {
        get => _body;
        set
        {
            _body = value;
            RenderBody();
        }
    }

    /// <summary>The header badges (the web <c>badges</c>); reassigning rebuilds the badge row.</summary>
    public IReadOnlyList<UIElement> Badges
    {
        get => _badges;
        set
        {
            _badges.Clear();
            if (value is not null)
            {
                _badges.AddRange(value);
            }

            RenderBadges();
        }
    }

    private void BuildChrome()
    {
        // Accent glyph: web `text-cyan-400`, decorative (its meaning is carried by the header Narrator name).
        AutomationProperties.SetAccessibilityView(_icon, AccessibilityView.Raw);
        _icon.Foreground = DisplayTokens.Accent;

        _title.FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14);   // web text-sm
        _title.FontWeight = FontWeights.SemiBold;                            // web font-semibold
        _title.Foreground = DisplayTokens.TextPrimary;                       // web text-[var(--text-primary)]

        _description.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12); // web text-xs
        _description.Foreground = DisplayTokens.TextMuted;                          // web text-[var(--text-muted)]
        _description.Margin = new Thickness(0, TitleGap, 0, 0);                      // web mt-0.5

        var titleColumn = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(_title);
        titleColumn.Children.Add(_description);

        // web header: icon | title/description (flex-1 min-w-0) | badges | chevron (the chevron is the Expander's).
        var header = new Grid { ColumnSpacing = HeaderSpacing, VerticalAlignment = VerticalAlignment.Center };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(titleColumn, 1);
        Grid.SetColumn(_badgeHost, 2);
        header.Children.Add(_icon);
        header.Children.Add(titleColumn);
        header.Children.Add(_badgeHost);

        // web body: `border-t ... px-5 py-4 space-y-4`, faded in (web FadeIn) when expanded.
        var body = new Border
        {
            BorderThickness = new Thickness(0, DividerThickness, 0, 0),
            BorderBrush = DisplayTokens.Border,
            Padding = new Thickness(BodyPadding),
            Child = _bodyStack,
        };
        _fade.Content = body;

        _expander.Header = header;
        _expander.Content = _fade;
        _expander.Background = Transparent;
        _expander.BorderThickness = new Thickness(0);
        FlattenExpanderSurface(_expander);

        // web `<GlassPanel className="overflow-hidden">`: the translucent card is the only surface; the flattened
        // Expander supplies the disclosure behaviour inside it.
        var panel = new TsGlassPanel { Padding = new Thickness(0), Content = _expander };
        Content = panel;
    }

    private static void FlattenExpanderSurface(TsAccordion expander)
    {
        // Let the surrounding GlassPanel be the only card surface by clearing the Expander's own header/content
        // fills; its hover and divider visuals remain (mapping the web `hover:bg` + `border-t`).
        Brush transparent = Transparent;
        expander.Resources["ExpanderHeaderBackground"] = transparent;
        expander.Resources["ExpanderContentBackground"] = transparent;
        expander.Resources["ExpanderHeaderBorderBrush"] = transparent;
    }

    private static SolidColorBrush Transparent => new(Microsoft.UI.Colors.Transparent);

    private void Render()
    {
        AccordionSectionDisplay display = AccordionSectionProjection.Project(_model, _localizer);

        _icon.Glyph = display.IconGlyph ?? string.Empty;
        _icon.Visibility = display.HasIcon ? Visibility.Visible : Visibility.Collapsed;

        _title.Text = display.Title;
        _title.Visibility = display.HasTitle ? Visibility.Visible : Visibility.Collapsed;

        _description.Text = display.Description;
        _description.Visibility = display.HasDescription ? Visibility.Visible : Visibility.Collapsed;

        AutomationProperties.SetName(_expander, display.AutomationName);
        _empty.Message = display.EmptyMessage;

        RenderBadges();
        RenderBody();
    }

    private void RenderBadges()
    {
        _badgeHost.Children.Clear();
        foreach (UIElement badge in _badges)
        {
            _badgeHost.Children.Add(badge);
        }

        _badgeHost.Visibility = _badges.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderBody()
    {
        _bodyStack.Children.Clear();

        // Web parity reveals the children verbatim; a section opened with no body shows a friendly caption instead
        // of a blank box (the project-wide "always show a fallback" rule).
        _bodyStack.Children.Add(_body ?? _empty);
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

    protected override AutomationPeer OnCreateAutomationPeer() => new AccordionSectionAutomationPeer(this);

    private sealed class AccordionSectionAutomationPeer(AccordionSection owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
