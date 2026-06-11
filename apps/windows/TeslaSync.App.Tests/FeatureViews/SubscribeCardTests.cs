using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SubscribeCard</c> feature surface's UI-thread-free logic — the canonical
/// channel catalog (the web five <c>ChannelTile</c>s), the source → projection adapter, the Ready/Empty state
/// branches, the responsive column breakpoint (web <c>grid-cols-1 sm:grid-cols-2</c>), the localized labels +
/// i18n key set, the documented <c>to</c>-path → native-route mapping, the per-tile Narrator names, and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/features/system/components/status/SubscribeCard.tsx). The
/// WinUI view itself (feature-views\SubscribeCard\SubscribeCard.cs) is exercised by the app build.
/// </summary>
public sealed class SubscribeCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SubscribeCardDisplay ProjectCanonical(ILocalizer? localizer = null) =>
        SubscribeCardProjection.Project(new SubscribeCardChannelSource().GetChannels(), localizer ?? Localizer);

    // ── Adapter: the canonical source projects to the five web tiles, in order ───────────────────────

    [Fact]
    public void Canonical_source_exposes_the_five_web_channels_in_order()
    {
        var channels = new SubscribeCardChannelSource().GetChannels();

        Assert.Equal(5, channels.Count);
        Assert.Collection(
            channels,
            c => Assert.Equal("Email", c.LabelFallback),
            c => Assert.Equal("Slack", c.LabelFallback),
            c => Assert.Equal("Discord", c.LabelFallback),
            c => Assert.Equal("Webhook", c.LabelFallback),
            c => Assert.Equal("Browser push", c.LabelFallback));
    }

    [Fact]
    public void Projection_maps_every_catalog_field_onto_the_tile()
    {
        var tiles = ProjectCanonical().Tiles;

        Assert.Collection(
            tiles,
            t =>
            {
                Assert.Equal("NotificationsChannels", t.RouteName);
                Assert.Equal("\uE715", t.Glyph);
                Assert.Equal("Email", t.Label);
                Assert.Equal("SMTP-based delivery", t.Description);
            },
            t =>
            {
                Assert.Equal("NotificationsChannels", t.RouteName);
                Assert.Equal("\uE8BD", t.Glyph);
                Assert.Equal("Slack", t.Label);
                Assert.Equal("Webhook channel", t.Description);
            },
            t =>
            {
                Assert.Equal("NotificationsChannels", t.RouteName);
                Assert.Equal("\uE8EF", t.Glyph);
                Assert.Equal("Discord", t.Label);
                Assert.Equal("Webhook channel", t.Description);
            },
            t =>
            {
                Assert.Equal("NotificationsChannels", t.RouteName);
                Assert.Equal("\uE71B", t.Glyph);
                Assert.Equal("Webhook", t.Label);
                Assert.Equal("Custom HTTP endpoint", t.Description);
            },
            t =>
            {
                Assert.Equal("NotificationsBrowser", t.RouteName);
                Assert.Equal("\uE8EA", t.Glyph);
                Assert.Equal("Browser push", t.Label);
                Assert.Equal("Opt-in PWA notifications", t.Description);
            });
    }

    // ── Route mapping: the web `to` paths map to the documented native routes ─────────────────────────

    [Fact]
    public void Channel_tiles_open_the_notifications_channels_route()
    {
        var channelTiles = ProjectCanonical().Tiles.Take(4);

        Assert.All(channelTiles, t => Assert.Equal("NotificationsChannels", t.RouteName));
    }

    [Fact]
    public void Browser_push_tile_opens_the_browser_notifications_route()
    {
        // web `/settings/notifications` has no one-for-one native route; it maps to the canonical native
        // browser-push destination (which renders the same NotificationSettings surface on the web).
        var browserPush = ProjectCanonical().Tiles[4];

        Assert.Equal("NotificationsBrowser", browserPush.RouteName);
    }

    // ── Per-state "snapshot": Ready (the web grid) vs the defensive Empty branch ──────────────────────

    [Fact]
    public void Canonical_catalog_renders_the_ready_grid_state()
    {
        var display = ProjectCanonical();

        Assert.Equal(SubscribeCardState.Ready, display.State);
        Assert.True(display.HasTiles);
        Assert.Equal(5, display.Tiles.Count);
    }

    [Fact]
    public void Empty_catalog_renders_the_empty_state_never_a_blank_box()
    {
        var display = SubscribeCardProjection.Project(Array.Empty<SubscribeCardChannel>(), Localizer);

        Assert.Equal(SubscribeCardState.Empty, display.State);
        Assert.False(display.HasTiles);
        Assert.Empty(display.Tiles);
    }

    [Fact]
    public void Empty_state_message_resolves_through_the_localizer()
    {
        Assert.Equal("No notification channels available", SubscribeCardRegistration.EmptyMessage(Localizer));
    }

    // ── Responsive columns (web `grid-cols-1 sm:grid-cols-2`, sm == 640px) ───────────────────────────

    [Theory]
    [InlineData(0, 1)]
    [InlineData(320, 1)]
    [InlineData(639, 1)]
    [InlineData(640, 2)]
    [InlineData(641, 2)]
    [InlineData(1280, 2)]
    public void Columns_switch_one_to_two_at_the_sm_breakpoint(double width, int expected)
    {
        Assert.Equal(expected, SubscribeCardLayout.ColumnsForWidth(width));
    }

    [Fact]
    public void Columns_default_to_narrow_for_an_unmeasured_surface()
    {
        Assert.Equal(SubscribeCardLayout.NarrowColumns, SubscribeCardLayout.ColumnsForWidth(double.NaN));
    }

    // ── i18n: every key from the web source resolves with the same English default (P1/S10 catalog) ──

    [Fact]
    public void Every_i18n_key_from_the_source_is_resolved_with_the_web_default()
    {
        var recorder = new RecordingLocalizer();

        SubscribeCardProjection.Project(new SubscribeCardChannelSource().GetChannels(), recorder);
        SubscribeCardRegistration.Title(recorder);
        SubscribeCardRegistration.Subtitle(recorder);
        SubscribeCardRegistration.EmptyMessage(recorder);

        var expected = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["subscribeCard.title"] = "Get notified about incidents",
            ["subscribeCard.subtitle"] = "Self-hosted: configure your own channels for status events.",
            ["subscribeCard.empty"] = "No notification channels available",
            ["subscribeCard.channel.email.label"] = "Email",
            ["subscribeCard.channel.email.description"] = "SMTP-based delivery",
            ["subscribeCard.channel.slack.label"] = "Slack",
            ["subscribeCard.channel.slack.description"] = "Webhook channel",
            ["subscribeCard.channel.discord.label"] = "Discord",
            ["subscribeCard.channel.discord.description"] = "Webhook channel",
            ["subscribeCard.channel.webhook.label"] = "Webhook",
            ["subscribeCard.channel.webhook.description"] = "Custom HTTP endpoint",
            ["subscribeCard.channel.browserPush.label"] = "Browser push",
            ["subscribeCard.channel.browserPush.description"] = "Opt-in PWA notifications",
        };

        foreach (var (key, fallback) in expected)
        {
            Assert.True(recorder.Requested.TryGetValue(key, out var seen), $"i18n key not resolved: {key}");
            Assert.Equal(fallback, seen);
        }
    }

    [Fact]
    public void Labels_flow_through_the_localizer_verbatim_with_no_hardcoded_english()
    {
        // A non-ASCII translation must pass through to the tile label/description so the surface contributes no
        // hardcoded English of its own — the only copy is the keyed subscribeCard.* strings.
        var fake = new RecordingLocalizer(translation: "\u901A\u77E5");

        var tiles = SubscribeCardProjection.Project(new SubscribeCardChannelSource().GetChannels(), fake).Tiles;

        Assert.All(tiles, t => Assert.Equal("\u901A\u77E5", t.Label));
        Assert.All(tiles, t => Assert.Equal("\u901A\u77E5", t.Description));
    }

    // ── Accessibility: every tile exposes a descriptive (label + description) Narrator name ───────────

    [Fact]
    public void Every_tile_exposes_a_label_and_description_automation_name()
    {
        var tiles = ProjectCanonical().Tiles;

        Assert.All(tiles, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.Collection(
            tiles,
            t => Assert.Equal("Email, SMTP-based delivery", t.AutomationName),
            t => Assert.Equal("Slack, Webhook channel", t.AutomationName),
            t => Assert.Equal("Discord, Webhook channel", t.AutomationName),
            t => Assert.Equal("Webhook, Custom HTTP endpoint", t.AutomationName),
            t => Assert.Equal("Browser push, Opt-in PWA notifications", t.AutomationName));
    }

    [Fact]
    public void Surface_heading_resolves_through_the_localizer()
    {
        Assert.Equal("Get notified about incidents", SubscribeCardRegistration.Title(Localizer));
    }

    [Fact]
    public void Surface_subtitle_resolves_through_the_localizer()
    {
        Assert.Equal(
            "Self-hosted: configure your own channels for status events.",
            SubscribeCardRegistration.Subtitle(Localizer));
    }

    // ── Diagnostics (P1/S11): view.opened + navigation, PII-safe ─────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SubscribeCardDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SubscribeCard", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_navigation_without_leaking_the_route()
    {
        var captured = new List<string>();
        var diagnostics = new SubscribeCardDiagnostics(captured.Add);

        diagnostics.RecordNavigated();

        Assert.Equal(1, diagnostics.Navigations);
        Assert.Equal("subscribe-card.activated slug=SubscribeCard", Assert.Single(captured));
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_stable_slug_and_copy()
    {
        Assert.Equal("SubscribeCard", SubscribeCardRegistration.Slug);
        Assert.Equal("subscribeCard.title", SubscribeCardRegistration.TitleKey);
        Assert.Equal("Get notified about incidents", SubscribeCardRegistration.TitleFallback);
        Assert.Equal("subscribeCard.subtitle", SubscribeCardRegistration.SubtitleKey);
        Assert.Equal("subscribeCard.empty", SubscribeCardRegistration.EmptyMessageKey);
        Assert.Equal("No notification channels available", SubscribeCardRegistration.EmptyMessageFallback);
    }

    [Fact]
    public void Registration_exposes_the_canonical_routes()
    {
        Assert.Equal("NotificationsChannels", SubscribeCardRegistration.ChannelsRoute);
        Assert.Equal("NotificationsBrowser", SubscribeCardRegistration.BrowserPushRoute);
    }

    [Fact]
    public void Canonical_catalog_uses_the_expected_segoe_fluent_glyphs()
    {
        Assert.Equal("\uEA8F", SubscribeCardRegistration.BellGlyph);
        Assert.Collection(
            SubscribeCardRegistration.Canonical,
            c => Assert.Equal("\uE715", c.Glyph),
            c => Assert.Equal("\uE8BD", c.Glyph),
            c => Assert.Equal("\uE8EF", c.Glyph),
            c => Assert.Equal("\uE71B", c.Glyph),
            c => Assert.Equal("\uE8EA", c.Glyph));
    }

    // ── Null-argument guards ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_channel_list()
    {
        Assert.Throws<ArgumentNullException>(() => SubscribeCardProjection.Project(null!, Localizer));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            SubscribeCardProjection.Project(new SubscribeCardChannelSource().GetChannels(), null!));
    }

    [Fact]
    public void Registration_helpers_reject_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => SubscribeCardRegistration.Title(null!));
        Assert.Throws<ArgumentNullException>(() => SubscribeCardRegistration.Subtitle(null!));
        Assert.Throws<ArgumentNullException>(() => SubscribeCardRegistration.EmptyMessage(null!));
    }

    /// <summary>An <see cref="ILocalizer"/> that returns the fallback (or a fixed translation) and records each
    /// requested key so the keyed call sites are asserted headlessly.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly string? _override;

        public RecordingLocalizer(string? translation = null) => _override = translation;

        public Dictionary<string, string> Requested { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Requested[key] = fallback;
            return _override ?? fallback;
        }
    }
}
