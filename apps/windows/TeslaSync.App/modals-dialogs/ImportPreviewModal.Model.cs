using System.Globalization;
using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The three import sources the modal offers (mirrors the web <c>activeTab</c> union
/// <c>'file' | 'paste' | 'url'</c> in web/src/features/dashboard/components/ImportPreviewModal.tsx). The
/// declared order is the web tab render order (file, paste, url).
/// </summary>
public enum ImportPreviewTab
{
    /// <summary>Import from a dropped or browsed <c>.json</c> file (web <c>file</c>; the default tab).</summary>
    File,

    /// <summary>Import from pasted JSON text (web <c>paste</c>).</summary>
    Paste,

    /// <summary>Import from a share URL carrying an <c>import</c> payload (web <c>url</c>).</summary>
    Url,
}

/// <summary>
/// A single validation finding the modal surfaces — the native, localizer-free analogue of one entry the web
/// <c>validateImportData</c> pushes into its <c>errors</c> / <c>warnings</c> string arrays
/// (web/src/features/dashboard/hooks/validateImport.ts). The web builds English literals inline; the native
/// validator instead returns a stable <see cref="ImportMessageKind"/> (plus the <see cref="Count"/> the one
/// counted message interpolates) so the pure validation stays deterministic and the English copy is resolved
/// only at the display boundary through <see cref="ImportPreviewRegistration"/>. Pure data.
/// </summary>
/// <param name="Kind">The finding kind.</param>
/// <param name="Count">The interpolated count for <see cref="ImportMessageKind.SkippedWidgets"/> (else 0).</param>
public sealed record ImportMessage(ImportMessageKind Kind, int Count = 0);

/// <summary>
/// The validation findings the web <c>validateImportData</c> emits as English literals
/// (web/src/features/dashboard/hooks/validateImport.ts), kept as a stable enum so the native validator is
/// deterministic and each message localizes at the display boundary.
/// </summary>
public enum ImportMessageKind
{
    /// <summary>The payload was not valid JSON (web <c>'Invalid JSON format'</c>).</summary>
    InvalidJson,

    /// <summary>The payload parsed but was not a JSON object (web <c>'Expected a JSON object'</c>).</summary>
    ExpectedObject,

    /// <summary>The <c>name</c> field was missing or not a non-empty string (web <c>'Missing or invalid "name" field'</c>).</summary>
    MissingName,

    /// <summary>The <c>widgets</c> field was missing or not an array (web <c>'Missing or invalid "widgets" array'</c>).</summary>
    MissingWidgets,

    /// <summary>The <c>layouts</c> field was missing or not an object (web <c>'Missing or invalid "layouts" object'</c>).</summary>
    MissingLayouts,

    /// <summary>No widget in the payload matched the catalog (web <c>'No compatible widgets found in this layout'</c>).</summary>
    NoCompatibleWidgets,

    /// <summary>Some widgets were dropped as unavailable (web <c>'{{count}} widget(s) not available and will be skipped'</c>).</summary>
    SkippedWidgets,
}

/// <summary>
/// One placed widget in a validated dashboard — the native mirror of the web <c>WidgetInstance</c>
/// (<c>{ id, widgetId, config? }</c> in web/src/features/dashboard/widgets/types.ts) the validator builds.
/// <see cref="Config"/> carries the widget's config object as its raw JSON text (web keeps the parsed object),
/// or null when the payload had none (web <c>config: … ? … : undefined</c>). Pure data.
/// </summary>
/// <param name="Id">The instance id (web <c>id</c>; generated when the payload omits it).</param>
/// <param name="WidgetId">The catalog widget id (web <c>widgetId</c>) availability is checked against.</param>
/// <param name="Config">The widget config as raw JSON text, or null when absent.</param>
public sealed record ImportedWidget(string Id, string WidgetId, string? Config);

/// <summary>
/// One sanitized grid-layout item in a validated dashboard — the native mirror of the web react-grid-layout
/// <c>RGLLayout</c> (web/src/features/dashboard/widgets/types.ts) after <c>sanitizeLayoutItem</c>
/// (web/src/features/dashboard/hooks/validateImport.ts). <see cref="X"/>/<see cref="Y"/>/<see cref="W"/>/<see cref="H"/>
/// are the clamped grid-unit position and span (web numbers, kept as doubles for fidelity); the optional
/// min/max bounds pass through unchanged (web spreads <c>...item</c>). Pure data.
/// </summary>
/// <param name="I">The layout item identity (web <c>i</c>); matches an available widget instance id.</param>
/// <param name="X">Clamped column offset (web <c>clamp(x, 0, cols-1)</c>).</param>
/// <param name="Y">Non-negative row offset (web <c>y &gt;= 0 ? y : 0</c>).</param>
/// <param name="W">Clamped column span (web <c>clamp(w, 1, cols)</c>).</param>
/// <param name="H">Clamped row span (web <c>clamp(h, 1, 8)</c>).</param>
/// <param name="MinW">Optional minimum width (web <c>minW</c>), unchanged.</param>
/// <param name="MinH">Optional minimum height (web <c>minH</c>), unchanged.</param>
/// <param name="MaxW">Optional maximum width (web <c>maxW</c>), unchanged.</param>
/// <param name="MaxH">Optional maximum height (web <c>maxH</c>), unchanged.</param>
public sealed record ImportLayoutItem(
    string I,
    double X,
    double Y,
    double W,
    double H,
    double? MinW = null,
    double? MinH = null,
    double? MaxW = null,
    double? MaxH = null);

/// <summary>
/// A validated, import-ready dashboard — the native mirror of the web <c>SavedDashboard</c>
/// (web/src/features/dashboard/widgets/types.ts) that <c>validateImportData</c> assembles and the modal hands
/// to <c>onConfirm</c>. Carries the generated <see cref="Id"/> (web <c>import-${Date.now()}</c>), the
/// 100-char-capped <see cref="Name"/>, the available <see cref="Widgets"/>, the per-breakpoint sanitized
/// <see cref="Layouts"/>, the created/updated ISO timestamps and the <see cref="IsDefault"/> flag (always
/// false on import). Pure data.
/// </summary>
/// <param name="Id">The generated dashboard id (web <c>id</c>).</param>
/// <param name="Name">The display name, capped at 100 chars (web <c>String(data.name).slice(0, 100)</c>).</param>
/// <param name="Widgets">The available widget instances (web <c>widgets</c>).</param>
/// <param name="Layouts">The sanitized layouts keyed by breakpoint (web <c>layouts</c>).</param>
/// <param name="CreatedAt">The ISO-8601 created timestamp (web <c>createdAt</c>).</param>
/// <param name="UpdatedAt">The ISO-8601 updated timestamp (web <c>updatedAt</c>).</param>
/// <param name="IsDefault">Always false on import (web <c>isDefault: false</c>).</param>
public sealed record ImportedDashboard(
    string Id,
    string Name,
    IReadOnlyList<ImportedWidget> Widgets,
    IReadOnlyDictionary<string, IReadOnlyList<ImportLayoutItem>> Layouts,
    string CreatedAt,
    string UpdatedAt,
    bool IsDefault);

/// <summary>
/// The result of validating an import payload — the native mirror of the web <c>ImportValidation</c>
/// (web/src/features/dashboard/hooks/validateImport.ts). <see cref="Errors"/> / <see cref="Warnings"/> carry
/// <see cref="ImportMessage"/> codes (localized at the boundary) rather than the web's English strings;
/// everything else mirrors the web shape one-for-one. Construct through the static factories so the lists are
/// never null. Pure data.
/// </summary>
/// <param name="IsValid">Whether the payload yielded an importable dashboard (web <c>isValid</c>).</param>
/// <param name="Errors">The blocking findings (web <c>errors</c>).</param>
/// <param name="Warnings">The non-blocking findings (web <c>warnings</c>).</param>
/// <param name="Dashboard">The validated dashboard, or null when invalid (web <c>dashboard</c>).</param>
/// <param name="MissingWidgets">The widget ids dropped as unavailable (web <c>missingWidgets</c>).</param>
/// <param name="AvailableWidgets">The widget ids kept as available (web <c>availableWidgets</c>).</param>
public sealed record ImportValidation(
    bool IsValid,
    IReadOnlyList<ImportMessage> Errors,
    IReadOnlyList<ImportMessage> Warnings,
    ImportedDashboard? Dashboard,
    IReadOnlyList<string> MissingWidgets,
    IReadOnlyList<string> AvailableWidgets)
{
    /// <summary>True when the import is valid and produced a dashboard (web <c>isValid &amp;&amp; dashboard</c>).</summary>
    public bool CanConfirm => IsValid && Dashboard is not null;

    /// <summary>True when there is at least one blocking finding to surface.</summary>
    public bool HasErrors => Errors.Count > 0;

    /// <summary>True when there is at least one non-blocking finding to surface.</summary>
    public bool HasWarnings => Warnings.Count > 0;

    /// <summary>An invalid result carrying only the given <paramref name="errors"/> (web early returns).</summary>
    public static ImportValidation Invalid(IReadOnlyList<ImportMessage> errors) => new(
        false,
        errors,
        Array.Empty<ImportMessage>(),
        null,
        Array.Empty<string>(),
        Array.Empty<string>());
}

/// <summary>
/// The identity / timestamp seam <see cref="ImportValidator"/> uses when assembling a dashboard — the native
/// analogue of the web validator's <c>Date.now()</c> / <c>Math.random()</c> / <c>new Date().toISOString()</c>
/// calls. Injecting it keeps validation deterministic under test (a fixed fake) while the app uses
/// <see cref="SystemImportIdentity"/>. None of these values affect the available/missing widget-id lists the
/// UI shows — only the generated instance/dashboard ids and timestamps.
/// </summary>
public interface IImportIdentity
{
    /// <summary>A fresh widget instance id (web <c>w-${Date.now()}-${rand}</c>) for a payload widget with no id.</summary>
    string NewWidgetId();

    /// <summary>A dedupe suffix (web <c>-dup-${rand}</c>) appended to a repeated instance id.</summary>
    string DedupeSuffix();

    /// <summary>The generated dashboard id (web <c>import-${Date.now()}</c>).</summary>
    string DashboardId();

    /// <summary>The created/updated ISO-8601 timestamp (web <c>new Date().toISOString()</c>).</summary>
    string TimestampIso();
}

/// <summary>
/// The live <see cref="IImportIdentity"/> — composes ids from the current UTC instant plus a short
/// GUID-derived token (the native stand-in for the web base-36 <c>Math.random()</c> token; a GUID avoids the
/// insecure-randomness analyzer and is more than unique enough for an in-memory instance id). Timestamps use
/// the JS <c>toISOString()</c> shape (<c>yyyy-MM-ddTHH:mm:ss.fffZ</c>).
/// </summary>
public sealed class SystemImportIdentity : IImportIdentity
{
    /// <summary>The shared stateless instance.</summary>
    public static SystemImportIdentity Shared { get; } = new();

    private SystemImportIdentity()
    {
    }

    /// <inheritdoc />
    public string NewWidgetId() => string.Create(
        CultureInfo.InvariantCulture, $"w-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Token()}");

    /// <inheritdoc />
    public string DedupeSuffix() => string.Create(CultureInfo.InvariantCulture, $"-dup-{Token()}");

    /// <inheritdoc />
    public string DashboardId() => string.Create(
        CultureInfo.InvariantCulture, $"import-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");

    /// <inheritdoc />
    public string TimestampIso() =>
        DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);

    private static string Token() => Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)[..4];
}

/// <summary>The outcome of decoding a share URL's import payload (the three web <c>handleUrlImport</c> branches).</summary>
public enum ImportUrlStatus
{
    /// <summary>The payload decoded to JSON ready to validate.</summary>
    Decoded,

    /// <summary>The URL could not be parsed or its payload could not be decoded (web <c>'Invalid URL format'</c>).</summary>
    InvalidUrl,

    /// <summary>The URL carried no <c>import</c> parameter (web <c>'URL does not contain an import parameter'</c>).</summary>
    NoImportParam,
}

/// <summary>
/// The result of <see cref="ImportValidator.DecodeImportUrl"/> — the decoded JSON (when
/// <see cref="Status"/> is <see cref="ImportUrlStatus.Decoded"/>) or an empty payload for the two failure
/// branches. Pure data.
/// </summary>
/// <param name="Status">Which web <c>handleUrlImport</c> branch was taken.</param>
/// <param name="Json">The decoded JSON when <see cref="Status"/> is <see cref="ImportUrlStatus.Decoded"/>; else empty.</param>
public sealed record ImportUrlResult(ImportUrlStatus Status, string Json);

/// <summary>
/// The pure validation / decoding logic behind the import modal — the native port of
/// web/src/features/dashboard/hooks/validateImport.ts (<c>validateImportData</c>, <c>fromUrlSafeBase64</c>,
/// <c>toUrlSafeBase64</c>) plus the modal's <c>handleUrlImport</c> URL parsing and the drop <c>.json</c> guard.
/// Widget availability is resolved against the shared native dashboard widget catalog
/// (<see cref="WidgetPickerCatalog"/>, the native <c>WIDGET_REGISTRY</c>) so the import surface and the rest of
/// the app agree on which widgets exist. No WinUI types — exercised headlessly.
/// </summary>
public static class ImportValidator
{
    /// <summary>The maximum dashboard-name length (web <c>String(data.name).slice(0, 100)</c>).</summary>
    public const int MaxNameLength = 100;

    /// <summary>The maximum sanitized row span (web <c>clamp(h, 1, 8)</c> upper bound).</summary>
    public const int MaxRowSpan = 8;

    // web: const breakpointCols = { lg: 4, md: 3, sm: 2, xs: 1 };
    private static readonly (string Breakpoint, int Cols)[] BreakpointCols =
    [
        ("lg", 4),
        ("md", 3),
        ("sm", 2),
        ("xs", 1),
    ];

    /// <summary>
    /// Validate and normalize a raw JSON payload into a safe dashboard import — the exact web
    /// <c>validateImportData</c> pipeline: parse, shape-check the required <c>name</c> / <c>widgets</c> /
    /// <c>layouts</c> fields, normalize and de-duplicate the widget instances, partition them into
    /// available / missing against the catalog, sanitize the per-breakpoint layouts to the available ids, and
    /// assemble the dashboard (or return early with the blocking findings).
    /// </summary>
    /// <param name="raw">The raw JSON payload (pasted text, file contents or a decoded URL payload).</param>
    /// <param name="identity">The id/timestamp seam; defaults to <see cref="SystemImportIdentity.Shared"/>.</param>
    public static ImportValidation Validate(string raw, IImportIdentity? identity = null)
    {
        ArgumentNullException.ThrowIfNull(raw);
        identity ??= SystemImportIdentity.Shared;

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(raw);
        }
        catch (JsonException)
        {
            return ImportValidation.Invalid([new ImportMessage(ImportMessageKind.InvalidJson)]);
        }

        using (document)
        {
            JsonElement root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return ImportValidation.Invalid([new ImportMessage(ImportMessageKind.ExpectedObject)]);
            }

            var errors = new List<ImportMessage>();

            bool hasName = root.TryGetProperty("name", out JsonElement nameElement)
                && nameElement.ValueKind == JsonValueKind.String
                && !string.IsNullOrEmpty(nameElement.GetString());
            if (!hasName)
            {
                errors.Add(new ImportMessage(ImportMessageKind.MissingName));
            }

            bool hasWidgets = root.TryGetProperty("widgets", out JsonElement widgetsElement)
                && widgetsElement.ValueKind == JsonValueKind.Array;
            if (!hasWidgets)
            {
                errors.Add(new ImportMessage(ImportMessageKind.MissingWidgets));
            }

            bool hasLayouts = root.TryGetProperty("layouts", out JsonElement layoutsElement)
                && layoutsElement.ValueKind is JsonValueKind.Object or JsonValueKind.Array;
            if (!hasLayouts)
            {
                errors.Add(new ImportMessage(ImportMessageKind.MissingLayouts));
            }

            if (errors.Count > 0)
            {
                return ImportValidation.Invalid(errors);
            }

            var validWidgets = NormalizeWidgets(widgetsElement, identity);
            var available = new List<ImportedWidget>();
            var missing = new List<ImportedWidget>();
            foreach (ImportedWidget widget in validWidgets)
            {
                if (ImportWidgetRegistry.Contains(widget.WidgetId))
                {
                    available.Add(widget);
                }
                else
                {
                    missing.Add(widget);
                }
            }

            var warnings = new List<ImportMessage>();
            if (missing.Count > 0)
            {
                warnings.Add(new ImportMessage(ImportMessageKind.SkippedWidgets, missing.Count));
            }

            if (available.Count == 0)
            {
                errors.Add(new ImportMessage(ImportMessageKind.NoCompatibleWidgets));
                return new ImportValidation(
                    false,
                    errors,
                    warnings,
                    null,
                    WidgetIds(missing),
                    Array.Empty<string>());
            }

            var layouts = SanitizeLayouts(layoutsElement, available);

            string rawName = nameElement.GetString() ?? string.Empty;
            string name = rawName.Length > MaxNameLength ? rawName[..MaxNameLength] : rawName;
            string timestamp = identity.TimestampIso();
            var dashboard = new ImportedDashboard(
                identity.DashboardId(),
                name,
                available,
                layouts,
                timestamp,
                timestamp,
                false);

            return new ImportValidation(
                true,
                errors,
                warnings,
                dashboard,
                WidgetIds(missing),
                WidgetIds(available));
        }
    }

    /// <summary>
    /// Decode a share URL's import payload — the native port of the modal's <c>handleUrlImport</c>: parse the
    /// URL, prefer the <c>#import=</c> fragment over the <c>?import=</c> query, and base-64-decode the payload.
    /// A missing parameter yields <see cref="ImportUrlStatus.NoImportParam"/>; an unparseable URL or
    /// undecodable payload yields <see cref="ImportUrlStatus.InvalidUrl"/> (the web outer <c>catch</c>).
    /// </summary>
    /// <param name="url">The share URL the user pasted.</param>
    public static ImportUrlResult DecodeImportUrl(string url)
    {
        ArgumentNullException.ThrowIfNull(url);

        if (!Uri.TryCreate(url, UriKind.Absolute, out Uri? parsed))
        {
            return new ImportUrlResult(ImportUrlStatus.InvalidUrl, string.Empty);
        }

        const string fragmentPrefix = "#import=";
        string fragment = parsed.Fragment;
        string? fromFragment = fragment.StartsWith(fragmentPrefix, StringComparison.Ordinal)
            ? fragment[fragmentPrefix.Length..]
            : null;
        string? fromQuery = ReadQueryValue(parsed.Query, "import");
        string? encoded = fromFragment ?? fromQuery;

        if (string.IsNullOrEmpty(encoded))
        {
            return new ImportUrlResult(ImportUrlStatus.NoImportParam, string.Empty);
        }

        try
        {
            return new ImportUrlResult(ImportUrlStatus.Decoded, FromUrlSafeBase64(encoded));
        }
        catch (FormatException)
        {
            return new ImportUrlResult(ImportUrlStatus.InvalidUrl, string.Empty);
        }
    }

    /// <summary>
    /// Decode a URL-safe base-64 string to UTF-8 text — the exact inverse of the web <c>fromUrlSafeBase64</c>
    /// (<c>-</c> → <c>+</c>, <c>_</c> → <c>/</c>, re-pad, decode). Throws <see cref="FormatException"/> on an
    /// undecodable payload (the web <c>atob</c> throw).
    /// </summary>
    /// <param name="encoded">The URL-safe base-64 payload.</param>
    public static string FromUrlSafeBase64(string encoded)
    {
        ArgumentNullException.ThrowIfNull(encoded);

        string padded = encoded.Replace('-', '+').Replace('_', '/');
        int remainder = padded.Length % 4;
        if (remainder != 0)
        {
            padded = padded.PadRight(padded.Length + (4 - remainder), '=');
        }

        byte[] bytes = Convert.FromBase64String(padded);
        return Encoding.UTF8.GetString(bytes);
    }

    /// <summary>
    /// Encode UTF-8 text as a URL-safe base-64 string — the native port of the web <c>toUrlSafeBase64</c>
    /// (<c>+</c> → <c>-</c>, <c>/</c> → <c>_</c>, strip trailing <c>=</c>). The inverse of
    /// <see cref="FromUrlSafeBase64"/>.
    /// </summary>
    /// <param name="value">The text to encode.</param>
    public static string ToUrlSafeBase64(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        byte[] bytes = Encoding.UTF8.GetBytes(value);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    /// <summary>
    /// Whether a dropped item should be accepted as a dashboard file — the web drop guard
    /// (<c>file.type === 'application/json' || file.name.endsWith('.json')</c>).
    /// </summary>
    /// <param name="fileName">The dropped file's name, or null.</param>
    /// <param name="contentType">The dropped file's MIME type, or null.</param>
    public static bool IsJsonFile(string? fileName, string? contentType) =>
        string.Equals(contentType, "application/json", StringComparison.OrdinalIgnoreCase)
        || (fileName is not null && fileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase));

    private static List<ImportedWidget> NormalizeWidgets(JsonElement widgets, IImportIdentity identity)
    {
        var result = new List<ImportedWidget>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (JsonElement entry in widgets.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (!entry.TryGetProperty("widgetId", out JsonElement widgetIdElement)
                || widgetIdElement.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            string widgetId = widgetIdElement.GetString() ?? string.Empty;

            string id = entry.TryGetProperty("id", out JsonElement idElement)
                && idElement.ValueKind == JsonValueKind.String
                ? idElement.GetString() ?? identity.NewWidgetId()
                : identity.NewWidgetId();
            if (!seen.Add(id))
            {
                id += identity.DedupeSuffix();
                seen.Add(id);
            }

            string? config = entry.TryGetProperty("config", out JsonElement configElement)
                && configElement.ValueKind == JsonValueKind.Object
                ? configElement.GetRawText()
                : null;

            result.Add(new ImportedWidget(id, widgetId, config));
        }

        return result;
    }

    private static Dictionary<string, IReadOnlyList<ImportLayoutItem>> SanitizeLayouts(
        JsonElement layouts,
        IReadOnlyList<ImportedWidget> available)
    {
        var sanitized = new Dictionary<string, IReadOnlyList<ImportLayoutItem>>(StringComparer.Ordinal);
        if (layouts.ValueKind != JsonValueKind.Object)
        {
            // web: an array layouts has no string breakpoint keys, so every breakpoint is regenerated later.
            return sanitized;
        }

        var availableIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (ImportedWidget widget in available)
        {
            availableIds.Add(widget.Id);
        }

        foreach ((string breakpoint, int cols) in BreakpointCols)
        {
            if (!layouts.TryGetProperty(breakpoint, out JsonElement breakpointLayout)
                || breakpointLayout.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            var items = new List<ImportLayoutItem>();
            foreach (JsonElement entry in breakpointLayout.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (!entry.TryGetProperty("i", out JsonElement keyElement)
                    || keyElement.ValueKind != JsonValueKind.String)
                {
                    continue;
                }

                string key = keyElement.GetString() ?? string.Empty;
                if (!availableIds.Contains(key))
                {
                    continue;
                }

                items.Add(SanitizeLayoutItem(key, entry, cols));
            }

            sanitized[breakpoint] = items;
        }

        return sanitized;
    }

    private static ImportLayoutItem SanitizeLayoutItem(string key, JsonElement item, int cols)
    {
        double rawX = NumberOr(item, "x", 0);
        double rawY = NumberOr(item, "y", 0);
        double rawW = NumberOr(item, "w", 1);
        double rawH = NumberOr(item, "h", 1);

        return new ImportLayoutItem(
            key,
            rawX >= 0 ? Clamp(rawX, 0, cols - 1) : 0,
            rawY >= 0 ? rawY : 0,
            rawW >= 0 ? Clamp(rawW, 1, cols) : 1,
            rawH >= 0 ? Clamp(rawH, 1, MaxRowSpan) : 1,
            NumberOrNull(item, "minW"),
            NumberOrNull(item, "minH"),
            NumberOrNull(item, "maxW"),
            NumberOrNull(item, "maxH"));
    }

    private static double NumberOr(JsonElement item, string property, double fallback) =>
        item.TryGetProperty(property, out JsonElement element) && element.ValueKind == JsonValueKind.Number
            ? element.GetDouble()
            : fallback;

    private static double? NumberOrNull(JsonElement item, string property) =>
        item.TryGetProperty(property, out JsonElement element) && element.ValueKind == JsonValueKind.Number
            ? element.GetDouble()
            : null;

    private static double Clamp(double value, double min, double max) => Math.Min(Math.Max(value, min), max);

    private static string[] WidgetIds(List<ImportedWidget> widgets)
    {
        var ids = new string[widgets.Count];
        for (int i = 0; i < widgets.Count; i++)
        {
            ids[i] = widgets[i].WidgetId;
        }

        return ids;
    }

    private static string? ReadQueryValue(string query, string key)
    {
        if (string.IsNullOrEmpty(query))
        {
            return null;
        }

        string trimmed = query.StartsWith('?') ? query[1..] : query;
        foreach (string pair in trimmed.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            int equals = pair.IndexOf('=', StringComparison.Ordinal);
            string name = equals >= 0 ? pair[..equals] : pair;
            if (!string.Equals(Uri.UnescapeDataString(name), key, StringComparison.Ordinal))
            {
                continue;
            }

            return equals >= 0 ? Uri.UnescapeDataString(pair[(equals + 1)..]) : string.Empty;
        }

        return null;
    }
}

/// <summary>
/// The native <c>WIDGET_REGISTRY</c> view the importer checks widget availability against — backed by the
/// shared dashboard widget catalog (<see cref="WidgetPickerCatalog.DefaultWidgets"/>, the row-for-row
/// transcription of the web registry). <see cref="Contains"/> is the native
/// <c>registryIds.has(widgetId)</c>; <see cref="DisplayName"/> is the native
/// <c>getWidgetDef(widgetId)?.name</c>. Pure data — no WinUI types.
/// </summary>
public static class ImportWidgetRegistry
{
    private static readonly Dictionary<string, string> NamesById = BuildNames();

    /// <summary>The number of catalog widgets availability is checked against (web <c>WIDGET_REGISTRY.length</c>).</summary>
    public static int Count => NamesById.Count;

    /// <summary>Whether the catalog contains <paramref name="widgetId"/> (web <c>registryIds.has(widgetId)</c>).</summary>
    public static bool Contains(string widgetId)
    {
        ArgumentNullException.ThrowIfNull(widgetId);
        return NamesById.ContainsKey(widgetId);
    }

    /// <summary>The catalog display name for <paramref name="widgetId"/>, or null (web <c>getWidgetDef(id)?.name</c>).</summary>
    public static string? DisplayName(string widgetId)
    {
        ArgumentNullException.ThrowIfNull(widgetId);
        return NamesById.TryGetValue(widgetId, out string? name) ? name : null;
    }

    private static Dictionary<string, string> BuildNames()
    {
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (WidgetCatalogEntry entry in WidgetPickerCatalog.DefaultWidgets)
        {
            names[entry.Id] = entry.Name;
        }

        return names;
    }
}

/// <summary>
/// One row of the import preview's widget-availability list — the native projection of one web
/// <c>availableWidgets.map(...)</c> / <c>missingWidgets.map(...)</c> row
/// (web/src/features/dashboard/components/ImportPreviewModal.tsx). An available row carries the resolved
/// catalog <see cref="DisplayName"/> and Segoe Fluent <see cref="IconGlyph"/> (web check + widget icon); a
/// missing row carries the widget id as its <see cref="DisplayName"/>, no icon and
/// <see cref="Available"/> false (web strikethrough + "Not available"). Pure data.
/// </summary>
/// <param name="WidgetId">The catalog widget id this row represents.</param>
/// <param name="DisplayName">The catalog name for an available row, or the id for a missing row.</param>
/// <param name="IconGlyph">The widget's Segoe Fluent glyph for an available row, else null.</param>
/// <param name="Available">True for an available widget, false for a skipped one.</param>
public sealed record ImportPreviewWidgetRow(string WidgetId, string DisplayName, string? IconGlyph, bool Available);

/// <summary>
/// Canonical metadata, Segoe Fluent glyphs and i18n keys for the <c>ImportPreviewModal</c> surface — the
/// native mirror of web/src/features/dashboard/components/ImportPreviewModal.tsx. The web component reads its
/// copy through <c>useTranslation('dashboard')</c>; every <c>t()</c> key is reproduced verbatim here (with the
/// web English literal as the fallback). Three strings the web hard-codes are also keyed so the native view
/// holds no inline English: the two input hints (JSON / URL samples) and the validator's English
/// findings (keyed under <c>import.error.*</c> / <c>import.warning.*</c>). The shared modal-dismiss affordance
/// (the web <c>Modal</c> close "X", <c>aria-label="Close"</c>) maps to the dialog's close button via
/// <c>common.close</c>. UI-free so every key + glyph is asserted in tests.
/// </summary>
public static class ImportPreviewRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ImportPreviewModal";

    /// <summary>Segoe Fluent "Upload" glyph for the file drop zone (web <c>Upload</c> icon).</summary>
    public const string UploadGlyph = "\uE898";

    /// <summary>Segoe Fluent "OpenFile" glyph for the browse button (web <c>FileUp</c> icon).</summary>
    public const string BrowseGlyph = "\uE8E5";

    /// <summary>Segoe Fluent "Page" glyph for the validate button (web <c>FileJson</c> icon).</summary>
    public const string ValidateGlyph = "\uE7C3";

    /// <summary>Segoe Fluent "Link" glyph for the URL input (web <c>Link2</c> icon).</summary>
    public const string LinkGlyph = "\uE71B";

    /// <summary>Segoe Fluent "Completed" glyph for an available widget row + confirm (web <c>CheckCircle2</c>).</summary>
    public const string AvailableGlyph = "\uE930";

    /// <summary>Segoe Fluent "ErrorBadge" glyph for a skipped widget row (web <c>XCircle</c>).</summary>
    public const string MissingGlyph = "\uEA39";

    /// <summary>Modal title in input mode (web <c>t('import.title', 'Import Dashboard')</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("import.title", "Import Dashboard");

    /// <summary>Modal title in preview mode (web <c>t('import.preview', 'Import Preview')</c>).</summary>
    public static string PreviewTitle(ILocalizer localizer) =>
        Require(localizer).GetString("import.preview", "Import Preview");

    /// <summary>"From File" tab label (web <c>t('import.fromFile', 'From File')</c>).</summary>
    public static string TabFile(ILocalizer localizer) =>
        Require(localizer).GetString("import.fromFile", "From File");

    /// <summary>"Paste JSON" tab label (web <c>t('import.fromClipboard', 'Paste JSON')</c>).</summary>
    public static string TabPaste(ILocalizer localizer) =>
        Require(localizer).GetString("import.fromClipboard", "Paste JSON");

    /// <summary>"From URL" tab label (web <c>t('import.fromUrl', 'From URL')</c>).</summary>
    public static string TabUrl(ILocalizer localizer) =>
        Require(localizer).GetString("import.fromUrl", "From URL");

    /// <summary>File drop-zone prompt (web <c>t('import.dropFile', 'Drop a .json file here or click to browse')</c>).</summary>
    public static string DropFile(ILocalizer localizer) =>
        Require(localizer).GetString("import.dropFile", "Drop a .json file here or click to browse");

    /// <summary>Browse button label (web <c>t('import.browse', 'Browse Files')</c>).</summary>
    public static string Browse(ILocalizer localizer) =>
        Require(localizer).GetString("import.browse", "Browse Files");

    /// <summary>Hidden file-input accessible label (web <c>t('import.fileInput', 'Dashboard JSON file')</c>).</summary>
    public static string FileInputLabel(ILocalizer localizer) =>
        Require(localizer).GetString("import.fileInput", "Dashboard JSON file");

    /// <summary>Validate button label (web <c>t('import.validate', 'Validate &amp; Preview')</c>).</summary>
    public static string Validate(ILocalizer localizer) =>
        Require(localizer).GetString("import.validate", "Validate & Preview");

    /// <summary>Load-from-URL button label (web <c>t('import.loadUrl', 'Load from URL')</c>).</summary>
    public static string LoadUrl(ILocalizer localizer) =>
        Require(localizer).GetString("import.loadUrl", "Load from URL");

    /// <summary>Widget-list section header (web <c>t('import.widgets', 'Widgets')</c>).</summary>
    public static string Widgets(ILocalizer localizer) =>
        Require(localizer).GetString("import.widgets", "Widgets");

    /// <summary>Skipped-widget trailing label (web <c>t('import.notAvailable', 'Not available')</c>).</summary>
    public static string NotAvailable(ILocalizer localizer) =>
        Require(localizer).GetString("import.notAvailable", "Not available");

    /// <summary>Preview empty-state message (web <c>t('import.cannotPreview', 'Cannot preview this layout')</c>).</summary>
    public static string CannotPreview(ILocalizer localizer) =>
        Require(localizer).GetString("import.cannotPreview", "Cannot preview this layout");

    /// <summary>Back button label (web <c>t('import.back', 'Back')</c>).</summary>
    public static string Back(ILocalizer localizer) =>
        Require(localizer).GetString("import.back", "Back");

    /// <summary>Confirm button label (web <c>t('import.confirm', 'Import Dashboard')</c>).</summary>
    public static string Confirm(ILocalizer localizer) =>
        Require(localizer).GetString("import.confirm", "Import Dashboard");

    /// <summary>Paste textarea sample hint (web inline JSON sample, keyed to avoid an inline literal).</summary>
    public static string PasteHint(ILocalizer localizer) =>
        Require(localizer).GetString(
            "import.pasteHint",
            "{\"name\": \"My Dashboard\", \"widgets\": [...], \"layouts\": {...}}");

    /// <summary>URL input sample hint (web inline URL sample, keyed to avoid an inline literal).</summary>
    public static string UrlHint(ILocalizer localizer) =>
        Require(localizer).GetString(
            "import.urlHint",
            "https://teslasync.example.com/dashboard#import=...");

    /// <summary>Shared modal-dismiss label (web <c>Modal</c> close "X" <c>aria-label="Close"</c>).</summary>
    public static string Close(ILocalizer localizer) =>
        Require(localizer).GetString("common.close", "Close");

    /// <summary>Empty-input parse error (web <c>t('import.emptyInput', 'No data to validate')</c>).</summary>
    public static string EmptyInput(ILocalizer localizer) =>
        Require(localizer).GetString("import.emptyInput", "No data to validate");

    /// <summary>File-read parse error (web <c>t('import.readError', 'Failed to read file')</c>).</summary>
    public static string ReadError(ILocalizer localizer) =>
        Require(localizer).GetString("import.readError", "Failed to read file");

    /// <summary>Wrong-file-type parse error (web <c>t('import.invalidFileType', 'Please drop a .json file')</c>).</summary>
    public static string InvalidFileType(ILocalizer localizer) =>
        Require(localizer).GetString("import.invalidFileType", "Please drop a .json file");

    /// <summary>Missing-parameter URL error (web <c>t('import.noImportParam', 'URL does not contain an import parameter')</c>).</summary>
    public static string NoImportParam(ILocalizer localizer) =>
        Require(localizer).GetString("import.noImportParam", "URL does not contain an import parameter");

    /// <summary>Unparseable-URL error (web <c>t('import.invalidUrl', 'Invalid URL format')</c>).</summary>
    public static string InvalidUrl(ILocalizer localizer) =>
        Require(localizer).GetString("import.invalidUrl", "Invalid URL format");

    /// <summary>The available-widget-count badge (web <c>t('import.availableCount', '{{count}} widgets', { count })</c>).</summary>
    public static string AvailableCount(ILocalizer localizer, int count) => Interpolate(
        Require(localizer).GetString("import.availableCount", "{{count}} widgets"), count);

    /// <summary>The skipped-widget-count badge (web <c>t('import.missingCount', '{{count}} skipped', { count })</c>).</summary>
    public static string MissingCount(ILocalizer localizer, int count) => Interpolate(
        Require(localizer).GetString("import.missingCount", "{{count}} skipped"), count);

    /// <summary>The localized text for a validation finding (web pushes English literals; native localizes here).</summary>
    public static string Message(ImportMessage message, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(message);
        Require(localizer);
        return message.Kind switch
        {
            ImportMessageKind.InvalidJson => localizer.GetString("import.error.invalidJson", "Invalid JSON format"),
            ImportMessageKind.ExpectedObject => localizer.GetString("import.error.expectedObject", "Expected a JSON object"),
            ImportMessageKind.MissingName => localizer.GetString("import.error.missingName", "Missing or invalid \"name\" field"),
            ImportMessageKind.MissingWidgets => localizer.GetString("import.error.missingWidgets", "Missing or invalid \"widgets\" array"),
            ImportMessageKind.MissingLayouts => localizer.GetString("import.error.missingLayouts", "Missing or invalid \"layouts\" object"),
            ImportMessageKind.NoCompatibleWidgets => localizer.GetString("import.error.noCompatibleWidgets", "No compatible widgets found in this layout"),
            ImportMessageKind.SkippedWidgets => Interpolate(
                localizer.GetString("import.warning.skipped", "{{count}} widget(s) not available and will be skipped"),
                message.Count),
            _ => string.Empty,
        };
    }

    private static string Interpolate(string template, int count) =>
        template.Replace("{{count}}", count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure projections for the <c>ImportPreviewModal</c> surface — everything the web component derives before
/// returning JSX (web/src/features/dashboard/components/ImportPreviewModal.tsx): the tab list, the localized
/// error / warning lines, the widget-availability rows (web <c>availableWidgets.map</c> +
/// <c>missingWidgets.map</c>) and the <c>MiniGridPreview</c> render model built from the validated dashboard's
/// <c>lg</c> layout. Every user-visible string flows through the i18n facade, so the projection is unit-tested
/// headlessly and the view resolves no literal. No WinUI types.
/// </summary>
public static class ImportPreviewProjection
{
    /// <summary>The tabs in web render order with localized labels (web <c>tabs</c> array).</summary>
    public static IReadOnlyList<(ImportPreviewTab Tab, string Label)> Tabs(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return
        [
            (ImportPreviewTab.File, ImportPreviewRegistration.TabFile(localizer)),
            (ImportPreviewTab.Paste, ImportPreviewRegistration.TabPaste(localizer)),
            (ImportPreviewTab.Url, ImportPreviewRegistration.TabUrl(localizer)),
        ];
    }

    /// <summary>The localized blocking-error lines for the preview (web <c>errors.map</c>).</summary>
    public static IReadOnlyList<string> ErrorLines(ImportValidation validation, ILocalizer localizer) =>
        Localize(validation, validation?.Errors, localizer);

    /// <summary>The localized non-blocking-warning lines for the preview (web <c>warnings.map</c>).</summary>
    public static IReadOnlyList<string> WarningLines(ImportValidation validation, ILocalizer localizer) =>
        Localize(validation, validation?.Warnings, localizer);

    /// <summary>
    /// The widget-availability rows for the preview — every available widget (with its catalog name + glyph),
    /// then every skipped widget (web <c>availableWidgets.map(...)</c> then <c>missingWidgets.map(...)</c>).
    /// </summary>
    public static IReadOnlyList<ImportPreviewWidgetRow> WidgetRows(ImportValidation validation)
    {
        ArgumentNullException.ThrowIfNull(validation);

        var rows = new List<ImportPreviewWidgetRow>(
            validation.AvailableWidgets.Count + validation.MissingWidgets.Count);
        foreach (string widgetId in validation.AvailableWidgets)
        {
            rows.Add(new ImportPreviewWidgetRow(
                widgetId,
                ImportWidgetRegistry.DisplayName(widgetId) ?? widgetId,
                MiniGridWidgetIcons.GlyphFor(widgetId),
                true));
        }

        foreach (string widgetId in validation.MissingWidgets)
        {
            rows.Add(new ImportPreviewWidgetRow(widgetId, widgetId, null, false));
        }

        return rows;
    }

    /// <summary>
    /// Build the <see cref="MiniGridPreviewModel"/> for the preview thumbnail from a validated dashboard's
    /// <c>lg</c> layout and widget instances — the native analogue of the web
    /// <c>&lt;MiniGridPreview dashboard={dashboard} /&gt;</c> (which reads only <c>layouts.lg</c> + <c>widgets</c>).
    /// </summary>
    public static MiniGridPreviewModel PreviewModel(ImportedDashboard dashboard)
    {
        ArgumentNullException.ThrowIfNull(dashboard);

        var widgets = new List<MiniGridWidgetInstance>(dashboard.Widgets.Count);
        foreach (ImportedWidget widget in dashboard.Widgets)
        {
            widgets.Add(new MiniGridWidgetInstance(widget.Id, widget.WidgetId));
        }

        var layout = new List<MiniGridLayoutItem>();
        if (dashboard.Layouts.TryGetValue("lg", out IReadOnlyList<ImportLayoutItem>? items))
        {
            foreach (ImportLayoutItem item in items)
            {
                layout.Add(new MiniGridLayoutItem(
                    item.I,
                    (int)item.X,
                    (int)item.Y,
                    (int)item.W,
                    (int)item.H));
            }
        }

        return MiniGridPreviewModel.Create(widgets, layout);
    }

    private static string[] Localize(
        ImportValidation? validation,
        IReadOnlyList<ImportMessage>? messages,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(validation);
        ArgumentNullException.ThrowIfNull(localizer);

        if (messages is null || messages.Count == 0)
        {
            return Array.Empty<string>();
        }

        var lines = new string[messages.Count];
        for (int i = 0; i < messages.Count; i++)
        {
            lines[i] = ImportPreviewRegistration.Message(messages[i], localizer);
        }

        return lines;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ImportPreviewModal</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the imported JSON, dashboard name, widget ids, share URL
/// or any payload content — so a diagnostics line can never leak import data. Thread-safe.
/// </summary>
public sealed class ImportPreviewDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _imported;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The diagnostics sink; defaults to a no-op counter-only collector.</param>
    public ImportPreviewDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>The number of dashboards confirmed (imported) from this surface.</summary>
    public long Imported => Interlocked.Read(ref _imported);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ImportPreviewModal</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={ImportPreviewRegistration.Slug}"));
    }

    /// <summary>Record that a dashboard was imported (the payload content is never logged).</summary>
    public void RecordImported()
    {
        Interlocked.Increment(ref _imported);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"dashboard.imported slug={ImportPreviewRegistration.Slug}"));
    }
}
