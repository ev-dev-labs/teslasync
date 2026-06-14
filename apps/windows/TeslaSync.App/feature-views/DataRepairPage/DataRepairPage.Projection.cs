using System;
using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// Every visible literal the <c>DataRepairPage</c> resolves, pre-localized once per projection — the native parity of
/// the web page's <c>t(...)</c> call sites (web/src/features/system/pages/DataRepairPage.tsx). Resolving the whole set
/// on every projection (regardless of data state) keeps the i18n contract holding in the loading / empty / error /
/// success branches alike, and lets the headless tests assert each web key name is requested. Key names mirror the web
/// keys verbatim.
/// </summary>
public sealed record DataRepairStrings(
    string Title,
    string FixIncomplete,
    string IncompleteSession,
    string Found,
    string TotalStale,
    string StaleCharging,
    string StaleDrives,
    string Status,
    string Clean,
    string NeedsRepair,
    string ChargingSessions,
    string Drives,
    string AllSessionsComplete,
    string NoStaleCharging,
    string NoStaleDrives,
    string Open,
    string Vehicle,
    string EndDateIso,
    string EnergyAddedKwh,
    string EndBatteryPct,
    string ChargerPowerKw,
    string DurationMin,
    string CostDollar,
    string DistanceM,
    string DurationS,
    string MaxSpeedMps,
    string Save,
    string CloseSession,
    string CloseDrive,
    string Discard,
    string Cancel,
    string SessionUpdated,
    string FailedUpdateSession,
    string SessionClosed,
    string FailedCloseSession,
    string SessionDiscarded,
    string FailedDiscardSession,
    string DriveUpdated,
    string FailedUpdateDrive,
    string DriveClosed,
    string FailedCloseDrive,
    string DriveDiscarded,
    string FailedDiscardDrive,
    string ErrorLoadFailed,
    string Retry)
{
    /// <summary>Resolve every label through the i18n facade using the exact web key names.</summary>
    public static DataRepairStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new DataRepairStrings(
            Title: localizer.GetString("Data Repair", "Data Repair"),
            FixIncomplete: localizer.GetString("Fix incomplete or stale sessions", "Fix incomplete or stale sessions"),
            IncompleteSession: localizer.GetString("incomplete session", "incomplete session"),
            Found: localizer.GetString("found", "found"),
            TotalStale: localizer.GetString("Total Stale", "Total Stale"),
            StaleCharging: localizer.GetString("Stale Charging", "Stale Charging"),
            StaleDrives: localizer.GetString("Stale Drives", "Stale Drives"),
            Status: localizer.GetString("Status", "Status"),
            Clean: localizer.GetString("Clean", "Clean"),
            NeedsRepair: localizer.GetString("Needs Repair", "Needs Repair"),
            ChargingSessions: localizer.GetString("Charging Sessions", "Charging Sessions"),
            Drives: localizer.GetString("Drives", "Drives"),
            AllSessionsComplete: localizer.GetString("All sessions are complete", "All sessions are complete"),
            NoStaleCharging: localizer.GetString("No stale charging sessions found.", "No stale charging sessions found."),
            NoStaleDrives: localizer.GetString("No stale drives found.", "No stale drives found."),
            Open: localizer.GetString("Open", "Open"),
            Vehicle: localizer.GetString("Vehicle", "Vehicle"),
            EndDateIso: localizer.GetString("End Date (ISO)", "End Date (ISO)"),
            EnergyAddedKwh: localizer.GetString("Energy Added (kWh)", "Energy Added (kWh)"),
            EndBatteryPct: localizer.GetString("End Battery %", "End Battery %"),
            ChargerPowerKw: localizer.GetString("Charger Power (kW)", "Charger Power (kW)"),
            DurationMin: localizer.GetString("Duration (min)", "Duration (min)"),
            CostDollar: localizer.GetString("Cost ($)", "Cost ($)"),
            DistanceM: localizer.GetString("Distance (m)", "Distance (m)"),
            DurationS: localizer.GetString("Duration (s)", "Duration (s)"),
            MaxSpeedMps: localizer.GetString("Max Speed (m/s)", "Max Speed (m/s)"),
            Save: localizer.GetString("Save", "Save"),
            CloseSession: localizer.GetString("Close Session", "Close Session"),
            CloseDrive: localizer.GetString("Close Drive", "Close Drive"),
            Discard: localizer.GetString("Discard", "Discard"),
            Cancel: localizer.GetString("Cancel", "Cancel"),
            SessionUpdated: localizer.GetString("Session updated", "Session updated"),
            FailedUpdateSession: localizer.GetString("Failed to update session", "Failed to update session"),
            SessionClosed: localizer.GetString("Session closed", "Session closed"),
            FailedCloseSession: localizer.GetString("Failed to close session", "Failed to close session"),
            SessionDiscarded: localizer.GetString("Session discarded", "Session discarded"),
            FailedDiscardSession: localizer.GetString("Failed to discard session", "Failed to discard session"),
            DriveUpdated: localizer.GetString("Drive updated", "Drive updated"),
            FailedUpdateDrive: localizer.GetString("Failed to update drive", "Failed to update drive"),
            DriveClosed: localizer.GetString("Drive closed", "Drive closed"),
            FailedCloseDrive: localizer.GetString("Failed to close drive", "Failed to close drive"),
            DriveDiscarded: localizer.GetString("Drive discarded", "Drive discarded"),
            FailedDiscardDrive: localizer.GetString("Failed to discard drive", "Failed to discard drive"),
            ErrorLoadFailed: localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry: localizer.GetString("common.retry", "Retry"));
    }
}

/// <summary>One headline stat tile (web <c>MetricCard</c>): a label, a pre-formatted value and a semantic accent rail.</summary>
/// <param name="Label">The muted tile label.</param>
/// <param name="Value">The pre-formatted headline value.</param>
/// <param name="AccentBrushKey">The design-token brush key driving the accent rail (web <c>color</c>).</param>
public sealed record MetricDisplay(string Label, string Value, string AccentBrushKey);

/// <summary>The render-ready field values of an open charging edit form (web <c>ChargingEditForm</c> state).</summary>
public sealed record ChargingFormDisplay(
    string EndTs,
    string TotalEnergyAddedWh,
    string EndBatteryPct,
    string PeakPowerW,
    string DurationMin,
    string Cost,
    RepairBusy Busy);

/// <summary>The render-ready field values of an open drive edit form (web <c>DriveEditForm</c> state).</summary>
public sealed record DriveFormDisplay(
    string EndTs,
    string DistanceM,
    string DurationS,
    string EndBatteryPct,
    string MaxSpeedMps,
    RepairBusy Busy);

/// <summary>
/// One stale-record row in the content list — the native mirror of the web row <c>GlassPanel</c> (the clickable header
/// plus, when expanded, the inline edit form). The header cells (id, start, battery, vehicle, hours-open, Open badge)
/// are pre-formatted; exactly one of <see cref="ChargingForm"/> / <see cref="DriveForm"/> is non-null when the row is
/// expanded, depending on the active tab.
/// </summary>
public sealed record RepairRowDisplay(
    long Id,
    string IdLabel,
    string StartLabel,
    string BatteryLabel,
    string VehicleLabel,
    string HoursOpenLabel,
    bool Expanded,
    ChargingFormDisplay? ChargingForm,
    DriveFormDisplay? DriveForm);

/// <summary>The shared labels for both inline edit forms (web form field labels + action buttons).</summary>
public sealed record RepairFormLabels(
    string EndDateIso,
    string EndDateHint,
    string EnergyAddedKwh,
    string EndBatteryPct,
    string ChargerPowerKw,
    string DurationMin,
    string CostDollar,
    string DistanceM,
    string DurationS,
    string MaxSpeedMps,
    string Save,
    string CloseSession,
    string CloseDrive,
    string Discard,
    string Cancel);

/// <summary>
/// The fully-projected, render-ready content the <c>DataRepairPage</c> view binds to — the native mirror of the web
/// page's whole render tree. Per-region visibility is driven by the boolean flags so each branch (loading / error /
/// empty / success) renders exactly as the web composes it, with the four stat tiles + tab bar showing in both resolved
/// branches.
/// </summary>
public sealed record DataRepairDisplay(
    DataRepairState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowSuccess,
    string ErrorText,
    string RetryLabel,
    MetricDisplay TotalStale,
    MetricDisplay StaleCharging,
    MetricDisplay StaleDrives,
    MetricDisplay StatusCard,
    string ChargingTabLabel,
    int ChargingCount,
    bool ChargingSelected,
    string DrivesTabLabel,
    int DrivesCount,
    bool DrivesSelected,
    string EmptyTitle,
    string EmptyMessage,
    bool IsChargingTab,
    string OpenLabel,
    IReadOnlyList<RepairRowDisplay> Rows,
    RepairFormLabels FormLabels)
{
    /// <summary>The page title (for the automation name of the surface).</summary>
    public string AutomationName => Title;
}

/// <summary>
/// The pure projection from a <see cref="DataRepairModel"/> to a render-ready <see cref="DataRepairDisplay"/> — the
/// native mirror of the web component's render body (web/src/features/system/pages/DataRepairPage.tsx). UI-free and
/// deterministic so the whole branch matrix is unit-tested without a WinUI host: it picks the data state, derives the
/// stat tiles, the subtitle, the tab counts and the per-row header / edit-form content, resolving every label once.
/// </summary>
public static class DataRepairProjection
{
    /// <summary>Project the model into render-ready display content, resolving every label through <paramref name="localizer"/>.</summary>
    public static DataRepairDisplay Project(DataRepairModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = DataRepairStrings.Resolve(localizer);

        var charging = model.StaleCharging ?? Array.Empty<StaleChargingSession>();
        var drives = model.StaleDrives ?? Array.Empty<StaleDrive>();
        int totalStale = charging.Count + drives.Count;
        bool isCharging = model.Tab == RepairTab.Charging;
        int currentCount = isCharging ? charging.Count : drives.Count;

        DataRepairState state =
            model.Loading ? DataRepairState.Loading :
            model.HasError ? DataRepairState.Error :
            currentCount == 0 ? DataRepairState.Empty :
            DataRepairState.Success;

        string subtitle = totalStale > 0
            ? string.Format(
                CultureInfo.InvariantCulture,
                "{0} {1}{2} {3}",
                totalStale,
                s.IncompleteSession,
                totalStale != 1 ? "s" : string.Empty,
                s.Found)
            : s.FixIncomplete;

        string errorText = string.IsNullOrEmpty(model.ErrorDetail)
            ? s.ErrorLoadFailed
            : string.Concat(s.ErrorLoadFailed, ": ", model.ErrorDetail);

        var totalCard = new MetricDisplay(
            s.TotalStale, Count(totalStale), DataRepairRegistration.AmberAccentKey);
        var chargingCard = new MetricDisplay(
            s.StaleCharging, Count(charging.Count), DataRepairRegistration.CyanAccentKey);
        var drivesCard = new MetricDisplay(
            s.StaleDrives, Count(drives.Count), DataRepairRegistration.PurpleAccentKey);
        var statusCard = new MetricDisplay(
            s.Status,
            totalStale == 0 ? s.Clean : s.NeedsRepair,
            totalStale == 0 ? DataRepairRegistration.GreenAccentKey : DataRepairRegistration.RedAccentKey);

        var rows = isCharging
            ? BuildChargingRows(charging, model, s)
            : BuildDriveRows(drives, model, s);

        var formLabels = new RepairFormLabels(
            EndDateIso: s.EndDateIso,
            EndDateHint: DataRepairRegistration.EndDateHint,
            EnergyAddedKwh: s.EnergyAddedKwh,
            EndBatteryPct: s.EndBatteryPct,
            ChargerPowerKw: s.ChargerPowerKw,
            DurationMin: s.DurationMin,
            CostDollar: s.CostDollar,
            DistanceM: s.DistanceM,
            DurationS: s.DurationS,
            MaxSpeedMps: s.MaxSpeedMps,
            Save: s.Save,
            CloseSession: s.CloseSession,
            CloseDrive: s.CloseDrive,
            Discard: s.Discard,
            Cancel: s.Cancel);

        return new DataRepairDisplay(
            State: state,
            Title: s.Title,
            Subtitle: subtitle,
            ShowLoading: state == DataRepairState.Loading,
            ShowError: state == DataRepairState.Error,
            ShowEmpty: state == DataRepairState.Empty,
            ShowSuccess: state == DataRepairState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            TotalStale: totalCard,
            StaleCharging: chargingCard,
            StaleDrives: drivesCard,
            StatusCard: statusCard,
            ChargingTabLabel: s.ChargingSessions,
            ChargingCount: charging.Count,
            ChargingSelected: isCharging,
            DrivesTabLabel: s.Drives,
            DrivesCount: drives.Count,
            DrivesSelected: !isCharging,
            EmptyTitle: s.AllSessionsComplete,
            EmptyMessage: isCharging ? s.NoStaleCharging : s.NoStaleDrives,
            IsChargingTab: isCharging,
            OpenLabel: s.Open,
            Rows: rows,
            FormLabels: formLabels);
    }

    private static List<RepairRowDisplay> BuildChargingRows(
        IReadOnlyList<StaleChargingSession> charging, DataRepairModel model, DataRepairStrings s)
    {
        var rows = new List<RepairRowDisplay>(charging.Count);
        foreach (var session in charging)
        {
            bool expanded = model.ExpandedId == session.Id;
            ChargingFormDisplay? form = expanded
                ? new ChargingFormDisplay(
                    EndTs: model.ChargingForm.EndTs,
                    TotalEnergyAddedWh: model.ChargingForm.TotalEnergyAddedWh,
                    EndBatteryPct: model.ChargingForm.EndBatteryPct,
                    PeakPowerW: model.ChargingForm.PeakPowerW,
                    DurationMin: model.ChargingForm.DurationMin,
                    Cost: model.ChargingForm.Cost,
                    Busy: model.Busy)
                : null;

            rows.Add(new RepairRowDisplay(
                Id: session.Id,
                IdLabel: string.Concat("#", session.Id.ToString(CultureInfo.InvariantCulture)),
                StartLabel: DataRepairRegistration.FormatTimestamp(session.StartTs),
                BatteryLabel: DataRepairRegistration.Percent(session.StartBatteryPct),
                VehicleLabel: string.Concat(s.Vehicle, " ", session.VehicleId.ToString(CultureInfo.InvariantCulture)),
                HoursOpenLabel: DataRepairRegistration.HoursOpen(session.StartTs, model.Now),
                Expanded: expanded,
                ChargingForm: form,
                DriveForm: null));
        }

        return rows;
    }

    private static List<RepairRowDisplay> BuildDriveRows(
        IReadOnlyList<StaleDrive> drives, DataRepairModel model, DataRepairStrings s)
    {
        var rows = new List<RepairRowDisplay>(drives.Count);
        foreach (var drive in drives)
        {
            bool expanded = model.ExpandedId == drive.Id;
            DriveFormDisplay? form = expanded
                ? new DriveFormDisplay(
                    EndTs: model.DriveForm.EndTs,
                    DistanceM: model.DriveForm.DistanceM,
                    DurationS: model.DriveForm.DurationS,
                    EndBatteryPct: model.DriveForm.EndBatteryPct,
                    MaxSpeedMps: model.DriveForm.MaxSpeedMps,
                    Busy: model.Busy)
                : null;

            rows.Add(new RepairRowDisplay(
                Id: drive.Id,
                IdLabel: string.Concat("#", drive.Id.ToString(CultureInfo.InvariantCulture)),
                StartLabel: DataRepairRegistration.FormatTimestamp(drive.StartTs),
                BatteryLabel: DataRepairRegistration.Percent(drive.StartBatteryPct),
                VehicleLabel: string.Concat(s.Vehicle, " ", drive.VehicleId.ToString(CultureInfo.InvariantCulture)),
                HoursOpenLabel: DataRepairRegistration.HoursOpen(drive.StartTs, model.Now),
                Expanded: expanded,
                ChargingForm: null,
                DriveForm: form));
        }

        return rows;
    }

    private static string Count(int value) => value.ToString(CultureInfo.InvariantCulture);
}
