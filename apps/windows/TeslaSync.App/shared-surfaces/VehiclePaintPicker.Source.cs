using System.Collections.Generic;
using TeslaSync.App.Core.Vehicles;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The payload for <see cref="IVehiclePaintStore.ExternalChanged"/> — a write to a vehicle's persisted paint
/// slot, the native analogue of the web cross-tab <c>vehicle.paint.changed</c> broadcast and the in-tab notify
/// channel (web/src/hooks/useVehiclePaint.ts L46-L65, L134-L155). <see cref="VehicleId"/> identifies which
/// vehicle's slot moved (the view-model ignores writes for other vehicles, web
/// <c>if (msg.vehicleId !== vehicleId) return</c>) and <see cref="NewValue"/> is the new override, or
/// <see langword="null"/> when the override was cleared (revert to the inferred paint).
/// </summary>
public sealed class VehiclePaintChangedEventArgs : EventArgs
{
    /// <summary>Creates the payload.</summary>
    /// <param name="vehicleId">The vehicle whose paint slot changed.</param>
    /// <param name="newValue">The new override, or <see langword="null"/> when cleared.</param>
    public VehiclePaintChangedEventArgs(long vehicleId, PaintPaletteId? newValue)
    {
        VehicleId = vehicleId;
        NewValue = newValue;
    }

    /// <summary>The vehicle whose paint slot changed (web <c>msg.vehicleId</c>).</summary>
    public long VehicleId { get; }

    /// <summary>The new override, or <see langword="null"/> when cleared (web <c>msg.paintId</c>).</summary>
    public PaintPaletteId? NewValue { get; }
}

/// <summary>
/// The per-vehicle paint-override persistence seam the <see cref="VehiclePaintPickerViewModel"/> binds through
/// (P1/S8) — the native analogue of the web <c>useVehiclePaint</c> storage layer (web/src/hooks/
/// useVehiclePaint.ts: <c>readOverride</c> / <c>writeOverride</c> over <c>localStorage</c> plus the cross-tab
/// broadcast + in-tab notify channel). The override is browser-/device-local: it is not synced to the server,
/// and the Tesla-reported exterior color stays the source of truth for any new device. The view never touches
/// storage itself — it binds to this seam. The canonical Windows implementation
/// (<see cref="DelegatedVehiclePaintStore"/>) is backed by <c>ApplicationData.LocalSettings</c>; tests and
/// headless callers use <see cref="InMemoryVehiclePaintStore"/>.
/// </summary>
public interface IVehiclePaintStore
{
    /// <summary>
    /// Raised when a vehicle's override is written — so every other bound surface (e.g. the picker and the
    /// digital-twin sharing the store) re-reads without a reload. The native analogue of the web in-tab notify
    /// + cross-tab <c>vehicle.paint.changed</c> broadcast; may be raised from a background thread.
    /// </summary>
    event EventHandler<VehiclePaintChangedEventArgs>? ExternalChanged;

    /// <summary>
    /// Read &amp; validate the persisted override for <paramref name="vehicleId"/>, or <see langword="null"/>
    /// when absent / invalid / for a non-positive id (web <c>readOverride</c>).
    /// </summary>
    /// <param name="vehicleId">The vehicle id.</param>
    PaintPaletteId? Load(long vehicleId);

    /// <summary>
    /// Persist <paramref name="id"/> for <paramref name="vehicleId"/> — <see langword="null"/> clears the slot
    /// (web <c>writeOverride</c>: <c>removeItem</c>) — then raise <see cref="ExternalChanged"/> so bound surfaces
    /// re-read (web notify + broadcast). A non-positive id is a no-op (web persistence is disabled for "no
    /// vehicle yet").
    /// </summary>
    /// <param name="vehicleId">The vehicle id.</param>
    /// <param name="id">The override to persist, or <see langword="null"/> to clear it.</param>
    void Persist(long vehicleId, PaintPaletteId? id);
}

/// <summary>
/// An in-memory <see cref="IVehiclePaintStore"/> used by unit tests (and as the headless fallback). It stores
/// the raw kebab token the way <c>localStorage</c> does — so <see cref="Load"/> re-parses it through
/// <see cref="VehiclePaintPickerRegistration.TryParseToken"/> and <see cref="Persist"/> serializes through
/// <see cref="VehiclePaintPickerRegistration.Token"/>, matching the web store's string-typed slot — and
/// <see cref="RaiseExternalChange"/> simulates a cross-instance write (the web
/// <c>broadcast({ type: 'vehicle.paint.changed' })</c> / <c>storage</c> event). Not thread-safe; drive it from
/// one confinement.
/// </summary>
public sealed class InMemoryVehiclePaintStore : IVehiclePaintStore
{
    private readonly Dictionary<long, string> _slots = new();

    /// <inheritdoc />
    public event EventHandler<VehiclePaintChangedEventArgs>? ExternalChanged;

    /// <summary>The number of times <see cref="Persist"/> wrote a slot (for write-forwarding assertions).</summary>
    public int WriteCount { get; private set; }

    /// <summary>The raw persisted token for <paramref name="vehicleId"/>, for test assertions (web <c>getItem</c>).</summary>
    /// <param name="vehicleId">The vehicle id.</param>
    public string? RawFor(long vehicleId) => _slots.TryGetValue(vehicleId, out string? raw) ? raw : null;

    /// <inheritdoc />
    public PaintPaletteId? Load(long vehicleId)
    {
        if (vehicleId <= 0 || !_slots.TryGetValue(vehicleId, out string? raw))
        {
            return null;
        }

        return VehiclePaintPickerRegistration.TryParseToken(raw, out PaintPaletteId id) ? id : null;
    }

    /// <inheritdoc />
    public void Persist(long vehicleId, PaintPaletteId? id)
    {
        if (vehicleId <= 0)
        {
            return;
        }

        if (id is { } value)
        {
            _slots[vehicleId] = VehiclePaintPickerRegistration.Token(value);
        }
        else
        {
            _slots.Remove(vehicleId);
        }

        WriteCount++;
        ExternalChanged?.Invoke(this, new VehiclePaintChangedEventArgs(vehicleId, id));
    }

    /// <summary>
    /// Simulate a cross-instance write of <paramref name="rawNewValue"/> for <paramref name="vehicleId"/>:
    /// update the slot (another instance already wrote it) then raise <see cref="ExternalChanged"/> with the
    /// re-validated value, mirroring the web cross-tab broadcast / <c>storage</c> event the view-model
    /// re-validates.
    /// </summary>
    /// <param name="vehicleId">The vehicle whose slot another instance wrote.</param>
    /// <param name="rawNewValue">The raw token written, or <see langword="null"/> when the slot was cleared.</param>
    public void RaiseExternalChange(long vehicleId, string? rawNewValue)
    {
        if (rawNewValue is null)
        {
            _slots.Remove(vehicleId);
        }
        else
        {
            _slots[vehicleId] = rawNewValue;
        }

        PaintPaletteId? parsed =
            VehiclePaintPickerRegistration.TryParseToken(rawNewValue, out PaintPaletteId id) ? id : null;
        ExternalChanged?.Invoke(this, new VehiclePaintChangedEventArgs(vehicleId, parsed));
    }
}

/// <summary>
/// The production <see cref="IVehiclePaintStore"/> — adapts a host-supplied raw key/value get/set into the paint
/// store, the native analogue of the web <c>safeLocalStorage</c> access the hook reads and writes the
/// per-vehicle slot through (web/src/hooks/useVehiclePaint.ts L74-L97). The composition root supplies the
/// reader/writer bound to the packaged app's <c>ApplicationData.LocalSettings</c> (the WinUI persistence
/// primitive), keyed by <see cref="VehiclePaintPickerRegistration.StorageKey"/>. Reads classify the raw token via
/// <see cref="VehiclePaintPickerRegistration.TryParseToken"/>; writes persist the
/// <see cref="VehiclePaintPickerRegistration.Token"/> (null clears it). Both are best-effort: a reader/writer
/// throwing (identity-less / quota failures) is swallowed and a failed read collapses to <see langword="null"/>,
/// exactly as the web helper never throws — a deployment that cannot persist simply re-derives the inferred
/// paint. Holds only delegates (no WinUI types) so it is unit-tested against in-memory closures.
/// </summary>
public sealed class DelegatedVehiclePaintStore : IVehiclePaintStore
{
    private readonly Func<string, string?> _read;
    private readonly Action<string, string?> _write;

    /// <summary>Creates the store over a raw key→value reader and writer (the host's local-settings bridge).</summary>
    /// <param name="read">Returns the raw stored token for a key, or null when absent/unreadable (web <c>getItem</c>).</param>
    /// <param name="write">Persists the raw token for a key; a null token clears it (web <c>setItem</c> / <c>removeItem</c>).</param>
    public DelegatedVehiclePaintStore(Func<string, string?> read, Action<string, string?> write)
    {
        ArgumentNullException.ThrowIfNull(read);
        ArgumentNullException.ThrowIfNull(write);
        _read = read;
        _write = write;
    }

    /// <inheritdoc />
    public event EventHandler<VehiclePaintChangedEventArgs>? ExternalChanged;

    /// <inheritdoc />
    public PaintPaletteId? Load(long vehicleId)
    {
        if (vehicleId <= 0)
        {
            return null;
        }

        string? raw;
        try
        {
            raw = _read(VehiclePaintPickerRegistration.StorageKey(vehicleId));
        }
        catch (Exception)
        {
            // Storage read failures never throw — fall back to "no override" (web safeLocalStorage).
            return null;
        }

        return VehiclePaintPickerRegistration.TryParseToken(raw, out PaintPaletteId id) ? id : null;
    }

    /// <inheritdoc />
    public void Persist(long vehicleId, PaintPaletteId? id)
    {
        if (vehicleId <= 0)
        {
            return;
        }

        try
        {
            _write(
                VehiclePaintPickerRegistration.StorageKey(vehicleId),
                id is { } value ? VehiclePaintPickerRegistration.Token(value) : null);
        }
        catch (Exception)
        {
            // Quota / identity-less write failures are silent by design (web safeLocalStorage); the in-process
            // change is still dispatched so bound surfaces re-read.
        }

        ExternalChanged?.Invoke(this, new VehiclePaintChangedEventArgs(vehicleId, id));
    }
}
