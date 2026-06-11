using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ExportModal"/> view — the native port of the web
/// <c>ExportModal</c> component (web/src/features/dashboard/components/ExportModal.tsx). The web component is a
/// controlled, presentational modal: it receives the dashboard as a prop and derives, with <c>useMemo</c>, the
/// pretty JSON, the human byte size and the URL-safe base64 share link, then disables the share-copy action and
/// surfaces a warning once that link exceeds 2000 characters. There is no query, so the surface has no loading /
/// stale / offline / error branch — its only conditional surfaces are the URL-too-long warning and the disabled
/// share button, both reproduced here. This holder computes every derived value once from the immutable
/// snapshot (mirroring the web memoization), resolves every label through the i18n facade, formats the updated
/// date through the bound <see cref="IExportDateFormatter"/> (web <c>useDateFormat</c>), and routes the download
/// and dismiss actions back out as events (web <c>onDownload</c> / <c>onClose</c>) so the view is a thin renderer.
/// </summary>
public sealed class ExportModalViewModel
{
    private readonly ExportModalDiagnostics _diagnostics;

    /// <summary>Creates the holder over the dashboard prop, share origin, i18n facade, date formatter and diagnostics.</summary>
    /// <param name="dashboard">The dashboard to export (the web <c>dashboard</c> prop).</param>
    /// <param name="shareOrigin">The web app origin the share deep link targets (web <c>window.location.origin</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="dateFormatter">The date-formatting seam for the updated caption (web <c>useDateFormat</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public ExportModalViewModel(
        SavedDashboardSnapshot dashboard,
        string shareOrigin,
        ILocalizer localizer,
        IExportDateFormatter dateFormatter,
        ExportModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        ArgumentNullException.ThrowIfNull(shareOrigin);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(dateFormatter);

        Dashboard = dashboard;
        _diagnostics = diagnostics ?? new ExportModalDiagnostics();

        // The web component derives these with useMemo over the immutable dashboard prop; the snapshot here is
        // likewise immutable, so they are computed once at construction.
        DashboardJson = ExportModalProjection.SerializeDashboard(dashboard);
        JsonSizeLabel = ExportModalProjection.FormatJsonSize(ExportModalProjection.ByteSize(DashboardJson));
        ShareUrl = ExportModalProjection.BuildShareUrl(shareOrigin, dashboard);
        ShareUrlTooLong = ExportModalProjection.IsShareUrlTooLong(ShareUrl);
        MiniGrid = ExportModalProjection.BuildMiniGrid(dashboard);
        DownloadFileName = ExportModalProjection.ExportFileName(dashboard.Name);

        Title = ExportModalRegistration.Title(localizer);
        DashboardName = dashboard.Name;
        WidgetCountLabel = ExportModalRegistration.WidgetCountLabel(localizer, dashboard.WidgetCount);
        UpdatedLabel = ExportModalRegistration.UpdatedLabel(localizer, dateFormatter.FormatDate(dashboard.UpdatedAtInstant));
        DownloadLabel = ExportModalRegistration.DownloadLabel(localizer);
        CopyClipboardLabel = ExportModalRegistration.CopyClipboardLabel(localizer);
        CopyShareUrlLabel = ExportModalRegistration.CopyShareUrlLabel(localizer);
        CopiedLabel = ExportModalRegistration.CopiedLabel(localizer);
        UrlCopiedLabel = ExportModalRegistration.UrlCopiedLabel(localizer);
        CloseLabel = ExportModalRegistration.CloseLabel(localizer);

        // web: shareError = shareUrlTooLong ? t('export.urlTooLong', …, { size: shareUrl.length }) : null
        ShareErrorMessage = ShareUrlTooLong
            ? ExportModalRegistration.UrlTooLongLabel(localizer, ShareUrl.Length)
            : null;
    }

    /// <summary>Raised when the user picks "Download JSON File" (web <c>onDownload</c>): the host persists the JSON.</summary>
    public event EventHandler<ExportDownloadRequest>? DownloadRequested;

    /// <summary>Raised when the modal should close (web <c>onClose</c>): after a download or a dismiss.</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The dashboard being exported (the web <c>dashboard</c> prop).</summary>
    public SavedDashboardSnapshot Dashboard { get; }

    /// <summary>The diagnostics surface slug this view registers under.</summary>
    public static string Slug => ExportModalRegistration.Slug;

    // ── Header / labels (the Narrator-label source) ──────────────────────────────────────────────────────

    /// <summary>Modal title (web <c>export.title</c>).</summary>
    public string Title { get; }

    /// <summary>The dashboard name shown in the summary (web <c>dashboard.name</c>).</summary>
    public string DashboardName { get; }

    /// <summary>The widget-count badge label (web <c>export.widgetCount</c>).</summary>
    public string WidgetCountLabel { get; }

    /// <summary>The JSON-size badge label, e.g. "4.2 KB" (web <c>jsonSize</c>).</summary>
    public string JsonSizeLabel { get; }

    /// <summary>The "Updated {{date}}" caption (web <c>export.updated</c>).</summary>
    public string UpdatedLabel { get; }

    /// <summary>Download action label (web <c>export.downloadFile</c>).</summary>
    public string DownloadLabel { get; }

    /// <summary>Copy-to-clipboard action label (web <c>export.copyClipboard</c>).</summary>
    public string CopyClipboardLabel { get; }

    /// <summary>Copy-shareable-URL action label (web <c>export.copyShareUrl</c>).</summary>
    public string CopyShareUrlLabel { get; }

    /// <summary>Brief confirmation shown after copying the JSON (web <c>export.copied</c>).</summary>
    public string CopiedLabel { get; }

    /// <summary>Brief confirmation shown after copying the share URL (web <c>export.urlCopied</c>).</summary>
    public string UrlCopiedLabel { get; }

    /// <summary>Dialog dismiss label (web <c>Modal</c> close affordance).</summary>
    public string CloseLabel { get; }

    // ── Derived data (web useMemo) ───────────────────────────────────────────────────────────────────────

    /// <summary>The pretty-printed dashboard JSON (web <c>dashboardJson</c>): clipboard + download payload.</summary>
    public string DashboardJson { get; }

    /// <summary>The shareable deep link (web <c>shareUrl</c>).</summary>
    public string ShareUrl { get; }

    /// <summary>True once the share URL exceeds 2000 chars (web <c>shareUrlTooLong</c>): disables share copy.</summary>
    public bool ShareUrlTooLong { get; }

    /// <summary>True when the share-URL copy action is enabled (web <c>disabled={shareUrlTooLong}</c> inverse).</summary>
    public bool CanCopyShareUrl => !ShareUrlTooLong;

    /// <summary>True when the URL-too-long warning should render (web <c>shareError</c> present).</summary>
    public bool HasShareError => ShareErrorMessage is not null;

    /// <summary>The URL-too-long warning message, or <c>null</c> when the link fits (web <c>shareError</c>).</summary>
    public string? ShareErrorMessage { get; }

    /// <summary>The projected layout preview (web <c>MiniGridPreview</c>).</summary>
    public MiniGridModel MiniGrid { get; }

    /// <summary>The suggested download file name (web parent's download naming).</summary>
    public string DownloadFileName { get; }

    // ── Commands (web handleDownload / onClose) ──────────────────────────────────────────────────────────

    /// <summary>Record that the surface opened, emitting the <c>view.opened</c> diagnostic (web mount).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Initiate the download — the native analogue of the web <c>handleDownload</c>: it records the diagnostic
    /// and raises <see cref="DownloadRequested"/> so the host persists the JSON. The view then closes the modal
    /// (web <c>onDownload(); onClose();</c>).
    /// </summary>
    public void RequestDownload()
    {
        _diagnostics.RecordDashboardExported();
        DownloadRequested?.Invoke(this, new ExportDownloadRequest(DashboardJson, DownloadFileName));
    }

    /// <summary>Dismiss the modal (web <c>onClose</c>).</summary>
    public void RequestClose() => CloseRequested?.Invoke(this, EventArgs.Empty);
}
