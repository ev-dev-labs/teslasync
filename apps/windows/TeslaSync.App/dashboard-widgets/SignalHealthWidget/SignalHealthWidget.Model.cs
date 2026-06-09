using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SignalHealthViewModel"/> can be in — the native union of the loading /
/// loaded / empty / error / stale / offline branches the web <c>SignalHealthWidget</c> renders through
/// <c>WidgetShell</c> (web/src/features/dashboard/widgets/SignalHealthWidget.tsx). The widget composes three
/// reads (signal stats, available signal names, live signal map); the freshness chrome is driven by the stats
/// query exactly like the web (<c>updatedAt=statsUpdatedAt</c>, <c>isFetching=statsFetching</c>,
/// <c>isStale=statsStale</c>, <c>isError=statsError</c>). <see cref="Empty"/> mirrors the web <c>!hasData</c>
/// gate — none of the three reads carried a value — the "No signal health data" surface.
/// </summary>
public enum SignalHealthState
{
    /// <summary>Initial fetch with no content from any read — render the skeleton chrome.</summary>
    Loading,

    /// <summary>At least one read resolved with a value and the stats freshness is current — render the body.</summary>
    Loaded,

    /// <summary>No read carried a value (web <c>!hasData</c>) — render the "No signal health data" surface.</summary>
    Empty,

    /// <summary>The stats read failed and nothing is renderable — render the retry affordance.</summary>
    Error,

    /// <summary>The shown body is backed by a stats read older than the freshness window — body plus a stale chip.</summary>
    Stale,

    /// <summary>The stats read is offline but cached content remains — body plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in web/src/features/dashboard/widgets/SignalHealthWidget.tsx
/// (<c>isCompact = size.cols &lt;= 1</c>, <c>isWide = size.cols &gt;= 3</c>).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct SignalHealthSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SignalHealthSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): the badge + big total stack.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide</c>): also render the stale / gap signal list.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One entry in the live-signal map returned by <c>GET /signals/{vehicleID}/live</c> (the web
/// <c>useSignalGaps</c> read, which keeps only <c>res.signals</c>). The widget consumes only the
/// <see cref="Timestamp"/> — the instant the signal was last observed — so a missing / null / unparseable
/// timestamp collapses to <see langword="null"/>, reproducing the web <c>entry?.timestamp ?? null</c> branch
/// that classifies the signal as a gap with no last-seen time.
/// </summary>
/// <param name="Timestamp">The signal's last-observed instant, or null when absent / unparseable.</param>
public sealed record SignalGapEntry(DateTimeOffset? Timestamp);

/// <summary>
/// The three reads merged into one value — the native analogue of the web component's <c>stats</c> /
/// <c>signals</c> / <c>gapData</c> hook results
/// (web/src/features/dashboard/widgets/SignalHealthWidget.tsx). <see cref="Signals"/> and <see cref="Gaps"/>
/// are <see langword="null"/> only when their read carried no usable body (loading / failed); a successful
/// empty response surfaces as an empty (non-null) list / map so it still counts as data, exactly like the web
/// where <c>[]</c> and <c>{}</c> are truthy. <see cref="HasStats"/> records that the stats read returned an
/// object. <see cref="HasAny"/> reproduces the web <c>hasData = stats || signals || gapData</c> gate.
/// </summary>
/// <param name="HasStats">True when the signal-stats read returned an object body (web <c>stats</c> truthy).</param>
/// <param name="Signals">The available signal names (web <c>signals</c>), or null when the read carried nothing.</param>
/// <param name="Gaps">The live signal map keyed by name (web <c>gapData</c>), or null when the read carried nothing.</param>
public sealed record SignalHealthReading(
    bool HasStats,
    IReadOnlyList<string>? Signals,
    IReadOnlyDictionary<string, SignalGapEntry>? Gaps)
{
    /// <summary>True when at least one read carried a value (web <c>hasData</c>).</summary>
    public bool HasAny => HasStats || Signals is not null || Gaps is not null;

    /// <summary>
    /// Project a <c>GET /signals/{vehicleID}/available</c> response into the flat list of signal names — the
    /// native port of the web <c>useSignals</c> reducer: accepts <c>{ signals: [...] }</c> or a bare array,
    /// keeps bare string entries and the <c>name</c> field of object entries, and drops anything malformed. A
    /// non-array / non-object body yields <see langword="null"/> (the read carried nothing).
    /// </summary>
    public static IReadOnlyList<string>? ParseSignals(JsonElement root)
    {
        JsonElement array;
        if (root.ValueKind == JsonValueKind.Array)
        {
            array = root;
        }
        else if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("signals", out var inner) && inner.ValueKind == JsonValueKind.Array)
        {
            array = inner;
        }
        else
        {
            return null;
        }

        var names = new List<string>(array.GetArrayLength());
        foreach (var entry in array.EnumerateArray())
        {
            if (entry.ValueKind == JsonValueKind.String)
            {
                string? bare = entry.GetString();
                if (!string.IsNullOrEmpty(bare))
                {
                    names.Add(bare);
                }
            }
            else if (entry.ValueKind == JsonValueKind.Object &&
                     entry.TryGetProperty("name", out var nameProp) &&
                     nameProp.ValueKind == JsonValueKind.String)
            {
                string? name = nameProp.GetString();
                if (!string.IsNullOrEmpty(name))
                {
                    names.Add(name);
                }
            }
        }

        return names;
    }

    /// <summary>
    /// Project a <c>GET /signals/{vehicleID}/live</c> response into the live-signal map — the native port of
    /// the web <c>useSignalGaps</c> read (<c>res.signals ?? {}</c>). Reads the <c>signals</c> object, keeping
    /// each property's <c>timestamp</c> (parsed as an instant, or null when missing / unparseable). A body
    /// without a <c>signals</c> object yields <see langword="null"/> (the read carried nothing).
    /// </summary>
    public static IReadOnlyDictionary<string, SignalGapEntry>? ParseGaps(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("signals", out var signals) || signals.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var map = new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal);
        foreach (var property in signals.EnumerateObject())
        {
            map[property.Name] = new SignalGapEntry(ReadTimestamp(property.Value));
        }

        return map;
    }

    private static DateTimeOffset? ReadTimestamp(JsonElement entry)
    {
        if (entry.ValueKind != JsonValueKind.Object || !entry.TryGetProperty("timestamp", out var ts) || ts.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? raw = ts.GetString();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One stale / gap signal as classified by the analysis (web <c>gapSignals</c> entry). A
/// <see langword="null"/> <see cref="LastSeen"/> models the web entry whose live <c>timestamp</c> was absent.
/// </summary>
/// <param name="Name">The signal name.</param>
/// <param name="LastSeen">The last-observed instant, or null when the signal never reported a timestamp.</param>
/// <param name="IsStale">Always true — every entry in this list is a gap (stale or never-seen).</param>
public sealed record SignalHealthGap(string Name, DateTimeOffset? LastSeen, bool IsStale);

/// <summary>
/// The pure, unit-free analysis of one merged reading against a clock — the native analogue of the web
/// component's <c>analysis</c> <c>useMemo</c>. Counts the live signals into active vs gap buckets against the
/// five-minute staleness threshold, collects + sorts the gap list, derives the freshness age from the newest
/// live timestamp, and resolves the semantic health tone. Size-independent so the same analysis backs every
/// footprint.
/// </summary>
/// <param name="TotalSignals">Count of available signal names (web <c>totalSignals = signals.length</c>).</param>
/// <param name="ActiveCount">Live signals seen within the freshness window (web <c>activeCount</c>).</param>
/// <param name="StaleCount">Live signals past the window or never timestamped (web <c>staleCount</c>).</param>
/// <param name="GapSignals">The sorted gap list (null-last-seen first, then oldest first; web <c>gapSignals</c>).</param>
/// <param name="FreshnessAgeSeconds">Whole-second age of the newest live signal, or null when none reported.</param>
/// <param name="LatestTimestamp">The newest live timestamp seen, or null.</param>
/// <param name="Health">The semantic health tone (web <c>healthLevel</c> mapped to a status).</param>
public sealed record SignalHealthAnalysis(
    int TotalSignals,
    int ActiveCount,
    int StaleCount,
    IReadOnlyList<SignalHealthGap> GapSignals,
    int? FreshnessAgeSeconds,
    DateTimeOffset? LatestTimestamp,
    StatusKind Health);

/// <summary>One stale / gap list row, projected for the WinUI view (web stale-list entry).</summary>
/// <param name="Name">The signal name.</param>
/// <param name="LastSeenText">The relative last-seen label (web <c>formatRelative(lastSeen)</c>), or the em dash.</param>
public sealed record SignalGapRow(string Name, string LastSeenText);

/// <summary>
/// The fully projected, render-ready view of the signal-health surface for one footprint — the native analogue
/// of everything the web component computes before returning JSX. Pure data so the projection is unit-tested
/// without a UI host; the WinUI view chooses the compact / standard / wide composition from
/// <see cref="IsCompact"/> / <see cref="IsWide"/>.
/// </summary>
/// <param name="HasData">Web <c>hasData</c>; false renders the empty surface instead of the body.</param>
/// <param name="IsCompact">Web <c>isCompact</c> (single column).</param>
/// <param name="IsWide">Web <c>isWide</c> (three or more columns).</param>
/// <param name="TotalSignalsText">Grouped count of available signals (web <c>fmtInt(totalSignals)</c>).</param>
/// <param name="ActiveText">Grouped active count (web <c>fmtInt(activeCount)</c>).</param>
/// <param name="WithGapsText">Grouped gap count (web <c>fmtInt(staleCount)</c>).</param>
/// <param name="FreshnessText">Relative freshness label (web <c>formatAge(freshnessAge)</c>), or the em dash.</param>
/// <param name="HasFreshness">True when a freshness age exists (web <c>freshnessAge != null</c>; compact gate).</param>
/// <param name="Health">The semantic health tone driving the badge / accent colour.</param>
/// <param name="HealthText">The localized health label (Healthy / Degraded / Critical / Unknown).</param>
/// <param name="CompactBadgeText">The compact "active/total live" chip text (web <c>{active}/{active+stale}</c>).</param>
/// <param name="SignalsLabel">The localized lowercase "signals" caption used under the compact total.</param>
/// <param name="StatusLabel">The localized "Status" caption.</param>
/// <param name="StaleSignalsLabel">The localized "Stale / Gap Signals" heading.</param>
/// <param name="TotalSignalsLabel">The localized "Total Signals" stat label.</param>
/// <param name="ActiveLabel">The localized "Active" stat label.</param>
/// <param name="WithGapsLabel">The localized "With Gaps" stat label.</param>
/// <param name="FreshnessLabel">The localized "Freshness" stat label.</param>
/// <param name="GapRows">The stale / gap signal rows (capped to the footprint slice).</param>
/// <param name="HasGapRows">True when there is at least one gap row to render in the wide list.</param>
/// <param name="AutomationName">Narrator summary of the standard body.</param>
/// <param name="CompactAutomationName">Narrator summary of the compact body.</param>
public sealed record SignalHealthDisplay(
    bool HasData,
    bool IsCompact,
    bool IsWide,
    string TotalSignalsText,
    string ActiveText,
    string WithGapsText,
    string FreshnessText,
    bool HasFreshness,
    StatusKind Health,
    string HealthText,
    string CompactBadgeText,
    string SignalsLabel,
    string StatusLabel,
    string StaleSignalsLabel,
    string TotalSignalsLabel,
    string ActiveLabel,
    string WithGapsLabel,
    string FreshnessLabel,
    IReadOnlyList<SignalGapRow> GapRows,
    bool HasGapRows,
    string AutomationName,
    string CompactAutomationName);

/// <summary>
/// Pure projection + analysis for the signal-health surface — the native port of the web component's
/// computation in web/src/features/dashboard/widgets/SignalHealthWidget.tsx. Reproduces the five-minute
/// staleness threshold, the active / gap bucketing, the gap sort, the freshness-age derivation, the
/// health-tone thresholds, the <c>formatAge</c> tiers (seconds / minutes / hours) and the gap-row
/// <c>formatRelative</c> tiers (just now / minutes / hours / days / absolute date). Every label resolves
/// through the i18n facade.
/// </summary>
public static class SignalHealthProjection
{
    /// <summary>Segoe Fluent "Health" glyph — the web title / total <c>Activity</c> icon.</summary>
    public const string ActivityGlyph = "\uE95E";

    /// <summary>Segoe Fluent "Completed" glyph — the web active <c>CheckCircle2</c> icon.</summary>
    public const string ActiveGlyph = "\uE930";

    /// <summary>Segoe Fluent "Warning" glyph — the web gaps <c>AlertTriangle</c> icon.</summary>
    public const string GapsGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "Clock" glyph — the web freshness <c>Clock</c> icon.</summary>
    public const string FreshnessGlyph = "\uE917";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The staleness boundary in seconds (web <c>STALE_THRESHOLD_MS = 5 * 60 * 1000</c>).</summary>
    public const int StaleThresholdSeconds = 5 * 60;

    /// <summary>The gap-list cap in the wide layout (web <c>slice(0, 15)</c>).</summary>
    public const int StandardGapRowCap = 15;

    /// <summary>The gap-list cap in the compact slice (web <c>slice(0, 3)</c>).</summary>
    public const int CompactGapRowCap = 3;

    private static readonly IReadOnlyDictionary<string, SignalGapEntry> EmptyGaps =
        new Dictionary<string, SignalGapEntry>(StringComparer.Ordinal);

    /// <summary>
    /// Compute the analysis from a merged reading against <paramref name="now"/> — the native port of the web
    /// <c>analysis</c> memo. The active / gap split, the gap sort and the freshness age are all derived here so
    /// the projection and the view stay thin.
    /// </summary>
    public static SignalHealthAnalysis Analyze(SignalHealthReading reading, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(reading);

        int totalSignals = reading.Signals?.Count ?? 0;
        var liveEntries = reading.Gaps ?? EmptyGaps;

        int activeCount = 0;
        int staleCount = 0;
        DateTimeOffset? latest = null;
        var gaps = new List<SignalHealthGap>();

        foreach (var (name, entry) in liveEntries)
        {
            if (entry.Timestamp is { } ts)
            {
                double ageSeconds = (now - ts).TotalSeconds;
                if (ageSeconds > StaleThresholdSeconds)
                {
                    staleCount++;
                    gaps.Add(new SignalHealthGap(name, ts, IsStale: true));
                }
                else
                {
                    activeCount++;
                }

                if (latest is null || ts > latest)
                {
                    latest = ts;
                }
            }
            else
            {
                staleCount++;
                gaps.Add(new SignalHealthGap(name, LastSeen: null, IsStale: true));
            }
        }

        // Web sort: null last-seen first, then oldest first, ties broken by name.
        gaps.Sort(static (a, b) =>
        {
            if (a.LastSeen is null && b.LastSeen is null)
            {
                return string.Compare(a.Name, b.Name, StringComparison.Ordinal);
            }

            if (a.LastSeen is null)
            {
                return -1;
            }

            if (b.LastSeen is null)
            {
                return 1;
            }

            return a.LastSeen.Value.CompareTo(b.LastSeen.Value);
        });

        int? freshnessAge = latest is { } latestTs
            ? Math.Max(0, (int)Math.Floor((now - latestTs).TotalSeconds))
            : null;

        return new SignalHealthAnalysis(
            TotalSignals: totalSignals,
            ActiveCount: activeCount,
            StaleCount: staleCount,
            GapSignals: gaps,
            FreshnessAgeSeconds: freshnessAge,
            LatestTimestamp: latest,
            Health: HealthLevel(activeCount, staleCount));
    }

    /// <summary>
    /// Resolve the semantic health tone the way the web does (web <c>healthLevel</c>): neutral when no live
    /// signals were seen, danger at half or more stale, warning when any are stale, success when all are fresh.
    /// </summary>
    public static StatusKind HealthLevel(int activeCount, int staleCount)
    {
        int total = activeCount + staleCount;
        if (total == 0)
        {
            return StatusKind.Neutral;
        }

        double staleRatio = (double)staleCount / total;
        if (staleRatio >= 0.5)
        {
            return StatusKind.Danger;
        }

        return staleRatio > 0 ? StatusKind.Warning : StatusKind.Success;
    }

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> against the clock and localizer.</summary>
    public static SignalHealthDisplay Project(
        SignalHealthReading reading,
        SignalHealthSize size,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var analysis = Analyze(reading, now);

        string totalLabel = localizer.GetString("widget.signalHealth.totalSignals", "Total Signals");
        string activeLabel = localizer.GetString("widget.signalHealth.active", "Active");
        string withGapsLabel = localizer.GetString("widget.signalHealth.withGaps", "With Gaps");
        string freshnessLabel = localizer.GetString("widget.signalHealth.freshness", "Freshness");

        string totalText = FormatInt(analysis.TotalSignals);
        string activeText = FormatInt(analysis.ActiveCount);
        string withGapsText = FormatInt(analysis.StaleCount);
        string freshnessText = FormatAge(analysis.FreshnessAgeSeconds, localizer);
        bool hasFreshness = analysis.FreshnessAgeSeconds is not null;
        string healthText = HealthText(analysis.Health, localizer);
        string compactBadge = string.Create(
            CultureInfo.InvariantCulture,
            $"{analysis.ActiveCount}/{analysis.ActiveCount + analysis.StaleCount}");

        int cap = size.IsCompact ? CompactGapRowCap : StandardGapRowCap;
        var gapRows = new List<SignalGapRow>(Math.Min(cap, analysis.GapSignals.Count));
        for (int i = 0; i < analysis.GapSignals.Count && i < cap; i++)
        {
            var gap = analysis.GapSignals[i];
            gapRows.Add(new SignalGapRow(gap.Name, gap.LastSeen is { } seen ? FormatRelative(seen, now) : EmDash));
        }

        string automation = BuildAutomationName(localizer, totalLabel, totalText, activeLabel, activeText, withGapsLabel, withGapsText, freshnessLabel, freshnessText, healthText);
        string compactAutomation = BuildCompactAutomationName(localizer, compactBadge, totalText, healthText);

        return new SignalHealthDisplay(
            HasData: reading.HasAny,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            TotalSignalsText: totalText,
            ActiveText: activeText,
            WithGapsText: withGapsText,
            FreshnessText: freshnessText,
            HasFreshness: hasFreshness,
            Health: analysis.Health,
            HealthText: healthText,
            CompactBadgeText: compactBadge,
            SignalsLabel: localizer.GetString("widget.signalHealth.signals", "signals"),
            StatusLabel: localizer.GetString("widget.signalHealth.status", "Status"),
            StaleSignalsLabel: localizer.GetString("widget.signalHealth.staleSignals", "Stale / Gap Signals"),
            TotalSignalsLabel: totalLabel,
            ActiveLabel: activeLabel,
            WithGapsLabel: withGapsLabel,
            FreshnessLabel: freshnessLabel,
            GapRows: gapRows,
            HasGapRows: gapRows.Count > 0,
            AutomationName: automation,
            CompactAutomationName: compactAutomation);
    }

    /// <summary>
    /// Format a freshness age the way the web <c>formatAge</c> does — null → em dash, then "{n}s ago" under a
    /// minute, "{n}m ago" under an hour, otherwise "{n}h ago". Each tier resolves through the i18n facade.
    /// </summary>
    public static string FormatAge(int? seconds, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (seconds is not { } value)
        {
            return EmDash;
        }

        if (value < 60)
        {
            return FormatCount(localizer, "widget.signalHealth.secAgo", "{0}s ago", value);
        }

        if (value < 3600)
        {
            return FormatCount(localizer, "widget.signalHealth.minAgo", "{0}m ago", value / 60);
        }

        return FormatCount(localizer, "widget.signalHealth.hrAgo", "{0}h ago", value / 3600);
    }

    /// <summary>
    /// Format an instant as relative time the way the web <c>formatRelative</c> (lib/dateFormat) does — "just
    /// now" under a minute, "{n}m ago" under an hour, "{n}h ago" under a day, "{n}d ago" under a week, then the
    /// absolute "MMM d, yyyy" date. Deterministic against <paramref name="now"/>.
    /// </summary>
    public static string FormatRelative(DateTimeOffset lastSeen, DateTimeOffset now)
    {
        long seconds = (long)Math.Floor((now - lastSeen).TotalSeconds);
        if (seconds < 60)
        {
            return "just now";
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h ago");
        }

        long days = hours / 24;
        if (days < 7)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{days}d ago");
        }

        return lastSeen.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
    }

    /// <summary>Resolve the localized health label (web Healthy / Degraded / Critical / Unknown).</summary>
    public static string HealthText(StatusKind health, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return health switch
        {
            StatusKind.Success => localizer.GetString("widget.signalHealth.healthy", "Healthy"),
            StatusKind.Warning => localizer.GetString("widget.signalHealth.degraded", "Degraded"),
            StatusKind.Danger => localizer.GetString("widget.signalHealth.critical", "Critical"),
            _ => localizer.GetString("widget.signalHealth.unknown", "Unknown"),
        };
    }

    /// <summary>Format a count the way the web <c>fmtInt</c> does — en-US grouping, zero fraction digits.</summary>
    private static string FormatInt(int value) =>
        value.ToString("N0", CultureInfo.GetCultureInfo("en-US"));

    private static string FormatCount(ILocalizer localizer, string key, string fallback, int count)
    {
        string template = localizer.GetString(key, fallback);
        string countText = count.ToString(CultureInfo.CurrentCulture);
        return template
            .Replace("{{count}}", countText, StringComparison.Ordinal)
            .Replace("{count}", countText, StringComparison.Ordinal)
            .Replace("{0}", countText, StringComparison.Ordinal);
    }

    private static string BuildAutomationName(
        ILocalizer localizer,
        string totalLabel,
        string totalText,
        string activeLabel,
        string activeText,
        string withGapsLabel,
        string withGapsText,
        string freshnessLabel,
        string freshnessText,
        string healthText)
    {
        string title = localizer.GetString("widget.signalHealth.title", "Signal Health");
        string status = localizer.GetString("widget.signalHealth.status", "Status");
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{title}: {totalLabel} {totalText}, {activeLabel} {activeText}, {withGapsLabel} {withGapsText}, {freshnessLabel} {freshnessText}, {status} {healthText}");
    }

    private static string BuildCompactAutomationName(ILocalizer localizer, string compactBadge, string totalText, string healthText)
    {
        string title = localizer.GetString("widget.signalHealth.title", "Signal Health");
        string signals = localizer.GetString("widget.signalHealth.signals", "signals");
        return string.Create(
            CultureInfo.CurrentCulture,
            $"{title}: {compactBadge}, {totalText} {signals}, {healthText}");
    }
}

/// <summary>
/// Combines the three cache-then-network reads (signal stats, available signals, live signals) into a single
/// <see cref="RepositoryResult{T}"/> over the merged <see cref="SignalHealthReading"/>, preserving the
/// freshness contract. The freshness / error chrome is driven solely by the stats read, exactly like the web
/// (<c>updatedAt=statsUpdatedAt</c>, <c>isFetching=statsFetching</c>, <c>isStale=statsStale</c>,
/// <c>isError=statsError</c>); the body's empty-vs-content choice is driven by whether ANY of the three carried
/// a value (web <c>hasData</c>). Kept pure so the combine contract is unit-tested without a network or cache.
/// </summary>
public static class SignalHealthResultMapper
{
    /// <summary>Fold the three resolved reads into one combined emission with stats-driven freshness.</summary>
    public static RepositoryResult<SignalHealthReading> Combine(
        RepositoryResult<JsonElement> stats,
        RepositoryResult<JsonElement> signals,
        RepositoryResult<JsonElement> gaps)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(signals);
        ArgumentNullException.ThrowIfNull(gaps);

        bool hasStats = HasContent(stats) && stats.Value is { ValueKind: JsonValueKind.Object };
        var signalNames = Parse(signals, SignalHealthReading.ParseSignals);
        var gapMap = Parse(gaps, SignalHealthReading.ParseGaps);

        var reading = new SignalHealthReading(hasStats, signalNames, gapMap);

        if (!reading.HasAny)
        {
            // No read carried a value (web `!hasData`). A stats hard-failure collapses to the retry surface;
            // otherwise this is the friendly "No signal health data" empty surface.
            return stats.Status == LoadStatus.Error
                ? RepositoryResult<SignalHealthReading>.Failure(
                    stats.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Couldn't load signal health"))
                : RepositoryResult<SignalHealthReading>.Empty(stats.FetchedAt);
        }

        // hasData → the body renders; the stats read tints the freshness chip (web chrome).
        DateTimeOffset stamp = stats.FetchedAt
            ?? Latest(signals.FetchedAt, gaps.FetchedAt)
            ?? DateTimeOffset.UtcNow;

        return stats.Status switch
        {
            // Stats offline / errored but other content exists — keep the body, tint the chip as error/offline.
            LoadStatus.Offline or LoadStatus.Error => RepositoryResult<SignalHealthReading>.OfflineCached(
                reading, stamp, stats.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Signal stats are unavailable")),

            // Stats still in flight while another read already has content — body plus the "Updating…" chip.
            LoadStatus.Loading or LoadStatus.Refreshing => RepositoryResult<SignalHealthReading>.Refreshing(
                reading, stamp, stats.IsStale),

            // Stats surfaced a (possibly stale) cached value.
            LoadStatus.Cached => RepositoryResult<SignalHealthReading>.Cached(reading, stamp, stats.IsStale),

            // Stats returned fresh (Loaded) or returned no object (Empty) — fresh chrome either way.
            _ => stats.IsStale
                ? RepositoryResult<SignalHealthReading>.Cached(reading, stamp, stale: true)
                : RepositoryResult<SignalHealthReading>.Loaded(reading, stamp),
        };
    }

    private static TValue? Parse<TValue>(RepositoryResult<JsonElement> raw, Func<JsonElement, TValue?> parse)
        where TValue : class
    {
        // Only a content-bearing status carries a body to parse; Loading / Empty / Error contribute no slice.
        return HasContent(raw) && raw.Value is { } element ? parse(element) : null;
    }

    private static bool HasContent(RepositoryResult<JsonElement> result) =>
        result.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;

    private static DateTimeOffset? Latest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is { } av && b is { } bv)
        {
            return av > bv ? av : bv;
        }

        return a ?? b;
    }
}
