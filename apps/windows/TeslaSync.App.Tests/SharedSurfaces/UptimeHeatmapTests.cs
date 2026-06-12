using System;
using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Status;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces.UptimeHeatmapSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>UptimeHeatmap</c> shared surface's UI-thread-free logic — the rolling uptime
/// percentage (healthy + maintenance days count as up), the interpolated / overridable heading, the threshold
/// caption colour (web's <c>&gt;= 99</c> green / <c>&gt;= 95</c> amber / else red tiers), the per-day palette tint,
/// localized status label, composed tooltip and accessible name, the always-rendered empty state, the optional
/// footnote, the i18n key coverage, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// one-for-one (<c>web/src/components/status/UptimeHeatmap.tsx</c>). The WinUI view itself (UptimeHeatmap.cs) is
/// exercised by the app build.
/// </summary>
public sealed class UptimeHeatmapTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static UptimeHeatmapDisplay Project(UptimeHeatmapModel model) =>
        UptimeHeatmapProjection.Project(model, Localizer);

    private static UptimeDay Day(string date, HealthStatus status, string? summary = null) =>
        new(date, status, summary);

    // ── registration (diagnostics slug + minted i18n keys) ───────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("UptimeHeatmap", UptimeHeatmapRegistration.Slug);

    [Theory]
    [InlineData(HealthStatus.Healthy, "translation.status.label.operational")]
    [InlineData(HealthStatus.Degraded, "translation.status.label.degraded")]
    [InlineData(HealthStatus.Unhealthy, "translation.status.label.outage")]
    [InlineData(HealthStatus.Unknown, "translation.status.label.unknown")]
    [InlineData(HealthStatus.Maintenance, "translation.status.label.maintenance")]
    public void Label_key_maps_each_status(HealthStatus status, string key) =>
        Assert.Equal(key, UptimeHeatmapRegistration.LabelKey(status));

    [Fact]
    public void Projection_requests_every_minted_i18n_key()
    {
        var recorder = new RecordingLocalizer();
        var model = new UptimeHeatmapModel(
            new[] { Day("2024-01-01", HealthStatus.Healthy), Day("2024-01-02", HealthStatus.Unhealthy) });

        UptimeHeatmapProjection.Project(model, recorder);

        Assert.Contains(UptimeHeatmapRegistration.TitleKey, recorder.Keys);
        Assert.Contains(UptimeHeatmapRegistration.CaptionKey, recorder.Keys);
        Assert.Contains(UptimeHeatmapRegistration.ListLabelKey, recorder.Keys);
        Assert.Contains(UptimeHeatmapRegistration.EmptyKey, recorder.Keys);
        Assert.Contains(UptimeHeatmapRegistration.LabelOperationalKey, recorder.Keys);
        Assert.Contains(UptimeHeatmapRegistration.LabelOutageKey, recorder.Keys);
    }

    // ── empty state (web days.length === 0) — the always-rendered empty branch ────────────────────────────

    [Fact]
    public void Empty_window_renders_the_friendly_empty_state()
    {
        UptimeHeatmapDisplay d = Project(UptimeHeatmapModel.Empty);

        Assert.False(d.HasDays);
        Assert.Empty(d.Cells);
        Assert.False(d.HasUptime);
        Assert.Equal(string.Empty, d.UptimeText);
        Assert.Equal("No status history yet", d.EmptyText);
        Assert.Equal("Uptime — last 0 days", d.Heading);
    }

    [Fact]
    public void Null_days_are_treated_as_empty()
    {
        UptimeHeatmapDisplay d = Project(new UptimeHeatmapModel(days: null));

        Assert.False(d.HasDays);
        Assert.Empty(d.Cells);
        Assert.False(d.HasUptime);
    }

    // ── heading (web title ?? `Uptime — last N days`) ─────────────────────────────────────────────────────

    [Fact]
    public void Heading_interpolates_the_day_count()
    {
        var days = new[]
        {
            Day("2024-01-01", HealthStatus.Healthy),
            Day("2024-01-02", HealthStatus.Healthy),
            Day("2024-01-03", HealthStatus.Degraded),
        };

        Assert.Equal("Uptime — last 3 days", Project(new UptimeHeatmapModel(days)).Heading);
    }

    [Fact]
    public void Heading_never_leaks_the_interpolation_token()
    {
        string heading = Project(new UptimeHeatmapModel(new[] { Day("2024-01-01", HealthStatus.Healthy) })).Heading;

        Assert.DoesNotContain("{{", heading, StringComparison.Ordinal);
        Assert.DoesNotContain("}}", heading, StringComparison.Ordinal);
    }

    [Fact]
    public void Title_override_replaces_the_default_heading()
    {
        var model = new UptimeHeatmapModel(
            new[] { Day("2024-01-01", HealthStatus.Healthy) },
            title: "API availability");

        Assert.Equal("API availability", Project(model).Heading);
    }

    // ── rolling uptime percentage (web uptimePct: healthy + maintenance count as up) ──────────────────────

    [Fact]
    public void Uptime_counts_healthy_and_maintenance_as_up()
    {
        var days = new[]
        {
            Day("2024-01-01", HealthStatus.Healthy),
            Day("2024-01-02", HealthStatus.Maintenance),
            Day("2024-01-03", HealthStatus.Unhealthy),
            Day("2024-01-04", HealthStatus.Healthy),
        };

        UptimeHeatmapDisplay d = Project(new UptimeHeatmapModel(days));

        Assert.True(d.HasUptime);
        Assert.Equal("75.00% uptime", d.UptimeText);   // 3 of 4 up → fmtPercent(75, 2)
    }

    [Fact]
    public void Uptime_caption_matches_the_scalar_formatter_at_two_decimals()
    {
        var days = new[]
        {
            Day("2024-01-01", HealthStatus.Healthy),
            Day("2024-01-02", HealthStatus.Healthy),
            Day("2024-01-03", HealthStatus.Unhealthy),
        };

        // 2 of 3 up → 66.66…% → fmtPercent(_, 2) rounds to 66.67%.
        string expected = $"{ScalarFormatters.FormatPercentage(2.0 / 3.0 * 100.0, 2)} uptime";
        Assert.Equal(expected, Project(new UptimeHeatmapModel(days)).UptimeText);
        Assert.Equal("66.67% uptime", Project(new UptimeHeatmapModel(days)).UptimeText);
    }

    // ── caption threshold colour (web >= 99 green / >= 95 amber / else red) ────────────────────────────────

    [Theory]
    [InlineData(100, "#22C55E")]
    [InlineData(99, "#22C55E")]    // lower bound inclusive
    [InlineData(98.99, "#FBBF24")]
    [InlineData(95, "#FBBF24")]    // lower bound inclusive
    [InlineData(94.99, "#EF4444")]
    [InlineData(0, "#EF4444")]
    public void Uptime_colour_follows_the_web_tiers(double percent, string hex) =>
        Assert.Equal(hex, UptimeHeatmapProjection.UptimeColorHex(percent));

    [Fact]
    public void Healthy_window_uses_the_green_caption_colour()
    {
        var days = new[] { Day("2024-01-01", HealthStatus.Healthy), Day("2024-01-02", HealthStatus.Healthy) };

        UptimeHeatmapDisplay d = Project(new UptimeHeatmapModel(days));

        Assert.Equal("100.00% uptime", d.UptimeText);
        Assert.Equal("#22C55E", d.UptimeColorHex);
    }

    // ── per-day square projection (web SQUARE_BG tint + STATUS_LABEL + tooltip + aria-label) ──────────────

    [Theory]
    [InlineData(HealthStatus.Healthy, "#22C55E", "Operational")]
    [InlineData(HealthStatus.Degraded, "#FBBF24", "Degraded")]
    [InlineData(HealthStatus.Unhealthy, "#EF4444", "Outage")]
    [InlineData(HealthStatus.Unknown, "#94A3B8", "Unknown")]
    [InlineData(HealthStatus.Maintenance, "#3B82F6", "Maintenance")]
    public void Day_cell_resolves_tint_and_localized_label(HealthStatus status, string hex, string label)
    {
        UptimeHeatmapDisplay d = Project(new UptimeHeatmapModel(new[] { Day("2024-03-09", status) }));
        UptimeDayCell cell = Assert.Single(d.Cells);

        Assert.Equal("2024-03-09", cell.Date);
        Assert.Equal(status, cell.Status);
        Assert.Equal(hex, cell.AccentHex);
        Assert.Equal(label, cell.StatusLabel);
    }

    [Fact]
    public void Day_cell_accessible_label_matches_the_web_aria_label()
    {
        UptimeDayCell cell = Assert.Single(Project(new UptimeHeatmapModel(new[] { Day("2024-03-09", HealthStatus.Unhealthy) })).Cells);

        // web: aria-label={`${day.date}: ${STATUS_LABEL[day.status]}`}
        Assert.Equal("2024-03-09: Outage", cell.AccessibleLabel);
    }

    [Fact]
    public void Day_cell_tooltip_omits_summary_when_absent()
    {
        UptimeDayCell cell = Assert.Single(Project(new UptimeHeatmapModel(new[] { Day("2024-03-09", HealthStatus.Healthy) })).Cells);

        Assert.Equal("2024-03-09: Operational", cell.TooltipText);
        Assert.Null(cell.Summary);
    }

    [Fact]
    public void Day_cell_tooltip_appends_summary_when_present()
    {
        UptimeDayCell cell = Assert.Single(
            Project(new UptimeHeatmapModel(new[] { Day("2024-03-09", HealthStatus.Unhealthy, "Brief API outage") })).Cells);

        Assert.Equal("2024-03-09: Outage — Brief API outage", cell.TooltipText);
        Assert.Equal("Brief API outage", cell.Summary);
    }

    [Fact]
    public void Cells_preserve_day_order_oldest_first()
    {
        var days = new[]
        {
            Day("2024-01-01", HealthStatus.Healthy),
            Day("2024-01-02", HealthStatus.Degraded),
            Day("2024-01-03", HealthStatus.Unhealthy),
        };

        UptimeHeatmapDisplay d = Project(new UptimeHeatmapModel(days));

        Assert.Collection(
            d.Cells,
            c => Assert.Equal("2024-01-01", c.Date),
            c => Assert.Equal("2024-01-02", c.Date),
            c => Assert.Equal("2024-01-03", c.Date));
    }

    // ── footnote (web optional footnote) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Footnote_is_hidden_when_absent()
    {
        UptimeHeatmapDisplay d = Project(new UptimeHeatmapModel(new[] { Day("2024-01-01", HealthStatus.Healthy) }));

        Assert.False(d.HasFootnote);
        Assert.Null(d.Footnote);
    }

    [Fact]
    public void Footnote_renders_when_supplied()
    {
        var model = new UptimeHeatmapModel(
            new[] { Day("2024-01-01", HealthStatus.Healthy) },
            footnote: "Synthesized prior to day-by-day history.");

        UptimeHeatmapDisplay d = Project(model);

        Assert.True(d.HasFootnote);
        Assert.Equal("Synthesized prior to day-by-day history.", d.Footnote);
    }

    // ── container + whole-surface accessibility ───────────────────────────────────────────────────────────

    [Fact]
    public void Squares_container_has_the_daily_history_list_label() =>
        Assert.Equal("Daily status history", Project(UptimeHeatmapModel.Empty).ListLabel);

    [Fact]
    public void Automation_name_combines_heading_and_uptime_when_populated()
    {
        var days = new[] { Day("2024-01-01", HealthStatus.Healthy), Day("2024-01-02", HealthStatus.Healthy) };

        Assert.Equal("Uptime — last 2 days. 100.00% uptime", Project(new UptimeHeatmapModel(days)).AutomationName);
    }

    [Fact]
    public void Automation_name_is_the_heading_alone_when_empty() =>
        Assert.Equal("Uptime — last 0 days", Project(UptimeHeatmapModel.Empty).AutomationName);

    [Fact]
    public void Automation_name_is_non_empty_in_every_branch()
    {
        Assert.False(string.IsNullOrWhiteSpace(Project(UptimeHeatmapModel.Empty).AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(
            Project(new UptimeHeatmapModel(new[] { Day("2024-01-01", HealthStatus.Degraded) })).AutomationName));
    }

    // ── BuildCell direct (the per-day projection entry) ───────────────────────────────────────────────────

    [Fact]
    public void BuildCell_projects_a_single_day()
    {
        UptimeDayCell cell = UptimeHeatmapProjection.BuildCell(Day("2024-05-01", HealthStatus.Maintenance, "Planned upgrade"), Localizer);

        Assert.Equal("2024-05-01", cell.Date);
        Assert.Equal("Maintenance", cell.StatusLabel);
        Assert.Equal("#3B82F6", cell.AccentHex);
        Assert.Equal("2024-05-01: Maintenance — Planned upgrade", cell.TooltipText);
    }

    // ── diagnostics (view.opened, PII-safe — never the day window or uptime) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new UptimeHeatmapDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UptimeHeatmap", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new UptimeHeatmapDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => UptimeHeatmapProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => UptimeHeatmapProjection.Project(UptimeHeatmapModel.Empty, null!));

    /// <summary>An <see cref="ILocalizer"/> that records every requested key and returns the English fallback.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
