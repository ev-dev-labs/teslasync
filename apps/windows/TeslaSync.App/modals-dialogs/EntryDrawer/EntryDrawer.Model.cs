using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.DlqInspector;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The two payload tabs the drawer exposes — the native union of the web component's
/// <c>activeTab</c> state ('inner' | 'raw') in
/// <c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>. <see cref="Inner"/> shows the
/// decoded inner payload (the default); <see cref="Raw"/> shows the decoded raw MQTT envelope.
/// </summary>
public enum EntryDrawerTab
{
    /// <summary>The inner payload tab (web default <c>'inner'</c>).</summary>
    Inner,

    /// <summary>The raw envelope tab (web <c>'raw'</c>).</summary>
    Raw,
}

/// <summary>
/// The mutually-exclusive branch the EntryDrawer body renders — the native union of the three conditional
/// branches in <c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>
/// (<c>loading &amp;&amp; !full ? Spinner : head ? content : null</c>). The web component is a controlled,
/// presentational drawer: it takes the entry + lifecycle flags as props and performs no fetching, so there
/// is no fetch-driven error / stale / offline branch to reproduce here — those belong to the parent DLQ
/// Inspector page that owns the <c>useDLQEntry</c> query (exactly as the sibling
/// <see cref="EntriesTableState"/> documents). Every branch maps onto a visible surface; the web "render
/// nothing" branch is surfaced as a friendly empty state so a region never collapses into a blank box.
/// </summary>
public enum EntryDrawerState
{
    /// <summary>The full payload is still loading and no full record is present yet (web <c>loading &amp;&amp; !full</c>) — render the spinner.</summary>
    Loading,

    /// <summary>An entry head (full ?? summary) is present (web <c>head</c>) — render the field list + payload tabs.</summary>
    Content,

    /// <summary>No entry head and not loading (web <c>null</c>) — render the friendly empty state.</summary>
    Empty,
}

/// <summary>
/// The style a projected key/value field's value renders with — the native recipe replacing the inline
/// <c>font-mono</c> / muted spans the web component wraps each <c>KVList</c> value in
/// (<c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>). The generic <c>TsKVList</c>
/// renders a single text role, so (like the sibling <c>EntriesTable</c>) the view composes each value from
/// the shared typography primitives keyed off this style.
/// </summary>
public enum EntryFieldStyle
{
    /// <summary>Primary monospace value (web <c>font-mono</c>): id / topic / reason / VIN / source topic.</summary>
    Mono,

    /// <summary>Primary sans value (web default): the arrival timestamp and the redelivery count.</summary>
    Plain,

    /// <summary>Muted sans value (web <c>text-[var(--text-muted)]</c>): the parse error.</summary>
    Muted,
}

/// <summary>
/// One projected label/value row consumed by the drawer's field list — the native analogue of a single web
/// <c>KVList</c> item. Holds the localized label, the pre-formatted value string (em-dash for a missing
/// value) and the <see cref="Style"/> the view renders the value with. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Label">The localized row label (web <c>label</c>).</param>
/// <param name="Value">The pre-formatted value, or the em-dash when missing (web <c>value</c>).</param>
/// <param name="Style">How the value is rendered (mono / plain / muted).</param>
public sealed record EntryDrawerField(string Label, string Value, EntryFieldStyle Style);

/// <summary>
/// The full DLQ entry — the native mirror of the web <c>DLQEntryFull</c> shape in
/// <c>web/src/types/admin-diagnostics.ts</c> (the Go <c>DLQEntryFull</c> DTO: a <c>DLQEntrySummary</c> plus
/// the two payload blobs as base64 strings). Composes the shared
/// <see cref="DlqEntrySummary"/> rather than re-declaring its fields, and carries the heavy raw + inner
/// base64 payloads the drawer lazy-loads. Pure data — no WinUI types.
/// </summary>
/// <param name="Summary">The summary fields (web <c>DLQEntrySummary</c> the full shape extends).</param>
/// <param name="RawPayloadB64">The raw MQTT envelope as base64 (web <c>raw_payload_b64</c>).</param>
/// <param name="InnerPayloadB64">The inner payload as base64 (web <c>inner_payload_b64</c>).</param>
public sealed record DlqEntryFull(DlqEntrySummary Summary, string RawPayloadB64, string InnerPayloadB64);

/// <summary>Tolerant JSON readers shared by the DLQ entry parse adapter (snake_case wire + camelCase alias).</summary>
internal static class DlqEntryJson
{
    /// <summary>Read the first present string property, or <see langword="null"/> when none is a string.</summary>
    public static string? GetString(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.TryGetProperty(name, out JsonElement v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
        }

        return null;
    }

    /// <summary>Read the first present long (number or numeric string), or <see langword="null"/> when absent.</summary>
    public static long? GetLong(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (!obj.TryGetProperty(name, out JsonElement v))
            {
                continue;
            }

            switch (v.ValueKind)
            {
                case JsonValueKind.Number when v.TryGetInt64(out long n):
                    return n;
                case JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out long s):
                    return s;
                default:
                    break;
            }
        }

        return null;
    }

    /// <summary>Read the first present integer, or <see langword="null"/> when absent (web nullable <c>number</c>).</summary>
    public static int? GetInt(JsonElement obj, params string[] names) =>
        GetLong(obj, names) is { } v ? (int)v : null;

    /// <summary>Read the first present boolean, defaulting to <see langword="false"/> (web <c>replayable</c>).</summary>
    public static bool GetBool(JsonElement obj, params string[] names)
    {
        foreach (string name in names)
        {
            if (obj.TryGetProperty(name, out JsonElement v))
            {
                if (v.ValueKind == JsonValueKind.True)
                {
                    return true;
                }

                if (v.ValueKind == JsonValueKind.False)
                {
                    return false;
                }
            }
        }

        return false;
    }
}

/// <summary>
/// The parse adapter from a <c>GET /system/dlq/{id}</c> JSON object to the native DLQ records — the native
/// mirror of the web <c>DLQEntrySummary</c> / <c>DLQEntryFull</c> DTOs (<c>web/src/types/admin-diagnostics.ts</c>).
/// Tolerant of the snake_case wire and the camelCase aliases produced by <c>camelCaseKeys</c> so the native
/// read never drifts from the web. Kept pure so the adapter is unit-tested without a network.
/// </summary>
public static class DlqEntryParsing
{
    /// <summary>Project a DLQ entry JSON object into the shared <see cref="DlqEntrySummary"/> contract.</summary>
    public static DlqEntrySummary ParseSummary(JsonElement obj) => new(
        Id: DlqEntryJson.GetLong(obj, "id") ?? 0,
        ArrivedAt: DlqEntryJson.GetString(obj, "arrived_at", "arrivedAt") ?? string.Empty,
        ParsedReason: DlqEntryJson.GetString(obj, "parsed_reason", "parsedReason") ?? string.Empty,
        Replayable: DlqEntryJson.GetBool(obj, "replayable"),
        RawPayloadSize: DlqEntryJson.GetLong(obj, "raw_payload_size", "rawPayloadSize") ?? 0,
        ParsedVin: DlqEntryJson.GetString(obj, "parsed_vin", "parsedVin"),
        ParsedSourceTopic: DlqEntryJson.GetString(obj, "parsed_source_topic", "parsedSourceTopic"),
        ParsedRedeliveries: DlqEntryJson.GetInt(obj, "parsed_redeliveries", "parsedRedeliveries"),
        DlqTopic: DlqEntryJson.GetString(obj, "dlq_topic", "dlqTopic") ?? string.Empty,
        ParsedVehicleId: DlqEntryJson.GetLong(obj, "parsed_vehicle_id", "parsedVehicleId"),
        ParsedTimestamp: DlqEntryJson.GetString(obj, "parsed_timestamp", "parsedTimestamp"),
        ParseError: DlqEntryJson.GetString(obj, "parse_error", "parseError"),
        InnerPayloadSize: DlqEntryJson.GetLong(obj, "inner_payload_size", "innerPayloadSize") ?? 0);

    /// <summary>Project a DLQ entry JSON object into a <see cref="DlqEntryFull"/> (summary + both base64 payloads).</summary>
    public static DlqEntryFull ParseFull(JsonElement obj) => new(
        Summary: ParseSummary(obj),
        RawPayloadB64: DlqEntryJson.GetString(obj, "raw_payload_b64", "rawPayloadB64") ?? string.Empty,
        InnerPayloadB64: DlqEntryJson.GetString(obj, "inner_payload_b64", "innerPayloadB64") ?? string.Empty);
}

/// <summary>
/// Pure projection from the drawer's controlled inputs (summary / full / loading / replay flags / active
/// tab) to its render-ready model — the native port of every <c>useMemo</c> / derived value in
/// <c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>: the <c>head = full ?? summary</c>
/// fallback, the base64 → UTF-8 decode, the eight field rows, the payload viewer text (decoded body or the
/// binary fallback marker), the copy-button value, the replay-disabled gate and the drawer title. Every
/// label resolves through the i18n facade; <c>now</c> is injected so the absolute timestamp is deterministic.
/// </summary>
public static class EntryDrawerProjection
{
    /// <summary>Em-dash shown for a missing value (web <c>'\u2014'</c>).</summary>
    public const string EmDash = "\u2014";

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>The head record the drawer renders — the full record when loaded, else the cached summary (web <c>full ?? summary</c>).</summary>
    public static DlqEntrySummary? Head(DlqEntryFull? full, DlqEntrySummary? summary) => full?.Summary ?? summary;

    /// <summary>Resolve the render branch from the controlled inputs (web <c>loading &amp;&amp; !full ? … : head ? … : null</c>).</summary>
    public static EntryDrawerState ResolveState(bool loading, DlqEntryFull? full, DlqEntrySummary? head)
    {
        if (loading && full is null)
        {
            return EntryDrawerState.Loading;
        }

        return head is not null ? EntryDrawerState.Content : EntryDrawerState.Empty;
    }

    /// <summary>
    /// Decode a base64 string as strict UTF-8, mirroring the web <c>decodeBase64Utf8</c> (<c>atob</c> +
    /// <c>TextDecoder('utf-8', { fatal: true })</c>): an empty input, invalid base64 or a non-UTF-8 (binary
    /// protobuf) body all return the empty string so the drawer falls back to the binary marker instead of
    /// crashing.
    /// </summary>
    public static string DecodeBase64Utf8(string? b64)
    {
        if (string.IsNullOrEmpty(b64))
        {
            return string.Empty;
        }

        try
        {
            byte[] bytes = Convert.FromBase64String(b64);
            return StrictUtf8.GetString(bytes);
        }
        catch (FormatException)
        {
            return string.Empty;
        }
        catch (DecoderFallbackException)
        {
            return string.Empty;
        }
    }

    /// <summary>The drawer title — "DLQ entry #{id}" when a head is present, else the fallback (web <c>title</c> / <c>titleFallback</c>).</summary>
    public static string Title(DlqEntrySummary? head, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return head is { } h
            ? Fill(
                localizer.GetString("admin.dlq.drawer.title", "DLQ entry #{{id}}"),
                ("id", h.Id.ToString(CultureInfo.InvariantCulture)))
            : localizer.GetString("admin.dlq.drawer.titleFallback", "DLQ entry");
    }

    /// <summary>
    /// Build the eight summary field rows the web <c>KVList</c> renders, in source order: id, arrived,
    /// DLQ topic, reason, VIN, source topic, redeliveries and parse error. Missing values become the
    /// em-dash exactly as the web does (<c>||</c> for topic / reason / parse error, <c>??</c> for VIN /
    /// source topic).
    /// </summary>
    public static IReadOnlyList<EntryDrawerField> BuildFields(DlqEntrySummary head, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(head);
        ArgumentNullException.ThrowIfNull(localizer);

        return new[]
        {
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.id", "ID"),
                head.Id.ToString(CultureInfo.InvariantCulture),
                EntryFieldStyle.Mono),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.arrivedAt", "Arrived"),
                FormatAbsolute(head.ArrivedAt, now),
                EntryFieldStyle.Plain),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.dlqTopic", "DLQ topic"),
                EmptyToDash(head.DlqTopic),
                EntryFieldStyle.Mono),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.reason", "Reason"),
                EmptyToDash(head.ParsedReason),
                EntryFieldStyle.Mono),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.vin", "VIN"),
                NullToDash(head.ParsedVin),
                EntryFieldStyle.Mono),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.sourceTopic", "Source topic"),
                NullToDash(head.ParsedSourceTopic),
                EntryFieldStyle.Mono),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.redeliveries", "Redeliveries"),
                head.ParsedRedeliveries is { } r ? r.ToString("N0", CultureInfo.InvariantCulture) : EmDash,
                EntryFieldStyle.Plain),
            new EntryDrawerField(
                localizer.GetString("admin.dlq.drawer.parseError", "Parse error"),
                EmptyToDash(head.ParseError),
                EntryFieldStyle.Muted),
        };
    }

    /// <summary>
    /// The payload viewer text for a tab — the decoded UTF-8 body, or the localized "(non-UTF-8 …)" binary
    /// marker carrying the payload size when the body is empty / binary (web <c>&lt;pre&gt;</c> content).
    /// </summary>
    public static string PayloadText(
        EntryDrawerTab tab,
        DlqEntrySummary head,
        string innerText,
        string rawText,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(head);
        ArgumentNullException.ThrowIfNull(localizer);

        if (tab == EntryDrawerTab.Inner)
        {
            return string.IsNullOrEmpty(innerText)
                ? Fill(
                    localizer.GetString(
                        "admin.dlq.drawer.binaryPayload",
                        "(non-UTF-8 binary, {{n}} bytes \u2014 use the copy button to download base64)"),
                    ("n", head.InnerPayloadSize.ToString(CultureInfo.InvariantCulture)))
                : innerText;
        }

        return string.IsNullOrEmpty(rawText)
            ? Fill(
                localizer.GetString(
                    "admin.dlq.drawer.binaryEnvelope",
                    "(non-UTF-8 envelope, {{n}} bytes \u2014 use the copy button to download base64)"),
                ("n", head.RawPayloadSize.ToString(CultureInfo.InvariantCulture)))
            : rawText;
    }

    /// <summary>
    /// The clipboard value for a tab — the decoded body when present, else the raw base64 blob, else empty
    /// (web <c>innerText || full?.inner_payload_b64 || ''</c> / the raw equivalent).
    /// </summary>
    public static string CopyText(EntryDrawerTab tab, DlqEntryFull? full, string innerText, string rawText)
    {
        if (tab == EntryDrawerTab.Inner)
        {
            return FirstNonEmpty(innerText, full?.InnerPayloadB64);
        }

        return FirstNonEmpty(rawText, full?.RawPayloadB64);
    }

    /// <summary>
    /// Whether the replay action is disabled (web <c>replayDisabled</c>): the server flag is off, the entry
    /// is not replayable (or absent), a replay is in flight, or the full payload is still loading.
    /// </summary>
    public static bool ReplayDisabled(bool replayEnabled, DlqEntrySummary? head, bool replayInFlight, bool loading) =>
        !replayEnabled || head is not { Replayable: true } || replayInFlight || loading;

    /// <summary>Substitute <c>{{token}}</c> i18next-style interpolation markers in a localized template.</summary>
    public static string Fill(string template, params (string Token, string Value)[] substitutions)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(substitutions);
        string result = template;
        foreach ((string token, string value) in substitutions)
        {
            result = result.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
        }

        return result;
    }

    // Web `<TimeStamp value={head.arrived_at} format="absolute" />`: the absolute datetime, or the em-dash
    // when the value is null / unparseable (matches the EntriesTable sibling's FormatArrived).
    private static string FormatAbsolute(string? raw, DateTimeOffset now)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out DateTimeOffset value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return EmDash;
    }

    // Web `value || '\u2014'`: null OR empty falls back to the em-dash.
    private static string EmptyToDash(string? value) => string.IsNullOrEmpty(value) ? EmDash : value;

    // Web `value ?? '\u2014'`: only null falls back to the em-dash.
    private static string NullToDash(string? value) => value ?? EmDash;

    private static string FirstNonEmpty(string primary, string? fallback) =>
        !string.IsNullOrEmpty(primary) ? primary : fallback ?? string.Empty;
}

/// <summary>
/// Canonical registry metadata + localized chrome labels for the EntryDrawer surface — the native mirror of
/// the web component's <c>t()</c> call sites
/// (<c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>). Every label flows through one
/// keyed call so the resource keys are asserted in tests and resolved for real in the app; the labels also
/// double as the Narrator-name source for the view's interactive elements.
/// </summary>
public static class EntryDrawerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "EntryDrawer";

    /// <summary>The accessible region label for the drawer surface (reuses the page title key).</summary>
    public static string RegionLabel(ILocalizer localizer) =>
        Resolve(localizer, "admin.dlq.pageTitle", "DLQ Inspector");

    /// <summary>The inner-payload tab label (web <c>admin.dlq.drawer.tabs.inner</c>).</summary>
    public static string TabInner(ILocalizer localizer) =>
        Resolve(localizer, "admin.dlq.drawer.tabs.inner", "Inner payload");

    /// <summary>The raw-envelope tab label (web <c>admin.dlq.drawer.tabs.raw</c>).</summary>
    public static string TabRaw(ILocalizer localizer) =>
        Resolve(localizer, "admin.dlq.drawer.tabs.raw", "Raw envelope");

    /// <summary>The replay button label (web <c>admin.dlq.drawer.replay</c>).</summary>
    public static string Replay(ILocalizer localizer) =>
        Resolve(localizer, "admin.dlq.drawer.replay", "Replay");

    /// <summary>The close button / dismiss label (web <c>common.close</c>).</summary>
    public static string Close(ILocalizer localizer) =>
        Resolve(localizer, "common.close", "Close");

    /// <summary>The idle copy-button label (web <c>common.copyButton.copy</c>).</summary>
    public static string Copy(ILocalizer localizer) =>
        Resolve(localizer, "common.copyButton.copy", "Copy");

    /// <summary>The post-copy confirmation label (web <c>common.copyButton.copied</c>).</summary>
    public static string Copied(ILocalizer localizer) =>
        Resolve(localizer, "common.copyButton.copied", "Copied");

    /// <summary>The friendly empty-state message shown when the drawer is open with no entry (web renders nothing).</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Resolve(localizer, "common.noData", "No data available");

    private static string Resolve(ILocalizer localizer, string key, string fallback)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(key, fallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the EntryDrawer (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never an entry id, VIN, topic or payload — so a
/// diagnostics line can never leak dead-letter contents. Thread-safe.
/// </summary>
public sealed class EntryDrawerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EntryDrawerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EntryDrawer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EntryDrawerRegistration.Slug}");
    }
}
