using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SecurityAccess;

/// <summary>
/// The native WinUI 3 <c>WindowStatusDetail</c> feature surface — a parity port of
/// <c>web/src/features/admin/components/security-access/WindowStatusDetail.tsx</c>. It is a pure presentational
/// control: assign a <see cref="Model"/> (the web <c>latest</c> prop, narrowed to the four window fields) and
/// it renders the web layout inside a <see cref="TsFadeIn"/> (the web <c>FadeIn delay={0.15}</c>) — a
/// <see cref="SectionTitle"/> heading over a responsive four-up <see cref="TsGrid"/> (the web
/// <c>grid-cols-1 sm:grid-cols-2 lg:grid-cols-4</c>), one <see cref="TsGlassPanel"/> per window carrying a
/// muted <see cref="Caption"/> label and a bold, state-tinted caption. The view never performs HTTP; all state
/// parsing, label resolution and colour selection happen in the WinUI-free
/// <see cref="WindowStatusDetailProjection"/> (so there is no fetch-driven loading / empty / error / stale /
/// offline branch to reproduce here — the web component never fetches; those states live on the hosting
/// Security &amp; Access page, which re-renders this surface with already-resolved props). A missing
/// <c>latest</c> maps to <see cref="WindowStatusDetailModel.Empty"/>, rendering every panel in the
/// <see cref="WindowState.Unknown"/> state — the web's no-data surface. The accent is the generated status
/// design token (so light / dark / high-contrast all flow from the token set), each panel carries a single
/// composed Narrator name, the decorative inner texts are hidden from Narrator, the title is exposed as a
/// level-2 heading, and every label resolves through the i18n facade.
/// </summary>
public sealed partial class WindowStatusDetail : ContentControl
{
    private const int FadeDelayMs = 150;             // web `delay={0.15}` (0.15 s)
    private const double TitleBottomMargin = 12;     // web `mb-3`
    private const double GridBottomMargin = 24;      // web `mb-6`
    private const double LabelBottomMargin = 4;      // web `mb-1`
    private const double PanelPadding = 16;          // web `p-4`
    private const double StateFontSize = 20;         // web `text-xl`
    private const double ColumnGutter = 16;          // web `gap-4`
    private const double PanelMinWidth = 180;        // collapses 4→2→1 columns like the web breakpoints
    private const double BackgroundTintOpacity = 0.18; // web `bg-{color}-500/20`
    private const double BorderTintOpacity = 0.4;      // web `border-{color}-500/40`

    private readonly ILocalizer _localizer;
    private readonly WindowStatusDetailDiagnostics _diagnostics;

    private WindowStatusDetailModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, the window data to render, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The window data to render (the web <c>latest</c> prop, narrowed); defaults to <see cref="WindowStatusDetailModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WindowStatusDetail(
        ILocalizer localizer,
        WindowStatusDetailModel? model = null,
        WindowStatusDetailDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? WindowStatusDetailModel.Empty;
        _diagnostics = diagnostics ?? new WindowStatusDetailDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>WindowStatusDetail</c>).</summary>
    public static string Slug => WindowStatusDetailRegistration.Slug;

    /// <summary>The render model (the four window values); reassigning re-projects and re-renders the surface.</summary>
    public WindowStatusDetailModel Model
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
        WindowStatusDetailDisplay display = WindowStatusDetailProjection.Project(_model, _localizer);

        // Web `<h2 class="text-lg font-semibold text-gray-200 mb-3">`.
        var title = new SectionTitle
        {
            Value = display.Title,
            Foreground = DisplayTokens.TextSecondary,
            Margin = new Thickness(0, 0, 0, TitleBottomMargin),
        };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level2);

        // Web `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6`.
        var grid = new TsGrid
        {
            Columns = display.Panels.Count,
            Gutter = ColumnGutter,
            ItemMinWidth = PanelMinWidth,
            Margin = new Thickness(0, 0, 0, GridBottomMargin),
        };
        foreach (WindowPanelDisplay panel in display.Panels)
        {
            grid.Children.Add(BuildPanel(panel));
        }

        var stack = new StackPanel();
        stack.Children.Add(title);
        stack.Children.Add(grid);

        Content = new TsFadeIn { DelayMs = FadeDelayMs, Content = stack };
    }

    // Web `<GlassPanel class="p-4 border {windowColor}">` with a muted label over a bold, state-tinted value.
    private static TsGlassPanel BuildPanel(WindowPanelDisplay panel)
    {
        Brush accent = DisplayTokens.Brush(panel.AccentBrushKey);

        var label = new Caption
        {
            Value = panel.Label,
            Margin = new Thickness(0, 0, 0, LabelBottomMargin),
        };
        AutomationProperties.SetAccessibilityView(label, AccessibilityView.Raw);

        // Web `text-xl font-bold {windowTextClass}` — the colour is a dynamic, semantic status accent.
        var value = new TextBlock
        {
            Text = panel.StateText,
            FontSize = StateFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            TextWrapping = TextWrapping.Wrap,
        };
        AutomationProperties.SetAccessibilityView(value, AccessibilityView.Raw);

        var content = new StackPanel();
        content.Children.Add(label);
        content.Children.Add(value);

        // Web `bg-{color}-500/20`: a translucent state tint fills the panel interior behind the content
        // (the GlassPanel template's glass surface shows through, exactly like the web tint over the glass).
        var tint = new Border
        {
            Background = Tint(accent, BackgroundTintOpacity),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Padding = new Thickness(PanelPadding),
            Child = content,
        };

        var glass = new TsGlassPanel
        {
            Padding = new Thickness(0),                 // the tint layer owns the padding
            BorderBrush = Tint(accent, BorderTintOpacity), // web `border-{color}-500/40`
            Content = tint,
        };
        AutomationProperties.SetName(glass, panel.AutomationName);
        return glass;
    }

    // Returns a translucent copy of a solid token brush (the web `/20` and `/40` colour-with-alpha tints).
    private static Brush Tint(Brush brush, double opacity) =>
        brush is SolidColorBrush solid ? new SolidColorBrush(solid.Color) { Opacity = opacity } : brush;
}
