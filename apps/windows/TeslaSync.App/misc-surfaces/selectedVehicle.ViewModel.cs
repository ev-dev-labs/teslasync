using System.ComponentModel;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// The selected-vehicle scope value consumers read &amp; write — the native analogue of the web
/// <c>SelectedVehicleStoreValue</c> (<c>{ vehicleId, setVehicleId }</c>) returned by
/// <c>useSelectedVehicleStore()</c>. It is <see cref="INotifyPropertyChanged"/> so WinUI bindings refresh
/// when the selection changes. The canonical implementation is <see cref="SelectedVehicleStore"/>; the inert
/// <see cref="NoOpSelectedVehicleScope"/> stands in when no provider is mounted (the web hook's graceful
/// out-of-provider fallback).
/// </summary>
public interface ISelectedVehicleScope : INotifyPropertyChanged
{
    /// <summary>The currently selected vehicle id, or <c>null</c> for "no selection" (web <c>vehicleId</c>).</summary>
    long? VehicleId { get; }

    /// <summary>Set (and persist) the selection; <c>null</c> clears it (web <c>setVehicleId</c>).</summary>
    void SetVehicleId(long? id);
}

/// <summary>
/// The persistent selected-vehicle store — the native port of the web <c>SelectedVehicleProvider</c> state
/// plus the <c>useSelectedVehicleStore()</c> reader/writer (web/src/store/selectedVehicle.tsx). It hydrates
/// from the bound <see cref="ISelectedVehicleStorage"/> on construction (web <c>useState(loadInitial)</c>),
/// persists every <see cref="SetVehicleId"/> (web <c>persist</c>), and re-validates cross-instance writes
/// from <see cref="ISelectedVehicleStorage.ExternalChanged"/> (the web cross-tab <c>'storage'</c> listener):
/// a cleared slot drops the selection, a valid positive id is adopted, and an invalid / non-positive
/// external value is ignored — exactly as the web <c>onStorage</c> handler behaves. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SelectedVehicleStore : ISelectedVehicleScope, IDisposable
{
    private readonly ISelectedVehicleStorage _storage;
    private long? _vehicleId;
    private bool _disposed;

    /// <summary>Creates the store over its persistence seam, hydrating the initial selection from it.</summary>
    public SelectedVehicleStore(ISelectedVehicleStorage storage)
    {
        ArgumentNullException.ThrowIfNull(storage);
        _storage = storage;
        _vehicleId = storage.Load();
        _storage.ExternalChanged += OnExternalChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised after the selection changes (a commit or a cross-instance update), for imperative consumers.</summary>
    public event EventHandler<SelectedVehicleChangedEventArgs>? Changed;

    /// <summary>A shared inert scope for callers with no provider (the web out-of-provider fallback).</summary>
    public static ISelectedVehicleScope NoOp => NoOpSelectedVehicleScope.Instance;

    /// <inheritdoc />
    public long? VehicleId => _vehicleId;

    /// <inheritdoc />
    public void SetVehicleId(long? id)
    {
        // web setVehicleId: update the state then persist — persistence runs even when the value is unchanged.
        UpdateSelection(id);
        _storage.Persist(id);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _storage.ExternalChanged -= OnExternalChanged;
        GC.SuppressFinalize(this);
    }

    private void OnExternalChanged(object? sender, SelectedVehicleExternalChangedEventArgs e)
    {
        // web onStorage: a cleared slot drops the selection; a valid positive id is adopted; anything else
        // (garbage, zero, negative) is ignored, leaving the current selection untouched.
        if (e.NewValue is null)
        {
            UpdateSelection(null);
            return;
        }

        if (SelectedVehicleId.Parse(e.NewValue) is { } parsed)
        {
            UpdateSelection(parsed);
        }
    }

    private void UpdateSelection(long? id)
    {
        if (_vehicleId == id)
        {
            return;
        }

        _vehicleId = id;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(VehicleId)));
        Changed?.Invoke(this, new SelectedVehicleChangedEventArgs(id));
    }
}

/// <summary>
/// The inert <see cref="ISelectedVehicleScope"/> returned when no provider is mounted — the native analogue
/// of <c>useSelectedVehicleStore()</c>'s out-of-provider fallback
/// (<c>{ vehicleId: null, setVehicleId: () =&gt; {} }</c>), so an isolated view that reads the scope degrades
/// gracefully instead of crashing. <see cref="VehicleId"/> is always <c>null</c> and
/// <see cref="SetVehicleId"/> is a no-op; it never persists and never raises a change.
/// </summary>
public sealed class NoOpSelectedVehicleScope : ISelectedVehicleScope
{
    /// <summary>The shared singleton instance.</summary>
    public static NoOpSelectedVehicleScope Instance { get; } = new();

    private NoOpSelectedVehicleScope()
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public long? VehicleId => null;

    /// <inheritdoc />
    public void SetVehicleId(long? id)
    {
        // No provider mounted — the web fallback's setVehicleId is a no-op.
    }
}
