namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The outbound navigation seam the Quick Navigation surface drives — the native analogue of the web
/// react-router <c>&lt;Link to="…"&gt;</c> in web/src/features/dashboard/components/QuickNav.tsx. The view
/// never touches the shell directly; activating a tile calls <see cref="Navigate(string)"/> with the
/// canonical W3 route name, and the dashboard host wires this to the in-app navigation (resolving the
/// route name to its path and invoking the shell). A test double records the requested route so the
/// view-model's navigation behaviour is verified without a shell.
/// </summary>
public interface IQuickNavNavigator
{
    /// <summary>Navigate the shell to the destination identified by <paramref name="routeName"/>.</summary>
    /// <param name="routeName">The stable W3 route name (e.g. <c>Drives</c>, <c>Charging</c>).</param>
    void Navigate(string routeName);
}

/// <summary>
/// The source of the surface's navigation entries (P1/S8 state-holder seam). QuickNav is presentational,
/// so the entries are the fixed catalog the web component hard-codes (<c>NAV_ITEMS</c> in
/// web/src/features/dashboard/components/QuickNav.tsx) rather than a network read — but routing the list
/// through a seam keeps the view-model free of literals and lets a test substitute an empty or alternate
/// catalog to exercise the empty branch.
/// </summary>
public interface IQuickNavItemSource
{
    /// <summary>The ordered navigation entries to project into tiles.</summary>
    IReadOnlyList<QuickNavItem> GetItems();
}

/// <summary>
/// The canonical <see cref="IQuickNavItemSource"/> — the four navigation entries the web <c>QuickNav</c>
/// component renders, in the same order (Drives, Charging, Analytics, Battery). Each entry carries the
/// destination's W3 route name, the Segoe Fluent glyph the nav pane uses for that destination, the web
/// i18n key + English fallback for the title and description, and the semantic accent token mapped from
/// the web Tailwind colour. Headless and immutable, so the catalog is asserted in unit tests.
/// </summary>
public sealed class QuickNavItemSource : IQuickNavItemSource
{
    // Segoe Fluent Icons code points — each matches the destination's nav-pane glyph in RouteTable
    // (web Lucide icon → the platform glyph the rest of the shell already uses for that page).
    private const string DrivesGlyph = "\uE7C0";    // web Route — Drives page
    private const string ChargingGlyph = "\uE945";  // web BatteryCharging — Charging page
    private const string AnalyticsGlyph = "\uE9D9"; // web Gauge — Analytics page
    private const string BatteryGlyph = "\uE83E";   // web Activity — Battery Health page

    // Semantic accent tokens (web Tailwind hex → nearest design token).
    private const string Info = "TsColorInfoBrush";       // web #00f0ff (cyan)
    private const string Success = "TsColorSuccessBrush"; // web #10b981 (green)
    private const string Accent = "TsColorAccentBrush";   // web #a855f7 (purple)
    private const string Warning = "TsColorWarningBrush"; // web #f59e0b (amber)

    /// <summary>The canonical, ordered navigation catalog (web <c>NAV_ITEMS</c>).</summary>
    public static IReadOnlyList<QuickNavItem> Canonical { get; } = new[]
    {
        new QuickNavItem("Drives", DrivesGlyph, "nav.drives", "Drives", "nav.drivesDesc", "Trip history", Info),
        new QuickNavItem("Charging", ChargingGlyph, "nav.charging", "Charging", "nav.chargingDesc", "Sessions & costs", Success),
        new QuickNavItem("Analytics", AnalyticsGlyph, "nav.analytics", "Analytics", "nav.analyticsDesc", "Fleet insights", Accent),
        new QuickNavItem("BatteryHealth", BatteryGlyph, "nav.battery", "Battery", "nav.batteryDesc", "Health & degradation", Warning),
    };

    /// <inheritdoc />
    public IReadOnlyList<QuickNavItem> GetItems() => Canonical;
}
