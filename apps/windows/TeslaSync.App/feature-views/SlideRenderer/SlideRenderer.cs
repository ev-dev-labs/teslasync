using System.Globalization;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Core.Motion;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// Builds the native body for a single year-in-review slide kind — the seam SlideRenderer dispatches a known
/// slide through. It is the native analogue of the web SlideRenderer's child-component imports
/// (<c>TitleSlide</c>, <c>StatHeroSlide</c>, …): the parent story player wires the sibling slide surfaces
/// (each its own P2 prompt) into this factory, and SlideRenderer hosts whatever it returns inside the
/// gradient canvas and slide transition. Returning <see langword="null"/> lets SlideRenderer fall back to its
/// own built-in content (the drive-highlight caption) or the never-blank empty surface.
/// </summary>
public interface ISlideContentFactory
{
    /// <summary>Create the body element for <paramref name="request"/>, or null to use the built-in fallback.</summary>
    UIElement? CreateContent(SlideContentRequest request);
}

/// <summary>
/// The native WinUI 3 <c>SlideRenderer</c> feature surface — a parity port of
/// web/src/features/analytics/components/review/SlideRenderer.tsx. It is a pure presentational dispatcher:
/// assign a <see cref="Model"/> (the web <c>slideIndex</c> + <c>slide</c> + <c>data</c> props) and it paints
/// the full-bleed <c>bg-gradient-to-br</c> slide canvas (parsed from <c>slide.bg</c>) and slides the new
/// slide in (the web <c>AnimatePresence</c> + <c>motion.div</c> keyed by <c>slideIndex</c>, honouring
/// reduce-motion). The slide body is dispatched by kind: the <c>drive-highlight</c> kind resolves the emoji
/// + localized label (<c>t('yearReview.longestDrive' | 'mostEfficient')</c>) + selected drive exactly as the
/// web source does, and every kind is hosted through the optional <see cref="ISlideContentFactory"/> seam
/// (the native analogue of the web child imports). When no sibling-slide body is wired, the drive-highlight
/// kind renders SlideRenderer's own caption and every other kind renders a friendly localized empty surface
/// — never a blank box (the web <c>default: return null</c> arm is likewise upgraded to a visible empty
/// state). The view performs no HTTP; all dispatch, field defaulting, drive selection, label resolution and
/// gradient parsing happen in the WinUI-free <see cref="SlideRendererProjection"/>. The surface carries a
/// Narrator name and announces each slide change through a polite live region.
/// </summary>
public sealed partial class SlideRenderer : ContentControl
{
    private const double SlideOffsetPx = 48;
    private const int TransitionMs = 350;
    private const double CardMaxWidth = 420;

    private readonly ILocalizer _localizer;
    private readonly ISlideContentFactory? _contentFactory;
    private readonly SlideRendererDiagnostics _diagnostics;

    private readonly Grid _root = new();
    private readonly Border _gradient = new();
    private readonly Border _contentHost = new() { Padding = new Thickness(24) };
    private readonly TranslateTransform _translate = new();

    private SlideRenderModel _model;
    private string _automationName = string.Empty;
    private bool _opened;

    /// <summary>Creates the surface over its i18n facade, an initial model, an optional sibling-slide content
    /// factory, and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="model">The initial render model (the web <c>slideIndex</c>/<c>slide</c>/<c>data</c> props).</param>
    /// <param name="contentFactory">The seam the parent wires sibling slide bodies into (optional).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SlideRenderer(
        ILocalizer localizer,
        SlideRenderModel model,
        ISlideContentFactory? contentFactory = null,
        SlideRendererDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(model);

        _localizer = localizer;
        _model = model;
        _contentFactory = contentFactory;
        _diagnostics = diagnostics ?? new SlideRendererDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        Loaded += OnLoaded;
        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SlideRenderer</c>).</summary>
    public static string Slug => SlideRendererRegistration.Slug;

    /// <summary>The render model; reassigning re-dispatches, repaints the gradient and slides the new slide in.</summary>
    public SlideRenderModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            _model = value;
            Render();
        }
    }

    private void BuildChrome()
    {
        _gradient.HorizontalAlignment = HorizontalAlignment.Stretch;
        _gradient.VerticalAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetAccessibilityView(_gradient, AccessibilityView.Raw);

        _contentHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        _contentHost.VerticalAlignment = VerticalAlignment.Stretch;

        _root.RenderTransform = _translate;
        _root.Children.Add(_gradient);
        _root.Children.Add(_contentHost);

        LiveRegion.Configure(_root);
        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;
            _diagnostics.RecordViewOpened();
        }

        // Play the entrance once the element is in the visual tree — a Storyboard needs a loaded target.
        AnimateEnter();
    }

    private void Render()
    {
        var display = SlideRendererProjection.Project(_model, _localizer);

        _gradient.Background = BuildGradientBrush(display.Gradient);
        _contentHost.Child = BuildContent(display);

        _automationName = display.AutomationName;
        AutomationProperties.SetName(this, _automationName);
        LiveRegion.Announce(_root);

        // Default to the final (visible) state so the slide is never stuck hidden before it loads; once
        // loaded, a slide swap replays the web AnimatePresence entrance.
        _root.Opacity = 1;
        _translate.X = 0;
        if (IsLoaded)
        {
            AnimateEnter();
        }
    }

    // ── Content dispatch (web renderSlideContent) ──────────────────────────────────────────────────────

    private UIElement BuildContent(SlideDisplay display)
    {
        if (!display.IsEmpty && _contentFactory is { } factory)
        {
            // Production path: the parent wires the sibling slide surfaces (each its own prompt) into the
            // factory — the native analogue of the web child-component imports.
            var request = new SlideContentRequest(
                display.SlideIndex,
                display.Kind,
                display.Field,
                display.DriveHighlight,
                _model.Data,
                display.Gradient);
            if (factory.CreateContent(request) is { } child)
            {
                return child;
            }
        }

        // No wired body: SlideRenderer renders the drive-highlight caption it owns (web resolves the emoji +
        // label + drive here), and every other kind — plus the unknown arm (web default: null) — renders the
        // never-blank localized empty surface.
        return display.DriveHighlight is { } highlight
            ? BuildDriveHighlight(highlight)
            : BuildEmpty(display.EmptyMessage);
    }

    private static StackPanel BuildDriveHighlight(DriveHighlightSelection highlight)
    {
        var stack = new StackPanel
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 12,
            MaxWidth = CardMaxWidth,
        };

        stack.Children.Add(new TextBlock
        {
            Text = highlight.Emoji,
            FontSize = 56,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });

        stack.Children.Add(new TextBlock
        {
            // Web parity: the label renders uppercase with wide tracking (a display transform).
            Text = highlight.Label.ToUpper(CultureInfo.CurrentCulture),
            FontSize = 18,
            FontWeight = FontWeights.SemiBold,
            Foreground = OnGradient(0.9),
            CharacterSpacing = 80,
            TextWrapping = TextWrapping.Wrap,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
        });

        var route = SlideRendererProjection.RouteSummary(highlight.Drive);
        var drive = highlight.Drive;
        bool hasRoute = !string.IsNullOrEmpty(route);
        bool hasDate = drive is not null && !string.IsNullOrWhiteSpace(drive.Date);

        if (hasRoute || hasDate)
        {
            var inner = new StackPanel { Spacing = 6 };
            if (hasRoute)
            {
                inner.Children.Add(new TextBlock
                {
                    Text = route,
                    FontSize = 13,
                    Foreground = OnGradient(0.7),
                    TextWrapping = TextWrapping.Wrap,
                    HorizontalAlignment = HorizontalAlignment.Center,
                    TextAlignment = TextAlignment.Center,
                });
            }

            if (hasDate)
            {
                inner.Children.Add(new TextBlock
                {
                    Text = drive!.Date,
                    FontSize = 12,
                    Foreground = OnGradient(0.5),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    TextAlignment = TextAlignment.Center,
                });
            }

            stack.Children.Add(new Border
            {
                Child = inner,
                Padding = new Thickness(20, 16, 20, 16),
                CornerRadius = new CornerRadius(16),
                Background = OnGradient(0.05),
                BorderBrush = OnGradient(0.10),
                BorderThickness = new Thickness(1),
                HorizontalAlignment = HorizontalAlignment.Center,
            });
        }

        return stack;
    }

    private static TsEmptyState BuildEmpty(string message) => new()
    {
        Message = message,
        HorizontalAlignment = HorizontalAlignment.Center,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // ── Gradient canvas (web bg-gradient-to-br) ────────────────────────────────────────────────────────

    private static LinearGradientBrush BuildGradientBrush(SlideGradient gradient)
    {
        var brush = new LinearGradientBrush
        {
            StartPoint = new Windows.Foundation.Point(0, 0),
            EndPoint = new Windows.Foundation.Point(1, 1),
        };
        brush.GradientStops.Add(new GradientStop { Color = ToColor(gradient.From), Offset = 0 });
        brush.GradientStops.Add(new GradientStop { Color = ToColor(gradient.Via), Offset = 0.5 });
        brush.GradientStops.Add(new GradientStop { Color = ToColor(gradient.To), Offset = 1 });
        return brush;
    }

    private static Windows.UI.Color ToColor(SlideColor color) =>
        Windows.UI.Color.FromArgb(0xFF, color.R, color.G, color.B);

    // The slide gradient is always one of the dark Tailwind -900 ramps, so on-canvas text is an explicit
    // white-with-opacity ramp (the web text-white / white/[0.05] values) rather than a theme token that
    // would invert to dark-on-dark under the light theme.
    private static SolidColorBrush OnGradient(double opacity) =>
        new(Microsoft.UI.Colors.White) { Opacity = opacity };

    // ── Enter transition (web AnimatePresence initial x:50 / opacity 0 → x:0 / opacity 1) ───────────────

    private void AnimateEnter()
    {
        bool reduce = MotionPreference.ReduceMotion;
        int duration = MotionDuration.Resolve(reduce, TransitionMs);

        if (!MotionDuration.ShouldAnimate(reduce) || duration == 0)
        {
            _root.Opacity = 1;
            _translate.X = 0;
            return;
        }

        _root.Opacity = 0;
        _translate.X = SlideOffsetPx;
        var span = new Duration(TimeSpan.FromMilliseconds(duration));
        var ease = new QuadraticEase { EasingMode = EasingMode.EaseInOut };

        var fade = new DoubleAnimation { From = 0, To = 1, Duration = span, EnableDependentAnimation = true };
        Storyboard.SetTarget(fade, _root);
        Storyboard.SetTargetProperty(fade, "Opacity");

        var slide = new DoubleAnimation
        {
            From = SlideOffsetPx,
            To = 0,
            Duration = span,
            EnableDependentAnimation = true,
            EasingFunction = ease,
        };
        Storyboard.SetTarget(slide, _translate);
        Storyboard.SetTargetProperty(slide, "X");

        var storyboard = new Storyboard();
        storyboard.Children.Add(fade);
        storyboard.Children.Add(slide);
        storyboard.Begin();
    }

    protected override AutomationPeer OnCreateAutomationPeer() => new SlideRendererAutomationPeer(this);

    private sealed class SlideRendererAutomationPeer(SlideRenderer owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? owner._automationName : name;
        }
    }
}
