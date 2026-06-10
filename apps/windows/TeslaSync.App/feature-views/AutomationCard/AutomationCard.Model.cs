using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The render-time model for one conflict the <c>AutomationCard</c> warns about — the native analogue of the
/// web <c>AutomationConflict</c> entry (<c>automation_name</c>, <c>reason</c>, <c>severity</c>) read by
/// web/src/features/automations/pages/AutomationCard.tsx. Pure data, no WinUI types.
/// </summary>
/// <param name="AutomationName">The conflicting automation's name (web <c>conflict.automation_name</c>).</param>
/// <param name="Reason">Why the two conflict (web <c>conflict.reason</c>).</param>
/// <param name="Severity">The raw wire severity, <c>warning</c> or <c>info</c> (web <c>conflict.severity</c>); selects the amber-vs-blue tint.</param>
public sealed record AutomationConflictModel(
    string AutomationName,
    string Reason,
    string Severity);

/// <summary>
/// The render-time data model the <c>AutomationCard</c> surface binds to — the native analogue of the web
/// component's props (<c>automation</c>, <c>isFiring</c>, <c>vehicleName</c>) in
/// web/src/features/automations/pages/AutomationCard.tsx, narrowed to the fields the card actually reads. The
/// web card is purely presentational — it owns presentation only and the hosting page wires the
/// toggle / re-enable / delete / test-run callbacks (plus the pin store behind <c>PinButton</c>) — so this
/// model is just the automation it renders plus the two ambient flags; it performs no fetching. Pure data,
/// no WinUI types, so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The automation identity (web <c>automation.id</c>) the host correlates raised events back to.</param>
/// <param name="Name">The automation name (web <c>automation.name</c>).</param>
/// <param name="Description">The optional description (web <c>automation.description</c>); the description line renders only when present.</param>
/// <param name="Enabled">Whether the automation is enabled (web <c>automation.enabled</c>); drives the status chip and the toggle.</param>
/// <param name="AutoDisabled">Whether the automation was auto-disabled by the engine (web <c>automation.auto_disabled</c>); forces the toggle off, adds the danger border and reveals the re-enable affordance.</param>
/// <param name="AutoDisabledReason">Why it was auto-disabled (web <c>automation.auto_disabled_reason</c>); the warning banner renders only when auto-disabled with a reason.</param>
/// <param name="LastTriggeredAt">When it last fired (web <c>automation.last_triggered_at</c>); selects the "Last: {ago}" vs "Never run" branch.</param>
/// <param name="ExecutionCount">Total successful runs (web <c>automation.execution_count</c>).</param>
/// <param name="FailureCount">Total failures (web <c>automation.failure_count</c>); the fails chip renders only when &gt; 0.</param>
/// <param name="NextFireTime">The next scheduled fire time, or <see langword="null"/> (web <c>automation.next_fire_time</c>); the next-fire chip renders only when present.</param>
/// <param name="Conflicts">The conflicts to warn about (web <c>automation.conflicts ?? []</c>).</param>
/// <param name="IsFiring">Whether the automation is firing right now (web <c>isFiring</c>); adds the accent ring and the pulsing "Firing" chip.</param>
/// <param name="VehicleName">The scoped vehicle's name, or <see langword="null"/> for all vehicles (web <c>vehicleName</c>).</param>
/// <param name="IsPinned">Whether the user has pinned this automation (web <c>PinButton</c>'s <c>usePinned</c> state); selects the pin-vs-unpin affordance.</param>
public sealed record AutomationCardModel(
    long Id,
    string Name,
    string? Description,
    bool Enabled,
    bool AutoDisabled,
    string? AutoDisabledReason,
    DateTimeOffset? LastTriggeredAt,
    long ExecutionCount,
    long FailureCount,
    DateTimeOffset? NextFireTime,
    IReadOnlyList<AutomationConflictModel> Conflicts,
    bool IsFiring,
    string? VehicleName,
    bool IsPinned);

/// <summary>The card's resolved status — the native analogue of the web <c>AutomationUIStatus</c> union.</summary>
public enum AutomationUiStatus
{
    /// <summary>Enabled and healthy (web <c>'active'</c>).</summary>
    Active,

    /// <summary>Disabled by the user (web <c>'disabled'</c>).</summary>
    Disabled,

    /// <summary>Auto-disabled by the engine (web <c>'auto-disabled'</c>).</summary>
    AutoDisabled,
}

/// <summary>
/// One fully projected conflict row — the native analogue of a single web conflict chip. The full sentence
/// is precomputed through the i18n facade and the amber-vs-blue branch is resolved to <see cref="IsWarning"/>.
/// </summary>
/// <param name="Text">The composed conflict sentence (web <c>{t('automations.conflictWith')} "{name}" — {reason}</c>).</param>
/// <param name="IsWarning">Whether this is a <c>warning</c> (amber) rather than an <c>info</c> (blue) conflict.</param>
public sealed record AutomationConflictDisplay(string Text, bool IsWarning);

/// <summary>
/// The fully projected, render-ready view of one automation card — the native analogue of what the web
/// <c>AutomationCard</c> renders (web/src/features/automations/pages/AutomationCard.tsx). Every conditional the
/// web component branches on is resolved here: the active / disabled / auto-disabled status
/// (<see cref="UiStatus"/>, <see cref="StatusLabel"/>, <see cref="StatusBadgeKind"/>), the firing accent
/// (<see cref="IsFiring"/>), the toggle state (<see cref="ToggleIsOn"/>), the re-enable menu branch
/// (<see cref="ShowReEnableMenuItem"/>), the vehicle-vs-all-vehicles label (<see cref="VehicleLabel"/>), the
/// last-run / never-run split (<see cref="ShowLastRun"/>), the failures chip (<see cref="ShowFails"/>), the
/// next-fire chip (<see cref="ShowNextFire"/>), the auto-disabled reason banner
/// (<see cref="ShowAutoDisabledReason"/>), the conflicts (<see cref="Conflicts"/>) and the pin affordance
/// (<see cref="IsPinned"/>, <see cref="PinLabel"/>). Labels resolve through the i18n facade and every value is
/// precomputed so the view does no formatting. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record AutomationCardDisplay(
    string Name,
    string? Description,
    bool HasDescription,
    AutomationUiStatus UiStatus,
    string StatusLabel,
    StatusKind StatusBadgeKind,
    bool IsAutoDisabled,
    bool IsFiring,
    string FiringLabel,
    bool ToggleIsOn,
    string ToggleLabel,
    string MenuLabel,
    bool ShowReEnableMenuItem,
    string TestRunLabel,
    string ReEnableLabel,
    string DuplicateLabel,
    string ExportLabel,
    string DeleteLabel,
    bool HasVehicleName,
    string VehicleLabel,
    bool ShowLastRun,
    string LastRunText,
    string NeverRunLabel,
    string RunsText,
    bool ShowFails,
    string FailsText,
    bool ShowNextFire,
    string NextFireText,
    bool ShowAutoDisabledReason,
    string AutoDisabledReason,
    IReadOnlyList<AutomationConflictDisplay> Conflicts,
    bool IsPinned,
    string PinLabel,
    string DeleteTitle,
    string DeleteMessage,
    string DeleteConfirmLabel,
    string CancelLabel,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AutomationCardModel"/> to its <see cref="AutomationCardDisplay"/> — the
/// native port of web/src/features/automations/pages/AutomationCard.tsx. The web card is purely presentational
/// (it never fetches), so the projection is a direct function of the input automation plus the injected
/// <c>now</c> the relative-time label is measured against. The status follows the web <c>getUIStatus</c>
/// precedence (auto-disabled &gt; disabled &gt; active), the relative-time copy mirrors the card's bespoke
/// <c>timeAgo</c> tiers, the next-fire timestamp mirrors the web <c>formatDateTime</c>, and every label
/// resolves through the i18n facade using the catalog keys the web source feeds into <c>t()</c>. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class AutomationCardProjection
{
    /// <summary>i18n key for the active status chip (web <c>t('automations.status.active', 'Active')</c>).</summary>
    public const string StatusActiveKey = "translation.automations.status.active";

    /// <summary>i18n key for the disabled status chip (web <c>t('automations.status.disabled', 'Disabled')</c>).</summary>
    public const string StatusDisabledKey = "translation.automations.status.disabled";

    /// <summary>i18n key for the auto-disabled status chip (web <c>t('automations.status.auto-disabled', 'Auto-Disabled')</c>).</summary>
    public const string StatusAutoDisabledKey = "translation.automations.status.auto-disabled";

    /// <summary>i18n key for the firing chip (web <c>t('automations.firing', 'Firing')</c>).</summary>
    public const string FiringKey = "translation.automations.firing";

    /// <summary>i18n key for the toggle's accessible label (web <c>t('automations.toggleLabel', 'Toggle automation')</c>).</summary>
    public const string ToggleLabelKey = "translation.automations.toggleLabel";

    /// <summary>i18n key for the kebab menu's accessible label (web <c>t('automations.menu', 'Actions menu')</c>).</summary>
    public const string MenuKey = "translation.automations.menu";

    /// <summary>i18n key for the test-run action (web <c>t('automations.testRun', 'Test Run')</c>).</summary>
    public const string TestRunKey = "translation.automations.testRun";

    /// <summary>i18n key for the re-enable action (web <c>t('automations.reEnable', 'Re-enable')</c>).</summary>
    public const string ReEnableKey = "translation.automations.reEnable";

    /// <summary>i18n key for the duplicate action (web <c>t('automations.duplicate', 'Duplicate')</c>).</summary>
    public const string DuplicateKey = "translation.automations.duplicate";

    /// <summary>i18n key for the export action (web <c>t('automations.export', 'Export')</c>).</summary>
    public const string ExportKey = "translation.automations.export";

    /// <summary>i18n key for the delete action (web <c>t('automations.delete', 'Delete')</c>).</summary>
    public const string DeleteKey = "translation.automations.delete";

    /// <summary>i18n key for the all-vehicles scope label (web <c>t('automations.allVehicles', 'All vehicles')</c>).</summary>
    public const string AllVehiclesKey = "translation.automations.allVehicles";

    /// <summary>i18n key for the last-run label (web <c>t('automations.lastRun', 'Last')</c>).</summary>
    public const string LastRunKey = "translation.automations.lastRun";

    /// <summary>i18n key for the never-run label (web <c>t('automations.neverRun', 'Never run')</c>).</summary>
    public const string NeverRunKey = "translation.automations.neverRun";

    /// <summary>i18n key for the runs label (web <c>t('automations.runs', 'Runs')</c>).</summary>
    public const string RunsKey = "translation.automations.runs";

    /// <summary>i18n key for the fails label (web <c>t('automations.fails', 'Fails')</c>).</summary>
    public const string FailsKey = "translation.automations.fails";

    /// <summary>i18n key for the next-fire label (web <c>t('automations.nextFire', 'Next')</c>).</summary>
    public const string NextFireKey = "translation.automations.nextFire";

    /// <summary>i18n key for the conflict prefix (web <c>t('automations.conflictWith', 'Conflict with')</c>).</summary>
    public const string ConflictWithKey = "translation.automations.conflictWith";

    /// <summary>i18n key for the delete dialog title (web <c>t('automations.deleteTitle', 'Delete Automation')</c>).</summary>
    public const string DeleteTitleKey = "translation.automations.deleteTitle";

    /// <summary>i18n key for the delete dialog body (web <c>t('automations.deleteMessage', …, { name })</c>).</summary>
    public const string DeleteMessageKey = "translation.automations.deleteMessage";

    /// <summary>i18n key for the delete confirm button (web <c>t('automations.deleteConfirm', 'Delete')</c>).</summary>
    public const string DeleteConfirmKey = "translation.automations.deleteConfirm";

    /// <summary>i18n key for the cancel button (web <c>t('common.cancel', 'Cancel')</c>).</summary>
    public const string CancelKey = "translation.common.cancel";

    /// <summary>i18n key for the pin affordance (web <c>t('pin.pin', 'Pin')</c>).</summary>
    public const string PinKey = "translation.pin.pin";

    /// <summary>i18n key for the unpin affordance (web <c>t('pin.unpin', 'Unpin')</c>).</summary>
    public const string UnpinKey = "translation.pin.unpin";

    /// <summary>English fallback for <see cref="StatusActiveKey"/> (matches the web default).</summary>
    public const string StatusActiveFallback = "Active";

    /// <summary>English fallback for <see cref="StatusDisabledKey"/> (matches the web default).</summary>
    public const string StatusDisabledFallback = "Disabled";

    /// <summary>English fallback for <see cref="StatusAutoDisabledKey"/> (matches the web default).</summary>
    public const string StatusAutoDisabledFallback = "Auto-Disabled";

    /// <summary>English fallback for <see cref="FiringKey"/> (matches the web default).</summary>
    public const string FiringFallback = "Firing";

    /// <summary>English fallback for <see cref="ToggleLabelKey"/> (matches the web default).</summary>
    public const string ToggleLabelFallback = "Toggle automation";

    /// <summary>English fallback for <see cref="MenuKey"/> (matches the web default).</summary>
    public const string MenuFallback = "Actions menu";

    /// <summary>English fallback for <see cref="TestRunKey"/> (matches the web default).</summary>
    public const string TestRunFallback = "Test Run";

    /// <summary>English fallback for <see cref="ReEnableKey"/> (matches the web default).</summary>
    public const string ReEnableFallback = "Re-enable";

    /// <summary>English fallback for <see cref="DuplicateKey"/> (matches the web default).</summary>
    public const string DuplicateFallback = "Duplicate";

    /// <summary>English fallback for <see cref="ExportKey"/> (matches the web default).</summary>
    public const string ExportFallback = "Export";

    /// <summary>English fallback for <see cref="DeleteKey"/> (matches the web default).</summary>
    public const string DeleteFallback = "Delete";

    /// <summary>English fallback for <see cref="AllVehiclesKey"/> (matches the web default).</summary>
    public const string AllVehiclesFallback = "All vehicles";

    /// <summary>English fallback for <see cref="LastRunKey"/> (matches the web default).</summary>
    public const string LastRunFallback = "Last";

    /// <summary>English fallback for <see cref="NeverRunKey"/> (matches the web default).</summary>
    public const string NeverRunFallback = "Never run";

    /// <summary>English fallback for <see cref="RunsKey"/> (matches the web default).</summary>
    public const string RunsFallback = "Runs";

    /// <summary>English fallback for <see cref="FailsKey"/> (matches the web default).</summary>
    public const string FailsFallback = "Fails";

    /// <summary>English fallback for <see cref="NextFireKey"/> (matches the web default).</summary>
    public const string NextFireFallback = "Next";

    /// <summary>English fallback for <see cref="ConflictWithKey"/> (matches the web default).</summary>
    public const string ConflictWithFallback = "Conflict with";

    /// <summary>English fallback for <see cref="DeleteTitleKey"/> (matches the web default).</summary>
    public const string DeleteTitleFallback = "Delete Automation";

    /// <summary>English fallback for <see cref="DeleteMessageKey"/>. Uses a positional <c>{0}</c> token (the resw catalog form) in place of the web i18next <c>{{name}}</c>.</summary>
    public const string DeleteMessageFallback = "Are you sure you want to delete \"{0}\"? This cannot be undone.";

    /// <summary>English fallback for <see cref="DeleteConfirmKey"/> (matches the web default).</summary>
    public const string DeleteConfirmFallback = "Delete";

    /// <summary>English fallback for <see cref="CancelKey"/> (matches the web default).</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>English fallback for <see cref="PinKey"/> (matches the web default).</summary>
    public const string PinFallback = "Pin";

    /// <summary>English fallback for <see cref="UnpinKey"/> (matches the web default).</summary>
    public const string UnpinFallback = "Unpin";

    /// <summary>The raw wire severity the web treats as a warning (amber) conflict; anything else is an info (blue) conflict.</summary>
    public const string WarningSeverity = "warning";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time automation (the web <c>automation</c> prop, narrowed, plus the ambient flags).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The instant the relative-time label is measured against (the web <c>Date.now()</c> seam).</param>
    public static AutomationCardDisplay Project(AutomationCardModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        AutomationUiStatus status = ResolveStatus(model);
        string statusLabel = StatusLabel(status, localizer);

        bool hasDescription = !string.IsNullOrWhiteSpace(model.Description);
        bool hasVehicleName = !string.IsNullOrWhiteSpace(model.VehicleName);
        string vehicleLabel = hasVehicleName
            ? model.VehicleName!
            : localizer.GetString(AllVehiclesKey, AllVehiclesFallback);

        bool showLastRun = model.LastTriggeredAt is not null;
        string lastRunLabel = localizer.GetString(LastRunKey, LastRunFallback);
        string lastRunText = showLastRun
            ? lastRunLabel + ": " + FormatTimeAgo(model.LastTriggeredAt, now)
            : string.Empty;
        string neverRunLabel = localizer.GetString(NeverRunKey, NeverRunFallback);

        string runsText = localizer.GetString(RunsKey, RunsFallback) + ": " +
            model.ExecutionCount.ToString(CultureInfo.InvariantCulture);

        bool showFails = model.FailureCount > 0;
        string failsText = showFails
            ? localizer.GetString(FailsKey, FailsFallback) + ": " +
              model.FailureCount.ToString(CultureInfo.InvariantCulture)
            : string.Empty;

        bool showNextFire = model.NextFireTime is not null;
        string nextFireText = showNextFire
            ? localizer.GetString(NextFireKey, NextFireFallback) + ": " +
              DateTimeFormatting.Format(model.NextFireTime, DateTimeVariant.Full, now)
            : string.Empty;

        bool showAutoDisabledReason = model.AutoDisabled && !string.IsNullOrWhiteSpace(model.AutoDisabledReason);

        string conflictPrefix = localizer.GetString(ConflictWithKey, ConflictWithFallback);
        var conflicts = new List<AutomationConflictDisplay>(model.Conflicts?.Count ?? 0);
        foreach (AutomationConflictModel conflict in model.Conflicts ?? Array.Empty<AutomationConflictModel>())
        {
            conflicts.Add(new AutomationConflictDisplay(
                Text: ConflictText(conflictPrefix, conflict),
                IsWarning: string.Equals(conflict.Severity, WarningSeverity, StringComparison.OrdinalIgnoreCase)));
        }

        string pinLabel = model.IsPinned
            ? localizer.GetString(UnpinKey, UnpinFallback)
            : localizer.GetString(PinKey, PinFallback);

        string deleteMessage = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(DeleteMessageKey, DeleteMessageFallback),
            model.Name);

        return new AutomationCardDisplay(
            Name: model.Name,
            Description: model.Description,
            HasDescription: hasDescription,
            UiStatus: status,
            StatusLabel: statusLabel,
            StatusBadgeKind: StatusBadgeKind(status),
            IsAutoDisabled: status == AutomationUiStatus.AutoDisabled,
            IsFiring: model.IsFiring,
            FiringLabel: localizer.GetString(FiringKey, FiringFallback),
            ToggleIsOn: model.AutoDisabled ? false : model.Enabled,
            ToggleLabel: localizer.GetString(ToggleLabelKey, ToggleLabelFallback),
            MenuLabel: localizer.GetString(MenuKey, MenuFallback),
            ShowReEnableMenuItem: model.AutoDisabled,
            TestRunLabel: localizer.GetString(TestRunKey, TestRunFallback),
            ReEnableLabel: localizer.GetString(ReEnableKey, ReEnableFallback),
            DuplicateLabel: localizer.GetString(DuplicateKey, DuplicateFallback),
            ExportLabel: localizer.GetString(ExportKey, ExportFallback),
            DeleteLabel: localizer.GetString(DeleteKey, DeleteFallback),
            HasVehicleName: hasVehicleName,
            VehicleLabel: vehicleLabel,
            ShowLastRun: showLastRun,
            LastRunText: lastRunText,
            NeverRunLabel: neverRunLabel,
            RunsText: runsText,
            ShowFails: showFails,
            FailsText: failsText,
            ShowNextFire: showNextFire,
            NextFireText: nextFireText,
            ShowAutoDisabledReason: showAutoDisabledReason,
            AutoDisabledReason: model.AutoDisabledReason ?? string.Empty,
            Conflicts: conflicts,
            IsPinned: model.IsPinned,
            PinLabel: pinLabel,
            DeleteTitle: localizer.GetString(DeleteTitleKey, DeleteTitleFallback),
            DeleteMessage: deleteMessage,
            DeleteConfirmLabel: localizer.GetString(DeleteConfirmKey, DeleteConfirmFallback),
            CancelLabel: localizer.GetString(CancelKey, CancelFallback),
            AutomationName: BuildAutomationName(model, status, statusLabel, vehicleLabel, lastRunText, neverRunLabel, runsText, failsText, nextFireText, showLastRun, conflicts));
    }

    /// <summary>
    /// Resolve the card status the way the web <c>getUIStatus</c> does: auto-disabled wins, then a disabled
    /// (not enabled) automation, otherwise active.
    /// </summary>
    /// <param name="model">The automation to classify.</param>
    public static AutomationUiStatus ResolveStatus(AutomationCardModel model)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.AutoDisabled)
        {
            return AutomationUiStatus.AutoDisabled;
        }

        return model.Enabled ? AutomationUiStatus.Active : AutomationUiStatus.Disabled;
    }

    /// <summary>The semantic badge colour for a status — web <c>statusStyles[uiStatus].variant</c> (success / neutral / danger).</summary>
    /// <param name="status">The resolved card status.</param>
    public static StatusKind StatusBadgeKind(AutomationUiStatus status) => status switch
    {
        AutomationUiStatus.Active => StatusKind.Success,
        AutomationUiStatus.AutoDisabled => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>The localized status label — web <c>t('automations.status.{uiStatus}', statusStyles[uiStatus].label)</c>.</summary>
    /// <param name="status">The resolved card status.</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string StatusLabel(AutomationUiStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return status switch
        {
            AutomationUiStatus.Active => localizer.GetString(StatusActiveKey, StatusActiveFallback),
            AutomationUiStatus.AutoDisabled => localizer.GetString(StatusAutoDisabledKey, StatusAutoDisabledFallback),
            _ => localizer.GetString(StatusDisabledKey, StatusDisabledFallback),
        };
    }

    /// <summary>
    /// The relative-time label — a 1:1 port of the card's bespoke <c>timeAgo</c>: a null timestamp renders the
    /// em-dash, under a minute is "just now", under an hour "<c>{m}m ago</c>", under a day "<c>{h}h ago</c>",
    /// otherwise "<c>{d}d ago</c>". The integer tiers use JavaScript <c>Math.floor</c> semantics and the
    /// compact, locale-independent unit suffixes the web renders verbatim (the source does not localize them).
    /// </summary>
    /// <param name="value">When the automation last fired, or <see langword="null"/>.</param>
    /// <param name="now">The instant to measure against (the web <c>Date.now()</c>).</param>
    public static string FormatTimeAgo(DateTimeOffset? value, DateTimeOffset now)
    {
        if (value is not { } iso)
        {
            return DateTimeFormatting.DefaultEmptyDisplay;
        }

        double diffMs = (now - iso).TotalMilliseconds;
        long mins = (long)Math.Floor(diffMs / 60000.0);
        if (mins < 1)
        {
            return "just now";
        }

        if (mins < 60)
        {
            return mins.ToString(CultureInfo.InvariantCulture) + "m ago";
        }

        long hours = (long)Math.Floor(mins / 60.0);
        if (hours < 24)
        {
            return hours.ToString(CultureInfo.InvariantCulture) + "h ago";
        }

        long days = (long)Math.Floor(hours / 24.0);
        return days.ToString(CultureInfo.InvariantCulture) + "d ago";
    }

    private static string ConflictText(string prefix, AutomationConflictModel conflict) =>
        prefix + " \"" + conflict.AutomationName + "\" — " + conflict.Reason;

    private static string BuildAutomationName(
        AutomationCardModel model,
        AutomationUiStatus status,
        string statusLabel,
        string vehicleLabel,
        string lastRunText,
        string neverRunLabel,
        string runsText,
        string failsText,
        string nextFireText,
        bool showLastRun,
        IReadOnlyList<AutomationConflictDisplay> conflicts)
    {
        var parts = new List<string>(8);

        if (!string.IsNullOrEmpty(model.Name))
        {
            parts.Add(model.Name);
        }

        parts.Add(statusLabel);

        if (!string.IsNullOrWhiteSpace(model.Description))
        {
            parts.Add(model.Description!);
        }

        parts.Add(vehicleLabel);
        parts.Add(showLastRun ? lastRunText : neverRunLabel);
        parts.Add(runsText);

        if (!string.IsNullOrEmpty(failsText))
        {
            parts.Add(failsText);
        }

        if (!string.IsNullOrEmpty(nextFireText))
        {
            parts.Add(nextFireText);
        }

        if (status == AutomationUiStatus.AutoDisabled && !string.IsNullOrWhiteSpace(model.AutoDisabledReason))
        {
            parts.Add(model.AutoDisabledReason!);
        }

        foreach (AutomationConflictDisplay conflict in conflicts)
        {
            parts.Add(conflict.Text);
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AutomationCard</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation name, description, vehicle
/// or conflict — so a diagnostics line can never leak what a user saw. Thread-safe.
/// </summary>
public sealed class AutomationCardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutomationCardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutomationCard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutomationCardRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>AutomationCard</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/automations/pages/AutomationCard.tsx</c>, plus the Segoe Fluent Icons glyphs that
/// stand in for the web Lucide icons (the status / firing / vehicle / stats glyphs and the kebab-menu and pin
/// affordances). UI-free so the metadata is asserted in tests.
/// </summary>
public static class AutomationCardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AutomationCard";

    /// <summary>Segoe Fluent "LightningBolt" glyph — the firing chip (web Lucide <c>Zap</c>).</summary>
    public const string FiringGlyph = "\uE945";

    /// <summary>Segoe Fluent "Warning" glyph — the auto-disabled banner and conflict rows (web Lucide <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "More" glyph — the kebab actions menu (web Lucide <c>MoreVertical</c>).</summary>
    public const string MenuGlyph = "\uE712";

    /// <summary>Segoe Fluent "Play" glyph — the test-run action (web Lucide <c>Play</c>).</summary>
    public const string TestRunGlyph = "\uE768";

    /// <summary>Segoe Fluent "Refresh" glyph — the re-enable action (web Lucide <c>RotateCcw</c>).</summary>
    public const string ReEnableGlyph = "\uE72C";

    /// <summary>Segoe Fluent "Copy" glyph — the duplicate action (web Lucide <c>Copy</c>).</summary>
    public const string DuplicateGlyph = "\uE8C8";

    /// <summary>Segoe Fluent "Download" glyph — the export action (web Lucide <c>Download</c>).</summary>
    public const string ExportGlyph = "\uE896";

    /// <summary>Segoe Fluent "Delete" glyph — the delete action (web Lucide <c>Trash2</c>).</summary>
    public const string DeleteGlyph = "\uE74D";

    /// <summary>Segoe Fluent "Car" glyph — the scoped-vehicle chip (web Lucide <c>Car</c>).</summary>
    public const string VehicleGlyph = "\uE804";

    /// <summary>Segoe Fluent "CompletedSolid" glyph — the last-run chip (web Lucide <c>CheckCircle</c>).</summary>
    public const string LastRunGlyph = "\uEC61";

    /// <summary>Segoe Fluent "StatusErrorFull" glyph — the failures chip (web Lucide <c>XCircle</c>).</summary>
    public const string FailsGlyph = "\uEB90";

    /// <summary>Segoe Fluent "Next" glyph — the never-run chip (web Lucide <c>SkipForward</c>).</summary>
    public const string NeverRunGlyph = "\uE893";

    /// <summary>Segoe Fluent "Pin" glyph — the pin affordance when the automation is not pinned (web Lucide <c>Pin</c>).</summary>
    public const string PinGlyph = "\uE718";

    /// <summary>Segoe Fluent "UnPin" glyph — the pin affordance when the automation is pinned (web Lucide <c>PinOff</c>).</summary>
    public const string UnpinGlyph = "\uE77A";

    /// <summary>The pin affordance glyph for the current pinned state — unpin when pinned, pin otherwise.</summary>
    /// <param name="isPinned">Whether the automation is pinned.</param>
    public static string PinGlyphFor(bool isPinned) => isPinned ? UnpinGlyph : PinGlyph;
}
