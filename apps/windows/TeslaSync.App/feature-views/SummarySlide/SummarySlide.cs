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
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The native WinUI 3 <c>SummarySlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/SummarySlide.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the <c>data</c> prop) and a <see cref="Units"/> preference (the <c>useUnits</c> seam) and
/// it renders exactly one of the web branches — <see cref="SummarySlideState.Content"/> (the screenshot-friendly
/// glass card: the year + "Year in Review" header, the vehicle name/model, the five headline stats, the optional
/// gas-savings line and the brand footer, plus the share caption beneath the card) or
/// <see cref="SummarySlideState.Empty"/> (the friendly "No drive data for this year" copy). The view never
/// performs HTTP; all branch selection, the SI distance conversion, the <c>Math.round</c> savings and the
/// formatting happen in the WinUI-free <see cref="SummarySlideProjection"/>. The card enters through a
/// <see cref="TsFadeIn"/> and the stats stagger through a <see cref="TsStaggerContainer"/> (both honour the OS
/// reduce-motion setting), each headline value counts up through the shared <see cref="TsAnimatedNumber"/>, the
/// card is a tokenized <see cref="TsGlassPanel"/>, every string resolves through the i18n facade, the decorative
/// stat icons are hidden from Narrator, and the surface carries a composed Narrator name in each state.
/// </summary>
public sealed partial class SummarySlide : ContentControl
{
    private const double CardMaxWidth = 448;
    private const double YearFontSize = 24;
    private const double SubtitleFontSize = 14;
    private const double VehicleNameFontSize = 14;
    private const double VehicleModelFontSize = 12;
    private const double StatIconFontSize = 18;
    private const double StatLabelFontSize = 14;
    private const double SavingsFontSize = 14;
    private const double BrandFontSize = 11;
    private const double ScreenshotFontSize = 14;
    private const double StatValueMinWidth = 64;
    private const double EmptyMessageFontSize = 20;
    private const double AnimationDurationSeconds = 1;

    private const string SuccessBrushKey = "TsColorSuccessBrush";

    private readonly ILocalizer _localizer;
    private readonly SummarySlideDiagnostics _diagnostics;

    private SummarySlideModel _model;
    private UnitPref _units;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, a unit preference and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="SummarySlideModel.Empty"/>.</param>
    /// <param name="units">The active unit preference; defaults to <see cref="UnitPref.Metric"/> (the <c>useUnits</c> seam).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SummarySlide(
        ILocalizer localizer,
        SummarySlideModel? model = null,
        UnitPref? units = null,
        SummarySlideDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? SummarySlideModel.Empty;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new SummarySlideDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SummarySlide</c>).</summary>
    public static string Slug => SummarySlideRegistration.Slug;

    /// <summary>The render model (the year-in-review summary); reassigning re-projects and re-renders the surface.</summary>
    public SummarySlideModel Model
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
        var display = SummarySlideProjection.Project(_model, _units, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State == SummarySlideState.Empty
            ? BuildEmpty(display)
            : BuildContent(display);
    }

    // ── Empty (native robustness for a null summary) ────────────────────────────────────────────────
    private static StackPanel BuildEmpty(SummarySlideDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 16,
            Padding = new Thickness(32, 0, 32, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

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

    // ── Content (web data) ──────────────────────────────────────────────────────────────────────────
    private static StackPanel BuildContent(SummarySlideDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 24,
            Padding = new Thickness(32, 0, 32, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Web parity: the card scales/fades in (framer-motion); TsFadeIn reproduces the entrance and collapses
        // to an instant reveal under OS reduce-motion.
        column.Children.Add(new TsFadeIn
        {
            Content = BuildCard(display),
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        column.Children.Add(new TextBlock
        {
            Text = display.ScreenshotText,
            FontSize = ScreenshotFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        return column;
    }

    private static TsGlassPanel BuildCard(SummarySlideDisplay display)
    {
        var card = new TsGlassPanel
        {
            MaxWidth = CardMaxWidth,
            Padding = new Thickness(24),
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var body = new StackPanel { Spacing = 24 };
        body.Children.Add(BuildHeader(display));
        body.Children.Add(BuildStats(display));
        if (display.ShowSavings)
        {
            body.Children.Add(BuildSavings(display));
        }

        body.Children.Add(new Caption
        {
            Value = display.BrandText,
            HorizontalAlignment = HorizontalAlignment.Center,
        });

        card.Content = body;
        return card;
    }

    private static Grid BuildHeader(SummarySlideDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        left.Children.Add(new TextBlock
        {
            Text = display.YearText,
            FontSize = YearFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.TextPrimary,
        });
        left.Children.Add(new TextBlock
        {
            Text = display.Title,
            FontSize = SubtitleFontSize,
            Foreground = DisplayTokens.TextSecondary,
        });
        Grid.SetColumn(left, 0);

        var right = new StackPanel
        {
            Spacing = 2,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        right.Children.Add(new TextBlock
        {
            Text = display.VehicleName,
            FontSize = VehicleNameFontSize,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextAlignment = TextAlignment.Right,
        });
        right.Children.Add(new TextBlock
        {
            Text = display.VehicleModel,
            FontSize = VehicleModelFontSize,
            Foreground = DisplayTokens.TextMuted,
            TextAlignment = TextAlignment.Right,
        });
        Grid.SetColumn(right, 1);

        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    private static TsStaggerContainer BuildStats(SummarySlideDisplay display)
    {
        // Web parity: each stat row slides/fades in on an increasing delay; TsStaggerContainer reproduces that
        // and collapses to an instant reveal under OS reduce-motion.
        var stagger = new TsStaggerContainer { Spacing = 12 };
        foreach (var stat in display.Stats)
        {
            stagger.Add(BuildStatRow(stat));
        }

        return stagger;
    }

    private static StackPanel BuildStatRow(SummaryStat stat)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(Icon(stat.Glyph));
        row.Children.Add(new TsAnimatedNumber
        {
            Value = stat.Value,
            Precision = stat.Decimals,
            DurationSeconds = AnimationDurationSeconds,
            ReduceMotion = MotionPreference.ReduceMotion,
            MinWidth = StatValueMinWidth,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new TextBlock
        {
            Text = stat.Label,
            FontSize = StatLabelFontSize,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        return row;
    }

    private static Border BuildSavings(SummarySlideDisplay display)
    {
        var divider = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(0, 1, 0, 0),
            Padding = new Thickness(0, 16, 0, 0),
        };

        var text = new TextBlock
        {
            Text = display.SavingsText,
            FontSize = SavingsFontSize,
            Foreground = SuccessBrush(),
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        AutomationProperties.SetName(text, display.SavingsAnnouncement);

        divider.Child = text;
        return divider;
    }

    private static FontIcon Icon(string glyph)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = StatIconFontSize,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        };

        // Decorative — its meaning is carried by the adjacent value/label and the surface Narrator name.
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);
        return icon;
    }

    private static Brush SuccessBrush() => DisplayTokens.Brush(SuccessBrushKey);
}
