using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class TableSortStateTests
{
    [Fact]
    public void Toggle_CyclesThreeStates()
    {
        var sort = new TableSortState();

        sort.Toggle("name");
        Assert.Equal("name", sort.Column);
        Assert.Equal(SortDirection.Ascending, sort.Direction);

        sort.Toggle("name");
        Assert.Equal(SortDirection.Descending, sort.Direction);

        sort.Toggle("name");
        Assert.Equal(SortDirection.None, sort.Direction);
        Assert.Null(sort.Column);
    }

    [Fact]
    public void SelectingNewColumn_StartsAscending()
    {
        var sort = new TableSortState();
        sort.Toggle("name");
        sort.Toggle("date");
        Assert.Equal("date", sort.Column);
        Assert.Equal(SortDirection.Ascending, sort.Direction);
        Assert.Equal(SortDirection.None, sort.DirectionFor("name"));
    }

    [Fact]
    public void Apply_SortsAscendingAndDescending()
    {
        var data = new[] { 3, 1, 2 };
        var sort = new TableSortState();
        sort.Toggle("v");
        Assert.Equal([1, 2, 3], sort.Apply(data, x => x));

        sort.Toggle("v");
        Assert.Equal([3, 2, 1], sort.Apply(data, x => x));
    }

    [Fact]
    public void Apply_UnsortedPreservesOrder()
    {
        var data = new[] { 3, 1, 2 };
        var sort = new TableSortState();
        Assert.Equal([3, 1, 2], sort.Apply(data, x => x));
    }

    [Fact]
    public void Apply_HandlesNullKeys()
    {
        var data = new[] { "b", null, "a" };
        var sort = new TableSortState();
        sort.Toggle("v");
        var result = sort.Apply(data, x => x);
        Assert.Null(result[0]);
        Assert.Equal("a", result[1]);
        Assert.Equal("b", result[2]);
    }
}
