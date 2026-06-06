using TeslaSync.App.Core.Status;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class StatusPresentationTests
{
    [Fact]
    public void UptimePercent_Empty_IsNull() =>
        Assert.Null(StatusPresentation.UptimePercent([]));

    [Fact]
    public void UptimePercent_CountsHealthyAndMaintenanceAsUp()
    {
        UptimeDay[] days =
        [
            new("2024-01-01", HealthStatus.Healthy),
            new("2024-01-02", HealthStatus.Maintenance),
            new("2024-01-03", HealthStatus.Degraded),
            new("2024-01-04", HealthStatus.Unhealthy),
        ];

        Assert.Equal(50.0, StatusPresentation.UptimePercent(days));
    }

    [Fact]
    public void UptimePercent_AllHealthy_Is100()
    {
        UptimeDay[] days =
        [
            new("2024-01-01", HealthStatus.Healthy),
            new("2024-01-02", HealthStatus.Healthy),
        ];

        Assert.Equal(100.0, StatusPresentation.UptimePercent(days));
    }

    [Theory]
    [InlineData(null, ResourceSeverity.Normal)]
    [InlineData(0.0, ResourceSeverity.Normal)]
    [InlineData(69.9, ResourceSeverity.Normal)]
    [InlineData(70.0, ResourceSeverity.Warn)]
    [InlineData(89.9, ResourceSeverity.Warn)]
    [InlineData(90.0, ResourceSeverity.Critical)]
    [InlineData(100.0, ResourceSeverity.Critical)]
    public void Severity_AppliesThresholds(double? percent, ResourceSeverity expected) =>
        Assert.Equal(expected, StatusPresentation.Severity(percent));

    [Theory]
    [InlineData(ResourceSeverity.Normal, StatusPresentation.HealthyHex)]
    [InlineData(ResourceSeverity.Warn, StatusPresentation.DegradedHex)]
    [InlineData(ResourceSeverity.Critical, StatusPresentation.UnhealthyHex)]
    public void SeverityHex_MapsToAccent(ResourceSeverity severity, string expected) =>
        Assert.Equal(expected, StatusPresentation.SeverityHex(severity));

    [Theory]
    [InlineData(HealthStatus.Healthy, StatusPresentation.HealthyHex)]
    [InlineData(HealthStatus.Degraded, StatusPresentation.DegradedHex)]
    [InlineData(HealthStatus.Unhealthy, StatusPresentation.UnhealthyHex)]
    [InlineData(HealthStatus.Maintenance, StatusPresentation.MaintenanceHex)]
    [InlineData(HealthStatus.Unknown, StatusPresentation.UnknownHex)]
    public void AccentHex_MapsEveryStatus(HealthStatus status, string expected) =>
        Assert.Equal(expected, StatusPresentation.AccentHex(status));

    [Fact]
    public void Labels_AndHeadlines_AreNonEmptyForEveryStatus()
    {
        foreach (HealthStatus status in Enum.GetValues<HealthStatus>())
        {
            Assert.False(string.IsNullOrWhiteSpace(StatusPresentation.Label(status)));
            Assert.False(string.IsNullOrWhiteSpace(StatusPresentation.DefaultHeadline(status)));
            Assert.False(string.IsNullOrWhiteSpace(StatusPresentation.ShortHeadline(status)));
            Assert.False(string.IsNullOrWhiteSpace(StatusPresentation.Glyph(status)));
        }
    }
}
