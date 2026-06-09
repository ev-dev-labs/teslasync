using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The state-holder seam the <see cref="RecentlyViewedViewModel"/> binds to (P1/S8) — the native analogue
/// of the web <c>useRecentPages</c> hook composition (<c>getRecentPages</c> + <c>subscribeRecentPages</c> in
/// web/src/lib/recentPages.ts). It exposes a newest-first snapshot of recent visits and a change signal so
/// the surface re-renders live when the store mutates (the web <c>subscribeRecentPages</c> callback). The
/// view never reads the store directly; the canonical <see cref="RecentlyViewedSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IRecentlyViewedSource
{
    /// <summary>Raised whenever the recent-page list changes (the web <c>subscribeRecentPages</c> signal).</summary>
    event EventHandler? Changed;

    /// <summary>
    /// The recent visits, newest first, capped at <paramref name="limit"/> (the web
    /// <c>getRecentPages(limit)</c> slice).
    /// </summary>
    IReadOnlyList<RecentlyViewedEntry> GetEntries(int limit);
}

/// <summary>
/// The canonical <see cref="IRecentlyViewedSource"/> — an observable adapter over the shared, headless
/// <see cref="RecentPages"/> recorder (TeslaSync.App.Core.Navigation). It is the single mutation point for
/// the widget's store (the native analogue of the web <c>recordPageView</c> / <c>clearRecentPages</c>
/// writers): <see cref="Record"/> and <see cref="Clear"/> mutate the recorder and raise <see cref="Changed"/>
/// so every bound surface refreshes, exactly as the web store fires its same-tab change event. Because the
/// Core recorder does not persist a category, <see cref="GetEntries"/> classifies each entry's
/// <see cref="RecentlyViewedKind"/> from its path on read (the native port of the web <c>classifyPath</c>),
/// and applies the web's <c>title || path</c> fallback so a blank title never renders empty. Headless, so the
/// adapter and classifier are unit-tested without a UI host.
/// </summary>
public sealed class RecentlyViewedSource : IRecentlyViewedSource
{
    // Web parity: the recent-page list is capped at RECENT_PAGES_MAX = 50 (web/src/lib/recentPages.ts).
    private const int StoreCapacity = 50;

    private readonly RecentPages _store;

    /// <summary>Creates the adapter over <paramref name="store"/> (a fresh 50-entry recorder by default).</summary>
    public RecentlyViewedSource(RecentPages? store = null) =>
        _store = store ?? new RecentPages(StoreCapacity);

    /// <summary>
    /// The process-wide recent-pages source the host records every page visit through, so the dashboard
    /// widget, the command palette and any other consumer observe one shared, live store (the native
    /// analogue of the web module-level <c>localStorage</c> store).
    /// </summary>
    public static RecentlyViewedSource Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>
    /// Record a visit to <paramref name="path"/> (web <c>recordPageView</c>): delegates to the bounded,
    /// de-duplicated recorder then raises <see cref="Changed"/>. <paramref name="at"/> defaults to now.
    /// </summary>
    public void Record(string path, string title, DateTimeOffset? at = null)
    {
        _store.Record(path, title, at);
        RaiseChanged();
    }

    /// <summary>Clear all recorded visits (web <c>clearRecentPages</c>) and raise <see cref="Changed"/>.</summary>
    public void Clear()
    {
        _store.Clear();
        RaiseChanged();
    }

    /// <inheritdoc />
    public IReadOnlyList<RecentlyViewedEntry> GetEntries(int limit)
    {
        if (limit <= 0)
        {
            return Array.Empty<RecentlyViewedEntry>();
        }

        var items = _store.Items;
        int count = Math.Min(limit, items.Count);
        if (count == 0)
        {
            return Array.Empty<RecentlyViewedEntry>();
        }

        var entries = new List<RecentlyViewedEntry>(count);
        for (int i = 0; i < count; i++)
        {
            var item = items[i];
            string title = string.IsNullOrWhiteSpace(item.Title) ? item.Path : item.Title;
            entries.Add(new RecentlyViewedEntry(item.Path, title, ClassifyKind(item.Path), item.VisitedAt));
        }

        return entries;
    }

    /// <summary>
    /// Classify a (normalized, slash-free) route path into a <see cref="RecentlyViewedKind"/> — the native
    /// port of the web <c>classifyPath</c> table (web/src/lib/recentPages.ts). A category requires a
    /// non-empty sub-segment after the prefix (e.g. <c>vehicles/1</c> → vehicle, but the bare
    /// <c>vehicles</c> list page → <see cref="RecentlyViewedKind.Page"/>), exactly as the web regexes
    /// <c>^/vehicles/([^/]+)(?:\/|$)</c> require.
    /// </summary>
    public static RecentlyViewedKind ClassifyKind(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return RecentlyViewedKind.Page;
        }

        var segments = path.TrimStart('/').Split('/');
        if (segments.Length < 2 || segments[1].Length == 0)
        {
            return RecentlyViewedKind.Page;
        }

        return segments[0] switch
        {
            "vehicles" => RecentlyViewedKind.Vehicle,
            "drives" => RecentlyViewedKind.Drive,
            "charging" => RecentlyViewedKind.Charging,
            "trips" => RecentlyViewedKind.Trip,
            "geofences" => RecentlyViewedKind.Geofence,
            "year-review" => RecentlyViewedKind.YearReview,
            _ => RecentlyViewedKind.Page,
        };
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
