using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DashboardStatsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DashboardStatsWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetStatGrid</c>
/// (web/src/features/dashboard/widgets/DashboardStatsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData = stats.data != null</c>
/// gate — only the dashboard-stats read is load-bearing; the FSM-state and state-timeline reads merely
/// enrich the surface and degrade silently to <c>—</c> / no rows when absent.
/// </summary>
public enum DashboardStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with data to show.</summary>
    Loaded,

    /// <summary>The dashboard-stats query resolved to no payload (web <c>!stats.data</c>) — empty state.</summary>
    Empty,

    /// <summary>The dashboard-stats request failed and no cached snapshot exists — the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The dashboard rollup from <c>GET /dashboard/stats</c> (web <c>useDashboardStats</c>, shape
/// <c>DashboardStats</c> in web/src/types/dashboard.ts). Unusually for this API the handler emits
/// camelCase JSON tags (<c>totalVehicles</c>, <c>totalTrips</c>, <c>totalChargingSessions</c> — see
/// internal/app/dashboardsvc/service.go); parsing reads the camelCase keys first and falls back to
/// snake_case so a contract shift never throws. Only the three counters the web surface reads are kept;
/// every value is a dimensionless count, so no unit conversion applies.
/// </summary>
public sealed record DashboardStatsData(
    int TotalVehicles,
    int TotalTrips,
    int TotalChargingSessions)
{
    /// <summary>An all-zero snapshot flagged as having no payload — the parse fallback for an absent/non-object body.</summary>
    public static DashboardStatsData Empty { get; } = new(0, 0, 0) { HasData = false };

    /// <summary>
    /// True when a stats payload is present (web <c>stats.data</c> truthiness). The backend always
    /// returns a populated object — including for an idle fleet, which renders as zeros — so this is
    /// true for every real snapshot and only false for the <see cref="Empty"/> fallback (an absent
    /// body). Gates the empty state.
    /// </summary>
    public bool HasData { get; init; } = true;

    /// <summary>Project a <c>GET /dashboard/stats</c> JSON object into a tolerant snapshot.</summary>
    public static DashboardStatsData FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new DashboardStatsData(
            TotalVehicles: GetInt(element, "totalVehicles", "total_vehicles"),
            TotalTrips: GetInt(element, "totalTrips", "total_trips"),
            TotalChargingSessions: GetInt(element, "totalChargingSessions", "total_charging_sessions"));
    }

    private static int GetInt(JsonElement obj, string camel, string snake) =>
        (int)Math.Round(GetDouble(obj, camel) ?? GetDouble(obj, snake) ?? 0, MidpointRounding.AwayFromZero);

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One finite-state-machine transition from <c>GET /vehicle-states/timeline</c> (web
/// <c>useStateTimeline</c>, shape <c>StateTransition</c> in web/src/types/admin.ts): the coarse state
/// the vehicle entered and when. The route was retired in Phase-42 (the hook is <c>@deprecated</c> and
/// the endpoint 404s), so this list is virtually always empty in practice — but the surface reproduces
/// the web's "Recent Transitions" affordance faithfully for the wide footprint when rows are present.
/// </summary>
public sealed record StateTransitionItem(string? State, DateTimeOffset? StartedAt)
{
    /// <summary>Project the <c>{ transitions: [...] }</c> body into a tolerant list (newest first as served).</summary>
    public static IReadOnlyList<StateTransitionItem> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object ||
            !element.TryGetProperty("transitions", out var transitions) ||
            transitions.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<StateTransitionItem>();
        }

        var rows = new List<StateTransitionItem>(transitions.GetArrayLength());
        foreach (var entry in transitions.EnumerateArray())
        {
            if (entry.ValueKind == JsonValueKind.Object)
            {
                rows.Add(new StateTransitionItem(ReadString(entry, "state"), ReadStarted(entry)));
            }
        }

        return rows;
    }

    /// <summary>The coarse vehicle state string read from a <c>GET /vehicles/{vehicleID}/state</c> body (web <c>fsm.data?.state</c>).</summary>
    public static string? ReadFsmState(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object &&
        element.TryGetProperty("state", out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    private static DateTimeOffset? ReadStarted(JsonElement obj)
    {
        string? raw = ReadString(obj, "startedAt") ?? ReadString(obj, "started_at");
        if (raw is null)
        {
            return null;
        }

        return DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            ? parsed
            : null;
    }

    private static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in web/src/features/dashboard/widgets/DashboardStatsWidget.tsx
/// (<c>isCompact = size.cols &lt;= 1</c>, <c>isWide = size.cols &gt;= 3</c>).
/// </summary>
public readonly record struct DashboardStatsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static DashboardStatsSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big active-trips number.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): render the recent-transitions list.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view (web <c>StatGridItem</c>). Holds the
/// localized label, the already-formatted value, and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record DashboardStatItem(string Label, string Value, string AutomationName);

/// <summary>
/// One projected, display-ready FSM transition row consumed by the WinUI view: the capitalized state
/// chip label, the relative-time string (web <c>formatRelative</c>), and a Narrator automation name.
/// </summary>
public sealed record DashboardTransitionRow(string StateLabel, string RelativeTime, string AutomationName);

/// <summary>
/// The merged reading the source emits: the load-bearing dashboard counters, the optional FSM state
/// string (null → rendered as <c>—</c>), and the FSM transition list. Pure data so the projection and
/// the combine mapper are unit-tested without a UI host or a network.
/// </summary>
public sealed record DashboardStatsReading(
    DashboardStatsData Stats,
    string? FsmState,
    IReadOnlyList<StateTransitionItem> Transitions);

/// <summary>
/// The fully projected, render-ready view for one footprint — the native analogue of everything the web
/// component computes via <c>useMemo</c> before returning JSX. Holds the four stat tiles, the compact
/// big-number active-trips hero, the current-state badge (label + semantic tone), and the wide
/// recent-transitions list. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record DashboardStatsDisplay(
    bool IsCompact,
    bool IsWide,
    IReadOnlyList<DashboardStatItem> Stats,
    string CompactValue,
    string CompactLabel,
    string CompactAutomationName,
    string CurrentStateLabel,
    string FsmStateLabel,
    StatusKind FsmTone,
    string CurrentStateAutomationName,
    string RecentTransitionsLabel,
    IReadOnlyList<DashboardTransitionRow> RecentTransitions);

/// <summary>
/// Pure projection from a raw <see cref="DashboardStatsReading"/> to the display model — the native port
/// of the <c>statItems</c> / <c>recentTransitions</c> <c>useMemo</c>s and the compact branch in
/// web/src/features/dashboard/widgets/DashboardStatsWidget.tsx. Counts are dimensionless (no SI
/// conversion); every label resolves through the i18n facade.
/// </summary>
public static class DashboardStatsProjection
{
    /// <summary>Fluent glyph for the surface header / empty state (web <c>LayoutDashboard</c>).</summary>
    public const string HeaderGlyph = "\uE80F"; // Segoe Fluent — dashboard grid

    /// <summary>Em-dash shown for an unknown FSM state (web <c>fsm.data?.state ?? '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Web parity: the wide footprint shows at most the five most-recent transitions.</summary>
    public const int MaxTransitions = 5;

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> relative to <paramref name="now"/>.</summary>
    public static DashboardStatsDisplay Project(
        DashboardStatsReading reading,
        DashboardStatsSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var stats = reading.Stats;
        string fsmStateLabel = string.IsNullOrWhiteSpace(reading.FsmState) ? EmDash : reading.FsmState!;

        string vehiclesLabel = localizer.GetString("widget.dashboardStats.vehicles", "Vehicles");
        string tripsLabel = localizer.GetString("widget.dashboardStats.trips", "Trips");
        string sessionsLabel = localizer.GetString("widget.dashboardStats.sessions", "Charge Sessions");
        string fsmLabel = localizer.GetString("widget.dashboardStats.fsmState", "FSM State");

        string vehiclesValue = FormatInt(stats.TotalVehicles);
        string tripsValue = FormatInt(stats.TotalTrips);
        string sessionsValue = FormatInt(stats.TotalChargingSessions);

        var items = new List<DashboardStatItem>(4)
        {
            new(vehiclesLabel, vehiclesValue, StatAutomationName(vehiclesLabel, vehiclesValue)),
            new(tripsLabel, tripsValue, StatAutomationName(tripsLabel, tripsValue)),
            new(sessionsLabel, sessionsValue, StatAutomationName(sessionsLabel, sessionsValue)),
            new(fsmLabel, fsmStateLabel, StatAutomationName(fsmLabel, fsmStateLabel)),
        };

        string compactLabel = localizer.GetString("widget.dashboardStats.active", "active");
        string compactValue = FormatInt(stats.TotalTrips);
        string compactAutomationName = string.Format(CultureInfo.CurrentCulture, "{0} {1}", compactValue, compactLabel);

        string currentStateLabel = localizer.GetString("widget.dashboardStats.currentState", "Current State");
        string fsmBadgeLabel = Capitalize(fsmStateLabel);
        string currentStateAutomationName =
            string.Format(CultureInfo.CurrentCulture, "{0}: {1}", currentStateLabel, fsmBadgeLabel);

        string recentTransitionsLabel =
            localizer.GetString("widget.dashboardStats.recentTransitions", "Recent Transitions");

        IReadOnlyList<DashboardTransitionRow> transitions = size.IsWide
            ? ProjectTransitions(reading.Transitions, now)
            : Array.Empty<DashboardTransitionRow>();

        return new DashboardStatsDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            Stats: items,
            CompactValue: compactValue,
            CompactLabel: compactLabel,
            CompactAutomationName: compactAutomationName,
            CurrentStateLabel: currentStateLabel,
            FsmStateLabel: fsmBadgeLabel,
            FsmTone: ToneFor(reading.FsmState),
            CurrentStateAutomationName: currentStateAutomationName,
            RecentTransitionsLabel: recentTransitionsLabel,
            RecentTransitions: transitions);
    }

    /// <summary>Map a coarse FSM state to the semantic tone driving its status dot (web state-badge colour).</summary>
    public static StatusKind ToneFor(string? state)
    {
        if (string.IsNullOrWhiteSpace(state))
        {
            return StatusKind.Neutral;
        }

        string s = state.Trim();
        if (Eq(s, "online") || Eq(s, "driving") || Eq(s, "awake") || Eq(s, "active"))
        {
            return StatusKind.Success;
        }

        if (Eq(s, "charging"))
        {
            return StatusKind.Info;
        }

        if (Eq(s, "updating") || Eq(s, "upgrading"))
        {
            return StatusKind.Warning;
        }

        return StatusKind.Neutral;
    }

    /// <summary>Capitalize the first letter of each word (web CSS <c>capitalize</c> on the state label).</summary>
    public static string Capitalize(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return text ?? string.Empty;
        }

        var builder = new StringBuilder(text.Length);
        bool atWordStart = true;
        foreach (char c in text)
        {
            if (char.IsWhiteSpace(c))
            {
                atWordStart = true;
                builder.Append(c);
            }
            else
            {
                builder.Append(atWordStart ? char.ToUpper(c, CultureInfo.CurrentCulture) : c);
                atWordStart = false;
            }
        }

        return builder.ToString();
    }

    private static IReadOnlyList<DashboardTransitionRow> ProjectTransitions(
        IReadOnlyList<StateTransitionItem> transitions,
        DateTimeOffset now)
    {
        int take = Math.Min(MaxTransitions, transitions.Count);
        if (take == 0)
        {
            return Array.Empty<DashboardTransitionRow>();
        }

        var rows = new List<DashboardTransitionRow>(take);
        for (int i = 0; i < take; i++)
        {
            var tr = transitions[i];
            string label = Capitalize(string.IsNullOrWhiteSpace(tr.State) ? EmDash : tr.State!);
            string relative = DateTimeFormatting.Format(tr.StartedAt, DateTimeVariant.Relative, now);
            string automation = string.Format(CultureInfo.CurrentCulture, "{0}, {1}", label, relative);
            rows.Add(new DashboardTransitionRow(label, relative, automation));
        }

        return rows;
    }

    private static string FormatInt(int value) =>
        ScalarFormatters.FormatNumber(value, ScalarFormatters.PrecisionNumber);

    private static string StatAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static bool Eq(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}

/// <summary>
/// Folds the three resolved reads — dashboard stats (load-bearing), FSM vehicle state, and the FSM
/// state timeline — into one combined emission, the native port of the web component's
/// <c>hasData = stats.data != null</c> gate plus its <c>isStale</c> / <c>updatedAt</c> merge across the
/// three queries (<c>stats.isStale || fsm.isStale || timeline.isStale</c>,
/// <c>Math.max(...dataUpdatedAt)</c>). Only the dashboard-stats read decides loaded/empty/error; the FSM
/// and timeline reads contribute the badge / rows and the freshness union, and a failure there degrades
/// silently (state → <c>—</c>, rows → none) exactly as the web's <c>?? '—'</c> / <c>?? []</c> do. Kept
/// pure so the parse-and-merge contract is unit-tested without a network or cache.
/// </summary>
public static class DashboardStatsResultMapper
{
    /// <summary>
    /// Combine the settled <paramref name="stats"/> read with the optional <paramref name="fsm"/> and
    /// <paramref name="timeline"/> reads (null models a query still loading / not started for the
    /// current vehicle — it contributes nothing yet, web parity: neither gates content).
    /// </summary>
    public static RepositoryResult<DashboardStatsReading> Combine(
        RepositoryResult<JsonElement> stats,
        RepositoryResult<JsonElement>? fsm,
        RepositoryResult<JsonElement>? timeline)
    {
        ArgumentNullException.ThrowIfNull(stats);

        // Load-bearing: the dashboard-stats read. A hard failure with nothing cached → the retry surface.
        if (stats.Status == LoadStatus.Error)
        {
            return RepositoryResult<DashboardStatsReading>.Failure(
                stats.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load dashboard stats"));
        }

        var data = stats.Value is { } statsEl ? DashboardStatsData.FromJson(statsEl) : DashboardStatsData.Empty;

        // Web parity: hasData = stats.data != null. An absent / non-object body → the empty surface.
        if (!data.HasData)
        {
            return RepositoryResult<DashboardStatsReading>.Empty(stats.FetchedAt);
        }

        string? fsmState = fsm?.Value is { } fsmEl ? StateTransitionItem.ReadFsmState(fsmEl) : null;
        IReadOnlyList<StateTransitionItem> transitions =
            timeline?.Value is { } timelineEl ? StateTransitionItem.ParseList(timelineEl) : Array.Empty<StateTransitionItem>();

        var reading = new DashboardStatsReading(data, fsmState, transitions);

        bool offline = stats.Status == LoadStatus.Offline;
        bool stale = stats.IsStale || (fsm?.IsStale ?? false) || (timeline?.IsStale ?? false);
        DateTimeOffset updatedAt = Latest(stats.FetchedAt, fsm?.FetchedAt, timeline?.FetchedAt)
            ?? stats.FetchedAt
            ?? DateTimeOffset.UtcNow;

        if (offline)
        {
            return RepositoryResult<DashboardStatsReading>.OfflineCached(
                reading,
                updatedAt,
                stats.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<DashboardStatsReading>.Cached(reading, updatedAt, stale: true);
        }

        return RepositoryResult<DashboardStatsReading>.Loaded(reading, updatedAt);
    }

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b, DateTimeOffset? c)
    {
        DateTimeOffset? best = a;
        if (b is { } bv && (best is null || bv > best))
        {
            best = bv;
        }

        if (c is { } cv && (best is null || cv > best))
        {
            best = cv;
        }

        return best;
    }
}
