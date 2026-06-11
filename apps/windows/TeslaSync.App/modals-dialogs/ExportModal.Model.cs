using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// One react-grid-layout item in a saved dashboard layout — the native mirror of the web <c>RGLLayout</c>
/// (web/src/features/dashboard/widgets/types.ts). <see cref="I"/> is the widget-instance id the item positions;
/// <see cref="X"/> / <see cref="Y"/> / <see cref="W"/> / <see cref="H"/> are integer grid units. The optional
/// min/max span hints are carried through verbatim and omitted on the wire when absent, so the exported JSON
/// round-trips losslessly against the web import validator. camelCase <see cref="JsonPropertyNameAttribute"/>s
/// match the keys <c>JSON.stringify(dashboard)</c> emits in the browser.
/// </summary>
public sealed record DashboardLayoutItem(
    [property: JsonPropertyName("i")] string I,
    [property: JsonPropertyName("x")] int X,
    [property: JsonPropertyName("y")] int Y,
    [property: JsonPropertyName("w")] int W,
    [property: JsonPropertyName("h")] int H,
    [property: JsonPropertyName("minW")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? MinW = null,
    [property: JsonPropertyName("minH")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? MinH = null,
    [property: JsonPropertyName("maxW")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? MaxW = null,
    [property: JsonPropertyName("maxH")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    int? MaxH = null);

/// <summary>
/// One placed widget in a saved dashboard — the native mirror of the web <c>WidgetInstance</c>
/// (web/src/features/dashboard/widgets/types.ts). <see cref="Config"/> is an opaque per-widget configuration
/// blob carried through verbatim (it round-trips as raw JSON) and omitted on the wire when absent, matching the
/// web minimal-export's <c>...(w.config ? { config: w.config } : {})</c> guard.
/// </summary>
public sealed record WidgetInstanceSnapshot(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("widgetId")] string WidgetId,
    [property: JsonPropertyName("config")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    JsonElement? Config = null);

/// <summary>
/// The saved dashboard the modal exports — the native mirror of the web <c>SavedDashboard</c>
/// (web/src/features/dashboard/widgets/types.ts). It is supplied to the view-model the way the web component
/// receives its <c>dashboard</c> prop (the export modal is a controlled, presentational surface; it performs no
/// fetch). camelCase <see cref="JsonPropertyNameAttribute"/>s reproduce the exact key shape
/// <c>JSON.stringify(dashboard, null, 2)</c> produces, and the optional fields are omitted when absent so the
/// downloaded JSON and the share payload match the browser byte-for-byte in field set.
/// </summary>
public sealed record SavedDashboardSnapshot(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("widgets")] IReadOnlyList<WidgetInstanceSnapshot> Widgets,
    [property: JsonPropertyName("layouts")] IReadOnlyDictionary<string, IReadOnlyList<DashboardLayoutItem>> Layouts,
    [property: JsonPropertyName("createdAt")] string CreatedAt,
    [property: JsonPropertyName("updatedAt")] string UpdatedAt,
    [property: JsonPropertyName("icon")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? Icon = null,
    [property: JsonPropertyName("vehicleId")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    long? VehicleId = null,
    [property: JsonPropertyName("isDefault")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? IsDefault = null,
    [property: JsonPropertyName("settings")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    JsonElement? Settings = null)
{
    /// <summary>The number of placed widgets (the badge's <c>{{count}}</c>); never null.</summary>
    public int WidgetCount => Widgets?.Count ?? 0;

    /// <summary>
    /// The <see cref="UpdatedAt"/> timestamp parsed to an instant for display, or <c>null</c> when it is empty or
    /// not an ISO-8601 string (the formatter then renders the em-dash fallback).
    /// </summary>
    public DateTimeOffset? UpdatedAtInstant =>
        !string.IsNullOrWhiteSpace(UpdatedAt)
        && DateTimeOffset.TryParse(UpdatedAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var instant)
            ? instant
            : null;
}

/// <summary>
/// One tile in the layout preview — the native analogue of one absolutely-positioned cell in the web
/// <c>MiniGridPreview</c> (web/src/features/dashboard/components/MiniGridPreview.tsx). The web positions cells
/// with CSS percentages inside an aspect-ratio box; the native preview maps the same integer grid coordinates
/// onto a WinUI <c>Grid</c> via <see cref="Column"/> / <see cref="Row"/> + <see cref="ColumnSpan"/> /
/// <see cref="RowSpan"/>, which reproduces the layout faithfully without percentage math.
/// </summary>
public sealed record MiniGridTile(int Column, int Row, int ColumnSpan, int RowSpan);

/// <summary>
/// The projected layout preview — the columns (always 4, the web <c>GRID_COLS.lg</c>), the row count
/// (<c>max(y + h)</c> over the <c>lg</c> breakpoint, defaulting to 2 for an empty layout — the web
/// <c>safeMaxY</c>) and the placed <see cref="Tiles"/>. Drives the native preview Grid; computed by
/// <see cref="ExportModalProjection.BuildMiniGrid"/> so it is unit-tested headlessly.
/// </summary>
public sealed record MiniGridModel(int Columns, int Rows, IReadOnlyList<MiniGridTile> Tiles);

/// <summary>
/// The download request the view-model raises when the user picks "Download JSON File" — the native analogue of
/// the web modal's <c>onDownload</c> prop. <see cref="Json"/> is the pretty-printed dashboard JSON to persist and
/// <see cref="FileName"/> the suggested file name; the host (the dashboard customize surface) performs the actual
/// save, exactly as the web parent owns <c>onDownload</c>.
/// </summary>
public sealed record ExportDownloadRequest(string Json, string FileName);

/// <summary>
/// Canonical metadata, limits, Segoe Fluent glyphs and i18n keys for the <c>ExportModal</c> surface — the native
/// mirror of <c>web/src/features/dashboard/components/ExportModal.tsx</c>. The web component resolves its copy
/// through <c>useTranslation('dashboard')</c>; every literal is keyed here (with the catalog's English value as
/// the fallback) so the native view and view-model stay free of inline strings and resolve through the i18n
/// facade. UI-free so every key + bound is asserted in tests.
/// </summary>
public static class ExportModalRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ExportModal";

    /// <summary>Maximum share-URL length before it is rejected (web <c>shareUrl.length &gt; 2000</c>).</summary>
    public const int ShareUrlMaxLength = 2000;

    /// <summary>Grid columns at the <c>lg</c> breakpoint used for the preview (web <c>GRID_COLS.lg</c>).</summary>
    public const int GridColumns = 4;

    /// <summary>Default preview row count for an empty layout (web <c>safeMaxY</c> default).</summary>
    public const int DefaultGridRows = 2;

    /// <summary>The dashboard import deep-link fragment appended to the origin (web <c>/dashboard#import=</c>).</summary>
    public const string ImportRoute = "/dashboard#import=";

    /// <summary>Segoe Fluent "Package" glyph standing in for the web modal's lucide <c>Package</c> badge icon.</summary>
    public const string PackageGlyph = "\uE7B8";

    /// <summary>Segoe Fluent "Download" glyph for the download action (web lucide <c>Download</c>).</summary>
    public const string DownloadGlyph = "\uE896";

    /// <summary>Modal title (web <c>export.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("export.title", "Export Dashboard");

    /// <summary>Download-file action label (web <c>export.downloadFile</c>).</summary>
    public static string DownloadLabel(ILocalizer localizer) =>
        Require(localizer).GetString("export.downloadFile", "Download JSON File");

    /// <summary>Copy-to-clipboard action label (web <c>export.copyClipboard</c>).</summary>
    public static string CopyClipboardLabel(ILocalizer localizer) =>
        Require(localizer).GetString("export.copyClipboard", "Copy to Clipboard");

    /// <summary>Copy-shareable-URL action label (web <c>export.copyShareUrl</c>).</summary>
    public static string CopyShareUrlLabel(ILocalizer localizer) =>
        Require(localizer).GetString("export.copyShareUrl", "Copy Shareable URL");

    /// <summary>Brief copy-confirmation label for the JSON clipboard action (web <c>export.copied</c>).</summary>
    public static string CopiedLabel(ILocalizer localizer) =>
        Require(localizer).GetString("export.copied", "Copied!");

    /// <summary>Brief copy-confirmation label for the share-URL action (web <c>export.urlCopied</c>).</summary>
    public static string UrlCopiedLabel(ILocalizer localizer) =>
        Require(localizer).GetString("export.urlCopied", "URL Copied!");

    /// <summary>Dialog dismiss label (web <c>Modal</c> close affordance).</summary>
    public static string CloseLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.close", "Close");

    /// <summary>The widget-count badge with the placed-widget <paramref name="count"/> interpolated (web <c>export.widgetCount</c>).</summary>
    public static string WidgetCountLabel(ILocalizer localizer, int count) =>
        Interpolate(
            Require(localizer).GetString("export.widgetCount", "{{count}} widgets"),
            "{{count}}",
            count.ToString(CultureInfo.CurrentCulture));

    /// <summary>The "Updated {{date}}" caption with the formatted <paramref name="date"/> interpolated (web <c>export.updated</c>).</summary>
    public static string UpdatedLabel(ILocalizer localizer, string date) =>
        Interpolate(
            Require(localizer).GetString("export.updated", "Updated {{date}}"),
            "{{date}}",
            date ?? string.Empty);

    /// <summary>The URL-too-long warning with the offending <paramref name="size"/> interpolated (web <c>export.urlTooLong</c>).</summary>
    public static string UrlTooLongLabel(ILocalizer localizer, int size) =>
        Interpolate(
            Require(localizer).GetString(
                "export.urlTooLong",
                "Layout too large for URL sharing ({{size}} chars). Use clipboard or file export instead."),
            "{{size}}",
            size.ToString(CultureInfo.CurrentCulture));

    private static string Interpolate(string template, string token, string value) =>
        template.Replace(token, value, StringComparison.Ordinal);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>ExportModal</c> surface — the native analogue of the web component's
/// <c>useMemo</c> derivations (the pretty dashboard JSON, the human byte size, the URL-safe base64 share payload)
/// plus the <c>buildMinimalExport</c> / <c>toUrlSafeBase64</c> helpers (web/src/features/dashboard/hooks/validateImport.ts)
/// and the <c>MiniGridPreview</c> layout math. UI-free so each transform is unit-tested headlessly and the
/// view-model never reaches for a serializer or grid heuristic itself.
/// </summary>
public static class ExportModalProjection
{
    private static readonly JsonSerializerOptions PrettyOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    private static readonly JsonSerializerOptions CompactOptions = new()
    {
        WriteIndented = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>
    /// Serialize the full dashboard to pretty-printed JSON — the native analogue of the web
    /// <c>JSON.stringify(dashboard, null, 2)</c> that backs both the clipboard copy and the file download.
    /// </summary>
    public static string SerializeDashboard(SavedDashboardSnapshot dashboard)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        return JsonSerializer.Serialize(dashboard, PrettyOptions);
    }

    /// <summary>
    /// Build the minimal share payload (strips ids / timestamps, keeps name + widgets + layouts) as compact JSON —
    /// the native analogue of the web <c>buildMinimalExport</c>.
    /// </summary>
    public static string BuildMinimalExport(SavedDashboardSnapshot dashboard)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        var minimal = new MinimalExport(dashboard.Name, dashboard.Widgets ?? [], dashboard.Layouts ?? EmptyLayouts);
        return JsonSerializer.Serialize(minimal, CompactOptions);
    }

    /// <summary>
    /// Encode <paramref name="value"/> to URL-safe base64 — the exact native analogue of the web
    /// <c>toUrlSafeBase64</c>: UTF-8 encode, base64, then <c>+</c>→<c>-</c>, <c>/</c>→<c>_</c>, strip trailing <c>=</c>.
    /// </summary>
    public static string ToUrlSafeBase64(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(value))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    /// <summary>
    /// Build the shareable deep link — the native analogue of the web
    /// <c>${origin}/dashboard#import=${toUrlSafeBase64(buildMinimalExport(dashboard))}</c>. A trailing slash on
    /// <paramref name="origin"/> is trimmed so the route is never doubled.
    /// </summary>
    public static string BuildShareUrl(string origin, SavedDashboardSnapshot dashboard)
    {
        ArgumentNullException.ThrowIfNull(origin);
        ArgumentNullException.ThrowIfNull(dashboard);
        string encoded = ToUrlSafeBase64(BuildMinimalExport(dashboard));
        return string.Concat(origin.TrimEnd('/'), ExportModalRegistration.ImportRoute, encoded);
    }

    /// <summary>The UTF-8 byte length of <paramref name="json"/> (web <c>new Blob([json]).size</c>).</summary>
    public static int ByteSize(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        return Encoding.UTF8.GetByteCount(json);
    }

    /// <summary>
    /// Format a byte count for the size badge — the exact native analogue of the web tier: <c>"{n} B"</c> below
    /// 1024 bytes, otherwise <c>"{n/1024 to 1 dp} KB"</c> with a dot decimal separator.
    /// </summary>
    public static string FormatJsonSize(int bytes)
    {
        if (bytes < 1024)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{bytes} B");
        }

        double kilobytes = bytes / 1024.0;
        return string.Create(CultureInfo.InvariantCulture, $"{kilobytes:F1} KB");
    }

    /// <summary>True once the assembled share URL exceeds the limit (web <c>shareUrl.length &gt; 2000</c>).</summary>
    public static bool IsShareUrlTooLong(string shareUrl)
    {
        ArgumentNullException.ThrowIfNull(shareUrl);
        return shareUrl.Length > ExportModalRegistration.ShareUrlMaxLength;
    }

    /// <summary>
    /// Project the layout preview from the dashboard's <c>lg</c>-breakpoint layout — the native analogue of the
    /// web <c>MiniGridPreview</c>: 4 columns, <c>max(y + h)</c> rows (defaulting to 2 when empty), and a tile per
    /// layout item clamped into the grid bounds so the preview can never overflow.
    /// </summary>
    public static MiniGridModel BuildMiniGrid(SavedDashboardSnapshot dashboard)
    {
        ArgumentNullException.ThrowIfNull(dashboard);

        int cols = ExportModalRegistration.GridColumns;
        IReadOnlyList<DashboardLayoutItem> lg =
            dashboard.Layouts is { } layouts && layouts.TryGetValue("lg", out var items) && items is not null
                ? items
                : [];

        int maxY = ExportModalRegistration.DefaultGridRows;
        if (lg.Count > 0)
        {
            int computed = 0;
            foreach (var item in lg)
            {
                computed = Math.Max(computed, item.Y + item.H);
            }

            maxY = computed > 0 ? computed : ExportModalRegistration.DefaultGridRows;
        }

        var tiles = new List<MiniGridTile>(lg.Count);
        foreach (var item in lg)
        {
            int column = Math.Clamp(item.X, 0, cols - 1);
            int columnSpan = Math.Clamp(item.W, 1, cols - column);
            int row = Math.Clamp(item.Y, 0, maxY - 1);
            int rowSpan = Math.Clamp(item.H, 1, maxY - row);
            tiles.Add(new MiniGridTile(column, row, columnSpan, rowSpan));
        }

        return new MiniGridModel(cols, maxY, tiles);
    }

    /// <summary>
    /// A safe download file name for the dashboard — <c>"{slug}.json"</c> where the slug keeps letters, digits,
    /// dashes, underscores and spaces; an empty / all-invalid name falls back to <c>dashboard.json</c>.
    /// </summary>
    public static string ExportFileName(string? name)
    {
        string trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "dashboard.json";
        }

        var builder = new StringBuilder(trimmed.Length);
        foreach (char c in trimmed)
        {
            builder.Append(char.IsLetterOrDigit(c) || c is '-' or '_' or ' ' ? c : '-');
        }

        string slug = builder.ToString().Trim();
        return slug.Length == 0 ? "dashboard.json" : slug + ".json";
    }

    private static readonly IReadOnlyDictionary<string, IReadOnlyList<DashboardLayoutItem>> EmptyLayouts =
        new Dictionary<string, IReadOnlyList<DashboardLayoutItem>>();

    private sealed record MinimalExport(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("widgets")] IReadOnlyList<WidgetInstanceSnapshot> Widgets,
        [property: JsonPropertyName("layouts")] IReadOnlyDictionary<string, IReadOnlyList<DashboardLayoutItem>> Layouts);
}

/// <summary>
/// PII-safe diagnostics for the <c>ExportModal</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the dashboard name, layout, widget ids or the exported
/// JSON — so a diagnostics line can never leak dashboard content. Thread-safe.
/// </summary>
public sealed class ExportModalDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _dashboardsExported;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ExportModalDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of dashboard downloads initiated from this surface.</summary>
    public long DashboardsExported => Interlocked.Read(ref _dashboardsExported);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ExportModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={ExportModalRegistration.Slug}"));
    }

    /// <summary>Record that a dashboard download was initiated (the dashboard content is never logged).</summary>
    public void RecordDashboardExported()
    {
        Interlocked.Increment(ref _dashboardsExported);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"dashboard.exported slug={ExportModalRegistration.Slug}"));
    }
}
