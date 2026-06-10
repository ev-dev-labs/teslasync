using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveStatusPill</c> feature surface's UI-thread-free logic — the per-state
/// <c>TONE</c> mapping (tier colour, token brush, Segoe Fluent glyph, pulse flag and lowercase state token),
/// the <c>relative(now, lastUpdateAt)</c> age tiers (em dash, "just now" under five seconds, then
/// "<c>{s}s ago</c>" / "<c>{m}m ago</c>" / "<c>{h}h ago</c>"), the localized label and composed Narrator
/// aria-label, the PII-safe diagnostics and the registration metadata. Mirrors the web spec
/// (web/src/features/system/components/status/LiveStatusPill.tsx). The WinUI view itself
/// (feature-views\LiveStatusPill\LiveStatusPill.cs) is exercised by the app build.
/// </summary>
public sealed class LiveStatusPillTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static LiveStatusPillDisplay Project(
        StatusLiveState state,
        DateTimeOffset? lastUpdateAt,
        ILocalizer? localizer = null) =>
        LiveStatusPillProjection.Project(new LiveStatusPillModel(state, lastUpdateAt), localizer ?? Localizer, Now);

    private static LiveStatusPillDisplay ProjectAge(StatusLiveState state, int? ageSeconds) =>
        Project(state, ageSeconds is { } a ? Now.AddSeconds(-a) : null);

    // ── Colour tier (web `TONE[state]` hues: live=green, reconnecting=amber, offline=zinc) ────────────

    [Theory]
    [InlineData(StatusLiveState.Live, StatusKind.Success)]
    [InlineData(StatusLiveState.Reconnecting, StatusKind.Warning)]
    [InlineData(StatusLiveState.Offline, StatusKind.Neutral)]
    public void Tier_matches_the_web_tone(StatusLiveState state, StatusKind expected)
    {
        Assert.Equal(expected, LiveStatusPillProjection.Tier(state));
        Assert.Equal(expected, ProjectAge(state, 1).Tier);
    }

    [Theory]
    [InlineData(StatusLiveState.Live, "TsColorSuccessBrush")]
    [InlineData(StatusLiveState.Reconnecting, "TsColorWarningBrush")]
    [InlineData(StatusLiveState.Offline, "TsColorTextSecondaryBrush")]
    public void AccentBrushKey_maps_each_tier_to_its_token_brush(StatusLiveState state, string expectedKey)
    {
        Assert.Equal(expectedKey, ProjectAge(state, 1).AccentBrushKey);
    }

    // ── Icon glyph (web Lucide Activity / Wifi / WifiOff → Segoe Fluent) ───────────────────────────────

    [Theory]
    [InlineData(StatusLiveState.Live, "\uE9D2")]
    [InlineData(StatusLiveState.Reconnecting, "\uE701")]
    [InlineData(StatusLiveState.Offline, "\uEB5E")]
    public void Glyph_maps_each_state_to_its_fluent_icon(StatusLiveState state, string expectedGlyph)
    {
        Assert.Equal(expectedGlyph, LiveStatusPillProjection.GlyphFor(state));
        Assert.Equal(expectedGlyph, ProjectAge(state, 1).IconGlyph);
    }

    // ── Pulse (web `TONE[state].pulse` — only while reconnecting) ──────────────────────────────────────

    [Theory]
    [InlineData(StatusLiveState.Live, false)]
    [InlineData(StatusLiveState.Reconnecting, true)]
    [InlineData(StatusLiveState.Offline, false)]
    public void Pulse_is_set_only_while_reconnecting(StatusLiveState state, bool expected)
    {
        Assert.Equal(expected, LiveStatusPillProjection.Pulses(state));
        Assert.Equal(expected, ProjectAge(state, 1).Pulse);
    }

    // ── State token (web `data-status-live-state`) ────────────────────────────────────────────────────

    [Theory]
    [InlineData(StatusLiveState.Live, "live")]
    [InlineData(StatusLiveState.Reconnecting, "reconnecting")]
    [InlineData(StatusLiveState.Offline, "offline")]
    public void StateToken_is_the_lowercase_web_data_attribute(StatusLiveState state, string expected)
    {
        Assert.Equal(expected, LiveStatusPillProjection.StateToken(state));
        Assert.Equal(expected, ProjectAge(state, 1).StateToken);
    }

    // ── Relative "updated" label (web `relative(now, lastUpdateAt)`) ───────────────────────────────────

    [Theory]
    [InlineData(0, "just now")]
    [InlineData(4, "just now")]    // upper edge of the "just now" band (web `secs < 5`)
    [InlineData(5, "5s ago")]      // first second past it
    [InlineData(30, "30s ago")]
    [InlineData(59, "59s ago")]    // upper edge of the seconds band (web `secs < 60`)
    [InlineData(60, "1m ago")]
    [InlineData(119, "1m ago")]    // floor(119 / 60) == 1
    [InlineData(120, "2m ago")]
    [InlineData(3599, "59m ago")]  // upper edge of the minutes band (web `secs < 3600`)
    [InlineData(3600, "1h ago")]
    [InlineData(7200, "2h ago")]
    [InlineData(86400, "24h ago")] // floor(86400 / 3600) == 24
    public void Relative_label_matches_the_web_tiers(int ageSeconds, string expected)
    {
        Assert.Equal(expected, LiveStatusPillProjection.FormatRelative(Now.AddSeconds(-ageSeconds), Now, Localizer));
        Assert.Equal(expected, ProjectAge(StatusLiveState.Live, ageSeconds).RelativeText);
    }

    [Fact]
    public void Relative_label_is_an_em_dash_before_the_first_update()
    {
        Assert.Equal("\u2014", LiveStatusPillProjection.FormatRelative(null, Now, Localizer));
        Assert.Equal("\u2014", ProjectAge(StatusLiveState.Offline, null).RelativeText);
    }

    [Fact]
    public void Relative_label_clamps_a_future_timestamp_to_just_now()
    {
        // Web `Math.max(0, Math.floor(...))` floors a negative age (clock skew) to zero → "just now".
        Assert.Equal("just now", LiveStatusPillProjection.FormatRelative(Now.AddSeconds(10), Now, Localizer));
    }

    // ── Per-state "snapshot": each state renders a complete, distinct display ──────────────────────────

    [Fact]
    public void Live_state_renders_a_complete_display()
    {
        var d = Project(StatusLiveState.Live, Now.AddSeconds(-2));

        Assert.Equal(StatusLiveState.Live, d.State);
        Assert.Equal("live", d.StateToken);
        Assert.Equal(StatusKind.Success, d.Tier);
        Assert.Equal("TsColorSuccessBrush", d.AccentBrushKey);
        Assert.Equal("\uE9D2", d.IconGlyph);
        Assert.False(d.Pulse);
        Assert.Equal("Live", d.Label);
        Assert.Equal("just now", d.RelativeText);
        Assert.Equal("Live status stream: Live, updated just now", d.AutomationName);
    }

    [Fact]
    public void Reconnecting_state_renders_a_complete_display()
    {
        var d = Project(StatusLiveState.Reconnecting, Now.AddSeconds(-30));

        Assert.Equal(StatusLiveState.Reconnecting, d.State);
        Assert.Equal("reconnecting", d.StateToken);
        Assert.Equal(StatusKind.Warning, d.Tier);
        Assert.Equal("TsColorWarningBrush", d.AccentBrushKey);
        Assert.Equal("\uE701", d.IconGlyph);
        Assert.True(d.Pulse);
        Assert.Equal("Reconnecting", d.Label);
        Assert.Equal("30s ago", d.RelativeText);
        Assert.Equal("Live status stream: Reconnecting, updated 30s ago", d.AutomationName);
    }

    [Fact]
    public void Offline_state_renders_a_complete_display()
    {
        var d = Project(StatusLiveState.Offline, null);

        Assert.Equal(StatusLiveState.Offline, d.State);
        Assert.Equal("offline", d.StateToken);
        Assert.Equal(StatusKind.Neutral, d.Tier);
        Assert.Equal("TsColorTextSecondaryBrush", d.AccentBrushKey);
        Assert.Equal("\uEB5E", d.IconGlyph);
        Assert.False(d.Pulse);
        Assert.Equal("Offline", d.Label);
        Assert.Equal("\u2014", d.RelativeText);
        Assert.Equal("Live status stream: Offline, updated \u2014", d.AutomationName);
    }

    // ── Accessibility (Narrator name == the composed web `aria-label`) ─────────────────────────────────

    [Fact]
    public void AutomationName_composes_the_aria_label()
    {
        Assert.Equal(
            "Live status stream: Reconnecting, updated 30s ago",
            Project(StatusLiveState.Reconnecting, Now.AddSeconds(-30)).AutomationName);
    }

    [Theory]
    [InlineData(StatusLiveState.Live)]
    [InlineData(StatusLiveState.Reconnecting)]
    [InlineData(StatusLiveState.Offline)]
    public void AutomationName_is_never_blank(StatusLiveState state)
    {
        Assert.False(string.IsNullOrWhiteSpace(ProjectAge(state, 10).AutomationName));
    }

    // ── i18n: every string routes through the localizer (no hardcoded English) ─────────────────────────

    [Theory]
    [InlineData(StatusLiveState.Live, "system.liveStatus.label.live", "Live")]
    [InlineData(StatusLiveState.Reconnecting, "system.liveStatus.label.reconnecting", "Reconnecting")]
    [InlineData(StatusLiveState.Offline, "system.liveStatus.label.offline", "Offline")]
    public void Label_resolves_through_its_keyed_call_site(StatusLiveState state, string key, string fallback)
    {
        var fake = new RecordingLocalizer();

        var label = LiveStatusPillProjection.Label(state, fake);

        Assert.Contains(key, fake.Keys);
        Assert.Equal(fallback, fake.FallbackFor(key));
        Assert.Equal($"__{key}__", label);
    }

    [Fact]
    public void Project_routes_label_relative_and_aria_label_through_the_localizer()
    {
        var fake = new RecordingLocalizer();

        Project(StatusLiveState.Reconnecting, Now.AddSeconds(-30), fake);

        Assert.Contains("system.liveStatus.label.reconnecting", fake.Keys);
        Assert.Contains("system.liveStatus.ago", fake.Keys);
        Assert.Contains("system.liveStatus.ariaLabel", fake.Keys);
    }

    [Fact]
    public void Just_now_band_routes_through_the_justNow_key()
    {
        var fake = new RecordingLocalizer();

        Project(StatusLiveState.Live, Now.AddSeconds(-1), fake);

        Assert.Contains("system.liveStatus.justNow", fake.Keys);
    }

    [Fact]
    public void Localized_copy_passes_through_verbatim_with_no_hardcoded_english()
    {
        // Non-ASCII translations must reach every visible slot, proving the surface contributes no hardcoded
        // English; only the s/m/h unit letters mirror the web source's own literals.
        var fake = new RecordingLocalizer(new Dictionary<string, string>
        {
            ["system.liveStatus.label.reconnecting"] = "再接続",
            ["system.liveStatus.ago"] = "前",
            ["system.liveStatus.ariaLabel"] = "{0} / {1}",
        });

        var d = Project(StatusLiveState.Reconnecting, Now.AddSeconds(-30), fake);

        Assert.Equal("再接続", d.Label);
        Assert.Equal("30s 前", d.RelativeText);
        Assert.Equal("再接続 / 30s 前", d.AutomationName);
    }

    // ── Model defaults ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_named_instances_match_the_web_hook_states()
    {
        Assert.Equal(StatusLiveState.Reconnecting, LiveStatusPillModel.Connecting.State);
        Assert.Null(LiveStatusPillModel.Connecting.LastUpdateAt);
        Assert.Equal(StatusLiveState.Offline, LiveStatusPillModel.Offline.State);
        Assert.Null(LiveStatusPillModel.Offline.LastUpdateAt);
    }

    // ── Null-argument guards ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model()
    {
        Assert.Throws<ArgumentNullException>(() =>
            LiveStatusPillProjection.Project(null!, Localizer, Now));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            LiveStatusPillProjection.Project(LiveStatusPillModel.Connecting, null!, Now));
    }

    [Fact]
    public void FormatRelative_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            LiveStatusPillProjection.FormatRelative(Now, Now, null!));
    }

    [Fact]
    public void Label_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => LiveStatusPillProjection.Label(StatusLiveState.Live, null!));
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveStatusPill, PII-safe ────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveStatusPillDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveStatusPill", captured[0]);
        Assert.Equal("view.opened slug=LiveStatusPill", captured[1]);
    }

    // ── Registration metadata ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_glyphs_keys_and_fallbacks()
    {
        Assert.Equal("LiveStatusPill", LiveStatusPillRegistration.Slug);

        Assert.Equal("\uE9D2", LiveStatusPillRegistration.ActivityGlyph);
        Assert.Equal("\uE701", LiveStatusPillRegistration.WifiGlyph);
        Assert.Equal("\uEB5E", LiveStatusPillRegistration.OfflineGlyph);

        Assert.Equal("system.liveStatus.label.live", LiveStatusPillRegistration.LiveLabelKey);
        Assert.Equal("Live", LiveStatusPillRegistration.LiveLabelFallback);
        Assert.Equal("system.liveStatus.label.reconnecting", LiveStatusPillRegistration.ReconnectingLabelKey);
        Assert.Equal("Reconnecting", LiveStatusPillRegistration.ReconnectingLabelFallback);
        Assert.Equal("system.liveStatus.label.offline", LiveStatusPillRegistration.OfflineLabelKey);
        Assert.Equal("Offline", LiveStatusPillRegistration.OfflineLabelFallback);

        Assert.Equal("system.liveStatus.justNow", LiveStatusPillRegistration.JustNowKey);
        Assert.Equal("just now", LiveStatusPillRegistration.JustNowFallback);
        Assert.Equal("system.liveStatus.ago", LiveStatusPillRegistration.AgoKey);
        Assert.Equal("ago", LiveStatusPillRegistration.AgoFallback);

        Assert.Equal("system.liveStatus.ariaLabel", LiveStatusPillRegistration.AriaLabelKey);
        Assert.Equal("Live status stream: {0}, updated {1}", LiveStatusPillRegistration.AriaLabelFallback);

        Assert.Equal("\u2014", LiveStatusPillRegistration.EmDash);
        Assert.Equal("\u00B7", LiveStatusPillRegistration.MiddleDot);
    }

    /// <summary>An <see cref="ILocalizer"/> test double that records every key/fallback it is asked for and
    /// returns either a configured translation or a per-key sentinel, so the keyed call sites are asserted
    /// headlessly.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string>? _map;
        private readonly Dictionary<string, string> _fallbacks = new();

        public RecordingLocalizer(IReadOnlyDictionary<string, string>? map = null) => _map = map;

        public List<string> Keys { get; } = new();

        public string FallbackFor(string key) => _fallbacks[key];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            _fallbacks[key] = fallback;
            if (_map is not null && _map.TryGetValue(key, out var translation))
            {
                return translation;
            }

            return $"__{key}__";
        }
    }
}
