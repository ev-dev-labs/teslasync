using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="EfficiencyPanelViewModel"/> can be in — the native
/// union of the branches the web Charging-Efficiency panel renders
/// (web/src/features/charging/components/charging-list/EfficiencyPanel.tsx). The web component is a pure child
/// of the charging-list page (it takes a pre-computed <c>stats: EfficiencyStats</c>); the native surface binds
/// its own cache-then-network read of the charging-sessions list and computes the efficiency projection
/// itself, so it owns the full loading / loaded / empty / error / stale / offline matrix the P2 state contract
/// requires. Every value maps onto a visible surface (never a blank panel): <see cref="Loaded"/>,
/// <see cref="Stale"/> and <see cref="Offline"/> render the four efficiency tiles (with the stale / offline
/// chip for the latter two), <see cref="Empty"/> renders the friendly empty state (web parity: no sessions
/// carry efficiency data), <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the retry
/// surface.
/// </summary>
public enum EfficiencyPanelState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one session carrying efficiency data.</summary>
    Loaded,

    /// <summary>The snapshot resolved but no session carries efficiency data.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the tiles plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the tiles plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The semantic colour tone a single efficiency tile carries — the native mirror of the web tailwind accents
/// (<c>text-cyan-300</c> / <c>text-emerald-300</c> / <c>text-rose-300</c> / <c>text-amber-300</c>). The tone
/// is resolved to a theme-aware design-token brush by <see cref="EfficiencyPanelTokens.ToneBrushKey"/> so the
/// view never hard-codes a colour.
/// </summary>
public enum EfficiencyTone
{
    /// <summary>Cyan accent (web <c>text-cyan-300</c>, the Average-Efficiency tile + progress bar).</summary>
    Cyan,

    /// <summary>Emerald accent (web <c>text-emerald-300</c>, the Best-Session tile).</summary>
    Emerald,

    /// <summary>Rose accent (web <c>text-rose-300</c>, the Worst-Session tile).</summary>
    Rose,

    /// <summary>Amber accent (web <c>text-amber-300</c>, the Wall-to-Battery-Loss tile).</summary>
    Amber,
}

/// <summary>Resolves an <see cref="EfficiencyTone"/> to a generated design-token brush key. UI-free so it is
/// unit-tested without a XAML runtime.</summary>
public static class EfficiencyPanelTokens
{
    /// <summary>The theme-aware brush key tinting a tile's value (web tailwind accent → design token).</summary>
    public static string ToneBrushKey(EfficiencyTone tone) => tone switch
    {
        EfficiencyTone.Cyan => "TsColorAccentBrush",     // web text-cyan-300 / bg-neon-cyan
        EfficiencyTone.Emerald => "TsColorSuccessBrush", // web text-emerald-300
        EfficiencyTone.Rose => "TsColorDangerBrush",     // web text-rose-300
        EfficiencyTone.Amber => "TsColorWarningBrush",   // web text-amber-300
        _ => "TsColorTextPrimaryBrush",
    };
}

/// <summary>
/// One parsed charging session reduced to just the fields the efficiency projection needs — the native mirror
/// of the web <c>ChargingSession</c> subset <c>computeEfficiencyStats</c> reads (id, total_energy_added_wh,
/// started_at, ended_at). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial row never throws. WinUI-free so the parse is unit-tested without a UI host.
/// </summary>
public sealed record EfficiencyPanelSession(
    long Id,
    double? TotalEnergyAddedWh,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<EfficiencyPanelSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<EfficiencyPanelSession>();
        }

        var list = new List<EfficiencyPanelSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static EfficiencyPanelSession FromJson(JsonElement obj) => new(
        GetLong(obj, "id") ?? 0,
        GetDouble(obj, "total_energy_added_wh"),
        GetDateTime(obj, "started_at"),
        GetDateTime(obj, "ended_at"));

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One session's efficiency datum — the native mirror of an entry in the web <c>efficiencies</c> array
/// (<c>{ id, date, efficiency, added, used }</c>). <see cref="Efficiency"/> is the web metric
/// <c>(total_energy_added_wh / durationMinutes) * 60</c> (the value rendered, faithfully, through the web
/// <c>fmtPercent</c>). Pure data so the computation is asserted headlessly.
/// </summary>
public sealed record EfficiencyEntry(long Id, DateTimeOffset? Date, double Efficiency, double Added, double Used);

/// <summary>
/// The aggregate efficiency statistics for a set of charging sessions — the native mirror of the web
/// <c>EfficiencyStats</c> produced by <c>computeEfficiencyStats</c>. <see cref="WallLoss"/> is held at zero
/// (web parity — the web computes it as a constant 0) and <see cref="TotalUsed"/> equals
/// <see cref="TotalAdded"/> (web parity — both are the same Wh sum). Pure data, UI-free.
/// </summary>
public sealed record EfficiencyStats(
    double AvgEfficiency,
    EfficiencyEntry Best,
    EfficiencyEntry Worst,
    double WallLoss,
    double TotalAdded,
    double TotalUsed,
    int Count);

/// <summary>
/// One projected, render-ready efficiency tile — the native mirror of a single web <c>GlassPanel</c> stat
/// card (the big tinted value, its caption, an optional sub-line, and — for the Average tile — the progress
/// bar fill fraction). Pure data so the projection is asserted without a UI host.
/// </summary>
public sealed record EfficiencyMetric(
    EfficiencyTone Tone,
    string ValueText,
    string Label,
    string? SubText,
    double? BarFraction,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Charging-Efficiency surface — the localized header (title +
/// hint + "N sessions with data" summary), the four efficiency tiles, the empty-state message and the
/// accessible summary. <see cref="HasData"/> drives the content-vs-empty branch (web parity:
/// <c>computeEfficiencyStats</c> returns a value only when at least one session carries efficiency data).
/// Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record EfficiencyPanelDisplay(
    bool HasData,
    int Count,
    string Title,
    string Hint,
    string SessionsWithDataLabel,
    string HeaderSummary,
    IReadOnlyList<EfficiencyMetric> Metrics,
    string EmptyMessage,
    string AriaLabel,
    string AutomationName)
{
    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static EfficiencyPanelDisplay Empty(ILocalizer localizer) =>
        EfficiencyPanelProjection.Project(Array.Empty<EfficiencyPanelSession>(), localizer, default);
}

/// <summary>
/// Pure projection from parsed <see cref="EfficiencyPanelSession"/> rows to an
/// <see cref="EfficiencyPanelDisplay"/> — the native port of <c>computeEfficiencyStats</c>
/// (web/src/features/charging/components/charging-list/helpers.ts) plus the render logic in
/// EfficiencyPanel.tsx. It filters to sessions with positive energy and a positive duration, derives each
/// session's efficiency (<c>(total_energy_added_wh / durationMinutes) * 60</c>), then formats the four tiles
/// exactly as the web does (<c>fmtPercent</c> for the average / best / worst, <c>fmtWithUnit(_, 'kWh')</c> for
/// the wall loss, <c>fmtNumber</c> for the used → added line, and <c>formatDateTime</c> for the best / worst
/// dates). Every label resolves through the i18n facade. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class EfficiencyPanelProjection
{
    /// <summary>Fixed display precision (web <c>fmtNumber</c> global default precision is 2).</summary>
    public const int Decimals = 2;

    /// <summary>The energy unit suffix the loss / totals carry (web <c>'kWh'</c>, applied verbatim).</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>The wall-to-battery loss is a web constant 0 (EfficiencyPanel renders <c>fmtWithUnit(0, 'kWh')</c>).</summary>
    public const double WallLoss = 0;

    /// <summary>The progress bar caps the average at 100% (web <c>Math.min(avg, 100)</c>).</summary>
    public const double BarCapPercent = 100;

    /// <summary>Project <paramref name="sessions"/> using the localizer for every label.</summary>
    /// <param name="sessions">The charging sessions (the backend orders <c>started_at DESC</c>, newest first).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="now">The reference instant for date formatting (Full ignores it; threaded for consistency).</param>
    public static EfficiencyPanelDisplay Project(
        IReadOnlyList<EfficiencyPanelSession> sessions,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        var stats = ComputeStats(sessions);

        string title = localizer.GetString("charging.efficiency.title", "Charging Efficiency");
        string hint = localizer.GetString("charging.efficiency.hint", "Wall-to-battery energy conversion");
        string sessionsWithData = localizer.GetString("charging.efficiency.sessionsWithData", "sessions with data");
        string empty = localizer.GetString(
            "charging.efficiency.empty", "No charging sessions with efficiency data yet.");
        string aria = localizer.GetString(
            "charging.efficiency.aria",
            "Charging efficiency — wall-to-battery energy conversion across recent charging sessions");

        int count = stats?.Count ?? 0;

        // Web header: `{hint} ({count} {sessionsWithData})`.
        string headerSummary = string.Format(
            CultureInfo.CurrentCulture, "{0} ({1} {2})", hint, count, sessionsWithData);

        EfficiencyMetric[] metrics = stats is null
            ? Array.Empty<EfficiencyMetric>()
            : BuildMetrics(stats, localizer, now);

        return new EfficiencyPanelDisplay(
            HasData: stats is not null,
            Count: count,
            Title: title,
            Hint: hint,
            SessionsWithDataLabel: sessionsWithData,
            HeaderSummary: headerSummary,
            Metrics: metrics,
            EmptyMessage: empty,
            AriaLabel: aria,
            AutomationName: aria);
    }

    /// <summary>
    /// Compute the aggregate efficiency statistics — the native port of <c>computeEfficiencyStats</c>. Returns
    /// <c>null</c> when no session carries efficiency data (positive energy and a positive duration), exactly
    /// like the web helper, so the surface can render the friendly empty state.
    /// </summary>
    public static EfficiencyStats? ComputeStats(IReadOnlyList<EfficiencyPanelSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        if (sessions.Count == 0)
        {
            return null;
        }

        var entries = new List<EfficiencyEntry>(sessions.Count);
        double totalAdded = 0;
        foreach (var s in sessions)
        {
            double energy = s.TotalEnergyAddedWh ?? 0;
            long minutes = DurationMinutes(s.StartedAt, s.EndedAt);
            if (energy <= 0 || minutes <= 0)
            {
                continue;
            }

            double efficiency = (energy / minutes) * 60.0;
            entries.Add(new EfficiencyEntry(s.Id, s.StartedAt, efficiency, energy, energy));
            totalAdded += energy;
        }

        if (entries.Count == 0)
        {
            return null;
        }

        double avg = 0;
        foreach (var e in entries)
        {
            avg += e.Efficiency;
        }

        avg /= entries.Count;

        // Web: [...efficiencies].sort((a, b) => b.efficiency - a.efficiency) — descending and stable
        // (JS Array.sort is stable). OrderByDescending is a stable sort, so ties keep input order exactly.
        var sorted = Enumerable.OrderByDescending(entries, e => e.Efficiency).ToList();

        return new EfficiencyStats(
            AvgEfficiency: avg,
            Best: sorted[0],
            Worst: sorted[^1],
            WallLoss: WallLoss,
            TotalAdded: totalAdded,
            TotalUsed: totalAdded,
            Count: entries.Count);
    }

    /// <summary>
    /// Whole charging-session duration in minutes — the native port of <c>durationMinutes</c>: zero when there
    /// is no end timestamp or the window is non-positive, otherwise the millisecond delta rounded to whole
    /// minutes (web <c>Math.round((end - start) / 60000)</c>).
    /// </summary>
    public static long DurationMinutes(DateTimeOffset? startedAt, DateTimeOffset? endedAt)
    {
        if (startedAt is not { } start || endedAt is not { } end)
        {
            return 0;
        }

        double ms = (end - start).TotalMilliseconds;
        if (!double.IsFinite(ms) || ms <= 0)
        {
            return 0;
        }

        return (long)Math.Round(ms / 60_000.0, MidpointRounding.AwayFromZero);
    }

    private static EfficiencyMetric[] BuildMetrics(
        EfficiencyStats stats,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        string averageLabel = localizer.GetString("charging.efficiency.average", "Average Efficiency");
        string bestLabel = localizer.GetString("charging.efficiency.best", "Best Session");
        string worstLabel = localizer.GetString("charging.efficiency.worst", "Worst Session");
        string wallLossLabel = localizer.GetString("charging.efficiency.wallLoss", "Wall-to-Battery Loss");

        string avgValue = Percent(stats.AvgEfficiency);
        string bestValue = Percent(stats.Best.Efficiency);
        string worstValue = Percent(stats.Worst.Efficiency);
        string wallLossValue = WithUnit(stats.WallLoss, EnergyUnit);

        string bestDate = DateTimeFormatting.Format(stats.Best.Date, DateTimeVariant.Full, now);
        string worstDate = DateTimeFormatting.Format(stats.Worst.Date, DateTimeVariant.Full, now);

        // Web: `{fmtNumber(totalUsed)} kWh → {fmtNumber(totalAdded)} kWh`.
        string totalsLine = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1} \u2192 {2} {1}",
            Number(stats.TotalUsed),
            EnergyUnit,
            Number(stats.TotalAdded));

        return new[]
        {
            new EfficiencyMetric(
                Tone: EfficiencyTone.Cyan,
                ValueText: avgValue,
                Label: averageLabel,
                SubText: null,
                BarFraction: BarFraction(stats.AvgEfficiency),
                AutomationName: Combine(averageLabel, avgValue)),
            new EfficiencyMetric(
                Tone: EfficiencyTone.Emerald,
                ValueText: bestValue,
                Label: bestLabel,
                SubText: bestDate,
                BarFraction: null,
                AutomationName: Combine(bestLabel, bestValue, bestDate)),
            new EfficiencyMetric(
                Tone: EfficiencyTone.Rose,
                ValueText: worstValue,
                Label: worstLabel,
                SubText: worstDate,
                BarFraction: null,
                AutomationName: Combine(worstLabel, worstValue, worstDate)),
            new EfficiencyMetric(
                Tone: EfficiencyTone.Amber,
                ValueText: wallLossValue,
                Label: wallLossLabel,
                SubText: totalsLine,
                BarFraction: null,
                AutomationName: Combine(wallLossLabel, wallLossValue, totalsLine)),
        };
    }

    /// <summary>The Average-tile progress bar fill fraction (0..1) — web <c>Math.min(avg, 100)%</c> width.</summary>
    public static double BarFraction(double avgEfficiency)
    {
        if (!double.IsFinite(avgEfficiency))
        {
            return 0;
        }

        return Math.Clamp(Math.Min(avgEfficiency, BarCapPercent) / BarCapPercent, 0, 1);
    }

    private static string Percent(double v) =>
        NumberFormatting.Format(v, null, Decimals) + "%";

    private static string WithUnit(double v, string unit) =>
        NumberFormatting.Format(v, null, Decimals) + " " + unit;

    private static string Number(double v) =>
        NumberFormatting.Format(v, null, Decimals);

    private static string Combine(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static string Combine(string label, string value, string detail) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, detail);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;EfficiencyPanelSession&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class EfficiencyPanelResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<EfficiencyPanelSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<EfficiencyPanelSession> Parse() =>
            raw.HasValue ? EfficiencyPanelSession.ParseList(raw.Value) : Array.Empty<EfficiencyPanelSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Charging-Efficiency feature surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-list/EfficiencyPanel.tsx. The surface reads the same
/// charging-sessions list the web charging-list page feeds the efficiency computation.
/// </summary>
public static class EfficiencyPanelRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "efficiency-panel";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EfficiencyPanel";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.efficiency.title", "Charging Efficiency");
    }
}

/// <summary>
/// PII-safe diagnostics for the Charging-Efficiency surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session id, date, energy or efficiency
/// value — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class EfficiencyPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EfficiencyPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EfficiencyPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EfficiencyPanelRegistration.Slug}");
    }
}
