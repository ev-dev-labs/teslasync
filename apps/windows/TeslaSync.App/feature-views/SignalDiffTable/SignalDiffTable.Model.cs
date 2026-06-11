using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers + numeric coercion for the Signal Diff table surface —
/// the native port of the defensive helpers in
/// web/src/features/telemetry/components/SignalDiffTable.tsx (<c>asNumber</c>, <c>formatRaw</c>,
/// <c>fmtNumber</c>). Every getter returns a nullable / fallback rather than throwing so a partial or
/// schema-drifted diff row from <c>GET /signals/{vehicleID}/diff</c> never aborts the parse. Kept private to
/// the surface and free of WinUI types so the coercion is unit-tested without a UI host.
/// </summary>
internal static class SignalDiffFormat
{
    /// <summary>Locale-aware fixed-precision number format (web <c>fmtNumber</c>; default precision 2).</summary>
    public static string Number(double value, int decimals = 2)
    {
        double safe = double.IsFinite(value) ? value : 0d;
        return safe.ToString("N" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.CurrentCulture);
    }
}

/// <summary>
/// The lifecycle state the Signal Diff table can be in. Every branch maps onto a visible surface — none is
/// ever hidden (engineering rule #6). The web renders a <c>DataTable</c> (with its own loading + empty
/// message) over the rows its parent diffs; the native surface owns the cache-then-network read and so
/// additionally renders explicit <c>error</c> (retry), <c>stale</c> and <c>offline</c> branches, a strict
/// superset of the web that satisfies the prompt's mandated state set.
/// </summary>
public enum SignalDiffSectionState
{
    /// <summary>First fetch with nothing cached — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) diff with rows to show.</summary>
    Loaded,

    /// <summary>The read resolved with no differing signals — the friendly empty state.</summary>
    Empty,

    /// <summary>The read failed and no cached diff exists — the retry affordance.</summary>
    Error,

    /// <summary>A cached diff older than the freshness window — rows plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached diff remains — rows plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The visual tone of a rendered Δ (delta) cell — the native encoding of the web component's colour rules
/// (<c>text-emerald-300</c> / <c>text-rose-300</c> / <c>text-amber-300</c> / muted em-dash).
/// </summary>
public enum SignalDiffDeltaTone
{
    /// <summary>Numeric increase (Window B &gt; Window A) — success tint.</summary>
    Positive,

    /// <summary>Numeric decrease (Window B &lt; Window A) — danger tint.</summary>
    Negative,

    /// <summary>Numeric delta of exactly zero — muted.</summary>
    Neutral,

    /// <summary>Non-numeric values that differ — amber "changed" chip.</summary>
    Changed,

    /// <summary>Values that render identically — muted em-dash.</summary>
    NoChange,
}

/// <summary>
/// One parsed signal-diff row — the native analogue of the web <c>SignalDiffRow</c>
/// (web/src/api/hooks/useTelemetry.ts). The arbitrary JSON <c>value_a</c> / <c>value_b</c> are coerced once
/// at parse time into their already-rendered display string (<see cref="DisplayA"/> / <see cref="DisplayB"/>,
/// the port of the web <c>formatRaw</c>) plus an optional numeric projection (<see cref="NumericA"/> /
/// <see cref="NumericB"/>, the port of <c>asNumber</c>) so the row is decoupled from the parent
/// <see cref="JsonDocument"/> lifetime and the Δ is computed without re-reading JSON. Pure data — produced by
/// <see cref="ParseResponse"/>, unit-tested without a UI host.
/// </summary>
public sealed record SignalDiffRow(
    string Name,
    string DisplayA,
    string DisplayB,
    double? NumericA,
    double? NumericB,
    string? SourceA,
    string? SourceB,
    double? AgeMsA,
    double? AgeMsB,
    bool Changed)
{
    /// <summary>Em-dash fallback string for an absent value (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>
    /// Parse a <c>GET /signals/{vehicleID}/diff</c> response into a tolerant list of rows. The backend
    /// returns <c>{ vehicle_id, at_a, at_b, count, data: [ { name, value_a, value_b, source_a, source_b,
    /// age_ms_a, age_ms_b, changed } ] }</c>; each entry is normalised through <see cref="RowFromElement"/>.
    /// A non-object body or a missing / non-array <c>data</c> field yields an empty list.
    /// </summary>
    public static IReadOnlyList<SignalDiffRow> ParseResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SignalDiffRow>();
        }

        var rows = new List<SignalDiffRow>(data.GetArrayLength());
        foreach (var entry in data.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? name = GetString(entry, "name");
            if (string.IsNullOrEmpty(name))
            {
                continue;
            }

            rows.Add(RowFromElement(name, entry));
        }

        return rows;
    }

    /// <summary>Normalise a single diff entry object into a flat, render-ready row.</summary>
    public static SignalDiffRow RowFromElement(string name, JsonElement entry)
    {
        JsonElement valueA = Property(entry, "value_a");
        JsonElement valueB = Property(entry, "value_b");

        return new SignalDiffRow(
            name,
            FormatRaw(valueA),
            FormatRaw(valueB),
            AsNumber(valueA),
            AsNumber(valueB),
            GetString(entry, "source_a"),
            GetString(entry, "source_b"),
            GetAgeMs(entry, "age_ms_a"),
            GetAgeMs(entry, "age_ms_b"),
            entry.TryGetProperty("changed", out var changed) && changed.ValueKind == JsonValueKind.True);
    }

    /// <summary>
    /// Coerce a JSON value to its display string — the native port of the web <c>formatRaw</c>: absent /
    /// explicit null renders the em-dash, numbers render with locale precision, booleans render their literal
    /// text, strings render verbatim, and any object / array renders as compact JSON so a typed compound
    /// value never crashes the cell.
    /// </summary>
    public static string FormatRaw(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.Undefined or JsonValueKind.Null => EmDash,
        JsonValueKind.Number => value.TryGetDouble(out var n) && double.IsFinite(n) ? SignalDiffFormat.Number(n) : EmDash,
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.String => value.GetString() ?? string.Empty,
        JsonValueKind.Object or JsonValueKind.Array => value.GetRawText(),
        _ => EmDash,
    };

    /// <summary>
    /// Project a JSON value to a finite number, or null — the native port of the web <c>asNumber</c>: a JSON
    /// number flows through, a numeric string is parsed (empty / non-numeric → null), a boolean maps to 1 / 0,
    /// and anything else (null, object, array) is non-numeric.
    /// </summary>
    public static double? AsNumber(JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Number:
                return value.TryGetDouble(out var n) && double.IsFinite(n) ? n : null;
            case JsonValueKind.True:
                return 1d;
            case JsonValueKind.False:
                return 0d;
            case JsonValueKind.String:
                string raw = value.GetString() ?? string.Empty;
                if (raw.Trim().Length == 0)
                {
                    return null;
                }

                return double.TryParse(
                    raw.Trim(),
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out var parsed) && double.IsFinite(parsed)
                    ? parsed
                    : null;
            default:
                return null;
        }
    }

    private static JsonElement Property(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var prop) ? prop : default;

    private static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    private static double? GetAgeMs(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Number
        && prop.TryGetDouble(out var ms)
        && double.IsFinite(ms)
            ? ms
            : null;
}

/// <summary>
/// The computed Δ (delta) cell for one diff row — the native port of the web component's <c>deltaLabel</c>
/// plus its render branch. <see cref="Tone"/> drives the cell tint; <see cref="Text"/> is the rendered,
/// already-localized string ("changed", the em-dash, or the signed delta + percent).
/// </summary>
public sealed record SignalDiffDeltaCell(SignalDiffDeltaTone Tone, string Text)
{
    /// <summary>
    /// Compute the Δ cell from the two coerced values, exactly as the web does: when both Window values are
    /// finite numbers, show the signed numeric delta and (when Window A is non-zero) the percent change;
    /// otherwise, when the two display strings are identical, show the muted em-dash; otherwise show the
    /// amber localized "changed" chip.
    /// </summary>
    public static SignalDiffDeltaCell Compute(SignalDiffRow row, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(row);
        ArgumentNullException.ThrowIfNull(localizer);

        if (row.NumericA is { } a && row.NumericB is { } b)
        {
            double delta = b - a;
            double? pct = a != 0 ? (delta / Math.Abs(a)) * 100d : null;
            SignalDiffDeltaTone tone = delta > 0
                ? SignalDiffDeltaTone.Positive
                : delta < 0 ? SignalDiffDeltaTone.Negative : SignalDiffDeltaTone.Neutral;

            string sign = delta > 0 ? "+" : string.Empty;
            string text = sign + SignalDiffFormat.Number(delta);
            if (pct is { } p)
            {
                string pctSign = p >= 0 ? "+" : string.Empty;
                text += " (" + pctSign + SignalDiffFormat.Number(p, 1) + "%)";
            }

            return new SignalDiffDeltaCell(tone, text);
        }

        if (string.Equals(row.DisplayA, row.DisplayB, StringComparison.Ordinal))
        {
            return new SignalDiffDeltaCell(SignalDiffDeltaTone.NoChange, SignalDiffRow.EmDash);
        }

        return new SignalDiffDeltaCell(SignalDiffDeltaTone.Changed, localizer.GetString("signalDiff.deltaChanged", "changed"));
    }
}

/// <summary>
/// One projected, render-ready Signal Diff row — the parsed row's display fields plus its computed Δ cell,
/// pinned flag, and a Narrator name composed from the localized column labels. Pure data.
/// </summary>
public sealed record SignalDiffDisplayRow(
    string Name,
    string DisplayA,
    string DisplayB,
    SignalDiffDeltaTone DeltaTone,
    string DeltaText,
    string? SourceA,
    string? SourceB,
    double? AgeMsA,
    double? AgeMsB,
    bool IsPinned,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Signal Diff table — the filtered + pinned-first-sorted rows
/// the web derives with its <c>sortedRows</c> <c>useMemo</c>. <see cref="HasRows"/> reproduces the web
/// table's populated / empty-message gate (the table shows its filtered-empty copy when no row matches the
/// active filter).
/// </summary>
public sealed record SignalDiffDisplay(IReadOnlyList<SignalDiffDisplayRow> Rows, bool HasRows)
{
    /// <summary>An empty projection (no matching rows) — the projection fallback.</summary>
    public static SignalDiffDisplay Empty { get; } = new(Array.Empty<SignalDiffDisplayRow>(), false);
}

/// <summary>
/// Pure projection from the parsed diff rows to the render-ready display — the native port of the web
/// component's <c>sortedRows</c> <c>useMemo</c> (pinned-first, then name) plus its per-column render
/// functions (Δ via <see cref="SignalDiffDeltaCell"/>). The optional name filter reproduces the parent page's search
/// (<c>filterActive</c>). Every label resolves through the i18n facade. No WinUI types — unit-tested without
/// a UI host.
/// </summary>
public static class SignalDiffProjection
{
    /// <summary>
    /// Filter <paramref name="rows"/> by a case-insensitive name substring (the parent page's search) then
    /// stably sort pinned signals first (web <c>pinnedSignals.has</c>) and the rest by name
    /// (<c>localeCompare</c>). Returns the render-ready rows with their Δ cells and Narrator names.
    /// </summary>
    public static SignalDiffDisplay Project(
        IReadOnlyList<SignalDiffRow> rows,
        string filter,
        IReadOnlySet<string> pinned,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentNullException.ThrowIfNull(pinned);
        ArgumentNullException.ThrowIfNull(localizer);

        string query = filter.Trim();
        IEnumerable<SignalDiffRow> filtered = query.Length == 0
            ? rows
            : rows.Where(r => r.Name.Contains(query, StringComparison.OrdinalIgnoreCase));

        var sorted = filtered
            .OrderByDescending(r => pinned.Contains(r.Name))
            .ThenBy(r => r.Name, StringComparer.CurrentCulture);

        string labelA = localizer.GetString("signalDiff.valueA", "Window A");
        string labelB = localizer.GetString("signalDiff.valueB", "Window B");
        string labelDelta = localizer.GetString("signalDiff.delta", "\u0394");

        var display = new List<SignalDiffDisplayRow>(rows.Count);
        foreach (var row in sorted)
        {
            var delta = SignalDiffDeltaCell.Compute(row, localizer);
            display.Add(new SignalDiffDisplayRow(
                row.Name,
                row.DisplayA,
                row.DisplayB,
                delta.Tone,
                delta.Text,
                row.SourceA,
                row.SourceB,
                row.AgeMsA,
                row.AgeMsB,
                pinned.Contains(row.Name),
                AutomationName(row, delta, labelA, labelB, labelDelta)));
        }

        return new SignalDiffDisplay(display, display.Count > 0);
    }

    private static string AutomationName(
        SignalDiffRow row,
        SignalDiffDeltaCell delta,
        string labelA,
        string labelB,
        string labelDelta)
    {
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}: {4}, {5}: {6}",
            row.Name,
            labelA,
            row.DisplayA,
            labelB,
            row.DisplayB,
            labelDelta,
            delta.Text);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SignalDiffRow&gt;&gt;</c>, preserving the cache-then-network
/// status / freshness while parsing the diff payload (the native analogue of the web hook's typed query
/// result). A loaded-but-empty diff collapses to <see cref="LoadStatus.Empty"/> so the surface renders its
/// "No differences between the two snapshots" empty state. Pure — unit-tested without a network or cache.
/// </summary>
public static class SignalDiffTableResultMapper
{
    /// <summary>Map a raw diff emission to a typed diff-row list result.</summary>
    public static RepositoryResult<IReadOnlyList<SignalDiffRow>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<IReadOnlyList<SignalDiffRow>>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<IReadOnlyList<SignalDiffRow>>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<IReadOnlyList<SignalDiffRow>>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var rows = SignalDiffRow.ParseResponse(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SignalDiffRow>>.Cached(rows, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SignalDiffRow>>.Refreshing(rows, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SignalDiffRow>>.OfflineCached(
                rows, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ when rows.Count == 0 => RepositoryResult<IReadOnlyList<SignalDiffRow>>.Empty(fetchedAt),
            _ => RepositoryResult<IReadOnlyList<SignalDiffRow>>.Loaded(rows, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Signal Diff table surface — the native mirror of the web Signal Diff
/// table (web/src/features/telemetry/components/SignalDiffTable.tsx). Centralises the stable id and the
/// diagnostics slug so the view and the view-model stay free of literal identifiers.
/// </summary>
public static class SignalDiffTableRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "signal-diff-table";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SignalDiffTable";
}

/// <summary>
/// PII-safe diagnostics for the Signal Diff table surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a signal name, value or vehicle id —
/// so a diagnostics line can never leak which vehicle or telemetry value was involved. Thread-safe.
/// </summary>
public sealed class SignalDiffTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalDiffTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalDiffTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalDiffTableRegistration.Slug}");
    }
}
