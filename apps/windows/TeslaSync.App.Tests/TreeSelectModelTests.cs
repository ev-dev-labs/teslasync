using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class TreeSelectModelTests
{
    private static IReadOnlyList<TreeGroup> Groups =>
    [
        new("battery", "Battery", [new TreeLeaf("soc", "State of Charge"), new TreeLeaf("range", "Range")]),
        new("drive", "Drive", [new TreeLeaf("speed", "Speed"), new TreeLeaf("power", "Power")]),
    ];

    [Fact]
    public void ExpandedByDefault()
    {
        var model = new TreeSelectModel(Groups);
        Assert.True(model.IsExpanded("battery"));
        model.ToggleExpanded("battery");
        Assert.False(model.IsExpanded("battery"));
    }

    [Fact]
    public void ToggleLeaf_TracksSelection()
    {
        var model = new TreeSelectModel(Groups);
        model.ToggleLeaf("soc");
        Assert.True(model.IsSelected("soc"));
        Assert.True(model.IsGroupPartiallySelected("battery"));
        Assert.False(model.IsGroupFullySelected("battery"));
    }

    [Fact]
    public void ToggleGroup_SelectsAllThenClears()
    {
        var model = new TreeSelectModel(Groups);
        model.ToggleGroup("battery");
        Assert.True(model.IsGroupFullySelected("battery"));
        Assert.False(model.IsGroupPartiallySelected("battery"));
        Assert.Equal(2, model.SelectedCount);

        model.ToggleGroup("battery");
        Assert.Equal(0, model.SelectedCount);
    }

    [Fact]
    public void SelectedValues_InTreeOrder()
    {
        var model = new TreeSelectModel(Groups);
        model.ToggleLeaf("power");
        model.ToggleLeaf("soc");
        Assert.Equal(["soc", "power"], model.SelectedValues);
    }

    [Fact]
    public void Clear_RemovesAll()
    {
        var model = new TreeSelectModel(Groups);
        model.ToggleGroup("drive");
        model.Clear();
        Assert.Equal(0, model.SelectedCount);
    }
}
