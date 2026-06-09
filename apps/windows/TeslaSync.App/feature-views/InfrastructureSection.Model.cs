using System.Text.Encodings.Web;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Infrastructure;

/// <summary>
/// The five backend tools the Infrastructure section exposes — the native union of the cards the web
/// <c>InfrastructureSection</c> renders (web/src/features/admin/components/devtools/InfrastructureSection.tsx):
/// four read-only <c>BackendTool</c>s (Db Stats / Migrations / Env Check / Runtime) and the bespoke MQTT
/// publish tool. Each maps to one generated dev-tools operation.
/// </summary>
public enum InfrastructureToolKind
{
    /// <summary><c>GET /dev-tools/db-stats</c> — database table/row statistics.</summary>
    DbStats,

    /// <summary><c>GET /dev-tools/migration-status</c> — applied/pending schema migrations.</summary>
    Migrations,

    /// <summary><c>POST /dev-tools/mqtt-test</c> — publish a test message to an MQTT topic.</summary>
    MqttTest,

    /// <summary><c>GET /dev-tools/env-check</c> — required environment/configuration check.</summary>
    EnvCheck,

    /// <summary><c>GET /dev-tools/runtime-info</c> — Go runtime / build / resource info.</summary>
    Runtime,
}

/// <summary>
/// The mutually-exclusive lifecycle state of a single tool card. Every value maps onto a visible surface
/// (none is hidden), mirroring the web tool's <c>useMutation</c> lifecycle: idle (no result yet → the
/// ResultPanel's "No result yet"), running (the button's <c>loading</c> spinner), succeeded (the success
/// badge + the JSON ResultPanel), and the failure split the web collapses into <c>data.error</c> —
/// <see cref="Failed"/> for a server/in-band error and <see cref="Offline"/> for a transport/offline fault.
/// </summary>
public enum InfrastructureToolStatus
{
    /// <summary>No run has been requested yet — the idle ResultPanel ("No result yet").</summary>
    Idle,

    /// <summary>A run is in flight — the button shows a progress ring; any prior result stays visible (stale).</summary>
    Running,

    /// <summary>The run returned data with no error — the success badge + the JSON ResultPanel.</summary>
    Succeeded,

    /// <summary>The run reported an error (HTTP non-success, in-band <c>error</c>, or server fault).</summary>
    Failed,

    /// <summary>The run failed because the API could not be reached — the offline-flavoured error.</summary>
    Offline,
}

/// <summary>
/// Static, vehicle-agnostic metadata for one tool card — the native mirror of a web
/// <c>BackendTool</c>/<c>MqttTestTool</c> invocation (its icon, accent, title/description i18n and the
/// dev-tools endpoint it runs). Resolved against the generated endpoint table
/// (<c>TeslaSync.Windows.Generated.Api.ApiEndpoints</c>) by <see cref="OperationId"/>; the accent and glyph
/// are token/font keys the view resolves so this stays UI-free and unit-testable.
/// </summary>
public sealed record InfrastructureToolDescriptor(
    InfrastructureToolKind Kind,
    string OperationId,
    bool RequiresInput,
    string Glyph,
    string AccentBrushKey,
    string TitleKey,
    string TitleFallback,
    string DescriptionKey,
    string DescriptionFallback)
{
    /// <summary>The five tools, in the exact order the web section lays them out.</summary>
    public static IReadOnlyList<InfrastructureToolDescriptor> Catalog { get; } = new[]
    {
        new InfrastructureToolDescriptor(
            InfrastructureToolKind.DbStats,
            "get_api_v1_dev_tools_db_stats",
            RequiresInput: false,
            Glyph: "\uE9F5", // StorageOptical
            AccentBrushKey: "TsColorInfoBrush",
            TitleKey: "featureView.infrastructure.dbStats.title",
            TitleFallback: "Db Stats",
            DescriptionKey: "featureView.infrastructure.dbStats.desc",
            DescriptionFallback: "Database size, table counts and row statistics."),
        new InfrastructureToolDescriptor(
            InfrastructureToolKind.Migrations,
            "get_api_v1_dev_tools_migration_status",
            RequiresInput: false,
            Glyph: "\uE9D5", // Flow
            AccentBrushKey: "TsColorSuccessBrush",
            TitleKey: "featureView.infrastructure.migrations.title",
            TitleFallback: "Migrations",
            DescriptionKey: "featureView.infrastructure.migrations.desc",
            DescriptionFallback: "Applied and pending database schema migrations."),
        new InfrastructureToolDescriptor(
            InfrastructureToolKind.MqttTest,
            "post_api_v1_dev_tools_mqtt_test",
            RequiresInput: true,
            Glyph: "\uE704", // Streaming
            AccentBrushKey: "TsColorWarningBrush",
            TitleKey: "featureView.infrastructure.mqtt.title",
            TitleFallback: "Mqtt",
            DescriptionKey: "featureView.infrastructure.mqtt.desc",
            DescriptionFallback: "Publish a test message to an MQTT topic."),
        new InfrastructureToolDescriptor(
            InfrastructureToolKind.EnvCheck,
            "get_api_v1_dev_tools_env_check",
            RequiresInput: false,
            Glyph: "\uEA18", // Shield
            AccentBrushKey: "TsChartPowerBrush",
            TitleKey: "featureView.infrastructure.envCheck.title",
            TitleFallback: "Env Check",
            DescriptionKey: "featureView.infrastructure.envCheck.desc",
            DescriptionFallback: "Required environment variables and configuration."),
        new InfrastructureToolDescriptor(
            InfrastructureToolKind.Runtime,
            "get_api_v1_dev_tools_runtime_info",
            RequiresInput: false,
            Glyph: "\uEC4A", // Processor
            AccentBrushKey: "TsColorWarningBrush",
            TitleKey: "featureView.infrastructure.runtime.title",
            TitleFallback: "Runtime",
            DescriptionKey: "featureView.infrastructure.runtime.desc",
            DescriptionFallback: "Go runtime, build and resource information."),
    };

    /// <summary>Find the descriptor for a <see cref="InfrastructureToolKind"/> (throws if unknown).</summary>
    public static InfrastructureToolDescriptor For(InfrastructureToolKind kind) =>
        Catalog.First(d => d.Kind == kind);
}

/// <summary>
/// The result of running one tool — the native analogue of the web <c>mutation.data</c> shape, where a
/// fulfilled <c>useMutation</c> yields either the parsed JSON body or an <c>{ error }</c> envelope. A
/// success carries the raw <see cref="Value"/>; a failure carries a localized-ready
/// <see cref="ErrorMessage"/> and the <see cref="ErrorKind"/> classification so the view can pick the
/// failed-vs-offline surface.
/// </summary>
public sealed record InfrastructureToolOutcome(
    bool Succeeded,
    JsonElement? Value,
    string? ErrorMessage,
    RepositoryErrorKind? ErrorKind)
{
    /// <summary>A successful run carrying the parsed response body.</summary>
    public static InfrastructureToolOutcome Success(JsonElement value) =>
        new(true, value.Clone(), null, null);

    /// <summary>A failed run carrying a privacy-safe message and its classification.</summary>
    public static InfrastructureToolOutcome Failure(string message, RepositoryErrorKind kind) =>
        new(false, null, message, kind);
}

/// <summary>
/// Pure, UI-free projections shared by the tool view-models and the headless tests — the JSON
/// pretty-printer (the web <c>JSON.stringify(data, null, 2)</c>), the in-band <c>data.error</c> reader
/// (the web's <c>mutation.data.error</c> truthiness check), the offline classification and the Narrator
/// name builder. Kept here so the per-state composition is verified without a XAML runtime.
/// </summary>
public static class InfrastructureToolProjection
{
    private static readonly JsonSerializerOptions IndentedJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Pretty-print a JSON value with two-space indentation (web <c>JSON.stringify(data, null, 2)</c>).</summary>
    public static string PrettyJson(JsonElement value) => JsonSerializer.Serialize(value, IndentedJson);

    /// <summary>
    /// Reproduce the web's <c>mutation.data.error</c> check: a response object whose <c>error</c> field is
    /// truthy is treated as a failure. <paramref name="message"/> is the error string when <c>error</c> is a
    /// (non-empty) string, otherwise null — matching the web's
    /// <c>typeof data.error === 'string' ? data.error : undefined</c>.
    /// </summary>
    public static bool TryReadInbandError(JsonElement value, out string? message)
    {
        message = null;
        if (value.ValueKind != JsonValueKind.Object ||
            !value.TryGetProperty("error", out var error))
        {
            return false;
        }

        switch (error.ValueKind)
        {
            case JsonValueKind.String:
                var text = error.GetString();
                if (string.IsNullOrEmpty(text))
                {
                    return false;
                }

                message = text;
                return true;
            case JsonValueKind.True:
                return true;
            case JsonValueKind.Number:
                return error.TryGetDouble(out var n) && n != 0;
            case JsonValueKind.Object:
            case JsonValueKind.Array:
                return true;
            default:
                return false;
        }
    }

    /// <summary>True when a failure was a transport/offline fault (the offline-flavoured surface).</summary>
    public static bool IsOffline(RepositoryErrorKind kind) =>
        kind is RepositoryErrorKind.Network or RepositoryErrorKind.Offline;

    /// <summary>The status a fulfilled outcome resolves to (success / in-band-error / offline / failed).</summary>
    public static InfrastructureToolStatus StatusFor(InfrastructureToolOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        if (outcome.Succeeded && outcome.Value is { } value)
        {
            return TryReadInbandError(value, out _) ? InfrastructureToolStatus.Failed : InfrastructureToolStatus.Succeeded;
        }

        return outcome.ErrorKind is { } kind && IsOffline(kind)
            ? InfrastructureToolStatus.Offline
            : InfrastructureToolStatus.Failed;
    }

    /// <summary>
    /// The Narrator description for a tool card: the tool title plus a state phrase so the live region
    /// announces "Db Stats: success", "Mqtt: failed", etc. Never includes raw response bodies (PII-safe).
    /// </summary>
    public static string AutomationName(string title, InfrastructureToolStatus status, string statePhrase) =>
        $"{title}: {statePhrase}";
}
