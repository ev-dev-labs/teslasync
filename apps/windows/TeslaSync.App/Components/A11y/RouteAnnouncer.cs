using System.Globalization;

namespace TeslaSync.App.Components.A11y;

/// <summary>
/// Builds the spoken text for a navigation/route change (port of the web route
/// announcer's message string). Kept static + headless so the wording is testable
/// without a live region; <see cref="TsRouteAnnouncer"/> speaks the result.
/// </summary>
public static class RouteAnnouncement
{
    /// <summary>
    /// "Navigated to {title}" — the standard SPA route-change announcement used by
    /// the W3 shell when the active page changes.
    /// </summary>
    public static string ForRoute(string? title)
    {
        string trimmed = title?.Trim() ?? string.Empty;
        return string.IsNullOrEmpty(trimmed)
            ? "Navigated."
            : string.Create(CultureInfo.InvariantCulture, $"Navigated to {trimmed}");
    }
}

/// <summary>
/// A route-change announcer for the shell (port of the web route announcer
/// component). Wraps an assertive <see cref="TsAnnouncerRegion"/> and speaks
/// "Navigated to {page}" whenever <see cref="AnnounceRoute"/> is called, so screen
/// reader users hear the destination after client-side navigation. Drop one
/// instance in the W3 shell and call it from the navigation handler.
/// </summary>
public partial class TsRouteAnnouncer : TsAnnouncerRegion
{
    public TsRouteAnnouncer() => Assertive = true;

    /// <summary>Announce navigation to a page by its localized <paramref name="title"/>.</summary>
    public void AnnounceRoute(string? title) => Announce(RouteAnnouncement.ForRoute(title));
}
