using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies the toast activation-argument codec round-trips and tolerates bad input (P2/W8-0001).</summary>
public sealed class ToastArgumentsTests
{
    [Fact]
    public void For_then_Decode_round_trips_all_fields()
    {
        var encoded = ToastArguments.For(ToastActions.Navigate, "charging/42", NotificationKind.ChargeComplete, "42");
        var decoded = ToastArguments.Decode(encoded);

        Assert.Equal(ToastActions.Navigate, decoded[ToastArguments.ActionKey]);
        Assert.Equal("charging/42", decoded[ToastArguments.RouteKey]);
        Assert.Equal("charge_complete", decoded[ToastArguments.KindKey]);
        Assert.Equal("42", decoded[ToastArguments.EntityKey]);
    }

    [Fact]
    public void For_omits_entity_id_when_absent()
    {
        var decoded = ToastArguments.Decode(ToastArguments.For(ToastActions.OpenInbox, "notifications/inbox", NotificationKind.Generic));
        Assert.False(decoded.ContainsKey(ToastArguments.EntityKey));
    }

    [Fact]
    public void For_is_stable_for_equal_input() =>
        Assert.Equal(
            ToastArguments.For(ToastActions.Navigate, "vehicles/7", NotificationKind.VehicleState, "7"),
            ToastArguments.For(ToastActions.Navigate, "vehicles/7", NotificationKind.VehicleState, "7"));

    [Fact]
    public void Encode_escapes_reserved_characters()
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [ToastArguments.RouteKey] = "search?q=a;b=c",
        };

        var decoded = ToastArguments.Decode(ToastArguments.Encode(values));
        Assert.Equal("search?q=a;b=c", decoded[ToastArguments.RouteKey]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("garbage-without-separators")]
    [InlineData("=novalue;justkey")]
    public void Decode_tolerates_bad_input(string? raw) =>
        Assert.NotNull(ToastArguments.Decode(raw));

    [Fact]
    public void Decode_then_Encode_round_trips()
    {
        const string Encoded = "action=navigate;route=charging%2F42;kind=charge_complete";
        var decoded = ToastArguments.Decode(Encoded);
        var reencoded = ToastArguments.Encode(decoded);
        Assert.Equal(decoded, ToastArguments.Decode(reencoded));
    }
}
