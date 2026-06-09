using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state the <see cref="AcDcStatsViewModel"/> can be in — the native superset of the web
/// <c>AcDcStatsPanel</c> (web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx). The web
/// component is presentational: its parent <c>ChargingListPage</c> owns the charging-sessions query and only
/// mounts the panel once <c>acDcBreakdown</c> resolves with at least one AC/DC session
/// (<c>ac.count + dc.count &gt;= 1</c>). This self-contained surface additionally renders that query's
/// lifecycle as explicit loading / ready / empty / stale / offline / error branches so no surface is ever
/// hidden. <see cref="Empty"/> mirrors the parent's threshold gate (no charging sessions to break down).
/// </summary>
public enum AcDcStatsState
{
    /// <summary>Initial fetch with no cached sessions — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh (or non-stale cached) breakdown with at least one AC/DC row.</summary>
    Ready,

    /// <summary>No vehicle resolved, or no charging sessions to break down — render the empty state.</summary>
    Empty,

    /// <summary>A cached breakdown older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached breakdown remains — content plus an offline chip.</summary>
    Offline,

    /// <summary>The request failed and no cached breakdown exists — render the retry affordance.</summary>
    Error,
}

/// <summary>
/// One charging session reduced to exactly the fields the web <c>computeAcDcBreakdown</c> reads
/// (web/src/features/charging/components/charging-list/helpers.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws.
/// <see cref="EnergyWh"/> is the SI energy added in watt-hours (web <c>total_energy_added_wh</c>).
/// </summary>
public sealed record AcDcChargingSession(
    double EnergyWh,
    double? Cost,
    string? ChargerType,
    double? PeakPowerW,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<AcDcChargingSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AcDcChargingSession>();
        }

        var list = new List<AcDcChargingSession>(element.GetArrayLength());
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
    public static AcDcChargingSession FromJson(JsonElement obj) =>
        new(
            EnergyWh: GetDouble(obj, "total_energy_added_wh") ?? 0,
            Cost: GetDouble(obj, "cost_decimal"),
            ChargerType: GetString(obj, "charger_type"),
            PeakPowerW: GetDouble(obj, "peak_power_w"),
            StartedAt: GetDate(obj, "started_at"),
            EndedAt: GetDate(obj, "ended_at"));

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return v.TryGetDateTimeOffset(out var dto) ? dto : null;
    }
}

/// <summary>
/// One accumulated AC- or DC-charging bucket — the native analogue of the web <c>AcDcBucket</c>. Holds the
/// summed energy (raw watt-hours, see <see cref="AcDcStatsProjection"/> for the web's display contract), cost,
/// session count, total duration in minutes and the free-charging totals.
/// </summary>
public sealed record AcDcBucket(
    double Energy,
    double Cost,
    long Count,
    double TotalDurationMinutes,
    long FreeCount,
    double FreeEnergy);

/// <summary>The cross-bucket totals — the native analogue of the web breakdown's <c>total</c> object.</summary>
public sealed record AcDcTotals(double Energy, double Cost, double FreeEnergy, long FreeCount);

/// <summary>
/// The AC vs DC charging breakdown — the native analogue of the web <c>AcDcBreakdown</c>. Pure data so the
/// computation is unit-tested without a UI host.
/// </summary>
public sealed record AcDcBreakdown(AcDcBucket Ac, AcDcBucket Dc, AcDcTotals Total)
{
    /// <summary>Total AC + DC sessions (web threshold gate <c>ac.count + dc.count</c>).</summary>
    public long TotalCount => Ac.Count + Dc.Count;
}

/// <summary>
/// Pure computation from a charging-session list to its <see cref="AcDcBreakdown"/> — a faithful port of the
/// web <c>computeAcDcBreakdown</c> + <c>durationMinutes</c> helpers
/// (web/src/features/charging/components/charging-list/helpers.ts and charging-curve/helpers.ts). No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class AcDcStatsCompute
{
    /// <summary>Peak-power threshold (W) above which a session counts as DC (web literal <c>22_000</c>).</summary>
    public const double DcPowerThresholdW = 22_000;

    /// <summary>Compute the AC/DC breakdown over <paramref name="sessions"/> (web <c>computeAcDcBreakdown</c>).</summary>
    public static AcDcBreakdown Compute(IReadOnlyList<AcDcChargingSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);

        double acEnergy = 0, acCost = 0, acDuration = 0, acFreeEnergy = 0;
        long acCount = 0, acFreeCount = 0;
        double dcEnergy = 0, dcCost = 0, dcDuration = 0, dcFreeEnergy = 0;
        long dcCount = 0, dcFreeCount = 0;

        foreach (var s in sessions)
        {
            double energy = s.EnergyWh;
            double cost = s.Cost ?? 0;
            double duration = DurationMinutes(s.StartedAt, s.EndedAt);
            bool free = IsFree(s);

            if (IsDc(s))
            {
                dcEnergy += energy;
                dcCost += cost;
                dcCount++;
                dcDuration += duration;
                if (free)
                {
                    dcFreeCount++;
                    dcFreeEnergy += energy;
                }
            }
            else
            {
                acEnergy += energy;
                acCost += cost;
                acCount++;
                acDuration += duration;
                if (free)
                {
                    acFreeCount++;
                    acFreeEnergy += energy;
                }
            }
        }

        var ac = new AcDcBucket(acEnergy, acCost, acCount, acDuration, acFreeCount, acFreeEnergy);
        var dc = new AcDcBucket(dcEnergy, dcCost, dcCount, dcDuration, dcFreeCount, dcFreeEnergy);
        var total = new AcDcTotals(
            acEnergy + dcEnergy,
            acCost + dcCost,
            acFreeEnergy + dcFreeEnergy,
            acFreeCount + dcFreeCount);

        return new AcDcBreakdown(ac, dc, total);
    }

    /// <summary>
    /// Duration between the two timestamps in whole minutes — port of the web <c>durationMinutes</c>: 0 when
    /// the session has no end, the timestamps are unparseable, or the end is not after the start; otherwise the
    /// elapsed milliseconds rounded (half away from zero, matching JS <c>Math.round</c>) to minutes.
    /// </summary>
    public static double DurationMinutes(DateTimeOffset? started, DateTimeOffset? ended)
    {
        if (started is not { } start || ended is not { } end)
        {
            return 0;
        }

        double milliseconds = (end - start).TotalMilliseconds;
        if (milliseconds <= 0)
        {
            return 0;
        }

        return Math.Round(milliseconds / 60_000.0, MidpointRounding.AwayFromZero);
    }

    // Web parity: isDC = !!(charger_type || (peak_power_w && peak_power_w > 22_000)) — a non-empty
    // charger_type, or a peak power above the AC ceiling, marks the session as DC.
    private static bool IsDc(AcDcChargingSession s) =>
        !string.IsNullOrEmpty(s.ChargerType) || (s.PeakPowerW ?? 0) > DcPowerThresholdW;

    // Web parity: a session is "free" when its cost is absent or exactly zero (web `!cost || cost === 0`).
    private static bool IsFree(AcDcChargingSession s) => (s.Cost ?? 0) == 0;
}

/// <summary>
/// The projected, render-ready energy-split bar — the native analogue of the web component's proportional
/// AC|DC bar plus its under-bar AC / Total / DC energy labels. <see cref="AcWeight"/> / <see cref="DcWeight"/>
/// are the 0..100 percentages the bar segments are sized by.
/// </summary>
public sealed record AcDcEnergySplit(
    bool AcShown,
    bool DcShown,
    double AcWeight,
    double DcWeight,
    string AcSegmentText,
    string DcSegmentText,
    string AcEnergyText,
    string TotalEnergyText,
    string DcEnergyText);

/// <summary>
/// One projected stats-table row (AC or DC) — every cell pre-formatted exactly as the web table renders it,
/// plus a semantic <see cref="Accent"/> (Info for AC, Warning for DC) and a Narrator name. Pure data.
/// </summary>
public sealed record AcDcStatsRow(
    string Label,
    StatusKind Accent,
    long Count,
    string SessionsText,
    string EnergyText,
    string CostText,
    string PerKwhText,
    string AvgEnergyText,
    string AvgTimeText,
    string FreeText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the AC/DC panel — the native analogue of everything the web
/// component renders: the energy-split bar, the stats table rows, and the optional free-charging footer.
/// Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record AcDcStatsDisplay(
    bool HasRows,
    AcDcEnergySplit Split,
    IReadOnlyList<AcDcStatsRow> Rows,
    bool HasFree,
    string FreeChargedLabel,
    string FreeSessionsValue,
    string FreeEnergyLabel,
    string FreeEnergyValue,
    string FreeFooterAutomationName)
{
    /// <summary>The all-empty display (loading / no-data scaffold).</summary>
    public static AcDcStatsDisplay Empty { get; } = new(
        HasRows: false,
        Split: new AcDcEnergySplit(false, false, 0, 0, string.Empty, string.Empty, string.Empty, string.Empty, string.Empty),
        Rows: Array.Empty<AcDcStatsRow>(),
        HasFree: false,
        FreeChargedLabel: string.Empty,
        FreeSessionsValue: string.Empty,
        FreeEnergyLabel: string.Empty,
        FreeEnergyValue: string.Empty,
        FreeFooterAutomationName: string.Empty);
}

/// <summary>
/// Pure projection from an <see cref="AcDcBreakdown"/> to its render-ready <see cref="AcDcStatsDisplay"/> —
/// the native port of web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx. The number
/// formatting mirrors the web helpers exactly:
/// <list type="bullet">
/// <item><c>fmtPercent(x)</c> → <c>{x}%</c> at the global 2-dp precision;</item>
/// <item>energy uses the web's <c>energy &gt;= 1000 ? fmtWithUnit(energy/1000,'MWh') : fmtWithUnit(energy,'kWh')</c>
/// switch — the value is the raw summed <c>total_energy_added_wh</c> the web labels as kWh, reproduced verbatim
/// (no SI conversion) so the rendered figures match the web source row-for-row;</item>
/// <item>cost uses the web <c>&lt;Currency&gt;</c> (<c>{symbol}{x,2dp}</c>, em-dash when non-finite);</item>
/// <item>avg time uses the web <c>formatDuration</c> (<c>{h}h {m}m</c> / <c>{m}m</c>, em-dash when invalid).</item>
/// </list>
/// Every label resolves through the i18n facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AcDcStatsProjection
{
    /// <summary>Em-dash shown for an absent value (web parity '—').</summary>
    public const string EmDash = "\u2014";

    private const string UnitKwh = "kWh";
    private const string UnitMwh = "MWh";

    /// <summary>Web <c>safeNumber</c>: a finite number passes through, anything else becomes 0.</summary>
    public static double Safe(double value) => double.IsFinite(value) ? value : 0;

    /// <summary>Format a number with en-US grouping at <paramref name="decimals"/> places (web <c>fmtNumber</c>).</summary>
    public static string FormatNumber(double value, int decimals) =>
        NumberFormatting.Format(Safe(value), null, decimals);

    /// <summary>Render a raw count without grouping (web parity for the inline <c>{count}</c> expressions).</summary>
    public static string FormatCount(long count) => count.ToString(CultureInfo.InvariantCulture);

    /// <summary>Format a percentage (already 0..100) with a trailing % at 2 dp (web <c>fmtPercent</c>).</summary>
    public static string FormatPercent(double value) => FormatNumber(value, 2) + "%";

    /// <summary>
    /// Format an energy figure with the web's kWh / MWh switch
    /// (<c>energy &gt;= 1000 ? fmtWithUnit(energy/1000,'MWh') : fmtWithUnit(energy,'kWh')</c>).
    /// </summary>
    public static string FormatEnergy(double energy) =>
        energy >= 1000 ? $"{FormatNumber(energy / 1000, 2)} {UnitMwh}" : $"{FormatNumber(energy, 2)} {UnitKwh}";

    /// <summary>Format an energy figure always in kWh (web <c>fmtWithUnit(energy,'kWh')</c>, no MWh switch).</summary>
    public static string FormatEnergyKwh(double energy) => $"{FormatNumber(energy, 2)} {UnitKwh}";

    /// <summary>Format a currency amount as <c>{symbol}{x,2dp}</c>, or the em-dash when non-finite (web <c>Currency</c>).</summary>
    public static string FormatCurrency(double value, string symbol) =>
        double.IsFinite(value) ? symbol + FormatNumber(value, 2) : EmDash;

    /// <summary>Format a minutes duration as <c>{h}h {m}m</c> / <c>{m}m</c> (web <c>formatDurationMinutes</c>).</summary>
    public static string FormatDuration(double minutes)
    {
        if (!double.IsFinite(minutes) || minutes < 0)
        {
            return EmDash;
        }

        long h = (long)Math.Floor(minutes / 60.0);
        long m = (long)Math.Round(minutes % 60.0, MidpointRounding.AwayFromZero);
        return h > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{h}h {m}m")
            : string.Create(CultureInfo.InvariantCulture, $"{m}m");
    }

    /// <summary>Project <paramref name="breakdown"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="breakdown">The computed breakdown, or null while loading / on a hard failure.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static AcDcStatsDisplay Project(AcDcBreakdown? breakdown, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity: the parent only mounts the panel when there is at least one AC/DC session to show.
        if (breakdown is null || breakdown.TotalCount == 0)
        {
            return AcDcStatsDisplay.Empty;
        }

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? AcDcStatsRegistration.DefaultCurrencySymbol
            : currencySymbol;

        var split = BuildSplit(breakdown, localizer);

        var rows = new List<AcDcStatsRow>(2);
        if (breakdown.Ac.Count > 0)
        {
            rows.Add(BuildRow(AcDcStatsRegistration.AcChargingLabel(localizer), StatusKind.Info, breakdown.Ac, symbol, localizer));
        }

        if (breakdown.Dc.Count > 0)
        {
            rows.Add(BuildRow(AcDcStatsRegistration.DcChargingLabel(localizer), StatusKind.Warning, breakdown.Dc, symbol, localizer));
        }

        bool hasFree = breakdown.Total.FreeCount > 0;
        string freeChargedLabel = hasFree ? AcDcStatsRegistration.FreeChargedLabel(localizer) : string.Empty;
        string freeSessionsValue = hasFree
            ? $"{FormatCount(breakdown.Total.FreeCount)} {AcDcStatsRegistration.SessionsWord(localizer)}"
            : string.Empty;
        string freeEnergyLabel = hasFree ? AcDcStatsRegistration.FreeEnergyLabel(localizer) : string.Empty;
        string freeEnergyValue = hasFree ? FormatEnergyKwh(breakdown.Total.FreeEnergy) : string.Empty;
        string freeFooterName = hasFree
            ? $"{freeChargedLabel}: {freeSessionsValue}. {freeEnergyLabel}: {freeEnergyValue}"
            : string.Empty;

        return new AcDcStatsDisplay(
            HasRows: rows.Count > 0,
            Split: split,
            Rows: rows,
            HasFree: hasFree,
            FreeChargedLabel: freeChargedLabel,
            FreeSessionsValue: freeSessionsValue,
            FreeEnergyLabel: freeEnergyLabel,
            FreeEnergyValue: freeEnergyValue,
            FreeFooterAutomationName: freeFooterName);
    }

    private static AcDcEnergySplit BuildSplit(AcDcBreakdown b, ILocalizer localizer)
    {
        double total = b.Total.Energy;
        double acPercent = total > 0 ? b.Ac.Energy / total * 100 : 0;
        double dcPercent = total > 0 ? b.Dc.Energy / total * 100 : 0;

        string ac = AcDcStatsRegistration.AcShort(localizer);
        string dc = AcDcStatsRegistration.DcShort(localizer);
        string totalLabel = AcDcStatsRegistration.TotalShort(localizer);

        return new AcDcEnergySplit(
            AcShown: b.Ac.Energy > 0,
            DcShown: b.Dc.Energy > 0,
            AcWeight: acPercent,
            DcWeight: dcPercent,
            AcSegmentText: $"{ac} {FormatPercent(acPercent)}",
            DcSegmentText: $"{dc} {FormatPercent(dcPercent)}",
            AcEnergyText: $"{ac}: {FormatEnergy(b.Ac.Energy)}",
            TotalEnergyText: $"{totalLabel}: {FormatEnergy(total)}",
            DcEnergyText: $"{dc}: {FormatEnergy(b.Dc.Energy)}");
    }

    private static AcDcStatsRow BuildRow(string label, StatusKind accent, AcDcBucket bucket, string symbol, ILocalizer localizer)
    {
        string sessions = FormatCount(bucket.Count);
        string energy = FormatEnergy(bucket.Energy);
        string cost = FormatCurrency(bucket.Cost, symbol);
        string perKwh = bucket.Energy > 0 ? FormatCurrency(bucket.Cost / bucket.Energy, symbol) : EmDash;
        string avgEnergy = FormatEnergyKwh(bucket.Energy / bucket.Count);
        string avgTime = FormatDuration(bucket.TotalDurationMinutes / bucket.Count);
        string free = bucket.FreeCount > 0
            ? $"{FormatCount(bucket.FreeCount)} ({FormatEnergyKwh(bucket.FreeEnergy)})"
            : EmDash;

        string automation = string.Join(", ", new[]
        {
            label,
            $"{AcDcStatsRegistration.SessionsHeader(localizer)}: {sessions}",
            $"{AcDcStatsRegistration.EnergyHeader(localizer)}: {energy}",
            $"{AcDcStatsRegistration.CostHeader(localizer)}: {cost}",
            $"{AcDcStatsRegistration.CostPerKwhHeader(localizer)}: {perKwh}",
            $"{AcDcStatsRegistration.AvgEnergyHeader(localizer)}: {avgEnergy}",
            $"{AcDcStatsRegistration.AvgTimeHeader(localizer)}: {avgTime}",
            $"{AcDcStatsRegistration.FreeHeader(localizer)}: {free}",
        });

        return new AcDcStatsRow(label, accent, bucket.Count, sessions, energy, cost, perKwh, avgEnergy, avgTime, free, automation);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto computed
/// <c>RepositoryResult&lt;AcDcBreakdown&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline) so the view-model can render the full state matrix. Parsing the sessions and running
/// <see cref="AcDcStatsCompute.Compute"/> happens here so the view never sees raw JSON. Kept pure so the
/// parse-compute-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AcDcStatsResultMapper
{
    /// <summary>Parse and compute <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AcDcBreakdown> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AcDcBreakdown Compute() =>
            AcDcStatsCompute.Compute(raw.HasValue ? AcDcChargingSession.ParseList(raw.Value) : Array.Empty<AcDcChargingSession>());

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AcDcBreakdown>.Loading(),
            LoadStatus.Cached => RepositoryResult<AcDcBreakdown>.Cached(Compute(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AcDcBreakdown>.Refreshing(Compute(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<AcDcBreakdown>.Loaded(Compute(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<AcDcBreakdown>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AcDcBreakdown>.OfflineCached(Compute(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<AcDcBreakdown>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// The registry metadata, i18n keys and glyph for the AC/DC charging-stats surface. Every web <c>t()</c> call
/// in AcDcStatsPanel.tsx maps to a <c>GetString</c> here (so the keys are asserted in tests and resolved for
/// real in the app); native-superset chrome (loading / empty / stale / offline / retry) reuses the shared
/// <c>common.*</c> and <c>charging.list.empty</c> catalog keys where they exist and falls back to English for
/// the rest, exactly as the i18n facade contract guarantees.
/// </summary>
public static class AcDcStatsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AcDcStatsPanel";

    /// <summary>The default currency symbol (web parity for an unset <c>settings.currency_symbol</c>).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent "EnergySaver" glyph — native stand-in for the web Lucide <c>Zap</c> icon.</summary>
    public const string TitleGlyph = "\uEC0A";

    // ── Panel title + section labels (web charging.stats.* keys) ─────────────────────────────────────────

    /// <summary>"Charging Stats by Type" panel title (web <c>charging.stats.chargingByType</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("charging.stats.chargingByType", "Charging Stats by Type");

    /// <summary>"Energy Split (AC vs DC)" caption (web <c>charging.stats.energySplitLabel</c>).</summary>
    public static string EnergySplitLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.stats.energySplitLabel", "Energy Split (AC vs DC)");

    // ── Table column headers (web charging.table.* keys) ─────────────────────────────────────────────────

    /// <summary>"Type" column header (web <c>charging.table.type</c>).</summary>
    public static string TypeHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.type", "Type");

    /// <summary>"Sessions" column header (web <c>charging.table.sessionCount</c>).</summary>
    public static string SessionsHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.sessionCount", "Sessions");

    /// <summary>"Energy" column header (web <c>charging.table.energy</c>).</summary>
    public static string EnergyHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.energy", "Energy");

    /// <summary>"Cost" column header (web <c>charging.table.cost</c>).</summary>
    public static string CostHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.cost", "Cost");

    /// <summary>"$/kWh" column header (web <c>charging.table.costPerKwh</c>).</summary>
    public static string CostPerKwhHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.costPerKwh", "$/kWh");

    /// <summary>"Avg Energy" column header (web <c>charging.table.avgEnergy</c>).</summary>
    public static string AvgEnergyHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.avgEnergy", "Avg Energy");

    /// <summary>"Avg Time" column header (web <c>charging.table.avgTime</c>).</summary>
    public static string AvgTimeHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.avgTime", "Avg Time");

    /// <summary>"Free" column header (web <c>charging.table.free</c>).</summary>
    public static string FreeHeader(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.free", "Free");

    // ── Row + footer labels (web charging.table.* keys) ──────────────────────────────────────────────────

    /// <summary>"AC Charging" row label (web <c>charging.table.acCharging</c>).</summary>
    public static string AcChargingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.acCharging", "AC Charging");

    /// <summary>"DC Charging" row label (web <c>charging.table.dcCharging</c>).</summary>
    public static string DcChargingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.dcCharging", "DC Charging");

    /// <summary>"Free charged" footer label (web <c>charging.table.freeCharged</c>).</summary>
    public static string FreeChargedLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.freeCharged", "Free charged");

    /// <summary>"Free energy" footer label (web <c>charging.table.freeEnergy</c>).</summary>
    public static string FreeEnergyLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.table.freeEnergy", "Free energy");

    // ── Short axis labels (web hardcodes "AC" / "DC" / "Total"; native routes them through keys) ─────────

    /// <summary>"AC" short label for the split bar (web inline literal).</summary>
    public static string AcShort(ILocalizer localizer) => Require(localizer).GetString("AC", "AC");

    /// <summary>"DC" short label for the split bar (web inline literal).</summary>
    public static string DcShort(ILocalizer localizer) => Require(localizer).GetString("DC", "DC");

    /// <summary>"Total" short label for the split bar (web inline literal).</summary>
    public static string TotalShort(ILocalizer localizer) => Require(localizer).GetString("common.total", "Total");

    /// <summary>Lowercase "sessions" word for the free-charging footer (web inline literal).</summary>
    public static string SessionsWord(ILocalizer localizer) =>
        Require(localizer).GetString("charging.curve.sessions", "sessions");

    // ── Surface chrome (native superset; the web parent owns the query lifecycle) ────────────────────────

    /// <summary>Loading announcement label (native superset).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.loading", "Loading\u2026");

    /// <summary>Whole-surface empty message — no charging sessions to break down (web <c>charging.list.empty</c>).</summary>
    public static string EmptyText(ILocalizer localizer) =>
        Require(localizer).GetString("charging.list.empty", "No charging sessions yet");

    /// <summary>Stale freshness chip label (native superset).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("charging.stats.stale", "Stale");

    /// <summary>Offline freshness chip label (native superset).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.offline", "Offline");

    /// <summary>Retry affordance label for the hard-error branch (native superset).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.retry", "Retry");

    /// <summary>Hard-error message (native superset; the web parent renders QueryError).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("charging.stats.error", "Couldn't load charging stats");

    /// <summary>Offline message shown alongside the cached content (native superset).</summary>
    public static string OfflineText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "charging.stats.offlineMessage",
            "You're offline — showing the last cached charging stats");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the AC/DC charging-stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session count, energy figure or cost —
/// so a diagnostics line can never leak charging data. Thread-safe.
/// </summary>
public sealed class AcDcStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public AcDcStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AcDcStatsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AcDcStatsRegistration.Slug}");
    }
}
