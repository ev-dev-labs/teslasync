using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveTelemetryPanels</c> feature surface's UI-thread-free logic — the
/// live-connection → surface-state fold (the loading / loaded / empty / error / stale / offline branches the
/// P2 contract requires), the header live-indicator projection (kind / pulse / tone / freshness chip), the
/// seven composed child slots in web order with their exact staggered <c>FadeIn</c> delays, the accessible
/// names for every state and slot, the documented i18n keys, and the PII-safe diagnostics. Mirrors the web
/// spec (web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx). The WinUI view itself
/// is exercised by the app build.
/// </summary>
public sealed class LiveTelemetryPanelsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LiveTelemetryPanelsDisplay Project(LiveTelemetryPanelsModel model) =>
        LiveTelemetryPanelsProjection.Project(model, Localizer);

    private static LiveTelemetryPanelsModel Model(
        LiveTelemetryConnection connection,
        bool hasContent,
        bool sseConnected = true,
        bool remoteStartEnabled = false,
        DateTimeOffset? updatedAt = null) =>
        new(connection, hasContent, sseConnected, remoteStartEnabled, updatedAt);

    // ── State fold (live connection + content presence → the single visible surface state) ───────────────

    [Theory]
    [InlineData(LiveTelemetryConnection.Connecting, false, LiveTelemetryPanelsState.Loading)]
    [InlineData(LiveTelemetryConnection.Failed, false, LiveTelemetryPanelsState.Error)]
    [InlineData(LiveTelemetryConnection.Offline, false, LiveTelemetryPanelsState.Error)]
    [InlineData(LiveTelemetryConnection.Live, false, LiveTelemetryPanelsState.Empty)]
    [InlineData(LiveTelemetryConnection.Stale, false, LiveTelemetryPanelsState.Empty)]
    [InlineData(LiveTelemetryConnection.Live, true, LiveTelemetryPanelsState.Loaded)]
    [InlineData(LiveTelemetryConnection.Connecting, true, LiveTelemetryPanelsState.Loaded)]
    [InlineData(LiveTelemetryConnection.Stale, true, LiveTelemetryPanelsState.Stale)]
    [InlineData(LiveTelemetryConnection.Offline, true, LiveTelemetryPanelsState.Offline)]
    [InlineData(LiveTelemetryConnection.Failed, true, LiveTelemetryPanelsState.Offline)]
    public void Connection_and_content_resolve_the_surface_state(
        LiveTelemetryConnection connection, bool hasContent, LiveTelemetryPanelsState expected)
    {
        Assert.Equal(expected, LiveTelemetryPanelsProjection.ResolveState(connection, hasContent));
        Assert.Equal(expected, Project(Model(connection, hasContent)).State);
    }

    [Fact]
    public void Pending_model_is_the_loading_state()
    {
        var display = Project(LiveTelemetryPanelsModel.Pending);

        Assert.Equal(LiveTelemetryPanelsState.Loading, display.State);
        Assert.True(display.ShowGrid);
    }

    [Theory]
    [InlineData(LiveTelemetryPanelsState.Loading, true)]
    [InlineData(LiveTelemetryPanelsState.Loaded, true)]
    [InlineData(LiveTelemetryPanelsState.Stale, true)]
    [InlineData(LiveTelemetryPanelsState.Offline, true)]
    [InlineData(LiveTelemetryPanelsState.Empty, false)]
    [InlineData(LiveTelemetryPanelsState.Error, false)]
    public void Grid_is_shown_for_panel_states_and_hidden_for_state_surfaces(
        LiveTelemetryPanelsState state, bool showsGrid)
    {
        var display = Project(ModelForState(state));

        Assert.Equal(state, display.State);
        Assert.Equal(showsGrid, display.ShowGrid);
    }

    // ── Header live indicator ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Loaded_indicator_is_a_pulsing_live_dot_without_a_chip()
    {
        var indicator = Project(Model(LiveTelemetryConnection.Live, true)).Indicator;

        Assert.Equal(LiveIndicatorKind.Live, indicator.Kind);
        Assert.True(indicator.Pulsing);
        Assert.Equal(StatusKind.Success, indicator.Tone);
        Assert.False(indicator.ShowChip);
        Assert.Equal("Live", indicator.Text);
    }

    [Fact]
    public void Loading_indicator_pulses_while_connecting()
    {
        var indicator = Project(Model(LiveTelemetryConnection.Connecting, false)).Indicator;

        Assert.Equal(LiveIndicatorKind.Connecting, indicator.Kind);
        Assert.True(indicator.Pulsing);
        Assert.False(indicator.ShowChip);
        Assert.Equal("Connecting", indicator.Text);
    }

    [Fact]
    public void Stale_indicator_shows_a_warning_freshness_chip()
    {
        var indicator = Project(Model(LiveTelemetryConnection.Stale, true)).Indicator;

        Assert.Equal(LiveIndicatorKind.Stale, indicator.Kind);
        Assert.False(indicator.Pulsing);
        Assert.Equal(StatusKind.Warning, indicator.Tone);
        Assert.True(indicator.ShowChip);
        Assert.Equal("Stale", indicator.Text);
    }

    [Fact]
    public void Offline_indicator_shows_a_danger_freshness_chip()
    {
        var indicator = Project(Model(LiveTelemetryConnection.Offline, true)).Indicator;

        Assert.Equal(LiveIndicatorKind.Offline, indicator.Kind);
        Assert.False(indicator.Pulsing);
        Assert.Equal(StatusKind.Danger, indicator.Tone);
        Assert.True(indicator.ShowChip);
        Assert.Equal("Offline", indicator.Text);
    }

    [Theory]
    [InlineData(LiveTelemetryPanelsState.Empty)]
    [InlineData(LiveTelemetryPanelsState.Error)]
    public void Idle_states_have_a_muted_non_pulsing_dot_without_a_chip(LiveTelemetryPanelsState state)
    {
        var indicator = Project(ModelForState(state)).Indicator;

        Assert.Equal(LiveIndicatorKind.Idle, indicator.Kind);
        Assert.False(indicator.Pulsing);
        Assert.Equal(StatusKind.Neutral, indicator.Tone);
        Assert.False(indicator.ShowChip);
        Assert.Equal(string.Empty, indicator.Text);
    }

    // ── The seven composed slots (web order + exact staggered FadeIn delays) ─────────────────────────────

    [Fact]
    public void Projects_the_seven_child_slots_in_web_order()
    {
        var slots = Project(Model(LiveTelemetryConnection.Live, true)).Panels;

        Assert.Equal(
            new[]
            {
                TelemetryPanelSlot.Powertrain,
                TelemetryPanelSlot.Climate,
                TelemetryPanelSlot.Security,
                TelemetryPanelSlot.VehicleState,
                TelemetryPanelSlot.TirePressure,
                TelemetryPanelSlot.EnergyCharging,
                TelemetryPanelSlot.MediaNavigation,
            },
            slots.Select(s => s.Slot).ToArray());
    }

    [Fact]
    public void Slot_fade_in_delays_match_the_web_stagger()
    {
        var bySlot = Project(Model(LiveTelemetryConnection.Live, true)).Panels.ToDictionary(s => s.Slot);

        Assert.Equal(140, bySlot[TelemetryPanelSlot.Powertrain].FadeInDelayMs);
        Assert.Equal(160, bySlot[TelemetryPanelSlot.Climate].FadeInDelayMs);
        Assert.Equal(180, bySlot[TelemetryPanelSlot.Security].FadeInDelayMs);
        Assert.Equal(190, bySlot[TelemetryPanelSlot.VehicleState].FadeInDelayMs);
        Assert.Equal(200, bySlot[TelemetryPanelSlot.TirePressure].FadeInDelayMs);
        Assert.Equal(220, bySlot[TelemetryPanelSlot.EnergyCharging].FadeInDelayMs);
        Assert.Equal(240, bySlot[TelemetryPanelSlot.MediaNavigation].FadeInDelayMs);
    }

    [Fact]
    public void Header_fade_in_delay_matches_the_web_value() =>
        Assert.Equal(120, Project(Model(LiveTelemetryConnection.Live, true)).HeaderDelayMs);

    [Fact]
    public void Every_slot_carries_a_title_glyph_and_loading_name()
    {
        foreach (var slot in Project(LiveTelemetryPanelsModel.Pending).Panels)
        {
            Assert.False(string.IsNullOrWhiteSpace(slot.Title));
            Assert.False(string.IsNullOrWhiteSpace(slot.Glyph));
            Assert.Contains(slot.Title, slot.LoadingAutomationName, StringComparison.Ordinal);
            Assert.Contains("Loading", slot.LoadingAutomationName, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Slot_glyphs_are_distinct_per_panel()
    {
        var glyphs = Project(Model(LiveTelemetryConnection.Live, true)).Panels.Select(s => s.Glyph).ToArray();

        Assert.Equal(glyphs.Length, glyphs.Distinct().Count());
    }

    [Fact]
    public void Slot_set_is_identical_across_every_state()
    {
        var loaded = Project(Model(LiveTelemetryConnection.Live, true)).Panels.Select(s => s.Slot).ToArray();

        foreach (LiveTelemetryPanelsState state in Enum.GetValues<LiveTelemetryPanelsState>())
        {
            var slots = Project(ModelForState(state)).Panels.Select(s => s.Slot).ToArray();
            Assert.Equal(loaded, slots);
        }
    }

    // ── Slot titles (passthrough → English; KeyEcho → documented i18n keys) ──────────────────────────────

    [Fact]
    public void Slot_titles_render_the_child_panel_names()
    {
        var bySlot = Project(Model(LiveTelemetryConnection.Live, true)).Panels.ToDictionary(s => s.Slot);

        Assert.Equal("Powertrain", bySlot[TelemetryPanelSlot.Powertrain].Title);
        Assert.Equal("Climate", bySlot[TelemetryPanelSlot.Climate].Title);
        Assert.Equal("Security", bySlot[TelemetryPanelSlot.Security].Title);
        Assert.Equal("Vehicle State", bySlot[TelemetryPanelSlot.VehicleState].Title);
        Assert.Equal("Tire Pressure", bySlot[TelemetryPanelSlot.TirePressure].Title);
        Assert.Equal("Energy & Charging", bySlot[TelemetryPanelSlot.EnergyCharging].Title);
        Assert.Equal("Media & Navigation", bySlot[TelemetryPanelSlot.MediaNavigation].Title);
    }

    [Fact]
    public void Projection_resolves_the_title_through_the_web_source_key()
    {
        var display = LiveTelemetryPanelsProjection.Project(Model(LiveTelemetryConnection.Live, true), new KeyEchoLocalizer());

        Assert.Equal("common.liveTelemetry", display.Title);
    }

    [Fact]
    public void Projection_resolves_slot_titles_through_the_documented_keys()
    {
        var bySlot = LiveTelemetryPanelsProjection
            .Project(Model(LiveTelemetryConnection.Live, true), new KeyEchoLocalizer())
            .Panels.ToDictionary(s => s.Slot);

        Assert.Equal("common.powertrain", bySlot[TelemetryPanelSlot.Powertrain].Title);
        Assert.Equal("common.climate", bySlot[TelemetryPanelSlot.Climate].Title);
        Assert.Equal("common.security", bySlot[TelemetryPanelSlot.Security].Title);
        Assert.Equal("telemetry.vehicleState", bySlot[TelemetryPanelSlot.VehicleState].Title);
        Assert.Equal("common.tirePressure", bySlot[TelemetryPanelSlot.TirePressure].Title);
        Assert.Equal("telemetry.energyCharging", bySlot[TelemetryPanelSlot.EnergyCharging].Title);
        Assert.Equal("telemetry.mediaNav", bySlot[TelemetryPanelSlot.MediaNavigation].Title);
    }

    // ── Accessibility: every state exposes a meaningful Narrator name ────────────────────────────────────

    [Fact]
    public void Surface_automation_name_folds_the_title_and_live_state()
    {
        Assert.Equal("Live Telemetry. Live", Project(Model(LiveTelemetryConnection.Live, true)).AutomationName);
        Assert.Equal("Live Telemetry. Connecting", Project(Model(LiveTelemetryConnection.Connecting, false)).AutomationName);
        Assert.Equal("Live Telemetry. Stale", Project(Model(LiveTelemetryConnection.Stale, true)).AutomationName);
        Assert.Equal("Live Telemetry. Offline", Project(Model(LiveTelemetryConnection.Offline, true)).AutomationName);
    }

    [Fact]
    public void Empty_and_error_automation_names_fold_their_messages()
    {
        Assert.Equal(
            "Live Telemetry. No live telemetry available",
            Project(Model(LiveTelemetryConnection.Live, false)).AutomationName);
        Assert.Equal(
            "Live Telemetry. Couldn't load live telemetry",
            Project(Model(LiveTelemetryConnection.Failed, false)).AutomationName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_surface_automation_name()
    {
        foreach (LiveTelemetryPanelsState state in Enum.GetValues<LiveTelemetryPanelsState>())
        {
            Assert.False(string.IsNullOrWhiteSpace(Project(ModelForState(state)).AutomationName));
        }
    }

    [Fact]
    public void Empty_and_error_surfaces_carry_localized_copy()
    {
        var empty = Project(Model(LiveTelemetryConnection.Live, false));
        Assert.Equal("No live telemetry available", empty.EmptyMessage);

        var error = Project(Model(LiveTelemetryConnection.Failed, false));
        Assert.Equal("Couldn't load live telemetry", error.ErrorMessage);
        Assert.Equal("Retry", error.RetryLabel);
    }

    // ── Diagnostics (P1/S11): view.opened slug=LiveTelemetryPanels, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LiveTelemetryPanelsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LiveTelemetryPanels", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_connection_values()
    {
        var captured = new List<string>();
        var diagnostics = new LiveTelemetryPanelsDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("sse", line, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("vehicle", line, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("LiveTelemetryPanels", LiveTelemetryPanelsRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => LiveTelemetryPanelsProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => LiveTelemetryPanelsProjection.Project(LiveTelemetryPanelsModel.Pending, null!));

    private static LiveTelemetryPanelsModel ModelForState(LiveTelemetryPanelsState state) => state switch
    {
        LiveTelemetryPanelsState.Loading => Model(LiveTelemetryConnection.Connecting, false),
        LiveTelemetryPanelsState.Loaded => Model(LiveTelemetryConnection.Live, true),
        LiveTelemetryPanelsState.Empty => Model(LiveTelemetryConnection.Live, false),
        LiveTelemetryPanelsState.Error => Model(LiveTelemetryConnection.Failed, false),
        LiveTelemetryPanelsState.Stale => Model(LiveTelemetryConnection.Stale, true),
        LiveTelemetryPanelsState.Offline => Model(LiveTelemetryConnection.Offline, true),
        _ => LiveTelemetryPanelsModel.Pending,
    };

    /// <summary>
    /// An <see cref="ILocalizer"/> that echoes the requested key (ignoring the fallback), proving the
    /// projection feeds the documented i18n keys — not ad-hoc English literals — into the facade.
    /// </summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
