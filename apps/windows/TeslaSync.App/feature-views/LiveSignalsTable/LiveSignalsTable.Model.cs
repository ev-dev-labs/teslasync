using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Live Signals table surface. Every getter returns
/// a nullable / fallback rather than throwing so a partial or schema-drifted live snapshot from
/// <c>GET /signals/{vehicleID}/live</c> never aborts the parse (web parity: the React component coerces
/// every value defensively and never crashes on a typed compound value). Kept private to the surface and
/// free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class LiveSignalsTableJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>Parse an ISO-8601 timestamp string to a UTC-normalised instant, or null when unparseable.</summary>
    public static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>The column the Live Signals table is sorted by (web <c>useSortToggle('name' | 'timestamp')</c>).</summary>
public enum LiveSignalSortKey
{
    /// <summary>Sort by signal name (the web default).</summary>
    Name,

    /// <summary>Sort by the value's last-update timestamp.</summary>
    Timestamp,
}

/// <summary>The sort direction (web <c>'asc' | 'desc'</c>).</summary>
public enum LiveSignalSortDirection
{
    /// <summary>Ascending (the web default).</summary>
    Ascending,

    /// <summary>Descending.</summary>
    Descending,
}

/// <summary>
/// The lifecycle state the Live Signals table can be in. Every branch maps onto a visible surface — none is
/// ever hidden (engineering rule #6). The web shows <c>EmptyState</c> when the snapshot has no signals, and
/// a <c>DataTable</c> (with its own loading / filtered-empty message) otherwise; the native surface
/// additionally renders an explicit <c>error</c> (retry) and <c>offline</c> branch, a strict superset of the
/// web that satisfies the prompt's mandated state set.
/// </summary>
public enum LiveSignalsSectionState
{
    /// <summary>First fetch with nothing cached — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) snapshot with signals to show.</summary>
    Loaded,

    /// <summary>The read resolved with no signals — the friendly "No live signals cached" empty state.</summary>
    Empty,

    /// <summary>The read failed and no cached snapshot exists — the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One parsed live-signal row — the native analogue of the web <c>LiveSignalRow</c>
/// (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx). Holds the signal name,
/// the already-rendered display value (the native port of the web <c>renderValue</c> coercion), and the
/// optional parsed last-update instant used for the relative timestamp cell and the timestamp sort. Pure
/// data — produced by <see cref="ParseSnapshot"/>, unit-tested without a UI host.
/// </summary>
public sealed record LiveSignalRow(string Name, string ValueDisplay, DateTimeOffset? Timestamp)
{
    /// <summary>Em-dash fallback string for an absent value (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// Parse a <c>GET /signals/{vehicleID}/live</c> snapshot object into a tolerant list of rows. The
    /// backend returns <c>{ vehicle_id, signals: { name: { value, timestamp? } | scalar } }</c>; each entry
    /// is normalised through <see cref="RowFromEntry"/> exactly as the web component does. A non-object body
    /// or a missing / non-object <c>signals</c> map yields an empty list.
    /// </summary>
    public static IReadOnlyList<LiveSignalRow> ParseSnapshot(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("signals", out var signals)
            || signals.ValueKind != JsonValueKind.Object)
        {
            return Array.Empty<LiveSignalRow>();
        }

        var rows = new List<LiveSignalRow>();
        foreach (var entry in signals.EnumerateObject())
        {
            rows.Add(RowFromEntry(entry.Name, entry.Value));
        }

        return rows;
    }

    /// <summary>
    /// Normalise a single <c>signals</c> entry into a flat row. The backend may return either a
    /// <c>{ value, timestamp }</c> envelope OR a bare scalar (web <c>rowFromEntry</c>): an object that
    /// carries a <c>value</c> property is unwrapped (its <c>timestamp</c> drives the last-update cell); any
    /// other shape — a bare scalar or a compound object without a <c>value</c> key — flows through whole as
    /// the value, matching the web's <c>'value' in raw</c> discriminator.
    /// </summary>
    public static LiveSignalRow RowFromEntry(string name, JsonElement raw)
    {
        if (raw.ValueKind == JsonValueKind.Object && raw.TryGetProperty("value", out var inner))
        {
            return new LiveSignalRow(
                name,
                RenderValue(inner),
                LiveSignalsTableJson.TryParseTimestamp(LiveSignalsTableJson.GetString(raw, "timestamp")));
        }

        return new LiveSignalRow(name, RenderValue(raw), null);
    }

    /// <summary>
    /// Coerce a JSON value to its display string — the native port of the web <c>renderValue</c>: explicit
    /// <c>null</c> renders the literal "null", an absent value the em-dash, strings render verbatim, numbers
    /// and booleans render their literal text, and any object / array is rendered as compact JSON so a typed
    /// compound value (e.g. a location triple) never crashes the cell.
    /// </summary>
    public static string RenderValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined => EmDash,
        JsonValueKind.Null => "null",
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Object or JsonValueKind.Array => value.GetRawText(),
        _ => EmDash,
    };
}

/// <summary>
/// One projected, render-ready Live Signals row — the parsed <see cref="LiveSignalRow"/> plus a Narrator
/// name composed from the localized column labels. Pure data.
/// </summary>
public sealed record LiveSignalDisplayRow(
    string Name,
    string ValueDisplay,
    DateTimeOffset? Timestamp,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Live Signals table — the filtered + sorted rows the web
/// derives with its <c>useMemo</c> chain. <see cref="HasRows"/> reproduces the web table's
/// populated/empty-message gate (the table shows its filtered-empty copy when no row matches the filter).
/// </summary>
public sealed record LiveSignalsDisplay(IReadOnlyList<LiveSignalDisplayRow> Rows, bool HasRows)
{
    /// <summary>An empty projection (no matching rows) — the projection fallback.</summary>
    public static LiveSignalsDisplay Empty { get; } = new(Array.Empty<LiveSignalDisplayRow>(), false);
}

/// <summary>
/// Pure projection from the parsed signal list to the render-ready display — the native port of the web
/// component's <c>filtered</c> + <c>sorted</c> <c>useMemo</c> chain and the column render functions in
/// web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx. <c>now</c> is injected so
/// the relative-timestamp text is unit-tested deterministically; every label resolves through the i18n
/// facade. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class LiveSignalsProjection
{
    /// <summary>
    /// Filter <paramref name="rows"/> by a case-insensitive name substring (web
    /// <c>name.toLowerCase().includes(filter.trim().toLowerCase())</c>) then stably sort by the chosen
    /// <paramref name="sortKey"/> / <paramref name="sortDir"/> (web <c>localeCompare</c> for names, parsed
    /// instant for timestamps — an absent timestamp sorts as the epoch, i.e. first ascending). Returns the
    /// render-ready rows with their Narrator names.
    /// </summary>
    public static LiveSignalsDisplay Project(
        IReadOnlyList<LiveSignalRow> rows,
        string filter,
        LiveSignalSortKey sortKey,
        LiveSignalSortDirection sortDir,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentNullException.ThrowIfNull(localizer);

        string query = filter.Trim();
        IEnumerable<LiveSignalRow> filtered = query.Length == 0
            ? rows
            : rows.Where(r => r.Name.Contains(query, StringComparison.OrdinalIgnoreCase));

        IEnumerable<LiveSignalRow> sorted = sortKey switch
        {
            LiveSignalSortKey.Timestamp => sortDir == LiveSignalSortDirection.Ascending
                ? filtered.OrderBy(SortInstant)
                : filtered.OrderByDescending(SortInstant),
            _ => sortDir == LiveSignalSortDirection.Ascending
                ? filtered.OrderBy(r => r.Name, StringComparer.CurrentCulture)
                : filtered.OrderByDescending(r => r.Name, StringComparer.CurrentCulture),
        };

        string valueLabel = localizer.GetString("admin.liveSignals.cols.value", "Value");
        string updatedLabel = localizer.GetString("admin.liveSignals.cols.timestamp", "Last update");

        var display = new List<LiveSignalDisplayRow>(rows.Count);
        foreach (var row in sorted)
        {
            display.Add(new LiveSignalDisplayRow(
                row.Name,
                row.ValueDisplay,
                row.Timestamp,
                AutomationName(row, valueLabel, updatedLabel, now)));
        }

        return new LiveSignalsDisplay(display, display.Count > 0);
    }

    /// <summary>The relative last-update text for a row (web <c>TimeStamp format="relative"</c>), em-dash when absent.</summary>
    public static string RelativeTimestamp(DateTimeOffset? value, DateTimeOffset now) =>
        DateTimeFormatting.Format(value, DateTimeVariant.Relative, now);

    // web: null timestamps coerce to Date.parse(undefined) -> 0 (the epoch), so they sort before any real
    // instant in ascending order. DateTimeOffset.MinValue preserves that ordering deterministically.
    private static DateTimeOffset SortInstant(LiveSignalRow row) => row.Timestamp ?? DateTimeOffset.MinValue;

    private static string AutomationName(
        LiveSignalRow row,
        string valueLabel,
        string updatedLabel,
        DateTimeOffset now)
    {
        string updated = row.Timestamp is null ? LiveSignalRow.EmDash : RelativeTimestamp(row.Timestamp, now);
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}: {4}",
            row.Name,
            valueLabel,
            row.ValueDisplay,
            updatedLabel,
            updated);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;LiveSignalRow&gt;&gt;</c>, preserving the cache-then-network
/// status / freshness while parsing the live snapshot (the native analogue of the web hook's typed query
/// result). A loaded-but-signal-less snapshot collapses to <see cref="LoadStatus.Empty"/> so the surface
/// renders its "No live signals cached" empty state. Pure — unit-tested without a network or cache.
/// </summary>
public static class LiveSignalsTableResultMapper
{
    /// <summary>Map a raw live-snapshot emission to a typed signal-row list result.</summary>
    public static RepositoryResult<IReadOnlyList<LiveSignalRow>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<IReadOnlyList<LiveSignalRow>>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<IReadOnlyList<LiveSignalRow>>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<IReadOnlyList<LiveSignalRow>>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var rows = LiveSignalRow.ParseSnapshot(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<LiveSignalRow>>.Cached(rows, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<LiveSignalRow>>.Refreshing(rows, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<LiveSignalRow>>.OfflineCached(
                rows, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ when rows.Count == 0 => RepositoryResult<IReadOnlyList<LiveSignalRow>>.Empty(fetchedAt),
            _ => RepositoryResult<IReadOnlyList<LiveSignalRow>>.Loaded(rows, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Live Signals table surface — the native mirror of the web Live
/// Signal Inspector table (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx).
/// Centralises the stable id and the diagnostics slug so the view and the view-model stay free of literal
/// identifiers.
/// </summary>
public static class LiveSignalsTableRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "live-signals-table";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "LiveSignalsTable";
}

/// <summary>
/// PII-safe diagnostics for the Live Signals table surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, value or vehicle id —
/// so a diagnostics line can never leak which vehicle or telemetry value was involved. Thread-safe.
/// </summary>
public sealed class LiveSignalsTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveSignalsTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveSignalsTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveSignalsTableRegistration.Slug}");
    }
}
