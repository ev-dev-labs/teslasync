using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class FilterChipsTests
{
    [Fact]
    public void Set_DeduplicatesByKey()
    {
        var model = new ActiveFilterModel();
        model.Set(
        [
            new FilterChip("vehicle", "Vehicle", "Model 3"),
            new FilterChip("vehicle", "Vehicle", "dup"),
            new FilterChip("state", "State", "Driving"),
        ]);
        Assert.Equal(2, model.Chips.Count);
        Assert.True(model.HasChips);
    }

    [Fact]
    public void Remove_RaisesEventAndDropsChip()
    {
        var model = new ActiveFilterModel();
        model.Set([new FilterChip("vehicle", "Vehicle", "Model 3")]);
        string? removed = null;
        model.FilterRemoved += (_, key) => removed = key;

        Assert.True(model.Remove("vehicle"));
        Assert.Equal("vehicle", removed);
        Assert.True(model.IsEmpty);
        Assert.False(model.Remove("vehicle"));
    }

    [Fact]
    public void ClearAll_RaisesClearedOnlyWhenNonEmpty()
    {
        var model = new ActiveFilterModel();
        var cleared = 0;
        model.Cleared += (_, _) => cleared++;

        model.ClearAll();
        Assert.Equal(0, cleared);

        model.Set([new FilterChip("a", "A", "1"), new FilterChip("b", "B", "2")]);
        model.ClearAll();
        Assert.Equal(1, cleared);
        Assert.True(model.IsEmpty);
    }
}
