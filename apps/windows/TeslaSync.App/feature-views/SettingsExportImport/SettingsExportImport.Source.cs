using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The settings-backup data port the <see cref="SettingsExportImportViewModel"/> binds to (P1/S8 state-holder
/// seam) — the native analogue of the web <c>useSettingsBackup</c> hook trio
/// (web/src/api/hooks/useSettingsBackup.ts). It exposes the export read (<c>GET /settings/export</c>), the
/// dry-run preview (<c>POST /settings/import { dry_run: true }</c>) and the apply mutation
/// (<c>POST /settings/import { dry_run: false }</c>). The view never performs HTTP itself; the concrete
/// <see cref="SettingsBackupSource"/> (or a test fake) drives this.
/// </summary>
public interface ISettingsBackupSource
{
    /// <summary>
    /// Fetch the exportable settings bundle (web <c>useExportSettings</c> → <c>GET /settings/export</c>),
    /// returning the JSON document in memory so the caller can both preview and write it to disk. Throws on a
    /// transport/HTTP failure so the caller can surface the error.
    /// </summary>
    /// <param name="cancellationToken">A token cancelling the in-flight request.</param>
    Task<JsonNode> ExportAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Run the dry-run preview for <paramref name="bundle"/> (web <c>useDryRunImport</c> →
    /// <c>POST /settings/import { dry_run: true }</c>), returning the per-section diff. Throws on failure.
    /// </summary>
    /// <param name="bundle">The validated bundle JSON, shipped verbatim as the <c>bundle</c> payload.</param>
    /// <param name="cancellationToken">A token cancelling the in-flight request.</param>
    Task<SettingsImportResult> PreviewImportAsync(JsonNode bundle, CancellationToken cancellationToken = default);

    /// <summary>
    /// Apply <paramref name="bundle"/> (web <c>useApplyImport</c> →
    /// <c>POST /settings/import { dry_run: false }</c>), returning the applied per-section diff. The route is
    /// gated by the backend's step-up middleware; a user-cancelled step-up surfaces as
    /// <see cref="SettingsImportStepUpCanceledException"/> so the caller can keep the preview visible. Throws on
    /// any other failure.
    /// </summary>
    /// <param name="bundle">The validated bundle JSON, shipped verbatim as the <c>bundle</c> payload.</param>
    /// <param name="cancellationToken">A token cancelling the in-flight request.</param>
    Task<SettingsImportResult> ApplyImportAsync(JsonNode bundle, CancellationToken cancellationToken = default);
}

/// <summary>
/// The sink that writes an exported bundle to the user's Downloads folder — the native analogue of the web
/// <c>downloadSettingsBundle</c> blob-download (web/src/api/hooks/useSettingsBackup.ts). Pulled out as a seam
/// so the export success path is unit-tested without touching the file system; the app wires the durable
/// <c>DownloadsFolder</c>-backed implementation (in the view file) and tests use
/// <see cref="InMemorySettingsBundleDownloader"/>.
/// </summary>
public interface ISettingsBundleDownloader
{
    /// <summary>
    /// Write <paramref name="json"/> to the Downloads folder under <paramref name="filename"/> (or a
    /// uniquified variant), returning the user-facing saved name. Throws on an I/O failure so the caller can
    /// surface the error.
    /// </summary>
    /// <param name="filename">The desired file name (the UTC-dated default unless overridden).</param>
    /// <param name="json">The pretty-printed bundle JSON to write.</param>
    /// <param name="cancellationToken">A token cancelling the write.</param>
    Task<string> SaveAsync(string filename, string json, CancellationToken cancellationToken = default);
}

/// <summary>
/// Raised when the user cancels the step-up (re-authentication) prompt the backend's RequireSudo middleware
/// demands for an apply — the native analogue of the web <c>SudoCanceledError</c>
/// (re-exported from <c>@/api/client</c>). The <see cref="SettingsExportImportViewModel"/> treats it as a
/// non-error and keeps the dry-run preview visible so the user can retry without re-uploading. Derives from
/// <see cref="OperationCanceledException"/> so generic cancellation handling still applies.
/// </summary>
public sealed class SettingsImportStepUpCanceledException : OperationCanceledException
{
    /// <summary>Creates the exception with a default message.</summary>
    public SettingsImportStepUpCanceledException()
        : base("The step-up re-authentication was cancelled.")
    {
    }

    /// <summary>Creates the exception with a custom <paramref name="message"/>.</summary>
    /// <param name="message">The message describing the cancellation.</param>
    public SettingsImportStepUpCanceledException(string message)
        : base(message)
    {
    }

    /// <summary>Creates the exception with a custom <paramref name="message"/> and <paramref name="innerException"/>.</summary>
    /// <param name="message">The message describing the cancellation.</param>
    /// <param name="innerException">The underlying cause.</param>
    public SettingsImportStepUpCanceledException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

/// <summary>
/// The contract-client-backed <see cref="ISettingsBackupSource"/> — the native data adapter for the
/// backup-and-restore surface. The export runs <c>GET /settings/export</c> through the generated
/// <c>get_api_v1_settings_export</c> operation and keeps the response as a detached <see cref="JsonNode"/>; the
/// dry-run and apply runs ship <c>{ dry_run, bundle }</c> through <c>post_api_v1_settings_import</c> and parse
/// the per-section diff. No HTTP touches the view.
/// </summary>
public sealed class SettingsBackupSource : ISettingsBackupSource
{
    /// <summary>The generated OpenAPI operation id for <c>GET /api/v1/settings/export</c>.</summary>
    public const string ExportOperation = "get_api_v1_settings_export";

    /// <summary>The generated OpenAPI operation id for <c>POST /api/v1/settings/import</c>.</summary>
    public const string ImportOperation = "post_api_v1_settings_import";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the shared contract client.</summary>
    /// <param name="api">The generated contract client used for every request.</param>
    public SettingsBackupSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<JsonNode> ExportAsync(CancellationToken cancellationToken = default)
    {
        var response = await _api.SendAsync<JsonElement>(new ApiRequest(ExportOperation), cancellationToken)
            .ConfigureAwait(false);
        return JsonNode.Parse(response.GetRawText()) ?? new JsonObject();
    }

    /// <inheritdoc />
    public Task<SettingsImportResult> PreviewImportAsync(JsonNode bundle, CancellationToken cancellationToken = default) =>
        SendImportAsync(bundle, dryRun: true, cancellationToken);

    /// <inheritdoc />
    public Task<SettingsImportResult> ApplyImportAsync(JsonNode bundle, CancellationToken cancellationToken = default) =>
        SendImportAsync(bundle, dryRun: false, cancellationToken);

    private async Task<SettingsImportResult> SendImportAsync(JsonNode bundle, bool dryRun, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(bundle);

        var body = new JsonObject
        {
            ["dry_run"] = dryRun,
            ["bundle"] = bundle.DeepClone(),
        };

        var response = await _api.SendAsync<JsonElement>(new ApiRequest(ImportOperation, Body: body), cancellationToken)
            .ConfigureAwait(false);
        return SettingsImportResult.FromJson(response);
    }
}

/// <summary>
/// An in-memory <see cref="ISettingsBackupSource"/> used by unit tests (and as a headless fallback). Each
/// operation returns its seeded result or throws its seeded exception, and records its invocation so a test can
/// assert the export / preview / apply calls and the bundle payloads. Not durable; the real app binds
/// <see cref="SettingsBackupSource"/>.
/// </summary>
public sealed class InMemorySettingsBackupSource : ISettingsBackupSource
{
    private readonly JsonNode _exportBundle;

    /// <summary>Creates the fake, optionally seeding the bundle the export returns (defaults to an empty object).</summary>
    /// <param name="exportBundle">The bundle <see cref="ExportAsync"/> returns; an empty object when omitted.</param>
    public InMemorySettingsBackupSource(JsonNode? exportBundle = null) =>
        _exportBundle = exportBundle ?? new JsonObject { ["schema_version"] = SettingsBundleConstants.SchemaVersion };

    /// <summary>The exception <see cref="ExportAsync"/> throws instead of returning, when set.</summary>
    public Exception? ExportError { get; set; }

    /// <summary>The result <see cref="PreviewImportAsync"/> returns (an empty diff when unset).</summary>
    public SettingsImportResult? PreviewResult { get; set; }

    /// <summary>The exception <see cref="PreviewImportAsync"/> throws instead of returning, when set.</summary>
    public Exception? PreviewError { get; set; }

    /// <summary>The result <see cref="ApplyImportAsync"/> returns (an empty diff when unset).</summary>
    public SettingsImportResult? ApplyResult { get; set; }

    /// <summary>The exception <see cref="ApplyImportAsync"/> throws instead of returning, when set.</summary>
    public Exception? ApplyError { get; set; }

    /// <summary>Number of times <see cref="ExportAsync"/> was invoked.</summary>
    public int ExportCount { get; private set; }

    /// <summary>The bundles passed to <see cref="PreviewImportAsync"/>, in call order.</summary>
    public List<JsonNode> PreviewedBundles { get; } = new();

    /// <summary>The bundles passed to <see cref="ApplyImportAsync"/>, in call order.</summary>
    public List<JsonNode> AppliedBundles { get; } = new();

    /// <inheritdoc />
    public Task<JsonNode> ExportAsync(CancellationToken cancellationToken = default)
    {
        ExportCount++;
        return ExportError is not null
            ? Task.FromException<JsonNode>(ExportError)
            : Task.FromResult(_exportBundle.DeepClone());
    }

    /// <inheritdoc />
    public Task<SettingsImportResult> PreviewImportAsync(JsonNode bundle, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(bundle);
        PreviewedBundles.Add(bundle);
        if (PreviewError is not null)
        {
            return Task.FromException<SettingsImportResult>(PreviewError);
        }

        return Task.FromResult(PreviewResult ?? EmptyResult(dryRun: true));
    }

    /// <inheritdoc />
    public Task<SettingsImportResult> ApplyImportAsync(JsonNode bundle, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(bundle);
        AppliedBundles.Add(bundle);
        if (ApplyError is not null)
        {
            return Task.FromException<SettingsImportResult>(ApplyError);
        }

        return Task.FromResult(ApplyResult ?? EmptyResult(dryRun: false));
    }

    private static SettingsImportResult EmptyResult(bool dryRun) =>
        new(dryRun, new Dictionary<string, SettingsImportSectionResult>(StringComparer.Ordinal));
}

/// <summary>
/// An in-memory <see cref="ISettingsBundleDownloader"/> used by unit tests (and as a headless fallback). It
/// records every save (filename + payload) so a test can assert the exported bundle was written, and can be set
/// to throw to exercise the export error path. Non-durable; the real app binds the
/// <c>DownloadsFolder</c>-backed downloader in the view.
/// </summary>
public sealed class InMemorySettingsBundleDownloader : ISettingsBundleDownloader
{
    /// <summary>The recorded saves, in call order (filename + written JSON).</summary>
    public List<(string Filename, string Json)> Saved { get; } = new();

    /// <summary>The exception <see cref="SaveAsync"/> throws instead of saving, when set.</summary>
    public Exception? SaveError { get; set; }

    /// <inheritdoc />
    public Task<string> SaveAsync(string filename, string json, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(filename);
        ArgumentNullException.ThrowIfNull(json);

        if (SaveError is not null)
        {
            return Task.FromException<string>(SaveError);
        }

        Saved.Add((filename, json));
        return Task.FromResult(filename);
    }
}
