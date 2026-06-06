using TeslaSync.App.Core.Feedback;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class AsyncStateTests
{
    [Fact]
    public void StartsIdle()
    {
        var state = new AsyncState<IReadOnlyList<int>>();
        Assert.Equal(LoadStatus.Idle, state.Status);
        Assert.False(state.IsLoading);
        Assert.False(state.HasError);
        Assert.Equal(0, state.Attempts);
    }

    [Fact]
    public void SetLoading_CountsAttempts()
    {
        var state = new AsyncState<int>();
        state.SetLoading();
        Assert.True(state.IsLoading);
        Assert.Equal(1, state.Attempts);
        state.SetError("boom");
        state.SetLoading();
        Assert.Equal(2, state.Attempts);
    }

    [Fact]
    public void SetLoaded_WithEmptyPredicate_GoesEmpty()
    {
        var state = new AsyncState<IReadOnlyList<int>>();
        state.SetLoaded([], list => list.Count == 0);
        Assert.Equal(LoadStatus.Empty, state.Status);
        Assert.True(state.IsEmpty);
        Assert.False(state.HasData);
    }

    [Fact]
    public void SetLoaded_WithData_GoesLoaded()
    {
        var state = new AsyncState<IReadOnlyList<int>>();
        state.SetLoaded([1, 2], list => list.Count == 0);
        Assert.Equal(LoadStatus.Loaded, state.Status);
        Assert.True(state.HasData);
        Assert.Equal([1, 2], state.Data!);
    }

    [Fact]
    public void SetError_CapturesMessage()
    {
        var state = new AsyncState<int>();
        state.SetLoading();
        state.SetError("network down");
        Assert.True(state.HasError);
        Assert.Equal("network down", state.ErrorMessage);
        Assert.True(state.CanRetry);
    }

    [Fact]
    public void Retry_FromError_GoesLoadingAndRaisesEvent()
    {
        var state = new AsyncState<int>();
        state.SetLoading();
        state.SetError("oops");
        var raised = 0;
        state.RetryRequested += (_, _) => raised++;

        state.Retry();

        Assert.True(state.IsLoading);
        Assert.Equal(2, state.Attempts);
        Assert.Equal(1, raised);
        Assert.Null(state.ErrorMessage);
    }

    [Fact]
    public void Retry_WhenNotError_Throws()
    {
        var state = new AsyncState<int>();
        Assert.Throws<InvalidOperationException>(state.Retry);
    }

    [Fact]
    public void Reset_ReturnsToIdle()
    {
        var state = new AsyncState<IReadOnlyList<int>>();
        state.SetLoading();
        state.SetLoaded([1], l => l.Count == 0);
        state.Reset();
        Assert.Equal(LoadStatus.Idle, state.Status);
        Assert.Null(state.Data);
        Assert.Equal(0, state.Attempts);
    }

    [Theory]
    [InlineData(CalloutVariant.Info, false)]
    [InlineData(CalloutVariant.Success, false)]
    [InlineData(CalloutVariant.Warning, false)]
    [InlineData(CalloutVariant.Danger, true)]
    public void CalloutVariants_AssertiveOnlyForDanger(CalloutVariant variant, bool assertive)
    {
        Assert.Equal(assertive, CalloutVariants.IsAssertive(variant));
        Assert.False(string.IsNullOrEmpty(CalloutVariants.AccentBrushKey(variant)));
        Assert.False(string.IsNullOrEmpty(CalloutVariants.Glyph(variant)));
    }
}
