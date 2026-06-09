using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="VehicleUpgradesViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>VehicleUpgradesWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx). Every branch
/// maps onto a visible surface; none is ever hidden. Unlike a single-list widget, the loaded body always
/// shows BOTH the "Available Upgrades" and "Share Links" sections — each with its own inline empty state — so
/// the <see cref="Empty"/> state (no vehicle / no payload) renders the same two-section body projected from an
/// empty snapshot rather than a blank box.
/// </summary>
public enum VehicleUpgradesState
{
    /// <summary>Initial fetch with no cached payload — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh data (or non-stale cache) — render the two-section body.</summary>
    Loaded,

    /// <summary>No vehicle / no payload resolved — render the two-section body from an empty snapshot.</summary>
    Empty,

    /// <summary>The upgrades request failed and no cached value exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached value older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached value remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> and <c>isWide = size.cols &gt;= 3</c> branches in
/// web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx, which swap the full two-section detail body
/// for the centred eligible-count summary (compact) and add the per-row eligibility caption (wide).
/// </summary>
public readonly record struct VehicleUpgradesSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static VehicleUpgradesSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>).</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide = size.cols &gt;= 3</c>).</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// One drive share link, reduced to the only field the widget consumes — the raw <c>expires_at</c> string
/// (or null) used by the active filter and the nearest-expiry pick (web <c>ShareToken.expires_at</c> in
/// web/src/types/sharing.ts). The active / countdown computation runs at the display boundary against an
/// injected clock, exactly as the web recomputes <c>daysUntil(l.expires_at)</c> on every render.
/// </summary>
public sealed record ShareLinkInfo(string? ExpiresAt)
{
    /// <summary>
    /// Project the <c>GET /drives/{id}/shares</c> array (web <c>useShareLinks</c>) into the list of share
    /// links, keeping only the <c>expires_at</c> field. A non-array / absent payload yields an empty list
    /// (web <c>shareLinksData ?? []</c>).
    /// </summary>
    public static IReadOnlyList<ShareLinkInfo> FromArray(JsonElement array)
    {
        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ShareLinkInfo>();
        }

        var links = new List<ShareLinkInfo>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            links.Add(new ShareLinkInfo(UpgradesJson.AsStringProp(item, "expires_at")));
        }

        return links;
    }

    /// <summary>
    /// Port of the web active filter: a link is active when it has no expiry (<c>!l.expires_at</c> — null or
    /// empty string), when its expiry is unparseable (<c>daysUntil == null</c>) or when it expires in the
    /// future (<c>days &gt; 0</c>).
    /// </summary>
    public bool IsActive(DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(ExpiresAt))
        {
            return true;
        }

        int? days = UpgradesParser.DaysUntil(ExpiresAt, now);
        return days is null or > 0;
    }
}

/// <summary>
/// The cache-then-network payload backing the widget: the raw upgrades <c>data</c> object from the
/// <c>GET /vehicles/{id}/upgrades</c> envelope (web <c>envelope?.data ?? null</c>), kept as its raw JSON text
/// so the parse runs at the display boundary (web <c>parseUpgrades(upgradesData)</c>), paired with the active
/// drive's resolved <see cref="ShareLinks"/> (web's independent <c>useDrives</c> → <c>useShareLinks</c>
/// chain, folded in by the source). <see cref="UpgradesDataJson"/> is null when the envelope carried no
/// <c>data</c> object; <see cref="ShareLinks"/> is empty when there is no vehicle / drive / share link.
/// </summary>
public sealed record VehicleUpgradesSnapshot(string? UpgradesDataJson, IReadOnlyList<ShareLinkInfo> ShareLinks)
{
    /// <summary>The no-data snapshot — parses to an empty upgrade list and no share links.</summary>
    public static VehicleUpgradesSnapshot None { get; } = new(null, Array.Empty<ShareLinkInfo>());

    /// <summary>
    /// Extract the <c>data</c> object's raw JSON from the <c>{ data, fetched_at }</c> upgrades envelope (the
    /// native <c>envelope?.data ?? null</c>). An absent / JSON-null / non-object <c>data</c> yields null (the
    /// web's null <c>upgradesData</c>, which parses to an empty list).
    /// </summary>
    public static string? ExtractUpgradesData(JsonElement envelope)
    {
        if (envelope.ValueKind == JsonValueKind.Object &&
            envelope.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            return data.GetRawText();
        }

        return null;
    }
}

/// <summary>
/// One parsed available upgrade — the native analogue of the web <c>ParsedUpgrade</c>
/// (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx). Holds the resolved display
/// <see cref="Name"/>, the optional raw <see cref="Price"/> string, the optional <see cref="Description"/>
/// and whether the upgrade is currently <see cref="Eligible"/>. Pure data — unit-tested without a UI host.
/// </summary>
public sealed record ParsedUpgrade(string Name, string? Price, string? Description, bool Eligible);

/// <summary>
/// One projected, display-ready upgrade row consumed by the WinUI list — the native analogue of the web
/// upgrade row (name + optional price chip + optional description + Eligible/Not eligible badge). Holds the
/// <see cref="Name"/>, the formatted <see cref="PriceText"/> (the web <c>${price}</c>, or null), the
/// <see cref="Description"/>, the <see cref="Eligible"/> flag driving the badge tint, the localized
/// <see cref="BadgeText"/> ("Eligible" / "Not eligible") and a Narrator <see cref="AccessibilityName"/>.
/// </summary>
public sealed record UpgradeEntry(
    string Name,
    string? PriceText,
    string? Description,
    bool Eligible,
    string BadgeText,
    string AccessibilityName);

/// <summary>
/// The fully projected, render-ready view of the upgrades + share links for one footprint — the native
/// analogue of the <c>upgrades</c> / <c>eligibleCount</c> / <c>activeShareLinks</c> / <c>nearestExpiry</c>
/// values the web component computes before returning JSX. Pure data so the projection is unit-tested
/// directly. The two-section body always renders; <see cref="HasUpgrades"/> / <see cref="HasActiveShareLinks"/>
/// drive each section's inline empty state.
/// </summary>
public sealed record VehicleUpgradesDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasUpgrades,
    int EligibleCount,
    IReadOnlyList<UpgradeEntry> Upgrades,
    bool HasActiveShareLinks,
    int ActiveShareLinkCount,
    string? NearestExpiryText,
    string CompactAccessibilityName);

/// <summary>
/// Tolerant, null-safe readers porting the web component's <c>asString</c> helper plus the
/// <c>eligible !== false</c> truthiness used by <c>parseUpgrades</c>
/// (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx). Kept UI-free so the whole parse is
/// unit-tested headlessly.
/// </summary>
internal static class UpgradesJson
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
    /// Port of the web <c>eligible: u.eligible !== false</c>: an upgrade is eligible unless its
    /// <c>eligible</c> property is present AND strictly the JSON boolean <c>false</c>. Absent, null, <c>0</c>,
    /// the empty string and any other value all remain eligible (only a literal <c>false</c> opts out).
    /// </summary>
    internal static bool IsEligible(JsonElement obj) =>
        obj.ValueKind != JsonValueKind.Object ||
        !obj.TryGetProperty("eligible", out var e) ||
        e.ValueKind != JsonValueKind.False;
}

/// <summary>
/// Canonical registry metadata for the Upgrades &amp; Sharing surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/vehicle.ts (id <c>vehicle-upgrades</c>, category
/// <c>vehicle</c>). The dashboard grid system binds this surface with the same <see cref="Id"/> and honours
/// the same size constraints. The generated OpenAPI operation ids are centralized here so a single test
/// asserts they resolve against the generated endpoint table (catching contract drift at build/test time
/// rather than at runtime).
/// </summary>
public static class VehicleUpgradesRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "vehicle-upgrades";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehicleUpgradesWidget";

    /// <summary>Generated operation id for the upgrades read (web <c>useVehicleUpgrades</c>).</summary>
    public const string UpgradesOperationId = "get_api_v1_vehicles_vehicleID_upgrades";

    /// <summary>Path-parameter name in the upgrades endpoint template.</summary>
    public const string VehiclePathParam = "vehicleID";

    /// <summary>Path-parameter name in the share-links endpoint template.</summary>
    public const string DrivePathParam = "driveID";

    /// <summary>Query-parameter name scoping the drive list to a vehicle.</summary>
    public const string VehicleQueryParam = "vehicle_id";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static VehicleUpgradesSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static VehicleUpgradesSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static VehicleUpgradesSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Upgrades &amp; Sharing").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.upgrades.title", "Upgrades & Sharing");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.upgrades.description",
            "Available OTA upgrades with pricing + active drive share links");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(VehicleUpgradesSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static VehicleUpgradesSize Clamp(VehicleUpgradesSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Upgrades &amp; Sharing surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an upgrade name, price, share-link token
/// or expiry — so a diagnostics line can never leak which upgrades an owner is offered or that they share
/// drives. Thread-safe.
/// </summary>
public sealed class VehicleUpgradesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VehicleUpgradesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehicleUpgradesWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehicleUpgradesRegistration.Slug}");
    }
}

/// <summary>
/// The pure upgrades parser — a 1:1 port of <c>parseUpgrades</c>
/// (web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx). It prefers a top-level <c>upgrades</c>
/// array, mapping each object to its name (<c>name</c> → <c>title</c> → "Unknown Upgrade"), price
/// (<c>price</c> → <c>cost</c>), description (<c>description</c> → <c>summary</c>) and eligibility
/// (<c>eligible !== false</c>); otherwise it falls back to treating each object-valued top-level property as
/// one upgrade (name <c>name</c> → the property key). No WinUI types are referenced.
/// </summary>
public static class UpgradesParser
{
    /// <summary>
    /// Parse the upgrades <c>data</c> object into the ordered list of <see cref="ParsedUpgrade"/> values. A
    /// non-object input yields an empty list (web <c>if (!data) return []</c> plus the property reads
    /// collapsing to <c>undefined</c>).
    /// </summary>
    public static IReadOnlyList<ParsedUpgrade> Parse(JsonElement data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (data.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<ParsedUpgrade>();
        }

        // Web parity: an "upgrades" array in the envelope wins over the top-level-keys fallback.
        if (data.TryGetProperty("upgrades", out var upgrades) && upgrades.ValueKind == JsonValueKind.Array)
        {
            var result = new List<ParsedUpgrade>(upgrades.GetArrayLength());
            foreach (var item in upgrades.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string name = UpgradesJson.AsStringFirst(item, "name", "title")
                    ?? localizer.GetString("widget.upgrades.unknownUpgrade", "Unknown Upgrade");
                result.Add(new ParsedUpgrade(
                    name,
                    UpgradesJson.AsStringFirst(item, "price", "cost"),
                    UpgradesJson.AsStringFirst(item, "description", "summary"),
                    UpgradesJson.IsEligible(item)));
            }

            return result;
        }

        // Fallback: treat each object-valued top-level property as one upgrade (web Object.entries loop).
        var fallback = new List<ParsedUpgrade>();
        foreach (var property in data.EnumerateObject())
        {
            if (property.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var rec = property.Value;
            string name = UpgradesJson.AsStringProp(rec, "name") ?? property.Name;
            fallback.Add(new ParsedUpgrade(
                name,
                UpgradesJson.AsStringFirst(rec, "price", "cost"),
                UpgradesJson.AsStringFirst(rec, "description", "summary"),
                UpgradesJson.IsEligible(rec)));
        }

        return fallback;
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
/// Pure projection from a parsed <see cref="VehicleUpgradesSnapshot"/> to the display model — the native port
/// of the <c>upgrades</c> / <c>eligibleCount</c> / <c>activeShareLinks</c> / <c>nearestExpiry</c> computation
/// in web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx. The nearest-expiry readout reproduces the
/// web <c>fmtDate(nearestExpiry.expires_at) ?? '—'</c>; the date format is the canonical "MMM d, yyyy" of the
/// shared <see cref="DateTimeFormatting"/> facade (the native <c>useDateFormat</c> analogue). Every label
/// resolves through the i18n facade.
/// </summary>
public static class VehicleUpgradesProjection
{
    /// <summary>The em-dash fallback the web renders for a missing value (<c>value ?? '—'</c>).</summary>
    internal const string EmDash = DateTimeFormatting.DefaultEmptyDisplay;

    /// <summary>Segoe Fluent "Upload" glyph — the native analogue of the web lucide <c>ArrowUpCircle</c>.</summary>
    public const string UpgradeGlyph = "\uE898";

    /// <summary>Segoe Fluent "Link" glyph — the native analogue of the web lucide <c>Link2</c>.</summary>
    public const string LinkGlyph = "\uE71B";

    /// <summary>Segoe Fluent "Completed" glyph — the native analogue of the web ✅ "All upgrades applied".</summary>
    public const string AppliedGlyph = "\uE930";

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> relative to <paramref name="now"/>.</summary>
    public static VehicleUpgradesDisplay Project(
        VehicleUpgradesSnapshot snapshot,
        VehicleUpgradesSize size,
        DateTimeOffset now,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var parsed = ParseSnapshot(snapshot, localizer);
        var entries = BuildEntries(parsed, localizer);

        int eligibleCount = 0;
        for (int i = 0; i < parsed.Count; i++)
        {
            if (parsed[i].Eligible)
            {
                eligibleCount++;
            }
        }

        var active = ActiveShareLinks(snapshot.ShareLinks, now);
        string? nearestExpiryText = NearestExpiry(active, now) is { } expiry ? expiry : null;

        string compactName = BuildCompactAccessibilityName(eligibleCount, parsed.Count > 0, localizer);

        return new VehicleUpgradesDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasUpgrades: parsed.Count > 0,
            EligibleCount: eligibleCount,
            Upgrades: entries,
            HasActiveShareLinks: active.Count > 0,
            ActiveShareLinkCount: active.Count,
            NearestExpiryText: nearestExpiryText,
            CompactAccessibilityName: compactName);
    }

    /// <summary>Parse the cached <c>data</c> JSON into the upgrade list (empty when absent).</summary>
    public static IReadOnlyList<ParsedUpgrade> ParseSnapshot(VehicleUpgradesSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        if (snapshot.UpgradesDataJson is not { } json)
        {
            return Array.Empty<ParsedUpgrade>();
        }

        using var doc = JsonDocument.Parse(json);
        return UpgradesParser.Parse(doc.RootElement, localizer);
    }

    /// <summary>
    /// Port of the web active filter: the share links that have no expiry, an unparseable expiry, or a
    /// future expiry (<c>shareLinks.filter(l =&gt; !l.expires_at || daysUntil == null || days &gt; 0)</c>).
    /// </summary>
    public static IReadOnlyList<ShareLinkInfo> ActiveShareLinks(IReadOnlyList<ShareLinkInfo> links, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(links);
        var active = new List<ShareLinkInfo>(links.Count);
        foreach (var link in links)
        {
            if (link.IsActive(now))
            {
                active.Add(link);
            }
        }

        return active;
    }

    /// <summary>
    /// Format the nearest expiry among the active links that carry an expiry — the active link with the
    /// smallest positive day countdown, formatted "MMM d, yyyy" (web <c>fmtDate(nearestExpiry.expires_at)</c>).
    /// Returns null when no active link has a (parseable) expiry.
    /// </summary>
    public static string? NearestExpiry(IReadOnlyList<ShareLinkInfo> activeLinks, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(activeLinks);

        ShareLinkInfo? best = null;
        int bestDays = int.MaxValue;
        foreach (var link in activeLinks)
        {
            if (string.IsNullOrEmpty(link.ExpiresAt))
            {
                continue;
            }

            // Web parity: links with a (truthy) expiry are sorted by daysUntil ascending, an unparseable
            // expiry sorting last (Infinity), so only a strictly smaller countdown supersedes the running best.
            int days = UpgradesParser.DaysUntil(link.ExpiresAt, now) ?? int.MaxValue;
            if (best is null || days < bestDays)
            {
                best = link;
                bestDays = days;
            }
        }

        return best is { ExpiresAt: { } iso } ? FormatDate(iso, now) : null;
    }

    /// <summary>
    /// Format an expiry date the way the web <c>useDateFormat().formatDate</c> does — locale "MMM d, yyyy"
    /// (e.g. "Jun 8, 2026"), or the em-dash for an absent / unparseable value (web <c>… ?? '—'</c>).
    /// </summary>
    public static string FormatDate(string? iso, DateTimeOffset now) =>
        UpgradesParser.TryParseDate(iso, out var dto)
            ? DateTimeFormatting.Format(dto, DateTimeVariant.Date, now)
            : EmDash;

    private static List<UpgradeEntry> BuildEntries(IReadOnlyList<ParsedUpgrade> parsed, ILocalizer localizer)
    {
        string eligibleLabel = localizer.GetString("widget.upgrades.eligible", "Eligible");
        string notEligibleLabel = localizer.GetString("widget.upgrades.notEligible", "Not eligible");

        var entries = new List<UpgradeEntry>(parsed.Count);
        foreach (var upgrade in parsed)
        {
            string? priceText = upgrade.Price is { Length: > 0 } price
                ? string.Concat("$", price)
                : null;
            string badge = upgrade.Eligible ? eligibleLabel : notEligibleLabel;
            string accessibility = priceText is { Length: > 0 }
                ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", upgrade.Name, priceText, badge)
                : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", upgrade.Name, badge);

            entries.Add(new UpgradeEntry(
                upgrade.Name,
                priceText,
                upgrade.Description,
                upgrade.Eligible,
                badge,
                accessibility));
        }

        return entries;
    }

    private static string BuildCompactAccessibilityName(int eligibleCount, bool hasUpgrades, ILocalizer localizer)
    {
        string title = localizer.GetString("widget.upgrades.title", "Upgrades & Sharing");
        if (!hasUpgrades)
        {
            string upToDate = localizer.GetString("widget.upgrades.upToDate", "Up to date");
            return string.Format(CultureInfo.CurrentCulture, "{0}: {1}", title, upToDate);
        }

        string available = localizer.GetString("widget.upgrades.available", "available");
        string countText = eligibleCount.ToString(CultureInfo.CurrentCulture);
        return string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", title, countText, available);
    }
}

/// <summary>
/// Folds the primary cache-then-network upgrades emission (the raw <c>{ data, fetched_at }</c> envelope) and
/// the separately-resolved drive share links into the combined <see cref="VehicleUpgradesSnapshot"/> the
/// view-model binds to — the native analogue of the web component reading <c>useVehicleUpgrades</c> for the
/// shell chrome while <c>useDrives</c> → <c>useShareLinks</c> independently feed the Share Links section. The
/// lifecycle <see cref="LoadStatus"/> / freshness / error of the upgrades read is preserved verbatim; the
/// share links ride along on every value-bearing emission.
/// </summary>
public static class VehicleUpgradesResultMapper
{
    /// <summary>Combine an upgrades envelope emission with the resolved share links.</summary>
    public static RepositoryResult<VehicleUpgradesSnapshot> Map(
        RepositoryResult<JsonElement> upgrades,
        IReadOnlyList<ShareLinkInfo> shareLinks)
    {
        ArgumentNullException.ThrowIfNull(shareLinks);

        if (!upgrades.HasValue)
        {
            // Loading / Error: no envelope to fold — carry the lifecycle through unchanged.
            return new RepositoryResult<VehicleUpgradesSnapshot>(
                upgrades.Status, null, upgrades.FetchedAt, upgrades.IsStale, upgrades.Error);
        }

        var snapshot = new VehicleUpgradesSnapshot(
            VehicleUpgradesSnapshot.ExtractUpgradesData(upgrades.Value),
            shareLinks);

        return new RepositoryResult<VehicleUpgradesSnapshot>(
            upgrades.Status, snapshot, upgrades.FetchedAt, upgrades.IsStale, upgrades.Error);
    }
}
