using System.Globalization;
using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// Every visible literal the <c>DataExportPage</c> resolves, pre-localized once per projection — the native parity of
/// the web page's <c>t(...)</c> call sites (web/src/features/system/pages/DataExportPage.tsx). Resolving the whole set
/// on every projection (regardless of data state) keeps the i18n contract holding in the loading / empty / error /
/// success branches alike, and lets the headless tests assert each web key name is requested.
/// </summary>
public sealed record DataExportStrings(
    string Title,
    string Subtitle,
    string Refresh,
    string ErrorLoadFailed,
    string TotalExports,
    string TotalSize,
    string MostExported,
    string ByCount,
    string LastExport,
    string AccountTitle,
    string AccountSubtitle,
    string AccountVehicle,
    string AccountAllVehicles,
    string AccountStartDate,
    string AccountEndDate,
    string AccountWarning,
    string AccountStart,
    string WizardTitle,
    string Step1,
    string Step2,
    string Step3,
    string Step4,
    string AllVehiclesBare,
    string AllVehicles,
    string CustomRange,
    string StartExport,
    string Start,
    string End,
    string ColumnsTitle,
    string ColumnsHelper,
    string ColumnsSelectAll,
    string ColumnsClear,
    string ColumnsAlwaysIncluded,
    string CsvPreview,
    string CsvDesc,
    string JsonPreview,
    string JsonDesc,
    string DataOverview,
    string Drives,
    string ChargingSessions,
    string Unavailable,
    string ExportHistory,
    string Active,
    string NoExports,
    string NoExportsMessage,
    string NoJobs,
    string Download,
    string TypeHeader,
    string FormatHeader,
    string StatusHeader,
    string VehicleHeader,
    string RecordsHeader,
    string SizeHeader,
    string DurationHeader,
    string TimeHeader,
    string ScheduledFeature,
    string ExportStarted,
    string ExportStartedMsg,
    string ExportFailed,
    string ExportFailedMsg)
{
    /// <summary>Resolve every label through the i18n facade using the exact web key names.</summary>
    public static DataExportStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new DataExportStrings(
            Title: localizer.GetString("dataExport.title", "Data Export"),
            Subtitle: localizer.GetString("dataExport.subtitle", "Export vehicle data in CSV or JSON format"),
            Refresh: localizer.GetString("dataExport.refresh", "Refresh"),
            ErrorLoadFailed: localizer.GetString("error.loadFailed", "Failed to load data"),
            TotalExports: localizer.GetString("Total Exports", "Total Exports"),
            TotalSize: localizer.GetString("Total Size", "Total Size"),
            MostExported: localizer.GetString("Most Exported", "Most Exported"),
            ByCount: localizer.GetString("By Count", "By Count"),
            LastExport: localizer.GetString("Last Export", "Last Export"),
            AccountTitle: localizer.GetString("dataExport.account.title", "Download my data"),
            AccountSubtitle: localizer.GetString(
                "dataExport.account.subtitle",
                "Get a single ZIP containing every table we store for you — drives, charging, signal history, alerts, settings, and a manifest. Use this for backup, migration, or your personal records."),
            AccountVehicle: localizer.GetString("dataExport.account.vehicle", "Vehicle"),
            AccountAllVehicles: localizer.GetString("dataExport.account.allVehicles", "All vehicles"),
            AccountStartDate: localizer.GetString("dataExport.account.startDate", "Start date (optional)"),
            AccountEndDate: localizer.GetString("dataExport.account.endDate", "End date (optional)"),
            AccountWarning: localizer.GetString(
                "dataExport.account.warning",
                "Large signal histories are capped per table to keep the ZIP under control. Track progress in the floating widget that appears once your export starts."),
            AccountStart: localizer.GetString("dataExport.account.start", "Start full export"),
            WizardTitle: localizer.GetString("dataExport.wizardTitle", "New Export"),
            Step1: localizer.GetString("dataExport.wizard.step1", "STEP 1 — Select Data Type"),
            Step2: localizer.GetString("dataExport.wizard.step2", "STEP 2 — Choose Format"),
            Step3: localizer.GetString("dataExport.wizard.step3", "STEP 3 — Select Vehicle"),
            Step4: localizer.GetString("dataExport.wizard.step4", "STEP 4 — Date Range"),
            AllVehiclesBare: localizer.GetString("All Vehicles", "All Vehicles"),
            AllVehicles: localizer.GetString("dataExport.allVehicles", "All Vehicles"),
            CustomRange: localizer.GetString("dataExport.customRange", "Custom Range"),
            StartExport: localizer.GetString("Start Export", "Start Export"),
            Start: localizer.GetString("Start", "Start"),
            End: localizer.GetString("End", "End"),
            ColumnsTitle: localizer.GetString("dataExport.columns.title", "STEP 2½ — Columns"),
            ColumnsHelper: localizer.GetString(
                "dataExport.columns.helperText",
                "Select which columns to include in the export. Required columns cannot be removed."),
            ColumnsSelectAll: localizer.GetString("dataExport.columns.selectAll", "Select all"),
            ColumnsClear: localizer.GetString("dataExport.columns.clear", "Clear"),
            ColumnsAlwaysIncluded: localizer.GetString("dataExport.columns.alwaysIncluded", "Required"),
            CsvPreview: localizer.GetString("dataExport.csvPreview", "CSV Preview"),
            CsvDesc: localizer.GetString(
                "dataExport.csvDesc",
                "Comma-separated values, compatible with Excel and Google Sheets"),
            JsonPreview: localizer.GetString("dataExport.jsonPreview", "JSON Preview"),
            JsonDesc: localizer.GetString("dataExport.jsonDesc", "Structured JSON format for programmatic access"),
            DataOverview: localizer.GetString("dataExport.dataOverview", "Data Overview"),
            Drives: localizer.GetString("dataExport.drives", "Drives"),
            ChargingSessions: localizer.GetString("dataExport.chargingSessions", "Charging Sessions"),
            Unavailable: localizer.GetString("dataExport.unavailable", "Unavailable"),
            ExportHistory: localizer.GetString("dataExport.exportHistory", "Export History"),
            Active: localizer.GetString("dataExport.active", "Active"),
            NoExports: localizer.GetString("dataExport.noExports", "No Exports Yet"),
            NoExportsMessage: localizer.GetString(
                "dataExport.noExportsMessage",
                "Create your first export above to get started."),
            NoJobs: localizer.GetString("dataExport.noJobs", "No export jobs"),
            Download: localizer.GetString("Download", "Download"),
            TypeHeader: localizer.GetString("Type", "Type"),
            FormatHeader: localizer.GetString("Format", "Format"),
            StatusHeader: localizer.GetString("Status", "Status"),
            VehicleHeader: localizer.GetString("Vehicle", "Vehicle"),
            RecordsHeader: localizer.GetString("Records", "Records"),
            SizeHeader: localizer.GetString("Size", "Size"),
            DurationHeader: localizer.GetString("Duration", "Duration"),
            TimeHeader: localizer.GetString("Time", "Time"),
            ScheduledFeature: localizer.GetString("dataExport.scheduled.feature", "Scheduled exports"),
            ExportStarted: localizer.GetString("Export Started", "Export Started"),
            ExportStartedMsg: localizer.GetString("Export Started Msg", "Export Started Msg"),
            ExportFailed: localizer.GetString("Export Failed", "Export Failed"),
            ExportFailedMsg: localizer.GetString("Export Failed Msg", "Export Failed Msg"));
    }
}

/// <summary>One headline stat tile (web <c>StatsRow</c> <c>MetricCard</c>): label, pre-formatted value, optional sublabel and accent glyph.</summary>
public sealed record StatTileDisplay(string Key, string Label, string Value, string? Sublabel, string Glyph);

/// <summary>One export-type tile (web <c>ExportTypeSelector</c>): localized label/description, glyph, badge colour and the selected flag.</summary>
public sealed record ExportTypeOptionDisplay(
    string Value,
    string Label,
    string Description,
    string Glyph,
    StatusKind Badge,
    bool Selected);

/// <summary>One export-format choice (web <c>FormatSelector</c>): localized label, glyph and the selected flag.</summary>
public sealed record FormatOptionDisplay(string Value, string Label, string Glyph, bool Selected);

/// <summary>One date preset (web <c>DatePresetSelector</c>): localized label, day span and the selected flag.</summary>
public sealed record DatePresetOptionDisplay(string Label, int Days, bool Selected);

/// <summary>One drop-down option (web <c>Select.options</c>): the submit value and its localized label.</summary>
public sealed record SelectOptionDisplay(string Value, string Label);

/// <summary>One column-picker row (web <c>ColumnPickerSection</c> label): the column, its checked / required state and the localized label.</summary>
public sealed record ColumnRowDisplay(string Name, string Label, bool Checked, bool Required);

/// <summary>
/// The wizard's render-ready projection (web <c>ExportWizard</c>, panels GlassPanel9 + GlassPanel1): the step copy, the
/// type / format catalogs, the column picker state, the vehicle step, the date presets / custom range and the submit
/// affordance.
/// </summary>
public sealed record WizardDisplay(
    string Title,
    string Step1Label,
    string Step2Label,
    string Step3Label,
    string Step4Label,
    IReadOnlyList<ExportTypeOptionDisplay> Types,
    IReadOnlyList<FormatOptionDisplay> Formats,
    bool ShowColumnPicker,
    bool ColumnsLoading,
    string ColumnsTitle,
    string ColumnsHelper,
    string ColumnsSelectAllLabel,
    string ColumnsClearLabel,
    string ColumnsRequiredLabel,
    bool ColumnsAllSelected,
    IReadOnlyList<ColumnRowDisplay> ColumnRows,
    bool ShowVehicleStep,
    string VehiclePrompt,
    IReadOnlyList<SelectOptionDisplay> VehicleOptions,
    string SelectedVehicleId,
    IReadOnlyList<DatePresetOptionDisplay> Presets,
    string CustomRangeLabel,
    bool CustomRangeActive,
    string StartLabel,
    string EndLabel,
    string CustomStart,
    string CustomEnd,
    string SubmitLabel,
    bool SubmitBusy);

/// <summary>One format preview card (web <c>FormatInfoCards</c>, panels GlassPanel2 / GlassPanel3): title, description and the monospace sample lines.</summary>
public sealed record FormatInfoCardDisplay(string Title, string Description, IReadOnlyList<string> SampleLines, GlassGlowKind Glow, string Glyph);

/// <summary>The accent glow a format preview / wizard card requests (mapped to the W2 design tokens at the view boundary).</summary>
public enum GlassGlowKind
{
    /// <summary>No accent glow.</summary>
    None,

    /// <summary>Cyan accent (web <c>glow="cyan"</c>).</summary>
    Cyan,

    /// <summary>Purple accent (web <c>glow="purple"</c>).</summary>
    Purple,
}

/// <summary>The data-overview card projection (web <c>DataOverviewCard</c>, panel GlassPanel4): the loading flag plus the drives / charging counts or the unavailable note.</summary>
public sealed record OverviewDisplay(
    string Title,
    bool Loading,
    bool HasData,
    string DrivesValue,
    string DrivesLabel,
    string ChargingValue,
    string ChargingLabel,
    string UnavailableText);

/// <summary>One export-history row (web <c>ExportHistoryTable</c> row): the formatted, localized cells plus the row's download affordance and any failure detail.</summary>
public sealed record HistoryRowDisplay(
    string Id,
    string TypeLabel,
    StatusKind TypeBadge,
    string Format,
    string FormatUpper,
    StatusKind FormatBadge,
    string StatusLabel,
    StatusKind StatusBadge,
    string StatusGlyph,
    string Vehicle,
    string Records,
    string Size,
    string Duration,
    string Time,
    bool CanDownload,
    string DownloadLabel,
    string DownloadPath,
    Uri? DownloadUri,
    bool HasError,
    string ErrorMessage);

/// <summary>
/// The export-history projection (web <c>ExportHistoryTable</c>, panels GlassPanel10 loading / GlassPanel11 table): the
/// header chrome, the active-jobs badge, the column headers, the projected rows and the empty / loading flags.
/// </summary>
public sealed record HistoryDisplay(
    string Title,
    string RefreshLabel,
    bool Loading,
    bool ShowActiveBadge,
    string ActiveLabel,
    int ActiveCount,
    IReadOnlyList<string> ColumnHeaders,
    string DownloadHeader,
    IReadOnlyList<HistoryRowDisplay> Rows,
    bool ShowEmpty,
    string EmptyGlyph,
    string EmptyTitle,
    string EmptyMessage,
    string NoJobsText);

/// <summary>The "Download my data" projection (web <c>AccountExportPanel</c>, panel GlassPanel12): the copy, the vehicle / date controls and the submit affordance.</summary>
public sealed record AccountPanelDisplay(
    string Title,
    string Subtitle,
    string VehicleLabel,
    IReadOnlyList<SelectOptionDisplay> VehicleOptions,
    string SelectedVehicleId,
    string StartDateLabel,
    string EndDateLabel,
    string Start,
    string End,
    string Warning,
    string StartLabel,
    bool Busy);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade. Holds the always-visible page header, the four
/// data-state flags, the four stat tiles, the account / wizard / format-info / overview / history sub-displays and the
/// toast copy. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record DataExportDisplay(
    DataExportState State,
    DataExportStrings Strings,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowSuccess,
    string ErrorText,
    string RetryLabel,
    bool StatsLoading,
    IReadOnlyList<StatTileDisplay> StatTiles,
    AccountPanelDisplay Account,
    WizardDisplay Wizard,
    FormatInfoCardDisplay CsvCard,
    FormatInfoCardDisplay JsonCard,
    OverviewDisplay Overview,
    HistoryDisplay History,
    string ScheduledFeatureLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="DataExportModel"/> to its <see cref="DataExportDisplay"/> — the native port of the
/// render logic in web/src/features/system/pages/DataExportPage.tsx. Every visible literal resolves through the i18n
/// facade using the exact web key names; the chrome strings are resolved on every projection so the i18n contract holds
/// in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class DataExportProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literal.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    public static DataExportDisplay Project(DataExportModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = DataExportStrings.Resolve(localizer);

        // ── Top-level data state (loading → error → empty → success), mirroring the web PageContainer precedence. ──
        bool loading = model.JobsLoading;
        var state =
            loading ? DataExportState.Loading :
            model.HasError ? DataExportState.Error :
            model.Jobs.Count == 0 ? DataExportState.Empty :
            DataExportState.Success;

        string errorText = string.IsNullOrEmpty(model.ErrorDetail)
            ? s.ErrorLoadFailed
            : $"{s.ErrorLoadFailed}: {model.ErrorDetail}";

        return new DataExportDisplay(
            State: state,
            Strings: s,
            ShowLoading: state == DataExportState.Loading,
            ShowError: state == DataExportState.Error,
            ShowEmpty: state == DataExportState.Empty,
            ShowSuccess: state == DataExportState.Success,
            ErrorText: errorText,
            RetryLabel: s.Refresh,
            StatsLoading: model.JobsLoading,
            StatTiles: BuildStatTiles(model, s),
            Account: BuildAccount(model, s),
            Wizard: BuildWizard(model, s, localizer),
            CsvCard: new FormatInfoCardDisplay(
                s.CsvPreview,
                s.CsvDesc,
                ["date,distance_m,efficiency_wh_per_m", "2025-01-15,45200,0.152", "2025-01-16,32800,0.148"],
                GlassGlowKind.Cyan,
                "\uE9F9"),
            JsonCard: new FormatInfoCardDisplay(
                s.JsonPreview,
                s.JsonDesc,
                ["[{ \"date\": \"2025-01-15\",", "   \"distance_m\": 45200,", "   \"efficiency\": 152 }]"],
                GlassGlowKind.Purple,
                "\uE943"),
            Overview: BuildOverview(model, s),
            History: BuildHistory(model, s, localizer),
            ScheduledFeatureLabel: s.ScheduledFeature,
            AutomationName: s.Title);
    }

    private static IReadOnlyList<StatTileDisplay> BuildStatTiles(DataExportModel model, DataExportStrings s)
    {
        var jobs = model.Jobs;
        int totalExports = jobs.Count;
        long totalSize = jobs.Sum(j => j.FileSize ?? 0);

        string most = EmDash;
        if (jobs.Count > 0)
        {
            var top = jobs
                .GroupBy(j => j.Type, StringComparer.Ordinal)
                .OrderByDescending(g => g.Count())
                .ThenBy(g => g.Key, StringComparer.Ordinal)
                .FirstOrDefault();
            if (top is not null && !string.IsNullOrEmpty(top.Key))
            {
                most = top.Key.Replace('_', ' ');
            }
        }

        string last = EmDash;
        var newest = jobs
            .Select(j => j.CreatedAtTime)
            .Where(t => t.HasValue)
            .OrderByDescending(t => t!.Value)
            .FirstOrDefault();
        if (newest.HasValue)
        {
            last = DateTimeFormatting.Format(newest.Value, DateTimeVariant.Relative, model.Now);
        }

        return
        [
            new StatTileDisplay("Total-Exports", s.TotalExports, NumberFormatting.Format(totalExports, null, 0), null, "\uE7B8"),
            new StatTileDisplay("Total-Size", s.TotalSize, DataExportRegistration.FormatBytes(totalSize), null, "\uEDA2"),
            new StatTileDisplay("Most-Exported", s.MostExported, most, s.ByCount, "\uE9D9"),
            new StatTileDisplay("Last-Export", s.LastExport, last, null, "\uE823"),
        ];
    }

    private static AccountPanelDisplay BuildAccount(DataExportModel model, DataExportStrings s)
    {
        var options = new List<SelectOptionDisplay> { new("all", s.AccountAllVehicles) };
        options.AddRange(model.Vehicles.Select(v => new SelectOptionDisplay(
            v.Id.ToString(CultureInfo.InvariantCulture),
            v.Label)));

        return new AccountPanelDisplay(
            Title: s.AccountTitle,
            Subtitle: s.AccountSubtitle,
            VehicleLabel: s.AccountVehicle,
            VehicleOptions: options,
            SelectedVehicleId: model.Account.VehicleId,
            StartDateLabel: s.AccountStartDate,
            EndDateLabel: s.AccountEndDate,
            Start: model.Account.Start,
            End: model.Account.End,
            Warning: s.AccountWarning,
            StartLabel: s.AccountStart,
            Busy: model.AccountBusy);
    }

    private static WizardDisplay BuildWizard(DataExportModel model, DataExportStrings s, ILocalizer localizer)
    {
        var w = model.Wizard;

        var types = DataExportRegistration.Types
            .Select(t => new ExportTypeOptionDisplay(
                t.Value,
                localizer.GetString(t.LabelKey, t.LabelDefault),
                localizer.GetString(t.DescKey, t.DescDefault),
                t.Glyph,
                t.Badge,
                string.Equals(t.Value, w.Type, StringComparison.Ordinal)))
            .ToList();

        var formats = DataExportRegistration.Formats
            .Select(f => new FormatOptionDisplay(
                f.Value,
                localizer.GetString(f.LabelKey, f.LabelDefault),
                f.Glyph,
                string.Equals(f.Value, w.Format, StringComparison.Ordinal)))
            .ToList();

        // The column picker (web ColumnPickerSection) is visible only when the catalog type for the export type
        // publishes a selectable, non-empty catalog (or while that catalog is loading).
        bool catalogForType = !string.IsNullOrEmpty(DataExportRegistration.CatalogTypeFor(w.Type));
        bool columnsLoading = catalogForType && model.Columns.Loading &&
            string.Equals(model.Columns.CatalogType, DataExportRegistration.CatalogTypeFor(w.Type), StringComparison.Ordinal);
        var catalog = model.Columns.Catalog;
        bool showPicker = catalogForType && !columnsLoading && !model.Columns.HasError && catalog.CanSelect &&
            string.Equals(model.Columns.CatalogType, DataExportRegistration.CatalogTypeFor(w.Type), StringComparison.Ordinal);

        var allNames = catalog.Columns.Select(c => c.Name).ToList();
        var effective = w.SelectedColumns ?? allNames;
        var effectiveSet = new HashSet<string>(effective, StringComparer.Ordinal);
        bool allSelected = effective.Count == allNames.Count && allNames.All(effectiveSet.Contains);

        var columnRows = showPicker
            ? catalog.Columns
                .Select(c => new ColumnRowDisplay(c.Name, c.Label, effectiveSet.Contains(c.Name), c.AlwaysIncluded))
                .ToList()
            : new List<ColumnRowDisplay>();

        var vehicleOptions = new List<SelectOptionDisplay> { new(string.Empty, s.AllVehiclesBare) };
        vehicleOptions.AddRange(model.Vehicles.Select(v => new SelectOptionDisplay(
            v.Id.ToString(CultureInfo.InvariantCulture),
            v.Label)));

        var presets = DataExportRegistration.Presets
            .Select(p => new DatePresetOptionDisplay(
                localizer.GetString(p.LabelKey, p.LabelDefault),
                p.Days,
                !w.UseCustomRange && p.Days == w.PresetDays))
            .ToList();

        return new WizardDisplay(
            Title: s.WizardTitle,
            Step1Label: s.Step1,
            Step2Label: s.Step2,
            Step3Label: s.Step3,
            Step4Label: s.Step4,
            Types: types,
            Formats: formats,
            ShowColumnPicker: showPicker || columnsLoading,
            ColumnsLoading: columnsLoading,
            ColumnsTitle: s.ColumnsTitle,
            ColumnsHelper: s.ColumnsHelper,
            ColumnsSelectAllLabel: s.ColumnsSelectAll,
            ColumnsClearLabel: s.ColumnsClear,
            ColumnsRequiredLabel: s.ColumnsAlwaysIncluded,
            ColumnsAllSelected: allSelected,
            ColumnRows: columnRows,
            ShowVehicleStep: model.Vehicles.Count > 0,
            VehiclePrompt: s.AllVehicles,
            VehicleOptions: vehicleOptions,
            SelectedVehicleId: w.VehicleId,
            Presets: presets,
            CustomRangeLabel: s.CustomRange,
            CustomRangeActive: w.UseCustomRange,
            StartLabel: s.Start,
            EndLabel: s.End,
            CustomStart: w.CustomStart,
            CustomEnd: w.CustomEnd,
            SubmitLabel: s.StartExport,
            SubmitBusy: model.SubmitBusy);
    }

    private static OverviewDisplay BuildOverview(DataExportModel model, DataExportStrings s)
    {
        // web dataOverview is derived from the resolved jobs: sum of record_count for drives / charging types.
        bool hasData = !model.JobsLoading;
        long drives = model.Jobs
            .Where(j => string.Equals(j.Type, "drives", StringComparison.Ordinal))
            .Sum(j => j.RecordCount ?? 0);
        long charging = model.Jobs
            .Where(j => string.Equals(j.Type, "charging", StringComparison.Ordinal))
            .Sum(j => j.RecordCount ?? 0);

        return new OverviewDisplay(
            Title: s.DataOverview,
            Loading: model.JobsLoading,
            HasData: hasData,
            DrivesValue: NumberFormatting.Format(drives, null, 0),
            DrivesLabel: s.Drives,
            ChargingValue: NumberFormatting.Format(charging, null, 0),
            ChargingLabel: s.ChargingSessions,
            UnavailableText: s.Unavailable);
    }

    private static HistoryDisplay BuildHistory(DataExportModel model, DataExportStrings s, ILocalizer localizer)
    {
        var vehicleMap = model.Vehicles.ToDictionary(v => v.Id, v => v.Label);
        int activeCount = model.Jobs.Count(j => j.IsActive);

        var rows = model.Jobs.Select(j =>
        {
            string vehicle = j.VehicleId is { } vid
                ? vehicleMap.TryGetValue(vid, out var label)
                    ? label
                    : $"#{vid.ToString(CultureInfo.InvariantCulture)}"
                : EmDash;

            var (statusKey, statusDefault) = DataExportRegistration.StatusLabel(j.Status);

            return new HistoryRowDisplay(
                Id: j.Id,
                TypeLabel: TypeLabelFor(j.Type, localizer),
                TypeBadge: TypeBadgeFor(j.Type),
                Format: j.Format,
                FormatUpper: j.Format.ToUpperInvariant(),
                FormatBadge: string.Equals(j.Format, "csv", StringComparison.OrdinalIgnoreCase) ? StatusKind.Info : StatusKind.Warning,
                StatusLabel: localizer.GetString(statusKey, statusDefault),
                StatusBadge: DataExportRegistration.StatusBadgeFor(j.Status),
                StatusGlyph: DataExportRegistration.StatusGlyph(j.Status),
                Vehicle: vehicle,
                Records: DataExportRegistration.FormatInt(j.RecordCount),
                Size: DataExportRegistration.FormatBytes(j.FileSize),
                Duration: DataExportRegistration.FormatDuration(j.DurationMs),
                Time: DateTimeFormatting.Format(j.CreatedAtTime, DateTimeVariant.Full, model.Now),
                CanDownload: j.IsReady,
                DownloadLabel: s.Download,
                DownloadPath: DataExportRegistration.DownloadPath(j.Id),
                DownloadUri: BuildDownloadUri(model.DownloadBase, j.Id),
                HasError: string.Equals(j.Status, "failed", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(j.ErrorMessage),
                ErrorMessage: j.ErrorMessage ?? string.Empty);
        }).ToList();

        return new HistoryDisplay(
            Title: s.ExportHistory,
            RefreshLabel: s.Refresh,
            Loading: model.JobsLoading,
            ShowActiveBadge: activeCount > 0,
            ActiveLabel: s.Active,
            ActiveCount: activeCount,
            ColumnHeaders: [s.TypeHeader, s.FormatHeader, s.StatusHeader, s.VehicleHeader, s.RecordsHeader, s.SizeHeader, s.DurationHeader, s.TimeHeader],
            DownloadHeader: s.Download,
            Rows: rows,
            ShowEmpty: !model.JobsLoading && model.Jobs.Count == 0,
            EmptyGlyph: DataExportRegistration.FileDownGlyph,
            EmptyTitle: s.NoExports,
            EmptyMessage: s.NoExportsMessage,
            NoJobsText: s.NoJobs);
    }

    // Resolve a type's localized chip label through its catalog entry, falling back to the raw token.
    private static string TypeLabelFor(string type, ILocalizer localizer)
    {
        var entry = DataExportRegistration.Types.FirstOrDefault(t => string.Equals(t.Value, type, StringComparison.Ordinal));
        return entry is null ? type : localizer.GetString(entry.LabelKey, entry.LabelDefault);
    }

    private static StatusKind TypeBadgeFor(string type)
    {
        var entry = DataExportRegistration.Types.FirstOrDefault(t => string.Equals(t.Value, type, StringComparison.Ordinal));
        return entry?.Badge ?? StatusKind.Neutral;
    }

    private static Uri? BuildDownloadUri(Uri? baseUri, string id)
    {
        string path = DataExportRegistration.DownloadPath(id);
        if (baseUri is null)
        {
            return Uri.TryCreate(path, UriKind.Relative, out var rel) ? rel : null;
        }

        return Uri.TryCreate(baseUri, path, out var abs) ? abs : null;
    }
}
