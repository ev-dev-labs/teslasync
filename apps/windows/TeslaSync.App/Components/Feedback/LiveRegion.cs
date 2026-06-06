using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;

namespace TeslaSync.App.Components.Feedback;

/// <summary>
/// Helpers for wiring UI-Automation live regions so screen readers announce
/// loading / empty / error / banner state changes without the user having to
/// move focus. Polite announcements wait for a pause; assertive ones interrupt.
/// </summary>
internal static class LiveRegion
{
    /// <summary>Mark an element as a live region with the given urgency.</summary>
    public static void Configure(FrameworkElement element, bool assertive = false)
    {
        ArgumentNullException.ThrowIfNull(element);
        AutomationProperties.SetLiveSetting(
            element,
            assertive ? AutomationLiveSetting.Assertive : AutomationLiveSetting.Polite);
    }

    /// <summary>Announce that a live region's content has changed.</summary>
    public static void Announce(FrameworkElement element)
    {
        ArgumentNullException.ThrowIfNull(element);
        var peer = FrameworkElementAutomationPeer.FromElement(element)
            ?? FrameworkElementAutomationPeer.CreatePeerForElement(element);
        peer?.RaiseAutomationEvent(AutomationEvents.LiveRegionChanged);
    }
}
