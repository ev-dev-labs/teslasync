namespace TeslaSync.App.Core.Widgets;

/// <summary>
/// The recorded applicability decision for the two Windows ambient surfaces (P2/W8-0003), kept in code
/// so the manifest, provider and gate share one source of truth.
///
/// <para><b>Widgets — applicable.</b> The pinned Windows App SDK (2.1.3, via
/// <c>Microsoft.WindowsAppSDK.Widgets 2.0.5</c>) ships <c>Microsoft.Windows.Widgets.Providers</c>
/// (<c>IWidgetProvider</c>, <c>WidgetManager.UpdateWidget</c>, <c>WidgetContext</c>,
/// <c>WidgetUpdateRequestOptions</c>), so a real provider is implemented over cached + live data.</para>
///
/// <para><b>Live Tiles — not applicable.</b> Windows 11 Start removed classic Live Tiles; the
/// <c>Windows.UI.Notifications.TileUpdateManager</c> Start-tile surface is inert there. Faking it would
/// violate the honesty covenant, so the tile sub-scope is recorded as not applicable rather than stubbed.
/// The reason token <see cref="LiveTilesUnsupportedReason"/> is what the gate reads to classify the
/// sub-scope.</para>
/// </summary>
public static class WidgetApplicability
{
    /// <summary>The gate marker literal for the widgets sub-scope status.</summary>
    public const string WidgetsStatusMarker = "WIDGETS_STATUS";

    /// <summary>The gate marker literal for the live-tiles sub-scope status.</summary>
    public const string LiveTilesStatusMarker = "LIVE_TILES_STATUS";

    /// <summary>The widgets sub-scope outcome: a real provider is implemented.</summary>
    public const string WidgetsStatus = "DONE";

    /// <summary>The live-tiles sub-scope outcome: unsupported on the target baseline.</summary>
    public const string LiveTilesStatus = "NOT_APPLICABLE";

    /// <summary>
    /// The reason token the gate keys on to mark Live Tiles not applicable. Its presence asserts the
    /// surface was evaluated and deliberately not faked, because Windows 11 Start does not support
    /// classic Live Tiles.
    /// </summary>
    public const string LiveTilesUnsupportedReason = "LiveTileUnsupportedByWindows11";
}
