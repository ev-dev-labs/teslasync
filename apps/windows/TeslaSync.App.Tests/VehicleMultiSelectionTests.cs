using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class VehicleMultiSelectionTests
{
    private static readonly IReadOnlyList<VehicleOption> Fleet =
    [
        new(1, "Red Three"),
        new(2, "Blue Y"),
        new(3, "White S"),
    ];

    [Fact]
    public void DedupSort_DropsNonPositiveAndDuplicates()
    {
        Assert.Equal([1, 2, 5], VehicleSelectionOps.DedupSort([5, 2, 2, 0, -3, 1, 5]));
    }

    [Fact]
    public void ToggleVehicle_AddsAndRemoves()
    {
        var sel = VehicleMultiSelection.Specific([1]);
        sel = VehicleSelectionOps.ToggleVehicle(sel, 3);
        Assert.Equal([1, 3], sel.VehicleIds);
        sel = VehicleSelectionOps.ToggleVehicle(sel, 1);
        Assert.Equal([3], sel.VehicleIds);
    }

    [Fact]
    public void ToggleVehicle_FromAll_BecomesSpecific()
    {
        var sel = VehicleSelectionOps.ToggleVehicle(VehicleMultiSelection.AllSticky, 2);
        Assert.Equal(VehicleSelectionKind.Specific, sel.Kind);
        Assert.Equal([2], sel.VehicleIds);
    }

    [Fact]
    public void UnknownIds_PreservesStoredButMissing()
    {
        var sel = VehicleMultiSelection.Specific([1, 99]);
        var unknown = VehicleSelectionOps.UnknownIds(sel, Fleet.Select(v => v.Id));
        Assert.Equal([99], unknown);
    }

    [Fact]
    public void Hydrate_NewFlagAllVehicles()
    {
        var sel = VehicleSelectionOps.Hydrate(true, null, null);
        Assert.True(sel.IsAll);
    }

    [Fact]
    public void Hydrate_LegacySingleId()
    {
        var sel = VehicleSelectionOps.Hydrate(null, null, 7);
        Assert.Equal(VehicleSelectionKind.Specific, sel.Kind);
        Assert.Equal([7], sel.VehicleIds);
    }

    [Fact]
    public void Hydrate_LegacyNullMeansAll()
    {
        Assert.True(VehicleSelectionOps.Hydrate(null, null, null).IsAll);
    }

    [Fact]
    public void BuildPayload_AllSticky()
    {
        var (all, ids) = VehicleSelectionOps.BuildPayload(VehicleMultiSelection.AllSticky);
        Assert.True(all);
        Assert.Empty(ids);
    }

    [Fact]
    public void BuildPayload_SpecificDedupsSorts()
    {
        var (all, ids) = VehicleSelectionOps.BuildPayload(VehicleMultiSelection.Specific([3, 1, 3]));
        Assert.False(all);
        Assert.Equal([1, 3], ids);
    }

    [Fact]
    public void Controller_ToggleAllRestoresPreviousSpecific()
    {
        var controller = new VehicleMultiSelectController(VehicleMultiSelection.Specific([1, 2]));
        controller.ToggleAll(); // -> AllSticky
        Assert.True(controller.Value.IsAll);
        controller.ToggleAll(); // -> restore [1,2]
        Assert.Equal([1, 2], controller.Value.VehicleIds);
    }

    [Fact]
    public void Summarize_AllNoneOnePartialCount()
    {
        Assert.Equal(SelectionSummaryKind.All,
            VehicleSelectionOps.Summarize(VehicleMultiSelection.AllSticky, Fleet).Kind);

        Assert.Equal(SelectionSummaryKind.None,
            VehicleSelectionOps.Summarize(VehicleMultiSelection.Specific([]), Fleet).Kind);

        var one = VehicleSelectionOps.Summarize(VehicleMultiSelection.Specific([1]), Fleet);
        Assert.Equal(SelectionSummaryKind.One, one.Kind);
        Assert.Equal("Red Three", one.Name);

        var partial = VehicleSelectionOps.Summarize(VehicleMultiSelection.Specific([1, 2]), Fleet);
        Assert.Equal(SelectionSummaryKind.Partial, partial.Kind);
        Assert.Equal(2, partial.Count);
        Assert.Equal(3, partial.Total);

        var count = VehicleSelectionOps.Summarize(VehicleMultiSelection.Specific([1, 2, 3]), Fleet);
        Assert.Equal(SelectionSummaryKind.Count, count.Kind);
    }

    [Fact]
    public void Labels_DetailedFormatsVinAndModel()
    {
        var v = new VehicleOption(4, "Daily", "5YJSA1E26HF000123", "Model S");
        Assert.Equal("Daily — Model S (VIN ...0123)", VehicleLabels.Detailed(v));
    }
}
