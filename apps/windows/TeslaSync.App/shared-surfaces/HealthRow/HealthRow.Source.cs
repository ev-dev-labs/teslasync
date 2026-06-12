namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The navigation seam a <c>HealthRow</c> link routes activation through (P1/S8) — the native analogue of the
/// web link targets the row resolves to (web/src/components/status/HealthRow.tsx L78-97): a react-router
/// <c>&lt;Link to&gt;</c> for an in-app route, or an <c>&lt;a href target="_blank"&gt;</c> for an external
/// destination. The view never navigates itself — it binds to this seam and forwards the resolved target plus
/// the external flag, so the composition root decides whether to route in-app or launch the system browser. The
/// inert <see cref="NullHealthRowNavigator"/> stands in for the design-time / headless entry points; the
/// composition root supplies a real navigator. WinUI-free so the routing contract is exercised without a UI host.
/// </summary>
public interface IHealthRowNavigator
{
    /// <summary>
    /// Navigate to <paramref name="target"/> (web link click). When <paramref name="external"/> is true the
    /// destination opens out of the app (web <c>&lt;a target="_blank"&gt;</c>); otherwise it is an in-app route
    /// (web <c>&lt;Link to&gt;</c>).
    /// </summary>
    /// <param name="target">The destination the row links to (web <c>to</c>).</param>
    /// <param name="external">Whether the destination opens out of the app (web <c>external</c>).</param>
    void Navigate(string target, bool external);
}

/// <summary>
/// The inert navigation seam used when no navigator is supplied — the native analogue of mounting the web row
/// link with no router: activation is a safe no-op that never throws. Used by the design-time / headless entry
/// points; the composition root supplies a real <see cref="IHealthRowNavigator"/>.
/// </summary>
public sealed class NullHealthRowNavigator : IHealthRowNavigator
{
    /// <summary>The shared inert instance.</summary>
    public static NullHealthRowNavigator Instance { get; } = new();

    private NullHealthRowNavigator()
    {
    }

    /// <inheritdoc />
    public void Navigate(string target, bool external)
    {
        // No router mounted — activation is dropped, exactly as a web link click with no navigation host.
    }
}
