using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemStatus;

/// <summary>
/// The native WinUI 3 <c>UpdateAvailableCallout</c> feature surface — a parity port of
/// web/src/features/system/components/status/UpdateAvailableCallout.tsx. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>current</c> / <c>latest</c> / <c>checkedAt</c> props)
/// and it renders the web layout inside a tokenized cyan-bordered glass panel (the web
/// <c>GlassPanel</c> with <c>border-cyan-400/20 bg-cyan-500/[0.06]</c>) — a decorative Sparkles
/// <see cref="FontIcon"/>, a title + secondary-body column (the headline with its optional version suffix,
/// the optional "You're running v…" lead-in, the review-the-notes copy and the optional muted "Last
/// checked …" stamp), and a trailing "View notes" <see cref="HyperlinkButton"/> that opens the GitHub
/// release-notes page. The view never performs HTTP; the headline / body / stamp composition, the date
/// formatting and every label resolution happen in the WinUI-free
/// <see cref="UpdateAvailableCalloutProjection"/>. The accent is the generated cyan token (so light / dark /
/// high-contrast all flow from the token set), the panel is announced as a polite live region (the web
/// <c>role="status" aria-live="polite"</c>), the icons are hidden from Narrator, the action carries its own
/// Narrator name, and the surface carries a single composed Narrator name. Every string resolves through the
/// i18n facade.
/// </summary>
public sealed partial class UpdateAvailableCallout : ContentControl
{
    private const double IconFontSize = 20;        // web `h-5 w-5`
    private const double TitleFontSize = 14;       // web `text-sm`
    private const double BodyFontSize = 12;        // web `text-xs`
    private const double ActionFontSize = 12;      // web `text-xs`
    private const double ActionIconFontSize = 14;  // web `h-3.5 w-3.5`
    private const double RowSpacing = 12;          // web `gap-3`
    private const double ActionSpacing = 6;        // web `gap-1.5`
    private const double TitleBodySpacing = 2;     // web `mt-0.5`
    private const double PanelPadding = 16;        // web `p-4`
    private const double ActionMinHeight = 36;     // web `min-h-[36px]`
    private const double ActionPaddingX = 12;      // web `px-3`
    private const double ActionPaddingY = 6;       // web `py-1.5`
    private const double ActionRadius = 6;         // web `rounded-md`
    private const double ChipFillOpacity = 0.15;   // web `bg-cyan-500/15`
    private const double ChipRingOpacity = 0.30;   // web `ring-cyan-400/30`
    private const double PanelRadiusFallback = 16; // web `GlassPanel` rounded corner

    private const string PanelBackgroundKey = "TsColorSurfaceGlassBrush"; // web `GlassPanel` surface
    private const string PanelRadiusKey = "TsRadiusLg";                   // web `GlassPanel` rounded corner
    private const string MiddotSeparator = " \u00B7 ";                    // web ` · ` before the last-checked stamp

    private readonly ILocalizer _localizer;
    private readonly UpdateAvailableCalloutDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private UpdateAvailableCalloutModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, diagnostics and clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="UpdateAvailableCalloutModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock backing the date formatter; defaults to system time.</param>
    public UpdateAvailableCallout(
        ILocalizer localizer,
        UpdateAvailableCalloutModel? model = null,
        UpdateAvailableCalloutDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? UpdateAvailableCalloutModel.Empty;
        _diagnostics = diagnostics ?? new UpdateAvailableCalloutDiagnostics();
        _clock = clock ?? (static () => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>UpdateAvailableCallout</c>).</summary>
    public static string Slug => UpdateAvailableCalloutRegistration.Slug;

    /// <summary>The render model (the web props); reassigning re-projects and re-renders the surface.</summary>
    public UpdateAvailableCalloutModel Model
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
        var display = UpdateAvailableCalloutProjection.Project(_model, _localizer, _clock());
        Brush accent = DisplayTokens.Brush(display.AccentBrushKey);

        // Web `flex items-start gap-3`: icon | text column | action, each top-aligned.
        var grid = new Grid { ColumnSpacing = RowSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Web `shrink-0 text-cyan-300` Sparkles mark — decorative (aria-hidden).
        var icon = new FontIcon
        {
            Glyph = display.IconGlyph,
            FontSize = IconFontSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        grid.Children.Add(BuildText(display));
        grid.Children.Add(BuildAction(display, accent));

        var panel = BuildPanel(grid);

        // Web `role="status" aria-live="polite"`: announce the callout politely when it appears / changes.
        LiveRegion.Configure(panel);
        LiveRegion.Announce(panel);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = panel;
    }

    // Web `flex-1 min-w-0`: the title over the secondary body paragraph.
    private static StackPanel BuildText(UpdateAvailableCalloutDisplay display)
    {
        var column = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

        // Web `text-sm font-semibold text-[var(--text-primary)]`.
        column.Children.Add(new TextBlock
        {
            Text = display.TitleText,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });

        // Web `text-xs text-[var(--text-secondary)] mt-0.5`, with the last-checked stamp in `text-muted`.
        var body = new TextBlock
        {
            FontSize = BodyFontSize,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, TitleBodySpacing, 0, 0),
        };
        body.Inlines.Add(new Run { Text = display.BodyText, Foreground = DisplayTokens.TextSecondary });
        if (display.HasLastChecked)
        {
            body.Inlines.Add(new Run
            {
                Text = string.Concat(MiddotSeparator, display.LastCheckedText),
                Foreground = DisplayTokens.TextMuted,
            });
        }

        column.Children.Add(body);
        Grid.SetColumn(column, 1);
        return column;
    }

    // Web `<a target="_blank" rel="noopener noreferrer">`: a cyan chip link that opens the release notes.
    private static HyperlinkButton BuildAction(UpdateAvailableCalloutDisplay display, Brush accent)
    {
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ActionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        content.Children.Add(new TextBlock
        {
            Text = display.ViewNotesText,
            FontSize = ActionFontSize,
            FontWeight = FontWeights.Medium,
            VerticalAlignment = VerticalAlignment.Center,
        });
        var actionIcon = new FontIcon
        {
            Glyph = display.ActionIconGlyph,
            FontSize = ActionIconFontSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(actionIcon, AccessibilityView.Raw);
        content.Children.Add(actionIcon);

        var action = new HyperlinkButton
        {
            Content = content,
            NavigateUri = display.ReleaseNotesUri,
            Foreground = accent,
            Background = Tint(display.AccentBrushKey, ChipFillOpacity),
            BorderBrush = Tint(display.AccentBrushKey, ChipRingOpacity),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(ActionRadius),
            Padding = new Thickness(ActionPaddingX, ActionPaddingY, ActionPaddingX, ActionPaddingY),
            MinHeight = ActionMinHeight,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(action, display.ViewNotesText);
        Grid.SetColumn(action, 2);
        return action;
    }

    private static Border BuildPanel(UIElement content) => new()
    {
        Child = content,
        Background = DisplayTokens.Brush(PanelBackgroundKey),
        BorderBrush = DisplayTokens.Brush(UpdateAvailableCalloutRegistration.AccentBrushKey),
        BorderThickness = new Thickness(1),
        CornerRadius = DisplayTokens.Radius(PanelRadiusKey, PanelRadiusFallback),
        Padding = new Thickness(PanelPadding),
    };

    // Derive a translucent accent fill / ring from a solid token colour (web `/15` and `/30` alpha steps).
    private static Brush Tint(string brushKey, double opacity)
    {
        Brush brush = DisplayTokens.Brush(brushKey);
        return brush is SolidColorBrush solid
            ? new SolidColorBrush(solid.Color) { Opacity = opacity }
            : brush;
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new UpdateAvailableCalloutAutomationPeer(this);

    private sealed class UpdateAvailableCalloutAutomationPeer(UpdateAvailableCallout owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
