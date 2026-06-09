using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.WeeklyDigest;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AlertsSection</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / content), the per-severity row build (title-casing, grouped counts,
/// semantic classification, the <c>Badge</c> variant + icon glyph maps), the warning total badge gating,
/// the donut chart summary, the i18n key resolution (passthrough fallback and the resw <c>translation.*</c>
/// catalog form), the per-state accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx). The WinUI view itself
/// (AlertsSection.cs) is exercised by the app build.
/// </summary>
public sealed class AlertsSectionTests
{
    private const string WarningTriangle = "\uE7BA";
    private const string CriticalCircle = "\uEA39";
    private const string InfoCircle = "\uE946";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AlertsSectionModel Content(params (string Severity, long Count)[] tallies)
    {
        var rows = new List<AlertSeverityCount>(tallies.Length);
        long total = 0;
        foreach (var (severity, count) in tallies)
        {
            rows.Add(new AlertSeverityCount(severity, count));
            total += count;
        }

        return new AlertsSectionModel(false, total, rows);
    }

    private static AlertsSectionDisplay Project(AlertsSectionModel model) =>
        AlertsSectionProjection.Project(model, Localizer);

    // ── Branch precedence: loading → empty → content (web data lifecycle) ──────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(AlertsSectionState.Loading, Project(AlertsSectionModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_alerts()
    {
        var model = new AlertsSectionModel(true, 5, new[] { new AlertSeverityCount("critical", 5) });

        Assert.Equal(AlertsSectionState.Loading, Project(model).State);
    }

    [Fact]
    public void Empty_when_alert_total_is_zero() =>
        Assert.Equal(AlertsSectionState.Empty, Project(AlertsSectionModel.Empty).State);

    [Fact]
    public void Content_when_alerts_present()
    {
        var display = Project(Content(("critical", 2), ("warning", 3)));

        Assert.Equal(AlertsSectionState.Content, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    // ── Rows: order, title-casing, grouped counts (web Object.entries + capitalize + fmtInt) ────────────

    [Fact]
    public void Rows_preserve_alerts_by_type_insertion_order()
    {
        var display = Project(Content(("warning", 1), ("critical", 2), ("info", 3)));

        Assert.Collection(
            display.Rows,
            r => Assert.Equal("Warning", r.Label),
            r => Assert.Equal("Critical", r.Label),
            r => Assert.Equal("Info", r.Label));
    }

    [Fact]
    public void Row_label_capitalizes_only_the_first_character()
    {
        var row = Assert.Single(Project(Content(("critical", 1))).Rows);

        Assert.Equal("Critical", row.Label);
    }

    [Fact]
    public void Row_count_groups_thousands_like_fmt_int()
    {
        var row = Assert.Single(Project(Content(("warning", 1234))).Rows);

        Assert.Equal("1,234", row.CountText);
    }

    // ── Severity classification (web ALERT_SEVERITY_COLORS keys + fallback) ────────────────────────────

    [Theory]
    [InlineData("critical", AlertSeverityClass.Critical)]
    [InlineData("warning", AlertSeverityClass.Warning)]
    [InlineData("info", AlertSeverityClass.Info)]
    [InlineData("emergency", AlertSeverityClass.Other)]
    [InlineData("", AlertSeverityClass.Other)]
    public void Classify_maps_severity_to_its_class(string severity, AlertSeverityClass expected) =>
        Assert.Equal(expected, AlertsSectionProjection.Classify(severity));

    [Fact]
    public void Classify_is_case_insensitive() =>
        Assert.Equal(AlertSeverityClass.Critical, AlertsSectionProjection.Classify("CRITICAL"));

    [Fact]
    public void Row_class_follows_the_severity()
    {
        var display = Project(Content(("critical", 1), ("warning", 1), ("info", 1), ("other", 1)));

        Assert.Equal(AlertSeverityClass.Critical, display.Rows[0].Class);
        Assert.Equal(AlertSeverityClass.Warning, display.Rows[1].Class);
        Assert.Equal(AlertSeverityClass.Info, display.Rows[2].Class);
        Assert.Equal(AlertSeverityClass.Other, display.Rows[3].Class);
    }

    // ── Badge variant map: web ternary critical→danger, warning→warning, else→info ─────────────────────

    [Theory]
    [InlineData(AlertSeverityClass.Critical, StatusKind.Danger)]
    [InlineData(AlertSeverityClass.Warning, StatusKind.Warning)]
    [InlineData(AlertSeverityClass.Info, StatusKind.Info)]
    [InlineData(AlertSeverityClass.Other, StatusKind.Info)]
    public void Badge_status_follows_the_web_ternary(AlertSeverityClass severityClass, StatusKind expected) =>
        Assert.Equal(expected, AlertsSectionProjection.BadgeStatusFor(severityClass));

    [Fact]
    public void Row_badge_status_is_projected()
    {
        var display = Project(Content(("critical", 1), ("other", 1)));

        Assert.Equal(StatusKind.Danger, display.Rows[0].BadgeStatus);
        Assert.Equal(StatusKind.Info, display.Rows[1].BadgeStatus); // unknown → info, like the web fallback
    }

    // ── Row icon glyphs (web AlertCircle / AlertTriangle / Info; none for unknown) ─────────────────────

    [Theory]
    [InlineData(AlertSeverityClass.Critical, CriticalCircle)]
    [InlineData(AlertSeverityClass.Warning, WarningTriangle)]
    [InlineData(AlertSeverityClass.Info, InfoCircle)]
    public void Row_glyph_matches_the_web_icon(AlertSeverityClass severityClass, string expected) =>
        Assert.Equal(expected, AlertsSectionRegistration.RowGlyph(severityClass));

    [Fact]
    public void Unknown_severity_row_has_no_icon() =>
        Assert.Null(AlertsSectionRegistration.RowGlyph(AlertSeverityClass.Other));

    // ── Warning total badge: web shows it only when alertTotal > 0, grouped ────────────────────────────

    [Fact]
    public void Total_badge_text_is_grouped_when_alerts_present()
    {
        var model = new AlertsSectionModel(false, 1500, new[] { new AlertSeverityCount("warning", 1500) });

        Assert.Equal("1,500", Project(model).TotalBadgeText);
    }

    [Fact]
    public void Total_badge_text_is_null_in_the_empty_state() =>
        Assert.Null(Project(AlertsSectionModel.Empty).TotalBadgeText);

    // ── Section labels / copy resolve through the facade ───────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_english_fallbacks()
    {
        var display = Project(Content(("info", 1)));

        Assert.Equal("Alerts", display.Title);
        Assert.Equal("Alerts by Severity", display.BySeverityLabel);
        Assert.Equal("Alert Distribution", display.DistributionLabel);
    }

    [Fact]
    public void Empty_message_uses_the_web_no_alerts_copy()
    {
        var display = Project(AlertsSectionModel.Empty);

        Assert.Equal("No alerts this week \u2014 everything looks great!", display.EmptyMessage);
        Assert.Equal(AlertsSectionProjection.NoAlertsFallback, display.EmptyMessage);
    }

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading", Project(AlertsSectionModel.Pending).LoadingLabel);

    [Fact]
    public void Labels_resolve_from_the_resw_catalog_keys()
    {
        // Production resolves the catalog's translation.* keys; the projection must feed those exact keys.
        var display = AlertsSectionProjection.Project(Content(("info", 1)), new ReswLocalizer());

        Assert.Equal("Alerts", display.Title);
        Assert.Equal("Alerts by Severity", display.BySeverityLabel);
        Assert.Equal("Alert Distribution", display.DistributionLabel);
        Assert.Equal("No alerts this week \u2014 everything looks great!", Project(AlertsSectionModel.Empty).EmptyMessage);
    }

    // ── Donut chart summary (Narrator description of the distribution) ──────────────────────────────────

    [Fact]
    public void Chart_summary_lists_every_severity_and_count()
    {
        var display = Project(Content(("critical", 2), ("warning", 3), ("info", 1)));

        Assert.Equal("Critical 2, Warning 3, Info 1", display.ChartSummary);
    }

    [Fact]
    public void Chart_summary_is_empty_when_there_are_no_rows() =>
        Assert.Equal(string.Empty, Project(AlertsSectionModel.Empty).ChartSummary);

    // ── Accessibility: every state exposes a meaningful Narrator name ──────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name() =>
        Assert.All(
            new[]
            {
                Project(AlertsSectionModel.Pending),
                Project(AlertsSectionModel.Empty),
                Project(Content(("critical", 1))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));

    [Fact]
    public void Loading_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading", Project(AlertsSectionModel.Pending).AutomationName);

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_copy()
    {
        var display = Project(AlertsSectionModel.Empty);

        Assert.Equal($"{display.Title}. {display.EmptyMessage}", display.AutomationName);
    }

    [Fact]
    public void Content_automation_name_carries_title_total_section_and_rows()
    {
        var display = Project(Content(("critical", 2), ("warning", 3)));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.TotalBadgeText!, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.BySeverityLabel, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.ChartSummary, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Row_automation_name_carries_label_and_count()
    {
        var row = Assert.Single(Project(Content(("critical", 7))).Rows);

        Assert.Equal("Critical, 7", row.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=AlertsSection, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AlertsSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AlertsSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_alert_counts()
    {
        var captured = new List<string>();
        var diagnostics = new AlertsSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=AlertsSection", line);
        Assert.DoesNotContain(line, c => char.IsDigit(c));
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AlertsSection", AlertsSectionRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => AlertsSectionProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => AlertsSectionProjection.Project(AlertsSectionModel.Pending, null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves the section's <c>translation.*</c> keys to the
    /// <c>Strings/{lang}/Resources.resw</c> English catalog values (as production does), and the English
    /// fallback for every other key — proving the projection feeds the exact catalog keys.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            AlertsSectionProjection.TitleKey => "Alerts",
            AlertsSectionProjection.NoAlertsKey => "No alerts this week \u2014 everything looks great!",
            AlertsSectionProjection.BySeverityKey => "Alerts by Severity",
            AlertsSectionProjection.DistributionKey => "Alert Distribution",
            _ => fallback,
        };
    }
}
