using TeslaSync.App.Core;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class PaginationStateTests
{
    [Fact]
    public void PageCount_IsAtLeastOne_WhenEmpty()
    {
        var state = new PaginationState { PageSize = 25, Total = 0 };
        Assert.Equal(1, state.PageCount);
        Assert.Equal(0, state.RangeStart);
        Assert.Equal(0, state.RangeEnd);
        Assert.False(state.CanGoNext);
        Assert.False(state.CanGoPrevious);
    }

    [Fact]
    public void PageCount_RoundsUp()
    {
        var state = new PaginationState { PageSize = 10, Total = 25 };
        Assert.Equal(3, state.PageCount);
    }

    [Fact]
    public void Navigation_ClampsToBounds()
    {
        var state = new PaginationState { PageSize = 10, Total = 25 };

        state.Last();
        Assert.Equal(3, state.Page);

        state.Next();
        Assert.Equal(3, state.Page);

        state.First();
        Assert.Equal(1, state.Page);

        state.Previous();
        Assert.Equal(1, state.Page);
    }

    [Fact]
    public void Range_ReflectsCurrentPage()
    {
        var state = new PaginationState { PageSize = 10, Total = 25, Page = 3 };
        Assert.Equal(21, state.RangeStart);
        Assert.Equal(25, state.RangeEnd);
        Assert.Equal(20, state.Offset);
    }

    [Fact]
    public void ChangingPageSize_ReclampsPage()
    {
        var state = new PaginationState { PageSize = 10, Total = 25, Page = 3 };
        state.PageSize = 25;
        Assert.Equal(1, state.PageCount);
        Assert.Equal(1, state.Page);
    }

    [Fact]
    public void Slice_ReturnsCurrentPageItems()
    {
        var source = Enumerable.Range(1, 25).ToList();
        var state = new PaginationState { PageSize = 10, Total = 25, Page = 3 };
        var slice = state.Slice(source);
        Assert.Equal([21, 22, 23, 24, 25], slice);
    }

    [Fact]
    public void PageSize_MinimumIsOne()
    {
        var state = new PaginationState { PageSize = 0 };
        Assert.Equal(1, state.PageSize);
    }
}
