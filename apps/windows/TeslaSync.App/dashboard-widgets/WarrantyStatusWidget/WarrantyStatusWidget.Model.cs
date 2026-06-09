using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="WarrantyStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>WarrantyStatusWidget</c> renders
/// through <c>WidgetShell</c> + <c>MetricBar</c> + <c>WidgetDetailCard</c>
/// (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. The web's single empty surface ("No warranty data") shows whenever the warranty
/// <c>data</c> object is null (web <c>warrantyData ? … : &lt;EmptyState&gt;</c>), so a single
/// <see cref="Empty"/> models all of those.
/// </summary>
public enum WarrantyStatusState
{
    /// <summary>Initial fetch with no cached payload — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data (or non-stale cache) carrying a warranty <c>data</c> object.</summary>
    Loaded,

    /// <summary>No warranty data resolved — render the "No warranty data" empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx, which swaps the progress-bar + detail body for
/// the centred days-remaining + Active/Expired summary.
/// </summary>
public readonly record struct WarrantyStatusSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static WarrantyStatusSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// The cache-then-network payload backing the widget: the raw warranty <c>data</c> object from the
/// <c>GET /tesla/warranty</c> envelope (web <c>envelope?.data ?? null</c>), kept as its raw JSON text so the
/// localized / time-relative parse runs at the display boundary (exactly as the web re-derives every field on
/// each render). <see cref="DataJson"/> is null when the envelope carried no <c>data</c> object (the web's
/// null <c>warrantyData</c>, which renders the empty surface). The record round-trips losslessly through the
/// cache (System.Text.Json).
/// </summary>
public sealed record WarrantyStatusSnapshot(string? DataJson)
{
    /// <summary>The no-data snapshot (null <c>data</c>) — renders the "No warranty data" empty surface.</summary>
    public static WarrantyStatusSnapshot None { get; } = new((string?)null);

    /// <summary>
    /// Project the <c>{ data, fetched_at }</c> warranty envelope into the snapshot — the native
    /// <c>envelope?.data ?? null</c>. The <c>data</c> object's raw JSON is retained when present; an absent /
    /// JSON-null / non-object <c>data</c> yields <see cref="None"/> (the web's null <c>warrantyData</c>).
    /// </summary>
    public static WarrantyStatusSnapshot FromEnvelope(JsonElement envelope)
    {
        if (envelope.ValueKind == JsonValueKind.Object &&
            envelope.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            return new WarrantyStatusSnapshot(data.GetRawText());
        }

        return None;
    }
}

/// <summary>
/// Tolerant, null-safe readers porting the web component's <c>asString</c> / <c>asNumber</c> / <c>?? null</c>
/// access plus the JavaScript truthiness the coverage scan relies on
/// (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). Kept UI-free so the whole parse is
/// unit-tested headlessly.
/// </summary>
internal static class WarrantyStatusJson
{
    /// <summary>
    /// Port of the web <c>asString</c>: a non-empty string returns itself, a number returns its literal,
    /// anything else (bool / null / object / array / empty string) returns null.
    /// </summary>
    internal static string? AsString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString() is { Length: > 0 } s ? s : null,
        JsonValueKind.Number => value.GetRawText(),
        _ => null,
    };

    /// <summary>
    /// Port of the web <c>asNumber</c>: a finite number returns itself; a string is run through
    /// JavaScript <c>Number(val)</c> and returned when finite (the empty / whitespace string is
    /// <c>Number('') === 0</c>); anything else (bool / null / object / array / non-numeric string) returns null.
    /// </summary>
    internal static double? AsNumber(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Number:
                return value.TryGetDouble(out var d) && double.IsFinite(d) ? d : null;
            case JsonValueKind.String:
                return TryJsNumber(value.GetString(), out var n) ? n : null;
            default:
                return null;
        }
    }

    /// <summary>
    /// Reproduces JavaScript <c>Number(string)</c> for the realistic warranty inputs: an empty / whitespace
    /// string is <c>0</c>, an invariant decimal / signed / exponent string parses to its finite value, and a
    /// non-numeric string fails (the web's <c>NaN</c> → null).
    /// </summary>
    private static bool TryJsNumber(string? raw, out double value)
    {
        if (raw is null)
        {
            value = 0;
            return false;
        }

        if (raw.Trim().Length == 0)
        {
            value = 0;
            return true;
        }

        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value) && double.IsFinite(value))
        {
            return true;
        }

        value = 0;
        return false;
    }

    /// <summary>
    /// Port of the web nullish chain <c>data.a ?? data.b ?? data.c</c>: the first property that is present and
    /// not JSON-null (an absent property is JavaScript <c>undefined</c>; a JSON-null value falls through). A
    /// present <c>false</c> / <c>0</c> / <c>""</c> short-circuits the chain (it is not nullish) and is returned.
    /// </summary>
    internal static JsonElement? FirstPresent(JsonElement obj, params string[] names)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var name in names)
        {
            if (obj.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null)
            {
                return v;
            }
        }

        return null;
    }

    /// <summary>Port of <c>asString(data.a ?? data.b ?? …)</c>: <see cref="AsString"/> of <see cref="FirstPresent"/>.</summary>
    internal static string? AsStringFrom(JsonElement obj, params string[] names) =>
        FirstPresent(obj, names) is { } v ? AsString(v) : null;

    /// <summary>Port of <c>asNumber(data.a ?? data.b ?? …)</c>: <see cref="AsNumber"/> of <see cref="FirstPresent"/>.</summary>
    internal static double? AsNumberFrom(JsonElement obj, params string[] names) =>
        FirstPresent(obj, names) is { } v ? AsNumber(v) : null;

    /// <summary>Read one property through <see cref="AsString"/> (absent / wrong-kind → null).</summary>
    internal static string? AsStringProp(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) ? AsString(v) : null;

    /// <summary>
    /// True when a coverage flag is "present" — the web guard <c>covVal != null &amp;&amp; covVal !== false
    /// &amp;&amp; covVal !== ''</c>. Absent, JSON-null, <c>false</c> and the empty string are NOT present;
    /// everything else (including <c>0</c>, <c>true</c>, dates, objects) is.
    /// </summary>
    internal static bool IsCoveragePresent(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var value))
        {
            return value.ValueKind switch
            {
                JsonValueKind.Null => false,
                JsonValueKind.False => false,
                JsonValueKind.String => value.GetString()?.Length > 0,
                _ => true,
            };
        }

        return false;
    }
}

/// <summary>
/// One parsed warranty coverage type — the native analogue of an element of the web <c>COVERAGE_TYPES</c>
/// scan (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). Holds the i18n <see cref="LabelKey"/> /
/// <see cref="Fallback"/> (resolved at the display boundary), the raw <see cref="ExpiryDate"/> string (or null
/// for an "Included" coverage with no end date) and whether the coverage is still <see cref="Active"/>. Pure
/// data — unit-tested without a UI host.
/// </summary>
public sealed record WarrantyCoverage(string LabelKey, string Fallback, string? ExpiryDate, bool Active);

/// <summary>
/// The fully parsed warranty payload — the native analogue of the field-by-field extraction the web component
/// performs before building its JSX (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). All values
/// are raw / SI (mileages are converted to the user's unit at the display boundary, exactly as the web runs
/// <c>convertDistanceFromSI</c> per render). Pure data so the parse is unit-tested directly.
/// </summary>
public sealed record ParsedWarranty(
    bool HasData,
    string? ExpiryDate,
    int? DaysRemaining,
    double? MileageLimit,
    double? CurrentMileage,
    string? StartDate,
    int? TotalDays,
    int? DaysUsed,
    IReadOnlyList<WarrantyCoverage> Coverages)
{
    /// <summary>The no-data parse (web's null <c>warrantyData</c>) — renders the empty surface.</summary>
    public static ParsedWarranty Empty { get; } =
        new(false, null, null, null, null, null, null, null, Array.Empty<WarrantyCoverage>());
}

/// <summary>
/// One projected, display-ready detail row consumed by the WinUI detail list — the native analogue of the web
/// <c>DetailEntry</c> with its optional status <c>badge</c> and <c>mono</c> flag
/// (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx). Holds the <see cref="Label"/>, the
/// formatted <see cref="Value"/> (or an em-dash), whether the value is rendered <see cref="Mono"/>, whether a
/// badge is shown plus its <see cref="BadgeText"/> / <see cref="BadgeStatus"/>, and a Narrator
/// <see cref="AccessibilityName"/>.
/// </summary>
public sealed record WarrantyDetailRow(
    string Label,
    string Value,
    bool Mono,
    bool HasBadge,
    string BadgeText,
    StatusKind BadgeStatus,
    string AccessibilityName);

/// <summary>
/// One projected progress bar — the native analogue of a web <c>MetricBar</c>
/// (web/src/components/data-display/MetricBar.tsx). Holds the <see cref="Label"/>, the clamped
/// <see cref="Value"/> / <see cref="Max"/>, the right-aligned <see cref="Sublabel"/> readout, the token
/// <see cref="BrushKey"/> driving the fill colour and a Narrator <see cref="AccessibilityName"/>.
/// </summary>
public sealed record WarrantyMetricBar(
    string Label,
    double Value,
    double Max,
    string Sublabel,
    string BrushKey,
    string AccessibilityName);

/// <summary>
/// The centred compact (1×2) summary — the native analogue of the web <c>isCompact</c> branch's shield +
/// days-remaining + "days left" caption + Active/Expired badge
/// (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). Holds the formatted
/// <see cref="DaysText"/> (or an em-dash), the <see cref="DaysLeftCaption"/>, the <see cref="BadgeText"/> /
/// <see cref="BadgeStatus"/> and a Narrator <see cref="AccessibilityName"/>.
/// </summary>
public sealed record WarrantyCompactSummary(
    string DaysText,
    string DaysLeftCaption,
    string BadgeText,
    StatusKind BadgeStatus,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the warranty for one footprint — the native analogue of the
/// <c>daysRemaining</c> / <c>variant</c> / <c>entries</c> / progress-bar values the web component computes
/// before returning JSX (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). Pure data so the
/// projection is unit-tested directly.
/// </summary>
public sealed record WarrantyStatusDisplay(
    bool IsCompact,
    bool HasData,
    WarrantyCompactSummary Compact,
    WarrantyMetricBar? TimeBar,
    WarrantyMetricBar? MileageBar,
    IReadOnlyList<WarrantyDetailRow> Entries);

/// <summary>
/// The pure warranty parser — a 1:1 port of the field extraction in
/// web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx. It reads the expiry / mileage / start-date
/// nullish chains, computes the whole-day countdown and total-period days relative to an injected
/// <paramref name="now"/> (so the result is deterministic in tests), and walks the five known coverage flags
/// (each with its localized label key, optional expiry, computed active flag). No WinUI types are referenced.
/// </summary>
public static class WarrantyStatusParser
{
    private static readonly (string Key, string LabelKey, string Fallback)[] CoverageTypes =
    {
        ("basic", "widget.warranty.basic", "Basic"),
        ("battery_drive_unit", "widget.warranty.batteryDrive", "Battery/Drive Unit"),
        ("corrosion", "widget.warranty.corrosion", "Corrosion"),
        ("emissions", "widget.warranty.emissions", "Emissions"),
        ("body", "widget.warranty.body", "Body"),
    };

    /// <summary>
    /// Parse the warranty <c>data</c> object into a <see cref="ParsedWarranty"/>, resolving the countdown /
    /// active flags relative to <paramref name="now"/>. A non-object input yields <see cref="ParsedWarranty.Empty"/>
    /// (web <c>if (!warrantyData) …</c>).
    /// </summary>
    public static ParsedWarranty Parse(JsonElement data, DateTimeOffset now)
    {
        if (data.ValueKind != JsonValueKind.Object)
        {
            return ParsedWarranty.Empty;
        }

        string? expiry = WarrantyStatusJson.AsStringFrom(data, "warranty_expiry_date", "expiry_date", "basic_expiry_date");
        int? daysRemaining = DaysUntil(expiry, now);

        double? mileageLimit = WarrantyStatusJson.AsNumberFrom(data, "mileage_limit_mi", "mileage_limit", "basic_mileage_limit_mi");
        double? currentMileage = WarrantyStatusJson.AsNumberFrom(data, "current_mileage_mi", "odometer_mi", "current_odometer_mi");

        string? startDate = WarrantyStatusJson.AsStringFrom(data, "warranty_start_date", "start_date", "in_service_date");
        int? totalDays = TotalDays(startDate, expiry);
        int? daysUsed = totalDays is { } total && daysRemaining is { } remaining
            ? Math.Max(total - remaining, 0)
            : null;

        var coverages = new List<WarrantyCoverage>();
        foreach (var (key, labelKey, fallback) in CoverageTypes)
        {
            if (!WarrantyStatusJson.IsCoveragePresent(data, key))
            {
                continue;
            }

            string? covExpiry = WarrantyStatusJson.AsStringProp(data, key + "_expiry_date");
            int? covDays = DaysUntil(covExpiry, now);
            bool covActive = covExpiry is not null ? covDays is > 0 : true;
            coverages.Add(new WarrantyCoverage(labelKey, fallback, covExpiry, covActive));
        }

        return new ParsedWarranty(
            HasData: true,
            ExpiryDate: expiry,
            DaysRemaining: daysRemaining,
            MileageLimit: mileageLimit,
            CurrentMileage: currentMileage,
            StartDate: startDate,
            TotalDays: totalDays,
            DaysUsed: daysUsed,
            Coverages: coverages);
    }

    /// <summary>
    /// Port of the web <c>daysUntil</c>: the ceiling of the whole-day gap from <paramref name="now"/> to the
    /// parsed expiry, or null for an absent / unparseable date (web <c>new Date(iso)</c> → <c>NaN</c> → null).
    /// </summary>
    public static int? DaysUntil(string? dateStr, DateTimeOffset now)
    {
        if (!TryParseDate(dateStr, out var expiry))
        {
            return null;
        }

        return (int)Math.Ceiling((expiry - now).TotalDays);
    }

    /// <summary>
    /// Port of the web <c>totalDays</c> memo: the ceiling of the whole-day gap between the parsed start and
    /// expiry dates, or null when either is absent / unparseable.
    /// </summary>
    public static int? TotalDays(string? startDate, string? expiryDate)
    {
        if (!TryParseDate(startDate, out var start) || !TryParseDate(expiryDate, out var end))
        {
            return null;
        }

        return (int)Math.Ceiling((end - start).TotalDays);
    }

    /// <summary>
    /// Parse an ISO-ish date string the way the web <c>new Date(iso)</c> does for the common cases: a bare date
    /// is treated as UTC midnight and an explicit offset is honoured; anything unparseable fails (the web's
    /// Invalid Date). Numeric / empty inputs fail, mirroring <c>asString</c> + <c>new Date</c>.
    /// </summary>
    internal static bool TryParseDate(string? value, out DateTimeOffset result)
    {
        if (!string.IsNullOrEmpty(value))
        {
            return DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal,
                out result);
        }

        result = default;
        return false;
    }
}

/// <summary>
/// Pure projection from a parsed <see cref="WarrantyStatusSnapshot"/> to the display model — the native port
/// of the <c>daysRemaining</c> / <c>variant</c> / progress-bar / <c>entries</c> computation in
/// web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx. Mileages are converted to the active unit via
/// the SI converter (the web <c>convertDistanceFromSI</c>); dates render through the shared
/// <see cref="DateTimeFormatting"/> facade (the native <c>useDateFormat</c> analogue). Every label resolves
/// through the i18n facade.
/// </summary>
public static class WarrantyStatusProjection
{
    /// <summary>Segoe Fluent "Security" glyph — the native analogue of the web lucide <c>ShieldCheck</c>.</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>The token brush key tinting the shield icon (web <c>text-emerald-400</c>).</summary>
    public const string ShieldBrushKey = "TsColorSuccessBrush";

    /// <summary>The em-dash fallback the web renders for a missing value (<c>value ?? '—'</c>).</summary>
    internal const string EmDash = DateTimeFormatting.DefaultEmptyDisplay;

    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> / <paramref name="units"/> relative to <paramref name="now"/>.</summary>
    public static WarrantyStatusDisplay Project(
        WarrantyStatusSnapshot snapshot,
        WarrantyStatusSize size,
        DateTimeOffset now,
        ILocalizer localizer,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        var parsed = ParseSnapshot(snapshot, now);
        var compact = BuildCompact(parsed, localizer, units);
        var timeBar = BuildTimeBar(parsed, localizer, units);
        var mileageBar = BuildMileageBar(parsed, localizer, units);
        var entries = BuildEntries(parsed, now, localizer, units);

        return new WarrantyStatusDisplay(
            IsCompact: size.IsCompact,
            HasData: parsed.HasData,
            Compact: compact,
            TimeBar: timeBar,
            MileageBar: mileageBar,
            Entries: entries);
    }

    /// <summary>Parse the cached <c>data</c> JSON into the warranty fields (empty when absent).</summary>
    public static ParsedWarranty ParseSnapshot(WarrantyStatusSnapshot snapshot, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.DataJson is not { } json)
        {
            return ParsedWarranty.Empty;
        }

        using var doc = JsonDocument.Parse(json);
        return WarrantyStatusParser.Parse(doc.RootElement, now);
    }

    /// <summary>
    /// Port of the web <c>statusVariant</c>: <see cref="StatusKind.Danger"/> for an expired / unknown countdown
    /// (web 'error'), <see cref="StatusKind.Warning"/> within 90 days, else <see cref="StatusKind.Success"/>.
    /// </summary>
    public static StatusKind Variant(int? days) =>
        days is null or <= 0 ? StatusKind.Danger
        : days <= 90 ? StatusKind.Warning
        : StatusKind.Success;

    /// <summary>
    /// Format an expiry date the way the web <c>useDateFormat().formatDate</c> does — locale "MMM d, yyyy"
    /// (e.g. "Jun 8, 2026"), or the em-dash for an absent / unparseable value.
    /// </summary>
    public static string FormatDate(string? iso, DateTimeOffset now) =>
        WarrantyStatusParser.TryParseDate(iso, out var dto)
            ? DateTimeFormatting.Format(dto, DateTimeVariant.Date, now)
            : EmDash;

    /// <summary>
    /// Format a coverage expiry as the web's <c>Intl.DateTimeFormat({ month:'short', year:'numeric' })</c> —
    /// "MMM yyyy" (e.g. "Jun 2026"), or the em-dash for an absent / unparseable value.
    /// </summary>
    public static string FormatMonthYear(string? iso) =>
        WarrantyStatusParser.TryParseDate(iso, out var dto)
            ? dto.LocalDateTime.ToString("MMM yyyy", EnUs)
            : EmDash;

    private static string StatusLabel(int? days, ILocalizer localizer) =>
        days is null or <= 0
            ? localizer.GetString("widget.warranty.expired", "Expired")
            : localizer.GetString("widget.warranty.active", "Active");

    private static WarrantyCompactSummary BuildCompact(ParsedWarranty parsed, ILocalizer localizer, UnitPref units)
    {
        var variant = Variant(parsed.DaysRemaining);
        string daysText = parsed.DaysRemaining is { } days ? Format0(Math.Max(days, 0), units) : EmDash;
        string caption = localizer.GetString("widget.warranty.daysLeft", "days left");
        string badge = StatusLabel(parsed.DaysRemaining, localizer);
        string title = localizer.GetString("widget.warranty.title", "Warranty Status");
        string accessibility = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1} {2}, {3}", title, daysText, caption, badge);

        return new WarrantyCompactSummary(daysText, caption, badge, variant, accessibility);
    }

    private static WarrantyMetricBar? BuildTimeBar(ParsedWarranty parsed, ILocalizer localizer, UnitPref units)
    {
        // Web parity: the Time Remaining bar renders only when totalDays and daysUsed both resolve.
        if (parsed.TotalDays is not { } total || parsed.DaysUsed is not { } used)
        {
            return null;
        }

        var variant = Variant(parsed.DaysRemaining);
        string label = localizer.GetString("widget.warranty.timeRemaining", "Time Remaining");
        string sublabel = parsed.DaysRemaining is { } days
            ? string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                Format0(Math.Max(days, 0), units),
                localizer.GetString("widget.warranty.daysUnit", "days"))
            : EmDash;

        return new WarrantyMetricBar(
            label,
            used,
            total,
            sublabel,
            StatusResources.AccentBrushKey(variant),
            string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, sublabel));
    }

    private static WarrantyMetricBar? BuildMileageBar(ParsedWarranty parsed, ILocalizer localizer, UnitPref units)
    {
        // Web parity: the Mileage Remaining bar renders only when both mileage values resolve.
        if (parsed.MileageLimit is not { } limit || parsed.CurrentMileage is not { } current)
        {
            return null;
        }

        // Web parity: colour keys off the raw current/limit ratio (NaN/∞ in the degenerate limit=0 case fall
        // through to success exactly as the JS comparisons do).
        double ratio = current / limit;
        var variant = ratio > 0.9 ? StatusKind.Danger : ratio > 0.75 ? StatusKind.Warning : StatusKind.Success;
        string distanceUnit = UnitLabels.Label(units.Distance);
        string label = localizer.GetString("widget.warranty.mileageRemaining", "Mileage Remaining");
        string sublabel = string.Format(
            CultureInfo.CurrentCulture, "{0} {1}", Format0(Convert(limit - current, units), units), distanceUnit);

        return new WarrantyMetricBar(
            label,
            Convert(current, units),
            Convert(limit, units),
            sublabel,
            StatusResources.AccentBrushKey(variant),
            string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, sublabel));
    }

    private static List<WarrantyDetailRow> BuildEntries(
        ParsedWarranty parsed,
        DateTimeOffset now,
        ILocalizer localizer,
        UnitPref units)
    {
        var entries = new List<WarrantyDetailRow>();
        if (!parsed.HasData)
        {
            return entries;
        }

        var variant = Variant(parsed.DaysRemaining);
        string distanceUnit = UnitLabels.Label(units.Distance);

        // Expiry Date (always, with the Active/Expired status badge).
        string expiryLabel = localizer.GetString("widget.warranty.expiryDate", "Expiry Date");
        string expiryValue = parsed.ExpiryDate is { } ed ? FormatDate(ed, now) : EmDash;
        string expiryBadge = StatusLabel(parsed.DaysRemaining, localizer);
        entries.Add(new WarrantyDetailRow(
            expiryLabel, expiryValue, false, true, expiryBadge, variant, Acc(expiryLabel, expiryValue, expiryBadge)));

        // Days Remaining (always, mono).
        string daysLabel = localizer.GetString("widget.warranty.daysRemaining", "Days Remaining");
        string daysValue = parsed.DaysRemaining is { } dr ? Format0(Math.Max(dr, 0), units) : EmDash;
        entries.Add(new WarrantyDetailRow(
            daysLabel, daysValue, true, false, string.Empty, StatusKind.Neutral, Acc(daysLabel, daysValue, null)));

        // Mileage Limit (when present, mono).
        if (parsed.MileageLimit is { } limit)
        {
            string label = localizer.GetString("widget.warranty.mileageLimit", "Mileage Limit");
            string value = string.Format(
                CultureInfo.CurrentCulture, "{0} {1}", Format0(Convert(limit, units), units), distanceUnit);
            entries.Add(new WarrantyDetailRow(
                label, value, true, false, string.Empty, StatusKind.Neutral, Acc(label, value, null)));
        }

        // Current Mileage (when present, mono).
        if (parsed.CurrentMileage is { } current)
        {
            string label = localizer.GetString("widget.warranty.currentMileage", "Current Mileage");
            string value = string.Format(
                CultureInfo.CurrentCulture, "{0} {1}", Format0(Convert(current, units), units), distanceUnit);
            entries.Add(new WarrantyDetailRow(
                label, value, true, false, string.Empty, StatusKind.Neutral, Acc(label, value, null)));
        }

        // Coverage types (each present coverage, with a Covered/Expired badge).
        string coveredText = localizer.GetString("widget.warranty.covered", "Covered");
        string expiredText = localizer.GetString("widget.warranty.expired", "Expired");
        string includedText = localizer.GetString("widget.warranty.included", "Included");
        foreach (var coverage in parsed.Coverages)
        {
            string label = localizer.GetString(coverage.LabelKey, coverage.Fallback);
            string value = coverage.ExpiryDate is { } ce ? FormatMonthYear(ce) : includedText;
            string badge = coverage.Active ? coveredText : expiredText;
            var status = coverage.Active ? StatusKind.Success : StatusKind.Danger;
            entries.Add(new WarrantyDetailRow(label, value, false, true, badge, status, Acc(label, value, badge)));
        }

        return entries;
    }

    private static string Acc(string label, string value, string? badge) =>
        badge is { Length: > 0 }
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, badge)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static double Convert(double meters, UnitPref units) =>
        UnitConverters.DistanceFromSi(meters, units.Distance);

    private static string Format0(double value, UnitPref units) =>
        NumberFormatting.Format(value, units.Locale, 0);
}
