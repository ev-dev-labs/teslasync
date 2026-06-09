using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SubscriptionsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SubscriptionsWidget</c> renders
/// through <c>WidgetShell</c> + <c>WidgetDetailCard</c>
/// (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). Every branch maps onto a visible surface;
/// none is ever hidden. The web has a single empty surface ("No subscriptions"), shown whenever the parsed
/// subscription list is empty (no vehicle, null data, or no recognized subscriptions), so a single
/// <see cref="Empty"/> models all of those.
/// </summary>
public enum SubscriptionsState
{
    /// <summary>Initial fetch with no cached payload — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data (or non-stale cache) with at least one parsed subscription.</summary>
    Loaded,

    /// <summary>No subscriptions resolved — render the "No subscriptions" empty state.</summary>
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
/// web/src/features/dashboard/widgets/SubscriptionsWidget.tsx, which swaps the full detail list for the
/// centred active-count + next-expiry summary.
/// </summary>
public readonly record struct SubscriptionsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SubscriptionsSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// The cache-then-network payload backing the widget: the raw subscription <c>data</c> object from the
/// <c>GET /vehicles/{id}/subscriptions</c> envelope (web <c>infoResponse?.data ?? null</c>), kept as its raw
/// JSON text so the localized / time-relative parse runs at the display boundary (exactly as the web runs
/// <c>parseSubscriptions(subsData, t)</c> on every render). <see cref="DataJson"/> is null when the envelope
/// carried no <c>data</c> object (the web's null <c>subsData</c>, which parses to an empty list). The record
/// round-trips losslessly through the cache (System.Text.Json).
/// </summary>
public sealed record SubscriptionsSnapshot(string? DataJson)
{
    /// <summary>The no-data snapshot (no vehicle / null data) — parses to an empty subscription list.</summary>
    public static SubscriptionsSnapshot None { get; } = new((string?)null);

    /// <summary>
    /// Project the <c>{ data, fetched_at }</c> subscriptions envelope into the snapshot — the native
    /// <c>envelope?.data ?? null</c>. The <c>data</c> object's raw JSON is retained when present; an absent /
    /// JSON-null / non-object <c>data</c> yields <see cref="None"/> (the web's null <c>subsData</c>).
    /// </summary>
    public static SubscriptionsSnapshot FromEnvelope(JsonElement envelope)
    {
        if (envelope.ValueKind == JsonValueKind.Object &&
            envelope.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            return new SubscriptionsSnapshot(data.GetRawText());
        }

        return None;
    }
}

/// <summary>
/// One parsed subscription — the native analogue of the web <c>ParsedSub</c>
/// (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). Holds the resolved (localized) display
/// <see cref="Name"/>, whether it is currently <see cref="Active"/>, the raw <see cref="ExpiryDate"/> string
/// (or null), the raw <see cref="RenewalType"/> (or null) and the computed whole-day countdown
/// <see cref="DaysLeft"/> (null when there is no parseable expiry). Pure data — unit-tested without a UI host.
/// </summary>
public sealed record ParsedSubscription(
    string Name,
    bool Active,
    string? ExpiryDate,
    string? RenewalType,
    int? DaysLeft);

/// <summary>
/// One projected, display-ready detail row consumed by the WinUI detail list — the native analogue of the
/// web <c>DetailEntry</c> with its status <c>badge</c>
/// (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx). Holds the subscription
/// <see cref="Label"/>, the formatted <see cref="Value"/> (the expiry date, else the renewal type, else an
/// em-dash), the <see cref="Active"/> flag driving the badge tint, the localized <see cref="BadgeText"/>
/// ("Active" / "Expired") and a Narrator <see cref="AccessibilityName"/>.
/// </summary>
public sealed record SubscriptionEntry(
    string Label,
    string Value,
    bool Active,
    string BadgeText,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the subscriptions for one footprint — the native analogue of
/// the <c>parsed</c> / <c>entries</c> / <c>activeCount</c> / <c>nextExpiry</c> values the web component
/// computes before returning JSX. Pure data so the projection is unit-tested directly.
/// </summary>
public sealed record SubscriptionsDisplay(
    bool IsCompact,
    bool HasSubscriptions,
    int ActiveCount,
    string? NextExpiryText,
    string CompactAccessibilityName,
    IReadOnlyList<SubscriptionEntry> Entries);

/// <summary>
/// Tolerant, null-safe readers porting the web component's <c>asString</c> / <c>?? null</c> access plus the
/// JavaScript truthiness used by <c>parseSubscriptions</c>
/// (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). Kept UI-free so the whole parse is
/// unit-tested headlessly.
/// </summary>
internal static class SubscriptionsJson
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

    /// <summary>Read one property through <see cref="AsString"/> (absent / wrong-kind → null).</summary>
    internal static string? AsStringProp(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) ? AsString(v) : null;

    /// <summary>
    /// Port of <c>asString(rec.a) ?? asString(rec.b) ?? …</c>: the first property whose <see cref="AsString"/>
    /// is non-null, in order.
    /// </summary>
    internal static string? AsStringFirst(JsonElement obj, params string[] names)
    {
        foreach (var name in names)
        {
            if (AsStringProp(obj, name) is { } s)
            {
                return s;
            }
        }

        return null;
    }

    /// <summary>
    /// Port of <c>asString(data[a] ?? data[b])</c>: <see cref="AsString"/> of the first property that is
    /// present and not JSON-null (so a present <c>false</c> / <c>0</c> / <c>""</c> short-circuits the
    /// <c>??</c> before <c>asString</c> nulls it), in order.
    /// </summary>
    internal static string? AsStringCoalesced(JsonElement obj, string a, string b)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (obj.TryGetProperty(a, out var va) && va.ValueKind != JsonValueKind.Null)
        {
            return AsString(va);
        }

        if (obj.TryGetProperty(b, out var vb) && vb.ValueKind != JsonValueKind.Null)
        {
            return AsString(vb);
        }

        return null;
    }

    /// <summary>
    /// True when a known-type flag is "present" — the web skip guard
    /// <c>val == null || val === false || val === ''</c> inverted. Absent, JSON-null, <c>false</c> and the
    /// empty string are NOT present; everything else (including <c>0</c>) is.
    /// </summary>
    internal static bool IsPresent(JsonElement obj, string name, out JsonElement value)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out value))
        {
            return value.ValueKind switch
            {
                JsonValueKind.Null => false,
                JsonValueKind.False => false,
                JsonValueKind.String => value.GetString()?.Length > 0,
                _ => true,
            };
        }

        value = default;
        return false;
    }

    /// <summary>
    /// Port of JavaScript <c>Boolean(val)</c> for a present known-type flag: <c>0</c> and the empty string are
    /// falsy, every other present value (non-zero number, non-empty string, true, object, array) is truthy.
    /// </summary>
    internal static bool IsTruthy(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => false,
        JsonValueKind.Number => value.TryGetDouble(out var d) && d != 0,
        JsonValueKind.String => value.GetString() is { Length: > 0 },
        JsonValueKind.Object => true,
        JsonValueKind.Array => true,
        _ => false,
    };
}

/// <summary>
/// The pure subscription parser — a 1:1 port of <c>parseSubscriptions</c>
/// (web/src/features/dashboard/widgets/SubscriptionsWidget.tsx). It walks the six known subscription flags
/// (each with its localized label, optional expiry, optional renewal) then the generic
/// <c>data.subscriptions[]</c> array (deduped against the known names, case-insensitively), computing the
/// whole-day countdown and active flag relative to an injected <c>now</c> so the result is deterministic in
/// tests. No WinUI types are referenced.
/// </summary>
public static class SubscriptionsParser
{
    private static readonly (string Key, string LabelKey, string Fallback)[] KnownTypes =
    {
        ("premium_connectivity", "widget.subscriptions.premiumConnectivity", "Premium Connectivity"),
        ("full_self_driving", "widget.subscriptions.fsd", "Full Self-Driving"),
        ("enhanced_autopilot", "widget.subscriptions.enhancedAutopilot", "Enhanced Autopilot"),
        ("standard_connectivity", "widget.subscriptions.standardConnectivity", "Standard Connectivity"),
        ("data_sharing", "widget.subscriptions.dataSharing", "Data Sharing"),
        ("satellite_connectivity", "widget.subscriptions.satellite", "Satellite Connectivity"),
    };

    /// <summary>
    /// Parse the subscriptions <c>data</c> object into the ordered, deduped list of
    /// <see cref="ParsedSubscription"/> values, resolving labels through <paramref name="localizer"/> and the
    /// countdown / active flags relative to <paramref name="now"/>. A non-object input yields an empty list
    /// (web <c>if (!data) return []</c> plus the property reads collapsing to <c>undefined</c>).
    /// </summary>
    public static IReadOnlyList<ParsedSubscription> Parse(JsonElement data, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (data.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<ParsedSubscription>();
        }

        var subs = new List<ParsedSubscription>();

        foreach (var (key, labelKey, fallback) in KnownTypes)
        {
            if (!SubscriptionsJson.IsPresent(data, key, out var val))
            {
                continue;
            }

            string? expiry = SubscriptionsJson.AsStringCoalesced(data, key + "_expiry_date", key + "_expiry");
            int? days = DaysUntil(expiry, now);
            bool active = expiry is not null ? days is > 0 : SubscriptionsJson.IsTruthy(val);
            string? renewal = SubscriptionsJson.AsStringCoalesced(data, key + "_renewal", key + "_renewal_type");

            subs.Add(new ParsedSubscription(localizer.GetString(labelKey, fallback), active, expiry, renewal, days));
        }

        if (data.TryGetProperty("subscriptions", out var array) && array.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in array.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string name = SubscriptionsJson.AsStringFirst(item, "name", "type")
                    ?? localizer.GetString("widget.subscriptions.unknown", "Unknown");

                if (subs.Any(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                string? expiry = SubscriptionsJson.AsStringFirst(item, "expiry_date", "expiry", "end_date");
                int? days = DaysUntil(expiry, now);
                string? status = SubscriptionsJson.AsStringProp(item, "status");
                bool active = status is not null
                    ? string.Equals(status, "active", StringComparison.OrdinalIgnoreCase)
                    : expiry is not null ? days is > 0 : true;
                string? renewal = SubscriptionsJson.AsStringFirst(item, "renewal_type", "renewal");

                subs.Add(new ParsedSubscription(name, active, expiry, renewal, days));
            }
        }

        return subs;
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
    /// Parse an ISO-ish date string the way the web <c>new Date(iso)</c> does for the common cases: a bare
    /// date is treated as UTC midnight and an explicit offset is honoured; anything unparseable fails (the
    /// web's Invalid Date). Numeric / empty inputs fail, mirroring <c>asString</c> + <c>new Date</c>.
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
/// Pure projection from a parsed <see cref="SubscriptionsSnapshot"/> to the display model — the native port
/// of the <c>parsed</c> / <c>entries</c> / <c>activeCount</c> / <c>nextExpiry</c> computation in
/// web/src/features/dashboard/widgets/SubscriptionsWidget.tsx. The expiry / renewal readout reproduces the
/// web <c>sub.expiryDate ? fmtDate(...) : (sub.renewalType ?? '—')</c>; the date format is the canonical
/// "MMM d, yyyy" of the shared <see cref="DateTimeFormatting"/> facade (the native <c>useDateFormat</c>
/// analogue). Every label resolves through the i18n facade.
/// </summary>
public static class SubscriptionsProjection
{
    /// <summary>The em-dash fallback the web renders for a missing value (<c>value ?? '—'</c>).</summary>
    internal const string EmDash = DateTimeFormatting.DefaultEmptyDisplay;

    /// <summary>Segoe Fluent "PaymentCard" glyph — the native analogue of the web lucide <c>CreditCard</c>.</summary>
    public const string CardGlyph = "\uE8C7";

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> relative to <paramref name="now"/>.</summary>
    public static SubscriptionsDisplay Project(
        SubscriptionsSnapshot snapshot,
        SubscriptionsSize size,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var parsed = ParseSnapshot(snapshot, now, localizer);
        var entries = BuildEntries(parsed, now, localizer);

        int activeCount = 0;
        for (int i = 0; i < parsed.Count; i++)
        {
            if (parsed[i].Active)
            {
                activeCount++;
            }
        }

        var next = NextExpiry(parsed);
        string? nextExpiryText = next is { ExpiryDate: { } expiry }
            ? FormatDate(expiry, now)
            : null;

        string compactName = BuildCompactAccessibilityName(activeCount, nextExpiryText, parsed.Count > 0, localizer);

        return new SubscriptionsDisplay(
            IsCompact: size.IsCompact,
            HasSubscriptions: parsed.Count > 0,
            ActiveCount: activeCount,
            NextExpiryText: nextExpiryText,
            CompactAccessibilityName: compactName,
            Entries: entries);
    }

    /// <summary>Parse the cached <c>data</c> JSON into the subscription list (empty when absent).</summary>
    public static IReadOnlyList<ParsedSubscription> ParseSnapshot(
        SubscriptionsSnapshot snapshot,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        if (snapshot.DataJson is not { } json)
        {
            return Array.Empty<ParsedSubscription>();
        }

        using var doc = JsonDocument.Parse(json);
        return SubscriptionsParser.Parse(doc.RootElement, now, localizer);
    }

    /// <summary>
    /// Format an expiry date the way the web <c>useDateFormat().formatDate</c> does — locale "MMM d, yyyy"
    /// (e.g. "Jun 8, 2026"), or the em-dash for an absent / unparseable value.
    /// </summary>
    public static string FormatDate(string? iso, DateTimeOffset now) =>
        SubscriptionsParser.TryParseDate(iso, out var dto)
            ? DateTimeFormatting.Format(dto, DateTimeVariant.Date, now)
            : EmDash;

    private static ParsedSubscription? NextExpiry(IReadOnlyList<ParsedSubscription> parsed)
    {
        ParsedSubscription? best = null;
        foreach (var sub in parsed)
        {
            if (!sub.Active || sub.DaysLeft is not { } days || days <= 0)
            {
                continue;
            }

            if (best is null || days < best.DaysLeft)
            {
                best = sub;
            }
        }

        return best;
    }

    private static List<SubscriptionEntry> BuildEntries(
        IReadOnlyList<ParsedSubscription> parsed,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        string activeLabel = localizer.GetString("widget.subscriptions.active", "Active");
        string expiredLabel = localizer.GetString("widget.subscriptions.expired", "Expired");

        var entries = new List<SubscriptionEntry>(parsed.Count);
        foreach (var sub in parsed)
        {
            string value = sub.ExpiryDate is { } expiry
                ? FormatDate(expiry, now)
                : sub.RenewalType ?? EmDash;
            string badge = sub.Active ? activeLabel : expiredLabel;
            string accessibility = string.Format(
                CultureInfo.CurrentCulture, "{0}: {1}, {2}", sub.Name, value, badge);

            entries.Add(new SubscriptionEntry(sub.Name, value, sub.Active, badge, accessibility));
        }

        return entries;
    }

    private static string BuildCompactAccessibilityName(
        int activeCount,
        string? nextExpiryText,
        bool hasSubscriptions,
        ILocalizer localizer)
    {
        if (!hasSubscriptions)
        {
            return localizer.GetString("widget.subscriptions.noData", "No subscriptions");
        }

        string title = localizer.GetString("widget.subscriptions.title", "Subscriptions");
        string activeWord = localizer.GetString("widget.subscriptions.activeCount", "active");
        string countText = activeCount.ToString(CultureInfo.CurrentCulture);
        string baseName = string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", title, countText, activeWord);

        return nextExpiryText is { Length: > 0 }
            ? string.Concat(baseName, ", ", nextExpiryText)
            : baseName;
    }
}
