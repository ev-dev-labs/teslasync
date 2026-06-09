using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Coarse category for a recorded page — the native port of the web <c>RecentPageKind</c>
/// (web/src/lib/recentPages.ts). Drives the leading icon shown for a row. Unknown / generic
/// pages fall through to <see cref="Page"/>, mirroring the web consumer's fallback.
/// </summary>
public enum RecentlyViewedKind
{
    /// <summary>A generic page (web <c>'page'</c>) — the icon fallback.</summary>
    Page,

    /// <summary>A vehicle detail page (web <c>'vehicle'</c>).</summary>
    Vehicle,

    /// <summary>A drive detail page (web <c>'drive'</c>).</summary>
    Drive,

    /// <summary>A trip detail page (web <c>'trip'</c>).</summary>
    Trip,

    /// <summary>A charging-session detail page (web <c>'charging'</c>).</summary>
    Charging,

    /// <summary>A geofence detail page (web <c>'geofence'</c>).</summary>
    Geofence,

    /// <summary>A year-in-review page (web <c>'year-review'</c>).</summary>
    YearReview,
}

/// <summary>
/// The mutually-exclusive surface state for the <see cref="RecentlyViewedViewModel"/>. The web
/// <c>RecentlyViewedWidget</c> (web/src/features/dashboard/components/RecentlyViewedWidget.tsx) reads the
/// client-side <c>getRecentPages()</c> store <b>synchronously</b> and re-renders on
/// <c>subscribeRecentPages</c>, so it has exactly two visual branches: <see cref="Ready"/> (the rendered
/// list) and <see cref="Empty"/> (the non-actionable hint paragraph).
/// <para>
/// There is deliberately <b>no</b> loading / error / stale / offline state because the web source has none:
/// the recent-pages store is an in-process client store, not a network read, so there is nothing to load,
/// fail, go stale, or fall offline. This mirrors the sibling presentational surface <c>QuickNavWidget</c>,
/// which documents the same absence. The surface still updates live — a store change re-projects and flips
/// <see cref="State"/> between <see cref="Ready"/> and <see cref="Empty"/>.
/// </para>
/// </summary>
public enum RecentlyViewedState
{
    /// <summary>At least one recent page resolved — render the list (web truthy <c>entries.length</c>).</summary>
    Ready,

    /// <summary>No recent pages — render the friendly hint paragraph (web <c>entries.length === 0</c>).</summary>
    Empty,
}

/// <summary>
/// One recorded visit as surfaced by the state-holder seam — the native analogue of a web
/// <c>RecentEntry</c> (<c>{ path, title, kind, visited_at }</c> in web/src/lib/recentPages.ts). The
/// <see cref="Kind"/> is classified from the <see cref="Path"/> by the source (the web store records it),
/// and <see cref="VisitedAt"/> is the most-recent visit timestamp the relative label is derived from.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Path">Normalized route path (web <c>path</c>) — used for navigation and dedup.</param>
/// <param name="Title">Display title captured at record time (web <c>title</c>).</param>
/// <param name="Kind">Coarse category driving the row icon (web <c>kind</c>).</param>
/// <param name="VisitedAt">Timestamp of the most-recent visit (web <c>visited_at</c>).</param>
public sealed record RecentlyViewedEntry(
    string Path,
    string Title,
    RecentlyViewedKind Kind,
    DateTimeOffset VisitedAt);

/// <summary>
/// One projected, render-ready row consumed by the WinUI view — the native analogue of a rendered web
/// <c>&lt;Link&gt;</c> row. <see cref="Glyph"/> is the Segoe Fluent code point standing in for the web
/// Lucide icon, <see cref="RelativeText"/> is the already-localized "time ago" label
/// (web <c>formatRelative</c>), and <see cref="AutomationName"/> is the Narrator name joining the title and
/// relative time (the web link's accessible name). Pure data so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Path">The route the row navigates to (web <c>entry.path</c>).</param>
/// <param name="Glyph">Segoe Fluent glyph for the kind (web Lucide icon).</param>
/// <param name="Title">Display title (web <c>entry.title</c>).</param>
/// <param name="RelativeText">Localized relative-time label (web <c>formatRelative</c>).</param>
/// <param name="AutomationName">Narrator name for the row (title + relative time).</param>
public sealed record RecentlyViewedRow(
    string Path,
    string Glyph,
    string Title,
    string RelativeText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view — the ordered, newest-first rows the web component renders
/// (web <c>entries.map</c>). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Rows">The ordered recent-page rows (newest first), capped to the display limit.</param>
public sealed record RecentlyViewedDisplay(IReadOnlyList<RecentlyViewedRow> Rows)
{
    /// <summary>An empty display (no rows) — drives the <see cref="RecentlyViewedState.Empty"/> branch.</summary>
    public static RecentlyViewedDisplay None { get; } = new(Array.Empty<RecentlyViewedRow>());

    /// <summary>True when at least one row resolved (web truthy <c>entries.length &gt; 0</c>).</summary>
    public bool HasRows => Rows.Count > 0;
}

/// <summary>
/// Canonical metadata for the Recently Viewed surface. Unlike the resizable dashboard widgets, the web
/// <c>RecentlyViewedWidget</c> is embedded directly in <c>DashboardPage</c> (no registry footprint), so this
/// carries only the diagnostics slug and the display cap the web component uses
/// (<c>RECENT_PAGES_DISPLAY_LIMIT = 5</c>).
/// </summary>
public static class RecentlyViewedRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "RecentlyViewedWidget";

    /// <summary>Default number of rows shown (web <c>RECENT_PAGES_DISPLAY_LIMIT</c>).</summary>
    public const int DisplayLimit = 5;
}

/// <summary>
/// Pure projection from <see cref="RecentlyViewedEntry"/> records to render-ready
/// <see cref="RecentlyViewedRow"/>s — the native port of the web component's <c>entries.map</c> +
/// <c>iconForKind</c> + <c>formatRelative</c> (web/src/features/dashboard/components/RecentlyViewedWidget.tsx).
/// Every user-visible string flows through the i18n facade; the Narrator name joins the title and the
/// relative-time label as the web link's accessible name does. No SI conversion applies (no measurements).
/// </summary>
public static class RecentlyViewedProjection
{
    // Segoe Fluent Icons code points standing in for the web Lucide icons. Each is chosen to match the
    // destination's nav-pane glyph in RouteTable so an entry's icon is consistent with the rest of the shell.
    private const string VehicleGlyph = "\uE804";    // web Car        — Vehicles route glyph
    private const string DriveGlyph = "\uE7C0";      // web Route      — Drives route glyph
    private const string ChargingGlyph = "\uE945";   // web BatteryCharging — Charging route glyph
    private const string TripGlyph = "\uE81E";       // web Compass    — MapDirections
    private const string GeofenceGlyph = "\uE909";   // web MapPinned  — Geofences route glyph
    private const string YearReviewGlyph = "\uE787"; // web CalendarDays — Calendar
    private const string PageGlyph = "\uE7C3";       // web FileText   — Page (the icon fallback)

    /// <summary>Segoe Fluent header glyph (web <c>Clock</c>) for the "Recently Viewed" title row.</summary>
    public const string HeaderGlyph = "\uE823"; // Recent (clock)

    // Responsive breakpoints (px) — the native analogue of the web grid
    // `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` (Tailwind sm=640, lg=1024).
    private const double SmallBreakpoint = 640;
    private const double LargeBreakpoint = 1024;

    /// <summary>The Segoe Fluent glyph for <paramref name="kind"/> (web <c>iconForKind</c>).</summary>
    public static string GlyphFor(RecentlyViewedKind kind) => kind switch
    {
        RecentlyViewedKind.Vehicle => VehicleGlyph,
        RecentlyViewedKind.Drive => DriveGlyph,
        RecentlyViewedKind.Charging => ChargingGlyph,
        RecentlyViewedKind.Trip => TripGlyph,
        RecentlyViewedKind.Geofence => GeofenceGlyph,
        RecentlyViewedKind.YearReview => YearReviewGlyph,
        _ => PageGlyph,
    };

    /// <summary>
    /// The number of grid columns for <paramref name="availableWidth"/> — the native analogue of the web
    /// responsive grid (1 column when narrow, 2 from the small breakpoint, 3 from the large breakpoint).
    /// </summary>
    public static int ColumnsForWidth(double availableWidth)
    {
        if (double.IsNaN(availableWidth) || availableWidth < SmallBreakpoint)
        {
            return 1;
        }

        return availableWidth < LargeBreakpoint ? 2 : 3;
    }

    /// <summary>
    /// Format the elapsed time between <paramref name="visitedAt"/> and <paramref name="now"/> as a compact
    /// relative label — the native port of the web <c>formatRelative</c>: under a minute → "Just now",
    /// under an hour → <c>{m}m</c>, under a day → <c>{h}h</c>, otherwise <c>{d}d</c>. A future timestamp is
    /// clamped to "Just now" (web <c>Math.max(0, …)</c>).
    /// </summary>
    public static string FormatRelative(DateTimeOffset visitedAt, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var elapsed = now - visitedAt;
        if (elapsed < TimeSpan.Zero)
        {
            elapsed = TimeSpan.Zero;
        }

        long minutes = (long)Math.Floor(elapsed.TotalMinutes);
        if (minutes < 1)
        {
            return localizer.GetString("recentPages.justNow", "Just now");
        }

        if (minutes < 60)
        {
            return string.Create(
                CultureInfo.CurrentCulture,
                $"{minutes}{localizer.GetString("recentPages.shortMinute", "m")}");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(
                CultureInfo.CurrentCulture,
                $"{hours}{localizer.GetString("recentPages.shortHour", "h")}");
        }

        long days = hours / 24;
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{days}{localizer.GetString("recentPages.shortDay", "d")}");
    }

    /// <summary>
    /// Project <paramref name="entries"/> (already newest-first) into render-ready rows, capping at
    /// <paramref name="limit"/> and resolving the relative-time label and Narrator name through
    /// <paramref name="localizer"/> against <paramref name="now"/>.
    /// </summary>
    public static RecentlyViewedDisplay Project(
        IReadOnlyList<RecentlyViewedEntry> entries,
        int limit,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(localizer);

        int take = Math.Max(0, limit);
        if (take == 0 || entries.Count == 0)
        {
            return RecentlyViewedDisplay.None;
        }

        int count = Math.Min(take, entries.Count);
        var rows = new List<RecentlyViewedRow>(count);
        for (int i = 0; i < count; i++)
        {
            var entry = entries[i];
            string relative = FormatRelative(entry.VisitedAt, now, localizer);
            string automationName = string.Create(CultureInfo.CurrentCulture, $"{entry.Title}, {relative}");
            rows.Add(new RecentlyViewedRow(
                entry.Path,
                GlyphFor(entry.Kind),
                entry.Title,
                relative,
                automationName));
        }

        return new RecentlyViewedDisplay(rows);
    }
}

/// <summary>
/// PII-safe diagnostics for the Recently Viewed surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a path, title or any user data, since
/// recent-page history is privacy-sensitive (it leaks browsing patterns). Thread-safe.
/// </summary>
public sealed class RecentlyViewedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public RecentlyViewedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RecentlyViewedWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RecentlyViewedRegistration.Slug}");
    }
}
