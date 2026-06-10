using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.UI.Text;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Fsm;

/// <summary>
/// The native WinUI 3 <c>FSMHealthPanel</c> feature surface — a parity port of
/// web/src/features/system/components/FSMHealthPanel.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the web <c>transitions</c> prop) and it renders exactly one of the two web branches —
/// <see cref="FsmHealthPanelState.AllClear"/> (a <see cref="TsGlassPanel"/> holding the green status dot + the
/// "All FSMs healthy …" line, the web's <c>alerts.length === 0</c> branch) or
/// <see cref="FsmHealthPanelState.Alerts"/> (a <see cref="TsGlassPanel"/> with the uppercase "FSM Health" title and
/// a responsive grid of flap / stuck / recovery alert cards — one column when narrow, one column per alert when
/// wide, mirroring the web <c>Grid cols={{ default: 1, md: alerts.length }}</c>). Each alert card reproduces the
/// web composition: a tinted, hairline-bordered rounded panel holding the severity-tinted Segoe Fluent glyph, the
/// alert title + message, and the large bold count. The view never performs HTTP; all branch selection, detection,
/// label resolution and formatting happen in the WinUI-free <see cref="FsmHealthPanelProjection"/>. Severity tints
/// resolve from the W1 status tokens (warning → amber, info → blue, all-clear → green) rather than ported Tailwind
/// classes; the decorative glyphs are hidden from Narrator (the card carries the spoken name), every string
/// resolves through the i18n facade, and the surface + each card carry a Narrator name.
/// </summary>
public sealed partial class FSMHealthPanel : ContentControl
{
    private const double PanelPadding = 16;       // web p-4
    private const double SectionSpacing = 12;     // web title mb-3 / grid gap-3
    private const double CardPadding = 12;        // web p-3
    private const double CardSpacing = 12;        // web gap-3
    private const double CardCorner = 8;          // web rounded-lg
    private const double IconSize = 16;           // web h-4 w-4
    private const double DotSize = 8;             // web h-2 w-2
    private const double TitleFontSize = 12;      // web text-xs
    private const double MessageFontSize = 12;    // web text-xs
    private const double CountFontSize = 18;      // web text-lg
    private const double AllClearFontSize = 14;   // web text-sm
    private const double StackBreakpointPx = 768; // web md: breakpoint (single column below it)
    private const double BorderTintOpacity = 0.2; // web border-{color}/20
    private const double FillTintOpacity = 0.06;  // web bg-{color}/5

    private readonly ILocalizer _localizer;
    private readonly FsmHealthPanelDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private FsmHealthPanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics/clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="FsmHealthPanelModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock for the deterministic stuck-session age window in tests.</param>
    public FSMHealthPanel(
        ILocalizer localizer,
        FsmHealthPanelModel? model = null,
        FsmHealthPanelDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? FsmHealthPanelModel.Empty;
        _diagnostics = diagnostics ?? new FsmHealthPanelDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>FSMHealthPanel</c>).</summary>
    public static string Slug => FsmHealthPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public FsmHealthPanelModel Model
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
        FsmHealthPanelDisplay display = FsmHealthPanelProjection.Project(_model, _localizer, _clock());

        UIElement surface = display.State == FsmHealthPanelState.AllClear
            ? BuildAllClear(display)
            : BuildAlerts(display);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = surface;
    }

    // ── All clear (web alerts.length === 0: a green dot + the "All FSMs healthy …" line) ───────────────
    private static TsGlassPanel BuildAllClear(FsmHealthPanelDisplay display)
    {
        Brush success = DisplayTokens.Brush("TsColorSuccessBrush");

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new Ellipse
        {
            Width = DotSize,
            Height = DotSize,
            Fill = success,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = display.AllClearText,
            FontSize = AllClearFontSize,
            Foreground = success,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return Box(row, display.AutomationName);
    }

    // ── Alerts (web alerts.length > 0: titled panel + responsive grid of alert cards) ──────────────────
    private static TsGlassPanel BuildAlerts(FsmHealthPanelDisplay display)
    {
        var stack = new StackPanel { Spacing = SectionSpacing };
        stack.Children.Add(new Label { Value = display.Title });

        var cards = new List<FrameworkElement>(display.Alerts.Count);
        foreach (FsmHealthAlertView alert in display.Alerts)
        {
            cards.Add(BuildCard(alert));
        }

        stack.Children.Add(BuildAlertGrid(cards));
        return Box(stack, display.AutomationName);
    }

    // web: flex items-start gap-3 rounded-lg border p-3, tinted by severity.
    private static Border BuildCard(FsmHealthAlertView alert)
    {
        Brush accent = DisplayTokens.Brush(alert.AccentBrushKey);
        (Brush border, Brush fill) = TintFor(alert.AccentColorKey);

        var grid = new Grid { ColumnSpacing = CardSpacing, VerticalAlignment = VerticalAlignment.Top };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = alert.IconGlyph,
            FontSize = IconSize,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, 2, 0, 0),
        };

        // Decorative — the card's Narrator name already conveys the alert title, message and count.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        Grid.SetColumn(icon, 0);
        grid.Children.Add(icon);

        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        text.Children.Add(new TextBlock
        {
            Text = alert.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            TextWrapping = TextWrapping.Wrap,
        });
        text.Children.Add(new TextBlock
        {
            Text = alert.Message,
            FontSize = MessageFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);

        var count = new TextBlock
        {
            Text = alert.CountText,
            FontSize = CountFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(8, 0, 0, 0),
        };
        Grid.SetColumn(count, 2);
        grid.Children.Add(count);

        var card = new Border
        {
            BorderThickness = new Thickness(1),
            BorderBrush = border,
            Background = fill,
            CornerRadius = new CornerRadius(CardCorner),
            Padding = new Thickness(CardPadding),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            Child = grid,
        };
        AutomationProperties.SetName(card, alert.AutomationName);
        return card;
    }

    // web Grid cols={{ default: 1, md: alerts.length }} gap={3}: one column when narrow, one column per card when
    // wide. The reflow runs on resize (cheap for the at-most-three cards) so the surface adapts to the window and
    // honours the system layout without a fixed column count.
    private static Grid BuildAlertGrid(List<FrameworkElement> cards)
    {
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };

        void Reflow(double width)
        {
            grid.ColumnDefinitions.Clear();
            grid.RowDefinitions.Clear();

            bool wide = width >= StackBreakpointPx && cards.Count > 1;
            if (wide)
            {
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                for (int i = 0; i < cards.Count; i++)
                {
                    grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                    Grid.SetColumn(cards[i], i);
                    Grid.SetRow(cards[i], 0);
                }
            }
            else
            {
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                for (int i = 0; i < cards.Count; i++)
                {
                    grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                    Grid.SetColumn(cards[i], 0);
                    Grid.SetRow(cards[i], i);
                }
            }
        }

        foreach (FrameworkElement card in cards)
        {
            grid.Children.Add(card);
        }

        grid.SizeChanged += (_, e) => Reflow(e.NewSize.Width);
        Reflow(0);
        return grid;
    }

    private static TsGlassPanel Box(UIElement content, string automationName)
    {
        var panel = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
        AutomationProperties.SetName(panel, automationName);
        AutomationProperties.SetAccessibilityView(panel, AccessibilityView.Content);
        return panel;
    }

    // web border-{color}/20 + bg-{color}/5: a hairline border and a faint fill derived from the same status colour
    // token at the web's opacities, so the card tints match light / dark / high-contrast themes.
    private static (Brush Border, Brush Fill) TintFor(string accentColorKey)
    {
        Windows.UI.Color color = ResolveColor(accentColorKey);
        return (
            new SolidColorBrush(color) { Opacity = BorderTintOpacity },
            new SolidColorBrush(color) { Opacity = FillTintOpacity });
    }

    private static Windows.UI.Color ResolveColor(string key)
    {
        if (Application.Current?.Resources is { } resources && resources.TryGetValue(key, out object? value))
        {
            if (value is Windows.UI.Color color)
            {
                return color;
            }

            if (value is SolidColorBrush brush)
            {
                return brush.Color;
            }
        }

        return Microsoft.UI.Colors.Transparent;
    }
}
