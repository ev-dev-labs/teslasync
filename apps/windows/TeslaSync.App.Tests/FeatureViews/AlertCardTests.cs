using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AlertCard</c> feature surface's UI-thread-free logic — the per-branch
/// projection (read / unread, acknowledged / not, named / anonymous acknowledgement), the type-glyph map and
/// its bell fallback, the humanised type label, the relative-time tiers, the i18n key resolution (passthrough
/// fallback and the resw <c>translation.*</c> catalog form, including the bare <c>Mark read</c> fallback), the
/// composed accessible name, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/AlertCard.tsx). The WinUI view itself (AlertCard.cs) is exercised
/// by the app build.
/// </summary>
public sealed class AlertCardTests
{
    // Segoe Fluent glyphs the projection maps web Lucide icons onto.
    private const string LocationGlyph = "\uE707";
    private const string BatteryGlyph = "\uE83F";
    private const string ChargingGlyph = "\uE945";
    private const string SecurityGlyph = "\uEA18";
    private const string TireGlyph = "\uEA3A";
    private const string BellGlyph = "\uEA8F";

    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AlertCardModel Model(
        string type = "low_battery",
        string severity = "warning",
        string title = "Battery low",
        string message = "Battery at 15%",
        bool isRead = false,
        DateTimeOffset? createdAt = null,
        DateTimeOffset? acknowledgedAt = null,
        string? acknowledgedBy = null,
        string drillHref = "/battery?vehicle_id=1") =>
        new(type, severity, title, message, isRead, createdAt ?? Now.AddMinutes(-5), acknowledgedAt, acknowledgedBy, drillHref);

    private static AlertCardDisplay Project(AlertCardModel model) =>
        AlertCardProjection.Project(model, Localizer, Now);

    // ── Read / unread branch (web `!alert.is_read`) ─────────────────────────────────────────────────────

    [Fact]
    public void Unread_alert_shows_the_status_dot_and_mark_read()
    {
        var display = Project(Model(isRead: false));

        Assert.True(display.IsUnread);
        Assert.False(display.IsRead);
        Assert.True(display.ShowMarkRead);
    }

    [Fact]
    public void Read_alert_hides_the_status_dot_and_mark_read()
    {
        var display = Project(Model(isRead: true));

        Assert.False(display.IsUnread);
        Assert.True(display.IsRead);
        Assert.False(display.ShowMarkRead);
    }

    // ── Acknowledgement branch (web `Boolean(alert.acknowledged_at)`) ───────────────────────────────────

    [Fact]
    public void Unacknowledged_alert_offers_the_acknowledge_action()
    {
        var display = Project(Model(acknowledgedAt: null));

        Assert.False(display.IsAcknowledged);
        Assert.Null(display.AckBadgeText);
        Assert.False(display.PrimaryActionIsReopen);
        Assert.Equal("Acknowledge", display.PrimaryActionLabel);
    }

    [Fact]
    public void Acknowledged_alert_offers_the_reopen_action()
    {
        var display = Project(Model(acknowledgedAt: Now.AddMinutes(-1)));

        Assert.True(display.IsAcknowledged);
        Assert.True(display.PrimaryActionIsReopen);
        Assert.Equal("Reopened", display.PrimaryActionLabel);
    }

    [Fact]
    public void Acknowledged_by_actor_uses_the_named_badge_with_interpolation()
    {
        var display = Project(Model(acknowledgedAt: Now.AddMinutes(-1), acknowledgedBy: "Alice"));

        Assert.Equal("Acknowledged by Alice", display.AckBadgeText);
    }

    [Fact]
    public void Acknowledged_anonymously_uses_the_anonymous_badge()
    {
        var display = Project(Model(acknowledgedAt: Now.AddMinutes(-1), acknowledgedBy: null));

        Assert.Equal("Acknowledged", display.AckBadgeText);
    }

    [Fact]
    public void Acknowledged_with_blank_actor_falls_back_to_the_anonymous_badge()
    {
        var display = Project(Model(acknowledgedAt: Now.AddMinutes(-1), acknowledgedBy: string.Empty));

        Assert.Equal("Acknowledged", display.AckBadgeText);
    }

    // ── Type glyph map (web TYPE_ICONS + bell fallback) ─────────────────────────────────────────────────

    [Theory]
    [InlineData("geofence_exit", LocationGlyph)]
    [InlineData("geofence_enter", LocationGlyph)]
    [InlineData("low_battery", BatteryGlyph)]
    [InlineData("battery_high", BatteryGlyph)]
    [InlineData("charging_complete", ChargingGlyph)]
    [InlineData("sentry_event", SecurityGlyph)]
    [InlineData("tire_pressure_low", TireGlyph)]
    public void Type_glyph_matches_the_web_icon_map(string type, string expected) =>
        Assert.Equal(expected, AlertCardRegistration.TypeGlyph(type));

    [Theory]
    [InlineData("totally_unknown_type")]
    [InlineData("")]
    [InlineData(null)]
    public void Unknown_or_missing_type_falls_back_to_the_bell(string? type) =>
        Assert.Equal(BellGlyph, AlertCardRegistration.TypeGlyph(type));

    [Fact]
    public void Display_carries_the_projected_type_glyph() =>
        Assert.Equal(ChargingGlyph, Project(Model(type: "charging_cost")).TypeGlyph);

    // ── Type label (web `(type ?? 'notification').replace(/_/g, ' ')`) ─────────────────────────────────

    [Theory]
    [InlineData("low_battery", "low battery")]
    [InlineData("system_tesla_api", "system tesla api")]
    [InlineData("temperature", "temperature")]
    public void Type_label_replaces_underscores_with_spaces(string type, string expected) =>
        Assert.Equal(expected, AlertCardProjection.TypeLabel(type));

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Type_label_coerces_missing_type_to_notification(string? type) =>
        Assert.Equal("notification", AlertCardProjection.TypeLabel(type));

    // ── Relative time (web bespoke getTimeAgo tiers) ────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "0m ago")]
    [InlineData(30, "30m ago")]
    [InlineData(59, "59m ago")]
    public void Time_ago_under_an_hour_is_minutes(int minutesAgo, string expected) =>
        Assert.Equal(expected, AlertCardProjection.FormatTimeAgo(Now.AddMinutes(-minutesAgo), Now));

    [Theory]
    [InlineData(60, "1h ago")]
    [InlineData(90, "1h ago")]
    [InlineData(1439, "23h ago")]
    public void Time_ago_under_a_day_is_hours(int minutesAgo, string expected) =>
        Assert.Equal(expected, AlertCardProjection.FormatTimeAgo(Now.AddMinutes(-minutesAgo), Now));

    [Theory]
    [InlineData(24, "1d ago")]
    [InlineData(50, "2d ago")]
    public void Time_ago_a_day_or_more_is_days(int hoursAgo, string expected) =>
        Assert.Equal(expected, AlertCardProjection.FormatTimeAgo(Now.AddHours(-hoursAgo), Now));

    [Fact]
    public void Time_ago_does_not_group_large_day_counts() =>
        Assert.Equal("1000d ago", AlertCardProjection.FormatTimeAgo(Now.AddDays(-1000), Now));

    [Fact]
    public void Display_carries_the_projected_time_ago() =>
        Assert.Equal("5m ago", Project(Model(createdAt: Now.AddMinutes(-5))).TimeAgoText);

    // ── Labels resolve through the i18n facade to the web English fallbacks ─────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_english_fallbacks()
    {
        var display = Project(Model(acknowledgedAt: null));

        Assert.Equal("View context", display.ViewContextLabel);
        Assert.Equal("Audit timeline", display.AuditTimelineLabel);
        Assert.Equal("Acknowledge", display.PrimaryActionLabel);
        Assert.Equal("Mark read", display.MarkReadLabel);
        Assert.Equal("Unread", display.UnreadLabel);
    }

    [Fact]
    public void Severity_accent_brush_key_is_projected_from_the_severity()
    {
        Assert.Equal("TsColorWarningBrush", Project(Model(severity: "warning")).SeverityAccentBrushKey);
        Assert.Equal("TsColorDangerBrush", Project(Model(severity: "critical")).SeverityAccentBrushKey);
        Assert.Equal("TsColorInfoBrush", Project(Model(severity: "info")).SeverityAccentBrushKey);
    }

    [Fact]
    public void Severity_and_drill_href_are_forwarded_verbatim()
    {
        var display = Project(Model(severity: "critical", drillHref: "/charging?vehicle_id=2&t=now"));

        Assert.Equal("critical", display.Severity);
        Assert.Equal("/charging?vehicle_id=2&t=now", display.DrillHref);
    }

    [Fact]
    public void Labels_resolve_from_the_resw_catalog_keys()
    {
        // Production resolves the catalog's translation.* keys; the projection must feed those exact keys.
        var display = AlertCardProjection.Project(Model(acknowledgedAt: Now.AddMinutes(-1), acknowledgedBy: "Bob"), new ReswLocalizer(), Now);

        Assert.Equal("View context", display.ViewContextLabel);
        Assert.Equal("Audit timeline", display.AuditTimelineLabel);
        Assert.Equal("Reopened", display.PrimaryActionLabel);
        Assert.Equal("Acknowledged by Bob", display.AckBadgeText);
        Assert.Equal("Unread", display.UnreadLabel);
    }

    [Fact]
    public void Mark_read_resolves_through_the_facade_fallback_when_absent_from_the_catalog()
    {
        // The catalog has no translation."Mark read" entry; the facade returns the English fallback, exactly
        // as the web's i18next returns the key as its own default.
        var display = AlertCardProjection.Project(Model(), new ReswLocalizer(), Now);

        Assert.Equal("Mark read", display.MarkReadLabel);
    }

    // ── Accessibility: a single, meaningful composed Narrator name per alert ────────────────────────────

    [Fact]
    public void Automation_name_carries_title_message_severity_type_and_time()
    {
        var display = Project(Model(
            title: "Battery low",
            message: "Battery at 15%",
            severity: "warning",
            type: "low_battery",
            createdAt: Now.AddMinutes(-5)));

        Assert.Contains("Battery low", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Battery at 15%", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("warning", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("low battery", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Unread_automation_name_is_prefixed_with_the_unread_label() =>
        Assert.StartsWith("Unread.", Project(Model(isRead: false)).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Read_automation_name_is_not_prefixed_with_the_unread_label() =>
        Assert.DoesNotContain("Unread", Project(Model(isRead: true)).AutomationName, StringComparison.Ordinal);

    [Fact]
    public void Acknowledged_automation_name_carries_the_acknowledged_badge()
    {
        var display = Project(Model(acknowledgedAt: Now.AddMinutes(-1), acknowledgedBy: "Alice"));

        Assert.Contains("Acknowledged by Alice", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_branch_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(Model(isRead: false)),
                Project(Model(isRead: true)),
                Project(Model(acknowledgedAt: Now.AddMinutes(-1))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    // ── Diagnostics (P1/S11): view.opened slug=AlertCard, PII-safe ─────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AlertCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AlertCard", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_alert_content()
    {
        var captured = new List<string>();
        var diagnostics = new AlertCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("Alice", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Battery", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AlertCard", AlertCardRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => AlertCardProjection.Project(null!, Localizer, Now));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => AlertCardProjection.Project(Model(), null!, Now));

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves the card's <c>translation.*</c> keys to the
    /// <c>Strings/{lang}/Resources.resw</c> English catalog values (as production does), and the English
    /// fallback for every other key — proving the projection feeds the exact catalog keys, and that the bare
    /// <c>Mark read</c> key (absent from the catalog) still resolves via the fallback.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            AlertCardProjection.ViewContextKey => "View context",
            AlertCardProjection.AckedByKey => "Acknowledged by {0}",
            AlertCardProjection.AckedByAnonymousKey => "Acknowledged",
            AlertCardProjection.AuditTimelineKey => "Audit timeline",
            AlertCardProjection.ReopenedKey => "Reopened",
            AlertCardProjection.AcknowledgeKey => "Acknowledge",
            AlertCardProjection.UnreadKey => "Unread",
            _ => fallback,
        };
    }
}
