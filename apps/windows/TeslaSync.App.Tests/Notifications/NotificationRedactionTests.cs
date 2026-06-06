using TeslaSync.App.Core.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.Notifications;

/// <summary>Verifies PII masking in notification bodies (P2/W8-0001, ADR-016).</summary>
public sealed class NotificationRedactionTests
{
    [Fact]
    public void Redact_masks_vin()
    {
        const string Vin = "5YJ3E1EA7KF000000";
        var result = NotificationRedaction.Redact($"Vehicle {Vin} is ready");
        Assert.DoesNotContain(Vin, result, StringComparison.Ordinal);
        Assert.Contains(NotificationRedaction.Mask, result, StringComparison.Ordinal);
    }

    [Fact]
    public void Redact_masks_coordinates()
    {
        var result = NotificationRedaction.Redact("Parked at 37.4219983, -122.0840000 now");
        Assert.DoesNotContain("37.4219983", result, StringComparison.Ordinal);
        Assert.Contains(NotificationRedaction.Mask, result, StringComparison.Ordinal);
    }

    [Fact]
    public void Redact_masks_email()
    {
        var result = NotificationRedaction.Redact("Sent to driver@example.com today");
        Assert.DoesNotContain("driver@example.com", result, StringComparison.Ordinal);
        Assert.Contains(NotificationRedaction.Mask, result, StringComparison.Ordinal);
    }

    [Fact]
    public void Redact_leaves_clean_text_unchanged()
    {
        const string Clean = "Your vehicle finished charging at 80%.";
        Assert.Equal(Clean, NotificationRedaction.Redact(Clean));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Redact_handles_empty_input(string? text) =>
        Assert.Equal(string.Empty, NotificationRedaction.Redact(text));
}
