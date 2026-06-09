using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SignalCatalogViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SignalCatalogWidget</c>
/// renders (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx). The web component's
/// <c>WidgetShell</c> freshness and body are driven by the <c>useSignalCatalog</c> query alone
/// (<c>catalogLoading</c> / <c>catalogFetching</c> / <c>catalogStale</c> / <c>catalogError</c>);
/// the <c>useSignalObservations</c> read only supplies per-row observation counts and never gates a
/// state. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum SignalCatalogState
{
    /// <summary>Initial fetch with the catalog unresolved — render the skeleton chrome.</summary>
    Loading,

    /// <summary>Fresh catalog (or non-stale cache) carrying at least one signal.</summary>
    Loaded,

    /// <summary>Catalog resolved with no signals — render the friendly "No signals in catalog" surface.</summary>
    Empty,

    /// <summary>The catalog failed with no cached signals — render the empty body plus an error chip.</summary>
    Error,

    /// <summary>Cached signals older than the freshness window — render the list plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but cached signals remain — render the list plus an offline/error chip.</summary>
    Offline,
}

/// <summary>
/// One signal-catalog row from <c>GET /signals/catalog</c> (web <c>useSignalCatalog</c>). The real
/// backend serializes <c>{field, destination, value_kind, last_seen_at, sample_count_total,
/// vehicle_count}</c> whereas the web <c>SignalCatalogEntry</c> interface names the same concepts
/// <c>{name, source_module, unit/value_type, …}</c>. Parsing is null-tolerant and accepts BOTH naming
/// conventions so the native widget reproduces the web component's intent against the actual backend
/// without drift: <c>Name ← field|name</c>, <c>SourceModule ← destination|source_module</c>,
/// <c>ValueKind ← value_kind|value_type</c>. The web row shows the optional <c>unit</c> as a neutral
/// badge; the real contract carries no unit, so <see cref="UnitLabel"/> surfaces the (cleaned) value
/// kind — the genuine per-signal metadata — in the same badge slot.
/// </summary>
public sealed record SignalCatalogEntryModel(string Name, string SourceModule, string ValueKind)
{
    /// <summary>The neutral badge text (web <c>sig.unit</c> slot): the value kind sans the proto prefix, or "" when unknown.</summary>
    public string UnitLabel => CleanValueKind(ValueKind);

    /// <summary>True when a badge should render for this row (web <c>sig.unit &amp;&amp; &lt;Badge/&gt;</c>).</summary>
    public bool HasUnit => UnitLabel.Length > 0;

    /// <summary>
    /// Parse a <c>GET /signals/catalog</c> payload into a tolerant list of entries. Accepts the real
    /// <c>{signals: [...]}</c> envelope and, defensively, a bare array (the shape the web TS type
    /// declares). Entries with no field/name are dropped.
    /// </summary>
    public static IReadOnlyList<SignalCatalogEntryModel> ParseEnvelope(JsonElement element)
    {
        JsonElement array;
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("signals", out var signals))
        {
            array = signals;
        }
        else
        {
            array = element;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalCatalogEntryModel>();
        }

        var list = new List<SignalCatalogEntryModel>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string name = SignalCatalogJson.GetString(item, "field")
                ?? SignalCatalogJson.GetString(item, "name")
                ?? string.Empty;
            if (string.IsNullOrEmpty(name))
            {
                continue;
            }

            string source = SignalCatalogJson.GetString(item, "destination")
                ?? SignalCatalogJson.GetString(item, "source_module")
                ?? SignalCatalogJson.GetString(item, "sourceModule")
                ?? string.Empty;

            string kind = SignalCatalogJson.GetString(item, "value_kind")
                ?? SignalCatalogJson.GetString(item, "valueKind")
                ?? SignalCatalogJson.GetString(item, "value_type")
                ?? SignalCatalogJson.GetString(item, "valueType")
                ?? string.Empty;

            list.Add(new SignalCatalogEntryModel(name, source, kind));
        }

        return list;
    }

    /// <summary>Strip the proto <c>ValueKind</c> prefix and collapse the unknown sentinel to "" (no badge).</summary>
    private static string CleanValueKind(string raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return string.Empty;
        }

        const string prefix = "ValueKind";
        string cleaned = raw.StartsWith(prefix, StringComparison.Ordinal) ? raw[prefix.Length..] : raw;
        return string.Equals(cleaned, "Unknown", StringComparison.OrdinalIgnoreCase) ? string.Empty : cleaned;
    }
}

/// <summary>
/// One observation row from <c>GET /signals/observations?vehicle_id=</c> (web
/// <c>useSignalObservations</c>). Only the signal's <see cref="Field"/> is retained — the widget
/// counts observations per field to drive the per-row count, exactly like the web component's
/// <c>observationCounts</c> map keyed by <c>signal_name</c>. The backend filters by <c>field=</c> and
/// the adapter tolerates the historical <c>signal_name</c> alias (and camelCase variants).
/// </summary>
public sealed record SignalObservationModel(string Field)
{
    /// <summary>
    /// Parse a <c>GET /signals/observations</c> payload into a tolerant list of rows. Accepts the real
    /// <c>{count, total, observations: [...]}</c> envelope and, defensively, a bare array. Rows with no
    /// field name are dropped.
    /// </summary>
    public static IReadOnlyList<SignalObservationModel> ParseEnvelope(JsonElement element)
    {
        JsonElement array;
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("observations", out var rows))
        {
            array = rows;
        }
        else
        {
            array = element;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalObservationModel>();
        }

        var list = new List<SignalObservationModel>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string field = SignalCatalogJson.GetString(item, "field")
                ?? SignalCatalogJson.GetString(item, "signal_name")
                ?? SignalCatalogJson.GetString(item, "fieldName")
                ?? SignalCatalogJson.GetString(item, "signalName")
                ?? string.Empty;
            if (string.IsNullOrEmpty(field))
            {
                continue;
            }

            list.Add(new SignalObservationModel(field));
        }

        return list;
    }
}

/// <summary>Tolerant JSON readers shared by the catalog + observation parse adapters.</summary>
internal static class SignalCatalogJson
{
    /// <summary>Read a string property, or <see langword="null"/> when absent / not a string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/SignalCatalogWidget.tsx. The registered minimum is 2×4, so the
/// compact branch is only reachable when a host forces a sub-minimum footprint; it is implemented for
/// full parity with the web source.
/// </summary>
public readonly record struct SignalCatalogSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SignalCatalogSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the total count + "signals available".</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready catalog row consumed by the WinUI view — the native analogue of a web
/// signal row (the mono signal name, the optional <c>unit</c>-slot badge, and the right-aligned
/// observation count). Pure data — no WinUI types.
/// </summary>
public sealed record SignalCatalogRow(
    string Name,
    string UnitLabel,
    bool HasUnit,
    long ObservationCount,
    string ObservationCountText,
    string AutomationName);

/// <summary>
/// One category group of catalog rows — the native analogue of the web component's <c>grouped</c>
/// map entry (a <c>source_module</c> bucket with its header count). Categories are sorted
/// alphabetically and rows preserve catalog order (the backend sorts <c>field</c> ascending).
/// </summary>
public sealed record SignalCatalogGroup(
    string Category,
    int Count,
    string CountLabel,
    string AutomationName,
    IReadOnlyList<SignalCatalogRow> Rows);

/// <summary>
/// The fully projected, render-ready view of the signal catalog for one footprint and search term —
/// the native analogue of everything the web component computes via <c>useMemo</c> before returning
/// JSX (the observation-count map, the search filter, the category grouping, and the compact total).
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SignalCatalogDisplay(
    bool IsCompact,
    bool HasEntries,
    bool HasMatches,
    int TotalCount,
    string TotalCountText,
    string SignalsAvailableLabel,
    string CompactAutomationName,
    IReadOnlyList<SignalCatalogGroup> Groups);

/// <summary>
/// Pure projection from the raw catalog + observation rows to the display model — the native port of
/// the <c>observationCounts</c> / <c>filtered</c> / <c>grouped</c> <c>useMemo</c> logic in
/// web/src/features/dashboard/widgets/SignalCatalogWidget.tsx. Each label resolves through the i18n
/// facade. Deterministic so every branch is unit-tested without a UI host.
/// </summary>
public static class SignalCatalogProjection
{
    private const string UncategorizedKey = "widget.signalCatalog.uncategorized";
    private const string UncategorizedFallback = "Uncategorized";
    private const string SignalsAvailableKey = "widget.signalCatalog.signalsAvailable";
    private const string SignalsAvailableFallback = "signals available";

    /// <summary>
    /// Count observations per field (web <c>observationCounts</c>): a case-sensitive map keyed by the
    /// signal name, exactly like the web component's <c>Map&lt;string, number&gt;</c>.
    /// </summary>
    public static IReadOnlyDictionary<string, long> CountByField(IReadOnlyList<SignalObservationModel> observations)
    {
        ArgumentNullException.ThrowIfNull(observations);
        var counts = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var obs in observations)
        {
            counts[obs.Field] = counts.GetValueOrDefault(obs.Field) + 1;
        }

        return counts;
    }

    /// <summary>Project the catalog for <paramref name="size"/> and <paramref name="search"/>.</summary>
    public static SignalCatalogDisplay Project(
        IReadOnlyList<SignalCatalogEntryModel> entries,
        IReadOnlyDictionary<string, long> observationCounts,
        SignalCatalogSize size,
        string? search,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(entries);
        ArgumentNullException.ThrowIfNull(observationCounts);
        ArgumentNullException.ThrowIfNull(localizer);

        string uncategorized = localizer.GetString(UncategorizedKey, UncategorizedFallback);
        string signalsAvailable = localizer.GetString(SignalsAvailableKey, SignalsAvailableFallback);

        var filtered = Filter(entries, search);

        // Group by category (web `entry.source_module || 'Uncategorized'`), categories sorted
        // alphabetically; rows keep their catalog order within each bucket.
        var buckets = new Dictionary<string, List<SignalCatalogEntryModel>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var entry in filtered)
        {
            string category = string.IsNullOrEmpty(entry.SourceModule) ? uncategorized : entry.SourceModule;
            if (!buckets.TryGetValue(category, out var bucket))
            {
                bucket = new List<SignalCatalogEntryModel>();
                buckets[category] = bucket;
                order.Add(category);
            }

            bucket.Add(entry);
        }

        // Categories sorted alphabetically, case-insensitively (web `localeCompare`); deterministic.
        order.Sort(StringComparer.OrdinalIgnoreCase);

        var groups = new List<SignalCatalogGroup>(order.Count);
        foreach (var category in order)
        {
            var bucket = buckets[category];
            var rows = new List<SignalCatalogRow>(bucket.Count);
            foreach (var entry in bucket)
            {
                long count = observationCounts.GetValueOrDefault(entry.Name);
                rows.Add(BuildRow(entry, count));
            }

            groups.Add(new SignalCatalogGroup(
                Category: category,
                Count: rows.Count,
                CountLabel: string.Create(CultureInfo.InvariantCulture, $"({rows.Count})"),
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0} ({1})", category, rows.Count),
                Rows: rows));
        }

        string totalText = FormatInt(entries.Count);
        return new SignalCatalogDisplay(
            IsCompact: size.IsCompact,
            HasEntries: entries.Count > 0,
            HasMatches: filtered.Count > 0,
            TotalCount: entries.Count,
            TotalCountText: totalText,
            SignalsAvailableLabel: signalsAvailable,
            CompactAutomationName: string.Format(CultureInfo.CurrentCulture, "{0} {1}", totalText, signalsAvailable),
            Groups: groups);
    }

    /// <summary>
    /// The web search predicate: an empty term keeps every entry; otherwise a case-insensitive
    /// substring match against the signal name, the value kind (web <c>description</c> slot) and the
    /// source module.
    /// </summary>
    public static IReadOnlyList<SignalCatalogEntryModel> Filter(IReadOnlyList<SignalCatalogEntryModel> entries, string? search)
    {
        ArgumentNullException.ThrowIfNull(entries);
        string query = (search ?? string.Empty).Trim();
        if (query.Length == 0)
        {
            return entries;
        }

        var matched = new List<SignalCatalogEntryModel>(entries.Count);
        foreach (var entry in entries)
        {
            if (Contains(entry.Name, query) || Contains(entry.UnitLabel, query) || Contains(entry.SourceModule, query))
            {
                matched.Add(entry);
            }
        }

        return matched;
    }

    private static bool Contains(string haystack, string needle) =>
        haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);

    private static SignalCatalogRow BuildRow(SignalCatalogEntryModel entry, long observationCount)
    {
        string countText = FormatInt(observationCount);
        string automation = entry.HasUnit
            ? string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", entry.Name, entry.UnitLabel, countText)
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", entry.Name, countText);

        return new SignalCatalogRow(
            Name: entry.Name,
            UnitLabel: entry.UnitLabel,
            HasUnit: entry.HasUnit,
            ObservationCount: observationCount,
            ObservationCountText: countText,
            AutomationName: automation);
    }

    /// <summary>The web <c>fmtInt</c>: en-US grouped integer (matches <c>Intl.NumberFormat</c>).</summary>
    private static string FormatInt(long value) => NumberFormatting.Format(value, null, 0);
}

/// <summary>
/// Canonical registry metadata for the Signal Catalog surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/telemetry.ts (<c>signal-catalog</c>). The
/// dashboard grid system binds this surface with the same <see cref="Id"/> and honours the same size
/// constraints.
/// </summary>
public static class SignalCatalogRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "signal-catalog";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "telemetry";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalCatalogWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static SignalCatalogSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 2 columns × 4 rows.</summary>
    public static SignalCatalogSize MinSize => new(2, 4);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static SignalCatalogSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Signal Catalog").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.signalCatalog.title", "Signal Catalog");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.signalCatalog.description",
            "Browse all available telemetry signals with categories and observation counts");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(SignalCatalogSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static SignalCatalogSize Clamp(SignalCatalogSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Signal Catalog surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, category, value,
/// observation count, VIN, or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SignalCatalogDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalCatalogDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalCatalogWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalCatalogRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> catalog emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SignalCatalogEntryModel&gt;&gt;</c>, preserving every
/// freshness flag (cached / refreshing / stale / offline) so the view-model can render the full state
/// matrix. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SignalCatalogResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SignalCatalogEntryModel> Parse() =>
            raw.HasValue ? SignalCatalogEntryModel.ParseEnvelope(raw.Value) : Array.Empty<SignalCatalogEntryModel>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>> ToLoadedOrEmpty(
        IReadOnlyList<SignalCatalogEntryModel> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<SignalCatalogEntryModel>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> observation emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SignalObservationModel&gt;&gt;</c>, preserving every
/// freshness flag so the view-model can fold the per-field counts in. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class SignalObservationsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SignalObservationModel>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SignalObservationModel> Parse() =>
            raw.HasValue ? SignalObservationModel.ParseEnvelope(raw.Value) : Array.Empty<SignalObservationModel>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SignalObservationModel>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SignalObservationModel>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SignalObservationModel>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SignalObservationModel>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SignalObservationModel>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SignalObservationModel>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<IReadOnlyList<SignalObservationModel>> ToLoadedOrEmpty(
        IReadOnlyList<SignalObservationModel> parsed,
        DateTimeOffset? fetchedAt)
        => parsed.Count == 0
            ? RepositoryResult<IReadOnlyList<SignalObservationModel>>.Empty(fetchedAt)
            : RepositoryResult<IReadOnlyList<SignalObservationModel>>.Loaded(parsed, fetchedAt ?? DateTimeOffset.UtcNow);
}
