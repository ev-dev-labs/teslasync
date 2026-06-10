using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>FSMSubFSMPanel</c> feature surface — a parity port of
/// <c>web/src/features/system/components/FSMSubFSMPanel.tsx</c>. It is a presentational panel: assign a
/// <see cref="Model"/> (the web <c>fsmType</c> + <c>activeSubs</c> props) and it renders exactly one of three
/// branches — <see cref="FSMSubFSMPanelState.Hidden"/> (the web <c>return null</c> for non-vehicle FSM views; the
/// surface collapses), <see cref="FSMSubFSMPanelState.Empty"/> (the panel chrome over a friendly
/// <see cref="TsEmptyState"/>, never a blank box) or <see cref="FSMSubFSMPanelState.Populated"/> (the web render:
/// a responsive one/two-column grid of sub-FSM rows, each a tokenized card with a leading car / lightning glyph in
/// a live-tinted box, the localized session label, a pulsing live indicator, the state badge and the relative
/// start time). The panel is a tokenized <see cref="TsGlassPanel"/> with an uppercase <see cref="Label"/> heading;
/// all branch selection, copy resolution, colour resolution and time formatting happen in the WinUI-free
/// <see cref="FSMSubFSMPanelProjection"/>. Every string resolves through the i18n facade, the decorative glyphs and
/// the live pulse are hidden from Narrator, each row carries a composed Narrator name, and the surface exposes a
/// grouped automation peer. There is no fetch-driven loading / error / stale / offline branch in this surface: the
/// web component takes resolved props, so the parent State-Machine page owns the query lifecycle and its
/// loading / error / freshness chrome.
/// </summary>
public sealed partial class FSMSubFSMPanel : ContentControl
{
    private const double PanelPadding = 16;       // web GlassPanel p-4
    private const double HeaderGap = 12;          // web mb-3 (title ↔ grid)
    private const double GridGutter = 12;         // web gap-3
    private const double GridItemMinWidth = 260;  // web grid-cols-1 md:grid-cols-2 breakpoint
    private const double RowPadding = 12;          // web row p-3
    private const double RowGap = 12;              // web gap-3 (icon box ↔ body)
    private const double BodyRowGap = 8;           // web gap-2 (label ↔ pulse, badge ↔ time)
    private const double BodyColumnGap = 4;        // web mt-1
    private const double IconBoxPadding = 8;       // web p-2
    private const double IconSize = 16;            // web h-4 w-4
    private const double PulseDotSize = 6;         // web h-1.5 w-1.5
    private const double StateDotSize = 6;         // web StateBadge dot
    private const double LabelFontSize = 12;       // web text-xs label
    private const double BadgeFontSize = 12;       // web StateBadge text-xs
    private const double TimeFontSize = 11;        // web text-[10px] timestamp
    private const byte ActiveBoxAlpha = 28;        // web bg-green-500/10 (~0.1 tint)

    private readonly ILocalizer _localizer;
    private readonly FSMSubFSMPanelDiagnostics _diagnostics;

    private FSMSubFSMPanelModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="FSMSubFSMPanelModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FSMSubFSMPanel(
        ILocalizer localizer,
        FSMSubFSMPanelModel? model = null,
        FSMSubFSMPanelDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? FSMSubFSMPanelModel.Empty;
        _diagnostics = diagnostics ?? new FSMSubFSMPanelDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>FSMSubFSMPanel</c>).</summary>
    public static string Slug => FSMSubFSMPanelRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public FSMSubFSMPanelModel Model
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
        var display = FSMSubFSMPanelProjection.Project(_model, _localizer, DateTimeOffset.Now);
        AutomationProperties.SetName(this, display.AutomationName);

        switch (display.State)
        {
            case FSMSubFSMPanelState.Hidden:
                // web: `if (!isVehicleView) return null` — collapse so the panel occupies no space.
                Visibility = Visibility.Collapsed;
                Content = null;
                break;

            case FSMSubFSMPanelState.Empty:
                Visibility = Visibility.Visible;
                Content = BuildEmpty(display);
                break;

            default:
                Visibility = Visibility.Visible;
                Content = BuildPopulated(display);
                break;
        }
    }

    private static TsGlassPanel BuildEmpty(FSMSubFSMPanelDisplay display)
    {
        var empty = new TsEmptyState { Message = display.EmptyMessage };
        LiveRegion.Configure(empty);
        LiveRegion.Announce(empty);
        return BuildPanel(display.Title, empty);
    }

    private static TsGlassPanel BuildPopulated(FSMSubFSMPanelDisplay display)
    {
        var grid = new TsGrid
        {
            Columns = 2,
            Gutter = GridGutter,
            ItemMinWidth = GridItemMinWidth,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };

        foreach (var row in display.Rows)
        {
            grid.Children.Add(BuildRow(row));
        }

        return BuildPanel(display.Title, grid);
    }

    private static TsGlassPanel BuildPanel(string title, UIElement body)
    {
        var heading = new Label { Value = title };
        AutomationProperties.SetHeadingLevel(heading, AutomationHeadingLevel.Level2);

        var column = new StackPanel { Orientation = Orientation.Vertical, Spacing = HeaderGap };
        column.Children.Add(heading);
        column.Children.Add(body);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private static Border BuildRow(FSMSubFSMPanelRow row)
    {
        var layout = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = RowGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        layout.Children.Add(BuildIconBox(row));
        layout.Children.Add(BuildBody(row));

        var card = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(RowPadding),
            Child = layout,
        };

        AutomationProperties.SetName(card, row.AutomationName);
        AutomationProperties.SetAccessibilityView(card, AccessibilityView.Content);
        return card;
    }

    private static Border BuildIconBox(FSMSubFSMPanelRow row)
    {
        var icon = new FontIcon
        {
            Glyph = row.IconGlyph,
            FontSize = IconSize,
            Foreground = row.IsActive ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — the row's kind is already in the localized label and the surface Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        return new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            Padding = new Thickness(IconBoxPadding),
            Background = row.IsActive ? ActiveIconBackground() : DisplayTokens.Surface,
            Child = icon,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private static StackPanel BuildBody(FSMSubFSMPanelRow row)
    {
        var labelRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = BodyRowGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        labelRow.Children.Add(new TextBlock
        {
            Text = row.Label,
            FontSize = LabelFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (row.IsActive)
        {
            labelRow.Children.Add(BuildPulseDot());
        }

        var metaRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = BodyRowGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        metaRow.Children.Add(BuildStateBadge(row));
        metaRow.Children.Add(new TextBlock
        {
            Text = row.StartTimeText,
            FontSize = TimeFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var body = new StackPanel
        {
            Orientation = Orientation.Vertical,
            Spacing = BodyColumnGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        body.Children.Add(labelRow);
        body.Children.Add(metaRow);
        return body;
    }

    // Port of the web StateBadge: a pill with a leading dot + the state text, tinted by the resolved variant.
    private static Border BuildStateBadge(FSMSubFSMPanelRow row)
    {
        Brush accent = row.NeutralState
            ? DisplayTokens.TextMuted
            : DisplayTokens.Brush(SeverityLevels.Tokens(row.StateSeverity).AccentBrushKey);

        var content = DisplayPrimitives.Row(BodyRowGap / 2);
        content.Children.Add(DisplayPrimitives.Dot(accent, StateDotSize));
        content.Children.Add(new TextBlock
        {
            Text = row.StateText,
            FontSize = BadgeFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var pill = DisplayPrimitives.Pill(content, accent);
        AutomationProperties.SetName(pill, row.StateText);
        return pill;
    }

    private static Ellipse BuildPulseDot()
    {
        var dot = new Ellipse
        {
            Width = PulseDotSize,
            Height = PulseDotSize,
            Fill = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative live indicator — the live state is already conveyed by the badge + Narrator name.
        AutomationProperties.SetAccessibilityView(dot, AccessibilityView.Raw);

        // web `animate-pulse` — gated on the reduce-motion system preference.
        if (!MotionPreference.ReduceMotion)
        {
            PulseHelper.Attach(dot);
        }

        return dot;
    }

    // web `bg-green-500/10` — a low-opacity success tint derived from the success colour token (theming still
    // flows through the token; the alpha is the only literal, mirroring the web's /10 opacity step).
    private static Brush ActiveIconBackground()
    {
        if (Application.Current?.Resources is { } resources &&
            resources.TryGetValue("TsColorSuccessColor", out var value) &&
            value is Windows.UI.Color color)
        {
            return new SolidColorBrush(Windows.UI.Color.FromArgb(ActiveBoxAlpha, color.R, color.G, color.B));
        }

        return DisplayTokens.Surface;
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new FSMSubFSMPanelAutomationPeer(this);

    private sealed class FSMSubFSMPanelAutomationPeer(FSMSubFSMPanel owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
