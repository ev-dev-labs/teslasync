using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The native WinUI 3 <c>TitleSlide</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/TitleSlide.tsx. It is a pure presentational control: assign a
/// <see cref="Model"/> (the <c>data: YearReview</c> prop, narrowed to the year and the vehicle name) and it
/// renders exactly one of the branches — <see cref="TitleSlideState.Content"/> (the car emoji, the count-up
/// year, the "Year in Review" title and the vehicle name) or <see cref="TitleSlideState.Empty"/> (the emoji
/// over the title and a friendly "no data" line, never a blank box). The view never performs HTTP; all branch
/// selection, year formatting and string resolution happen in the WinUI-free
/// <see cref="TitleSlideProjection"/>. The content entrance is staggered through
/// <see cref="TsStaggerContainer"/> (which honours the OS reduce-motion setting), the year counts up through
/// the shared <see cref="TsAnimatedNumber"/> (web <c>AnimatedNumber</c>, duration 0.8s, reduce-motion aware)
/// scaled to a hero size, every string resolves through the i18n facade, the decorative emoji is hidden from
/// Narrator, and the surface carries a Narrator name in each state.
/// </summary>
public sealed partial class TitleSlide : ContentControl
{
    private const double EmojiFontSize = 64;
    private const double YearHeroHeight = 60;
    private const double YearDurationSeconds = 0.8;
    private const double TitleFontSize = 22;
    private const double VehicleFontSize = 18;
    private const double EmptyMessageFontSize = 18;

    private readonly ILocalizer _localizer;
    private readonly TitleSlideDiagnostics _diagnostics;

    private TitleSlideModel _model;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="model">The initial render model; defaults to <see cref="TitleSlideModel.Empty"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TitleSlide(
        ILocalizer localizer,
        TitleSlideModel? model = null,
        TitleSlideDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? TitleSlideModel.Empty;
        _diagnostics = diagnostics ?? new TitleSlideDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TitleSlide</c>).</summary>
    public static string Slug => TitleSlideRegistration.Slug;

    /// <summary>The render model (year / vehicle name); reassigning re-projects and re-renders the surface.</summary>
    public TitleSlideModel Model
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
        var display = TitleSlideProjection.Project(_model, _localizer);

        AutomationProperties.SetName(this, display.AutomationName);
        Content = display.State == TitleSlideState.Empty
            ? BuildEmpty(display)
            : BuildContent(display);
    }

    // ── Content (web data) ──────────────────────────────────────────────────────────────────────────
    private static TsStaggerContainer BuildContent(TitleSlideDisplay display)
    {
        // Web parity: the emoji springs in and the year, title and vehicle name rise on a stagger
        // (framer-motion); TsStaggerContainer reproduces that and collapses to an instant reveal under OS
        // reduce-motion.
        var stagger = new TsStaggerContainer
        {
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        stagger.Add(Emoji(display.Emoji));
        stagger.Add(YearHero(display.YearValue));
        stagger.Add(Subtitle(display.Title, TitleFontSize));
        stagger.Add(Subtitle(display.VehicleName, VehicleFontSize));
        return stagger;
    }

    // ── Empty (absent / sentinel model) ─────────────────────────────────────────────────────────────
    private static StackPanel BuildEmpty(TitleSlideDisplay display)
    {
        var column = new StackPanel
        {
            Spacing = 12,
            Padding = new Thickness(32, 0, 32, 0),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        column.Children.Add(Emoji(display.Emoji));
        column.Children.Add(Subtitle(display.Title, TitleFontSize));

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

        AutomationProperties.SetName(column, display.AutomationName);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private static TextBlock Emoji(string emoji)
    {
        var text = new TextBlock
        {
            Text = emoji,
            FontSize = EmojiFontSize,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        // Decorative — the surface's Narrator name already carries the year, title and vehicle.
        AutomationProperties.SetAccessibilityView(text, AccessibilityView.Raw);
        return text;
    }

    private static Viewbox YearHero(double yearValue)
    {
        // Web parity: <AnimatedNumber value={data.year} duration={0.8} /> rendered at the text-7xl hero size.
        // TsAnimatedNumber owns the count-up + en-US grouping + reduce-motion; a height-locked Viewbox scales
        // it up uniformly without re-scaling per count-up frame.
        var number = new TsAnimatedNumber
        {
            Value = yearValue,
            DurationSeconds = YearDurationSeconds,
            ReduceMotion = MotionPreference.ReduceMotion,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        var hero = new Viewbox
        {
            Height = YearHeroHeight,
            Stretch = Stretch.Uniform,
            StretchDirection = StretchDirection.Both,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = number,
        };

        // Decorative wrapper — the count-up control announces the value and the surface name carries it too.
        AutomationProperties.SetAccessibilityView(hero, AccessibilityView.Raw);
        return hero;
    }

    private static TextBlock Subtitle(string value, double fontSize) => new()
    {
        Text = value,
        FontSize = fontSize,
        FontWeight = FontWeights.Normal,
        Foreground = DisplayTokens.TextSecondary,
        TextWrapping = TextWrapping.Wrap,
        TextAlignment = TextAlignment.Center,
        HorizontalAlignment = HorizontalAlignment.Center,
    };
}
