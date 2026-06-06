using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies wire-token classification for <see cref="NotificationKind"/> (P2/W8-0001).</summary>
public sealed class NotificationKindTests
{
    [Theory]
    [InlineData("alert", NotificationKind.Alert)]
    [InlineData("ALERT", NotificationKind.Alert)]
    [InlineData("charge_complete", NotificationKind.ChargeComplete)]
    [InlineData("charging_complete", NotificationKind.ChargeComplete)]
    [InlineData("vehicle_state", NotificationKind.VehicleState)]
    [InlineData("automation_event", NotificationKind.Automation)]
    [InlineData("command_result", NotificationKind.CommandResult)]
    [InlineData("incident", NotificationKind.SystemIncident)]
    [InlineData("reauth", NotificationKind.ReauthNeeded)]
    public void Parse_maps_known_tokens(string token, NotificationKind expected) =>
        Assert.Equal(expected, NotificationKinds.Parse(token));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("totally-unknown")]
    public void Parse_falls_back_to_generic(string? token) =>
        Assert.Equal(NotificationKind.Generic, NotificationKinds.Parse(token));

    [Fact]
    public void Parse_trims_whitespace() =>
        Assert.Equal(NotificationKind.Alert, NotificationKinds.Parse("  alert  "));

    [Theory]
    [InlineData(NotificationKind.ChargeComplete, "charge_complete")]
    [InlineData(NotificationKind.ReauthNeeded, "reauth_needed")]
    [InlineData(NotificationKind.Generic, "generic")]
    public void ToWire_returns_canonical_token(NotificationKind kind, string expected) =>
        Assert.Equal(expected, NotificationKinds.ToWire(kind));

    [Fact]
    public void ToWire_then_Parse_round_trips_every_kind()
    {
        foreach (var kind in Enum.GetValues<NotificationKind>())
        {
            Assert.Equal(kind, NotificationKinds.Parse(NotificationKinds.ToWire(kind)));
        }
    }
}
