using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>HighlightCard</c> feature surface — a parity port of
/// web/src/features/analytics/components/weekly-digest/HighlightCard.tsx. It is a pure presentational card:
/// assign a <see cref="Model"/> (the web <c>icon</c> / <c>label</c> / <c>value</c> / <c>change</c> /
/// <c>subtitle</c> / <c>color</c> props) and it renders exactly one of three branches —
/// <see cref="HighlightCardState.Loading"/> (tokenized skeleton chrome while the parent digest resolves),
/// <see cref="HighlightCardState.Empty"/> (the card chrome over an em-dash stand-in when no value resolved,
/// never a blank box) or <see cref="HighlightCardState.Ready"/> (the web composition: the icon + label row, the
/// bold value, the optional success/danger change row with its trend glyph, and the optional muted subtitle).
/// The panel is a tokenized <see cref="TsGlassPanel"/> whose glow follows the web <c>glowMap[color]</c>; the
/// view never performs HTTP; all branch selection, glow / tone resolution and copy resolution happen in the
/// WinUI-free <see cref="HighlightCardProjection"/>. Every string resolves through the i18n facade, the
/// decorative icons are hidden from Narrator, and the surface carries a Narrator name in each state.
/// </summary>
public sealed partial class HighlightCard : ContentControl
{
    private const double PanelPadding = 20;       // web p-5
    private const double SectionSpacing = 8;      // web gap-2
    private const double ChangeSpacing = 4;       // web gap-1
    private const double LabelIconSize = 16;      // web icon (h-4 w-4)
    private const double ChangeIconSize = 14;     // web TrendingUp/Down (h-3.5 w-3.5)
    private const double ValueTrackingTight = -25; // web tracking-tight (-0.025em)
    private const double SkeletonLabelWidth = 96;
    private const double SkeletonValueWidth = 132;
    private const double SkeletonMetaWidth = 72;

    private readonly ILocalizer _localizer;
    private readonly HighlightCardDiagnostics _diagnostics;

    private HighlightCardModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade the loading / empty copy resolves through.</param>
    /// <param name="model">The initial render model; defaults to <see cref="HighlightCardModel.Pending"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public HighlightCard(
        ILocalizer localizer,
        HighlightCardModel? model = null,
        HighlightCardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? HighlightCardModel.Pending;
        _diagnostics = diagnostics ?? new HighlightCardDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>HighlightCard</c>).</summary>
    public static string Slug => HighlightCardRegistration.Slug;

    /// <summary>The render model; reassigning re-projects and re-renders the surface.</summary>
    public HighlightCardModel Model
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
        var display = HighlightCardProjection.Project(_model, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State switch
        {
            HighlightCardState.Loading => BuildLoading(display),
            HighlightCardState.Empty => BuildEmpty(display),
            _ => BuildReady(display),
        };
    }

    // ── Ready (the web render: label row + value + optional change + optional subtitle) ──────────────────
    private static TsGlassPanel BuildReady(HighlightCardDisplay display)
    {
        var column = Column();

        if (display.HasLabel || display.IconGlyph is not null)
        {
            column.Children.Add(BuildLabelRow(display));
        }

        column.Children.Add(BuildValue(display.Value, DisplayTokens.TextPrimary));

        if (display.HasChange)
        {
            column.Children.Add(BuildChange(display));
        }

        if (display.HasSubtitle)
        {
            column.Children.Add(BuildSubtitle(display.Subtitle));
        }

        return Panel(display.Glow, column);
    }

    // ── Empty (resolved, no value — em-dash stand-in, never a blank box) ──────────────────────────────────────
    private static TsGlassPanel BuildEmpty(HighlightCardDisplay display)
    {
        var column = Column();

        if (display.HasLabel || display.IconGlyph is not null)
        {
            column.Children.Add(BuildLabelRow(display));
        }

        // Keep the metric identity but show an em-dash where the value would be, plus a friendly caption.
        column.Children.Add(BuildValue(display.EmptyValueText, DisplayTokens.TextMuted));
        column.Children.Add(BuildSubtitle(display.EmptyMessage));

        var panel = Panel(display.Glow, column);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return panel;
    }

    // ── Loading (parent still resolving the value) ───────────────────────────────────────────────────────
    private static TsGlassPanel BuildLoading(HighlightCardDisplay display)
    {
        var column = Column();
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonLabelWidth, BlockHeight = 12, Radius = 6 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonValueWidth, BlockHeight = 26, Radius = 6 });
        column.Children.Add(new TsSkeleton { BlockWidth = SkeletonMetaWidth, BlockHeight = 12, Radius = 6 });

        var panel = Panel(display.Glow, column);
        AutomationProperties.SetName(column, display.LoadingLabel);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return panel;
    }

    private static StackPanel BuildLabelRow(HighlightCardDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = SectionSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (display.IconGlyph is { } glyph)
        {
            row.Children.Add(DecorativeIcon(glyph, LabelIconSize, DisplayTokens.TextSecondary));
        }

        if (display.HasLabel)
        {
            row.Children.Add(new TextBlock
            {
                Text = display.Label,
                FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
                Foreground = DisplayTokens.TextSecondary,
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return row;
    }

    private static TextBlock BuildValue(string value, Brush foreground) => new()
    {
        Text = value,
        FontSize = TypographyTokens.Size("TsTypeTitleFontSize", 24),
        FontWeight = FontWeights.Bold,
        Foreground = foreground,
        CharacterSpacing = (int)ValueTrackingTight,
        TextWrapping = TextWrapping.Wrap,
    };

    private static StackPanel BuildChange(HighlightCardDisplay display)
    {
        var accent = DisplayTokens.Brush(display.ChangeAccentKey);
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ChangeSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        string glyph = display.ChangePositive
            ? HighlightCardRegistration.TrendingUpGlyph
            : HighlightCardRegistration.TrendingDownGlyph;
        row.Children.Add(DecorativeIcon(glyph, ChangeIconSize, accent));

        row.Children.Add(new TextBlock
        {
            Text = display.ChangeText,
            FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
            FontWeight = FontWeights.Medium,
            Foreground = accent,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private static TextBlock BuildSubtitle(string subtitle) => new()
    {
        Text = subtitle,
        FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
    };

    private static FontIcon DecorativeIcon(string glyph, double fontSize, Brush foreground)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = fontSize,
            Foreground = foreground,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — its meaning is carried by the adjacent text and the surface Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static StackPanel Column() => new() { Spacing = SectionSpacing };

    private static TsGlassPanel Panel(HighlightGlow glow, UIElement content) => new()
    {
        Glow = ToGlassGlow(glow),
        Padding = new Thickness(PanelPadding),
        Content = content,
    };

    private static GlassGlow ToGlassGlow(HighlightGlow glow) => glow switch
    {
        HighlightGlow.Cyan => GlassGlow.Cyan,
        HighlightGlow.Green => GlassGlow.Green,
        HighlightGlow.Purple => GlassGlow.Purple,
        _ => GlassGlow.None,
    };
}
