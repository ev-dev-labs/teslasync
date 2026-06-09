using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The native WinUI 3 <c>DriveHighlightSlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/DriveHighlightSlide.tsx. It is a pure presentational control:
/// assign a <see cref="Model"/> (the <c>drive</c> / <c>label</c> / <c>emoji</c> props) and a <see cref="Units"/>
/// preference (the <c>useUnits</c> seam) and it renders exactly one of the web branches —
/// <see cref="DriveHighlightSlideState.Content"/> (the emoji, the label and the glass stats card: route,
/// distance, duration, efficiency and date) or <see cref="DriveHighlightSlideState.Empty"/> (the emoji over the
/// friendly "No drive data for this year" copy). The view never performs HTTP; all branch selection, unit
/// conversion, rounding and formatting happen in the WinUI-free <see cref="DriveHighlightSlideProjection"/>. The
/// content entrance is staggered through <see cref="TsStaggerContainer"/> (which honours the OS reduce-motion
/// setting), the card is a tokenized <see cref="TsGlassPanel"/>, every string resolves through the i18n facade,
/// the decorative route/stat icons are hidden from Narrator, and the surface carries a Narrator name in each
/// state.
/// </summary>
public sealed partial class DriveHighlightSlide : ContentControl
{
    private const double EmojiContentFontSize = 48;
    private const double EmojiEmptyFontSize = 56;
    private const double LabelFontSize = 18;
    private const double EmptyMessageFontSize = 20;
    private const double RouteFontSize = 14;
    private const double RouteIconFontSize = 14;
    private const double StatIconFontSize = 12;
    private const double AddressMaxWidth = 132;
    private const double CardMaxWidth = 360;

    private readonly ILocalizer _localizer;
    private readonly DriveHighlightSlideDiagnostics _diagnostics;

    private DriveHighlightSlideModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, a unit preference and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="DriveHighlightSlideModel.Empty"/>.</param>
    /// <param name="units">The active unit preference; defaults to <see cref="UnitPref.Metric"/> (the <c>useUnits</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DriveHighlightSlide(
        ILocalizer localizer,
        DriveHighlightSlideModel? model = null,
        UnitPref? units = null,
        DriveHighlightSlideDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? DriveHighlightSlideModel.Empty;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new DriveHighlightSlideDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>DriveHighlightSlide</c>).</summary>
    public static string Slug => DriveHighlightSlideRegistration.Slug;

    /// <summary>The render model (drive / label / emoji); reassigning re-projects and re-renders the surface.</summary>
    public DriveHighlightSlideModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    /// <summary>The active unit preference; reassigning re-projects the slide in the new units and re-renders.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _units = value;
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
        var display = DriveHighlightSlideProjection.Project(_model, _units, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State == DriveHighlightSlideState.Empty
            ? BuildEmpty(display)
            : BuildContent(display);
    }

    // ── Empty (web !drive) ──────────────────────────────────────────────────────────────────────────
    private static StackPanel BuildEmpty(DriveHighlightSlideDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 16,
            Padding = new Thickness(32, 0, 32, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(Emoji(display.Emoji, EmojiEmptyFontSize));

        var message = new TextBlock
        {
            Text = display.EmptyMessage,
            FontSize = EmptyMessageFontSize,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        column.Children.Add(message);

        AutomationProperties.SetName(column, display.EmptyMessage);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    // ── Content (web drive) ─────────────────────────────────────────────────────────────────────────
    private static TsStaggerContainer BuildContent(DriveHighlightSlideDisplay display)
    {
        // Web parity: the emoji, label and card enter on a stagger (framer-motion spring + delayed slides);
        // TsStaggerContainer reproduces that and collapses to an instant reveal under OS reduce-motion.
        var stagger = new TsStaggerContainer
        {
            Spacing = 14,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        stagger.Add(Emoji(display.Emoji, EmojiContentFontSize));
        stagger.Add(BuildLabel(display.Label));
        stagger.Add(BuildCard(display));
        return stagger;
    }

    private static TextBlock Emoji(string emoji, double fontSize)
    {
        var text = new TextBlock
        {
            Text = emoji,
            FontSize = fontSize,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        // Decorative — the surface's Narrator name already carries the label and stats.
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        return text;
    }

    private static TextBlock BuildLabel(string label) => new()
    {
        Text = label.ToUpper(CultureInfo.CurrentCulture),
        FontSize = LabelFontSize,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        CharacterSpacing = 120,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };

    private static TsGlassPanel BuildCard(DriveHighlightSlideDisplay display)
    {
        var card = new TsGlassPanel
        {
            MaxWidth = CardMaxWidth,
            Padding = new Thickness(24),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(BuildRoute(display));
        body.Children.Add(BuildStats(display));
        body.Children.Add(new Caption
        {
            Value = display.DateText,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        card.Content = body;
        return card;
    }

    private static StackPanel BuildRoute(DriveHighlightSlideDisplay display)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        row.Children.Add(Icon(DriveHighlightSlideRegistration.MapPinGlyph, RouteIconFontSize, DisplayTokens.TextMuted));
        row.Children.Add(Address(display.RouteStart));
        row.Children.Add(Icon(DriveHighlightSlideRegistration.ArrowRightGlyph, StatIconFontSize, DisplayTokens.TextMuted));
        row.Children.Add(Address(display.RouteEnd));
        return row;
    }

    private static TextBlock Address(string address) => new()
    {
        Text = address,
        FontSize = RouteFontSize,
        Foreground = DisplayTokens.TextSecondary,
        TextTrimming = TextTrimming.CharacterEllipsis,
        TextWrapping = TextWrapping.NoWrap,
        MaxWidth = AddressMaxWidth,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Grid BuildStats(DriveHighlightSlideDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        var distance = Stat(glyph: null, display.DistanceText, display.DistanceUnit);
        var duration = Stat(DriveHighlightSlideRegistration.ClockGlyph, display.DurationText, display.DurationLabel);
        var efficiency = Stat(DriveHighlightSlideRegistration.ZapGlyph, display.EfficiencyText, display.EfficiencyUnit);

        Grid.SetColumn(distance, 0);
        Grid.SetColumn(duration, 1);
        Grid.SetColumn(efficiency, 2);
        grid.Children.Add(distance);
        grid.Children.Add(duration);
        grid.Children.Add(efficiency);
        return grid;
    }

    private static StackPanel Stat(string? glyph, string value, string label)
    {
        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Center };

        var valueRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        if (!string.IsNullOrEmpty(glyph))
        {
            valueRow.Children.Add(Icon(glyph, StatIconFontSize, DisplayTokens.TextMuted));
        }

        valueRow.Children.Add(new MetricValue
        {
            Value = value,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        column.Children.Add(valueRow);

        column.Children.Add(new MetricLabel
        {
            Value = label,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        return column;
    }

    private static FontIcon Icon(string glyph, double fontSize, Microsoft.UI.Xaml.Media.Brush foreground)
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
}
