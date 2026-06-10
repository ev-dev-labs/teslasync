using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="DetailCardsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/driving/components/drivetrain-health/DetailCards.tsx) is a presentational pair of
/// glass cards that receives its <c>health</c>, <c>peakPower</c>, <c>avgPowerMax</c>, <c>minRegenPower</c>
/// and <c>stats</c> as props (only <c>useTranslation</c> + <c>useUnits</c> are read directly); the native
/// feature-view owns the drivetrain-health read (plus the recent-drives read its Power-Summary memos
/// aggregate and the lifetime driving-stats read its regen / CO₂ rows consume) so it renders the full state
/// matrix the P2 contract mandates. Every branch maps onto a visible surface — none is ever hidden.
/// <see cref="Empty"/> mirrors the web Drivetrain-Health page's <c>{health ? … : &lt;EmptyState/&gt;}</c>
/// gate (no drivetrain-health snapshot) in addition to an empty HTTP body.
/// </summary>
public enum DetailCardsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton cards.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) — render the two detail cards.</summary>
    Loaded,

    /// <summary>No drivetrain-health snapshot resolved — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// Pure aggregation of the Power-Summary figures from the recent-drives list — the native port of the web
/// Drivetrain-Health page's <c>avgPowerMax</c> / <c>peakPower</c> / <c>minRegenPower</c> <c>useMemo</c> block
/// (web/src/features/driving/pages/DrivetrainHealthPage.tsx). The drives are filtered to the default
/// last-30-day window, sorted by start time, capped at the 30 most-recent points and each mapped to
/// <c>avg_power_w / 1000</c> (kW; missing power → 0). Over that capped series the web derives:
/// <list type="bullet">
///   <item><see cref="PeakKw"/> = <c>Math.max(powerMax)</c>;</item>
///   <item><see cref="AvgKw"/> = mean of <c>powerMax</c>;</item>
///   <item><see cref="MinRegenKw"/> = <c>Math.min(powerMin)</c>, and the page hard-codes every
///         <c>powerMin</c> to <see cref="PowerMinKw"/> (0), so this is always 0 — the web "Max Regen" row
///         consequently always renders the em-dash.</item>
/// </list>
/// No drive in the window yields <see cref="Zero"/> (web <c>!chartData.length → 0</c>). Snake_case keys match
/// the Go drives wire shape. No WinUI types — unit-tested without a UI host.
/// </summary>
/// <param name="PeakKw">Peak recent-drive power in kW (web <c>peakPower</c>); 0 when none.</param>
/// <param name="AvgKw">Mean recent-drive power in kW (web <c>avgPowerMax</c>); 0 when none.</param>
/// <param name="MinRegenKw">Minimum regen power in kW (web <c>minRegenPower</c>); always 0 (see remarks).</param>
public sealed record DrivetrainPowerSummary(double PeakKw, double AvgKw, double MinRegenKw)
{
    /// <summary>The default look-back window in days (web <c>defaultStartDate = today − 30 days</c>).</summary>
    public const int WindowDays = 30;

    /// <summary>The maximum number of most-recent points retained (web <c>chartData.slice(-30)</c>).</summary>
    public const int MaxPoints = 30;

    /// <summary>Watts per kilowatt — the divisor turning SI watts into the kW the rows show.</summary>
    public const double WattsPerKilowatt = 1000.0;

    /// <summary>
    /// The per-point regen power the web page assigns to every chart point (<c>powerMin: 0</c>); the minimum
    /// over the series is therefore always this value, so the "Max Regen" row always renders the em-dash.
    /// </summary>
    public const double PowerMinKw = 0;

    /// <summary>The all-zero summary — the aggregation fallback when no drive falls in the window.</summary>
    public static DrivetrainPowerSummary Zero { get; } = new(0, 0, 0);

    /// <summary>
    /// Compute the Power-Summary figures in kW from <paramref name="drives"/> relative to
    /// <paramref name="now"/>. Reproduces the web default-window filter (today − 30 days at 00:00 → today at
    /// 23:59:59), the ascending sort, the 30-point cap and the <c>avg_power_w / 1000</c> mapping verbatim,
    /// then derives the peak, mean and minimum-regen figures over the capped series.
    /// </summary>
    /// <param name="drives">The drives JSON array (any order).</param>
    /// <param name="now">The clock used to derive the look-back window.</param>
    /// <returns>The aggregated Power-Summary figures, or <see cref="Zero"/> when no drive is in window.</returns>
    public static DrivetrainPowerSummary FromDrives(JsonElement drives, DateTimeOffset now)
    {
        if (drives.ValueKind != JsonValueKind.Array)
        {
            return Zero;
        }

        // web: startMs = new Date(`${startDate}T00:00:00`); endMs = new Date(`${endDate}T23:59:59`) where
        // startDate = today − 30 days and endDate = today (date-truncated in the user's local zone).
        var startBound = new DateTimeOffset(now.Date, now.Offset).AddDays(-WindowDays);
        var endBound = new DateTimeOffset(now.Date, now.Offset).AddDays(1).AddSeconds(-1);

        var window = new List<(DateTimeOffset Start, double PowerKw)>();
        foreach (var item in drives.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var start = GetDateTime(item, "start_ts");
            if (start is not { } ts || ts < startBound || ts > endBound)
            {
                continue;
            }

            double powerKw = (GetDouble(item, "avg_power_w") ?? 0) / WattsPerKilowatt;
            window.Add((ts, powerKw));
        }

        if (window.Count == 0)
        {
            return Zero;
        }

        window.Sort(static (a, b) => a.Start.CompareTo(b.Start));
        int skip = Math.Max(0, window.Count - MaxPoints);

        double peak = 0;
        double sum = 0;
        int count = 0;
        for (int i = skip; i < window.Count; i++)
        {
            double powerKw = window[i].PowerKw;
            peak = Math.Max(peak, powerKw);
            sum += powerKw;
            count++;
        }

        double avg = count > 0 ? sum / count : 0;

        // web: minRegenPower = Math.min(...chartData.map(d => d.powerMin)) where powerMin is constant 0.
        double minRegen = count > 0 ? PowerMinKw : 0;
        return new DrivetrainPowerSummary(peak, avg, minRegen);
    }

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
            out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// The lifetime driving-stats figures the Power-Summary's regen / CO₂ rows consume — the native projection of
/// the <c>/drives/stats</c> body (the web <c>DrivingStats</c> in web/src/types/driving.ts) read by the page's
/// <c>useDrivingStats(vehicleId)</c> and passed as <c>stats</c> to <c>&lt;DetailCards&gt;</c>. A
/// <see langword="null"/> instance is the native analogue of the web <c>stats === undefined</c> (the query is
/// disabled / loading / failed), which renders both rows as the em-dash; a non-null instance with null fields
/// mirrors a present-but-sparse body (web <c>stats.regenEnergyWh === undefined</c>). Snake_case keys match the
/// Go handler's wire shape exactly. Pure data — no WinUI types.
/// </summary>
/// <param name="RegenEnergyWh">Lifetime regen energy in Wh (web <c>regenEnergyWh</c>); null when absent.</param>
/// <param name="Co2SavedKg">Lifetime CO₂ saved in kg (web <c>co2SavedKg</c>); null when absent.</param>
public sealed record DetailCardsStats(double? RegenEnergyWh, double? Co2SavedKg)
{
    /// <summary>
    /// Project a <c>/drives/stats</c> JSON object into a tolerant stats record, or <see langword="null"/> when
    /// the payload is not an object (web <c>stats</c> undefined). An empty object yields a record with null
    /// fields, mirroring the web truthy-but-sparse case.
    /// </summary>
    /// <param name="obj">The driving-stats JSON body.</param>
    /// <returns>A tolerant stats record, or null when no object is present.</returns>
    public static DetailCardsStats? FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DetailCardsStats(GetDouble(obj, "regen_energy_wh"), GetDouble(obj, "co2_saved_kg"));
    }

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
}

/// <summary>
/// One drivetrain detail snapshot the two cards consume — the native projection of the <c>/drivetrain/health</c>
/// body (the web <c>DrivetrainHealthData</c>) combined with the recent-drives <see cref="DrivetrainPowerSummary"/>
/// the web page derives and the optional lifetime <see cref="DetailCardsStats"/>. The four motor / battery
/// temperatures are SI Celsius (nullable; a missing sensor renders the web em-dash). Parsing is null-tolerant so
/// a partial body never throws. Pure data — no WinUI types.
/// </summary>
/// <param name="FrontMotorTempC">Front-motor temperature in °C (web <c>frontMotorTempC</c>); null when absent.</param>
/// <param name="RearMotorTempC">Rear-motor temperature in °C (web <c>rearMotorTempC</c>); null when absent.</param>
/// <param name="InverterTempC">Inverter temperature in °C (web <c>inverterTempC</c>); null when absent.</param>
/// <param name="BatteryTempC">Battery temperature in °C (web <c>batteryTempC</c>); null when absent.</param>
/// <param name="Power">The recent-drive Power-Summary figures (web <c>peakPower</c> / <c>avgPowerMax</c> / <c>minRegenPower</c>).</param>
/// <param name="Stats">The lifetime driving stats (web <c>stats</c>); null when the query is undefined.</param>
public sealed record DetailCardsSnapshot(
    double? FrontMotorTempC,
    double? RearMotorTempC,
    double? InverterTempC,
    double? BatteryTempC,
    DrivetrainPowerSummary Power,
    DetailCardsStats? Stats)
{
    /// <summary>
    /// Project a <c>/drivetrain/health</c> JSON object into a tolerant snapshot, injecting the separately
    /// resolved <paramref name="power"/> and <paramref name="stats"/>. Snake_case keys match the Go handler's
    /// wire shape exactly (the native contract client does not camelCase).
    /// </summary>
    /// <param name="health">The drivetrain-health JSON object.</param>
    /// <param name="power">The recent-drive Power-Summary figures resolved from the drives list.</param>
    /// <param name="stats">The lifetime driving stats resolved from <c>/drives/stats</c>, or null.</param>
    /// <returns>A tolerant snapshot.</returns>
    public static DetailCardsSnapshot FromJson(JsonElement health, DrivetrainPowerSummary power, DetailCardsStats? stats)
    {
        ArgumentNullException.ThrowIfNull(power);

        if (health.ValueKind != JsonValueKind.Object)
        {
            return new DetailCardsSnapshot(null, null, null, null, power, stats);
        }

        return new DetailCardsSnapshot(
            FrontMotorTempC: GetDouble(health, "front_motor_temp_c"),
            RearMotorTempC: GetDouble(health, "rear_motor_temp_c"),
            InverterTempC: GetDouble(health, "inverter_temp_c"),
            BatteryTempC: GetDouble(health, "battery_temp_c"),
            Power: power,
            Stats: stats);
    }

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
}

/// <summary>
/// One projected, display-ready key/value row inside a detail card — the native analogue of a web
/// <c>KVList</c> item. Holds the localized label, the already-formatted value (em-dash when empty) and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized row label.</param>
/// <param name="Value">The pre-formatted value.</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record DetailCardsRow(string Label, string Value, string AutomationName);

/// <summary>
/// One projected, display-ready detail card — the native analogue of a web <c>&lt;Card&gt;</c> with its
/// <c>&lt;CardHeader title /&gt;</c> and <c>&lt;KVList /&gt;</c>. Holds the localized title, the ordered rows
/// and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Title">The localized card title.</param>
/// <param name="Rows">The ordered key/value rows in web display order.</param>
/// <param name="AutomationName">The Narrator name (the card title).</param>
public sealed record DetailCardsCard(string Title, IReadOnlyList<DetailCardsRow> Rows, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the detail-cards pair — the two cards plus the
/// <see cref="HasData"/> gate. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when a drivetrain-health snapshot is present (web <c>health</c> truthy).</param>
/// <param name="Cards">The two detail cards (Temperature Details, Power Summary) in web display order.</param>
public sealed record DetailCardsDisplay(bool HasData, IReadOnlyList<DetailCardsCard> Cards)
{
    /// <summary>An empty projection (no cards) — the projection fallback for an absent snapshot.</summary>
    public static DetailCardsDisplay Empty { get; } = new(false, Array.Empty<DetailCardsCard>());
}

/// <summary>
/// Pure projection from a <see cref="DetailCardsSnapshot"/> to the two display cards — the native port of the
/// <c>&lt;Card&gt;</c> / <c>&lt;KVList&gt;</c> composition in
/// web/src/features/driving/components/drivetrain-health/DetailCards.tsx, with the temperature formatting from
/// <c>useUnits().formatTemperature</c>, the energy formatting from <c>useUnits().formatEnergy</c> (which the web
/// hook pins to kWh regardless of the metric / imperial system), and the value formatting from
/// <c>fmtNumber</c> / <c>fmtInt</c>. Every label resolves through the i18n facade; no WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class DetailCardsProjection
{
    /// <summary>The Segoe Fluent glyph for the empty surface (web lucide <c>Thermometer</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Precision for the integer Peak-Power row (web <c>fmtInt</c>).</summary>
    public const int PeakPowerPrecision = 0;

    /// <summary>Precision for the one-decimal power / energy / CO₂ rows (web <c>fmtNumber(x, 1)</c>).</summary>
    public const int OneDecimal = 1;

    /// <summary>The kilowatt unit suffix shared by the power rows (web literal <c>" kW"</c>).</summary>
    public const string KilowattSuffix = " kW";

    /// <summary>The kilogram unit suffix for the CO₂ row (web literal <c>" kg"</c>).</summary>
    public const string KilogramSuffix = " kg";

    /// <summary>
    /// Project <paramref name="snapshot"/> into the two detail cards using the user's units. Card order, row
    /// order, labels, value precision and unit suffixes mirror the web component exactly.
    /// </summary>
    /// <param name="snapshot">The drivetrain detail snapshot.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <returns>The render-ready display model.</returns>
    public static DetailCardsDisplay Project(DetailCardsSnapshot snapshot, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var cards = new List<DetailCardsCard>(2)
        {
            BuildTemperatureCard(snapshot, units, localizer),
            BuildPowerCard(snapshot, units, localizer),
        };

        return new DetailCardsDisplay(true, cards);
    }

    private static DetailCardsCard BuildTemperatureCard(DetailCardsSnapshot snapshot, UnitPref units, ILocalizer localizer)
    {
        // web displayTemp: null → '—', else formatTemperature(celsius). FormatTemperature already returns the
        // em-dash empty fallback for a null / non-finite reading.
        var rows = new List<DetailCardsRow>(4)
        {
            Row(localizer.GetString("drivetrain.frontMotorTemp", "Front Motor Temp"),
                UnitFormatters.FormatTemperature(snapshot.FrontMotorTempC, units)),
            Row(localizer.GetString("drivetrain.rearMotorTemp", "Rear Motor Temp"),
                UnitFormatters.FormatTemperature(snapshot.RearMotorTempC, units)),
            Row(localizer.GetString("drivetrain.inverterTemp", "Inverter Temp"),
                UnitFormatters.FormatTemperature(snapshot.InverterTempC, units)),
            Row(localizer.GetString("drivetrain.batteryTemp", "Battery Temp"),
                UnitFormatters.FormatTemperature(snapshot.BatteryTempC, units)),
        };

        string title = localizer.GetString("drivetrain.temperatures", "Temperature Details");
        return new DetailCardsCard(title, rows, title);
    }

    private static DetailCardsCard BuildPowerCard(DetailCardsSnapshot snapshot, UnitPref units, ILocalizer localizer)
    {
        var power = snapshot.Power;
        var stats = snapshot.Stats;

        // web parity: useUnits() always formats energy in kWh (DEFAULT_ENERGY_PREF='kWh') regardless of the
        // distance / temperature system, so pin the energy formatter pref to kWh here.
        UnitPref energyPref = units with { Energy = EnergyUnit.Kwh };

        var rows = new List<DetailCardsRow>(5)
        {
            // web: peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'
            Row(localizer.GetString("drivetrain.peakPowerLabel", "Peak Power"),
                power.PeakKw > 0
                    ? ScalarFormatters.FormatNumber(power.PeakKw, PeakPowerPrecision) + KilowattSuffix
                    : UnitFormatters.DefaultEmptyDisplay),

            // web: avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—'
            Row(localizer.GetString("drivetrain.avgPowerLabel", "Avg Peak Power"),
                power.AvgKw > 0
                    ? ScalarFormatters.FormatNumber(power.AvgKw, OneDecimal) + KilowattSuffix
                    : UnitFormatters.DefaultEmptyDisplay),

            // web: minRegenPower < 0 ? `${fmtNumber(Math.abs(minRegenPower), 1)} kW` : '—'
            Row(localizer.GetString("drivetrain.maxRegenLabel", "Max Regen"),
                power.MinRegenKw < 0
                    ? ScalarFormatters.FormatNumber(Math.Abs(power.MinRegenKw), OneDecimal) + KilowattSuffix
                    : UnitFormatters.DefaultEmptyDisplay),

            // web: stats ? formatEnergy(stats.regenEnergyWh, { precision: 1 }) : '—'
            Row(localizer.GetString("drivetrain.regenLabel", "Total Regen"),
                stats is not null
                    ? UnitFormatters.FormatEnergy(stats.RegenEnergyWh, energyPref, OneDecimal)
                    : UnitFormatters.DefaultEmptyDisplay),

            // web: stats ? `${fmtNumber(stats.co2SavedKg, 1)} kg` : '—' (fmtNumber(undefined) → 0)
            Row(localizer.GetString("drivetrain.co2Label", "CO\u2082 Saved"),
                stats is not null
                    ? ScalarFormatters.FormatNumber(stats.Co2SavedKg ?? 0, OneDecimal) + KilogramSuffix
                    : UnitFormatters.DefaultEmptyDisplay),
        };

        string title = localizer.GetString("drivetrain.powerSummary", "Power Summary");
        return new DetailCardsCard(title, rows, title);
    }

    private static DetailCardsRow Row(string label, string value) =>
        new(label, value, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DetailCardsSnapshot&gt;</c>, injecting the separately resolved Power-Summary figures
/// and lifetime stats and preserving every freshness flag (cached / refreshing / stale / offline) so the
/// view-model can render the full state matrix. Kept pure so the parse-and-preserve contract is unit-tested
/// without a network or cache.
/// </summary>
public static class DetailCardsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) with the resolved <paramref name="power"/> and <paramref name="stats"/> while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission carrying the drivetrain-health JSON.</param>
    /// <param name="power">The recent-drive Power-Summary figures resolved alongside.</param>
    /// <param name="stats">The lifetime driving stats resolved alongside, or null.</param>
    /// <returns>The parsed emission with its status preserved.</returns>
    public static RepositoryResult<DetailCardsSnapshot> Map(
        RepositoryResult<JsonElement> raw,
        DrivetrainPowerSummary power,
        DetailCardsStats? stats)
    {
        ArgumentNullException.ThrowIfNull(raw);
        ArgumentNullException.ThrowIfNull(power);

        DetailCardsSnapshot Parse() => raw.HasValue
            ? DetailCardsSnapshot.FromJson(raw.Value, power, stats)
            : DetailCardsSnapshot.FromJson(default, power, stats);

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DetailCardsSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<DetailCardsSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DetailCardsSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DetailCardsSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DetailCardsSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DetailCardsSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DetailCardsSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Detail Cards surface — the native mirror of the web component
/// (web/src/features/driving/components/drivetrain-health/DetailCards.tsx, rendered by the Drivetrain-Health
/// page). Centralises the stable id, category and diagnostics slug so the view and view-model stay free of
/// literal identifiers.
/// </summary>
public static class DetailCardsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "detail-cards";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DetailCards";
}

/// <summary>
/// PII-safe diagnostics for the Detail Cards surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a temperature value, power figure, VIN
/// or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DetailCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional redacting diagnostics sink.</param>
    public DetailCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DetailCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DetailCardsRegistration.Slug}");
    }
}
