using System.Globalization;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One already-projected fleet option — the native port of an entry in the web <c>VehicleSelect</c>'s
/// <c>options</c> array (web/src/components/forms/VehicleSelect.tsx L47-L50:
/// <c>{ value: String(v.id), label: v.display_name || v.vin || `Vehicle ${v.id}` }</c>). <see cref="Value"/>
/// is the stable string the trigger round-trips (the stringified id, matching the web <c>&lt;option value&gt;</c>),
/// <see cref="Label"/> is the human-facing trigger text, and <see cref="Id"/> is retained so the view can map
/// a committed option back to the numeric scope id without re-parsing.
/// </summary>
/// <param name="Id">The numeric vehicle id (web <c>v.id</c>).</param>
/// <param name="Value">The option value the trigger round-trips — the stringified id (web <c>String(v.id)</c>).</param>
/// <param name="Label">The trigger label (web <c>display_name || vin || `Vehicle ${id}`</c>).</param>
public sealed record VehicleSelectItem(long Id, string Value, string Label);

/// <summary>
/// The vehicle-scope picker's data adapter (P1/S8 projection seam) — the native unification of the web
/// <c>VehicleSelect</c>'s <c>vehicles.map(...)</c> step (web/src/components/forms/VehicleSelect.tsx L47-L50).
/// The view never fetches; it reads the cached fleet from the shared
/// <see cref="VehicleSelectState"/> holder and asks this pure adapter to project each
/// <see cref="VehicleOption"/> into a render-ready <see cref="VehicleSelectItem"/>, reusing the shared,
/// unit-tested <see cref="VehicleLabels.Short"/> rule (display name → VIN → "Vehicle {id}") so the native
/// trigger reads identically to the web option label. UI-free so the cached → projection mapping is asserted
/// without a XAML host.
/// </summary>
public static class VehicleSelectProjection
{
    /// <summary>
    /// Project the cached fleet into render-ready options (web <c>vehicles.map(v =&gt; ({ value, label }))</c>).
    /// A <see langword="null"/> or empty fleet projects to an empty list (web renders nothing in that case).
    /// </summary>
    public static IReadOnlyList<VehicleSelectItem> ToItems(IReadOnlyList<VehicleOption>? vehicles)
    {
        if (vehicles is null || vehicles.Count == 0)
        {
            return Array.Empty<VehicleSelectItem>();
        }

        var items = new List<VehicleSelectItem>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            items.Add(
                new VehicleSelectItem(
                    vehicle.Id,
                    vehicle.Id.ToString(CultureInfo.InvariantCulture),
                    VehicleLabels.Short(vehicle)));
        }

        return items;
    }

    /// <summary>
    /// Parse a trigger value back into a scope id, applying the web commit rule
    /// (web L57-L60: <c>const next = Number(e.target.value); setVehicleId(Number.isFinite(next) &amp;&amp; next &gt; 0 ? next : null)</c>).
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
}
