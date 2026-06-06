using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class FieldValidationTests
{
    [Fact]
    public void Required_RejectsBlank()
    {
        Assert.False(Validators.Required("  ", "req").IsValid);
        Assert.True(Validators.Required("x", "req").IsValid);
    }

    [Fact]
    public void InRange_Bounds()
    {
        Assert.True(Validators.InRange(5, 0, 10, "range").IsValid);
        Assert.False(Validators.InRange(-1, 0, 10, "range").IsValid);
        Assert.False(Validators.InRange(11, 0, 10, "range").IsValid);
    }

    [Fact]
    public void Length_TrimsBeforeMeasuring()
    {
        Assert.False(Validators.Length("  ", 1, 5, "len").IsValid);
        Assert.True(Validators.Length(" ab ", 1, 5, "len").IsValid);
    }

    [Fact]
    public void All_ReturnsFirstFailure()
    {
        var result = Validators.All(
            Validators.Required("ok", "req"),
            Validators.InRange(99, 0, 10, "range"),
            Validators.Required("", "req2"));
        Assert.False(result.IsValid);
        Assert.Equal("range", result.Error);
    }

    [Fact]
    public void State_TracksError()
    {
        var state = new FieldValidationState();
        Assert.True(state.IsValid);

        state.Apply(Validators.Required(null, "Required"));
        Assert.True(state.HasError);
        Assert.Equal("Required", state.Error);

        state.Apply(Validators.Required("now set", "Required"));
        Assert.True(state.IsValid);
        Assert.Null(state.Error);
    }

    [Fact]
    public void State_SetErrorEmptyClears()
    {
        var state = new FieldValidationState();
        state.SetError("x");
        state.SetError("");
        Assert.True(state.IsValid);
    }
}
