using System.Globalization;
using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class UnitInputModelTests
{
    [Fact]
    public void Conversion_RoundTrips()
    {
        // metres -> miles
        var milesPerMetre = new UnitConversion(1 / 1609.344);
        Assert.Equal(1, milesPerMetre.ToDisplay(1609.344), 6);
        Assert.Equal(1609.344, milesPerMetre.ToSi(1), 3);
    }

    [Fact]
    public void Conversion_WithOffset_Celsius_To_Fahrenheit()
    {
        var cToF = new UnitConversion(9.0 / 5.0, 32);
        Assert.Equal(32, cToF.ToDisplay(0), 6);
        Assert.Equal(100, cToF.ToSi(212), 6);
    }

    [Fact]
    public void Display_FormatsAtPrecision()
    {
        var model = new UnitInputModel(new UnitConversion(1 / 1609.344), precision: 1)
        {
            SiValue = 1609.344,
        };
        Assert.Equal((1.0).ToString("N1", CultureInfo.CurrentCulture), model.Display);
    }

    [Fact]
    public void TrySetFromDisplay_WritesSi()
    {
        var model = new UnitInputModel(new UnitConversion(1 / 1609.344), precision: 1);
        Assert.True(model.TrySetFromDisplay((2.0).ToString("N1", CultureInfo.CurrentCulture)));
        Assert.NotNull(model.SiValue);
        Assert.Equal(3218.688, model.SiValue!.Value, 2);
    }

    [Fact]
    public void TrySetFromDisplay_BlankClears()
    {
        var model = new UnitInputModel(UnitConversion.Identity) { SiValue = 10 };
        Assert.True(model.TrySetFromDisplay("   "));
        Assert.Null(model.SiValue);
    }

    [Fact]
    public void TrySetFromDisplay_RejectsGarbage()
    {
        var model = new UnitInputModel(UnitConversion.Identity);
        Assert.False(model.TrySetFromDisplay("abc"));
    }
}
