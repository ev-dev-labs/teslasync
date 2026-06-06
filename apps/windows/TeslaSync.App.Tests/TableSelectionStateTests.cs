using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class TableSelectionStateTests
{
    private static readonly string[] Universe = ["a", "b", "c"];

    [Fact]
    public void Toggle_AddsThenRemoves()
    {
        var sel = new TableSelectionState<string>();
        sel.Toggle("a");
        Assert.True(sel.IsSelected("a"));
        Assert.Equal(1, sel.Count);

        sel.Toggle("a");
        Assert.False(sel.IsSelected("a"));
        Assert.Equal(0, sel.Count);
    }

    [Fact]
    public void Indeterminate_WhenPartialSelection()
    {
        var sel = new TableSelectionState<string>();
        sel.Set("a", true);
        Assert.True(sel.IsIndeterminate(Universe));
        Assert.False(sel.AllSelected(Universe));
    }

    [Fact]
    public void AllSelected_WhenEveryKeyChosen()
    {
        var sel = new TableSelectionState<string>();
        sel.SelectAll(Universe);
        Assert.True(sel.AllSelected(Universe));
        Assert.False(sel.IsIndeterminate(Universe));
    }

    [Fact]
    public void ToggleAll_SelectsThenClears()
    {
        var sel = new TableSelectionState<string>();
        sel.ToggleAll(Universe);
        Assert.True(sel.AllSelected(Universe));

        sel.ToggleAll(Universe);
        Assert.Equal(0, sel.Count);
    }

    [Fact]
    public void EmptyUniverse_IsNeitherAllNorIndeterminate()
    {
        var sel = new TableSelectionState<string>();
        Assert.False(sel.AllSelected([]));
        Assert.False(sel.IsIndeterminate([]));
    }
}
