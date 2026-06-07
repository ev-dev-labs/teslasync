using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargePlansViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargePlansWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/ChargePlansWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData</c> gate (no charge
/// plans and no rate plans) in addition to an empty HTTP body.
/// </summary>
public enum ChargePlansState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with at least one plan or rate plan.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no plans and no rate plans — render the empty state.</summary>
    Empty,

    /// <summary>Both reads failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> (<c>size.cols &lt;= 1</c>) and <c>compact</c> detail-card (<c>size.rows &lt;= 3</c>)
/// logic in web/src/features/dashboard/widgets/ChargePlansWidget.tsx.
/// </summary>
public readonly record struct ChargePlansSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static ChargePlansSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the compact target-SOC layout.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True when short (web <c>compact={size.rows &lt;= 3}</c>): detail cards cap at four rows.</summary>
    public bool DetailsCompact => Rows <= 3;
}

/// <summary>
/// The user's monetary display preferences the surface needs to price plan estimates — the native
/// analogue of the web <c>useFormatting().formatCurrency</c> inputs derived from <c>useSettings</c>
/// (web/src/hooks/useFormatting.ts): the currency symbol and the default fraction-digit precision. The
/// view-model owns one instance and re-projects when it changes.
/// </summary>
/// <param name="CurrencySymbol">Currency symbol (web <c>settings.currency_symbol</c> or "$").</param>
/// <param name="DecimalPrecision">Default fraction digits (web <c>settings.decimal_precision</c> or 2).</param>
public sealed record ChargePlansSettings(
    string CurrencySymbol = "$",
    int DecimalPrecision = 2)
{
    /// <summary>The all-default preference bundle ("$", 2 decimal places).</summary>
    public static ChargePlansSettings Default { get; } = new();

    /// <summary>The currency symbol with the web's blank/whitespace → "$" fallback applied.</summary>
    public string ResolvedSymbol => string.IsNullOrWhiteSpace(CurrencySymbol) ? "$" : CurrencySymbol;

    /// <summary>The decimal precision floored at zero (non-negative).</summary>
    public int ResolvedPrecision => DecimalPrecision < 0 ? 0 : DecimalPrecision;
}

/// <summary>
/// One charge plan from <c>GET /charge-planner/history</c> (web <c>ChargePlan</c> in
/// web/src/types/charging.ts). Only the fields the web component reads are projected; parsing is
/// null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Id">Plan id (web <c>id</c>); used as a stable row key.</param>
/// <param name="TargetSoc">Target state-of-charge percentage (web <c>target_soc</c>).</param>
/// <param name="DepartBy">Requested departure instant (web <c>depart_by</c>), or null.</param>
/// <param name="ScheduledStart">Scheduled charge start (web <c>scheduled_start</c>), or null.</param>
/// <param name="ScheduledEnd">Scheduled charge end (web <c>scheduled_end</c>), or null.</param>
/// <param name="RatePlan">Rate plan label (web <c>rate_plan</c>), or null.</param>
/// <param name="EstimatedKwh">Estimated energy in kWh (web <c>estimated_kwh</c>), or null.</param>
/// <param name="EstimatedCost">Estimated cost (web <c>estimated_cost</c>), or null.</param>
/// <param name="Savings">Estimated savings vs charge-now (web <c>savings</c>), or null.</param>
/// <param name="Status">Plan status (web <c>status</c>): active / scheduled / completed / failed / …</param>
public sealed record ChargePlan(
    long Id,
    double TargetSoc,
    DateTimeOffset? DepartBy,
    DateTimeOffset? ScheduledStart,
    DateTimeOffset? ScheduledEnd,
    string? RatePlan,
    double? EstimatedKwh,
    double? EstimatedCost,
    double? Savings,
    string Status)
{
    /// <summary>Parse a charge-plan JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<ChargePlan> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargePlan>();
        }

        var list = new List<ChargePlan>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charge-plan JSON object into a tolerant row.</summary>
    public static ChargePlan FromJson(JsonElement obj) => new(
        Id: ChargePlansJson.GetLong(obj, "id") ?? 0,
        TargetSoc: ChargePlansJson.GetDouble(obj, "target_soc") ?? 0,
        DepartBy: ChargePlansJson.GetTimestamp(obj, "depart_by"),
        ScheduledStart: ChargePlansJson.GetTimestamp(obj, "scheduled_start"),
        ScheduledEnd: ChargePlansJson.GetTimestamp(obj, "scheduled_end"),
        RatePlan: ChargePlansJson.GetString(obj, "rate_plan"),
        EstimatedKwh: ChargePlansJson.GetDouble(obj, "estimated_kwh"),
        EstimatedCost: ChargePlansJson.GetDouble(obj, "estimated_cost"),
        Savings: ChargePlansJson.GetDouble(obj, "savings"),
        Status: ChargePlansJson.GetString(obj, "status") ?? string.Empty);
}

/// <summary>
/// One time-of-use rate plan from <c>GET /charge-planner/rate-plans</c> (web <c>RatePlanInfo</c> in
/// web/src/types/charging.ts): the utility, the human label, and the plan id. Parsing is null-tolerant.
/// </summary>
/// <param name="Id">Rate plan id (web <c>id</c>), or null.</param>
/// <param name="Name">Human-readable plan name (web <c>name</c>), or null.</param>
/// <param name="Utility">Owning utility (web <c>utility</c>), or null.</param>
public sealed record RatePlanInfo(string? Id, string? Name, string? Utility)
{
    /// <summary>Parse a rate-plan JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<RatePlanInfo> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RatePlanInfo>();
        }

        var list = new List<RatePlanInfo>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single rate-plan JSON object into a tolerant row.</summary>
    public static RatePlanInfo FromJson(JsonElement obj) => new(
        Id: ChargePlansJson.GetString(obj, "id"),
        Name: ChargePlansJson.GetString(obj, "name"),
        Utility: ChargePlansJson.GetString(obj, "utility"));
}

/// <summary>
/// The combined read-model the surface renders — the native analogue of the web component's two
/// independent hooks (<c>useChargePlans</c> + <c>useRatePlans</c>) merged into one snapshot. The web
/// <c>hasData</c> gate is <c>plans.length &gt; 0 || rates.length &gt; 0</c>.
/// </summary>
/// <param name="Plans">The charge-plan history rows (newest-first as the API returns them).</param>
/// <param name="Rates">The available time-of-use rate plans.</param>
public sealed record ChargePlansSnapshot(
    IReadOnlyList<ChargePlan> Plans,
    IReadOnlyList<RatePlanInfo> Rates)
{
    /// <summary>An empty snapshot — the projection basis before any data resolves.</summary>
    public static ChargePlansSnapshot Empty { get; } = new(Array.Empty<ChargePlan>(), Array.Empty<RatePlanInfo>());

    /// <summary>True when there is at least one plan or rate plan to render (web <c>hasData</c>).</summary>
    public bool HasData => Plans.Count > 0 || Rates.Count > 0;
}

/// <summary>The semantic tint of a <see cref="DetailEntry"/> badge (web <c>DetailEntry.badge.variant</c>).</summary>
/// <param name="Text">The short badge caption.</param>
/// <param name="Kind">The status colour (the web <c>error</c> variant maps to <see cref="StatusKind.Danger"/>).</param>
public sealed record DetailBadge(string Text, StatusKind Kind);

/// <summary>
/// One label/value row in a detail list — the native port of the web <c>DetailEntry</c> rendered by
/// <c>WidgetDetailCard</c> (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx). Pure data
/// with a pre-built Narrator <see cref="AutomationName"/>; no WinUI types.
/// </summary>
/// <param name="Label">The localized row label.</param>
/// <param name="Value">The pre-formatted value (em-dash when absent).</param>
/// <param name="Badge">An optional trailing status chip.</param>
/// <param name="Mono">True to render the value in a monospace face (web <c>mono</c>).</param>
/// <param name="AutomationName">The Narrator name combining label, value and any badge.</param>
public sealed record DetailEntry(
    string Label,
    string Value,
    DetailBadge? Badge,
    bool Mono,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the charge plans + rate plans for one footprint — the
/// native analogue of everything the web component computes before returning JSX. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when there is a plan or rate plan (web <c>hasData</c>).</param>
/// <param name="IsCompact">True at a single column (the compact target-SOC layout).</param>
/// <param name="DetailsCompact">True when short (detail lists cap at four rows).</param>
/// <param name="HasActivePlan">True when an active/scheduled (or any) plan is selected.</param>
/// <param name="CompactTargetValue">The compact big target-SOC value (e.g. "80%").</param>
/// <param name="CompactTargetLabel">The compact "Target SOC" caption.</param>
/// <param name="CompactDeparture">The compact departure time, or null when none.</param>
/// <param name="CompactAutomationName">The Narrator name for the compact layout.</param>
/// <param name="StatusText">The active plan's status badge text (web <c>status ?? '—'</c>).</param>
/// <param name="StatusKind">The active plan's status badge colour.</param>
/// <param name="RatePlanText">The active plan's rate-plan caption (web <c>rate_plan ?? ''</c>).</param>
/// <param name="TargetSocLabel">The Target SOC stat label.</param>
/// <param name="TargetSocValue">The Target SOC stat value.</param>
/// <param name="DepartureLabel">The Departure stat label.</param>
/// <param name="DepartureValue">The Departure stat value.</param>
/// <param name="PlanEntries">The remaining plan detail rows (web <c>planEntries.slice(2)</c>).</param>
/// <param name="HasRates">True when there is at least one rate plan to show.</param>
/// <param name="RatePlansHeading">The "Rate Plans" section heading.</param>
/// <param name="RateEntries">The rate-plan detail rows.</param>
/// <param name="NoPlansMessage">The "No charge plans" empty message.</param>
/// <param name="NoDetailsMessage">The "No plan details" empty message.</param>
/// <param name="NoRatesMessage">The "No rate plans" empty message.</param>
/// <param name="NoDataMessage">The "No charge plans or rate data" empty message.</param>
/// <param name="HeaderGlyph">The Segoe Fluent header / empty glyph (web <c>Clock</c>).</param>
public sealed record ChargePlansDisplay(
    bool HasData,
    bool IsCompact,
    bool DetailsCompact,
    bool HasActivePlan,
    string CompactTargetValue,
    string CompactTargetLabel,
    string? CompactDeparture,
    string CompactAutomationName,
    string StatusText,
    StatusKind StatusKind,
    string RatePlanText,
    string TargetSocLabel,
    string TargetSocValue,
    string DepartureLabel,
    string DepartureValue,
    IReadOnlyList<DetailEntry> PlanEntries,
    bool HasRates,
    string RatePlansHeading,
    IReadOnlyList<DetailEntry> RateEntries,
    string NoPlansMessage,
    string NoDetailsMessage,
    string NoRatesMessage,
    string NoDataMessage,
    string HeaderGlyph);

/// <summary>
/// Pure projection from a <see cref="ChargePlansSnapshot"/> to the display model — the native port of
/// the active-plan selection, the <c>planEntries</c>/<c>rateEntries</c> assembly, the
/// <c>useFormatting</c>/<c>useDateFormat</c> helpers, and the JSX in
/// web/src/features/dashboard/widgets/ChargePlansWidget.tsx. Every label resolves through the i18n
/// facade; no WinUI types are referenced so the projection is unit-tested headlessly.
/// </summary>
public static class ChargePlansProjection
{
    private const string EmDash = "\u2014";

    /// <summary>The header / empty-state glyph (Segoe Fluent "Clock"; web <c>Clock</c> icon).</summary>
    public const string HeaderGlyph = "\uE823";

    /// <summary>The accent brush tinting the header clock icon (web cyan).</summary>
    public const string HeaderAccentBrushKey = "TsColorInfoBrush";

    /// <summary>
    /// Select the plan the surface focuses on — the native port of the web
    /// <c>plans.find(active|scheduled) ?? plans[0] ?? null</c>.
    /// </summary>
    public static ChargePlan? SelectActivePlan(IReadOnlyList<ChargePlan> plans)
    {
        ArgumentNullException.ThrowIfNull(plans);

        foreach (var plan in plans)
        {
            if (IsActiveStatus(plan.Status))
            {
                return plan;
            }
        }

        return plans.Count > 0 ? plans[0] : null;
    }

    /// <summary>Map a plan status to its badge colour (web <c>badgeVariant</c> / <c>detailBadgeVariant</c>).</summary>
    public static StatusKind StatusKindFor(string status) => status switch
    {
        "completed" => StatusKind.Success,
        "active" or "scheduled" => StatusKind.Warning,
        "failed" or "cancelled" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the active currency settings.</summary>
    public static ChargePlansDisplay Project(
        ChargePlansSnapshot snapshot,
        ChargePlansSettings settings,
        ChargePlansSize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(localizer);

        var activePlan = SelectActivePlan(snapshot.Plans);

        string targetLabel = localizer.GetString("widget.chargePlans.targetSoc", "Target SOC");
        string departureLabel = localizer.GetString("widget.chargePlans.departure", "Departure");

        string targetValue = FormatPercent(activePlan?.TargetSoc ?? 0);
        string departureValue = activePlan?.DepartBy is { } depart ? FormatTime(depart, now) : EmDash;
        string? compactDeparture = activePlan?.DepartBy is { } d ? FormatTime(d, now) : null;

        string compactAutomationName = BuildCompactAutomationName(targetValue, targetLabel, compactDeparture);

        string statusText = string.IsNullOrEmpty(activePlan?.Status) ? EmDash : activePlan!.Status;
        var statusKind = StatusKindFor(activePlan?.Status ?? string.Empty);
        string ratePlanText = activePlan?.RatePlan ?? string.Empty;

        var planEntries = activePlan is null
            ? Array.Empty<DetailEntry>()
            : BuildPlanEntries(activePlan, settings, localizer, now);
        var rateEntries = BuildRateEntries(snapshot.Rates);

        return new ChargePlansDisplay(
            HasData: snapshot.HasData,
            IsCompact: size.IsCompact,
            DetailsCompact: size.DetailsCompact,
            HasActivePlan: activePlan is not null,
            CompactTargetValue: targetValue,
            CompactTargetLabel: targetLabel,
            CompactDeparture: compactDeparture,
            CompactAutomationName: compactAutomationName,
            StatusText: statusText,
            StatusKind: statusKind,
            RatePlanText: ratePlanText,
            TargetSocLabel: targetLabel,
            TargetSocValue: targetValue,
            DepartureLabel: departureLabel,
            DepartureValue: departureValue,
            PlanEntries: planEntries,
            HasRates: snapshot.Rates.Count > 0,
            RatePlansHeading: localizer.GetString("widget.chargePlans.ratePlans", "Rate Plans"),
            RateEntries: rateEntries,
            NoPlansMessage: localizer.GetString("widget.chargePlans.noPlans", "No charge plans"),
            NoDetailsMessage: localizer.GetString("widget.chargePlans.noDetails", "No plan details"),
            NoRatesMessage: localizer.GetString("widget.chargePlans.noRates", "No rate plans"),
            NoDataMessage: localizer.GetString("widget.chargePlans.noData", "No charge plans or rate data"),
            HeaderGlyph: HeaderGlyph);
    }

    /// <summary>
    /// Build the full ordered plan detail list — the native port of the web <c>planEntries</c> memo
    /// (Target SOC, Departure, Scheduled Start/End, Est. Energy/Cost, optional Savings, Rate Plan). The
    /// view renders <c>planEntries.slice(2)</c>; the first two are surfaced as stat cards. Returned in
    /// full so the projection can be asserted end-to-end.
    /// </summary>
    public static IReadOnlyList<DetailEntry> BuildFullPlanEntries(
        ChargePlan plan,
        ChargePlansSettings settings,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(localizer);

        var items = new List<DetailEntry>(8)
        {
            Entry(
                localizer.GetString("widget.chargePlans.targetSoc", "Target SOC"),
                FormatPercent(plan.TargetSoc),
                new DetailBadge(
                    string.IsNullOrEmpty(plan.Status) ? EmDash : plan.Status,
                    StatusKindFor(plan.Status))),
            Entry(
                localizer.GetString("widget.chargePlans.departure", "Departure"),
                plan.DepartBy is { } depart ? FormatTime(depart, now) : EmDash),
            Entry(
                localizer.GetString("widget.chargePlans.schedStart", "Scheduled Start"),
                FormatDateTime(plan.ScheduledStart, now)),
            Entry(
                localizer.GetString("widget.chargePlans.schedEnd", "Scheduled End"),
                FormatDateTime(plan.ScheduledEnd, now)),
            Entry(
                localizer.GetString("widget.chargePlans.estEnergy", "Est. Energy"),
                plan.EstimatedKwh is { } kwh
                    ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", ScalarFormatters.FormatNumber(kwh, 1), localizer.GetString("widget.chargePlans.kwh", "kWh"))
                    : EmDash),
            Entry(
                localizer.GetString("widget.chargePlans.estCost", "Est. Cost"),
                plan.EstimatedCost is { } cost ? FormatCurrency(cost, settings) : EmDash),
        };

        if (plan.Savings is { } savings && savings > 0)
        {
            items.Add(Entry(
                localizer.GetString("widget.chargePlans.savings", "Savings"),
                FormatCurrency(savings, settings),
                new DetailBadge(localizer.GetString("widget.chargePlans.saved", "saved"), StatusKind.Success)));
        }

        items.Add(Entry(
            localizer.GetString("widget.chargePlans.ratePlan", "Rate Plan"),
            plan.RatePlan ?? EmDash));

        return items;
    }

    private static IReadOnlyList<DetailEntry> BuildPlanEntries(
        ChargePlan plan,
        ChargePlansSettings settings,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        // Web parity: the standard layout renders planEntries.slice(2) — the first two entries
        // (Target SOC, Departure) are surfaced as stat cards instead.
        var full = BuildFullPlanEntries(plan, settings, localizer, now);
        if (full.Count <= 2)
        {
            return Array.Empty<DetailEntry>();
        }

        var sliced = new List<DetailEntry>(full.Count - 2);
        for (int i = 2; i < full.Count; i++)
        {
            sliced.Add(full[i]);
        }

        return sliced;
    }

    private static IReadOnlyList<DetailEntry> BuildRateEntries(IReadOnlyList<RatePlanInfo> rates)
    {
        if (rates.Count == 0)
        {
            return Array.Empty<DetailEntry>();
        }

        var entries = new List<DetailEntry>(rates.Count);
        foreach (var rate in rates)
        {
            // Web parity: { label: utility, value: name, badge: { text: id, neutral }, mono: true }.
            entries.Add(Entry(
                rate.Utility ?? EmDash,
                rate.Name ?? EmDash,
                new DetailBadge(rate.Id ?? EmDash, StatusKind.Neutral),
                mono: true));
        }

        return entries;
    }

    /// <summary>Format a target-SOC percentage as an integer with a trailing "%" (web <c>fmtInt</c>).</summary>
    public static string FormatPercent(double value) =>
        string.Concat(ScalarFormatters.FormatNumber(value, 0), "%");

    /// <summary>Format a currency amount — the native port of <c>useFormatting.formatCurrency</c>.</summary>
    public static string FormatCurrency(double amount, ChargePlansSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return ScalarFormatters.FormatCurrency(amount, settings.ResolvedSymbol, settings.ResolvedPrecision);
    }

    /// <summary>Format a time-of-day — the native port of <c>useDateFormat.formatTime</c> ("02:30 PM").</summary>
    public static string FormatTime(DateTimeOffset value, DateTimeOffset now) =>
        DateTimeFormatting.Format(value, DateTimeVariant.Time, now);

    /// <summary>
    /// Format "{short date} {time}" — the native port of the web
    /// <c>`${formatDateShort(x)} ${formatTime(x)}`</c> ("Apr 4 02:30 PM"). A null instant renders the
    /// web's "— —".
    /// </summary>
    public static string FormatDateTime(DateTimeOffset? value, DateTimeOffset now)
    {
        string date = DateTimeFormatting.Format(value, DateTimeVariant.Short, now);
        string time = DateTimeFormatting.Format(value, DateTimeVariant.Time, now);
        return string.Format(CultureInfo.CurrentCulture, "{0} {1}", date, time);
    }

    private static DetailEntry Entry(string label, string value, DetailBadge? badge = null, bool mono = false) =>
        new(label, value, badge, mono, BuildEntryAutomationName(label, value, badge));

    private static string BuildEntryAutomationName(string label, string value, DetailBadge? badge) =>
        badge is null
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, badge.Text);

    private static string BuildCompactAutomationName(string value, string label, string? departure) =>
        departure is null
            ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}", value, label)
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", value, label, departure);

    private static bool IsActiveStatus(string status) =>
        string.Equals(status, "active", StringComparison.Ordinal) ||
        string.Equals(status, "scheduled", StringComparison.Ordinal);
}

/// <summary>
/// Merges the two raw cache-then-network reads (charge-plan history + rate plans) into a single
/// <c>RepositoryResult&lt;ChargePlansSnapshot&gt;</c>, reproducing the web component's flag combination
/// (<c>isLoading = either</c>, <c>isError = either</c>, <c>hasData = either non-empty</c>,
/// <c>updatedAt = max</c>). Kept pure so the merge contract is unit-tested without a network or cache.
/// </summary>
public static class ChargePlansResultMapper
{
    private static readonly RepositoryError UnknownError =
        new(RepositoryErrorKind.Unknown, "Unknown error");

    /// <summary>
    /// Combine the latest plans / rates emissions into one snapshot result. Either side may be null
    /// (not yet emitted). Content is always surfaced when present (refreshing / offline / stale /
    /// loaded); a hard failure surfaces only when neither side produced any data.
    /// </summary>
    public static RepositoryResult<ChargePlansSnapshot> Combine(
        RepositoryResult<JsonElement>? plans,
        RepositoryResult<JsonElement>? rates)
    {
        var snapshot = new ChargePlansSnapshot(ParsePlans(plans), ParseRates(rates));
        bool hasData = snapshot.HasData;

        bool anyPending = IsPending(plans) || IsPending(rates);
        bool anyValue = HasContent(plans) || HasContent(rates);
        bool anyOffline = plans?.Status == LoadStatus.Offline || rates?.Status == LoadStatus.Offline;
        bool anyStale = (plans?.IsStale ?? false) || (rates?.IsStale ?? false);
        bool anyFailed = plans?.Status == LoadStatus.Error || rates?.Status == LoadStatus.Error;

        DateTimeOffset at = MaxAt(plans?.FetchedAt, rates?.FetchedAt) ?? DateTimeOffset.UtcNow;
        RepositoryError error = plans?.Error ?? rates?.Error ?? UnknownError;

        // 1) First load still in flight with nothing to show yet.
        if (!anyValue && !hasData && anyPending)
        {
            return RepositoryResult<ChargePlansSnapshot>.Loading();
        }

        // 2) Content present — surface it (offline / cached-or-stale / loaded). The view-model routes
        //    an empty snapshot to its empty state, matching the web hasData gate.
        if (anyValue)
        {
            if (anyOffline)
            {
                return RepositoryResult<ChargePlansSnapshot>.OfflineCached(snapshot, at, error);
            }

            // A side still refreshing, or a terminal stale cache: surface the content as cached. The
            // view-model shows a stale snapshot behind the stale chip and a fresh one as loaded.
            if (anyPending || anyStale)
            {
                return RepositoryResult<ChargePlansSnapshot>.Cached(snapshot, at, anyStale);
            }

            return RepositoryResult<ChargePlansSnapshot>.Loaded(snapshot, at);
        }

        // 3) No value at all. A hard failure surfaces the error; otherwise the read was simply empty.
        if (anyFailed)
        {
            return RepositoryResult<ChargePlansSnapshot>.Failure(error);
        }

        return RepositoryResult<ChargePlansSnapshot>.Empty(MaxAt(plans?.FetchedAt, rates?.FetchedAt));
    }

    private static IReadOnlyList<ChargePlan> ParsePlans(RepositoryResult<JsonElement>? side) =>
        HasContent(side) ? ChargePlan.ParseList(side!.Value) : Array.Empty<ChargePlan>();

    private static IReadOnlyList<RatePlanInfo> ParseRates(RepositoryResult<JsonElement>? side) =>
        HasContent(side) ? RatePlanInfo.ParseList(side!.Value) : Array.Empty<RatePlanInfo>();

    // A side "has content" when its status carries a usable payload. RepositoryResult<JsonElement>
    // cannot use HasValue here — JsonElement is a struct, so its default is never null and HasValue is
    // always true; the load status is the reliable signal.
    private static bool HasContent(RepositoryResult<JsonElement>? side) =>
        side is not null && side.Status is LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline;

    // A side is still "pending" (more emissions expected) before it starts, while loading, while a
    // cached value is shown awaiting the network, and while actively refreshing.
    private static bool IsPending(RepositoryResult<JsonElement>? side) =>
        side is null || side.Status is LoadStatus.Loading or LoadStatus.Cached or LoadStatus.Refreshing;

    private static DateTimeOffset? MaxAt(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a.Value >= b.Value ? a : b;
    }
}

/// <summary>
/// Null-tolerant JSON field readers shared by <see cref="ChargePlan"/> and <see cref="RatePlanInfo"/>.
/// A missing, null, or wrong-kind field yields null rather than throwing, so a partial wire row never
/// breaks the surface.
/// </summary>
internal static class ChargePlansJson
{
    public static double? GetDouble(JsonElement obj, string name)
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

    public static long? GetLong(JsonElement obj, string name)
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

    public static string? GetString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var s = v.GetString();
        return string.IsNullOrEmpty(s) ? null : s;
    }

    public static DateTimeOffset? GetTimestamp(JsonElement obj, string name)
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
