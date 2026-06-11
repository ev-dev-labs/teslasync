using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Side of the anchor the popover opens toward — the native mirror of the web
/// <c>PopoverSide</c> union (<c>'bottom' | 'top'</c>, web/src/components/ui/Popover.tsx). The requested
/// side auto-flips to the opposite when the content would overflow the viewport on that side
/// (web <c>resolvedSide</c>).
/// </summary>
public enum PopoverSide
{
    /// <summary>Open below the anchor (web <c>'bottom'</c>; the default).</summary>
    Bottom,

    /// <summary>Open above the anchor (web <c>'top'</c>).</summary>
    Top,
}

/// <summary>
/// Cross-axis alignment of the popover relative to the anchor — the native mirror of the web
/// <c>PopoverAlign</c> union (<c>'start' | 'end' | 'center'</c>, web/src/components/ui/Popover.tsx).
/// </summary>
public enum PopoverAlign
{
    /// <summary>Align the popover's start edge to the anchor's start edge (web <c>'start'</c>; the default).</summary>
    Start,

    /// <summary>Align the popover's end edge to the anchor's end edge (web <c>'end'</c>).</summary>
    End,

    /// <summary>Center the popover on the anchor's cross-axis midpoint (web <c>'center'</c>).</summary>
    Center,
}

/// <summary>
/// Why the popover closed — the native analogue of the web component's three dismiss triggers: the
/// <c>Escape</c> key handler, the pointer-down-outside handler and a consumer-driven <c>onClose</c> call.
/// Carried with the close so diagnostics can record the cause without leaking any content.
/// </summary>
public enum PopoverDismissReason
{
    /// <summary>The user pressed <c>Escape</c> (web <c>onKeyDown</c> → <c>e.key === 'Escape'</c>).</summary>
    Escape,

    /// <summary>The user pointed down outside the content and the anchor (web <c>onPointerDown</c>).</summary>
    PointerOutside,

    /// <summary>The host closed the popover directly (web consumer <c>onClose</c> / <c>open=false</c>).</summary>
    Programmatic,
}

/// <summary>Wire mapping for <see cref="PopoverDismissReason"/> — UI-free so it is asserted headlessly.</summary>
public static class PopoverDismissReasons
{
    /// <summary>The lower-case diagnostics token for <paramref name="reason"/>.</summary>
    public static string ToWire(PopoverDismissReason reason) => reason switch
    {
        PopoverDismissReason.Escape => "escape",
        PopoverDismissReason.PointerOutside => "pointer-outside",
        PopoverDismissReason.Programmatic => "programmatic",
        _ => "programmatic",
    };

    /// <summary>Parse a diagnostics token back to a <see cref="PopoverDismissReason"/>; false for an unknown token.</summary>
    public static bool TryFromWire(string? wire, out PopoverDismissReason reason)
    {
        switch (wire)
        {
            case "escape":
                reason = PopoverDismissReason.Escape;
                return true;
            case "pointer-outside":
                reason = PopoverDismissReason.PointerOutside;
                return true;
            case "programmatic":
                reason = PopoverDismissReason.Programmatic;
                return true;
            default:
                reason = PopoverDismissReason.Programmatic;
                return false;
        }
    }
}

/// <summary>
/// A laid-out rectangle in viewport coordinates — the native analogue of the web <c>DOMRect</c> the
/// component reads from <c>getBoundingClientRect()</c> for the anchor and the content. <see cref="Right"/>
/// and <see cref="Bottom"/> are derived exactly as the browser computes them so the ported positioning
/// math stays bit-for-bit faithful.
/// </summary>
public readonly record struct PopoverRect(double Left, double Top, double Width, double Height)
{
    /// <summary>The right edge (web <c>rect.right</c> = <c>left + width</c>).</summary>
    public double Right => Left + Width;

    /// <summary>The bottom edge (web <c>rect.bottom</c> = <c>top + height</c>).</summary>
    public double Bottom => Top + Height;

    /// <summary>
    /// True when <paramref name="x"/>/<paramref name="y"/> falls within the rectangle (inclusive) — the
    /// native analogue of the web <c>node.contains(target)</c> hit-test used by the pointer-down handler.
    /// </summary>
    public bool Contains(double x, double y) => x >= Left && x <= Right && y >= Top && y <= Bottom;
}

/// <summary>The measured size of the popover content (web content <c>getBoundingClientRect()</c> width/height).</summary>
public readonly record struct PopoverSize(double Width, double Height);

/// <summary>The viewport extent (web <c>window.innerWidth</c> / <c>window.innerHeight</c>).</summary>
public readonly record struct PopoverViewport(double Width, double Height);

/// <summary>
/// The resolved popover position — the native analogue of the web <c>pos</c> state
/// (<c>{ top, left, resolvedSide }</c>). <see cref="Top"/> / <see cref="Left"/> are viewport coordinates and
/// <see cref="ResolvedSide"/> is the side actually used after the auto-flip.
/// </summary>
public readonly record struct PopoverPlacement(double Top, double Left, PopoverSide ResolvedSide);

/// <summary>
/// Canonical constants and the (anonymous) accessible region label for the <c>Popover</c> surface — the
/// native mirror of <c>web/src/components/ui/Popover.tsx</c>. The web component is a pure positioning
/// primitive: it portals content to <c>&lt;body&gt;</c>, positions it relative to an anchor, auto-flips the
/// side and clamps to the viewport, and closes on <c>Escape</c> / pointer-outside while restoring focus to
/// the trigger. It performs no data read, so it has no loading / empty / error / stale / offline state, and
/// it extracts no copy (its only accessible string is the consumer-supplied <c>ariaLabel</c>). UI-free so
/// every constant and key is asserted headlessly.
/// </summary>
public static class PopoverRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Popover";

    /// <summary>Default pixel gap between the anchor and the popover (web <c>sideOffset = 6</c>).</summary>
    public const double DefaultSideOffset = 6.0;

    /// <summary>Pixel margin kept between the popover and every viewport edge (web <c>const margin = 8</c>).</summary>
    public const double ViewportMargin = 8.0;

    /// <summary>Stacking order of the content surface (web <c>zIndex: 60</c>).</summary>
    public const int ZIndex = 60;

    /// <summary>The off-screen coordinate used before the content is measured (web hidden <c>top/left: -9999</c>).</summary>
    public const double OffscreenCoordinate = -9999.0;

    /// <summary>
    /// The fallback accessible name for the popover region when the consumer supplies no <c>ariaLabel</c>
    /// (web <c>aria-label={ariaLabel}</c>). Routed through the i18n facade so the Narrator name is never a raw
    /// English literal; the English fallback keeps the region named even before a catalog entry exists.
    /// </summary>
    public static string RegionLabel(ILocalizer localizer) =>
        Require(localizer).GetString("popover.region", "Popover");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>Popover</c> surface — the native analogue of the web component's
/// <c>compute()</c> positioner (side auto-flip + cross-axis alignment + viewport clamp), its
/// <c>onPointerDown</c> outside hit-test, its <c>Escape</c> key check and its <c>aria-label</c> resolution.
/// Every method is UI-thread-free and side-effect-free so the positioning contract is unit-tested headlessly
/// and the view-model never reaches into WinUI for geometry.
/// </summary>
public static class PopoverProjection
{
    /// <summary>
    /// Resolve the side the popover actually opens toward — the native analogue of the web
    /// <c>resolvedSide</c> branch. A <see cref="PopoverSide.Bottom"/> request flips to
    /// <see cref="PopoverSide.Top"/> only when the content is taller than the space below <em>and</em> there is
    /// more room above than below; a <see cref="PopoverSide.Top"/> request flips to
    /// <see cref="PopoverSide.Bottom"/> under the mirror condition. Otherwise the requested side is kept.
    /// </summary>
    public static PopoverSide ResolveSide(
        PopoverSide requested,
        double contentHeight,
        double spaceAbove,
        double spaceBelow)
    {
        if (requested == PopoverSide.Bottom && contentHeight > spaceBelow && spaceAbove > spaceBelow)
        {
            return PopoverSide.Top;
        }

        if (requested == PopoverSide.Top && contentHeight > spaceAbove && spaceBelow > spaceAbove)
        {
            return PopoverSide.Bottom;
        }

        return requested;
    }

    /// <summary>
    /// Compute the popover position — the native analogue of the web <c>compute()</c> body. Resolves the side
    /// (auto-flip), places the content on that side at <paramref name="sideOffset"/>, aligns it along the
    /// cross axis (<see cref="PopoverAlign"/>) and clamps it horizontally and vertically so it never crosses a
    /// viewport edge inside <paramref name="margin"/>.
    /// </summary>
    public static PopoverPlacement ResolvePlacement(
        PopoverRect anchor,
        PopoverSize content,
        PopoverViewport viewport,
        PopoverSide side,
        PopoverAlign align,
        double sideOffset,
        double margin)
    {
        double spaceBelow = viewport.Height - anchor.Bottom - sideOffset - margin;
        double spaceAbove = anchor.Top - sideOffset - margin;
        PopoverSide resolvedSide = ResolveSide(side, content.Height, spaceAbove, spaceBelow);

        double top = resolvedSide == PopoverSide.Bottom
            ? anchor.Bottom + sideOffset
            : anchor.Top - sideOffset - content.Height;

        double left = align switch
        {
            PopoverAlign.Start => anchor.Left,
            PopoverAlign.End => anchor.Right - content.Width,
            _ => anchor.Left + (anchor.Width / 2) - (content.Width / 2),
        };

        // Clamp horizontally to the viewport (web left-edge / right-edge guards).
        if (left + content.Width + margin > viewport.Width)
        {
            left = viewport.Width - content.Width - margin;
        }

        if (left < margin)
        {
            left = margin;
        }

        // Clamp vertically (web rare both-sides-overflow guard).
        if (top + content.Height + margin > viewport.Height)
        {
            top = viewport.Height - content.Height - margin;
        }

        if (top < margin)
        {
            top = margin;
        }

        return new PopoverPlacement(top, left, resolvedSide);
    }

    /// <summary>
    /// True when a pointer-down at <paramref name="x"/>/<paramref name="y"/> should dismiss the popover — the
    /// native analogue of the web <c>onPointerDown</c> handler: a press inside the content or the anchor is
    /// ignored, anything else closes.
    /// </summary>
    public static bool IsPointerOutside(PopoverRect content, PopoverRect anchor, double x, double y) =>
        !content.Contains(x, y) && !anchor.Contains(x, y);

    /// <summary>True for the <c>Escape</c> key (web <c>e.key === 'Escape'</c>).</summary>
    public static bool IsEscape(string? key) => string.Equals(key, "Escape", StringComparison.Ordinal);

    /// <summary>
    /// Resolve the popover's accessible name — the consumer's <paramref name="ariaLabel"/> when present
    /// (web <c>aria-label={ariaLabel}</c>), otherwise the localized region fallback so the dialog is never
    /// anonymous to Narrator.
    /// </summary>
    public static string ResolveAriaLabel(string? ariaLabel, ILocalizer localizer) =>
        string.IsNullOrWhiteSpace(ariaLabel) ? PopoverRegistration.RegionLabel(localizer) : ariaLabel;
}

/// <summary>
/// PII-safe diagnostics for the <c>Popover</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug and the dismiss reason — never the anchored content or any
/// consumer string — so a diagnostics line can never leak popover content. Thread-safe.
/// </summary>
public sealed class PopoverDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _dismissals;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PopoverDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the popover has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the popover has been dismissed.</summary>
    public long Dismissals => Interlocked.Read(ref _dismissals);

    /// <summary>Record that the popover opened, emitting <c>view.opened slug=Popover</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={PopoverRegistration.Slug}"));
    }

    /// <summary>Record a dismissal, emitting <c>popover.dismissed slug=Popover reason=&lt;reason&gt;</c>.</summary>
    public void RecordDismissed(PopoverDismissReason reason)
    {
        Interlocked.Increment(ref _dismissals);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture,
            $"popover.dismissed slug={PopoverRegistration.Slug} reason={PopoverDismissReasons.ToWire(reason)}"));
    }
}
