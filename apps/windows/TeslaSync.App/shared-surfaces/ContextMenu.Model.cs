using System.Collections.Generic;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// A single contextual action the menu can present — the native port of the web <c>ContextMenuItem</c>
/// interface (web/src/components/ui/ContextMenu.tsx L55-L71). Pure, immutable data passed by the caller
/// through the <see cref="IContextMenuController"/> seam: a stable <see cref="Id"/> (the web React key), the
/// inline <see cref="Label"/>, an optional leading <see cref="IconGlyph"/> (the native analogue of the web
/// <c>icon</c> ReactNode — a Segoe Fluent glyph rather than an arbitrary element so the model stays
/// Microsoft.UI-free and headlessly testable), the <see cref="OnSelected"/> action invoked on
/// click / Enter / Space (web <c>onClick</c>; the menu auto-closes first), and the two presentational flags
/// <see cref="IsDisabled"/> (rendered but non-interactive) and <see cref="IsDestructive"/> (tinted with the
/// danger token, e.g. Delete / Archive). <see cref="Shortcut"/> is the optional right-aligned hint
/// (web <c>shortcut</c>, e.g. <c>Ctrl+D</c>). The caller owns the labels / shortcut copy and is responsible
/// for localizing them — the menu chrome itself only localizes its single accessible name.
/// </summary>
public sealed class ContextMenuItem
{
    /// <summary>Creates an immutable menu item from its caller-supplied data.</summary>
    /// <param name="id">Stable identifier (web React key); must be non-empty.</param>
    /// <param name="label">Inline display label (web <c>label</c>); may be empty but not null.</param>
    /// <param name="onSelected">Action run on activation (web <c>onClick</c>); null is an inert item.</param>
    /// <param name="iconGlyph">Optional leading Segoe Fluent glyph (web <c>icon</c>).</param>
    /// <param name="isDisabled">When true the item is shown but non-interactive (web <c>disabled</c>).</param>
    /// <param name="isDestructive">When true the item is tinted with the danger token (web <c>destructive</c>).</param>
    /// <param name="shortcut">Optional right-aligned shortcut hint (web <c>shortcut</c>).</param>
    public ContextMenuItem(
        string id,
        string label,
        Action? onSelected = null,
        string? iconGlyph = null,
        bool isDisabled = false,
        bool isDestructive = false,
        string? shortcut = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        ArgumentNullException.ThrowIfNull(label);

        Id = id;
        Label = label;
        OnSelected = onSelected;
        IconGlyph = iconGlyph;
        IsDisabled = isDisabled;
        IsDestructive = isDestructive;
        Shortcut = shortcut;
    }

    /// <summary>Stable identifier used as the item key (web <c>id</c>).</summary>
    public string Id { get; }

    /// <summary>Inline display label (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>Action invoked on activation (web <c>onClick</c>); the menu closes before it runs.</summary>
    public Action? OnSelected { get; }

    /// <summary>Optional leading Segoe Fluent icon glyph (web <c>icon</c>); null renders no icon.</summary>
    public string? IconGlyph { get; }

    /// <summary>When true the item is rendered but non-interactive (web <c>disabled</c>).</summary>
    public bool IsDisabled { get; }

    /// <summary>When true the item is tinted with the danger token (web <c>destructive</c>).</summary>
    public bool IsDestructive { get; }

    /// <summary>Optional right-aligned shortcut hint (web <c>shortcut</c>); null renders none.</summary>
    public string? Shortcut { get; }
}

/// <summary>
/// The open-menu state — the native port of the web <c>MenuState</c> (web/src/components/ui/ContextMenu.tsx
/// L73-L82). Carries the <see cref="Items"/> to present, the viewport <see cref="X"/> / <see cref="Y"/> the
/// menu anchors at, the <see cref="RestoreTarget"/> that held focus when the menu opened (restored on close —
/// the web <c>restoreFocusEl</c>, kept as an opaque object so the model is Microsoft.UI-free) and a monotonic
/// <see cref="Nonce"/> so re-opening with an identical (items, x, y) still produces a distinct snapshot and
/// re-shows the menu (web <c>nonce</c>). Immutable: the controller publishes a fresh snapshot per open.
/// </summary>
public sealed class ContextMenuSnapshot
{
    /// <summary>Creates an immutable open-menu snapshot.</summary>
    /// <param name="items">The items to present (defensively copied by the controller).</param>
    /// <param name="x">Viewport x the menu anchors at (web <c>x</c>).</param>
    /// <param name="y">Viewport y the menu anchors at (web <c>y</c>).</param>
    /// <param name="nonce">Monotonic open counter (web <c>nonce</c>).</param>
    /// <param name="restoreTarget">Element that owned focus when the menu opened (web <c>restoreFocusEl</c>).</param>
    public ContextMenuSnapshot(IReadOnlyList<ContextMenuItem> items, double x, double y, long nonce, object? restoreTarget)
    {
        ArgumentNullException.ThrowIfNull(items);

        Items = items;
        X = x;
        Y = y;
        Nonce = nonce;
        RestoreTarget = restoreTarget;
    }

    /// <summary>The items the open menu presents (web <c>items</c>).</summary>
    public IReadOnlyList<ContextMenuItem> Items { get; }

    /// <summary>Viewport x the menu anchors at before any flip (web <c>x</c>).</summary>
    public double X { get; }

    /// <summary>Viewport y the menu anchors at before any flip (web <c>y</c>).</summary>
    public double Y { get; }

    /// <summary>Monotonic open counter so identical re-opens still re-render (web <c>nonce</c>).</summary>
    public long Nonce { get; }

    /// <summary>The element that owned focus when the menu opened; restored on close (web <c>restoreFocusEl</c>).</summary>
    public object? RestoreTarget { get; }
}

/// <summary>
/// Canonical metadata + i18n keys for the context-menu surface — the native mirror of the web
/// <c>ContextMenu</c> (web/src/components/ui/ContextMenu.tsx). The web primitive is a portal-rendered menu
/// host carrying exactly one localized string, its <c>role="menu"</c> accessible name
/// (<c>t('contextMenu.menuLabel', 'Context menu')</c>); every item label / shortcut is caller-supplied and
/// localized by the caller. This metadata carries the diagnostics slug the surface registers under, that one
/// render-contract i18n key/fallback (so the native surface reproduces the web copy verbatim) and the danger
/// token key the destructive item tints from. The i18n key carries the <c>translation.</c> catalog prefix the
/// WinUI resource bridge expects (the convention every shipped surface uses) and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class ContextMenuRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ContextMenu";

    /// <summary>i18n key for the menu's accessible name (web <c>contextMenu.menuLabel</c>).</summary>
    public const string MenuLabelKey = "translation.contextMenu.menuLabel";

    /// <summary>English fallback for <see cref="MenuLabelKey"/> (web second arg, verbatim).</summary>
    public const string MenuLabelFallback = "Context menu";

    /// <summary>
    /// Generated danger brush token key (apps/design/generated/windows/Tokens.xaml) the destructive item
    /// tints from — the theme-aware native analogue of the web <c>text-rose-300</c>. Resolved at the display
    /// boundary by the view; named here so the contract is asserted headlessly.
    /// </summary>
    public const string DangerBrushKey = "TsColorDangerBrush";
}

/// <summary>
/// The resolved top-left the menu is shown at after the viewport-overflow flip — a pure value so the flip is
/// unit-tested without a XAML host.
/// </summary>
/// <param name="Left">The resolved left (web adjusted <c>el.style.left</c>).</param>
/// <param name="Top">The resolved top (web adjusted <c>el.style.top</c>).</param>
public readonly record struct ContextMenuPoint(double Left, double Top);

/// <summary>
/// The viewport-overflow flip — the native port of the web measure-and-flip pass
/// (web/src/components/ui/ContextMenu.tsx L252-L270). The web component first positions the menu at
/// <c>(x, y)</c>, measures it, then flips the anchor edge in place when it would overflow: a right-edge
/// overflow re-anchors to <c>x - width</c> (clamped to the margin) and a bottom-edge overflow re-anchors to
/// <c>y - height</c>. <see cref="Resolve"/> reproduces that arithmetic exactly so the menu never opens off the
/// visible surface; the WinUI <c>MenuFlyout</c> the view shows applies the same bounds-correction natively, so
/// this resolved point is both the faithful parity behaviour and the show position the view passes. Static and
/// side-effect-free.
/// </summary>
public static class ContextMenuPlacement
{
    /// <summary>The viewport safety margin in DIPs (web <c>VIEWPORT_MARGIN = 8</c>).</summary>
    public const double ViewportMargin = 8;

    /// <summary>
    /// Resolve the menu's top-left, flipping the anchor edge when the menu would overflow the viewport — the
    /// web <c>useLayoutEffect</c> flip. With no overflow the menu stays at <paramref name="x"/> /
    /// <paramref name="y"/>; on a right-edge overflow the left re-anchors to
    /// <c>max(margin, x - menuWidth)</c>; on a bottom-edge overflow the top re-anchors to
    /// <c>max(margin, y - menuHeight)</c>. The two edges are evaluated independently, exactly as the web source
    /// adjusts left and top in separate guards.
    /// </summary>
    /// <param name="x">Requested anchor x (web <c>state.x</c>).</param>
    /// <param name="y">Requested anchor y (web <c>state.y</c>).</param>
    /// <param name="menuWidth">Measured / estimated menu width (web <c>rect.width</c>).</param>
    /// <param name="menuHeight">Measured / estimated menu height (web <c>rect.height</c>).</param>
    /// <param name="viewportWidth">Viewport width (web <c>window.innerWidth</c>).</param>
    /// <param name="viewportHeight">Viewport height (web <c>window.innerHeight</c>).</param>
    /// <param name="margin">Safety margin; defaults to <see cref="ViewportMargin"/> (web <c>VIEWPORT_MARGIN</c>).</param>
    /// <returns>The resolved, viewport-corrected top-left.</returns>
    public static ContextMenuPoint Resolve(
        double x,
        double y,
        double menuWidth,
        double menuHeight,
        double viewportWidth,
        double viewportHeight,
        double margin = ViewportMargin)
    {
        double left = x;
        double top = y;

        // web: if (left + rect.width + VIEWPORT_MARGIN > viewportW) left = Math.max(VIEWPORT_MARGIN, state.x - rect.width);
        if (left + menuWidth + margin > viewportWidth)
        {
            left = Math.Max(margin, x - menuWidth);
        }

        // web: if (top + rect.height + VIEWPORT_MARGIN > viewportH) top = Math.max(VIEWPORT_MARGIN, state.y - rect.height);
        if (top + menuHeight + margin > viewportHeight)
        {
            top = Math.Max(margin, y - menuHeight);
        }

        return new ContextMenuPoint(left, top);
    }
}

/// <summary>
/// PII-safe diagnostics for the context-menu surface (P1/S11 diagnostics contract). The menu carries
/// caller-supplied action labels that may name user data (vehicle names, saved-view titles, …), so the
/// collector records ONLY the operational <see cref="RecordViewOpened"/> signal with the surface slug — never
/// an item label, shortcut, coordinate or invoked action. Thread-safe; mirrors the shipped surfaces'
/// collectors.
/// </summary>
public sealed class ContextMenuDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ContextMenuDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened (mounted).</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was mounted, emitting <c>view.opened slug=ContextMenu</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ContextMenuRegistration.Slug}");
    }
}
