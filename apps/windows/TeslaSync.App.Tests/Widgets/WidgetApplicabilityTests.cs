using TeslaSync.App.Core.Widgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Asserts the recorded applicability decision (P2/W8-0003): widgets implemented, classic Live Tiles
/// not applicable on the Windows 11 baseline, and the gate-marker tokens present and correctly valued.
/// </summary>
public sealed class WidgetApplicabilityTests
{
    [Fact]
    public void Widgets_are_marked_done()
    {
        Assert.Equal("DONE", WidgetApplicability.WidgetsStatus);
        Assert.Equal("WIDGETS_STATUS", WidgetApplicability.WidgetsStatusMarker);
    }

    [Fact]
    public void Live_tiles_are_marked_not_applicable_with_a_reason()
    {
        Assert.Equal("NOT_APPLICABLE", WidgetApplicability.LiveTilesStatus);
        Assert.Equal("LIVE_TILES_STATUS", WidgetApplicability.LiveTilesStatusMarker);
        Assert.Equal("LiveTileUnsupportedByWindows11", WidgetApplicability.LiveTilesUnsupportedReason);
    }
}
