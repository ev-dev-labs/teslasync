using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Where the tour tooltip is anchored relative to the highlighted element — the native port of the web
/// <c>TourStep.placement</c> union (<c>'top' | 'bottom' | 'left' | 'right'</c>, web/src/hooks/useTour.ts L17).
/// The web <c>getTooltipPosition</c> switch treats any unrecognised value as <see cref="Bottom"/>
/// (its <c>default</c> arm), which <see cref="TourPlacements.Parse"/> reproduces.
/// </summary>
public enum TourPlacement
{
    /// <summary>Above the target — web <c>'top'</c>.</summary>
    Top,

    /// <summary>Below the target — web <c>'bottom'</c> (and the <c>default</c> fallback).</summary>
    Bottom,

    /// <summary>Left of the target — web <c>'left'</c>.</summary>
    Left,

    /// <summary>Right of the target — web <c>'right'</c>.</summary>
    Right,
}

/// <summary>
/// Maps the web placement wire token (<c>'top' | 'bottom' | 'left' | 'right'</c>) to and from
/// <see cref="TourPlacement"/>. Unknown tokens resolve to <see cref="TourPlacement.Bottom"/>, mirroring the
/// <c>default</c> arm of the web <c>getTooltipPosition</c> switch (web/src/components/feedback/TourOverlay.tsx L179).
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class TourPlacements
{
    /// <summary>Parse a web placement token, defaulting to <see cref="TourPlacement.Bottom"/> for anything else.</summary>
    /// <param name="wire">The web placement string, or null.</param>
    public static TourPlacement Parse(string? wire) => wire switch
    {
        "top" => TourPlacement.Top,
        "left" => TourPlacement.Left,
        "right" => TourPlacement.Right,
        _ => TourPlacement.Bottom,
    };

    /// <summary>The web wire token for a placement.</summary>
    /// <param name="placement">The anchored side.</param>
    public static string Wire(TourPlacement placement) => placement switch
    {
        TourPlacement.Top => "top",
        TourPlacement.Left => "left",
        TourPlacement.Right => "right",
        _ => "bottom",
    };
}

/// <summary>
/// The measured bounds of the highlighted element, in the overlay's coordinate space — the native analogue of the
/// web <c>DOMRect</c> the parent passes as <c>targetRect</c> (web/src/components/feedback/TourOverlay.tsx L10). The
/// view supplies it from the host element's transform-to-overlay bounds; the spotlight cut-out and the tooltip
/// anchor derive from it. A pure value type so the geometry is asserted headlessly.
/// </summary>
/// <param name="X">Left edge (web <c>rect.left</c>).</param>
/// <param name="Y">Top edge (web <c>rect.top</c>).</param>
/// <param name="Width">Element width (web <c>rect.width</c>).</param>
/// <param name="Height">Element height (web <c>rect.height</c>).</param>
public readonly record struct TourTargetRect(double X, double Y, double Width, double Height)
{
    /// <summary>Left edge (web <c>rect.left</c>).</summary>
    public double Left => X;

    /// <summary>Top edge (web <c>rect.top</c>).</summary>
    public double Top => Y;

    /// <summary>Right edge (web <c>rect.right</c>).</summary>
    public double Right => X + Width;

    /// <summary>Bottom edge (web <c>rect.bottom</c>).</summary>
    public double Bottom => Y + Height;
}

/// <summary>
/// The overlay viewport extent the tooltip clamps against — the native analogue of the web
/// <c>window.innerWidth</c> / <c>window.innerHeight</c> read by <c>getTooltipPosition</c>
/// (web/src/components/feedback/TourOverlay.tsx L169-170). The view feeds its own measured size; a pure value type
/// so clamping is asserted without a window.
/// </summary>
/// <param name="Width">Viewport width (web <c>vw</c>).</param>
/// <param name="Height">Viewport height (web <c>vh</c>).</param>
public readonly record struct TourViewport(double Width, double Height);

/// <summary>
/// The padded highlight rectangle drawn around the target — the native port of the web <c>spotlight</c> object
/// (web/src/components/feedback/TourOverlay.tsx L29-34): the target inflated by
/// <see cref="TourOverlayRegistration.SpotlightPadding"/> on every side. It both shapes the overlay cut-out and
/// positions the glow border. A pure value type.
/// </summary>
/// <param name="Left">Left edge of the spotlight.</param>
/// <param name="Top">Top edge of the spotlight.</param>
/// <param name="Width">Spotlight width.</param>
/// <param name="Height">Spotlight height.</param>
public readonly record struct SpotlightRect(double Left, double Top, double Width, double Height)
{
    /// <summary>Right edge of the spotlight.</summary>
    public double Right => Left + Width;

    /// <summary>Bottom edge of the spotlight.</summary>
    public double Bottom => Top + Height;
}

/// <summary>
/// The resolved tooltip anchor — the native form of the CSS object the web <c>getTooltipPosition</c> returns
/// (web/src/components/feedback/TourOverlay.tsx L163-191). Exactly the edges the web sets are non-null
/// (<c>top</c>/<c>bottom</c> and <c>left</c>/<c>right</c>); <see cref="ResolveLeft"/> / <see cref="ResolveTop"/>
/// convert an edge anchor into an absolute canvas offset given the measured tooltip size, reproducing CSS edge
/// positioning (<c>right: r</c> ⇒ <c>vw - r - width</c>; <c>bottom: b</c> ⇒ <c>vh - b - height</c>). A pure value
/// type so positioning is asserted headlessly.
/// </summary>
/// <param name="Placement">The side the tooltip is anchored on.</param>
/// <param name="Top">Distance from the viewport top (web CSS <c>top</c>), or null when bottom-anchored.</param>
/// <param name="Bottom">Distance from the viewport bottom (web CSS <c>bottom</c>), or null when top-anchored.</param>
/// <param name="Left">Distance from the viewport left (web CSS <c>left</c>), or null when right-anchored.</param>
/// <param name="Right">Distance from the viewport right (web CSS <c>right</c>), or null when left-anchored.</param>
/// <param name="MaxWidth">The tooltip's maximum width (web <c>maxWidth</c>).</param>
public readonly record struct TooltipPlacementResult(
    TourPlacement Placement,
    double? Top,
    double? Bottom,
    double? Left,
    double? Right,
    double MaxWidth)
{
    /// <summary>Resolve the absolute left offset, converting a right-edge anchor with the measured width.</summary>
    /// <param name="tooltipWidth">The measured tooltip width.</param>
    /// <param name="viewport">The overlay viewport extent.</param>
    public double ResolveLeft(double tooltipWidth, TourViewport viewport) =>
        Left ?? viewport.Width - (Right ?? 0) - tooltipWidth;

    /// <summary>Resolve the absolute top offset, converting a bottom-edge anchor with the measured height.</summary>
    /// <param name="tooltipHeight">The measured tooltip height.</param>
    /// <param name="viewport">The overlay viewport extent.</param>
    public double ResolveTop(double tooltipHeight, TourViewport viewport) =>
        Top ?? viewport.Height - (Bottom ?? 0) - tooltipHeight;
}

/// <summary>
/// One progress dot beneath the tooltip body — the native port of a single iteration of the web
/// <c>Array.from({ length: totalSteps }).map(...)</c> (web/src/components/feedback/TourOverlay.tsx L144-156). The
/// web renders the active dot wide and accent-coloured and every other dot narrow and muted (its completed and
/// upcoming arms are visually identical), so <see cref="IsActive"/> captures the only render distinction. A pure
/// value type.
/// </summary>
/// <param name="Index">Zero-based dot index.</param>
/// <param name="IsActive">True for the current step's dot (web <c>i === currentStep</c>).</param>
public readonly record struct TourProgressDot(int Index, bool IsActive);

/// <summary>
/// The presentational content of a single tour step — the native port of the render-relevant fields of the web
/// <c>TourStep</c> (web/src/hooks/useTour.ts L9-22): the tooltip <see cref="Title"/>, <see cref="Description"/> and
/// the <see cref="Placement"/> the tooltip anchors on. The web <c>target</c> selector and <c>onShow</c> /
/// <c>onHide</c> side effects are owner concerns resolved before this surface renders (the measured
/// <see cref="TourTargetRect"/> carries the geometry), so they are not part of the presentational model. Pure data
/// — no WinUI types — so it is asserted without a UI host.
/// </summary>
public sealed record TourStepModel
{
    private TourStepModel(string title, string description, TourPlacement placement)
    {
        Title = title;
        Description = description;
        Placement = placement;
    }

    /// <summary>The tooltip heading (web <c>step.title</c>).</summary>
    public string Title { get; }

    /// <summary>The tooltip body text (web <c>step.description</c>).</summary>
    public string Description { get; }

    /// <summary>The side the tooltip anchors on (web <c>step.placement</c>).</summary>
    public TourPlacement Placement { get; }

    /// <summary>Build a step. Title and description are required (they are required web fields, but may be empty).</summary>
    /// <param name="title">The tooltip heading (web <c>step.title</c>).</param>
    /// <param name="description">The tooltip body (web <c>step.description</c>).</param>
    /// <param name="placement">The anchored side (web <c>step.placement</c>); defaults to <see cref="TourPlacement.Bottom"/>.</param>
    public static TourStepModel Create(string title, string description, TourPlacement placement = TourPlacement.Bottom)
    {
        ArgumentNullException.ThrowIfNull(title);
        ArgumentNullException.ThrowIfNull(description);
        return new TourStepModel(title, description, placement);
    }
}

/// <summary>
/// The full active-tour state the surface renders from — the native bundle of the web <c>TourOverlay</c> props
/// (web/src/components/feedback/TourOverlay.tsx L8-16): the current <see cref="Step"/>, its measured
/// <see cref="TargetRect"/> (null until the highlighted element is located — the web
/// <c>if (!targetRect) return null</c> gate at L25), and the <see cref="CurrentStep"/> / <see cref="TotalSteps"/>
/// position the counter, navigation and progress dots derive from. The seam (<c>ITourOverlaySource</c>) hands the
/// view a snapshot when a tour is running and null when none is; the owner advances it in response to the surface's
/// next / back / skip requests, exactly as the web <c>useTour</c> hook owns the step index. Pure data.
/// </summary>
public sealed record TourSnapshot
{
    private TourSnapshot(TourStepModel step, TourTargetRect? targetRect, int currentStep, int totalSteps)
    {
        Step = step;
        TargetRect = targetRect;
        CurrentStep = currentStep;
        TotalSteps = totalSteps;
    }

    /// <summary>The step being shown (web <c>step</c>).</summary>
    public TourStepModel Step { get; }

    /// <summary>The highlighted element's measured bounds, or null while it is not located (web <c>targetRect</c>).</summary>
    public TourTargetRect? TargetRect { get; }

    /// <summary>The zero-based index of the current step (web <c>currentStep</c>).</summary>
    public int CurrentStep { get; }

    /// <summary>The total number of steps (web <c>totalSteps</c>).</summary>
    public int TotalSteps { get; }

    /// <summary>True once the highlighted element has been measured — the overlay renders only then (web L25).</summary>
    public bool HasTarget => TargetRect.HasValue;

    /// <summary>
    /// Build a snapshot. <paramref name="totalSteps"/> must be positive and <paramref name="currentStep"/> must be
    /// a valid zero-based index within it, matching the web invariant that the overlay only renders while
    /// <c>currentStep &lt; totalSteps</c>.
    /// </summary>
    /// <param name="step">The step being shown (web <c>step</c>).</param>
    /// <param name="targetRect">The measured target bounds, or null while the element is not located.</param>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count (must be &gt;= 1).</param>
    public static TourSnapshot Create(TourStepModel step, TourTargetRect? targetRect, int currentStep, int totalSteps)
    {
        ArgumentNullException.ThrowIfNull(step);
        ArgumentOutOfRangeException.ThrowIfLessThan(totalSteps, 1);
        ArgumentOutOfRangeException.ThrowIfNegative(currentStep);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(currentStep, totalSteps);
        return new TourSnapshot(step, targetRect, currentStep, totalSteps);
    }
}

/// <summary>
/// Canonical metadata, layout constants, geometry and label logic for the <c>TourOverlay</c> shared surface — the
/// native mirror of the module-level constants and pure helpers in web/src/components/feedback/TourOverlay.tsx.
/// Carries the diagnostics slug, the overlay / dialog / control automation ids, the Segoe Fluent glyphs standing in
/// for the web Lucide icons (<c>X</c> / <c>ArrowLeft</c> / <c>ArrowRight</c>), the six i18n keys the source resolves
/// through <c>t()</c> with their English fallbacks (the source's second <c>t()</c> argument verbatim), the spotlight
/// inflation and tooltip clamp constants (web <c>spotlightPadding</c> / <c>gap</c> / <c>pad</c> / <c>bottomNav</c>
/// and the 360 / 160 reserves), and the pure spotlight + tooltip geometry, step-counter, navigation and progress-dot
/// helpers. UI-free so every value is asserted without a XAML runtime.
/// </summary>
public static class TourOverlayRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TourOverlay";

    /// <summary>Automation id for the full-screen overlay root.</summary>
    public const string OverlayAutomationId = "tour-overlay";

    /// <summary>Automation id for the tooltip dialog (the web <c>role="dialog"</c> element).</summary>
    public const string DialogAutomationId = "tour-overlay-dialog";

    /// <summary>Automation id for the close ("X") control.</summary>
    public const string CloseAutomationId = "tour-overlay-close";

    /// <summary>Automation id for the skip-tour control.</summary>
    public const string SkipAutomationId = "tour-overlay-skip";

    /// <summary>Automation id for the back control.</summary>
    public const string BackAutomationId = "tour-overlay-back";

    /// <summary>Automation id for the next / finish control.</summary>
    public const string NextAutomationId = "tour-overlay-next";

    /// <summary>Segoe Fluent "ChromeClose" glyph — the native stand-in for the web Lucide <c>X</c>.</summary>
    public const string CloseGlyph = "\uE711";

    /// <summary>Segoe Fluent "Back" glyph — the native stand-in for the web Lucide <c>ArrowLeft</c>.</summary>
    public const string BackGlyph = "\uE72B";

    /// <summary>Segoe Fluent "Forward" glyph — the native stand-in for the web Lucide <c>ArrowRight</c>.</summary>
    public const string NextGlyph = "\uE72A";

    /// <summary>i18n key for the dialog accessible name (web <c>tour.dialogLabel</c>).</summary>
    public const string DialogLabelKey = "translation.tour.dialogLabel";

    /// <summary>English fallback for <see cref="DialogLabelKey"/> (web second arg, verbatim — carries the count tokens).</summary>
    public const string DialogLabelFallback = "Tour step {{current}} of {{total}}";

    /// <summary>i18n key for the close control's accessible name (web <c>tour.close</c>).</summary>
    public const string CloseKey = "translation.tour.close";

    /// <summary>English fallback for <see cref="CloseKey"/> (web second arg, verbatim).</summary>
    public const string CloseFallback = "Close tour";

    /// <summary>i18n key for the skip-tour control (web <c>tour.skip</c>).</summary>
    public const string SkipKey = "translation.tour.skip";

    /// <summary>English fallback for <see cref="SkipKey"/> (web second arg, verbatim).</summary>
    public const string SkipFallback = "Skip tour";

    /// <summary>i18n key for the back control (web <c>tour.prev</c>).</summary>
    public const string PrevKey = "translation.tour.prev";

    /// <summary>English fallback for <see cref="PrevKey"/> (web second arg, verbatim).</summary>
    public const string PrevFallback = "Back";

    /// <summary>i18n key for the next control (web <c>tour.next</c>).</summary>
    public const string NextKey = "translation.tour.next";

    /// <summary>English fallback for <see cref="NextKey"/> (web second arg, verbatim).</summary>
    public const string NextFallback = "Next";

    /// <summary>i18n key for the final-step control (web <c>tour.finish</c>).</summary>
    public const string FinishKey = "translation.tour.finish";

    /// <summary>English fallback for <see cref="FinishKey"/> (web second arg, verbatim).</summary>
    public const string FinishFallback = "Get Started!";

    /// <summary>The i18next current-step interpolation token in <see cref="DialogLabelFallback"/>.</summary>
    public const string CurrentToken = "{{current}}";

    /// <summary>The i18next total-steps interpolation token in <see cref="DialogLabelFallback"/>.</summary>
    public const string TotalToken = "{{total}}";

    /// <summary>Spotlight inflation on every side around the target (web <c>spotlightPadding = 6</c>).</summary>
    public const double SpotlightPadding = 6;

    /// <summary>Gap between the target and the tooltip (web <c>gap = 16</c>).</summary>
    public const double TooltipGap = 16;

    /// <summary>Minimum inset the tooltip keeps from every viewport edge (web <c>pad = 16</c>).</summary>
    public const double ViewportPad = 16;

    /// <summary>Bottom tab-bar height reserved below the tooltip (web <c>bottomNav = 72</c>).</summary>
    public const double BottomNavReserve = 72;

    /// <summary>Upper bound on the tooltip width (web <c>Math.min(360, ...)</c>).</summary>
    public const double TooltipMaxWidthCap = 360;

    /// <summary>Extra bottom reserve the top clamp leaves for the tooltip body (web <c>vh - bottomNav - 160</c>).</summary>
    public const double ClampBottomReserve = 160;

    /// <summary>Spotlight border corner radius (web <c>rounded-lg</c>).</summary>
    public const double SpotlightCornerRadius = 8;

    /// <summary>Spotlight border thickness (web <c>border-2</c>).</summary>
    public const double SpotlightBorderThickness = 2;

    /// <summary>Spotlight border alpha over the accent colour (web <c>border-[var(--theme-primary)]/40</c>).</summary>
    public const double SpotlightBorderOpacity = 0.40;

    /// <summary>Spotlight glow alpha over the accent colour (web <c>shadow rgba(theme-primary, 0.2)</c>).</summary>
    public const double SpotlightGlowOpacity = 0.20;

    /// <summary>Spotlight glow blur radius in pixels (web <c>shadow 0 0 20px</c>).</summary>
    public const double SpotlightGlowBlur = 20;

    /// <summary>Tooltip card corner radius (web <c>rounded-xl</c>).</summary>
    public const double TooltipCornerRadius = 12;

    /// <summary>Tooltip entrance slide offset in pixels (web <c>slide-in-from-bottom-2</c> = 0.5rem).</summary>
    public const double TooltipSlideOffset = 8;

    /// <summary>Progress dot height (web <c>h-1</c>).</summary>
    public const double DotHeight = 4;

    /// <summary>Active progress dot width (web <c>w-4</c>).</summary>
    public const double DotActiveWidth = 16;

    /// <summary>Inactive progress dot width (web <c>w-1.5</c>).</summary>
    public const double DotInactiveWidth = 6;

    /// <summary>Inflate the target into the padded spotlight rectangle (web L29-34).</summary>
    /// <param name="target">The measured target bounds.</param>
    public static SpotlightRect Spotlight(TourTargetRect target) =>
        new(
            target.Left - SpotlightPadding,
            target.Top - SpotlightPadding,
            target.Width + (SpotlightPadding * 2),
            target.Height + (SpotlightPadding * 2));

    /// <summary>The tooltip's maximum width for a viewport (web <c>Math.min(360, vw - pad * 2)</c>).</summary>
    /// <param name="viewport">The overlay viewport extent.</param>
    public static double MaxTooltipWidth(TourViewport viewport) =>
        Math.Min(TooltipMaxWidthCap, viewport.Width - (ViewportPad * 2));

    /// <summary>Clamp a left offset so the tooltip stays within the horizontal padding (web <c>clampLeft</c>).</summary>
    /// <param name="x">The desired left offset.</param>
    /// <param name="viewport">The overlay viewport extent.</param>
    /// <param name="maxWidth">The tooltip's maximum width.</param>
    public static double ClampLeft(double x, TourViewport viewport, double maxWidth) =>
        Math.Max(ViewportPad, Math.Min(x, viewport.Width - maxWidth - ViewportPad));

    /// <summary>Clamp a top offset so the tooltip stays above the bottom reserve (web <c>clampTop</c>).</summary>
    /// <param name="y">The desired top offset.</param>
    /// <param name="viewport">The overlay viewport extent.</param>
    public static double ClampTop(double y, TourViewport viewport) =>
        Math.Max(ViewportPad, Math.Min(y, viewport.Height - BottomNavReserve - ClampBottomReserve));

    /// <summary>
    /// Resolve the tooltip anchor for a placement (the native port of web <c>getTooltipPosition</c>, L163-191).
    /// The <see cref="TourPlacement.Bottom"/> arm doubles as the web <c>default</c> case.
    /// </summary>
    /// <param name="placement">The side the tooltip anchors on.</param>
    /// <param name="target">The measured target bounds.</param>
    /// <param name="viewport">The overlay viewport extent.</param>
    public static TooltipPlacementResult Tooltip(TourPlacement placement, TourTargetRect target, TourViewport viewport)
    {
        double maxW = MaxTooltipWidth(viewport);
        double left = ClampLeft(target.Left, viewport, maxW);

        return placement switch
        {
            TourPlacement.Top => new TooltipPlacementResult(
                placement,
                Top: null,
                Bottom: Math.Max(ViewportPad + BottomNavReserve, viewport.Height - target.Top + TooltipGap),
                Left: left,
                Right: null,
                MaxWidth: maxW),
            TourPlacement.Right => new TooltipPlacementResult(
                placement,
                Top: ClampTop(target.Top, viewport),
                Bottom: null,
                Left: ClampLeft(target.Right + TooltipGap, viewport, maxW),
                Right: null,
                MaxWidth: maxW),
            TourPlacement.Left => new TooltipPlacementResult(
                placement,
                Top: ClampTop(target.Top, viewport),
                Bottom: null,
                Left: null,
                Right: Math.Max(ViewportPad, viewport.Width - target.Left + TooltipGap),
                MaxWidth: maxW),
            _ => new TooltipPlacementResult(
                placement,
                Top: ClampTop(target.Bottom + TooltipGap, viewport),
                Bottom: null,
                Left: left,
                Right: null,
                MaxWidth: maxW),
        };
    }

    /// <summary>The visible step counter text (web <c>{currentStep + 1} / {totalSteps}</c>).</summary>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count.</param>
    public static string StepCounterText(int currentStep, int totalSteps) =>
        string.Format(CultureInfo.CurrentCulture, "{0} / {1}", currentStep + 1, totalSteps);

    /// <summary>True for the final step (web <c>currentStep === totalSteps - 1</c>).</summary>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count.</param>
    public static bool IsLastStep(int currentStep, int totalSteps) => currentStep == totalSteps - 1;

    /// <summary>True when the back control is shown (web <c>currentStep &gt; 0</c>).</summary>
    /// <param name="currentStep">The zero-based current step index.</param>
    public static bool ShowBack(int currentStep) => currentStep > 0;

    /// <summary>True when the next control shows a trailing arrow (web <c>currentStep &lt; totalSteps - 1</c>).</summary>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count.</param>
    public static bool ShowNextArrow(int currentStep, int totalSteps) => currentStep < totalSteps - 1;

    /// <summary>The progress dots for a step (web L144-156).</summary>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count.</param>
    public static IReadOnlyList<TourProgressDot> ProgressDots(int currentStep, int totalSteps)
    {
        var dots = new TourProgressDot[Math.Max(0, totalSteps)];
        for (int i = 0; i < dots.Length; i++)
        {
            dots[i] = new TourProgressDot(i, i == currentStep);
        }

        return dots;
    }

    /// <summary>Resolve the localized close-control accessible name (web <c>t('tour.close', ...)</c>).</summary>
    /// <param name="localizer">The i18n facade (P1/S10).</param>
    public static string ResolveCloseLabel(ILocalizer localizer) => Resolve(localizer, CloseKey, CloseFallback);

    /// <summary>Resolve the localized skip-tour label (web <c>t('tour.skip', ...)</c>).</summary>
    /// <param name="localizer">The i18n facade (P1/S10).</param>
    public static string ResolveSkipLabel(ILocalizer localizer) => Resolve(localizer, SkipKey, SkipFallback);

    /// <summary>Resolve the localized back label (web <c>t('tour.prev', ...)</c>).</summary>
    /// <param name="localizer">The i18n facade (P1/S10).</param>
    public static string ResolveBackLabel(ILocalizer localizer) => Resolve(localizer, PrevKey, PrevFallback);

    /// <summary>
    /// Resolve the localized next-control label — the finish label on the last step, the next label otherwise
    /// (web <c>currentStep === totalSteps - 1 ? t('tour.finish', ...) : t('tour.next', ...)</c>).
    /// </summary>
    /// <param name="localizer">The i18n facade (P1/S10).</param>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count.</param>
    public static string ResolveNextLabel(ILocalizer localizer, int currentStep, int totalSteps) =>
        IsLastStep(currentStep, totalSteps)
            ? Resolve(localizer, FinishKey, FinishFallback)
            : Resolve(localizer, NextKey, NextFallback);

    /// <summary>
    /// Resolve the localized dialog accessible name, substituting the step counts into the i18next tokens
    /// (web <c>t('tour.dialogLabel', 'Tour step {{current}} of {{total}}', { current: currentStep + 1, total })</c>).
    /// The catalog value may omit the tokens (e.g. a static "Onboarding tour"), in which case substitution is a
    /// no-op and the catalog string is returned verbatim — matching the web, where the resolved value wins over the
    /// inline default.
    /// </summary>
    /// <param name="localizer">The i18n facade (P1/S10).</param>
    /// <param name="currentStep">The zero-based current step index.</param>
    /// <param name="totalSteps">The total step count.</param>
    public static string ResolveDialogLabel(ILocalizer localizer, int currentStep, int totalSteps)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string template = localizer.GetString(DialogLabelKey, DialogLabelFallback);
        return template
            .Replace(CurrentToken, (currentStep + 1).ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal)
            .Replace(TotalToken, totalSteps.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);
    }

    private static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="TourSnapshot"/> — everything the web <c>TourOverlay</c>
/// derives before returning JSX (web/src/components/feedback/TourOverlay.tsx L25-160): whether the overlay is shown
/// (<see cref="IsActive"/> — a snapshot is present and its target has been measured, the web
/// <c>if (!targetRect) return null</c> gate), the <see cref="Spotlight"/> cut-out, the <see cref="Tooltip"/> anchor,
/// the <see cref="Title"/> / <see cref="Description"/>, the <see cref="StepCounterText"/> ("N / M"), the localized
/// <see cref="DialogLabel"/> / <see cref="CloseLabel"/> / <see cref="SkipLabel"/> / <see cref="BackLabel"/> /
/// <see cref="NextLabel"/>, the <see cref="ShowBack"/> / <see cref="ShowNextArrow"/> / <see cref="IsLastStep"/>
/// branches, and the <see cref="ProgressDots"/>. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct TourOverlayProjection
{
    private TourOverlayProjection(
        bool isActive,
        SpotlightRect spotlight,
        TooltipPlacementResult tooltip,
        string title,
        string description,
        string stepCounterText,
        string dialogLabel,
        string closeLabel,
        string skipLabel,
        bool showBack,
        string backLabel,
        string nextLabel,
        bool showNextArrow,
        bool isLastStep,
        int currentStep,
        int totalSteps,
        IReadOnlyList<TourProgressDot> progressDots)
    {
        IsActive = isActive;
        Spotlight = spotlight;
        Tooltip = tooltip;
        Title = title;
        Description = description;
        StepCounterText = stepCounterText;
        DialogLabel = dialogLabel;
        CloseLabel = closeLabel;
        SkipLabel = skipLabel;
        ShowBack = showBack;
        BackLabel = backLabel;
        NextLabel = nextLabel;
        ShowNextArrow = showNextArrow;
        IsLastStep = isLastStep;
        CurrentStep = currentStep;
        TotalSteps = totalSteps;
        ProgressDots = progressDots;
    }

    /// <summary>Whether the overlay is shown — a snapshot is present and the target has been measured (web L25).</summary>
    public bool IsActive { get; }

    /// <summary>The padded spotlight cut-out rectangle (web <c>spotlight</c>).</summary>
    public SpotlightRect Spotlight { get; }

    /// <summary>The tooltip anchor (web <c>getTooltipPosition</c> result).</summary>
    public TooltipPlacementResult Tooltip { get; }

    /// <summary>The tooltip heading (web <c>step.title</c>).</summary>
    public string Title { get; }

    /// <summary>The tooltip body text (web <c>step.description</c>).</summary>
    public string Description { get; }

    /// <summary>The visible step counter ("N / M").</summary>
    public string StepCounterText { get; }

    /// <summary>The localized dialog accessible name (web <c>tour.dialogLabel</c>, count tokens substituted).</summary>
    public string DialogLabel { get; }

    /// <summary>The localized close-control accessible name (web <c>tour.close</c>).</summary>
    public string CloseLabel { get; }

    /// <summary>The localized skip-tour label (web <c>tour.skip</c>).</summary>
    public string SkipLabel { get; }

    /// <summary>True when the back control is shown (web <c>currentStep &gt; 0</c>).</summary>
    public bool ShowBack { get; }

    /// <summary>The localized back label (web <c>tour.prev</c>).</summary>
    public string BackLabel { get; }

    /// <summary>The localized next / finish label (web <c>tour.next</c> / <c>tour.finish</c>).</summary>
    public string NextLabel { get; }

    /// <summary>True when the next control shows a trailing arrow (web <c>currentStep &lt; totalSteps - 1</c>).</summary>
    public bool ShowNextArrow { get; }

    /// <summary>True for the final step (web <c>currentStep === totalSteps - 1</c>).</summary>
    public bool IsLastStep { get; }

    /// <summary>The zero-based current step index (web <c>currentStep</c>).</summary>
    public int CurrentStep { get; }

    /// <summary>The total step count (web <c>totalSteps</c>).</summary>
    public int TotalSteps { get; }

    /// <summary>The progress dots (web L144-156).</summary>
    public IReadOnlyList<TourProgressDot> ProgressDots { get; }

    /// <summary>
    /// Project a snapshot (or its absence) plus the viewport into a render-ready value, reproducing the web
    /// component (web/src/components/feedback/TourOverlay.tsx L25-160). When no snapshot is present, or its target
    /// has not been measured, the overlay is inactive (the web <c>return null</c>); the labels are still resolved so
    /// they are ready the instant a tour starts.
    /// </summary>
    /// <param name="snapshot">The active-tour state, or null when no tour is running.</param>
    /// <param name="viewport">The overlay viewport extent the tooltip clamps against.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static TourOverlayProjection Project(TourSnapshot? snapshot, TourViewport viewport, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (snapshot is null || !snapshot.TargetRect.HasValue)
        {
            return Inactive(localizer);
        }

        TourTargetRect target = snapshot.TargetRect.Value;
        int current = snapshot.CurrentStep;
        int total = snapshot.TotalSteps;

        return new TourOverlayProjection(
            isActive: true,
            spotlight: TourOverlayRegistration.Spotlight(target),
            tooltip: TourOverlayRegistration.Tooltip(snapshot.Step.Placement, target, viewport),
            title: snapshot.Step.Title,
            description: snapshot.Step.Description,
            stepCounterText: TourOverlayRegistration.StepCounterText(current, total),
            dialogLabel: TourOverlayRegistration.ResolveDialogLabel(localizer, current, total),
            closeLabel: TourOverlayRegistration.ResolveCloseLabel(localizer),
            skipLabel: TourOverlayRegistration.ResolveSkipLabel(localizer),
            showBack: TourOverlayRegistration.ShowBack(current),
            backLabel: TourOverlayRegistration.ResolveBackLabel(localizer),
            nextLabel: TourOverlayRegistration.ResolveNextLabel(localizer, current, total),
            showNextArrow: TourOverlayRegistration.ShowNextArrow(current, total),
            isLastStep: TourOverlayRegistration.IsLastStep(current, total),
            currentStep: current,
            totalSteps: total,
            progressDots: TourOverlayRegistration.ProgressDots(current, total));
    }

    private static TourOverlayProjection Inactive(ILocalizer localizer) =>
        new(
            isActive: false,
            spotlight: default,
            tooltip: default,
            title: string.Empty,
            description: string.Empty,
            stepCounterText: string.Empty,
            dialogLabel: string.Empty,
            closeLabel: TourOverlayRegistration.ResolveCloseLabel(localizer),
            skipLabel: TourOverlayRegistration.ResolveSkipLabel(localizer),
            showBack: false,
            backLabel: TourOverlayRegistration.ResolveBackLabel(localizer),
            nextLabel: TourOverlayRegistration.ResolveNextLabel(localizer, 0, 1),
            showNextArrow: false,
            isLastStep: true,
            currentStep: 0,
            totalSteps: 0,
            progressDots: Array.Empty<TourProgressDot>());
}

/// <summary>
/// PII-safe diagnostics for the <c>TourOverlay</c> surface (P1/S11 diagnostics contract). The overlay carries
/// caller-supplied tour copy, so the collector records ONLY the operational <c>view.opened</c> event with the
/// surface slug — never the step title or description — so a diagnostics line can never leak product copy or fleet
/// state. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class TourOverlayDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink the operational event line is written to.</param>
    public TourOverlayDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TourOverlay</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TourOverlayRegistration.Slug}");
    }
}
