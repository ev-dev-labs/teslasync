using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>GDPRExportPage</c> surface — the native mirror of the data states
/// the web page renders (web/src/features/admin/pages/GDPRExportPage.tsx). The page looks an export artifact up by id:
/// before an id is submitted (or while the subsystem is unconfigured) it shows the empty/lookup surface; a submitted id
/// polls (loading) and resolves to either the artifact panels (success) or a failure (error — the not-found 404 banner
/// or the generic surface). The HTTP-503 "subsystem not configured" case is a distinct banner that rides alongside the
/// empty state, exactly as the web <c>subsystemMissing</c> branch does.
/// </summary>
public enum GDPRExportState
{
    /// <summary>No artifact id submitted yet (web <c>!activeId</c>) — the "no artifact selected" empty surface shows.</summary>
    Empty,

    /// <summary>An id is submitted and the lookup is in flight with no artifact yet (web <c>query.isLoading</c>).</summary>
    Loading,

    /// <summary>The lookup failed — the 404 not-found banner (web <c>notFound</c>) or the generic failure surface.</summary>
    Error,

    /// <summary>The lookup resolved an artifact (web <c>artifact</c>) — the status/detail/download panels render.</summary>
    Success,
}

/// <summary>
/// One GDPR export artifact — the native record mirroring the web <c>GDPRExportArtifact</c>
/// (web/src/types/admin-operator-confidence.ts), read from <c>GET /admin/gdpr/exports/{id}</c>. Optional fields are
/// nullable exactly as the Go handler emits them (<c>internal/handler/v1/gdpr_export_handler.go</c>). Parsed losslessly
/// from the snake_case wire shape so the projection is the only place display rules live.
/// </summary>
public sealed record GDPRArtifact(
    string Id,
    string? UserId,
    string Status,
    string Format,
    long? Bytes,
    string? Sha256,
    string? Storage,
    string? DownloadUrl,
    string CreatedAt,
    string? CompletedAt,
    string? ExpiresAt,
    string? Error)
{
    /// <summary>Read one artifact from a JSON object, tolerating missing / null fields (web's optional shape).</summary>
    public static GDPRArtifact FromJson(JsonElement o)
    {
        return new GDPRArtifact(
            Id: JsonReadHelpers.Str(o, "id") ?? string.Empty,
            UserId: JsonReadHelpers.Str(o, "user_id"),
            Status: JsonReadHelpers.Str(o, "status") ?? string.Empty,
            Format: JsonReadHelpers.Str(o, "format") ?? string.Empty,
            Bytes: JsonReadHelpers.Long(o, "bytes"),
            Sha256: JsonReadHelpers.Str(o, "sha256"),
            Storage: JsonReadHelpers.Str(o, "storage"),
            DownloadUrl: JsonReadHelpers.Str(o, "download_url"),
            CreatedAt: JsonReadHelpers.Str(o, "created_at") ?? string.Empty,
            CompletedAt: JsonReadHelpers.Str(o, "completed_at"),
            ExpiresAt: JsonReadHelpers.Str(o, "expires_at"),
            Error: JsonReadHelpers.Str(o, "error"));
    }
}

/// <summary>
/// The render-time input model the <c>GDPRExportPage</c> projects from — the native analogue of the web page's
/// <c>idInput</c> / <c>activeId</c> URL state plus the resolved query result. Pure data so every branch is asserted
/// headlessly.
/// </summary>
public sealed record GDPRExportModel(
    string IdInput,
    string ActiveId,
    bool Loading,
    GDPRArtifact? Artifact,
    bool HasError,
    string? ErrorDetail,
    bool SubsystemMissing,
    bool NotFound)
{
    /// <summary>The initial state: no id submitted, nothing loading (the "no artifact selected" empty surface).</summary>
    public static GDPRExportModel Initial { get; } = new(
        IdInput: string.Empty,
        ActiveId: string.Empty,
        Loading: false,
        Artifact: null,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false,
        NotFound: false);
}

/// <summary>One label/value pair of artifact metadata (web <c>MetaRow</c>). Pure data.</summary>
public sealed record GDPRMetaRow(string Label, string Value, string? Relative, bool Copyable, bool Mono);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every byte count / timestamp formatted at the
/// display boundary. Holds the always-visible page header + lookup panel, the 503/404 banners, the empty surface, the
/// loading + generic-error surfaces and the artifact section (status badge + the format/size/storage stat tiles, the
/// metadata rows, the optional artifact-error banner and the download panel). Pure data so every branch is asserted
/// headlessly.
/// </summary>
public sealed record GDPRExportDisplay(
    GDPRExportState State,
    string Title,
    string Subtitle,
    string AutomationName,
    // ── Panel 1: lookup (web GlassPanel "Lookup artifact") ──
    string LookupTitle,
    string IdLabel,
    string IdPlaceholder, // parity:allow projected web input-hint placeholder string (admin.gdprExport.idPlaceholder)
    string IdValue,
    string LookupButtonLabel,
    bool LookupEnabled,
    string LookupHint,
    // ── 503 subsystem-unavailable banner (web subsystemMissing) ──
    bool ShowSubsystemUnavailable,
    string SubsystemTitle,
    string SubsystemMessage,
    // ── 404 not-found banner (web notFound) ──
    bool ShowNotFound,
    string NotFoundTitle,
    string NotFoundMessage,
    // ── Panel 2: empty "no artifact selected" (web !activeId GlassPanel) ──
    bool ShowEmpty,
    string EmptyTitle,
    string EmptyMessage,
    // ── Loading + generic error surfaces ──
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    // ── Artifact section (web artifact) ──
    bool ShowArtifact,
    // Panel 3: status badge
    string StatusLabel,
    string StatusText,
    StatusKind StatusVariant,
    // Format / Size / Storage stat tiles
    string FormatLabel,
    string FormatValue,
    string BytesLabel,
    string BytesValue,
    string StorageLabel,
    string StorageValue,
    // Panel 7: artifact details
    string MetaTitle,
    string IdRowLabel,
    string IdRowValue,
    IReadOnlyList<GDPRMetaRow> MetaRows,
    string CopyLabel,
    string CopiedLabel,
    // Artifact-error banner (web artifact.error)
    bool ShowArtifactError,
    string ArtifactErrorTitle,
    string ArtifactErrorText,
    // Panel 8: download
    string DownloadTitle,
    bool ShowDownloadButton,
    string DownloadHint,
    string DownloadButtonLabel,
    string DownloadUrl,
    string? DownloadLaunchUri,
    bool ShowDownloadCaption,
    string DownloadCaptionText);

/// <summary>
/// Pure projection from a <see cref="GDPRExportModel"/> to its <see cref="GDPRExportDisplay"/> — the native port of the
/// render logic in web/src/features/admin/pages/GDPRExportPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; byte counts format through the web <c>formatBytes</c> binary-unit rules and
/// timestamps through <see cref="DateTimeFormatting"/> (the web <c>formatDateTime</c> / <c>formatRelative</c>). Every
/// chrome string is resolved on every projection (visibility is gated by the returned flags), so the i18n contract
/// holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class GDPRExportProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    /// <summary>The web export statuses (web <c>GDPRArtifactStatus</c>).</summary>
    private const string StatusComplete = "complete";
    private const string StatusQueued = "queued";
    private const string StatusRunning = "running";
    private const string StatusExpired = "expired";

    /// <summary>Project the input model to its render-ready display, resolving every i18n key on every call.</summary>
    public static GDPRExportDisplay Project(GDPRExportModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("admin.gdprExport.pageTitle", "GDPR Export");
        string subtitle = localizer.GetString(
            "admin.gdprExport.subtitle",
            "Look up the status of a GDPR data export by artifact id and download the bundle when it completes. Bundles expire after the configured retention window.");

        // ── Panel 1: lookup (web GlassPanel "Lookup artifact") ──────────────────────────────────────────────
        string lookupTitle = localizer.GetString("admin.gdprExport.lookupTitle", "Lookup artifact");
        string idLabel = localizer.GetString("admin.gdprExport.idLabel", "Artifact ID");
        string idPlaceholder = localizer.GetString("admin.gdprExport.idPlaceholder", "e.g. 8f4c\u2026"); // parity:allow required web i18n key admin.gdprExport.idPlaceholder
        string lookupButton = localizer.GetString("admin.gdprExport.lookupButton", "Look up");
        string lookupHint = localizer.GetString(
            "admin.gdprExport.lookupHint",
            "IDs come from the GDPR export queue email or the request response. The artifact polls while queued/running.");

        // ── 503 subsystem-unavailable banner (web subsystemMissing AlertBanner) ─────────────────────────────
        string subsystemTitle = localizer.GetString("admin.subsystem.unavailableTitle", "Subsystem unavailable");
        string subsystemMessage = localizer.GetString(
            "admin.gdprExport.notConfigured",
            "GDPR export subsystem is not configured on this deployment.");

        // ── 404 not-found banner (web notFound AlertBanner) ─────────────────────────────────────────────────
        string notFoundTitle = localizer.GetString("admin.gdprExport.notFoundTitle", "Artifact not found");
        string notFoundMessage = localizer.GetString(
            "admin.gdprExport.notFoundMessage",
            "No artifact with that id exists, or it has been purged. Check the id and try again.");

        // ── Panel 2: empty "no artifact selected" (web !activeId GlassPanel) ────────────────────────────────
        string emptyTitle = localizer.GetString("admin.gdprExport.emptyTitle", "No artifact selected");
        string emptyMessage = localizer.GetString(
            "admin.gdprExport.emptyMessage",
            "Enter an artifact ID above to look up its status. The page will keep refreshing until the export completes.");

        // ── Loading + generic-error surfaces (web PageContainer query state) ────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Panel 3 + stat tiles (web Status badge + StatCard format/size/storage) ──────────────────────────
        string statusLabel = localizer.GetString("admin.gdprExport.statusLabel", "Status");
        string formatLabel = localizer.GetString("admin.gdprExport.formatLabel", "Format");
        string bytesLabel = localizer.GetString("admin.gdprExport.bytesLabel", "Size");
        string storageLabel = localizer.GetString("admin.gdprExport.storageLabel", "Storage");

        // ── Panel 7: artifact details (web GlassPanel "Artifact details") ───────────────────────────────────
        string metaTitle = localizer.GetString("admin.gdprExport.metaTitle", "Artifact details");
        string metaIdLabel = localizer.GetString("admin.gdprExport.metaId", "ID");
        string metaUserLabel = localizer.GetString("admin.gdprExport.metaUser", "User");
        string metaCreatedLabel = localizer.GetString("admin.gdprExport.metaCreated", "Created");
        string metaCompletedLabel = localizer.GetString("admin.gdprExport.metaCompleted", "Completed");
        string metaExpiresLabel = localizer.GetString("admin.gdprExport.metaExpires", "Expires");
        string metaShaLabel = localizer.GetString("admin.gdprExport.metaSha256", "SHA-256");
        string copyLabel = localizer.GetString("common.copy", "Copy");
        string copiedLabel = localizer.GetString("common.copied", "Copied");

        // ── Artifact-error banner (web artifact.error AlertBanner) ──────────────────────────────────────────
        string artifactErrorTitle = localizer.GetString("admin.gdprExport.errorTitle", "Export failed");

        // ── Panel 8: download (web GlassPanel "Download") ───────────────────────────────────────────────────
        string downloadTitle = localizer.GetString("admin.gdprExport.downloadTitle", "Download");
        string downloadHint = localizer.GetString(
            "admin.gdprExport.downloadHint",
            "The bundle streams from the backend through this browser. The download counter is logged to the audit ledger.");
        string downloadButton = localizer.GetString("admin.gdprExport.downloadButton", "Download bundle");
        string downloadWait = localizer.GetString("admin.gdprExport.downloadWait", "Download becomes available once the export completes.");
        string downloadExpired = localizer.GetString("admin.gdprExport.downloadExpired", "This artifact has expired and is no longer downloadable.");
        string downloadFailed = localizer.GetString("admin.gdprExport.downloadFailed", "No bundle available \u2014 see the error above.");

        // ── State derivation (web render gates) ─────────────────────────────────────────────────────────────
        bool hasActiveId = !string.IsNullOrEmpty(model.ActiveId);
        var artifact = model.Artifact;
        bool showArtifact = artifact is not null;
        bool subsystem = model.SubsystemMissing && !showArtifact;
        bool notFound = model.NotFound && hasActiveId && !showArtifact;
        bool genericError = model.HasError && !showArtifact;
        bool loading = model.Loading && !showArtifact && !genericError && !notFound && !subsystem;
        bool showEmpty = !hasActiveId; // web renders the empty panel only before an id is submitted

        GDPRExportState state =
            showArtifact ? GDPRExportState.Success :
            loading ? GDPRExportState.Loading :
            (genericError || notFound) ? GDPRExportState.Error :
            GDPRExportState.Empty;

        string errorText = genericError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Artifact-derived display (web artifact panels) ──────────────────────────────────────────────────
        string statusText = artifact is null || string.IsNullOrEmpty(artifact.Status) ? EmDash : artifact.Status;
        StatusKind statusVariant = StatusVariantFor(artifact?.Status);
        string formatValue = string.IsNullOrEmpty(artifact?.Format) ? EmDash : artifact!.Format;
        string bytesValue = FormatBytes(artifact?.Bytes);
        string storageValue = string.IsNullOrEmpty(artifact?.Storage) ? EmDash : artifact!.Storage;
        string idRowValue = artifact?.Id ?? EmDash;

        var metaRows = BuildMetaRows(
            artifact,
            now,
            metaUserLabel,
            metaCreatedLabel,
            metaCompletedLabel,
            metaExpiresLabel,
            metaShaLabel);

        bool showArtifactError = !string.IsNullOrEmpty(artifact?.Error);
        string artifactErrorText = artifact?.Error ?? string.Empty;

        bool isComplete = string.Equals(artifact?.Status, StatusComplete, StringComparison.Ordinal);
        string downloadUrl = artifact is null
            ? string.Empty
            : $"/api/v1/admin/gdpr/exports/{Uri.EscapeDataString(artifact.Id)}/download";
        string? launchUri = ResolveLaunchUri(artifact, isComplete);
        string downloadCaption = !isComplete && artifact is not null
            ? artifact.Status switch
            {
                StatusQueued or StatusRunning => downloadWait,
                StatusExpired => downloadExpired,
                _ => downloadFailed,
            }
            : string.Empty;

        return new GDPRExportDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            LookupTitle: lookupTitle,
            IdLabel: idLabel,
            IdPlaceholder: idPlaceholder, // parity:allow projected web input-hint placeholder string (admin.gdprExport.idPlaceholder)
            IdValue: model.IdInput,
            LookupButtonLabel: lookupButton,
            LookupEnabled: !string.IsNullOrWhiteSpace(model.IdInput),
            LookupHint: lookupHint,
            ShowSubsystemUnavailable: subsystem,
            SubsystemTitle: subsystemTitle,
            SubsystemMessage: subsystemMessage,
            ShowNotFound: notFound,
            NotFoundTitle: notFoundTitle,
            NotFoundMessage: notFoundMessage,
            ShowEmpty: showEmpty,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            ShowLoading: loading,
            LoadingText: loadingText,
            ShowError: genericError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowArtifact: showArtifact,
            StatusLabel: statusLabel,
            StatusText: statusText,
            StatusVariant: statusVariant,
            FormatLabel: formatLabel,
            FormatValue: formatValue,
            BytesLabel: bytesLabel,
            BytesValue: bytesValue,
            StorageLabel: storageLabel,
            StorageValue: storageValue,
            MetaTitle: metaTitle,
            IdRowLabel: metaIdLabel,
            IdRowValue: idRowValue,
            MetaRows: metaRows,
            CopyLabel: copyLabel,
            CopiedLabel: copiedLabel,
            ShowArtifactError: showArtifactError,
            ArtifactErrorTitle: artifactErrorTitle,
            ArtifactErrorText: artifactErrorText,
            DownloadTitle: downloadTitle,
            ShowDownloadButton: isComplete,
            DownloadHint: downloadHint,
            DownloadButtonLabel: downloadButton,
            DownloadUrl: downloadUrl,
            DownloadLaunchUri: launchUri,
            ShowDownloadCaption: !isComplete && artifact is not null,
            DownloadCaptionText: downloadCaption);
    }

    /// <summary>Map an artifact status to its badge variant (web <c>STATUS_VARIANT</c>).</summary>
    public static StatusKind StatusVariantFor(string? status) => status switch
    {
        StatusQueued => StatusKind.Info,
        StatusRunning => StatusKind.Info,
        StatusComplete => StatusKind.Success,
        "failed" => StatusKind.Danger,
        StatusExpired => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>Format a byte count with binary units (1:1 port of web <c>formatBytes</c>); em-dash when null.</summary>
    public static string FormatBytes(long? bytes)
    {
        if (bytes is not { } b)
        {
            return EmDash;
        }

        if (b < 1024)
        {
            return $"{b.ToString(Inv)} B";
        }

        if (b < 1024L * 1024)
        {
            return $"{(b / 1024.0).ToString("0.0", Inv)} KB";
        }

        if (b < 1024L * 1024 * 1024)
        {
            return $"{(b / (1024.0 * 1024)).ToString("0.0", Inv)} MB";
        }

        return $"{(b / (1024.0 * 1024 * 1024)).ToString("0.0", Inv)} GB";
    }

    /// <summary>Format an absolute timestamp (web <c>formatDateTime</c>); em-dash for unparseable input.</summary>
    public static string FormatTimestamp(string? raw, DateTimeOffset now) =>
        DateTimeFormatting.Format(ParseTs(raw), DateTimeVariant.Full, now);

    /// <summary>Format a relative timestamp (web <c>formatRelative</c>); em-dash for unparseable input.</summary>
    public static string FormatRelative(string? raw, DateTimeOffset now) =>
        DateTimeFormatting.Format(ParseTs(raw), DateTimeVariant.Relative, now);

    private static List<GDPRMetaRow> BuildMetaRows(
        GDPRArtifact? artifact,
        DateTimeOffset now,
        string userLabel,
        string createdLabel,
        string completedLabel,
        string expiresLabel,
        string shaLabel)
    {
        var rows = new List<GDPRMetaRow>(5);
        if (artifact is null)
        {
            return rows;
        }

        if (!string.IsNullOrEmpty(artifact.UserId))
        {
            rows.Add(new GDPRMetaRow(userLabel, artifact.UserId, null, Copyable: false, Mono: false));
        }

        rows.Add(new GDPRMetaRow(
            createdLabel,
            FormatTimestamp(artifact.CreatedAt, now),
            FormatRelative(artifact.CreatedAt, now),
            Copyable: false,
            Mono: false));

        if (!string.IsNullOrEmpty(artifact.CompletedAt))
        {
            rows.Add(new GDPRMetaRow(
                completedLabel,
                FormatTimestamp(artifact.CompletedAt, now),
                FormatRelative(artifact.CompletedAt, now),
                Copyable: false,
                Mono: false));
        }

        if (!string.IsNullOrEmpty(artifact.ExpiresAt))
        {
            rows.Add(new GDPRMetaRow(
                expiresLabel,
                FormatTimestamp(artifact.ExpiresAt, now),
                FormatRelative(artifact.ExpiresAt, now),
                Copyable: false,
                Mono: false));
        }

        if (!string.IsNullOrEmpty(artifact.Sha256))
        {
            rows.Add(new GDPRMetaRow(shaLabel, artifact.Sha256, null, Copyable: true, Mono: true));
        }

        return rows;
    }

    // web: downloadUrl is used as an <a href> resolved against the current origin. Native has no implicit origin, so we
    // launch the artifact's server-supplied absolute download_url when the export is complete; the conventional
    // /api/v1 path is still surfaced for parity/automation.
    private static string? ResolveLaunchUri(GDPRArtifact? artifact, bool isComplete)
    {
        if (!isComplete || string.IsNullOrEmpty(artifact?.DownloadUrl))
        {
            return null;
        }

        return Uri.TryCreate(artifact.DownloadUrl, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
            ? uri.ToString()
            : null;
    }

    private static DateTimeOffset? ParseTs(string? raw)
    {
        if (!string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
                raw,
                Inv,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var value))
        {
            return value;
        }

        return null;
    }
}

/// <summary>
/// The data port the <see cref="GDPRExportPageViewModel"/> reads the export artifact through — the native parity of the
/// web <c>useGDPRExport</c> hook. The view never touches HTTP; a non-success response surfaces as the generated client's
/// <see cref="TeslaSync.App.Core.Data.Net.ApiException"/> so the view-model can distinguish the 503 subsystem-missing
/// and 404 not-found branches.
/// </summary>
public interface IGDPRExportFeed
{
    /// <summary>Fetch the metadata for a single artifact by id (web <c>GET /admin/gdpr/exports/{id}</c>).</summary>
    Task<GDPRArtifact?> FetchAsync(string id, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every lookup to "not found" (the empty / unconfigured-shell data state).</summary>
public sealed class EmptyGDPRExportFeed : IGDPRExportFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGDPRExportFeed Instance { get; } = new();

    private EmptyGDPRExportFeed()
    {
    }

    /// <inheritdoc />
    public Task<GDPRArtifact?> FetchAsync(string id, CancellationToken cancellationToken) =>
        Task.FromResult<GDPRArtifact?>(null);
}

/// <summary>
/// Canonical metadata for the <c>GDPRExportPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/admin/pages/GDPRExportPage.tsx</c> (route <c>/admin/gdpr-exports</c>, nav name <c>GDPRExport</c>).
/// </summary>
public static class GDPRExportRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GDPRExportPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>GDPRExport</c>).</summary>
    public const string RouteName = "GDPRExport";

    /// <summary>The generated OpenAPI operation id for the artifact lookup (web <c>useGDPRExport</c>).</summary>
    public const string FetchOperation = "get_api_v1_admin_gdpr_exports_id";

    /// <summary>The generated OpenAPI operation id for the binary bundle stream (web download href).</summary>
    public const string DownloadOperation = "get_api_v1_admin_gdpr_exports_id_download";

    /// <summary>The localized page title (web <c>admin.gdprExport.pageTitle</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("admin.gdprExport.pageTitle", "GDPR Export");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>GDPRExportPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an artifact id, user id or SHA — so a diagnostics
/// line can never leak export content. Thread-safe.
/// </summary>
public sealed class GDPRExportDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GDPRExportDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GDPRExportPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GDPRExportRegistration.Slug}");
    }
}
