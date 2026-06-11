using System.Globalization;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// Canonical metadata for the selected-vehicle store surface — the native analogue of the module-level
/// constants in the web <c>store/selectedVehicle.tsx</c>. The web store persists "the vehicle the user is
/// currently focused on" under a single <c>localStorage</c> slot so multi-vehicle owners keep their scope
/// across reloads; this carries the same persistence key (web <c>STORAGE_KEY</c>, exported for tests as
/// <c>__SELECTED_VEHICLE_STORAGE_KEY__</c>) plus the diagnostics slug.
/// </summary>
public static class SelectedVehicleRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "selectedVehicle";

    /// <summary>
    /// The persistence key (web <c>STORAGE_KEY = 'teslasync-selected-vehicle'</c>). The Windows store writes
    /// the selected id under this key in <c>ApplicationData.LocalSettings</c>, the native analogue of the web
    /// <c>localStorage</c> slot.
    /// </summary>
    public const string StorageKey = "teslasync-selected-vehicle";
}

/// <summary>
/// Parsing and validation for a persisted selected-vehicle id — the native port of the web store's
/// <c>loadInitial</c> / <c>onStorage</c> guard (<c>Number.isFinite(n) &amp;&amp; n &gt; 0</c>) and its
/// <c>persist</c> serialization (<c>String(id)</c>). Vehicle ids are 64-bit integers across TeslaSync
/// (matching the Go <c>int64</c> / TypeScript <c>number</c> ids), so a value is accepted only when it is a
/// positive integer; everything else (blank, non-numeric, zero, negative) resolves to "no selection",
/// exactly as the web store discards garbage and non-positive ids.
/// </summary>
public static class SelectedVehicleId
{
    /// <summary>True when <paramref name="id"/> is a usable selection (web <c>n &gt; 0</c>).</summary>
    public static bool IsValid(long id) => id > 0;

    /// <summary>
    /// Parse a persisted raw value into a valid selected-vehicle id, or <c>null</c> when absent or invalid
    /// (web <c>loadInitial</c>: blank / garbage / non-positive becomes <c>null</c>). Leading and trailing
    /// whitespace and a leading sign are tolerated to mirror the web <c>Number()</c> coercion.
    /// </summary>
    public static long? Parse(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && IsValid(id)
            ? id
            : null;
    }

    /// <summary>
    /// Serialize <paramref name="id"/> for persistence — <c>null</c> clears the slot (web
    /// <c>removeItem</c>), otherwise the invariant decimal string (web <c>String(id)</c>).
    /// </summary>
    public static string? Format(long? id) =>
        id is { } value ? value.ToString(CultureInfo.InvariantCulture) : null;
}

/// <summary>
/// The payload for <see cref="SelectedVehicleStore.Changed"/> — the new effective selection after a commit
/// or a cross-instance update. <see cref="VehicleId"/> is <c>null</c> when no vehicle is in scope (web
/// <c>vehicleId === null</c>).
/// </summary>
public sealed class SelectedVehicleChangedEventArgs(long? vehicleId) : EventArgs
{
    /// <summary>The new selected-vehicle id, or <c>null</c> for "no selection".</summary>
    public long? VehicleId { get; } = vehicleId;
}

/// <summary>
/// PII-safe diagnostics for the selected-vehicle store (P1/S11 diagnostics contract). The selected id
/// identifies a specific vehicle, so the collector records only the operational <c>view.opened</c> event
/// with the surface slug — never the id itself. Thread-safe.
/// </summary>
public sealed class SelectedVehicleDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SelectedVehicleDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the provider surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=selectedVehicle</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SelectedVehicleRegistration.Slug}");
    }
}
