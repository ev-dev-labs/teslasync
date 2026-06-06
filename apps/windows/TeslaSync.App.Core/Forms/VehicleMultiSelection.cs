using System.ComponentModel;

namespace TeslaSync.App.Core.Forms;

/// <summary>Which arm of the multi-select union is active.</summary>
public enum VehicleSelectionKind
{
    /// <summary>Applies to the whole fleet, current and future.</summary>
    AllSticky,

    /// <summary>Applies to an explicit subset of vehicle ids.</summary>
    Specific,
}

/// <summary>
/// Immutable discriminated-union value for the multi-vehicle picker
/// (<c>TsVehicleMultiSelect</c>). Mirrors the web editor invariant where the
/// "All vehicles (current + future)" sentinel is mutually exclusive with a
/// per-vehicle subset.
/// </summary>
public sealed class VehicleMultiSelection
{
    private VehicleMultiSelection(VehicleSelectionKind kind, IReadOnlyList<long> ids)
    {
        Kind = kind;
        VehicleIds = ids;
    }

    /// <summary>Active arm of the union.</summary>
    public VehicleSelectionKind Kind { get; }

    /// <summary>Selected ids when <see cref="Kind"/> is <see cref="VehicleSelectionKind.Specific"/>.</summary>
    public IReadOnlyList<long> VehicleIds { get; }

    /// <summary>The fleet-wide sentinel.</summary>
    public static VehicleMultiSelection AllSticky { get; } =
        new(VehicleSelectionKind.AllSticky, []);

    /// <summary>An explicit, deduped + sorted subset.</summary>
    public static VehicleMultiSelection Specific(IEnumerable<long> ids) =>
        new(VehicleSelectionKind.Specific, VehicleSelectionOps.DedupSort(ids));

    /// <summary>True when the value is the fleet-wide sentinel.</summary>
    public bool IsAll => Kind == VehicleSelectionKind.AllSticky;
}

/// <summary>How a trigger summary should be phrased (localization stays in the view).</summary>
public enum SelectionSummaryKind
{
    /// <summary>All vehicles selected.</summary>
    All,

    /// <summary>Nothing selected.</summary>
    None,

    /// <summary>Exactly one named vehicle.</summary>
    One,

    /// <summary>A subset smaller than the whole fleet.</summary>
    Partial,

    /// <summary>A plain count (subset equal to fleet size).</summary>
    Count,
}

/// <summary>Structured trigger summary; the view picks the localized string.</summary>
public readonly record struct SelectionSummary(
    SelectionSummaryKind Kind,
    string? Name,
    int Count,
    int Total);

/// <summary>Pure operations over <see cref="VehicleMultiSelection"/>.</summary>
public static class VehicleSelectionOps
{
    /// <summary>Drop ids ≤ 0, remove duplicates and sort ascending.</summary>
    public static IReadOnlyList<long> DedupSort(IEnumerable<long> ids)
    {
        ArgumentNullException.ThrowIfNull(ids);
        var seen = new HashSet<long>();
        var outList = new List<long>();
        foreach (var id in ids)
        {
            if (id > 0 && seen.Add(id))
            {
                outList.Add(id);
            }
        }

        outList.Sort();
        return outList;
    }

    /// <summary>Toggle a single vehicle, always producing a Specific selection.</summary>
    public static VehicleMultiSelection ToggleVehicle(VehicleMultiSelection current, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(current);
        var selected = current.Kind == VehicleSelectionKind.Specific
            ? current.VehicleIds
            : [];

        if (selected.Contains(vehicleId))
        {
            return VehicleMultiSelection.Specific(selected.Where(id => id != vehicleId));
        }

        return VehicleMultiSelection.Specific(selected.Append(vehicleId));
    }

    /// <summary>Ids selected on a stored rule that are not in the known fleet.</summary>
    public static IReadOnlyList<long> UnknownIds(
        VehicleMultiSelection current,
        IEnumerable<long> knownIds)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(knownIds);
        if (current.Kind != VehicleSelectionKind.Specific)
        {
            return [];
        }

        var known = new HashSet<long>(knownIds);
        return current.VehicleIds.Where(id => !known.Contains(id)).ToList();
    }

    /// <summary>
    /// Convert a server-stored rule into a selection. Honours the new
    /// <paramref name="allVehicles"/> flag when present and falls back to the
    /// legacy single <paramref name="legacyVehicleId"/> for transitional compat.
    /// </summary>
    public static VehicleMultiSelection Hydrate(
        bool? allVehicles,
        IReadOnlyList<long>? vehicleIds,
        long? legacyVehicleId)
    {
        if (allVehicles is { } all)
        {
            return all
                ? VehicleMultiSelection.AllSticky
                : VehicleMultiSelection.Specific(vehicleIds ?? []);
        }

        return legacyVehicleId is { } id
            ? VehicleMultiSelection.Specific([id])
            : VehicleMultiSelection.AllSticky;
    }

    /// <summary>
    /// Build the wire sub-payload. Always emits both <c>all_vehicles</c> and a
    /// deduped/sorted <c>vehicle_ids</c>; never the legacy single id.
    /// </summary>
    public static (bool AllVehicles, IReadOnlyList<long> VehicleIds) BuildPayload(
        VehicleMultiSelection selection)
    {
        ArgumentNullException.ThrowIfNull(selection);
        return selection.Kind == VehicleSelectionKind.AllSticky
            ? (true, [])
            : (false, DedupSort(selection.VehicleIds));
    }

    /// <summary>Compute a structured trigger summary for a selection over a fleet.</summary>
    public static SelectionSummary Summarize(
        VehicleMultiSelection selection,
        IReadOnlyList<VehicleOption> fleet)
    {
        ArgumentNullException.ThrowIfNull(selection);
        ArgumentNullException.ThrowIfNull(fleet);
        if (selection.Kind == VehicleSelectionKind.AllSticky)
        {
            return new SelectionSummary(SelectionSummaryKind.All, null, fleet.Count, fleet.Count);
        }

        var ids = selection.VehicleIds;
        var total = fleet.Count;
        var count = ids.Count;
        if (count == 0)
        {
            return new SelectionSummary(SelectionSummaryKind.None, null, 0, total);
        }

        if (count == 1)
        {
            var match = fleet.FirstOrDefault(v => v.Id == ids[0]);
            var name = match is not null ? VehicleLabels.Short(match) : $"Vehicle #{ids[0]}";
            return new SelectionSummary(SelectionSummaryKind.One, name, 1, total);
        }

        if (total > 0 && count < total)
        {
            return new SelectionSummary(SelectionSummaryKind.Partial, null, count, total);
        }

        return new SelectionSummary(SelectionSummaryKind.Count, null, count, total);
    }
}

/// <summary>
/// Stateful controller backing the multi-select control. Remembers the previous
/// specific selection so toggling the "All" sentinel off restores the prior
/// subset, exactly like the web editor's ref.
/// </summary>
public sealed class VehicleMultiSelectController : INotifyPropertyChanged
{
    private VehicleMultiSelection _value;
    private IReadOnlyList<long> _previousSpecific;

    public VehicleMultiSelectController(VehicleMultiSelection? initial = null)
    {
        _value = initial ?? VehicleMultiSelection.AllSticky;
        _previousSpecific = _value.Kind == VehicleSelectionKind.Specific ? _value.VehicleIds : [];
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Current selection.</summary>
    public VehicleMultiSelection Value
    {
        get => _value;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (value.Kind == VehicleSelectionKind.Specific)
            {
                _previousSpecific = value.VehicleIds;
            }

            _value = value;
            Raise(nameof(Value));
        }
    }

    /// <summary>Toggle a single vehicle.</summary>
    public void ToggleVehicle(long vehicleId) =>
        Value = VehicleSelectionOps.ToggleVehicle(_value, vehicleId);

    /// <summary>
    /// Toggle the "All vehicles" sentinel. Turning it off restores the previous
    /// specific selection (empty when none).
    /// </summary>
    public void ToggleAll() =>
        Value = _value.Kind == VehicleSelectionKind.AllSticky
            ? VehicleMultiSelection.Specific(_previousSpecific)
            : VehicleMultiSelection.AllSticky;

    /// <summary>Structured trigger summary over the supplied fleet.</summary>
    public SelectionSummary Summarize(IReadOnlyList<VehicleOption> fleet) =>
        VehicleSelectionOps.Summarize(_value, fleet);

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
