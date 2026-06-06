using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class ComboboxModelTests
{
    private static IReadOnlyList<ComboOption> Options =>
    [
        new("3", "Model 3"),
        new("y", "Model Y"),
        new("s", "Model S", Disabled: true),
        new("x", "Model X"),
    ];

    [Fact]
    public void Filter_BlankReturnsAll()
    {
        Assert.Equal(4, ComboboxFilter.Filter(Options, "  ").Count);
    }

    [Fact]
    public void Filter_CaseInsensitiveSubstring()
    {
        var result = ComboboxFilter.Filter(Options, "model ");
        Assert.Equal(4, result.Count);
        var y = ComboboxFilter.Filter(Options, "y");
        Assert.Single(y);
        Assert.Equal("y", y[0].Value);
    }

    [Fact]
    public void State_QueryUpdatesHighlight()
    {
        var state = new ComboboxState(Options);
        state.Query = "Model X";
        Assert.Single(state.Filtered);
        Assert.Equal(0, state.HighlightIndex);
        Assert.Equal("x", state.HighlightedOption!.Value);
    }

    [Fact]
    public void State_MoveHighlightClamps()
    {
        var state = new ComboboxState(Options);
        state.MoveHighlight(-5);
        Assert.Equal(0, state.HighlightIndex);
        state.MoveHighlight(100);
        Assert.Equal(Options.Count - 1, state.HighlightIndex);
    }

    [Fact]
    public void State_CommitHighlightSkipsDisabled()
    {
        var state = new ComboboxState(Options);
        state.MoveHighlight(2); // index 2 = disabled "Model S"
        Assert.Null(state.CommitHighlight());
        Assert.Null(state.SelectedValue);
    }

    [Fact]
    public void State_SelectRejectsUnknownAndDisabled()
    {
        var state = new ComboboxState(Options);
        Assert.False(state.Select("missing"));
        Assert.False(state.Select("s"));
        Assert.True(state.Select("3"));
        Assert.Equal("3", state.SelectedValue);
    }

    [Fact]
    public void MultiState_TogglesAndOrders()
    {
        var state = new ComboboxMultiState(Options);
        state.Toggle("x");
        state.Toggle("3");
        Assert.Equal(["3", "x"], state.SelectedValues); // stable option order
        Assert.Equal(2, state.SelectedCount);
        state.Toggle("x");
        Assert.Equal(["3"], state.SelectedValues);
    }

    [Fact]
    public void MultiState_IgnoresDisabled()
    {
        var state = new ComboboxMultiState(Options);
        state.Toggle("s");
        Assert.Equal(0, state.SelectedCount);
    }
}
