using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class VehicleSelectStateTests
{
    private static readonly IReadOnlyList<VehicleOption> Fleet =
    [
        new(1, "Red Three", "5YJ3E1EA1JF000111", "Model 3"),
        new(2, "Blue Y", "7SAYGDEE9PF000222", "Model Y"),
    ];

    [Fact]
    public void LoadingState()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        Assert.True(state.IsLoading);
        Assert.False(state.HasVehicles);
    }

    [Fact]
    public void ErrorState_CanRetry()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetError("fleet load failed");
        Assert.True(state.HasError);
        Assert.Equal("fleet load failed", state.ErrorMessage);
        Assert.True(state.CanRetry);

        var retried = false;
        state.RetryRequested += (_, _) => retried = true;
        state.Retry();
        Assert.True(retried);
        Assert.True(state.IsLoading);
    }

    [Fact]
    public void EmptyState_WhenNoVehicles()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetLoaded([]);
        Assert.True(state.IsEmpty);
        Assert.False(state.HasVehicles);
    }

    [Fact]
    public void Loaded_AutoSelectsSingleVehicle()
    {
        var state = new VehicleSelectState();
        state.SetLoading();
        state.SetLoaded([Fleet[0]]);
        Assert.True(state.HasVehicles);
        Assert.Equal(1, state.SelectedId);
        Assert.Equal("Red Three", state.SelectedVehicle!.DisplayName);
    }

    [Fact]
    public void Selection_ClampedToKnownIds()
    {
        var state = new VehicleSelectState();
        state.SetLoaded(Fleet);
        state.SelectedId = 999;
        Assert.Null(state.SelectedId);
        state.SelectedId = 2;
        Assert.Equal(2, state.SelectedId);
    }

    [Fact]
    public void Reload_DropsNowInvalidSelection()
    {
        var state = new VehicleSelectState();
        state.SetLoaded(Fleet);
        state.SelectedId = 2;
        state.SetLoaded([Fleet[0]]);
        Assert.Equal(1, state.SelectedId); // auto-selected the only remaining vehicle
    }
}
