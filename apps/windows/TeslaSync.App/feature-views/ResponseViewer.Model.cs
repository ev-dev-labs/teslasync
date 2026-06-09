using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch for the <see cref="ResponseViewerViewModel"/>'s response panel — the
/// three (and only three) branches the web source has
/// (web/src/features/admin/components/ResponseViewer.tsx): a <see cref="Loading"/> shimmer, a friendly
/// <see cref="Empty"/> surface when no response has resolved, and the populated <see cref="Response"/> view
/// (status bar + body + headers). The web component is presentational — its only hook is
/// <c>useTranslation</c> and every value arrives as a prop — so there is deliberately no error / stale /
/// offline branch to reproduce: a failed request is delivered as a <see cref="Response"/> with a 4xx/5xx
/// status (rendered with the danger tint inside the response branch), and connectivity belongs to the parent
/// page that owns the fetch.
/// </summary>
public enum ResponseViewerState
{
    /// <summary>A request is in flight — render the shimmer skeleton (web <c>loading</c> branch).</summary>
    Loading,

    /// <summary>No response has resolved — render the friendly empty surface, never a blank box (web <c>!response</c>).</summary>
    Empty,

    /// <summary>A response resolved — render the status bar, body and headers (web <c>response</c> branch).</summary>
    Response,
}

/// <summary>
/// One response header pair — the native analogue of a web <c>Record&lt;string, string&gt;</c> entry rendered
/// by the <c>ResponseHeaders</c> toggle. Pure data.
/// </summary>
/// <param name="Name">The header name (web map key).</param>
/// <param name="Value">The header value (web map value).</param>
public sealed record HttpHeaderEntry(string Name, string Value);

/// <summary>
/// The resolved API response the surface renders — the native mirror of the web <c>ApiResponse</c> interface
/// (web/src/features/admin/components/ResponseViewer.tsx). Field names echo the web shape verbatim. Pure data
/// so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Status">The HTTP status code (web <c>status</c>).</param>
/// <param name="StatusText">The HTTP reason phrase (web <c>statusText</c>).</param>
/// <param name="Headers">The response headers (web <c>headers</c> record).</param>
/// <param name="Body">The decoded body, rendered as indented JSON when the content type is JSON and it is not a string (web <c>body</c>).</param>
/// <param name="BodyText">The raw body text, rendered when the body is not JSON (web <c>bodyText</c>).</param>
/// <param name="Duration">The round-trip time in milliseconds (web <c>duration</c>).</param>
/// <param name="Size">The payload size in bytes (web <c>size</c>).</param>
/// <param name="ContentType">The response content type (web <c>contentType</c>).</param>
public sealed record ApiResponseSnapshot(
    int Status,
    string StatusText,
    IReadOnlyList<HttpHeaderEntry> Headers,
    object? Body,
    string BodyText,
    double Duration,
    long Size,
    string ContentType);

/// <summary>
/// One recent-request entry shown in the history strip — the native mirror of the web <c>HistoryEntry</c>
/// interface (web/src/features/admin/components/ResponseViewer.tsx). Carried verbatim through the projection
/// so the view can echo it straight back through the replay callback (web <c>onReplay</c>). Pure data.
/// </summary>
/// <param name="Method">The HTTP verb (web <c>method</c>).</param>
/// <param name="Path">The request path (web <c>path</c>).</param>
/// <param name="Status">The HTTP status code (web <c>status</c>).</param>
/// <param name="Duration">The round-trip time in milliseconds (web <c>duration</c>).</param>
/// <param name="Timestamp">The request timestamp (web <c>timestamp</c>).</param>
public sealed record RequestHistoryEntry(
    string Method,
    string Path,
    int Status,
    double Duration,
    string Timestamp);

/// <summary>
/// The inputs that drive one render of the surface — the native analogue of the web
/// <c>ResponseViewerProps</c> (<c>{ response, loading, history }</c>; the <c>onReplay</c> callback is wired on
/// the view, not projected). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">Whether a request is in flight (web <c>loading</c>).</param>
/// <param name="Response">The resolved response, or <see langword="null"/> when none (web <c>response</c>).</param>
/// <param name="History">The recent-request history strip (web <c>history</c>).</param>
public sealed record ResponseViewerInput(
    bool Loading,
    ApiResponseSnapshot? Response,
    IReadOnlyList<RequestHistoryEntry> History)
{
    /// <summary>The resting input — not loading, no response, no history (the surface's idle props).</summary>
    public static ResponseViewerInput Idle { get; } =
        new(false, null, System.Array.Empty<RequestHistoryEntry>());

    /// <summary>A loading input carrying an optional history strip (the web <c>loading</c> branch).</summary>
    public static ResponseViewerInput Busy(IReadOnlyList<RequestHistoryEntry>? history = null) =>
        new(true, null, history ?? System.Array.Empty<RequestHistoryEntry>());
}

/// <summary>
/// The render-ready view of one history chip — the native projection of a web
/// <c>&lt;UiButton&gt;…&lt;MethodBadge/&gt;{h.path}{h.status}{h.duration}ms&lt;/UiButton&gt;</c>. Carries the
/// source <see cref="Entry"/> so the view echoes it back through the replay callback exactly as the web passes
/// <c>h</c> to <c>onReplay</c>. Pure data — no WinUI types.
/// </summary>
/// <param name="Entry">The source entry echoed back on replay (web <c>h</c>).</param>
/// <param name="Method">The verb shown in the badge (web <c>{h.method}</c>).</param>
/// <param name="MethodBrushKey">The design-token brush key tinting the method badge (web <c>METHOD bg color</c>).</param>
/// <param name="Path">The request path shown in the chip (web <c>{h.path}</c>).</param>
/// <param name="Status">The HTTP status code (web <c>{h.status}</c>).</param>
/// <param name="StatusBrushKey">The design-token brush key tinting the status (web <c>statusColor</c>).</param>
/// <param name="DurationText">The formatted duration, e.g. "120ms" (web <c>{h.duration}ms</c>).</param>
/// <param name="Tooltip">The chip tooltip, e.g. "GET /vehicles → 200 (120ms)" (web <c>title</c>).</param>
/// <param name="AutomationName">The Narrator name for the chip (the same composed summary).</param>
public sealed record RequestHistoryRow(
    RequestHistoryEntry Entry,
    string Method,
    string MethodBrushKey,
    string Path,
    int Status,
    string StatusBrushKey,
    string DurationText,
    string Tooltip,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view for one set of inputs — the native analogue of the web
/// <c>ResponseViewer</c> render output. Carries the chosen <see cref="State"/>, the resolved response strings
/// and semantic status tint, the (self-hiding) header rows, and the (self-hiding) history strip, plus the
/// Narrator names. Pure data — no WinUI types — so the projection is unit-tested headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive response-panel branch.</param>
/// <param name="ResponseTitle">The localized "Response" panel heading (web <c>playground.response</c>).</param>
/// <param name="ResponseRegionName">The Narrator name for the response panel region.</param>
/// <param name="EmptyMessage">The localized empty-surface message (web <c>playground.noResponse</c>).</param>
/// <param name="HasResponse">True when <see cref="State"/> is <see cref="ResponseViewerState.Response"/>.</param>
/// <param name="StatusText">The status line, e.g. "200 OK" (web <c>{status} {statusText}</c>).</param>
/// <param name="StatusBrushKey">The semantic token tinting the status line + bar (web <c>statusColor</c>/<c>statusBg</c>).</param>
/// <param name="StatusBodyName">The Narrator name announced for the response body live region.</param>
/// <param name="MetaText">The right-aligned meta line, e.g. "120ms · 4.5 KB" (web <c>{duration}ms · {size}</c>).</param>
/// <param name="BodyText">The body block — indented JSON or raw text (web <c>JSON.stringify</c> / <c>bodyText</c>).</param>
/// <param name="HasHeaders">True when the response carries at least one header (web <c>entries.length &gt; 0</c>).</param>
/// <param name="HeadersToggleLabel">The localized "Response Headers" toggle label (web <c>playground.responseHeaders</c>).</param>
/// <param name="HeadersCountLabel">The toggle label with the count, e.g. "Response Headers (4)".</param>
/// <param name="HeadersCount">The number of header rows.</param>
/// <param name="Headers">The projected header rows.</param>
/// <param name="HasHistory">True when the history strip has at least one entry (web <c>history.length &gt; 0</c>).</param>
/// <param name="HistoryTitle">The localized "Recent Requests" heading (web <c>playground.history</c>).</param>
/// <param name="History">The projected history chips.</param>
public sealed record ResponseViewerDisplay(
    ResponseViewerState State,
    string ResponseTitle,
    string ResponseRegionName,
    string EmptyMessage,
    bool HasResponse,
    string StatusText,
    string StatusBrushKey,
    string StatusBodyName,
    string MetaText,
    string BodyText,
    bool HasHeaders,
    string HeadersToggleLabel,
    string HeadersCountLabel,
    int HeadersCount,
    IReadOnlyList<HttpHeaderEntry> Headers,
    bool HasHistory,
    string HistoryTitle,
    IReadOnlyList<RequestHistoryRow> History);

/// <summary>
/// Pure projection from <see cref="ResponseViewerInput"/> to the render-ready <see cref="ResponseViewerDisplay"/>
/// — the native port of the web <c>ResponseViewer</c> body in
/// web/src/features/admin/components/ResponseViewer.tsx. It reproduces the three branch precedence
/// (<c>loading ? … : !response ? … : …</c>), the <c>formatBytes</c> / <c>statusColor</c> / <c>statusBg</c> /
/// method-badge helpers (mapped to semantic design tokens, never neon), the body rendering rule
/// (<c>contentType.includes('json') &amp;&amp; typeof body !== 'string' ? JSON.stringify(body, null, 2) :
/// bodyText</c>), and the self-hiding header + history strips. Every owned string resolves through the i18n
/// facade. No SI conversion applies — the surface carries no Tesla measurements.
/// </summary>
public static class ResponseViewerProjection
{
    /// <summary>Design-token brush key for a 2xx status / GET badge (web green).</summary>
    public const string SuccessBrushKey = "TsColorSuccessBrush";

    /// <summary>Design-token brush key for a 3xx status / non-GET-non-POST-non-DELETE badge (web amber).</summary>
    public const string WarningBrushKey = "TsColorWarningBrush";

    /// <summary>Design-token brush key for a 4xx/5xx status / DELETE badge (web red).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Design-token brush key for a POST badge (web blue).</summary>
    public const string InfoBrushKey = "TsColorInfoBrush";

    /// <summary>Design-token brush key for the inset body / overlay surface (web <c>var(--surface-overlay)</c>).</summary>
    public const string OverlayBrushKey = "TsColorSurfaceGlassBrush";

    /// <summary>i18n key for the "Response" panel heading.</summary>
    public const string ResponseKey = "translation.playground.response";

    /// <summary>English fallback for <see cref="ResponseKey"/>.</summary>
    public const string ResponseFallback = "Response";

    /// <summary>i18n key for the empty-surface message.</summary>
    public const string NoResponseKey = "translation.playground.noResponse";

    /// <summary>English fallback for <see cref="NoResponseKey"/>.</summary>
    public const string NoResponseFallback = "Send a request to see the response";

    /// <summary>i18n key for the "Recent Requests" history heading.</summary>
    public const string HistoryKey = "translation.playground.history";

    /// <summary>English fallback for <see cref="HistoryKey"/>.</summary>
    public const string HistoryFallback = "Recent Requests";

    /// <summary>i18n key for the "Response Headers" toggle label.</summary>
    public const string ResponseHeadersKey = "translation.playground.responseHeaders";

    /// <summary>English fallback for <see cref="ResponseHeadersKey"/>.</summary>
    public const string ResponseHeadersFallback = "Response Headers";

    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };

    /// <summary>Format a byte count exactly as the web <c>formatBytes</c> helper (B / KB / MB, one decimal).</summary>
    /// <param name="bytes">The size in bytes.</param>
    /// <returns>A human-readable size string, e.g. "512 B", "4.5 KB" or "1.2 MB".</returns>
    public static string FormatBytes(long bytes)
    {
        if (bytes < 1024)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{bytes} B");
        }

        if (bytes < 1024 * 1024)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{bytes / 1024.0:0.0} KB");
        }

        return string.Create(CultureInfo.InvariantCulture, $"{bytes / (1024.0 * 1024.0):0.0} MB");
    }

    /// <summary>The design-token brush key tinting a status code (web <c>statusColor</c>): success / warning / danger.</summary>
    /// <param name="status">The HTTP status code.</param>
    /// <returns>The semantic brush key.</returns>
    public static string StatusBrushKey(int status) =>
        status < 300 ? SuccessBrushKey : status < 400 ? WarningBrushKey : DangerBrushKey;

    /// <summary>The design-token brush key tinting a history method badge (web <c>METHOD colors</c>).</summary>
    /// <param name="method">The HTTP verb; matched case-insensitively.</param>
    /// <returns>The semantic brush key: GET→success, POST→info, DELETE→danger, otherwise warning.</returns>
    public static string MethodBrushKey(string? method) =>
        (method ?? string.Empty).Trim().ToUpperInvariant() switch
        {
            "GET" => SuccessBrushKey,
            "POST" => InfoBrushKey,
            "DELETE" => DangerBrushKey,
            _ => WarningBrushKey,
        };

    /// <summary>Serialize <paramref name="data"/> to two-space-indented JSON (web <c>JSON.stringify(data, null, 2)</c>).</summary>
    /// <param name="data">The payload to serialize.</param>
    /// <returns>The indented JSON text.</returns>
    public static string Serialize(object? data) =>
        JsonSerializer.Serialize(data, IndentedJson);

    /// <summary>
    /// The body block for a response, reproducing the web rule
    /// <c>contentType.includes('json') &amp;&amp; typeof body !== 'string' ? JSON.stringify(body, null, 2) :
    /// bodyText</c>.
    /// </summary>
    /// <param name="response">The resolved response.</param>
    /// <returns>The indented JSON, or the raw body text.</returns>
    public static string BodyText(ApiResponseSnapshot response)
    {
        ArgumentNullException.ThrowIfNull(response);
        bool isJson = (response.ContentType ?? string.Empty).Contains("json", StringComparison.Ordinal)
            && response.Body is not string;
        return isJson ? Serialize(response.Body) : response.BodyText ?? string.Empty;
    }

    /// <summary>Project <paramref name="input"/> into the render-ready display, resolving strings via <paramref name="localizer"/>.</summary>
    /// <param name="input">The current inputs (the latest props the host fed the surface).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <returns>The render-ready display.</returns>
    public static ResponseViewerDisplay Project(ResponseViewerInput input, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        string responseTitle = localizer.GetString(ResponseKey, ResponseFallback);
        string emptyMessage = localizer.GetString(NoResponseKey, NoResponseFallback);
        string historyTitle = localizer.GetString(HistoryKey, HistoryFallback);
        string headersToggle = localizer.GetString(ResponseHeadersKey, ResponseHeadersFallback);

        ApiResponseSnapshot? response = input.Response;
        ResponseViewerState state = input.Loading
            ? ResponseViewerState.Loading
            : response is null
                ? ResponseViewerState.Empty
                : ResponseViewerState.Response;

        bool hasResponse = state == ResponseViewerState.Response && response is not null;

        string statusText = hasResponse
            ? FormatStatusLine(response!.Status, response.StatusText)
            : string.Empty;
        string statusKey = hasResponse ? StatusBrushKey(response!.Status) : SuccessBrushKey;
        string metaText = hasResponse
            ? string.Create(
                CultureInfo.InvariantCulture,
                $"{FormatNumber(response!.Duration)}ms · {FormatBytes(response.Size)}")
            : string.Empty;
        string bodyText = hasResponse ? BodyText(response!) : string.Empty;
        string statusBodyName = hasResponse ? statusText : responseTitle;

        IReadOnlyList<HttpHeaderEntry> headers = hasResponse
            ? response!.Headers ?? System.Array.Empty<HttpHeaderEntry>()
            : System.Array.Empty<HttpHeaderEntry>();
        bool hasHeaders = hasResponse && headers.Count > 0;
        int headersCount = headers.Count;
        string headersCountLabel = string.Create(
            CultureInfo.InvariantCulture,
            $"{headersToggle} ({headersCount})");

        IReadOnlyList<RequestHistoryRow> history = ProjectHistory(input.History);
        bool hasHistory = history.Count > 0;

        return new ResponseViewerDisplay(
            State: state,
            ResponseTitle: responseTitle,
            ResponseRegionName: responseTitle,
            EmptyMessage: emptyMessage,
            HasResponse: hasResponse,
            StatusText: statusText,
            StatusBrushKey: statusKey,
            StatusBodyName: statusBodyName,
            MetaText: metaText,
            BodyText: bodyText,
            HasHeaders: hasHeaders,
            HeadersToggleLabel: headersToggle,
            HeadersCountLabel: headersCountLabel,
            HeadersCount: headersCount,
            Headers: headers,
            HasHistory: hasHistory,
            HistoryTitle: historyTitle,
            History: history);
    }

    private static IReadOnlyList<RequestHistoryRow> ProjectHistory(IReadOnlyList<RequestHistoryEntry>? entries)
    {
        if (entries is null || entries.Count == 0)
        {
            return System.Array.Empty<RequestHistoryRow>();
        }

        var rows = new List<RequestHistoryRow>(entries.Count);
        foreach (RequestHistoryEntry entry in entries)
        {
            string method = entry.Method ?? string.Empty;
            string path = entry.Path ?? string.Empty;
            string durationText = string.Create(
                CultureInfo.InvariantCulture,
                $"{FormatNumber(entry.Duration)}ms");
            string summary = string.Create(
                CultureInfo.InvariantCulture,
                $"{method} {path} → {entry.Status} ({durationText})");

            rows.Add(new RequestHistoryRow(
                Entry: entry,
                Method: method,
                MethodBrushKey: MethodBrushKey(method),
                Path: path,
                Status: entry.Status,
                StatusBrushKey: StatusBrushKey(entry.Status),
                DurationText: durationText,
                Tooltip: summary,
                AutomationName: summary));
        }

        return rows;
    }

    private static string FormatStatusLine(int status, string? statusText)
    {
        string text = statusText ?? string.Empty;
        return text.Length == 0
            ? status.ToString(CultureInfo.InvariantCulture)
            : string.Create(CultureInfo.InvariantCulture, $"{status} {text}");
    }

    private static string FormatNumber(double value)
    {
        // Mirror JS number-to-string: integral values render without a decimal point (123, not 123.0).
        return value == Math.Floor(value) && !double.IsInfinity(value)
            ? ((long)value).ToString(CultureInfo.InvariantCulture)
            : value.ToString("R", CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// The HTTP verb a code snippet is generated for. Mirrors the web request method passed to
/// <c>generateSnippet</c>; only the GET-vs-other distinction affects the output.
/// </summary>
public enum SnippetFormat
{
    /// <summary>A <c>cURL</c> command (web <c>'curl'</c>).</summary>
    Curl,

    /// <summary>A browser <c>fetch</c> call (web <c>'javascript'</c>).</summary>
    JavaScript,

    /// <summary>A Python <c>requests</c> call (web <c>'python'</c>).</summary>
    Python,

    /// <summary>A Go <c>net/http</c> call (web <c>'go'</c>).</summary>
    Go,
}

/// <summary>
/// The inputs that drive one code snippet — the native analogue of the web <c>SnippetPanel</c> props
/// (<c>{ method, url, body }</c> in web/src/features/admin/components/ResponseViewer.tsx). Pure data.
/// </summary>
/// <param name="Method">The HTTP verb (web <c>method</c>).</param>
/// <param name="Url">The request URL (web <c>url</c>).</param>
/// <param name="Body">The request body, or <see langword="null"/> (web <c>body</c>).</param>
public sealed record SnippetInput(string Method, string Url, string? Body);

/// <summary>
/// One selectable snippet-format tab — the native projection of a web <c>formats</c> entry
/// (<c>{ value, label }</c>) plus the active-tab flag (web <c>aria-pressed</c>).
/// </summary>
/// <param name="Format">The format the tab selects.</param>
/// <param name="Label">The tab label (the format's proper name).</param>
/// <param name="IsSelected">Whether this is the active tab (web <c>format === f.value</c>).</param>
public sealed record SnippetFormatOption(SnippetFormat Format, string Label, bool IsSelected);

/// <summary>
/// The render-ready view of the <c>SnippetPanel</c> for one selected format — the native projection of the
/// web <c>SnippetPanel</c> render output. Carries the localized toggle / copy labels, the generated snippet,
/// the format tabs and the Narrator name. Pure data — no WinUI types.
/// </summary>
/// <param name="ToggleLabel">The localized "Code Snippet" toggle label (web <c>playground.codeSnippet</c>).</param>
/// <param name="CopyLabel">The localized copy-button label (web <c>playground.copy</c>).</param>
/// <param name="CopiedLabel">The localized post-copy label (web <c>playground.copied</c>).</param>
/// <param name="SelectedFormat">The active format.</param>
/// <param name="Snippet">The generated code snippet for <see cref="SelectedFormat"/>.</param>
/// <param name="Formats">The selectable format tabs.</param>
/// <param name="AutomationName">The Narrator name for the snippet panel region.</param>
public sealed record SnippetDisplay(
    string ToggleLabel,
    string CopyLabel,
    string CopiedLabel,
    SnippetFormat SelectedFormat,
    string Snippet,
    IReadOnlyList<SnippetFormatOption> Formats,
    string AutomationName);

/// <summary>
/// Pure code-snippet generator + projection for the web <c>SnippetPanel</c> sub-component
/// (web/src/features/admin/components/ResponseViewer.tsx). <see cref="Generate"/> is a verbatim port of the
/// web <c>generateSnippet</c> helper (cURL / JavaScript / Python / Go, with the GET-vs-body branch), and
/// <see cref="Project"/> assembles the render-ready <see cref="SnippetDisplay"/>. The generated snippet text
/// is developer-facing example code reproduced exactly from the web source; the chrome strings (toggle / copy
/// labels) resolve through the i18n facade. Pure — no WinUI types — so it is unit-tested headlessly.
/// </summary>
public static class ResponseSnippet
{
    /// <summary>i18n key for the "Code Snippet" toggle label.</summary>
    public const string ToggleKey = "translation.playground.codeSnippet";

    /// <summary>English fallback for <see cref="ToggleKey"/>.</summary>
    public const string ToggleFallback = "Code Snippet";

    /// <summary>i18n key for the copy-button idle label.</summary>
    public const string CopyKey = "translation.playground.copy";

    /// <summary>English fallback for <see cref="CopyKey"/>.</summary>
    public const string CopyFallback = "Copy";

    /// <summary>i18n key for the copy-button confirmation label.</summary>
    public const string CopiedKey = "translation.playground.copied";

    /// <summary>English fallback for <see cref="CopiedKey"/>.</summary>
    public const string CopiedFallback = "Copied";

    private const string AuthNote = "# Add auth: -H \"X-API-Key: YOUR_KEY\" or use session cookies";

    /// <summary>The proper-name label for a snippet format (web <c>formats[].label</c>). A non-localized brand identifier.</summary>
    /// <param name="format">The format whose label to resolve.</param>
    /// <returns>The format's display label.</returns>
    public static string Label(SnippetFormat format) => format switch
    {
        SnippetFormat.Curl => "cURL",
        SnippetFormat.JavaScript => "JavaScript",
        SnippetFormat.Python => "Python",
        SnippetFormat.Go => "Go",
        _ => "cURL",
    };

    /// <summary>The i18n key for a snippet format's tab label (resolves to the brand name when absent from the catalog).</summary>
    /// <param name="format">The format whose label key to resolve.</param>
    /// <returns>The i18n key.</returns>
    public static string LabelKey(SnippetFormat format) => format switch
    {
        SnippetFormat.Curl => "translation.playground.snippetFormat.curl",
        SnippetFormat.JavaScript => "translation.playground.snippetFormat.javascript",
        SnippetFormat.Python => "translation.playground.snippetFormat.python",
        SnippetFormat.Go => "translation.playground.snippetFormat.go",
        _ => "translation.playground.snippetFormat.curl",
    };

    /// <summary>
    /// Generate a code snippet for a request — a verbatim port of the web <c>generateSnippet</c> helper. The
    /// body is only emitted for non-GET requests that carry one (web <c>body &amp;&amp; method !== 'GET'</c>).
    /// </summary>
    /// <param name="method">The HTTP verb.</param>
    /// <param name="url">The request URL.</param>
    /// <param name="format">The target format.</param>
    /// <param name="body">The request body, or <see langword="null"/>.</param>
    /// <returns>The generated snippet text.</returns>
    public static string Generate(string method, string url, SnippetFormat format, string? body)
    {
        string verb = method ?? string.Empty;
        string target = url ?? string.Empty;
        bool withBody = !string.IsNullOrEmpty(body) && !string.Equals(verb, "GET", StringComparison.Ordinal);

        return format switch
        {
            SnippetFormat.Curl => GenerateCurl(verb, target, body, withBody),
            SnippetFormat.JavaScript => GenerateJavaScript(verb, target, body, withBody),
            SnippetFormat.Python => GeneratePython(verb, target, body, withBody),
            SnippetFormat.Go => GenerateGo(verb, target, body, withBody),
            _ => string.Empty,
        };
    }

    /// <summary>Project the snippet panel for a selected format, resolving chrome strings via the i18n facade.</summary>
    /// <param name="input">The request inputs (method / url / body).</param>
    /// <param name="selected">The active format tab.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The render-ready snippet display.</returns>
    public static SnippetDisplay Project(SnippetInput input, SnippetFormat selected, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(localizer);

        string toggle = localizer.GetString(ToggleKey, ToggleFallback);
        string copy = localizer.GetString(CopyKey, CopyFallback);
        string copied = localizer.GetString(CopiedKey, CopiedFallback);
        string snippet = Generate(input.Method, input.Url, selected, input.Body);

        var formats = new List<SnippetFormatOption>(4);
        foreach (SnippetFormat format in AllFormats)
        {
            string label = localizer.GetString(LabelKey(format), Label(format));
            formats.Add(new SnippetFormatOption(format, label, format == selected));
        }

        string automationName = string.Create(CultureInfo.InvariantCulture, $"{toggle} · {Label(selected)}");

        return new SnippetDisplay(
            ToggleLabel: toggle,
            CopyLabel: copy,
            CopiedLabel: copied,
            SelectedFormat: selected,
            Snippet: snippet,
            Formats: formats,
            AutomationName: automationName);
    }

    private static readonly SnippetFormat[] AllFormats =
    {
        SnippetFormat.Curl,
        SnippetFormat.JavaScript,
        SnippetFormat.Python,
        SnippetFormat.Go,
    };

    private static string GenerateCurl(string method, string url, string? body, bool withBody)
    {
        var parts = new List<string>(3)
        {
            string.Create(CultureInfo.InvariantCulture, $"curl -X {method} '{url}'"),
        };

        if (withBody)
        {
            parts.Add("  -H 'Content-Type: application/json'");
            parts.Add(string.Create(CultureInfo.InvariantCulture, $"  -d '{body}'"));
        }

        return AuthNote + "\n" + string.Join(" \\\n", parts);
    }

    private static string GenerateJavaScript(string method, string url, string? body, bool withBody)
    {
        var sb = new StringBuilder();
        sb.Append("// Auth: include credentials or X-API-Key header\n");
        sb.Append(CultureInfo.InvariantCulture, $"const response = await fetch('{url}', {{\n");
        sb.Append(CultureInfo.InvariantCulture, $"  method: '{method}',");
        if (withBody)
        {
            sb.Append("\n  headers: { 'Content-Type': 'application/json' },\n");
            sb.Append(CultureInfo.InvariantCulture, $"  body: JSON.stringify({body}),");
        }

        sb.Append("\n});\n");
        sb.Append("const data = await response.json();");
        return sb.ToString();
    }

    private static string GeneratePython(string method, string url, string? body, bool withBody)
    {
        string verb = method.ToLowerInvariant();
        string call = withBody
            ? string.Create(CultureInfo.InvariantCulture, $"requests.{verb}('{url}', json={body})")
            : string.Create(CultureInfo.InvariantCulture, $"requests.{verb}('{url}')");

        var sb = new StringBuilder();
        sb.Append("# Auth: pass headers={\"X-API-Key\": \"YOUR_KEY\"}\n");
        sb.Append("import requests\n\n");
        sb.Append(CultureInfo.InvariantCulture, $"response = {call}\n");
        sb.Append("data = response.json()");
        return sb.ToString();
    }

    private static string GenerateGo(string method, string url, string? body, bool withBody)
    {
        if (string.Equals(method, "GET", StringComparison.Ordinal))
        {
            var get = new StringBuilder();
            get.Append("// Auth: add X-API-Key header to the request\n");
            get.Append(CultureInfo.InvariantCulture, $"resp, err := http.Get(\"{url}\")\n");
            get.Append("if err != nil { log.Fatal(err) }\n");
            get.Append("defer resp.Body.Close()");
            return get.ToString();
        }

        string payload = string.IsNullOrEmpty(body) ? "{}" : body!;
        var sb = new StringBuilder();
        sb.Append("// Auth: add X-API-Key header to the request\n");
        sb.Append(CultureInfo.InvariantCulture, $"body := strings.NewReader(`{payload}`)\n");
        sb.Append(CultureInfo.InvariantCulture, $"req, _ := http.NewRequest(\"{method}\", \"{url}\", body)\n");
        sb.Append("req.Header.Set(\"Content-Type\", \"application/json\")\n");
        sb.Append("resp, err := http.DefaultClient.Do(req)\n");
        sb.Append("if err != nil { log.Fatal(err) }\n");
        sb.Append("defer resp.Body.Close()");
        return sb.ToString();
    }
}

/// <summary>
/// Canonical metadata for the ResponseViewer surface. The web source is an anonymous admin devtools component
/// (web/src/features/admin/components/ResponseViewer.tsx) with no registry entry, so this carries only the
/// diagnostics <see cref="Slug"/> the P1/S11 contract emits with <c>view.opened</c>.
/// </summary>
public static class ResponseViewerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ResponseViewer";
}

/// <summary>
/// PII-safe diagnostics for the ResponseViewer surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a response body, header, URL or history
/// entry — so a diagnostics line can never leak request/response content. Thread-safe.
/// </summary>
public sealed class ResponseViewerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional sink receiving the formatted diagnostics line.</param>
    public ResponseViewerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ResponseViewer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ResponseViewerRegistration.Slug}");
    }
}
