using System.ComponentModel;
using TeslaSync.App.Core.Feedback;

namespace TeslaSync.App.Core.Forms;

/// <summary>
/// UI-thread-free state for the single-vehicle scope picker
/// (<c>TsVehicleSelect</c>). Wraps an <see cref="AsyncState{T}"/> over the fleet
/// list so the control renders real loading / empty / error / loaded states from
/// the repository, and clamps the current selection to a known vehicle id.
/// </summary>
public sealed class VehicleSelectState : INotifyPropertyChanged
{
    private readonly AsyncState<IReadOnlyList<VehicleOption>> _source = new();
    private long? _selectedId;

    public VehicleSelectState()
    {
        _source.PropertyChanged += (_, e) =>
        {
            // Surface the underlying async transitions to bindings on this model.
            Raise(nameof(IsLoading));
            Raise(nameof(HasError));
            Raise(nameof(IsEmpty));
            Raise(nameof(HasVehicles));
            Raise(nameof(Vehicles));
            Raise(nameof(ErrorMessage));
            Raise(nameof(CanRetry));
        };
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a retry of the fleet load is requested.</summary>
    public event EventHandler? RetryRequested
    {
        add => _source.RetryRequested += value;
        remove => _source.RetryRequested -= value;
    }

    /// <summary>The loaded fleet (empty until loaded).</summary>
    public IReadOnlyList<VehicleOption> Vehicles => _source.Data ?? [];

    /// <summary>True while the fleet is loading.</summary>
    public bool IsLoading => _source.IsLoading;

    /// <summary>True when the fleet load failed.</summary>
    public bool HasError => _source.HasError;

    /// <summary>Localized fleet-load error message.</summary>
    public string? ErrorMessage => _source.ErrorMessage;

    /// <summary>True when the fleet loaded but is empty.</summary>
    public bool IsEmpty => _source.IsEmpty;

    /// <summary>True when at least one vehicle is available.</summary>
    public bool HasVehicles => Vehicles.Count > 0;

    /// <summary>Whether a retry is currently allowed.</summary>
    public bool CanRetry => _source.CanRetry;

    /// <summary>Currently selected vehicle id, or null.</summary>
    public long? SelectedId
    {
        get => _selectedId;
        set
        {
            var next = value is { } id && Vehicles.Any(v => v.Id == id) ? id : (long?)null;
            if (_selectedId == next)
            {
                return;
            }

            _selectedId = next;
            Raise(nameof(SelectedId));
            Raise(nameof(SelectedVehicle));
        }
    }

    /// <summary>The selected vehicle option, or null when none/unknown.</summary>
    public VehicleOption? SelectedVehicle =>
        _selectedId is { } id ? Vehicles.FirstOrDefault(v => v.Id == id) : null;

    /// <summary>Begin (or retry) loading the fleet.</summary>
    public void SetLoading() => _source.SetLoading();

    /// <summary>Record a loaded fleet; empty lists move to the empty state.</summary>
    public void SetLoaded(IReadOnlyList<VehicleOption> vehicles)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        _source.SetLoaded(vehicles, v => v.Count == 0);

        // Drop a now-invalid selection.
        if (_selectedId is { } id && vehicles.All(v => v.Id != id))
        {
            _selectedId = null;
            Raise(nameof(SelectedId));
            Raise(nameof(SelectedVehicle));
        }

        // Auto-select when exactly one vehicle and nothing is selected.
        if (_selectedId is null && vehicles.Count == 1)
        {
            _selectedId = vehicles[0].Id;
            Raise(nameof(SelectedId));
            Raise(nameof(SelectedVehicle));
        }
    }

    /// <summary>Record a fleet-load failure.</summary>
    public void SetError(string message) => _source.SetError(message);

    /// <summary>Request a retry of the fleet load.</summary>
    public void Retry() => _source.Retry();

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
