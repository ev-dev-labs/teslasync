using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata, i18n keys, token keys and sizing metrics for the <c>PinButton</c> shared surface — the
/// native mirror of the web component (web/src/components/ui/PinButton.tsx). The web component is a focusable,
/// icon-only toggle that flips the current user's pin state for a single item: it reads the unified pin store via
/// <c>usePinned(itemType, context)</c>, computes <c>isPinned</c>, and on click flips it through
/// <c>useTogglePin(itemType)</c> — which (via <c>useMutationToast</c>) raises a "Pinned" / "Unpinned" success toast
/// or a "Failed to pin" / "Failed to unpin" error toast. The trigger shows the lucide <c>Pin</c> glyph when
/// unpinned and the <c>PinOff</c> glyph (amber) when pinned, its tooltip / accessible name reads "Pin" / "Unpin",
/// and an optional visible label reads "Pin" / "Pinned". This metadata carries the diagnostics slug the surface
/// registers under, every render-contract i18n key/fallback the web source passes to <c>t()</c> (the tooltip /
/// label keys and the four mutation-toast keys), the design-token brush keys the trigger tints from, and the
/// per-size sizing metrics. Every key carries the <c>translation.</c> catalog prefix the WinUI resource bridge
/// expects (the convention every shipped surface uses) and resolves against the English fallback headlessly.
/// UI-free so it is asserted without a XAML host.
/// </summary>
public static class PinButtonRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "PinButton";

    // ── tooltip / accessible-name keys (web `pin.unpin` / `pin.pin`) ─────────────────────────────────────

    /// <summary>i18n key for the "Pin" tooltip / accessible name shown when the item is not pinned (web <c>pin.pin</c>).</summary>
    public const string PinKey = "translation.pin.pin";

    /// <summary>English fallback for <see cref="PinKey"/> (web second arg, verbatim).</summary>
    public const string PinFallback = "Pin";

    /// <summary>i18n key for the "Unpin" tooltip / accessible name shown when the item is pinned (web <c>pin.unpin</c>).</summary>
    public const string UnpinKey = "translation.pin.unpin";

    /// <summary>English fallback for <see cref="UnpinKey"/> (web second arg, verbatim).</summary>
    public const string UnpinFallback = "Unpin";

    /// <summary>i18n key for the visible "Pinned" label shown next to the icon when pinned (web <c>pin.pinned</c>).</summary>
    public const string PinnedKey = "translation.pin.pinned";

    /// <summary>English fallback for <see cref="PinnedKey"/> (web second arg, verbatim).</summary>
    public const string PinnedFallback = "Pinned";

    // ── mutation toast keys (web useTogglePin → useMutationToast) ────────────────────────────────────────

    /// <summary>i18n key for the pin-succeeded toast (web <c>toast.pin.pinned.success</c>).</summary>
    public const string PinnedSuccessKey = "translation.toast.pin.pinned.success";

    /// <summary>English fallback for <see cref="PinnedSuccessKey"/> (web second arg, verbatim).</summary>
    public const string PinnedSuccessFallback = "Pinned";

    /// <summary>i18n key for the unpin-succeeded toast (web <c>toast.pin.unpinned.success</c>).</summary>
    public const string UnpinnedSuccessKey = "translation.toast.pin.unpinned.success";

    /// <summary>English fallback for <see cref="UnpinnedSuccessKey"/> (web second arg, verbatim).</summary>
    public const string UnpinnedSuccessFallback = "Unpinned";

    /// <summary>i18n key for the pin-failed toast (web <c>toast.pin.pinned.error</c>).</summary>
    public const string PinFailedKey = "translation.toast.pin.pinned.error";

    /// <summary>English fallback for <see cref="PinFailedKey"/> (web second arg, verbatim).</summary>
    public const string PinFailedFallback = "Failed to pin";

    /// <summary>i18n key for the unpin-failed toast (web <c>toast.pin.unpinned.error</c>).</summary>
    public const string UnpinFailedKey = "translation.toast.pin.unpinned.error";

    /// <summary>English fallback for <see cref="UnpinFailedKey"/> (web second arg, verbatim).</summary>
    public const string UnpinFailedFallback = "Failed to unpin";

    // ── design-token brush keys (web text-amber-300 / text-[var(--text-muted)]) ─────────────────────────

    /// <summary>
    /// Foreground brush token for the pinned state — the amber accent the web source paints with
    /// <c>text-amber-300</c>. Resolved by the view through the design-token bridge so light / dark / high-contrast
    /// all flow from W1 without ad-hoc colours.
    /// </summary>
    public const string PinnedBrushKey = "TsColorWarningBrush";

    /// <summary>
    /// Foreground brush token for the unpinned (idle) state — the muted text colour the web source paints with
    /// <c>text-[var(--text-muted)]</c>.
    /// </summary>
    public const string IdleBrushKey = "TsColorTextMutedBrush";
}

/// <summary>
/// The domain bucket a pin belongs to — the native port of the web <c>PinnedItemType</c> union
/// (web/src/api/types.ts L2500-2508). It drives both the API call and the cache key on the web side; here it is
/// the bucket the <see cref="IPinStore"/> seam reads and writes. <see cref="PinItemTypes.WireValue"/> maps each
/// member back to the exact snake_case string the backend contract uses (the value the web passes as
/// <c>item_type</c> / <c>type</c>), so the native enum never drifts from the wire shape.
/// </summary>
public enum PinItemType
{
    /// <summary>web <c>'vehicle'</c>.</summary>
    Vehicle,

    /// <summary>web <c>'widget'</c>.</summary>
    Widget,

    /// <summary>web <c>'alert_rule'</c>.</summary>
    AlertRule,

    /// <summary>web <c>'location'</c>.</summary>
    Location,

    /// <summary>web <c>'geofence'</c>.</summary>
    Geofence,

    /// <summary>web <c>'automation'</c>.</summary>
    Automation,

    /// <summary>web <c>'dashboard'</c>.</summary>
    Dashboard,

    /// <summary>web <c>'command'</c>.</summary>
    Command,
}

/// <summary>
/// The wire-value mapping for <see cref="PinItemType"/> — the single place the native enum is bound to the
/// backend's snake_case contract strings (web <c>PinnedItemType</c> members). Pure data so the mapping is
/// unit-tested without a host.
/// </summary>
public static class PinItemTypes
{
    /// <summary>The exact backend contract string for <paramref name="type"/> (web <c>item_type</c> / <c>type</c> value).</summary>
    /// <param name="type">The domain bucket.</param>
    /// <returns>The snake_case wire value.</returns>
    public static string WireValue(PinItemType type) => type switch
    {
        PinItemType.Vehicle => "vehicle",
        PinItemType.Widget => "widget",
        PinItemType.AlertRule => "alert_rule",
        PinItemType.Location => "location",
        PinItemType.Geofence => "geofence",
        PinItemType.Automation => "automation",
        PinItemType.Dashboard => "dashboard",
        PinItemType.Command => "command",
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unknown pin item type."),
    };
}

/// <summary>
/// The trigger's icon size — the native port of the web <c>size</c> prop (web/src/components/ui/PinButton.tsx
/// L28: <c>'sm'</c> = compact list/table cell, <c>'md'</c> = card header). <see cref="PinButtonMetrics"/> maps
/// each to the icon and box pixel sizes the web Tailwind classes encode.
/// </summary>
public enum PinButtonSize
{
    /// <summary>web <c>'sm'</c> — compact list / table cell (h-7 w-7 box, h-3.5 w-3.5 icon).</summary>
    Small,

    /// <summary>web <c>'md'</c> — card header (h-8 w-8 box, h-4 w-4 icon).</summary>
    Medium,
}

/// <summary>
/// The pixel metrics for each <see cref="PinButtonSize"/> — the native reproduction of the web source's
/// <c>SIZE_CLASS</c> (the icon-only square box: <c>sm</c> h-7 w-7 = 28px, <c>md</c> h-8 w-8 = 32px) and
/// <c>ICON_CLASS</c> (the glyph: <c>sm</c> h-3.5 w-3.5 = 14px, <c>md</c> h-4 w-4 = 16px) maps
/// (web/src/components/ui/PinButton.tsx L35-43). Pure data so the size → pixel mapping is unit-tested without a
/// XAML host.
/// </summary>
public static class PinButtonMetrics
{
    /// <summary>The glyph size in effective pixels (web <c>ICON_CLASS</c>: sm 14, md 16).</summary>
    /// <param name="size">The trigger size.</param>
    public static double IconSize(PinButtonSize size) => size switch
    {
        PinButtonSize.Medium => 16,
        _ => 14,
    };

    /// <summary>
    /// The square icon-only box size in effective pixels (web <c>SIZE_CLASS</c>: sm 28, md 32). Only applied when
    /// no visible label is shown; with a label the web switches to horizontal padding (<c>px-2</c>) and lets the
    /// content size the button.
    /// </summary>
    /// <param name="size">The trigger size.</param>
    public static double BoxSize(PinButtonSize size) => size switch
    {
        PinButtonSize.Medium => 32,
        _ => 28,
    };
}

/// <summary>
/// The outcome of a pin toggle — the native projection of the web <c>useTogglePin</c> mutation result
/// (web/src/api/hooks/usePinned.ts L64-108). A click either flips the pin and confirms with the matching success
/// toast (<see cref="Pinned"/> / <see cref="Unpinned"/>, web <c>onSuccess</c>), fails and raises the matching
/// error toast (<see cref="Failed"/>, web <c>onError</c>), or is dropped because a toggle is already in flight
/// (<see cref="Ignored"/>, web <c>if (toggle.isPending) return</c>). The view-model maps each value, so the
/// outcome routing is unit-tested without a XAML host.
/// </summary>
public enum PinToggleOutcome
{
    /// <summary>web <c>if (toggle.isPending) return</c> — a toggle is already running, the click is dropped.</summary>
    Ignored,

    /// <summary>web success path with <c>pin: true</c> — the item was pinned; the "Pinned" success toast is raised.</summary>
    Pinned,

    /// <summary>web success path with <c>pin: false</c> — the item was unpinned; the "Unpinned" success toast is raised.</summary>
    Unpinned,

    /// <summary>web <c>onError</c> — the toggle failed; the "Failed to pin" / "Failed to unpin" error toast is raised.</summary>
    Failed,
}

/// <summary>
/// PII-safe diagnostics for the pin surface (P1/S11 diagnostics contract). A pin targets a caller-supplied item id
/// (a vehicle id, dashboard id, geofence id, …) which is identifying content and is NEVER recorded; the collector
/// emits ONLY the operational <see cref="RecordViewOpened"/> open event with the surface slug. Thread-safe;
/// mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class PinButtonDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PinButtonDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PinButton</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(CultureInfo.InvariantCulture, $"view.opened slug={PinButtonRegistration.Slug}"));
    }
}
