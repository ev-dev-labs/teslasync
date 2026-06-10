using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>NotificationRow</c> feature surface's UI-thread-free logic — the per-state
/// branch projection (loading / error / empty / stale / offline / ready), the read / unread + archived / restored
/// splits, the <c>rule?.severity ?? 'info'</c> default, the vehicle-name fallback (<c>display_name || #id</c>),
/// the timezone-mode pick (<c>vehicle ? 'vehicle' : 'user'</c>), the drill-through href (the web
/// <c>getAlertDrillthroughHref</c> SIGNAL_TO_PAGE map + synthetic alert), the i18n key resolution (passthrough
/// fallback and the resw <c>translation.*</c> catalog form), the composed accessible name, the freshness chips,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/NotificationRow.tsx). The WinUI view itself (NotificationRow.cs) is
/// exercised by the app build.
/// </summary>
public sealed class NotificationRowTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Created = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static NotificationRowLog Log(
        bool read = false,
        bool archived = false,
        string title = "Battery low",
        string message = "Battery at 15%",
        long id = 7) =>
        new(id, title, message, Created, read ? Created.AddMinutes(1) : null, archived ? Created.AddMinutes(2) : null);

    private static NotificationRowRule Rule(
        string severity = "warning",
        string? name = "Low battery rule",
        long vehicleId = 3,
        string? signal = "BatteryLevel",
        long id = 11) =>
        new(id, name, severity, vehicleId, signal);

    private static NotificationRowVehicle Vehicle(long id = 3, string? name = "Garage Model 3") => new(id, name);

    private static NotificationRowDisplay Project(NotificationRowModel model) =>
        NotificationRowProjection.Project(model, Localizer);

    // ── Branch precedence: loading → error → empty → freshness → ready ──────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(NotificationRowState.Loading, Project(NotificationRowModel.Loading()).State);

    [Fact]
    public void Error_when_model_failed() =>
        Assert.Equal(NotificationRowState.Error, Project(NotificationRowModel.Failed()).State);

    [Fact]
    public void Empty_when_model_is_empty() =>
        Assert.Equal(NotificationRowState.Empty, Project(NotificationRowModel.Empty()).State);

    [Fact]
    public void Ready_when_log_present() =>
        Assert.Equal(NotificationRowState.Ready, Project(NotificationRowModel.Ready(Log())).State);

    [Fact]
    public void Fresh_ready_with_no_log_collapses_to_empty() =>
        Assert.Equal(
            NotificationRowState.Empty,
            Project(new NotificationRowModel(NotificationRowState.Ready, null)).State);

    [Fact]
    public void Stale_keeps_its_branch_with_a_log() =>
        Assert.Equal(NotificationRowState.Stale, Project(NotificationRowModel.Stale(Log())).State);

    [Fact]
    public void Offline_keeps_its_branch_with_a_log() =>
        Assert.Equal(NotificationRowState.Offline, Project(NotificationRowModel.Offline(Log())).State);

    [Fact]
    public void Stale_with_no_log_collapses_to_empty() =>
        Assert.Equal(
            NotificationRowState.Empty,
            Project(new NotificationRowModel(NotificationRowState.Stale, null)).State);

    [Fact]
    public void Offline_with_no_log_collapses_to_empty() =>
        Assert.Equal(
            NotificationRowState.Empty,
            Project(new NotificationRowModel(NotificationRowState.Offline, null)).State);

    // ── Read / unread (web Boolean(log.read_at)) ───────────────────────────────────────────────────────────

    [Fact]
    public void Unread_log_offers_mark_read()
    {
        var display = Project(NotificationRowModel.Ready(Log(read: false)));

        Assert.True(display.IsUnread);
        Assert.False(display.IsRead);
        Assert.True(display.ShowMarkRead);
        Assert.False(display.ShowMarkUnread);
    }

    [Fact]
    public void Read_log_offers_mark_unread()
    {
        var display = Project(NotificationRowModel.Ready(Log(read: true)));

        Assert.False(display.IsUnread);
        Assert.True(display.IsRead);
        Assert.False(display.ShowMarkRead);
        Assert.True(display.ShowMarkUnread);
    }

    // ── Archived / restored (web Boolean(log.archived_at)) ─────────────────────────────────────────────────

    [Fact]
    public void Active_log_offers_archive()
    {
        var display = Project(NotificationRowModel.Ready(Log(archived: false)));

        Assert.False(display.IsArchived);
        Assert.True(display.ShowArchive);
        Assert.False(display.ShowUnarchive);
    }

    [Fact]
    public void Archived_log_offers_restore()
    {
        var display = Project(NotificationRowModel.Ready(Log(archived: true)));

        Assert.True(display.IsArchived);
        Assert.False(display.ShowArchive);
        Assert.True(display.ShowUnarchive);
    }

    [Fact]
    public void Non_row_states_show_no_per_row_actions()
    {
        var display = Project(NotificationRowModel.Loading());

        Assert.False(display.ShowMarkRead);
        Assert.False(display.ShowMarkUnread);
        Assert.False(display.ShowArchive);
        Assert.False(display.ShowUnarchive);
        Assert.False(display.HasDrill);
    }

    // ── Severity: web rule?.severity ?? 'info' ─────────────────────────────────────────────────────────────

    [Fact]
    public void Severity_defaults_to_info_without_a_rule()
    {
        var display = Project(NotificationRowModel.Ready(Log()));

        Assert.Equal("info", display.Severity);
        Assert.Equal("TsColorInfoBrush", display.SeverityAccentBrushKey);
    }

    [Theory]
    [InlineData("warning", "TsColorWarningBrush")]
    [InlineData("critical", "TsColorDangerBrush")]
    [InlineData("info", "TsColorInfoBrush")]
    [InlineData("success", "TsColorSuccessBrush")]
    public void Severity_and_accent_come_from_the_rule(string severity, string expectedKey)
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule(severity: severity)));

        Assert.Equal(severity, display.Severity);
        Assert.Equal(expectedKey, display.SeverityAccentBrushKey);
    }

    [Fact]
    public void Blank_rule_severity_falls_back_to_info() =>
        Assert.Equal("info", Project(NotificationRowModel.Ready(Log(), Rule(severity: " "))).Severity);

    // ── Vehicle chip: web vehicle.display_name || `#${vehicle.id}` ──────────────────────────────────────────

    [Fact]
    public void Vehicle_chip_uses_display_name()
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule(), Vehicle(name: "Roadster")));

        Assert.True(display.ShowVehicle);
        Assert.Equal("Roadster", display.VehicleName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Vehicle_chip_falls_back_to_hash_id(string? name)
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule(), Vehicle(id: 42, name: name)));

        Assert.Equal("#42", display.VehicleName);
    }

    [Fact]
    public void No_vehicle_hides_the_vehicle_chip()
    {
        var display = Project(NotificationRowModel.Ready(Log()));

        Assert.False(display.ShowVehicle);
        Assert.Equal(string.Empty, display.VehicleName);
    }

    [Fact]
    public void Vehicle_name_helper_uses_display_name() =>
        Assert.Equal("Garage Model 3", NotificationRowProjection.VehicleName(Vehicle()));

    [Fact]
    public void Vehicle_name_helper_falls_back_to_hash_id() =>
        Assert.Equal("#9", NotificationRowProjection.VehicleName(new NotificationRowVehicle(9, null)));

    // ── Timezone mode: web vehicle ? 'vehicle' : 'user' ────────────────────────────────────────────────────

    [Fact]
    public void Timezone_is_vehicle_when_a_vehicle_is_known() =>
        Assert.Equal(
            NotificationRowTimeZone.Vehicle,
            Project(NotificationRowModel.Ready(Log(), Rule(), Vehicle())).TimeZone);

    [Fact]
    public void Timezone_is_user_when_no_vehicle_is_known() =>
        Assert.Equal(NotificationRowTimeZone.User, Project(NotificationRowModel.Ready(Log())).TimeZone);

    // ── Rule-name chip ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Rule_name_chip_is_shown_when_present()
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule(name: "Tire pressure")));

        Assert.True(display.ShowRuleName);
        Assert.Equal("Tire pressure", display.RuleName);
    }

    [Fact]
    public void Rule_name_chip_is_hidden_when_absent()
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule(name: null)));

        Assert.False(display.ShowRuleName);
        Assert.Equal(string.Empty, display.RuleName);
    }

    // ── Title / message passthrough ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_and_message_are_passed_through_verbatim()
    {
        var display = Project(NotificationRowModel.Ready(Log(title: "Charging complete", message: "Reached 80%")));

        Assert.Equal("Charging complete", display.Title);
        Assert.Equal("Reached 80%", display.Message);
        Assert.True(display.HasMessage);
    }

    [Fact]
    public void Empty_message_is_flagged_so_the_view_omits_it() =>
        Assert.False(Project(NotificationRowModel.Ready(Log(message: ""))).HasMessage);

    [Fact]
    public void Id_is_forwarded_from_the_log() =>
        Assert.Equal(99, Project(NotificationRowModel.Ready(Log(id: 99))).Id);

    [Fact]
    public void Selection_state_is_forwarded() =>
        Assert.True(Project(NotificationRowModel.Ready(Log(), selected: true)).Selected);

    // ── Drill-through: web getAlertDrillthroughHref(synthetic) ─────────────────────────────────────────────

    [Fact]
    public void Drill_is_absent_without_a_rule()
    {
        var display = Project(NotificationRowModel.Ready(Log()));

        Assert.False(display.HasDrill);
        Assert.Equal(string.Empty, display.DrillHref);
    }

    [Fact]
    public void Drill_is_present_with_a_rule()
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule(signal: "BatteryLevel"), Vehicle(id: 3)));

        Assert.True(display.HasDrill);
        Assert.StartsWith("battery?", display.DrillHref, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("BatteryLevel", "battery")]
    [InlineData("ChargeState", "charging")]
    [InlineData("VehicleSpeed", "drives")]
    [InlineData("InsideTemp", "climate-control")]
    [InlineData("TpmsPressureFl", "tire-pressure")]
    [InlineData("SentryMode", "security-access")]
    [InlineData("DestinationName", "navigation")]
    public void Known_signals_map_to_their_context_page(string signal, string expectedPath)
    {
        var model = NotificationRowModel.Ready(Log(), Rule(signal: signal), Vehicle(id: 3));

        Assert.Equal(expectedPath, NotificationRowDrillthrough.For(model).Path);
    }

    [Fact]
    public void Unknown_signal_falls_back_to_the_signal_explorer()
    {
        var model = NotificationRowModel.Ready(Log(), Rule(signal: "TotallyUnknownSignal"), Vehicle(id: 3));

        Assert.Equal("signal-explorer", NotificationRowDrillthrough.For(model).Path);
    }

    [Fact]
    public void Drill_query_forwards_vehicle_then_time_then_signal_in_web_order()
    {
        var model = NotificationRowModel.Ready(Log(), Rule(signal: "BatteryLevel"), Vehicle(id: 3));
        var query = NotificationRowDrillthrough.For(model).Query;

        Assert.Collection(
            query,
            kv => Assert.Equal(new KeyValuePair<string, string>("vehicle_id", "3"), kv),
            kv => Assert.Equal(new KeyValuePair<string, string>("t", Created.ToString("o", CultureInfo.InvariantCulture)), kv),
            kv => Assert.Equal(new KeyValuePair<string, string>("signal", "BatteryLevel"), kv));
    }

    [Fact]
    public void Drill_uses_the_rule_vehicle_id_when_no_vehicle_prop_is_supplied()
    {
        var model = NotificationRowModel.Ready(Log(), Rule(vehicleId: 5, signal: "BatteryLevel"));
        var query = NotificationRowDrillthrough.For(model).Query;

        Assert.Contains(new KeyValuePair<string, string>("vehicle_id", "5"), query);
    }

    [Fact]
    public void Drill_omits_the_vehicle_id_when_it_is_not_positive()
    {
        var model = NotificationRowModel.Ready(Log(), Rule(vehicleId: 0, signal: "BatteryLevel"));
        var query = NotificationRowDrillthrough.For(model).Query;

        Assert.DoesNotContain(query, kv => kv.Key == "vehicle_id");
    }

    [Fact]
    public void Drill_omits_the_signal_when_the_rule_has_none()
    {
        var model = NotificationRowModel.Ready(Log(), Rule(signal: null), Vehicle(id: 3));
        var drill = NotificationRowDrillthrough.For(model);

        Assert.Equal("signal-explorer", drill.Path);
        Assert.DoesNotContain(drill.Query, kv => kv.Key == "signal");
    }

    [Fact]
    public void Drill_href_is_path_only_when_there_is_no_query() =>
        Assert.Equal(
            "signal-explorer",
            new NotificationRowDrillthrough("signal-explorer", Array.Empty<KeyValuePair<string, string>>()).Href);

    [Fact]
    public void Drill_href_url_encodes_each_query_pair()
    {
        var drill = new NotificationRowDrillthrough(
            "battery",
            new[]
            {
                new KeyValuePair<string, string>("vehicle_id", "3"),
                new KeyValuePair<string, string>("signal", "Battery Level"),
            });

        Assert.Equal("battery?vehicle_id=3&signal=Battery%20Level", drill.Href);
    }

    // ── Labels resolve through the i18n facade to the web English fallbacks ─────────────────────────────────

    [Fact]
    public void Action_labels_resolve_to_the_web_english_fallbacks()
    {
        var display = Project(NotificationRowModel.Ready(Log(), Rule()));

        Assert.Equal("Select notification", display.SelectLabel);
        Assert.Equal("Mark as read", display.MarkReadLabel);
        Assert.Equal("Mark as unread", display.MarkUnreadLabel);
        Assert.Equal("Archive", display.ArchiveLabel);
        Assert.Equal("Restore", display.UnarchiveLabel);
        Assert.Equal("View context", display.ViewContextLabel);
    }

    [Fact]
    public void State_copy_resolves_to_the_web_english_fallbacks()
    {
        Assert.Equal("Loading...", Project(NotificationRowModel.Loading()).LoadingLabel);
        Assert.Equal("No notifications", Project(NotificationRowModel.Empty()).EmptyMessage);
        Assert.Equal("Failed to load data", Project(NotificationRowModel.Failed()).ErrorTitle);
        Assert.Equal("Retry", Project(NotificationRowModel.Failed()).RetryLabel);
    }

    [Fact]
    public void Error_message_falls_back_to_the_default_when_none_supplied() =>
        Assert.Equal(
            "Check your internet connection and try again.",
            Project(NotificationRowModel.Failed()).ErrorMessage);

    [Fact]
    public void Error_message_uses_the_supplied_message() =>
        Assert.Equal("Service unavailable", Project(NotificationRowModel.Failed("Service unavailable")).ErrorMessage);

    [Fact]
    public void Labels_resolve_from_the_resw_catalog_keys()
    {
        // Production resolves the catalog's translation.* keys; the projection must feed those exact keys.
        var display = NotificationRowProjection.Project(NotificationRowModel.Ready(Log(), Rule()), new ReswLocalizer());

        Assert.Equal("Select notification", display.SelectLabel);
        Assert.Equal("Mark as read", display.MarkReadLabel);
        Assert.Equal("Mark as unread", display.MarkUnreadLabel);
        Assert.Equal("Archive", display.ArchiveLabel);
        Assert.Equal("Restore", display.UnarchiveLabel);
        Assert.Equal("View context", display.ViewContextLabel);
        Assert.Equal("No notifications", display.EmptyMessage);
    }

    [Fact]
    public void Stale_chip_resolves_through_the_facade_fallback_when_absent_from_the_catalog()
    {
        // The catalog has no translation.common.stale entry; the facade returns the English fallback, exactly as
        // the web's i18next returns the key's default.
        var display = NotificationRowProjection.Project(NotificationRowModel.Stale(Log()), new ReswLocalizer());

        Assert.Equal("Stale", display.FreshnessChipText);
    }

    // ── Freshness chips ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_has_no_freshness_chip() =>
        Assert.False(Project(NotificationRowModel.Ready(Log())).ShowFreshnessChip);

    [Fact]
    public void Stale_shows_a_warning_stale_chip()
    {
        var display = Project(NotificationRowModel.Stale(Log()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Stale", display.FreshnessChipText);
        Assert.Equal(StatusKind.Warning, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_shows_a_danger_offline_chip()
    {
        var display = Project(NotificationRowModel.Offline(Log()));

        Assert.True(display.ShowFreshnessChip);
        Assert.Equal("Offline", display.FreshnessChipText);
        Assert.Equal(StatusKind.Danger, display.FreshnessChipStatus);
    }

    [Fact]
    public void Offline_keeps_the_cached_row()
    {
        var display = Project(NotificationRowModel.Offline(Log(title: "Sentry triggered"), Rule(severity: "critical")));

        Assert.Equal("Sentry triggered", display.Title);
        Assert.Equal("critical", display.Severity);
        Assert.True(display.ShowArchive);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name + interactive labels ──────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(NotificationRowModel.Loading()),
                Project(NotificationRowModel.Empty()),
                Project(NotificationRowModel.Failed()),
                Project(NotificationRowModel.Stale(Log())),
                Project(NotificationRowModel.Offline(Log())),
                Project(NotificationRowModel.Ready(Log(), Rule(), Vehicle())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", Project(NotificationRowModel.Loading()).AutomationName);

    [Fact]
    public void Empty_automation_name_is_the_empty_message() =>
        Assert.Equal("No notifications", Project(NotificationRowModel.Empty()).AutomationName);

    [Fact]
    public void Error_automation_name_is_the_error_title() =>
        Assert.Equal("Failed to load data", Project(NotificationRowModel.Failed()).AutomationName);

    [Fact]
    public void Ready_automation_name_carries_severity_title_message_vehicle_and_rule()
    {
        var display = Project(NotificationRowModel.Ready(
            Log(title: "Battery low", message: "Battery at 15%"),
            Rule(severity: "warning", name: "Low battery rule"),
            Vehicle(name: "Garage Model 3")));

        Assert.Equal(
            "warning. Battery low. Battery at 15%. Garage Model 3. Low battery rule",
            display.AutomationName);
    }

    [Fact]
    public void Stale_automation_name_includes_the_chip() =>
        Assert.Contains("Stale", Project(NotificationRowModel.Stale(Log())).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Offline_automation_name_includes_the_chip() =>
        Assert.Contains(
            "Offline", Project(NotificationRowModel.Offline(Log())).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Interactive_elements_expose_non_empty_labels()
    {
        // The view assigns these to the checkbox and each action button's Narrator name.
        var display = Project(NotificationRowModel.Ready(Log(read: false, archived: false), Rule()));

        Assert.All(
            new[]
            {
                display.SelectLabel,
                display.MarkReadLabel,
                display.ArchiveLabel,
                display.ViewContextLabel,
            },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    // ── Diagnostics (P1/S11): view.opened slug=NotificationRow, PII-safe ───────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new NotificationRowDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=NotificationRow", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_notification_content()
    {
        var captured = new List<string>();
        var diagnostics = new NotificationRowDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("Battery", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Garage", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_line_is_culture_invariant()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            var captured = new List<string>();
            new NotificationRowDiagnostics(captured.Add).RecordViewOpened();
            Assert.Equal("view.opened slug=NotificationRow", Assert.Single(captured));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("NotificationRow", NotificationRowRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => NotificationRowProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => NotificationRowProjection.Project(NotificationRowModel.Loading(), null!));

    [Fact]
    public void Ready_rejects_a_null_log() =>
        Assert.Throws<ArgumentNullException>(() => NotificationRowModel.Ready(null!));

    [Fact]
    public void Stale_rejects_a_null_log() =>
        Assert.Throws<ArgumentNullException>(() => NotificationRowModel.Stale(null!));

    [Fact]
    public void Offline_rejects_a_null_log() =>
        Assert.Throws<ArgumentNullException>(() => NotificationRowModel.Offline(null!));

    [Fact]
    public void Vehicle_name_helper_rejects_a_null_vehicle() =>
        Assert.Throws<ArgumentNullException>(() => NotificationRowProjection.VehicleName(null!));

    [Fact]
    public void Drillthrough_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => NotificationRowDrillthrough.For(null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves the row's keys to the <c>Strings/{lang}/Resources.resw</c>
    /// English catalog values (as production does), and the English fallback for every other key — proving the
    /// projection feeds the exact catalog keys, and that the <c>common.stale</c> key (absent from the catalog)
    /// still resolves via the fallback.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            NotificationRowProjection.SelectKey => "Select notification",
            NotificationRowProjection.MarkReadKey => "Mark as read",
            NotificationRowProjection.MarkUnreadKey => "Mark as unread",
            NotificationRowProjection.ArchiveKey => "Archive",
            NotificationRowProjection.UnarchiveKey => "Restore",
            NotificationRowProjection.ViewContextKey => "View context",
            NotificationRowProjection.LoadingKey => "Loading...",
            NotificationRowProjection.EmptyKey => "No notifications",
            NotificationRowProjection.ErrorTitleKey => "Failed to load data",
            NotificationRowProjection.ErrorMessageKey => "Check your internet connection and try again.",
            NotificationRowProjection.RetryKey => "Retry",
            NotificationRowProjection.OfflineKey => "Offline",
            _ => fallback,
        };
    }
}
