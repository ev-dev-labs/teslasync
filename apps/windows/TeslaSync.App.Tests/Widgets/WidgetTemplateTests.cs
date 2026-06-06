using System.Text.Json;
using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Verifies the Adaptive Card template is a valid card with the expected bindings, and that the packaged
/// <c>VehicleStatusTemplate.json</c> (the AppExtension PublicFolder copy) has not drifted from the
/// canonical Core constant the provider uses at runtime.
/// </summary>
public sealed class WidgetTemplateTests
{
    private static string Canonical(string json) =>
        JsonSerializer.Serialize(JsonDocument.Parse(json).RootElement);

    [Fact]
    public void Template_is_a_valid_adaptive_card()
    {
        using var doc = JsonDocument.Parse(WidgetTemplate.VehicleStatus);
        var root = doc.RootElement;

        Assert.Equal("AdaptiveCard", root.GetProperty("type").GetString());
        Assert.False(string.IsNullOrEmpty(root.GetProperty("version").GetString()));
        Assert.Equal(JsonValueKind.Array, root.GetProperty("body").ValueKind);
        Assert.Equal(JsonValueKind.Array, root.GetProperty("actions").ValueKind);
    }

    [Theory]
    [InlineData("${displayName}")]
    [InlineData("${batteryText}")]
    [InlineData("${rangeText}")]
    [InlineData("${chargeStateText}")]
    [InlineData("${freshnessLabel}")]
    [InlineData("${openVehicleUrl}")]
    [InlineData("${showVin}")]
    [InlineData("${showLocation}")]
    [InlineData("${hasOpenCharging}")]
    public void Template_carries_the_expected_bindings(string token)
    {
        Assert.Contains(token, WidgetTemplate.VehicleStatus, StringComparison.Ordinal);
    }

    [Fact]
    public void Packaged_template_matches_the_canonical_core_template()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "VehicleStatusTemplate.json");
        Assert.True(File.Exists(path), $"Packaged widget template was not copied next to the tests at {path}");

        var packaged = File.ReadAllText(path);

        Assert.Equal(Canonical(WidgetTemplate.VehicleStatus), Canonical(packaged));
    }
}
