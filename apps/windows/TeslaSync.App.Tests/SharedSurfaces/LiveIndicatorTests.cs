using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the LiveIndicator shared surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the four i18n keys the source references with their verbatim fallbacks, the ARIA
/// role/live contract, the per-state Segoe Fluent glyphs and lowercase status tokens), the
/// <see cref="LiveIndicatorSnapshot.FromConnection"/> adapter (every transport state mapped through
/// <see cref="LiveConnectionMapping"/>), the pure <see cref="LiveIndicatorProjection"/> (per-state token accent /
/// glyph / label, the reconnecting spin flag and its reduce-motion gate, the three variants' element sets and the
/// connected freshness stamp), the <see cref="LiveIndicatorViewModel"/> state holder (initial projection, snapshot
/// + motion reprojection, the freshness tick, subscription cleanup), the
/// <see cref="StaticLiveIndicatorSource"/> / <see cref="MonitorLiveIndicatorSource"/> seams and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/data-display/LiveIndicator.tsx). The WinUI view itself
/// (shared-surfaces/LiveIndicator/LiveIndicator.cs) is exercised by the app build.
/// </summary>
public sealed class LiveIndicatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LiveIndicatorProjection Project(
        LiveConnectionState status,
        DateTimeOffset? lastMessageAt = null,
        LiveIndicatorVariant variant = LiveIndicatorVariant.Pill,
        bool reduceMotion = false,
        ILocalizer? localizer = null) =>
        LiveIndicatorProjection.Project(
            new LiveIndicatorSnapshot(status, lastMessageAt),
            variant,
            reduceMotion,
            Now,
            localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("LiveIndicator", LiveIndicatorRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("live-indicator", LiveIndicatorRegistration.RootAutomationId);

    [Fact]
    public void Aria_role_and_live_setting_match_the_web_container()
    {
        // web: role="status" ⇒ implicit aria-live="polite".
        Assert.Equal("status", LiveIndicatorRegistration.StatusRole);
        Assert.Equal("polite", LiveIndicatorRegistration.LiveSetting);
    }

    [Fact]
    public void Glyphs_map_to_the_fluent_stand_ins_for_the_web_lucide_icons()
    {
        Assert.Equal("\uE701", LiveIndicatorRegistration.WifiGlyph);
        Assert.Equal("\uE72C", LiveIndicatorRegistration.ReconnectingGlyph);
        Assert.Equal("\uEB5E", LiveIndicatorRegistration.WifiOffGlyph);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // web live.* keys (translation-namespaced for the WinUI resource catalog) with verbatim fallbacks.
        Assert.Equal("translation.live.connected", LiveIndicatorRegistration.ConnectedKey);
        Assert.Equal("Live", LiveIndicatorRegistration.ConnectedFallback);
        Assert.Equal("translation.live.reconnecting", LiveIndicatorRegistration.ReconnectingKey);
        Assert.Equal("Reconnecting\u2026", LiveIndicatorRegistration.ReconnectingFallback);
        Assert.Equal("translation.live.disconnected", LiveIndicatorRegistration.DisconnectedKey);
        Assert.Equal("Offline", LiveIndicatorRegistration.DisconnectedFallback);
        Assert.Equal("translation.live.unknown", LiveIndicatorRegistration.UnknownKey);
        Assert.Equal("Unknown", LiveIndicatorRegistration.UnknownFallback);
    }

    [Theory]
    [InlineData(LiveConnectionState.Connected, "connected")]
    [InlineData(LiveConnectionState.Reconnecting, "reconnecting")]
    [InlineData(LiveConnectionState.Disconnected, "disconnected")]
    [InlineData(LiveConnectionState.Unknown, "unknown")]
    public void StatusToken_is_the_lowercase_web_union(LiveConnectionState status, string expected)
    {
        Assert.Equal(expected, LiveIndicatorRegistration.StatusToken(status));
        Assert.Equal(expected, Project(status).StatusToken);
    }

    [Theory]
    [InlineData(LiveConnectionState.Connected, "\uE701")]
    [InlineData(LiveConnectionState.Reconnecting, "\uE72C")]
    [InlineData(LiveConnectionState.Disconnected, "\uEB5E")]
    [InlineData(LiveConnectionState.Unknown, "\uEB5E")]
    public void Glyph_maps_each_state_to_its_fluent_icon(LiveConnectionState status, string expected)
    {
        Assert.Equal(expected, LiveIndicatorRegistration.Glyph(status));
        Assert.Equal(expected, Project(status).IconGlyph);
    }

    // ── snapshot adapter (Core LiveConnectionSnapshot → indicator snapshot) ──────────────────────────────────

    [Theory]
    [InlineData(LiveConnection.Open, LiveConnectionState.Connected)]
    [InlineData(LiveConnection.Stale, LiveConnectionState.Connected)]
    [InlineData(LiveConnection.Connecting, LiveConnectionState.Reconnecting)]
    [InlineData(LiveConnection.Reconnecting, LiveConnectionState.Reconnecting)]
    [InlineData(LiveConnection.Paused, LiveConnectionState.Disconnected)]
    [InlineData(LiveConnection.AuthRequired, LiveConnectionState.Disconnected)]
    [InlineData(LiveConnection.Closed, LiveConnectionState.Disconnected)]
    public void FromConnection_maps_the_effective_transport_state(LiveConnection effective, LiveConnectionState expected)
    {
        var connection = new LiveConnectionSnapshot(LiveConnection.Open, effective, Now, 0, effective == LiveConnection.Stale);

        Assert.Equal(expected, LiveIndicatorSnapshot.FromConnection(connection).Status);
    }

    [Fact]
    public void FromConnection_preserves_the_last_event_timestamp()
    {
        var at = Now.AddSeconds(-42);
        var connection = new LiveConnectionSnapshot(LiveConnection.Open, LiveConnection.Open, at, 0, false);

        Assert.Equal(at, LiveIndicatorSnapshot.FromConnection(connection).LastMessageAt);
    }

    [Fact]
    public void FromConnection_throws_when_the_connection_is_null() =>
        Assert.Throws<ArgumentNullException>(() => LiveIndicatorSnapshot.FromConnection(null!));

    [Fact]
    public void Snapshot_named_defaults_match_the_web_states()
    {
        Assert.Equal(LiveConnectionState.Unknown, LiveIndicatorSnapshot.Unknown.Status);
        Assert.Null(LiveIndicatorSnapshot.Unknown.LastMessageAt);
        Assert.Equal(LiveConnectionState.Disconnected, LiveIndicatorSnapshot.Disconnected.Status);
        Assert.Null(LiveIndicatorSnapshot.Disconnected.LastMessageAt);
    }

    // ── projection: per-state token accent (web cfg[status] emerald / amber / rose / muted) ──────────────────

    [Theory]
    [InlineData(LiveConnectionState.Connected, "TsColorSuccessBrush")]
    [InlineData(LiveConnectionState.Reconnecting, "TsColorWarningBrush")]
    [InlineData(LiveConnectionState.Disconnected, "TsColorDangerBrush")]
    [InlineData(LiveConnectionState.Unknown, "TsColorTextMutedBrush")]
    public void AccentBrushKey_maps_each_state_to_its_token_brush(LiveConnectionState status, string expectedKey)
    {
        Assert.Equal(expectedKey, Project(status).AccentBrushKey);
    }

    // ── projection: spin (web cfg[status].spin — reconnecting — gated on reduce-motion) ──────────────────────

    [Theory]
    [InlineData(LiveConnectionState.Connected, false)]
    [InlineData(LiveConnectionState.Reconnecting, true)]
    [InlineData(LiveConnectionState.Disconnected, false)]
    [InlineData(LiveConnectionState.Unknown, false)]
    public void Spin_is_set_only_while_reconnecting(LiveConnectionState status, bool expected)
    {
        Assert.Equal(expected, Project(status).Spin);
    }

    [Fact]
    public void Spin_is_suppressed_under_reduced_motion()
    {
        Assert.True(Project(LiveConnectionState.Reconnecting, reduceMotion: false).Spin);
        Assert.False(Project(LiveConnectionState.Reconnecting, reduceMotion: true).Spin);
    }

    // ── projection: per-state "snapshot" — each state renders a complete, distinct display ───────────────────

    [Fact]
    public void Connected_state_renders_a_complete_pill()
    {
        var p = Project(LiveConnectionState.Connected, Now.AddSeconds(-30));

        Assert.Equal(LiveConnectionState.Connected, p.Status);
        Assert.Equal("connected", p.StatusToken);
        Assert.Equal("TsColorSuccessBrush", p.AccentBrushKey);
        Assert.Equal("\uE701", p.IconGlyph);
        Assert.Equal("Live", p.Label);
        Assert.False(p.Spin);
        Assert.True(p.ShowIcon);
        Assert.True(p.ShowLabel);
        Assert.False(p.ShowDot);
        Assert.True(p.ShowTimestamp);
        Assert.Equal("Just now", p.RelativeText);
        Assert.Equal("Live", p.AutomationName);
        Assert.Equal("status", p.Role);
    }

    [Fact]
    public void Reconnecting_state_renders_a_complete_pill()
    {
        var p = Project(LiveConnectionState.Reconnecting);

        Assert.Equal("reconnecting", p.StatusToken);
        Assert.Equal("TsColorWarningBrush", p.AccentBrushKey);
        Assert.Equal("\uE72C", p.IconGlyph);
        Assert.Equal("Reconnecting\u2026", p.Label);
        Assert.True(p.Spin);
        Assert.False(p.ShowTimestamp);
        Assert.Equal("Reconnecting\u2026", p.AutomationName);
    }

    [Fact]
    public void Disconnected_state_renders_a_complete_pill()
    {
        var p = Project(LiveConnectionState.Disconnected);

        Assert.Equal("disconnected", p.StatusToken);
        Assert.Equal("TsColorDangerBrush", p.AccentBrushKey);
        Assert.Equal("\uEB5E", p.IconGlyph);
        Assert.Equal("Offline", p.Label);
        Assert.False(p.Spin);
        Assert.False(p.ShowTimestamp);
        Assert.Equal("Offline", p.AutomationName);
    }

    [Fact]
    public void Unknown_state_renders_a_complete_pill()
    {
        var p = Project(LiveConnectionState.Unknown);

        Assert.Equal("unknown", p.StatusToken);
        Assert.Equal("TsColorTextMutedBrush", p.AccentBrushKey);
        Assert.Equal("\uEB5E", p.IconGlyph);
        Assert.Equal("Unknown", p.Label);
        Assert.False(p.Spin);
        Assert.False(p.ShowTimestamp);
        Assert.Equal("Unknown", p.AutomationName);
    }

    // ── projection: variants (web 'dot' / 'compact' / 'pill') ────────────────────────────────────────────────

    [Fact]
    public void Dot_variant_renders_a_bare_dot_with_no_text()
    {
        var p = Project(LiveConnectionState.Connected, Now.AddSeconds(-2), LiveIndicatorVariant.Dot);

        Assert.True(p.ShowDot);
        Assert.False(p.ShowIcon);
        Assert.False(p.ShowLabel);
        Assert.False(p.ShowTimestamp);
        Assert.True(p.DotOnly);
        Assert.Equal("Live", p.AutomationName);
    }

    [Fact]
    public void Compact_variant_shows_icon_and_label_but_never_a_timestamp()
    {
        var p = Project(LiveConnectionState.Connected, Now.AddSeconds(-2), LiveIndicatorVariant.Compact);

        Assert.False(p.ShowDot);
        Assert.True(p.ShowIcon);
        Assert.True(p.ShowLabel);
        Assert.False(p.ShowTimestamp);
        Assert.False(p.DotOnly);
        Assert.Equal(string.Empty, p.RelativeText);
    }

    [Fact]
    public void Pill_variant_shows_the_timestamp_only_when_connected_with_a_message()
    {
        Assert.True(Project(LiveConnectionState.Connected, Now.AddSeconds(-2), LiveIndicatorVariant.Pill).ShowTimestamp);
        Assert.False(Project(LiveConnectionState.Connected, lastMessageAt: null, variant: LiveIndicatorVariant.Pill).ShowTimestamp);
        Assert.False(Project(LiveConnectionState.Reconnecting, Now.AddSeconds(-2), LiveIndicatorVariant.Pill).ShowTimestamp);
        Assert.False(Project(LiveConnectionState.Disconnected, Now.AddSeconds(-2), LiveIndicatorVariant.Pill).ShowTimestamp);
        Assert.False(Project(LiveConnectionState.Unknown, Now.AddSeconds(-2), LiveIndicatorVariant.Pill).ShowTimestamp);
    }

    // ── projection: freshness stamp tiers (web formatRelativeTime) ───────────────────────────────────────────

    [Fact]
    public void Freshness_stamp_just_now_holds_for_the_first_minute() =>
        Assert.Equal("Just now", Project(LiveConnectionState.Connected, Now.AddSeconds(-30)).RelativeText);

    [Fact]
    public void Freshness_stamp_minutes_tier() =>
        Assert.Equal("5m ago", Project(LiveConnectionState.Connected, Now.AddMinutes(-5)).RelativeText);

    [Fact]
    public void Freshness_stamp_hours_tier() =>
        Assert.Equal("2h ago", Project(LiveConnectionState.Connected, Now.AddHours(-2)).RelativeText);

    [Fact]
    public void Freshness_stamp_falls_back_to_the_shared_absolute_format_past_a_day()
    {
        var at = Now.AddHours(-25);

        // web: toLocaleDateString(MMM d, hh:mm) — the shared DateTimeFormatting.Relative is the 1:1 native port.
        Assert.Equal(
            DateTimeFormatting.Format(at, DateTimeVariant.Relative, Now),
            Project(LiveConnectionState.Connected, at).RelativeText);
    }

    // ── accessibility (Narrator name == the web aria-label == the state label) ───────────────────────────────

    [Theory]
    [InlineData(LiveConnectionState.Connected)]
    [InlineData(LiveConnectionState.Reconnecting)]
    [InlineData(LiveConnectionState.Disconnected)]
    [InlineData(LiveConnectionState.Unknown)]
    public void AutomationName_equals_the_label_and_is_never_blank(LiveConnectionState status)
    {
        foreach (var variant in new[] { LiveIndicatorVariant.Pill, LiveIndicatorVariant.Dot, LiveIndicatorVariant.Compact })
        {
            var p = Project(status, Now.AddSeconds(-2), variant);
            Assert.Equal(p.Label, p.AutomationName);
            Assert.False(string.IsNullOrWhiteSpace(p.AutomationName));
        }
    }

    // ── i18n: every label routes through the localizer (no hardcoded English) ────────────────────────────────

    [Theory]
    [InlineData(LiveConnectionState.Connected, "translation.live.connected", "Live")]
    [InlineData(LiveConnectionState.Reconnecting, "translation.live.reconnecting", "Reconnecting\u2026")]
    [InlineData(LiveConnectionState.Disconnected, "translation.live.disconnected", "Offline")]
    [InlineData(LiveConnectionState.Unknown, "translation.live.unknown", "Unknown")]
    public void Label_resolves_through_its_keyed_call_site(LiveConnectionState status, string key, string fallback)
    {
        var fake = new RecordingLocalizer();

        var label = LiveIndicatorRegistration.Label(status, fake);

        Assert.Contains(key, fake.Keys);
        Assert.Equal(fallback, fake.FallbackFor(key));
        Assert.Equal($"__{key}__", label);
    }

    [Fact]
    public void Project_routes_the_label_through_the_localizer()
    {
        var fake = new RecordingLocalizer();

        Project(LiveConnectionState.Connected, Now, localizer: fake);

        Assert.Contains("translation.live.connected", fake.Keys);
    }

    [Fact]
    public void Localized_copy_passes_through_verbatim_with_no_hardcoded_english()
    {
        // A non-ASCII translation must reach the label slot, proving the surface contributes no hardcoded English.
        var fake = new RecordingLocalizer(new Dictionary<string, string>
        {
            ["translation.live.connected"] = "オンライン",
        });

        var p = Project(LiveConnectionState.Connected, Now.AddSeconds(-2), localizer: fake);

        Assert.Equal("オンライン", p.Label);
        Assert.Equal("オンライン", p.AutomationName);
    }

    // ── null-argument guards ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_snapshot() =>
        Assert.Throws<ArgumentNullException>(() =>
            LiveIndicatorProjection.Project(null!, LiveIndicatorVariant.Pill, false, Now, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() =>
            LiveIndicatorProjection.Project(LiveIndicatorSnapshot.Unknown, LiveIndicatorVariant.Pill, false, Now, null!));

    [Fact]
    public void Label_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => LiveIndicatorRegistration.Label(LiveConnectionState.Connected, null!));

    // ── source: StaticLiveIndicatorSource ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_defaults_to_unknown()
    {
        Assert.Equal(LiveConnectionState.Unknown, new StaticLiveIndicatorSource().Current.Status);
    }

    [Fact]
    public void Static_source_set_moves_the_snapshot_and_raises_changed()
    {
        var source = new StaticLiveIndicatorSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(new LiveIndicatorSnapshot(LiveConnectionState.Connected, Now));

        Assert.Equal(1, raised);
        Assert.Equal(LiveConnectionState.Connected, source.Current.Status);
        Assert.Equal(Now, source.Current.LastMessageAt);
    }

    [Fact]
    public void Static_source_set_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => new StaticLiveIndicatorSource().Set(null!));

    // ── source: MonitorLiveIndicatorSource (binds the Core LiveConnectionMonitor) ────────────────────────────

    [Fact]
    public void Monitor_source_seeds_current_from_the_monitor_snapshot()
    {
        var now = Now;
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), () => now);
        monitor.MarkEvent(now);

        using var source = new MonitorLiveIndicatorSource(monitor);

        Assert.Equal(LiveConnectionState.Connected, source.Current.Status);
        Assert.Equal(now, source.Current.LastMessageAt);
    }

    [Fact]
    public void Monitor_source_reraises_changed_when_the_monitor_moves()
    {
        var now = Now;
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), () => now);
        using var source = new MonitorLiveIndicatorSource(monitor);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        monitor.MarkEvent(now);

        Assert.True(raised >= 1);
        Assert.Equal(LiveConnectionState.Connected, source.Current.Status);
    }

    [Fact]
    public void Monitor_source_stops_reraising_after_dispose()
    {
        var now = Now;
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), () => now);
        var source = new MonitorLiveIndicatorSource(monitor);
        var raised = 0;
        source.Changed += (_, _) => raised++;
        source.Dispose();

        monitor.MarkEvent(now);

        Assert.Equal(0, raised);
    }

    [Fact]
    public void Monitor_source_rejects_a_null_monitor() =>
        Assert.Throws<ArgumentNullException>(() => new MonitorLiveIndicatorSource(null!));

    // ── view-model: binds the seam, projects and reprojects ──────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_snapshot()
    {
        var source = new StaticLiveIndicatorSource(new LiveIndicatorSnapshot(LiveConnectionState.Connected, Now));
        using var vm = new LiveIndicatorViewModel(Localizer, source, StaticMotionPreferenceSource.FullMotion);

        Assert.Equal(LiveConnectionState.Connected, vm.Status);
        Assert.Equal("Live", vm.Label);
        Assert.Equal("LiveIndicator", LiveIndicatorViewModel.Slug);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_changes()
    {
        var source = new StaticLiveIndicatorSource(new LiveIndicatorSnapshot(LiveConnectionState.Reconnecting, null));
        using var vm = new LiveIndicatorViewModel(Localizer, source, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        vm.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(LiveIndicatorViewModel.Projection)) changes++; };

        source.Set(new LiveIndicatorSnapshot(LiveConnectionState.Disconnected, null));

        Assert.Equal(1, changes);
        Assert.Equal(LiveConnectionState.Disconnected, vm.Status);
        Assert.Equal("Offline", vm.Label);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_motion_preference_changes()
    {
        var source = new StaticLiveIndicatorSource(new LiveIndicatorSnapshot(LiveConnectionState.Reconnecting, null));
        var motion = new TogglingMotionSource(reduceMotion: false);
        using var vm = new LiveIndicatorViewModel(Localizer, source, motion);
        Assert.True(vm.Spin);

        motion.Toggle(reduceMotion: true);

        Assert.False(vm.Spin);
    }

    [Fact]
    public void ViewModel_tick_advances_the_freshness_stamp()
    {
        var now = Now;
        var source = new StaticLiveIndicatorSource(new LiveIndicatorSnapshot(LiveConnectionState.Connected, Now));
        using var vm = new LiveIndicatorViewModel(Localizer, source, StaticMotionPreferenceSource.FullMotion, LiveIndicatorVariant.Pill, () => now);
        Assert.Equal("Just now", vm.RelativeText);

        now = Now.AddMinutes(5);
        vm.NotifyTimeChanged();

        Assert.Equal("5m ago", vm.RelativeText);
    }

    [Fact]
    public void ViewModel_stops_reprojecting_after_dispose()
    {
        var source = new StaticLiveIndicatorSource(new LiveIndicatorSnapshot(LiveConnectionState.Connected, Now));
        var vm = new LiveIndicatorViewModel(Localizer, source, StaticMotionPreferenceSource.FullMotion);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;
        vm.Dispose();

        source.Set(new LiveIndicatorSnapshot(LiveConnectionState.Disconnected, null));

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new StaticLiveIndicatorSource();
        Assert.Throws<ArgumentNullException>(() => new LiveIndicatorViewModel(null!, source, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(() => new LiveIndicatorViewModel(Localizer, null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(() => new LiveIndicatorViewModel(Localizer, source, null!));
    }

    // ── diagnostics (P1/S11): view.opened slug=LiveIndicator, PII-safe ───────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveIndicatorDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveIndicator", captured[0]);
        Assert.Equal("view.opened slug=LiveIndicator", captured[1]);
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

    /// <summary>An <see cref="IMotionPreferenceSource"/> test double whose value can be toggled at runtime,
    /// notifying its observer — so the view-model's reduce-motion reprojection is asserted headlessly.</summary>
    private sealed class TogglingMotionSource : IMotionPreferenceSource
    {
        private Action<bool>? _onChanged;

        public TogglingMotionSource(bool reduceMotion) => ReduceMotion = reduceMotion;

        public bool ReduceMotion { get; private set; }

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _onChanged = onChanged;
            return new Subscription(this);
        }

        public void Toggle(bool reduceMotion)
        {
            ReduceMotion = reduceMotion;
            _onChanged?.Invoke(reduceMotion);
        }

        private sealed class Subscription : IDisposable
        {
            private readonly TogglingMotionSource _owner;

            public Subscription(TogglingMotionSource owner) => _owner = owner;

            public void Dispose() => _owner._onChanged = null;
        }
    }
}
