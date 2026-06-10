using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SummaryStatsRow</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / ready), the four-tile composition, the secure/unsecure status tile, the
/// <c>timeSince</c> relative-time formatting, the zero-decimal grouped Sentry-uptime percent (web
/// <c>fmtInt</c>), the verbatim total-events count, the web-colour → token-brush mapping, the localized labels,
/// the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/security-access/SummaryStatsRow.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class SummaryStatsRowTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // A fixed reference clock so the timeSince branches are deterministic.
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);

    private static SummaryStatsRowModel Ready(
        bool isSecure = true,
        DateTimeOffset? lastLockChange = null,
        double sentryUptime = 97,
        int totalEvents = 128) =>
        new(false, isSecure, lastLockChange ?? Now.AddMinutes(-5), sentryUptime, totalEvents);

    private static SummaryStatsRowDisplay Project(SummaryStatsRowModel model) =>
        SummaryStatsRowProjection.Project(model, Localizer, Now);

    // ── Branch precedence: loading → ready (web isLoading gate) ──────────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(SummaryStatsRowState.Loading, Project(SummaryStatsRowModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var model = Ready() with { Loading = true };

        var display = Project(model);

        Assert.Equal(SummaryStatsRowState.Loading, display.State);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Ready_when_not_loading() =>
        Assert.Equal(SummaryStatsRowState.Ready, Project(Ready()).State);

    [Fact]
    public void Ready_renders_exactly_four_tiles_in_web_order()
    {
        var cards = Project(Ready()).Cards;

        Assert.Equal(4, cards.Count);
        Assert.Collection(
            cards,
            c => Assert.Equal("Current Status", c.Label),
            c => Assert.Equal("Last Lock Change", c.Label),
            c => Assert.Equal("Sentry Uptime", c.Label),
            c => Assert.Equal("Total Events", c.Label));
    }

    // ── Status tile: secure / unsecure value + accent ────────────────────────────────────────────────────

    [Fact]
    public void Status_tile_secure_uses_secure_word_and_success_accent()
    {
        var card = Project(Ready(isSecure: true)).Cards[0];

        Assert.Equal("Secure", card.Value);
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Success), card.AccentBrushKey);
    }

    [Fact]
    public void Status_tile_unsecure_uses_unsecure_word_and_danger_accent()
    {
        var card = Project(Ready(isSecure: false)).Cards[0];

        Assert.Equal("Unsecure", card.Value);
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Danger), card.AccentBrushKey);
    }

    // ── Last-lock tile: timeSince parity (helpers.ts) ────────────────────────────────────────────────────

    [Fact]
    public void Last_lock_just_now_under_one_minute() =>
        Assert.Equal("just now", LastLockValue(Now.AddSeconds(-30)));

    [Fact]
    public void Last_lock_just_now_at_zero_elapsed() =>
        Assert.Equal("just now", LastLockValue(Now));

    [Fact]
    public void Last_lock_minutes_ago() =>
        Assert.Equal("5m ago", LastLockValue(Now.AddMinutes(-5)));

    [Fact]
    public void Last_lock_minute_boundary_is_one_minute() =>
        // 60s is not < 60s ⇒ rolls to the minutes branch (1m), matching the web floor logic.
        Assert.Equal("1m ago", LastLockValue(Now.AddSeconds(-60)));

    [Fact]
    public void Last_lock_hours_ago() =>
        Assert.Equal("3h ago", LastLockValue(Now.AddHours(-3)));

    [Fact]
    public void Last_lock_hour_boundary_is_one_hour() =>
        Assert.Equal("1h ago", LastLockValue(Now.AddMinutes(-60)));

    [Fact]
    public void Last_lock_days_ago() =>
        Assert.Equal("2d ago", LastLockValue(Now.AddDays(-2)));

    [Fact]
    public void Last_lock_day_boundary_is_one_day() =>
        Assert.Equal("1d ago", LastLockValue(Now.AddHours(-24)));

    [Fact]
    public void Last_lock_null_is_em_dash() =>
        Assert.Equal("\u2014", LastLockValue(null));

    [Fact]
    public void Last_lock_future_instant_is_em_dash() =>
        Assert.Equal("\u2014", LastLockValue(Now.AddHours(1)));

    [Fact]
    public void Last_lock_tile_uses_cyan_accent() =>
        Assert.Equal("TsColorInfoBrush", Project(Ready()).Cards[1].AccentBrushKey);

    // ── Sentry-uptime tile: fmtInt + percent ─────────────────────────────────────────────────────────────

    [Fact]
    public void Sentry_uptime_rounds_to_zero_decimals_with_percent() =>
        // 98.6 → 99 (round half away from zero), suffixed "%".
        Assert.Equal("99%", Project(Ready(sentryUptime: 98.6)).Cards[2].Value);

    [Fact]
    public void Sentry_uptime_whole_value_has_no_decimals() =>
        Assert.Equal("100%", Project(Ready(sentryUptime: 100)).Cards[2].Value);

    [Fact]
    public void Sentry_uptime_zero() =>
        Assert.Equal("0%", Project(Ready(sentryUptime: 0)).Cards[2].Value);

    [Fact]
    public void Sentry_uptime_tile_uses_blue_accent() =>
        Assert.Equal("TsChartSpeedBrush", Project(Ready()).Cards[2].AccentBrushKey);

    // ── Total-events tile: verbatim integer (web renders the raw number, ungrouped) ──────────────────────

    [Fact]
    public void Total_events_renders_the_raw_integer() =>
        Assert.Equal("128", Project(Ready(totalEvents: 128)).Cards[3].Value);

    [Fact]
    public void Total_events_is_not_grouped() =>
        // web value={totalEvents} renders String(number) — no thousands separator.
        Assert.Equal("1500", Project(Ready(totalEvents: 1500)).Cards[3].Value);

    [Fact]
    public void Total_events_zero() =>
        Assert.Equal("0", Project(Ready(totalEvents: 0)).Cards[3].Value);

    [Fact]
    public void Total_events_tile_uses_purple_accent() =>
        Assert.Equal("TsChartPowerBrush", Project(Ready()).Cards[3].AccentBrushKey);

    // ── Accessibility: every tile + surface expose a meaningful Narrator name ─────────────────────────────

    [Fact]
    public void Each_tile_automation_name_pairs_label_and_value()
    {
        var cards = Project(Ready(isSecure: true, lastLockChange: Now.AddMinutes(-5), sentryUptime: 97, totalEvents: 128)).Cards;

        Assert.Equal("Current Status: Secure", cards[0].AutomationName);
        Assert.Equal("Last Lock Change: 5m ago", cards[1].AutomationName);
        Assert.Equal("Sentry Uptime: 97%", cards[2].AutomationName);
        Assert.Equal("Total Events: 128", cards[3].AutomationName);
    }

    [Fact]
    public void Surface_automation_name_joins_every_tile()
    {
        var display = Project(Ready(isSecure: true, lastLockChange: Now.AddMinutes(-5), sentryUptime: 97, totalEvents: 128));

        Assert.Equal(
            "Current Status: Secure. Last Lock Change: 5m ago. Sentry Uptime: 97%. Total Events: 128",
            display.AutomationName);
    }

    [Fact]
    public void Loading_surface_automation_name_is_the_loading_label() =>
        Assert.Equal("Loading...", Project(SummaryStatsRowModel.Pending).AutomationName);

    [Fact]
    public void Loading_label_uses_the_shared_common_loading_string() =>
        Assert.Equal("Loading...", Project(SummaryStatsRowModel.Pending).LoadingLabel);

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name()
    {
        Assert.All(
            new[] { Project(SummaryStatsRowModel.Pending), Project(Ready()) },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    // ── i18n: the projection feeds the web/source keys to the facade ─────────────────────────────────────

    [Fact]
    public void Projection_resolves_every_label_through_the_documented_keys()
    {
        var display = SummaryStatsRowProjection.Project(Ready(isSecure: true), new KeyEchoLocalizer(), Now);

        Assert.Equal("admin.security.stat.status", display.Cards[0].Label);
        Assert.Equal("admin.security.secure", display.Cards[0].Value);
        Assert.Equal("admin.security.stat.lastLock", display.Cards[1].Label);
        Assert.Equal("admin.security.stat.sentryUptime", display.Cards[2].Label);
        Assert.Equal("admin.security.stat.totalEvents", display.Cards[3].Label);
        Assert.Equal("common.loading", display.LoadingLabel);
    }

    [Fact]
    public void Unsecure_value_resolves_through_the_unsecure_key()
    {
        var display = SummaryStatsRowProjection.Project(Ready(isSecure: false), new KeyEchoLocalizer(), Now);

        Assert.Equal("admin.security.unsecure", display.Cards[0].Value);
    }

    [Fact]
    public void Relative_time_words_resolve_through_the_facade()
    {
        var echo = new KeyEchoLocalizer();

        // The "just now" word resolves through its key; the {n}m/h/d formats have no placeholder under KeyEcho
        // so they echo the key verbatim — proving the relative-time copy is not a bare English literal.
        Assert.Equal("time.justNow", SummaryStatsRowProjection.TimeSince(Now.AddSeconds(-10), Now, echo));
        Assert.Equal("time.minutesAgo", SummaryStatsRowProjection.TimeSince(Now.AddMinutes(-5), Now, echo));
        Assert.Equal("time.hoursAgo", SummaryStatsRowProjection.TimeSince(Now.AddHours(-3), Now, echo));
        Assert.Equal("time.daysAgo", SummaryStatsRowProjection.TimeSince(Now.AddDays(-2), Now, echo));
    }

    // ── Diagnostics (P1/S11): view.opened slug=SummaryStatsRow, PII-safe ─────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SummaryStatsRowDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SummaryStatsRow", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_security_figures()
    {
        var captured = new List<string>();
        var diagnostics = new SummaryStatsRowDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=SummaryStatsRow", line);
        Assert.DoesNotContain('%', line);
        Assert.DoesNotContain("Secure", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SummaryStatsRow", SummaryStatsRowRegistration.Slug);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => SummaryStatsRowProjection.Project(null!, Localizer, Now));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SummaryStatsRowProjection.Project(Ready(), null!, Now));

    [Fact]
    public void TimeSince_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => SummaryStatsRowProjection.TimeSince(Now, Now, null!));

    private static string LastLockValue(DateTimeOffset? when) =>
        // Build the model directly so an explicit null reaches the projection (the Ready() helper coalesces).
        Project(new SummaryStatsRowModel(false, true, when, 97, 128)).Cards[1].Value;

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the projection
    /// feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
