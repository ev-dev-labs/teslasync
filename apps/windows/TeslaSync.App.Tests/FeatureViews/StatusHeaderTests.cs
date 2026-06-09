using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StatusHeader</c> feature surface's UI-thread-free logic — the two-branch
/// projection (loading em dashes vs. resolved counts), the replayable filter, the replay-mode chip, the
/// conditional disabled-replay banner, the localized labels + i18n key set, the accessible names, and the
/// diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/dlq-inspector/StatusHeader.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class StatusHeaderTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static DlqListSnapshot Snapshot(int count = 0, bool enabled = false, params bool[] replayable)
    {
        var entries = new List<DlqEntrySummary>(replayable.Length);
        foreach (var flag in replayable)
        {
            entries.Add(new DlqEntrySummary(flag));
        }

        return new DlqListSnapshot(count, enabled, entries);
    }

    private static StatusHeaderDisplay Project(StatusHeaderModel model) =>
        StatusHeaderProjection.Project(model, Localizer);

    // ── Loading branch (web `loading` → every value is an em dash, no banner) ───────────────────────

    [Fact]
    public void Loading_shows_an_em_dash_for_every_tile_and_no_banner()
    {
        var display = Project(StatusHeaderModel.Initial);

        Assert.Equal(StatusHeaderState.Loading, display.State);
        Assert.Collection(
            display.Cards,
            c => Assert.Equal(EmDash, c.Value),
            c => Assert.Equal(EmDash, c.Value),
            c => Assert.Equal(EmDash, c.Value));
        Assert.False(display.ShowBanner);
    }

    [Fact]
    public void Loading_hides_the_banner_even_when_the_data_says_replay_is_disabled()
    {
        // Web `{!loading && !enabled && (...)}` — the leading !loading gate keeps the banner hidden while
        // the query is still in flight, regardless of the (stale) replay flag.
        var display = Project(new StatusHeaderModel(true, Snapshot(count: 9, enabled: false)));

        Assert.Equal(StatusHeaderState.Loading, display.State);
        Assert.False(display.ShowBanner);
    }

    // ── Ready branch: counts, replayable filter, replay-mode chip ───────────────────────────────────

    [Fact]
    public void Ready_with_data_formats_the_counts_and_marks_replay_enabled()
    {
        var display = Project(new StatusHeaderModel(false, Snapshot(count: 12, enabled: true, true, true, false)));

        Assert.Equal(StatusHeaderState.Ready, display.State);
        Assert.Equal("12", display.Cards[0].Value);
        Assert.Equal("2", display.Cards[1].Value);
        Assert.Equal("Enabled", display.Cards[2].Value);
        Assert.False(display.ShowBanner);
    }

    [Fact]
    public void Replayable_counts_only_entries_flagged_replayable()
    {
        // Web `(data?.entries ?? []).filter((e) => e.replayable).length` — 3 of 5 are replayable.
        var display = Project(new StatusHeaderModel(false, Snapshot(count: 5, enabled: true, true, false, true, true, false)));

        Assert.Equal("3", display.Cards[1].Value);
    }

    [Fact]
    public void Disabled_replay_renders_the_disabled_chip_and_shows_the_banner()
    {
        var display = Project(new StatusHeaderModel(false, Snapshot(count: 4, enabled: false, true)));

        Assert.Equal("Disabled", display.Cards[2].Value);
        Assert.True(display.ShowBanner);
    }

    [Fact]
    public void Absent_response_renders_zeros_and_the_disabled_banner_never_a_blank_box()
    {
        // Web `data: DLQListResponse | undefined` undefined → count 0, replayable 0, replay disabled.
        var display = Project(new StatusHeaderModel(false, null));

        Assert.Equal(StatusHeaderState.Ready, display.State);
        Assert.Equal("0", display.Cards[0].Value);
        Assert.Equal("0", display.Cards[1].Value);
        Assert.Equal("Disabled", display.Cards[2].Value);
        Assert.True(display.ShowBanner);
    }

    [Theory]
    [InlineData(true, false, false)]   // loading, disabled  → no banner (loading gate)
    [InlineData(true, true, false)]    // loading, enabled   → no banner
    [InlineData(false, true, false)]   // ready, enabled     → no banner
    [InlineData(false, false, true)]   // ready, disabled    → banner
    public void Banner_is_shown_only_when_ready_and_replay_is_disabled(bool loading, bool enabled, bool expected)
    {
        var display = Project(new StatusHeaderModel(loading, Snapshot(count: 1, enabled: enabled)));

        Assert.Equal(expected, display.ShowBanner);
    }

    [Theory]
    [InlineData(0, "0")]
    [InlineData(7, "7")]
    [InlineData(12345, "12,345")]
    [InlineData(1000000, "1,000,000")]
    public void Counts_format_with_locale_grouping_like_fmtInt(int count, string expected)
    {
        var display = Project(new StatusHeaderModel(false, Snapshot(count: count, enabled: true)));

        Assert.Equal(expected, display.Cards[0].Value);
    }

    // ── Label / sub-line / glyph parity with the three web StatCards ────────────────────────────────

    [Fact]
    public void Cards_match_the_web_labels_sublabels_and_icons()
    {
        var cards = Project(new StatusHeaderModel(false, Snapshot(count: 1, enabled: true))).Cards;

        Assert.Collection(
            cards,
            c =>
            {
                Assert.Equal("Total entries", c.Label);
                Assert.Equal("in dead-letter queue", c.Sublabel);
                Assert.Equal(StatusHeaderProjection.InboxGlyph, c.Glyph);
            },
            c =>
            {
                Assert.Equal("Replayable", c.Label);
                Assert.Equal("parsed with source topic", c.Sublabel);
                Assert.Equal(StatusHeaderProjection.ShieldGlyph, c.Glyph);
            },
            c =>
            {
                Assert.Equal("Replay mode", c.Label);
                Assert.Equal("DLQ_REPLAY_ENABLED env", c.Sublabel);
                Assert.Equal(StatusHeaderProjection.AlertGlyph, c.Glyph);
            });
    }

    [Fact]
    public void Banner_title_and_message_match_the_web_copy()
    {
        var display = Project(new StatusHeaderModel(false, Snapshot(count: 1, enabled: false)));

        Assert.Equal("DLQ replay is disabled", display.BannerTitle);
        Assert.Equal(
            "The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result=\"disabled\".",
            display.BannerMessage);
    }

    // ── i18n: every key from the web source resolves with the same default (P1/S10 catalog) ─────────

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        // Disabled+ready exercises the replay-mode "Disabled" chip and both banner strings; enabled+ready
        // exercises the "Enabled" chip. Together they cover every t() call in the web source.
        StatusHeaderProjection.Project(new StatusHeaderModel(false, Snapshot(count: 1, enabled: false)), recorder);
        StatusHeaderProjection.Project(new StatusHeaderModel(false, Snapshot(count: 1, enabled: true)), recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["admin.dlq.stats.total"] = "Total entries",
            ["admin.dlq.stats.totalSub"] = "in dead-letter queue",
            ["admin.dlq.stats.replayable"] = "Replayable",
            ["admin.dlq.stats.replayableSub"] = "parsed with source topic",
            ["admin.dlq.stats.replayMode"] = "Replay mode",
            ["admin.dlq.stats.replayModeSub"] = "DLQ_REPLAY_ENABLED env",
            ["admin.dlq.stats.enabled"] = "Enabled",
            ["admin.dlq.stats.disabled"] = "Disabled",
            ["admin.dlq.banners.disabledTitle"] = "DLQ replay is disabled",
            ["admin.dlq.banners.disabledMessage"] =
                "The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result=\"disabled\".",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    // ── Accessibility: every tile and the surface expose a non-empty Narrator name ──────────────────

    [Fact]
    public void Every_card_exposes_a_descriptive_automation_name()
    {
        var cards = Project(new StatusHeaderModel(false, Snapshot(count: 8, enabled: true, true))).Cards;

        Assert.All(cards, card => Assert.False(string.IsNullOrWhiteSpace(card.AutomationName)));
        Assert.Equal("Total entries: 8. in dead-letter queue", cards[0].AutomationName);
        Assert.Equal("Replayable: 1. parsed with source topic", cards[1].AutomationName);
        Assert.Equal("Replay mode: Enabled. DLQ_REPLAY_ENABLED env", cards[2].AutomationName);
    }

    [Fact]
    public void Surface_automation_name_includes_the_banner_title_only_when_shown()
    {
        var disabled = Project(new StatusHeaderModel(false, Snapshot(count: 1, enabled: false)));
        Assert.False(string.IsNullOrWhiteSpace(disabled.AutomationName));
        Assert.Contains("DLQ replay is disabled", disabled.AutomationName, StringComparison.Ordinal);

        var enabled = Project(new StatusHeaderModel(false, Snapshot(count: 1, enabled: true)));
        Assert.False(string.IsNullOrWhiteSpace(enabled.AutomationName));
        Assert.DoesNotContain("DLQ replay is disabled", enabled.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=StatusHeader, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new StatusHeaderDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatusHeader", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("StatusHeader", StatusHeaderRegistration.Slug);
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback and records each requested key.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return fallback;
        }
    }
}
