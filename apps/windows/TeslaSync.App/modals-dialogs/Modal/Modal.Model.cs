using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Modal width preset — the native mirror of the web <c>Modal</c> <c>size</c> prop
/// (<c>'sm' | 'md' | 'lg' | 'full'</c>, web/src/components/ui/Modal.tsx). The preset is applied at the
/// <c>≥ sm</c> (640&#160;px) breakpoint; below it the modal is full-bleed regardless of the preset (see
/// <see cref="ModalProjection.IsFullBleed"/>).
/// </summary>
public enum ModalSize
{
    /// <summary>Compact dialog (web <c>sm:max-w-sm</c> — 24&#160;rem / 384&#160;px).</summary>
    Sm,

    /// <summary>Default dialog (web <c>sm:max-w-lg</c> — 32&#160;rem / 512&#160;px). The web default.</summary>
    Md,

    /// <summary>Wide dialog (web <c>sm:max-w-2xl</c> — 42&#160;rem / 672&#160;px).</summary>
    Lg,

    /// <summary>Full dialog (web <c>sm:max-w-[min(96vw,1100px)]</c>).</summary>
    Full,
}

/// <summary>Wire mapping for <see cref="ModalSize"/> — UI-free so it is asserted headlessly.</summary>
public static class ModalSizes
{
    /// <summary>The lower-case token for <paramref name="size"/> (web <c>size</c> union member).</summary>
    public static string ToToken(ModalSize size) => size switch
    {
        ModalSize.Sm => "sm",
        ModalSize.Md => "md",
        ModalSize.Lg => "lg",
        ModalSize.Full => "full",
        _ => "md",
    };

    /// <summary>Parse a web <c>size</c> token back to a <see cref="ModalSize"/>; false (→ md) for unknown.</summary>
    public static bool TryFromToken(string? token, out ModalSize size)
    {
        switch (token)
        {
            case "sm":
                size = ModalSize.Sm;
                return true;
            case "md":
                size = ModalSize.Md;
                return true;
            case "lg":
                size = ModalSize.Lg;
                return true;
            case "full":
                size = ModalSize.Full;
                return true;
            default:
                size = ModalSize.Md;
                return false;
        }
    }
}

/// <summary>
/// Canonical metadata, layout bounds and i18n keys for the <c>Modal</c> surface — the native mirror of
/// <c>web/src/components/ui/Modal.tsx</c>. The web component ships one user-visible string
/// (<c>aria-label="Close"</c>) and a set of Tailwind size / breakpoint literals; every literal is keyed or
/// named here (with the web value as the fallback / default) so the native view and view-model stay free of
/// inline strings and magic numbers and resolve copy through the i18n facade. UI-free so every key + bound is
/// asserted in tests.
/// </summary>
public static class ModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Modal";

    /// <summary>
    /// The <c>sm</c> breakpoint (web Tailwind <c>sm</c> = 640&#160;px). Below it the modal is full-bleed
    /// edge-to-edge regardless of <see cref="ModalSize"/> (web MOBILE_GUIDELINES bottom-sheet behaviour).
    /// </summary>
    public const double MobileBreakpoint = 640;

    /// <summary>
    /// Minimum close-button hit target (web <c>h-11 w-11</c> = 44&#160;px) satisfying WCAG&#160;2.5.5.
    /// </summary>
    public const double CloseButtonMinSize = 44;

    /// <summary>
    /// Fraction of the viewport a dialog may occupy at <c>≥ sm</c> (web <c>full</c> uses <c>min(96vw,…)</c>
    /// and every preset sits inside <c>p-4</c> gutters); caps a preset so it never overflows a small window.
    /// </summary>
    public const double ViewportWidthFraction = 0.96;

    /// <summary>Maximum dialog height at <c>≥ sm</c> as a fraction of the viewport (web <c>max-h-[90vh]</c>).</summary>
    public const double MaxHeightFraction = 0.90;

    /// <summary>The <c>full</c> preset's absolute width cap (web <c>min(96vw,1100px)</c>).</summary>
    public const double FullMaxWidth = 1100;

    /// <summary>
    /// The <c>≥ sm</c> max content width (px) for a preset — the native mirror of the web size map
    /// (<c>sm:max-w-sm</c> / <c>sm:max-w-lg</c> / <c>sm:max-w-2xl</c> / <c>min(96vw,1100px)</c>).
    /// </summary>
    public static double MaxContentWidth(ModalSize size) => size switch
    {
        ModalSize.Sm => 384,
        ModalSize.Md => 512,
        ModalSize.Lg => 672,
        ModalSize.Full => FullMaxWidth,
        _ => 512,
    };

    /// <summary>Close-button accessible name (web <c>aria-label="Close"</c> → <c>t('common.close', 'Close')</c>).</summary>
    public static string CloseLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.close", "Close");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>Modal</c> surface — the native analogue of the web component's render branches:
/// the <c>title &amp;&amp; (…)</c> header gate, the <c>aria-labelledby</c> / <c>aria-label</c> accessible-name
/// choice, the responsive size map (<c>sm:max-w-*</c> applied at <c>≥ sm</c>, full-bleed below <c>sm</c>) and
/// the <c>max-h-[90vh]</c> height cap. Kept static and resource-free so it is exhaustively unit-testable
/// without a XAML runtime.
/// </summary>
public static class ModalProjection
{
    /// <summary>True when a header (title + close button) renders (web <c>title &amp;&amp; (…)</c>).</summary>
    public static bool ShouldRenderHeader(string? title) => !string.IsNullOrEmpty(title);

    /// <summary>
    /// The dialog's accessible name — the title when present (web <c>aria-labelledby={titleId}</c>), otherwise
    /// the caller-supplied <paramref name="ariaLabel"/> (web <c>aria-label={ariaLabel}</c>), or empty when
    /// neither is set.
    /// </summary>
    public static string ResolveAccessibleName(string? title, string? ariaLabel) =>
        !string.IsNullOrEmpty(title) ? title : ariaLabel ?? string.Empty;

    /// <summary>
    /// True when the modal is full-bleed edge-to-edge — the native analogue of the web
    /// <c>&lt; sm</c> behaviour (a viewport narrower than <see cref="ModalRegistration.MobileBreakpoint"/>).
    /// A non-positive width is treated as unknown (not full-bleed).
    /// </summary>
    public static bool IsFullBleed(double availableWidth) =>
        availableWidth > 0 && availableWidth < ModalRegistration.MobileBreakpoint;

    /// <summary>
    /// The effective dialog max width (px) for <paramref name="size"/> given the current viewport width — the
    /// native analogue of the web responsive size rule. Below <c>sm</c> the dialog fills the viewport; at or
    /// above <c>sm</c> it is the preset, capped to <see cref="ModalRegistration.ViewportWidthFraction"/> of the
    /// viewport so a preset never overflows a small window (mirrors the web <c>full</c> <c>min(96vw,1100px)</c>
    /// and the <c>p-4</c> gutters). An unknown (non-positive) viewport falls back to the preset.
    /// </summary>
    public static double EffectiveMaxWidth(ModalSize size, double availableWidth)
    {
        if (availableWidth <= 0)
        {
            return ModalRegistration.MaxContentWidth(size);
        }

        if (IsFullBleed(availableWidth))
        {
            return availableWidth;
        }

        return Math.Min(
            ModalRegistration.MaxContentWidth(size),
            availableWidth * ModalRegistration.ViewportWidthFraction);
    }

    /// <summary>
    /// The effective dialog max height (px) given the current viewport — the native analogue of the web
    /// <c>max-h-[100dvh]</c> (full-bleed) / <c>max-h-[90vh]</c> (<c>≥ sm</c>) rule. An unknown (non-positive)
    /// viewport returns <see cref="double.PositiveInfinity"/> (no constraint).
    /// </summary>
    public static double EffectiveMaxHeight(double availableWidth, double availableHeight)
    {
        if (availableHeight <= 0)
        {
            return double.PositiveInfinity;
        }

        return IsFullBleed(availableWidth)
            ? availableHeight
            : availableHeight * ModalRegistration.MaxHeightFraction;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>Modal</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> counter with the surface slug — never any caller content (title / body) — so
/// a diagnostics line can never leak modal content. Thread-safe.
/// </summary>
public sealed class ModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Modal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={ModalRegistration.Slug}"));
    }
}
