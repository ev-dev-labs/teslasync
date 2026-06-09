using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="StateTimelineViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>StateTimelineWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/StateTimelineWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData = segments.length &gt; 0</c>
/// gate (a resolved state summary whose minutes sum to zero) rather than an absent HTTP body — and is the
/// surface the deprecated, Phase-42-retired <c>/vehicle-states/summary</c> route degrades to in practice.
/// </summary>
public enum StateTimelineState
{
    /// <summary>Initial fetch with no cached summary — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh summary from the network (or non-stale cache) carrying at least one minute of state.</summary>
    Loaded,

    /// <summary>The summary resolved with zero total minutes — render the friendly empty state.</summary>
    Empty,

    /// <summary>The load-bearing summary request failed and no cached value exists — the retry affordance.</summary>
    Error,

    /// <summary>A cached summary older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached summary remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One state-distribution row from <c>GET /vehicle-states/summary</c> (web <c>useStateSummary</c>, shape
/// <c>StateSummary</c> in web/src/types/analytics.ts): the coarse state plus the total minutes spent in it
/// and the number of distinct intervals. The web reads the camelCase projection
/// (<c>camelCaseKeys</c> exposes both forms), so parsing reads the snake_case wire key first
/// (<c>total_min</c>) and falls back to camelCase (<c>totalMin</c>); it is null-tolerant so a partial row
/// never throws.
/// </summary>
public sealed record StateSummaryEntry(string State, double TotalMinutes, int Count)
{
    private const string EmDash = "\u2014";

    /// <summary>Parse a <c>GET /vehicle-states/summary</c> array body into tolerant rows.</summary>
    public static IReadOnlyList<StateSummaryEntry> ParseList(JsonElement element)
    {
        var array = UnwrapArray(element);
        if (array is not { ValueKind: JsonValueKind.Array } arr)
        {
            return Array.Empty<StateSummaryEntry>();
        }

        var rows = new List<StateSummaryEntry>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                rows.Add(FromJson(item));
            }
        }

        return rows;
    }

    /// <summary>Project a single state-summary JSON object into a tolerant entry.</summary>
    public static StateSummaryEntry FromJson(JsonElement obj) => new(
        State: JsonReaders.GetString(obj, "state") ?? EmDash,
        TotalMinutes: JsonReaders.GetDouble(obj, "total_min", "totalMin") ?? 0,
        Count: (int)Math.Round(JsonReaders.GetDouble(obj, "count") ?? 0, MidpointRounding.AwayFromZero));

    // The summary handler served a bare array; tolerate a `{ "summary": [...] }` / `{ "states": [...] }`
    // envelope too so a contract tweak never silently empties the surface.
    private static JsonElement? UnwrapArray(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return element;
        }

        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("summary", out var summary) && summary.ValueKind == JsonValueKind.Array)
            {
                return summary;
            }

            if (element.TryGetProperty("states", out var states) && states.ValueKind == JsonValueKind.Array)
            {
                return states;
            }
        }

        return null;
    }
}

/// <summary>
/// One 24-hour timeline transition from <c>GET /vehicle-states/timeline</c> (web <c>useTimeline</c>, shape
/// <c>TimelineEvent</c> in web/src/types/analytics.ts): the state entered, when, and for how long. The
/// route was retired in Phase-42 (the hook is <c>@deprecated</c> and the endpoint 404s), so this list is
/// virtually always empty in practice — but the surface reproduces the web's wide-footprint "24h Timeline"
/// stripe faithfully when rows are present. Parsing reads the snake_case wire key first
/// (<c>duration_min</c>) and falls back to camelCase (<c>durationMin</c>).
/// </summary>
public sealed record StateTimelineTransition(string State, string? StartDate, double DurationMinutes)
{
    private const string EmDash = "\u2014";

    /// <summary>Parse a <c>GET /vehicle-states/timeline</c> <c>{ transitions: [...] }</c> body into tolerant rows.</summary>
    public static IReadOnlyList<StateTimelineTransition> ParseList(JsonElement element)
    {
        var array = UnwrapArray(element);
        if (array is not { ValueKind: JsonValueKind.Array } arr)
        {
            return Array.Empty<StateTimelineTransition>();
        }

        var rows = new List<StateTimelineTransition>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                rows.Add(FromJson(item));
            }
        }

        return rows;
    }

    /// <summary>Project a single transition JSON object into a tolerant row.</summary>
    public static StateTimelineTransition FromJson(JsonElement obj) => new(
        State: JsonReaders.GetString(obj, "state") ?? EmDash,
        StartDate: JsonReaders.GetString(obj, "start_date", "startDate"),
        DurationMinutes: JsonReaders.GetDouble(obj, "duration_min", "durationMin") ?? 0);

    // Web parity: the timeline body is `{ transitions: [...] }`; a bare array is tolerated for resilience.
    private static JsonElement? UnwrapArray(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return element;
        }

        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty("transitions", out var transitions) &&
            transitions.ValueKind == JsonValueKind.Array)
        {
            return transitions;
        }

        return null;
    }
}

/// <summary>Shared tolerant JSON readers for the state-timeline parse adapters (snake_case first, camelCase fallback).</summary>
internal static class JsonReaders
{
    public static string? GetString(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
        }

        return null;
    }

    public static double? GetDouble(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (!obj.TryGetProperty(name, out var v))
            {
                continue;
            }

            switch (v.ValueKind)
            {
                case JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n):
                    return n;
                case JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n):
                    return n;
            }
        }

        return null;
    }
}

/// <summary>
/// The merged read-model the widget consumes: the load-bearing state-distribution summary plus the
/// enrichment 24-hour transition timeline. Mirrors the web component's two-hook composition
/// (<c>useStateSummary</c> + <c>useTimeline</c>) — the summary decides whether there is anything to chart,
/// the timeline only feeds the wide-footprint stripe. Pure data so the projection is unit-tested without a
/// UI host.
/// </summary>
public sealed record StateTimelineReading(
    IReadOnlyList<StateSummaryEntry> Summary,
    IReadOnlyList<StateTimelineTransition> Transitions)
{
    /// <summary>An empty reading — the parse fallback for an absent/non-array summary body.</summary>
    public static StateTimelineReading Empty { get; } =
        new(Array.Empty<StateSummaryEntry>(), Array.Empty<StateTimelineTransition>());

    /// <summary>
    /// True when the summary holds at least one minute of recorded state (web <c>segments.length &gt; 0</c>,
    /// which collapses an all-zero summary to the empty surface). Gates the empty state.
    /// </summary>
    public bool HasData => Summary.Sum(s => s.TotalMinutes > 0 ? s.TotalMinutes : 0) > 0;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in
/// web/src/features/dashboard/widgets/StateTimelineWidget.tsx (<c>isCompact = size.cols &lt;= 1</c>,
/// <c>isWide = size.cols &gt;= 3</c>).
/// </summary>
public readonly record struct StateTimelineSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static StateTimelineSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the stacked bar + legend dots.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): add the 24-hour timeline stripe.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// Maps a coarse vehicle state to its theme-aware design-token brush key — the native, light/dark/
/// high-contrast-safe analogue of the web component's local <c>STATE_COLORS</c> hex map
/// (driving cyan, charging green, asleep purple, idle amber, offline red, otherwise muted grey). Pure and
/// case-insensitive so the projection is unit-tested without a XAML runtime.
/// </summary>
public static class StateTimelineColors
{
    /// <summary>Token brush key for the default / unknown state (web <c>#6b7280</c>).</summary>
    public const string DefaultKey = "TsColorTextMutedBrush";

    /// <summary>Resolve the token brush key for <paramref name="state"/> (case-insensitive).</summary>
    public static string KeyFor(string? state) => (state ?? string.Empty).Trim().ToLowerInvariant() switch
    {
        "driving" => "TsColorInfoBrush",      // web #22d3ee cyan
        "charging" => "TsColorSuccessBrush",  // web #22c55e green
        "asleep" => "TsChart07Brush",         // web #a855f7 purple
        "idle" => "TsColorWarningBrush",      // web #f59e0b amber
        "offline" => "TsColorDangerBrush",    // web #ef4444 red
        _ => DefaultKey,
    };
}

/// <summary>
/// One projected, display-ready state segment consumed by the WinUI view — the native analogue of a web
/// <c>StateSegment</c> plus its rendered <c>StateRow</c> / legend chip. Holds the resolved token brush key,
/// the percentage (for the bar width) and its two formatted forms (1-decimal for the list badge, integer
/// for the compact legend, matching web <c>fmtNumber</c> / <c>fmtInt</c>), the localized + capitalized
/// label, the formatted duration, and Narrator automation names. Pure data — no WinUI types.
/// </summary>
public sealed record StateTimelineSegment(
    string StateRaw,
    string Label,
    string ColorKey,
    double Percent,
    string PercentText,
    string PercentTextCompact,
    string DurationText,
    string BarAutomationName,
    string RowAutomationName,
    string LegendAutomationName);

/// <summary>
/// One projected segment of the wide-footprint 24-hour stripe — the native analogue of a web
/// <c>TimelineStripe</c> cell. Holds the token brush key, the percentage width, and a Narrator automation
/// name describing the state + its duration. Pure data — no WinUI types.
/// </summary>
public sealed record StateTimelineStripeSegment(string ColorKey, double Percent, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the state timeline for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the stacked-bar /
/// list segments, the capped compact legend, and the wide timeline stripe, plus the footprint flags. Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record StateTimelineDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasData,
    IReadOnlyList<StateTimelineSegment> Segments,
    IReadOnlyList<StateTimelineSegment> LegendSegments,
    bool HasStripe,
    IReadOnlyList<StateTimelineStripeSegment> Stripe,
    string TimelineLabel);

/// <summary>
/// Pure projection from a raw <see cref="StateTimelineReading"/> to the display model — the native port of
/// the <c>buildSegments</c> / <c>StackedBar</c> / <c>StateRow</c> / <c>TimelineStripe</c> logic in
/// web/src/features/dashboard/widgets/StateTimelineWidget.tsx. Percentages and durations are computed
/// exactly as the web does; every label resolves through the i18n facade.
/// </summary>
public static class StateTimelineProjection
{
    /// <summary>Fluent glyph for the surface header / empty state (web <c>Clock</c>).</summary>
    public const string HeaderGlyph = "\uE823"; // Segoe Fluent — Clock

    /// <summary>Web parity: the compact legend shows at most the five leading segments (<c>slice(0, 5)</c>).</summary>
    public const int MaxLegend = 5;

    /// <summary>Web parity: a stripe cell narrower than this percentage is dropped (<c>if (pct &lt; 0.5) return null</c>).</summary>
    public const double MinStripePercent = 0.5;

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static StateTimelineDisplay Project(
        StateTimelineReading reading,
        StateTimelineSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var segments = BuildSegments(reading.Summary, localizer);
        var legend = segments.Count > MaxLegend ? segments.Take(MaxLegend).ToList() : segments;
        var stripe = BuildStripe(reading.Transitions, localizer);

        return new StateTimelineDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: segments.Count > 0,
            Segments: segments,
            LegendSegments: legend,
            HasStripe: stripe.Count > 0,
            Stripe: stripe,
            TimelineLabel: localizer.GetString("widget.stateTimeline.timeline", "24h Timeline"));
    }

    /// <summary>
    /// Build the proportional state segments — the native port of the web <c>buildSegments</c>: when the
    /// total minutes are zero the list is empty (gating the empty state); otherwise every entry yields a
    /// segment whose percentage is its share of the total.
    /// </summary>
    public static IReadOnlyList<StateTimelineSegment> BuildSegments(
        IReadOnlyList<StateSummaryEntry> entries,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(localizer);

        double total = entries.Sum(e => e.TotalMinutes > 0 ? e.TotalMinutes : 0);
        if (total <= 0)
        {
            return Array.Empty<StateTimelineSegment>();
        }

        var segments = new List<StateTimelineSegment>(entries.Count);
        foreach (var entry in entries)
        {
            string raw = string.IsNullOrWhiteSpace(entry.State) ? EmDash : entry.State;
            double minutes = entry.TotalMinutes > 0 ? entry.TotalMinutes : 0;
            double pct = minutes / total * 100.0;

            string label = StateLabel(localizer, raw);
            string pctText = $"{ScalarFormatters.FormatNumber(pct, 1)}%";
            string pctCompact = $"{ScalarFormatters.FormatNumber(pct, 0)}%";
            string durationText = FormatDuration(entry.TotalMinutes, localizer);

            segments.Add(new StateTimelineSegment(
                StateRaw: raw,
                Label: label,
                ColorKey: StateTimelineColors.KeyFor(raw),
                Percent: pct,
                PercentText: pctText,
                PercentTextCompact: pctCompact,
                DurationText: durationText,
                BarAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, pctText),
                RowAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, durationText, pctText),
                LegendAutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, pctCompact)));
        }

        return segments;
    }

    /// <summary>
    /// Build the wide-footprint 24-hour stripe — the native port of the web <c>TimelineStripe</c>: returns
    /// nothing when the transitions carry no duration, and drops any cell narrower than
    /// <see cref="MinStripePercent"/>.
    /// </summary>
    public static IReadOnlyList<StateTimelineStripeSegment> BuildStripe(
        IReadOnlyList<StateTimelineTransition> transitions,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(transitions);
        ArgumentNullException.ThrowIfNull(localizer);

        double total = transitions.Sum(t => t.DurationMinutes > 0 ? t.DurationMinutes : 0);
        if (total <= 0)
        {
            return Array.Empty<StateTimelineStripeSegment>();
        }

        var stripe = new List<StateTimelineStripeSegment>(transitions.Count);
        foreach (var tr in transitions)
        {
            double minutes = tr.DurationMinutes > 0 ? tr.DurationMinutes : 0;
            double pct = minutes / total * 100.0;
            if (pct < MinStripePercent)
            {
                continue;
            }

            string raw = string.IsNullOrWhiteSpace(tr.State) ? EmDash : tr.State;
            string label = StateLabel(localizer, raw);
            string automation = string.Format(
                CultureInfo.CurrentCulture, "{0}: {1}", label, FormatDuration(tr.DurationMinutes, localizer));
            stripe.Add(new StateTimelineStripeSegment(StateTimelineColors.KeyFor(raw), pct, automation));
        }

        return stripe;
    }

    /// <summary>
    /// Format a minutes total as the web <c>fmtDuration</c> does: "<c>45m</c>" under an hour, otherwise
    /// "<c>2h 30m</c>", with the unit suffixes resolved through the i18n facade
    /// (<c>widget.stateTimeline.hr</c> / <c>widget.stateTimeline.min</c>).
    /// </summary>
    public static string FormatDuration(double totalMinutes, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        double safe = totalMinutes > 0 && !double.IsNaN(totalMinutes) && !double.IsInfinity(totalMinutes)
            ? totalMinutes
            : 0;
        long hrs = (long)Math.Floor(safe / 60.0);
        long mins = (long)Math.Round(safe % 60.0, MidpointRounding.AwayFromZero);
        if (mins == 60)
        {
            hrs += 1;
            mins = 0;
        }

        string hrSuffix = localizer.GetString("widget.stateTimeline.hr", "h");
        string minSuffix = localizer.GetString("widget.stateTimeline.min", "m");
        return hrs == 0
            ? string.Format(CultureInfo.CurrentCulture, "{0}{1}", mins, minSuffix)
            : string.Format(CultureInfo.CurrentCulture, "{0}{1} {2}{3}", hrs, hrSuffix, mins, minSuffix);
    }

    /// <summary>
    /// Resolve the localized, capitalized state label (web <c>t(`widget.stateTimeline.state.${state}`,
    /// state)</c> rendered with the CSS <c>capitalize</c> class).
    /// </summary>
    public static string StateLabel(ILocalizer localizer, string state)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string raw = string.IsNullOrWhiteSpace(state) ? EmDash : state;
        string resolved = localizer.GetString($"widget.stateTimeline.state.{raw.ToLowerInvariant()}", raw);
        return Capitalize(resolved);
    }

    /// <summary>Capitalize the first letter of each word (the web CSS <c>capitalize</c> on the state label).</summary>
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
}

/// <summary>
/// Folds the two resolved reads — the load-bearing state-distribution summary and the enrichment 24-hour
/// timeline — into one combined emission, the native port of the web component's two-hook composition.
/// Only the summary decides loaded / empty / error (web <c>hasData = segments.length &gt; 0</c>); the
/// timeline merely feeds the wide stripe and contributes to the freshness union
/// (<c>isStale = summary.isStale || timeline.isStale</c>, <c>updatedAt = max(...dataUpdatedAt)</c>), and a
/// failed timeline degrades silently (no stripe) exactly as the web's <c>?? []</c> does. Kept pure so the
/// parse-and-merge contract is unit-tested without a network or cache.
/// </summary>
public static class StateTimelineResultMapper
{
    /// <summary>
    /// Combine the settled load-bearing <paramref name="summary"/> read with the optional
    /// <paramref name="timeline"/> read (null models the timeline still loading / not started for the
    /// current vehicle — it contributes nothing yet, web parity: it never gates content).
    /// </summary>
    public static RepositoryResult<StateTimelineReading> Combine(
        RepositoryResult<JsonElement> summary,
        RepositoryResult<JsonElement>? timeline)
    {
        ArgumentNullException.ThrowIfNull(summary);

        // Load-bearing: the state-distribution read. A hard failure with nothing cached → the retry surface.
        if (summary.Status == LoadStatus.Error)
        {
            return RepositoryResult<StateTimelineReading>.Failure(
                summary.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load state timeline"));
        }

        IReadOnlyList<StateSummaryEntry> entries =
            summary.Value is { } summaryEl ? StateSummaryEntry.ParseList(summaryEl) : Array.Empty<StateSummaryEntry>();
        IReadOnlyList<StateTimelineTransition> transitions =
            timeline?.Value is { } timelineEl ? StateTimelineTransition.ParseList(timelineEl) : Array.Empty<StateTimelineTransition>();

        var reading = new StateTimelineReading(entries, transitions);

        // Web parity: hasData = segments.length > 0. An all-zero (or absent) summary → the empty surface.
        if (!reading.HasData)
        {
            return RepositoryResult<StateTimelineReading>.Empty(summary.FetchedAt);
        }

        bool offline = summary.Status == LoadStatus.Offline;
        bool stale = summary.IsStale || (timeline?.IsStale ?? false);
        DateTimeOffset updatedAt = Latest(summary.FetchedAt, timeline?.FetchedAt)
            ?? summary.FetchedAt
            ?? DateTimeOffset.UtcNow;

        if (offline)
        {
            return RepositoryResult<StateTimelineReading>.OfflineCached(
                reading,
                updatedAt,
                summary.Error ?? new RepositoryError(RepositoryErrorKind.Network, "A live read is unavailable"));
        }

        if (stale)
        {
            return RepositoryResult<StateTimelineReading>.Cached(reading, updatedAt, stale: true);
        }

        return RepositoryResult<StateTimelineReading>.Loaded(reading, updatedAt);
    }

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return b > a ? b : a;
    }
}
