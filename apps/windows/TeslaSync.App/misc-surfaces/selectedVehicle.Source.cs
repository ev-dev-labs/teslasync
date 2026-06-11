namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// The payload for <see cref="ISelectedVehicleStorage.ExternalChanged"/> — a cross-instance write to the
/// persisted slot, the native analogue of the web <c>window 'storage'</c> event
/// (<c>StorageEvent.newValue</c>). <see cref="NewValue"/> is the raw string another instance wrote, or
/// <c>null</c> when the slot was cleared; the store re-validates it exactly as the web <c>onStorage</c>
/// handler re-parses <c>e.newValue</c>.
/// </summary>
public sealed class SelectedVehicleExternalChangedEventArgs(string? newValue) : EventArgs
{
    /// <summary>The raw persisted value after the external write, or <c>null</c> when the slot was cleared.</summary>
    public string? NewValue { get; } = newValue;
}

/// <summary>
/// The persistence seam the <see cref="SelectedVehicleStore"/> binds to (P1/S8) — the native analogue of
/// the web store's <c>localStorage</c> access (<c>loadInitial</c> / <c>persist</c>) plus the cross-tab
/// <c>'storage'</c> listener. The canonical Windows implementation
/// (<c>LocalSettingsSelectedVehicleStorage</c>) is backed by <c>ApplicationData.LocalSettings</c>; tests and
/// headless callers use <see cref="InMemorySelectedVehicleStorage"/>. The store never touches the platform
/// store directly.
/// </summary>
public interface ISelectedVehicleStorage
{
    /// <summary>Raised when another instance writes the slot (the web cross-tab <c>'storage'</c> event).</summary>
    event EventHandler<SelectedVehicleExternalChangedEventArgs>? ExternalChanged;

    /// <summary>Read &amp; validate the persisted id, or <c>null</c> when absent / invalid (web <c>loadInitial</c>).</summary>
    long? Load();

    /// <summary>Persist <paramref name="id"/>; <c>null</c> clears the slot (web <c>persist</c>).</summary>
    void Persist(long? id);
}

/// <summary>
/// An in-memory <see cref="ISelectedVehicleStorage"/> used by unit tests (and as the headless fallback). It
/// stores the raw string the way <c>localStorage</c> does — so <see cref="Load"/> re-parses it through
/// <see cref="SelectedVehicleId.Parse"/> and <see cref="Persist"/> serializes through
/// <see cref="SelectedVehicleId.Format"/>, matching the web store's string-typed slot — and
/// <see cref="RaiseExternalChange"/> simulates a cross-instance write (the web test's
/// <c>dispatchEvent(new StorageEvent(...))</c>). Not thread-safe; drive it from one confinement.
/// </summary>
public sealed class InMemorySelectedVehicleStorage : ISelectedVehicleStorage
{
    private string? _raw;

    /// <summary>Creates the store, optionally seeded with a raw persisted value (web pre-set localStorage).</summary>
    public InMemorySelectedVehicleStorage(string? initialRaw = null) => _raw = initialRaw;

    /// <inheritdoc />
    public event EventHandler<SelectedVehicleExternalChangedEventArgs>? ExternalChanged;

    /// <summary>The raw persisted value, for test assertions (web <c>localStorage.getItem(KEY)</c>).</summary>
    public string? Raw => _raw;

    /// <inheritdoc />
    public long? Load() => SelectedVehicleId.Parse(_raw);

    /// <inheritdoc />
    public void Persist(long? id) => _raw = SelectedVehicleId.Format(id);

    /// <summary>
    /// Simulate a cross-instance write of <paramref name="newValue"/>: update the slot (another instance
    /// already wrote it) then raise <see cref="ExternalChanged"/>, mirroring the web cross-tab
    /// <c>'storage'</c> event the store re-validates.
    /// </summary>
    public void RaiseExternalChange(string? newValue)
    {
        _raw = newValue;
        ExternalChanged?.Invoke(this, new SelectedVehicleExternalChangedEventArgs(newValue));
    }
}
