using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// Metadata for the native WinUI 3 <c>SystemPage</c> — the parity port of the web page
/// <c>web/src/features/admin/pages/SystemPage.tsx</c>. The web page is an "infrastructure-budget" admin
/// dashboard that composes two presentational panels (RateLimitStatusPanel + QueueStatusPanel) under a
/// title/subtitle header; it has no data sources of its own. This registration exposes the page's diagnostics
/// slug, the shell page-factory route name and the two localized header strings the manifest requires
/// (<c>system.page.title</c> / <c>system.page.subtitle</c>). Every literal flows through the
/// <see cref="ILocalizer"/> facade with the web key names so the resource pipeline (and the headless tests)
/// resolve the exact same keys.
/// </summary>
public static class SystemPageRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SystemPage";

    /// <summary>
    /// The shell page-factory name the page registers under. The web page exports
    /// <c>SYSTEM_PAGE_PATH = '/admin/system'</c> but is never wired into a web router (manifest web route
    /// <c>(unrouted)</c>), so the native <see cref="Core.Navigation.RouteTable"/> intentionally carries no
    /// matching entry; the factory registration keeps the surface reachable by deep link / programmatic
    /// navigation without inventing a route that the web parity baseline does not have.
    /// </summary>
    public const string RouteName = "System";

    /// <summary>The localized page title (web <c>system.page.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("system.page.title", "System budgets");
    }

    /// <summary>The localized page subtitle (web <c>system.page.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "system.page.subtitle",
            "Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SystemPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never any vehicle, account or budget data —
/// so a diagnostics line can never leak operator content. Thread-safe.
/// </summary>
public sealed class SystemPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SystemPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SystemPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SystemPageRegistration.Slug}");
    }
}
