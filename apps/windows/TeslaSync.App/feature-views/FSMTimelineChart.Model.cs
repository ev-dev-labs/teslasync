using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>FSMTimelineChart</c> surface — the native union of the
/// states the web component renders (web/src/features/system/components/FSMTimelineChart.tsx). The web source
/// is a pure presentational component: it takes a <c>transitions</c> array plus an <c>hours</c> bucket-sizing
/// hint and performs no fetching, so it renders exactly two branches — the stacked-area timeline when there is
/// at least one transition to bucket, or a friendly empty state when there is none. There is deliberately NO
/// loading / error / stale / offline branch to reproduce here: the parent <c>StateMachineDebuggerPage</c> owns
/// the <c>useFSMTransitions</c> query lifecycle and gates this surface's mounting, exactly as the web page
/// derives <c>timelineTransitions</c> from already-resolved rows and shows its own loading / error chrome while
/// the query is in flight. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum FSMTimelineChartState
{
    /// <summary>Resolved with no transitions (web <c>transitions.length === 0</c>) — the friendly empty state.</summary>
    Empty,

    /// <summary>At least one transition to bucket (web <c>buckets.length &gt; 0</c>) — the stacked-area timeline.</summary>
    Ready,
}

/// <summary>
/// One transition the chart buckets — the native analogue of the two fields the web <c>FSMTimelineChart</c>
/// reads off a web <c>FSMTransition</c> (web/src/types/fsm/ui-types.ts): the grouping key
/// <see cref="FsmName"/> (web <c>tr.fsm_name</c> — the parent overrides it with <c>to_state</c> before passing
/// the array in, but that mapping is the page's responsibility, not this component's) and the raw ISO
/// <see cref="Ts"/> timestamp (web <c>tr.ts</c>, fed to <c>new Date(tr.ts).getTime()</c>). The other
/// <c>FSMTransition</c> fields (<c>id</c>, <c>vehicle_id</c>, <c>from_state</c>, <c>trigger</c>, <c>details</c>)
/// are intentionally absent — the chart never reads them. Pure data — no WinUI types.
/// </summary>
/// <param name="FsmName">The transition's grouping key (web <c>tr.fsm_name</c>); empty string is a valid key.</param>
/// <param name="Ts">The raw ISO transition timestamp, or null (web <c>tr.ts</c>); an unparseable value is dropped.</param>
public sealed record FSMTimelineTransition(string FsmName, string? Ts);

/// <summary>
/// The render-time data model the <c>FSMTimelineChart</c> view binds to — the native analogue of the web
/// component's three props (<c>transitions</c>, <c>hours</c>, <c>emptyMessage</c>). The component is
/// presentational, so this model carries only the inputs the parent supplies; user-facing labels are resolved
/// from the i18n facade by the projection, not passed in (the sole exception is
/// <see cref="EmptyMessageOverride"/>, the web optional <c>emptyMessage</c> prop the parent threads through).
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Transitions">The transitions to bucket (any order; the projection buckets and sorts).</param>
/// <param name="Hours">The time window in hours that sizes the buckets (web <c>hours</c>).</param>
/// <param name="EmptyMessageOverride">The web optional <c>emptyMessage</c> prop; when null the projection falls back to the localized <c>fsm.noTimelineData</c> string.</param>
public sealed record FSMTimelineChartModel(
    IReadOnlyList<FSMTimelineTransition> Transitions,
    int Hours,
    string? EmptyMessageOverride = null)
{
    /// <summary>A resolved model with no transitions — the empty state.</summary>
    public static FSMTimelineChartModel Empty { get; } = new(Array.Empty<FSMTimelineTransition>(), 0);
}

/// <summary>
/// One time bucket of the stacked timeline — the native analogue of a single web <c>TimelineBucket</c>
/// (<c>{ time, [fsmType]: count }</c>). <see cref="TimeLabel"/> is the bucket's <c>HH:mm</c> clock label (web
/// <c>String(d.getHours()).padStart(2,'0') + ':' + …getMinutes()…</c>, in local time); <see cref="Counts"/>
/// holds the per-FSM-type transition counts positionally aligned with
/// <see cref="FSMTimelineChartDisplay.FsmTypes"/> (a zero where a type had no transition in this bucket, exactly
/// like the web pre-seeded <c>record[type] = 0</c>); <see cref="Total"/> is their sum (the bucket's stack
/// height); and <see cref="AutomationName"/> is a spoken summary of the bucket. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="TimeLabel">The bucket's local <c>HH:mm</c> clock label.</param>
/// <param name="Counts">Per-type transition counts, aligned with <see cref="FSMTimelineChartDisplay.FsmTypes"/>.</param>
/// <param name="Total">Sum of <see cref="Counts"/> — the bucket's stacked height.</param>
/// <param name="AutomationName">Spoken summary of the bucket (time + each present type and its count).</param>
public sealed record FSMTimelineBucket(
    string TimeLabel,
    IReadOnlyList<long> Counts,
    long Total,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the chart for one input model — the native analogue of everything
/// the web <c>FSMTimelineChart</c> computes in its <c>useMemo</c> before returning its <c>ChartContainer</c>.
/// Holds the active <see cref="State"/>, the sorted <see cref="FsmTypes"/> (the stacked series, bottom-to-top)
/// with their categorical palette <see cref="SeriesColorIndices"/>, the chronological <see cref="Buckets"/>,
/// the <see cref="MaxTotal"/> stack height (the Y domain max), the resolved title / aria-label / empty message,
/// and a spoken <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record FSMTimelineChartDisplay(
    FSMTimelineChartState State,
    IReadOnlyList<string> FsmTypes,
    IReadOnlyList<int> SeriesColorIndices,
    IReadOnlyList<FSMTimelineBucket> Buckets,
    long MaxTotal,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="FSMTimelineChartModel"/> to its <see cref="FSMTimelineChartDisplay"/> — the
/// native port of the <c>useMemo</c> bucketing in web/src/features/system/components/FSMTimelineChart.tsx. It
/// reproduces the web algorithm exactly: the bucket size is chosen from the window
/// (<see cref="BucketSizeMs"/>: ≤6h → 10 min, ≤24h → 30 min, else 2 h); the half-open window is
/// <c>[now - hours·3 600 000, now]</c>; every bucket is keyed by <c>floor(ts / bucketMs)·bucketMs</c> and
/// pre-seeded with a zero for each FSM type; each transition increments its bucket's count for its
/// <c>fsm_name</c> (transitions whose timestamp falls outside the window — or won't parse — are dropped, just
/// as <c>bucketMap.get(NaN)</c> yields <c>undefined</c> in the web); FSM types are the sorted distinct
/// <c>fsm_name</c>s across <em>all</em> transitions (so a type whose only transitions fall outside the window
/// still appears as a flat-zero band); and the empty branch is gated on <c>transitions.length === 0</c> (not on
/// whether any transition landed in a bucket). Every label resolves through the i18n facade; the band colors map
/// onto the shared categorical palette (the web <c>CHART_COLORS[i % CHART_COLORS.length]</c>). No WinUI types —
/// unit-tested without a UI host.
/// </summary>
public static class FSMTimelineChartProjection
{
    /// <summary>Bucket size for a ≤6h window (web <c>10 * 60_000</c>) — 10 minutes, in milliseconds.</summary>
    public const long ShortBucketMs = 10L * 60_000L;

    /// <summary>Bucket size for a ≤24h window (web <c>30 * 60_000</c>) — 30 minutes, in milliseconds.</summary>
    public const long MediumBucketMs = 30L * 60_000L;

    /// <summary>Bucket size for a &gt;24h window (web <c>2 * 60 * 60_000</c>) — 2 hours, in milliseconds.</summary>
    public const long LongBucketMs = 2L * 60L * 60_000L;

    /// <summary>The ≤6h boundary that selects the 10-minute bucket (web <c>hours &lt;= 6</c>).</summary>
    public const int ShortRangeHours = 6;

    /// <summary>The ≤24h boundary that selects the 30-minute bucket (web <c>hours &lt;= 24</c>).</summary>
    public const int MediumRangeHours = 24;

    private const long MillisecondsPerHour = 3_600_000L;
    private const string EmDash = "\u2014";

    /// <summary>
    /// Selects the bucket size in milliseconds for a window of <paramref name="hours"/> hours — the native port
    /// of the web ternary <c>hours &lt;= 6 ? 10·60_000 : hours &lt;= 24 ? 30·60_000 : 2·60·60_000</c>.
    /// </summary>
    /// <param name="hours">The time window in hours (the web <c>hours</c> prop).</param>
    public static long BucketSizeMs(int hours) =>
        hours <= ShortRangeHours ? ShortBucketMs : hours <= MediumRangeHours ? MediumBucketMs : LongBucketMs;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and clock.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant the window is measured back from (web <c>Date.now()</c>); its offset formats the local <c>HH:mm</c> bucket labels.</param>
    public static FSMTimelineChartDisplay Project(
        FSMTimelineChartModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("fsm.timelineChart", "Transitions Over Time");
        string aria = localizer.GetString("fsm.timelineChart.aria", "FSM transitions over time stacked area chart");
        string emptyMessage = model.EmptyMessageOverride
            ?? localizer.GetString("fsm.noTimelineData", "No transition data for timeline");

        // Web parity: `if (transitions.length === 0) return { buckets: [], fsmTypes: [] }` — the empty branch is
        // gated purely on the input count, before any bucketing or timestamp parsing.
        if (model.Transitions.Count == 0)
        {
            return new FSMTimelineChartDisplay(
                State: FSMTimelineChartState.Empty,
                FsmTypes: Array.Empty<string>(),
                SeriesColorIndices: Array.Empty<int>(),
                Buckets: Array.Empty<FSMTimelineBucket>(),
                MaxTotal: 0,
                Title: title,
                AriaLabel: aria,
                EmptyMessage: emptyMessage,
                AutomationName: $"{title}. {emptyMessage}");
        }

        string[] types = SortedTypes(model.Transitions);
        var typeIndex = new Dictionary<string, int>(types.Length, StringComparer.Ordinal);
        for (int i = 0; i < types.Length; i++)
        {
            typeIndex[types[i]] = i;
        }

        FSMTimelineBucket[] buckets = BuildBuckets(model, now, types, typeIndex, localizer, out long maxTotal);

        var colorIndices = new int[types.Length];
        for (int i = 0; i < colorIndices.Length; i++)
        {
            colorIndices[i] = i;
        }

        return new FSMTimelineChartDisplay(
            State: FSMTimelineChartState.Ready,
            FsmTypes: types,
            SeriesColorIndices: colorIndices,
            Buckets: buckets,
            MaxTotal: maxTotal,
            Title: title,
            AriaLabel: aria,
            EmptyMessage: emptyMessage,
            AutomationName: $"{title}. {aria}");
    }

    // Web parity: `Array.from(new Set(transitions.map(t => t.fsm_name))).sort()`. JS default sort orders by
    // UTF-16 code unit, which StringComparer.Ordinal reproduces for the FSM state names in play.
    private static string[] SortedTypes(IReadOnlyList<FSMTimelineTransition> transitions)
    {
        var set = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var tr in transitions)
        {
            set.Add(tr.FsmName ?? string.Empty);
        }

        var ordered = new string[set.Count];
        set.CopyTo(ordered);
        return ordered;
    }

    private static FSMTimelineBucket[] BuildBuckets(
        FSMTimelineChartModel model,
        DateTimeOffset now,
        string[] types,
        Dictionary<string, int> typeIndex,
        ILocalizer localizer,
        out long maxTotal)
    {
        long bucketMs = BucketSizeMs(model.Hours);
        long nowMs = now.ToUnixTimeMilliseconds();
        long startMs = nowMs - ((long)model.Hours * MillisecondsPerHour);
        TimeSpan offset = now.Offset;

        // Web parity: seed one bucket per aligned step across [start, now]; each carries a zero for every type.
        var keyToIndex = new Dictionary<long, int>();
        var keys = new List<long>();
        for (long ts = startMs; ts <= nowMs; ts += bucketMs)
        {
            long key = FloorDiv(ts, bucketMs) * bucketMs;
            if (!keyToIndex.ContainsKey(key))
            {
                keyToIndex[key] = keys.Count;
                keys.Add(key);
            }
        }

        var counts = new long[keys.Count][];
        for (int i = 0; i < counts.Length; i++)
        {
            counts[i] = new long[types.Length];
        }

        // Web parity: a transition lands in its bucket only when that bucket exists (in-window) and its
        // timestamp parses; otherwise it is silently dropped (the web `bucketMap.get(key)` miss / NaN key).
        foreach (var tr in model.Transitions)
        {
            if (!TryParseUnixMs(tr.Ts, out long tsMs))
            {
                continue;
            }

            long key = FloorDiv(tsMs, bucketMs) * bucketMs;
            if (keyToIndex.TryGetValue(key, out int bucket))
            {
                counts[bucket][typeIndex[tr.FsmName ?? string.Empty]]++;
            }
        }

        maxTotal = 0;
        var result = new FSMTimelineBucket[keys.Count];
        for (int b = 0; b < keys.Count; b++)
        {
            long total = 0;
            foreach (long c in counts[b])
            {
                total += c;
            }

            if (total > maxTotal)
            {
                maxTotal = total;
            }

            string label = FormatTimeLabel(keys[b], offset);
            result[b] = new FSMTimelineBucket(
                TimeLabel: label,
                Counts: counts[b],
                Total: total,
                AutomationName: BucketAutomationName(label, counts[b], types, total, localizer));
        }

        return result;
    }

    // Web parity: time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` —
    // the bucket's local-time clock. The key is an epoch-aligned instant; `offset` localizes it deterministically.
    private static string FormatTimeLabel(long unixMs, TimeSpan offset)
    {
        var local = DateTimeOffset.FromUnixTimeMilliseconds(unixMs).ToOffset(offset);
        return local.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    private static string BucketAutomationName(
        string label,
        long[] counts,
        string[] types,
        long total,
        ILocalizer localizer)
    {
        if (total == 0)
        {
            return string.Format(
                CultureInfo.CurrentCulture,
                "{0}: {1}",
                label,
                localizer.GetString("fsm.timelineChart.noTransitions", "No transitions"));
        }

        var parts = new List<string>(types.Length);
        for (int i = 0; i < types.Length; i++)
        {
            if (counts[i] <= 0)
            {
                continue;
            }

            string name = string.IsNullOrEmpty(types[i]) ? EmDash : types[i];
            parts.Add(string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                name,
                ScalarFormatters.FormatNumber(counts[i], 0)));
        }

        return string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, string.Join(", ", parts));
    }

    // Web parity: `new Date(tr.ts).getTime()`. A null / empty / unparseable value yields NaN in the web, which
    // never matches a bucket key; here it returns false so the transition is dropped.
    private static bool TryParseUnixMs(string? ts, out long unixMs)
    {
        if (!string.IsNullOrWhiteSpace(ts)
            && DateTimeOffset.TryParse(ts, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dto))
        {
            unixMs = dto.ToUnixTimeMilliseconds();
            return true;
        }

        unixMs = 0;
        return false;
    }

    // Floor division that matches JS `Math.floor(a / b)` for any sign (long `/` truncates toward zero).
    private static long FloorDiv(long a, long b)
    {
        long q = a / b;
        if (a % b != 0 && (a < 0) != (b < 0))
        {
            q--;
        }

        return q;
    }
}

/// <summary>
/// Canonical metadata for the <c>FSMTimelineChart</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/system/components/FSMTimelineChart.tsx</c>.
/// </summary>
public static class FSMTimelineChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FSMTimelineChart";
}

/// <summary>
/// PII-safe diagnostics for the <c>FSMTimelineChart</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an FSM name, transition count, timestamp,
/// VIN or vehicle id — so a diagnostics line can never leak a vehicle's state-machine activity. Thread-safe.
/// </summary>
public sealed class FSMTimelineChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Receives the formatted <c>view.opened</c> line; <see langword="null"/> to only count.</param>
    public FSMTimelineChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FSMTimelineChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FSMTimelineChartRegistration.Slug}");
    }
}
