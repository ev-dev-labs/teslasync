using System.Globalization;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One of the current user's vehicle pins — the native port of the fields the web <c>VehiclePicker</c> reads
/// from a <c>usePinned('vehicle')</c> row (web/src/api/types.ts <c>PinnedItem</c>: <c>item_id</c>,
/// <c>position</c>). The web source only consumes those two fields (it floats pinned vehicles to the top in
/// <c>position</c> order and prefixes them with a 📌 glyph), so this record carries exactly them and nothing
/// PII-adjacent beyond the id the user themselves pinned. <see cref="ItemId"/> is the stringified vehicle id
/// (the web stores pin ids as strings and compares them with <c>String(v.id)</c>); <see cref="Position"/> is the
/// pin's sort rank within the bucket.
/// </summary>
/// <param name="ItemId">The pinned vehicle's id as a string (web <c>PinnedItem.item_id</c>).</param>
/// <param name="Position">The pin's ordering rank within the vehicle bucket (web <c>PinnedItem.position</c>).</param>
public sealed record VehiclePickerPin(string ItemId, int Position);

/// <summary>
/// The pin seam backing the app-wide vehicle picker — the native equivalent of the web
/// <c>usePinned('vehicle')</c> query (web/src/api/hooks/usePinned.ts). The view never fetches; a composition
/// root binds an implementation that mirrors the <c>/pinned?type=vehicle</c> cache into <see cref="Pins"/> and
/// raises <see cref="Changed"/> when it moves, and the <see cref="VehiclePickerViewModel"/> reprojects in
/// response. Like the web hook (which defaults <c>data</c> to <c>[]</c>) <see cref="Pins"/> is never
/// <see langword="null"/>: a still-loading or failed pin query simply reads as an empty pin set, so the picker's
/// ordering degrades to plain API order rather than blocking — the picker's own visibility depends only on the
/// fleet size, never on the pins.
/// </summary>
public interface IVehiclePinSource
{
    /// <summary>Raised when <see cref="Pins"/> changes (web: the <c>usePinned</c> query result moving).</summary>
    event EventHandler? Changed;

    /// <summary>The current vehicle pins (never <see langword="null"/>; empty until the pin query resolves).</summary>
    IReadOnlyList<VehiclePickerPin> Pins { get; }
}

/// <summary>
/// The process-local <see cref="IVehiclePinSource"/> used by headless hosts, the surface's default construction,
/// and tests. It holds the current pin set in memory and raises <see cref="Changed"/> whenever
/// <see cref="SetPins"/> swaps it, exactly as the web <c>usePinned</c> query result updates its subscribers; the
/// production composition root replaces it with one bound to the <c>/pinned?type=vehicle</c> repository. Starts
/// with an empty pin set (the web default before the query resolves), so a picker bound to it floats nothing and
/// renders the fleet in plain API order.
/// </summary>
public sealed class InMemoryVehiclePinSource : IVehiclePinSource
{
    private IReadOnlyList<VehiclePickerPin> _pins;

    /// <summary>Creates the source over an optional initial pin set (defaults to empty).</summary>
    public InMemoryVehiclePinSource(IReadOnlyList<VehiclePickerPin>? pins = null) =>
        _pins = pins ?? Array.Empty<VehiclePickerPin>();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<VehiclePickerPin> Pins => _pins;

    /// <summary>Replace the current pin set and notify subscribers (the web query result moving).</summary>
    public void SetPins(IReadOnlyList<VehiclePickerPin>? pins)
    {
        _pins = pins ?? Array.Empty<VehiclePickerPin>();
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// One already-projected, pin-aware picker option — the native port of an entry in the web
/// <c>VehiclePicker</c>'s <c>options</c> array (web/src/components/layout/VehiclePicker.tsx L45-L56:
/// <c>{ value: String(v.id), label: isPinned ? `📌 ${base}` : base }</c>). <see cref="Value"/> is the stable
/// string the trigger round-trips (the stringified id, matching the web <c>&lt;option value&gt;</c>),
/// <see cref="Label"/> is the human-facing trigger text (already carrying the 📌 prefix when pinned),
/// <see cref="Id"/> is retained so the view can map a committed option back to the numeric scope id without
/// re-parsing, and <see cref="IsPinned"/> records whether the row was floated (for assertions / accessibility).
/// </summary>
/// <param name="Id">The numeric vehicle id (web <c>v.id</c>).</param>
/// <param name="Value">The option value the trigger round-trips — the stringified id (web <c>String(v.id)</c>).</param>
/// <param name="Label">The trigger label, 📌-prefixed when pinned (web <c>isPinned ? `📌 ${base}` : base</c>).</param>
/// <param name="IsPinned">Whether this vehicle is pinned (web <c>pins.some(p =&gt; String(p.item_id) === String(v.id))</c>).</param>
public sealed record VehiclePickerItem(long Id, string Value, string Label, bool IsPinned);

/// <summary>
/// The app-wide vehicle picker's data adapter (P1/S8 projection seam) — the native unification of the web
/// <c>VehiclePicker</c>'s pin-aware <c>sorted</c> + <c>options</c> memos
/// (web/src/components/layout/VehiclePicker.tsx L31-L56). The view never fetches; it reads the cached fleet from
/// the shared <see cref="VehicleSelectState"/> holder and the pins from <see cref="IVehiclePinSource"/> and asks
/// this pure adapter to (1) float pinned vehicles to the top in pin-position order while keeping the rest in
/// their original API order, and (2) project each into a render-ready <see cref="VehiclePickerItem"/> — reusing
/// the shared, unit-tested <see cref="VehicleLabels.Short"/> rule (display name → VIN → "Vehicle {id}") so the
/// native trigger reads identically to the web option label, with a 📌 prefix on pinned rows. UI-free so the
/// cached → projection mapping is asserted without a XAML host.
/// </summary>
public static class VehiclePickerProjection
{
    /// <summary>
    /// Project the cached fleet into pin-ordered, render-ready options (web <c>sorted.map(...)</c>). Pinned
    /// vehicles float to the top in ascending <c>position</c> order; every other vehicle keeps its original API
    /// order (a stable sort, matching the web comparator's <c>return 0</c> for two unpinned rows). A
    /// <see langword="null"/> or empty fleet projects to an empty list. A <see langword="null"/> or empty pin set
    /// leaves the fleet in plain API order (web <c>if (pins.length === 0) return vehicles</c>).
    /// </summary>
    public static IReadOnlyList<VehiclePickerItem> ToItems(
        IReadOnlyList<VehicleOption>? vehicles,
        IReadOnlyList<VehiclePickerPin>? pins)
    {
        if (vehicles is null || vehicles.Count == 0)
        {
            return Array.Empty<VehiclePickerItem>();
        }

        // Build the pin-position lookup keyed by the stringified id (web order Map; last write wins, matching
        // pins.forEach(p => order.set(...))).
        var order = new Dictionary<string, int>(pins?.Count ?? 0, StringComparer.Ordinal);
        if (pins is not null)
        {
            foreach (var pin in pins)
            {
                if (!string.IsNullOrEmpty(pin.ItemId))
                {
                    order[pin.ItemId] = pin.Position;
                }
            }
        }

        // Stable sort: pinned first by position, the rest left in original API order (the explicit index
        // tie-break makes the stability independent of the underlying sort and matches the web comparator).
        var sorted = vehicles
            .Select((vehicle, index) => (vehicle, index))
            .OrderBy(entry => order.TryGetValue(Key(entry.vehicle.Id), out var position) ? position : int.MaxValue)
            .ThenBy(entry => entry.index);

        var items = new List<VehiclePickerItem>(vehicles.Count);
        foreach (var (vehicle, _) in sorted)
        {
            var isPinned = order.ContainsKey(Key(vehicle.Id));
            var baseLabel = VehicleLabels.Short(vehicle);
            items.Add(
                new VehiclePickerItem(
                    vehicle.Id,
                    Key(vehicle.Id),
                    isPinned ? VehiclePickerRegistration.PinnedPrefix + baseLabel : baseLabel,
                    isPinned));
        }

        return items;
    }

    /// <summary>
    /// Parse a trigger value back into a scope id, applying the web commit rule
    /// (web L76-L78: <c>const next = Number(e.target.value); setVehicleId(Number.isFinite(next) &amp;&amp; next &gt; 0 ? next : null)</c>).
    /// A blank, non-numeric or non-positive value clears the scope (<see langword="null"/>).
    /// </summary>
    public static long? ParseValue(string? value)
    {
        if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0)
        {
            return parsed;
        }

        return null;
    }

    private static string Key(long id) => id.ToString(CultureInfo.InvariantCulture);
}
