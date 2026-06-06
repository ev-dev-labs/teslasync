using System.Globalization;
using TeslaSync.App.Core.Forms;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class CurrencyMicroTests
{
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");
    private static readonly CultureInfo DeDe = CultureInfo.GetCultureInfo("de-DE");

    [Fact]
    public void ToMicros_RoundsHalfAway()
    {
        Assert.Equal(1_500_000, CurrencyMicro.ToMicros(1.5m));
        Assert.Equal(1_234_560, CurrencyMicro.ToMicros(1.23456m));
    }

    [Fact]
    public void Format_UsesSymbolAndCulture()
    {
        Assert.Equal("$1.50", CurrencyMicro.Format(1_500_000, "USD", EnUs));
        Assert.Equal("\u20AC1.234,56", CurrencyMicro.Format(1_234_560_000, "EUR", DeDe, 2));
    }

    [Fact]
    public void Format_NullIsEmpty()
    {
        Assert.Equal(string.Empty, CurrencyMicro.Format(null, "USD", EnUs));
    }

    [Fact]
    public void Parse_PlainAndSymbol()
    {
        Assert.Equal(1_500_000, CurrencyMicro.Parse("$1.50", "USD", EnUs));
        Assert.Equal(1_500_000, CurrencyMicro.Parse("1.50", "USD", EnUs));
        Assert.Equal(1_500_000, CurrencyMicro.Parse("USD 1.50", "USD", EnUs));
    }

    [Fact]
    public void Parse_GroupSeparators()
    {
        Assert.Equal(1_234_560_000, CurrencyMicro.Parse("$1,234.56", "USD", EnUs));
        Assert.Equal(1_234_560_000, CurrencyMicro.Parse("1.234,56 \u20AC", "EUR", DeDe));
    }

    [Fact]
    public void Parse_AccountingParenthesesNegative()
    {
        Assert.Equal(-1_500_000, CurrencyMicro.Parse("($1.50)", "USD", EnUs));
    }

    [Fact]
    public void Parse_BlankIsNull()
    {
        Assert.Null(CurrencyMicro.Parse("   ", "USD", EnUs));
        Assert.Null(CurrencyMicro.Parse("$", "USD", EnUs));
    }

    [Fact]
    public void RoundTrip()
    {
        var micro = CurrencyMicro.Parse("$2,000.25", "USD", EnUs);
        Assert.Equal("$2,000.25", CurrencyMicro.Format(micro, "USD", EnUs));
    }
}
