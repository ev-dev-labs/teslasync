using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.TelemetryErrors;

/// <summary>
/// The mutually-exclusive render branch of the <c>TelemetryErrorsPanel</c> surface — the native union of
/// the five states the web component renders
/// (web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx). The web source is a pure
/// presentational component (it takes its data as props and performs no fetching), so the branches are a
/// direct function of the input <see cref="TelemetryErrorsPanelModel"/>; there is no fetch-driven
/// stale/offline branch to reproduce. Every branch maps onto a visible surface — none is ever hidden.
/// </summary>
public enum TelemetryErrorsPanelState
{
    /// <summary>The "View Errors" action has not run yet (web <c>!requested</c>) — title + idle hint.</summary>
    Idle,

    /// <summary>The request is in flight (web <c>loading</c>) — title + skeleton chrome.</summary>
    Loading,

    /// <summary>The request failed (web <c>error</c>) — title + the error message.</summary>
    Error,

    /// <summary>The request produced rows (web <c>errors.length &gt; 0</c>) — the table + download.</summary>
    Data,

    /// <summary>
    /// The request succeeded but produced zero rows (web fall-through). A success chip ("0") when the
    /// extractor recognised the shape (<c>ok</c>), otherwise a warning chip ("?") plus the raw-response
    /// disclosure so an operator can debug Tesla wire-shape drift.
    /// </summary>
    Empty,
}

/// <summary>
/// One UI-normalised telemetry-error row — the native mirror of the web <c>TelemetryError</c> shape in
/// <c>web/src/features/admin/components/devtools/types.ts</c> (the result of <c>extractTelemetryErrors</c>
/// unwrapping Tesla's response envelope). <see cref="RowKey"/> is the stable composite key the table keys
/// on; <see cref="Timestamp"/>/<see cref="Code"/>/<see cref="Message"/> are the raw observable fields,
/// formatted for display by <see cref="TelemetryErrorsPanelProjection"/>. Pure data — no WinUI types.
/// </summary>
public sealed record TelemetryErrorRow(
    string RowKey,
    string Timestamp,
    string Code,
    string Message);

/// <summary>
/// The render-time data model the <c>TelemetryErrorsPanel</c> view binds to — the native analogue of the
/// web <c>TelemetryErrorsPanelProps</c> data fields. The component is presentational: this model carries
/// the request lifecycle (<see cref="Requested"/>/<see cref="Loading"/>/<see cref="ErrorMessage"/>), the
/// extracted <see cref="Errors"/> and the extractor's <see cref="Ok"/> verdict, the <see cref="Vin"/> used
/// for the download filename, and the optional pretty-printed <see cref="RawJson"/> Tesla response shown
/// under the empty state. User-facing labels are resolved from the i18n facade by the projection, not
/// passed in. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record TelemetryErrorsPanelModel(
    bool Requested,
    bool Loading,
    string? ErrorMessage,
    bool Ok,
    IReadOnlyList<TelemetryErrorRow> Errors,
    string Vin,
    string? RawJson)
{
    /// <summary>The initial idle model — the action has not been run yet.</summary>
    public static TelemetryErrorsPanelModel Idle { get; } =
        new(false, false, null, true, Array.Empty<TelemetryErrorRow>(), string.Empty, null);
}

/// <summary>
/// A declarative table column descriptor (key + localized header) — the native, WinUI-free analogue of the
/// web <c>Column&lt;TelemetryError&gt;</c> the parent passes into the panel. The view maps each one onto a
/// <c>TsDataColumn</c>; rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record TelemetryErrorsPanelColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready table row — the cell values keyed by column key, the stable
/// <see cref="RowKey"/>, and a Narrator automation name. Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record TelemetryErrorsPanelRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of the
/// branch the web <c>TelemetryErrorsPanel</c> returns. Holds the resolved labels, the active
/// <see cref="State"/>, the empty-state chip, the optional raw-response disclosure, the download payload,
/// and the table columns + rows. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record TelemetryErrorsPanelDisplay(
    TelemetryErrorsPanelState State,
    string Title,
    string IdleMessage,
    string EmptyMessage,
    string? ErrorText,
    bool Ok,
    string BadgeText,
    StatusKind BadgeStatus,
    bool ShowRawDisclosure,
    string? RawJson,
    string RawDisclosureLabel,
    string DownloadLabel,
    string DownloadFileName,
    string DownloadJson,
    IReadOnlyList<TelemetryErrorsPanelColumn> Columns,
    IReadOnlyList<TelemetryErrorsPanelRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="TelemetryErrorsPanelModel"/> to its
/// <see cref="TelemetryErrorsPanelDisplay"/> — the native port of the branch selection in
/// web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx. The branch precedence mirrors the
/// web source exactly (idle → loading → error → data → empty); the empty branch reproduces the web's
/// <c>ok ? "0"/success : "?"/warning</c> chip and the <c>!ok &amp;&amp; rawData != null</c> raw disclosure.
/// Timestamps render through <see cref="DateTimeFormatting"/> (so <c>now</c> is injected for determinism)
/// and every label resolves through the i18n facade using the same keys the web parent
/// (<c>FleetApiSection.tsx</c>) feeds into the props. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class TelemetryErrorsPanelProjection
{
    /// <summary>Column key for the timestamp column (web <c>key: 'timestamp'</c>).</summary>
    public const string TimestampKey = "timestamp";

    /// <summary>Column key for the error-code column (web <c>key: 'code'</c>).</summary>
    public const string CodeKey = "code";

    /// <summary>Column key for the message column (web <c>key: 'message'</c>).</summary>
    public const string MessageKey = "message";

    /// <summary>Page size for the data table (web <c>pagination.defaultPageSize</c>).</summary>
    public const int PageSize = 50;

    private const string EmDash = "\u2014";
    private const string LoadingAnnounce = "Loading";

    private static readonly JsonSerializerOptions DownloadJsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for timestamp formatting.</param>
    public static TelemetryErrorsPanelDisplay Project(
        TelemetryErrorsPanelModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("Telemetry Errors", "Telemetry Errors");
        string idleMessage = localizer.GetString(
            "devtools.errorsIdle",
            "Click View Errors to fetch recent Fleet Telemetry errors for this vehicle.");
        string emptyMessage = localizer.GetString(
            "devtools.errorsEmpty",
            "No Fleet Telemetry errors reported for this vehicle.");
        string rawDisclosureLabel = localizer.GetString("devtools.errorsRaw", "Show raw Tesla response");
        string downloadLabel = localizer.GetString("Download Errors", "Download Errors");

        IReadOnlyList<TelemetryErrorsPanelColumn> columns = BuildColumns(localizer);
        IReadOnlyList<TelemetryErrorsPanelRow> rows = BuildRows(model.Errors, now);

        TelemetryErrorsPanelState state = SelectState(model);
        bool ok = model.Ok;
        bool showRaw = state == TelemetryErrorsPanelState.Empty && !ok && model.RawJson is not null;
        string? errorText = string.IsNullOrEmpty(model.ErrorMessage) ? null : model.ErrorMessage;

        return new TelemetryErrorsPanelDisplay(
            State: state,
            Title: title,
            IdleMessage: idleMessage,
            EmptyMessage: emptyMessage,
            ErrorText: errorText,
            Ok: ok,
            BadgeText: ok ? "0" : "?",
            BadgeStatus: ok ? StatusKind.Success : StatusKind.Warning,
            ShowRawDisclosure: showRaw,
            RawJson: model.RawJson,
            RawDisclosureLabel: rawDisclosureLabel,
            DownloadLabel: downloadLabel,
            DownloadFileName: BuildDownloadFileName(model.Vin),
            DownloadJson: JsonSerializer.Serialize(model.Errors, DownloadJsonOptions),
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, idleMessage, emptyMessage, errorText, rows.Count));
    }

    /// <summary>Branch precedence from the web source: idle → loading → error → data → empty.</summary>
    private static TelemetryErrorsPanelState SelectState(TelemetryErrorsPanelModel model)
    {
        if (!model.Requested)
        {
            return TelemetryErrorsPanelState.Idle;
        }

        if (model.Loading)
        {
            return TelemetryErrorsPanelState.Loading;
        }

        if (!string.IsNullOrEmpty(model.ErrorMessage))
        {
            return TelemetryErrorsPanelState.Error;
        }

        return model.Errors.Count > 0 ? TelemetryErrorsPanelState.Data : TelemetryErrorsPanelState.Empty;
    }

    private static IReadOnlyList<TelemetryErrorsPanelColumn> BuildColumns(ILocalizer localizer) =>
    [
        new TelemetryErrorsPanelColumn(TimestampKey, localizer.GetString("Timestamp", "Timestamp")),
        new TelemetryErrorsPanelColumn(CodeKey, localizer.GetString("Code", "Code")),
        new TelemetryErrorsPanelColumn(MessageKey, localizer.GetString("Message", "Message")),
    ];

    private static IReadOnlyList<TelemetryErrorsPanelRow> BuildRows(
        IReadOnlyList<TelemetryErrorRow> errors,
        DateTimeOffset now)
    {
        if (errors.Count == 0)
        {
            return Array.Empty<TelemetryErrorsPanelRow>();
        }

        var rows = new List<TelemetryErrorsPanelRow>(errors.Count);
        foreach (var error in errors)
        {
            string timestamp = FormatTimestamp(error.Timestamp, now);
            string code = string.IsNullOrEmpty(error.Code) ? EmDash : error.Code;
            string message = string.IsNullOrEmpty(error.Message) ? EmDash : error.Message;

            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [TimestampKey] = timestamp,
                [CodeKey] = code,
                [MessageKey] = message,
            };

            rows.Add(new TelemetryErrorsPanelRow(
                RowKey: error.RowKey,
                Cells: cells,
                AutomationName: $"{timestamp}. {code}. {message}"));
        }

        return rows;
    }

    // Web parity for the column render: `r.timestamp ? formatDateTime(r.timestamp) : '—'`.
    private static string FormatTimestamp(string? raw, DateTimeOffset now)
    {
        if (TryParseTimestamp(raw, out var value))
        {
            return DateTimeFormatting.Format(value, DateTimeVariant.Full, now);
        }

        return EmDash;
    }

    private static bool TryParseTimestamp(string? raw, out DateTimeOffset value)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out value))
        {
            return true;
        }

        value = default;
        return false;
    }

    // Web parity: `telemetry-errors-${vin || 'all'}.json`.
    private static string BuildDownloadFileName(string vin) =>
        $"telemetry-errors-{(string.IsNullOrEmpty(vin) ? "all" : vin)}.json";

    private static string BuildAutomationName(
        TelemetryErrorsPanelState state,
        string title,
        string idleMessage,
        string emptyMessage,
        string? errorText,
        int rowCount) => state switch
        {
            TelemetryErrorsPanelState.Idle => $"{title}. {idleMessage}",
            TelemetryErrorsPanelState.Loading => $"{title}. {LoadingAnnounce}",
            TelemetryErrorsPanelState.Error => $"{title}. {errorText}",
            TelemetryErrorsPanelState.Data => string.Create(
                CultureInfo.InvariantCulture, $"{title}. {rowCount}"),
            _ => $"{title}. {emptyMessage}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>TelemetryErrorsPanel</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a VIN, error code or error
/// message — so a diagnostics line can never leak which vehicle or fault was involved. Thread-safe.
/// </summary>
public sealed class TelemetryErrorsPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TelemetryErrorsPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TelemetryErrorsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TelemetryErrorsPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>TelemetryErrorsPanel</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx</c>.
/// </summary>
public static class TelemetryErrorsPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TelemetryErrorsPanel";
}
