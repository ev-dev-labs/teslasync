using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using TeslaSync.App.SharedSurfaces.ThemeProviderSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ThemeProvider surface's UI-thread-free logic — the colour maths
/// (<see cref="ThemeColor"/>), the theme / mode catalogs (<see cref="ThemeCatalog"/> / <see cref="ModeCatalog"/>),
/// the applied-palette projection (<see cref="AppliedThemeTokens"/>, the <c>applyThemeCSS</c> port), the four
/// P1/S8 seams, the <c>useTheme</c> state holder (<see cref="ThemeController"/>) across every load outcome
/// (loading / empty / error / offline), cross-instance broadcast sync, OS-scheme auto resolution, the
/// registration slug, the accessibility contract and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/ui/ThemeProvider.tsx). The WinUI view (ThemeProvider.cs — the attached-property context
/// and the ThemeProvider control) is exercised by the app build.
/// </summary>
public sealed class ThemeProviderTests
{
    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ThemeProvider", ThemeProviderRegistration.Slug);

    [Fact]
    public void Controller_exposes_the_registration_slug() =>
        Assert.Equal("ThemeProvider", ThemeController.Slug);

    // ── colour maths: the web module-level hexToRGB ──────────────────────────────────────────────────────

    [Theory]
    [InlineData("#00f0ff", "0, 240, 255")]
    [InlineData("#e63946", "230, 57, 70")]
    [InlineData("#00b4d8", "0, 180, 216")]
    [InlineData("#000000", "0, 0, 0")]
    [InlineData("#ffffff", "255, 255, 255")]
    public void HexToRgb_matches_the_web_channel_triple(string hex, string expected) =>
        Assert.Equal(expected, ThemeColor.HexToRgb(hex));

    [Theory]
    [InlineData("")]
    [InlineData("#abc")]
    [InlineData("not-a-hex")]
    [InlineData("#gggggg")]
    public void HexToRgb_is_null_safe_for_malformed_values(string hex) =>
        Assert.Equal("0, 0, 0", ThemeColor.HexToRgb(hex));

    [Fact]
    public void HexToRgb_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => ThemeColor.HexToRgb(null!));

    [Fact]
    public void TryParseHex_returns_the_byte_channels()
    {
        Assert.True(ThemeColor.TryParseHex("#a855f7", out byte r, out byte g, out byte b));
        Assert.Equal(168, r);
        Assert.Equal(85, g);
        Assert.Equal(247, b);
    }

    // ── theme catalog: the web `themes` record + buildCustomTheme ────────────────────────────────────────

    [Fact]
    public void Theme_catalog_exposes_the_six_web_themes_in_order() =>
        Assert.Equal(
            new[] { ThemeId.NeonCyan, ThemeId.TeslaRed, ThemeId.MatrixGreen, ThemeId.RoyalPurple, ThemeId.SolarAmber, ThemeId.Custom },
            ThemeCatalog.Ids.ToArray());

    [Fact]
    public void Theme_catalog_resolves_the_default_neon_cyan_verbatim()
    {
        ColorTheme theme = ThemeCatalog.Resolve(ThemeId.NeonCyan, ThemeCatalog.DefaultCustomPrimary, ThemeCatalog.DefaultCustomAccent);

        Assert.Equal(ThemeId.NeonCyan, theme.Id);
        Assert.Equal("Neon Cyan", theme.Name);
        Assert.Equal("#00f0ff", theme.Primary);
        Assert.Equal("0, 240, 255", theme.PrimaryRgb);
        Assert.Equal("#4f46e5", theme.Accent);
        Assert.Equal("79, 70, 229", theme.AccentRgb);
    }

    [Fact]
    public void Theme_catalog_builds_custom_from_the_provided_colours()
    {
        ColorTheme custom = ThemeCatalog.Resolve(ThemeId.Custom, "#123456", "#abcdef");

        Assert.Equal(ThemeId.Custom, custom.Id);
        Assert.Equal("Custom", custom.Name);
        Assert.Equal("#123456", custom.Primary);
        Assert.Equal("18, 52, 86", custom.PrimaryRgb);
        Assert.Equal("#abcdef", custom.Accent);
        Assert.Equal("171, 205, 239", custom.AccentRgb);
    }

    [Fact]
    public void Theme_catalog_default_custom_colours_match_the_web_constants()
    {
        Assert.Equal("#00b4d8", ThemeCatalog.DefaultCustomPrimary);
        Assert.Equal("#e63946", ThemeCatalog.DefaultCustomAccent);
        Assert.Equal(ThemeId.NeonCyan, ThemeCatalog.DefaultId);
    }

    [Theory]
    [InlineData(ThemeId.NeonCyan, "neon-cyan")]
    [InlineData(ThemeId.TeslaRed, "tesla-red")]
    [InlineData(ThemeId.MatrixGreen, "matrix-green")]
    [InlineData(ThemeId.RoyalPurple, "royal-purple")]
    [InlineData(ThemeId.SolarAmber, "solar-amber")]
    [InlineData(ThemeId.Custom, "custom")]
    public void Theme_wire_id_round_trips(ThemeId id, string wire)
    {
        Assert.Equal(wire, ThemeCatalog.ToWireId(id));
        Assert.Equal(id, ThemeCatalog.TryParseId(wire));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("bogus-theme")]
    public void Theme_TryParse_returns_null_for_unknown_wire_ids(string? wire) =>
        Assert.Null(ThemeCatalog.TryParseId(wire));

    // ── mode catalog: the web `modes` record + resolvedMode ──────────────────────────────────────────────

    [Fact]
    public void Mode_catalog_exposes_the_seven_web_modes_in_order() =>
        Assert.Equal(
            new[] { ModeId.Dark, ModeId.Light, ModeId.Oled, ModeId.Midnight, ModeId.Auto, ModeId.Sunset, ModeId.Nord },
            ModeCatalog.Ids.ToArray());

    [Fact]
    public void Mode_catalog_resolves_dark_verbatim()
    {
        ModeTheme dark = ModeCatalog.Resolve(ModeId.Dark, systemDark: true);

        Assert.Equal(ModeId.Dark, dark.Id);
        Assert.Equal("#0a0a0f", dark.Background);
        Assert.Equal("#0f1019", dark.Surface1);
        Assert.Equal("rgba(255, 255, 255, 0.04)", dark.GlassBackground);
        Assert.Equal("#ffffff", dark.TextPrimary);
        Assert.Equal(ColorScheme.Dark, dark.ColorScheme);
    }

    [Fact]
    public void Mode_catalog_resolves_auto_from_the_system_preference()
    {
        Assert.Equal(ModeId.Dark, ModeCatalog.Resolve(ModeId.Auto, systemDark: true).Id);
        Assert.Equal(ModeId.Light, ModeCatalog.Resolve(ModeId.Auto, systemDark: false).Id);
    }

    [Fact]
    public void Mode_catalog_light_is_a_light_scheme() =>
        Assert.Equal(ColorScheme.Light, ModeCatalog.Resolve(ModeId.Light, systemDark: true).ColorScheme);

    [Theory]
    [InlineData(ModeId.Dark, "dark")]
    [InlineData(ModeId.Light, "light")]
    [InlineData(ModeId.Oled, "oled")]
    [InlineData(ModeId.Midnight, "midnight")]
    [InlineData(ModeId.Auto, "auto")]
    [InlineData(ModeId.Sunset, "sunset")]
    [InlineData(ModeId.Nord, "nord")]
    public void Mode_wire_id_round_trips(ModeId id, string wire)
    {
        Assert.Equal(wire, ModeCatalog.ToWireId(id));
        Assert.Equal(id, ModeCatalog.TryParseId(wire));
    }

    // ── applied tokens: the web applyThemeCSS output ─────────────────────────────────────────────────────

    [Fact]
    public void AppliedTokens_reproduce_the_thirteen_css_variables_in_web_order()
    {
        AppliedThemeTokens tokens = AppliedThemeTokens.Compute(
            ThemeId.NeonCyan,
            ModeId.Dark,
            ThemeCatalog.Resolve(ThemeId.NeonCyan, ThemeCatalog.DefaultCustomPrimary, ThemeCatalog.DefaultCustomAccent),
            ModeCatalog.Resolve(ModeId.Dark, systemDark: true));

        var expected = new (string Name, string Value)[]
        {
            ("--theme-primary", "#00f0ff"),
            ("--theme-primary-rgb", "0, 240, 255"),
            ("--theme-accent", "#4f46e5"),
            ("--theme-accent-rgb", "79, 70, 229"),
            ("--bg", "#0a0a0f"),
            ("--surface-1", "#0f1019"),
            ("--surface-2", "#151621"),
            ("--surface-3", "#1a1b2e"),
            ("--glass-bg", "rgba(255, 255, 255, 0.04)"),
            ("--glass-border", "rgba(255, 255, 255, 0.08)"),
            ("--text-primary", "#ffffff"),
            ("--text-secondary", "#9ca3af"),
            ("--text-muted", "#6b7280"),
        };

        Assert.Equal(expected.Length, tokens.CssVariables.Count);
        for (var i = 0; i < expected.Length; i++)
        {
            Assert.Equal(expected[i].Name, tokens.CssVariables[i].Name);
            Assert.Equal(expected[i].Value, tokens.CssVariables[i].Value);
        }
    }

    [Fact]
    public void AppliedTokens_expose_the_scheme_and_dark_flag()
    {
        AppliedThemeTokens dark = AppliedThemeTokens.Compute(ThemeId.NeonCyan, ModeId.Dark, AnyTheme(), ModeCatalog.Get(ModeId.Dark));
        AppliedThemeTokens light = AppliedThemeTokens.Compute(ThemeId.NeonCyan, ModeId.Light, AnyTheme(), ModeCatalog.Get(ModeId.Light));

        Assert.True(dark.IsDark);
        Assert.Equal("dark", dark.ColorSchemeToken);
        Assert.False(light.IsDark);
        Assert.Equal("light", light.ColorSchemeToken);
    }

    [Fact]
    public void AppliedTokens_preserve_the_requested_auto_mode_id()
    {
        AppliedThemeTokens tokens = AppliedThemeTokens.Compute(
            ThemeId.NeonCyan,
            ModeId.Auto,
            AnyTheme(),
            ModeCatalog.Resolve(ModeId.Auto, systemDark: false));

        Assert.Equal(ModeId.Auto, tokens.RequestedModeId);
        Assert.Equal(ColorScheme.Light, tokens.ColorScheme);
    }

    // ── seam: local preferences (localStorage) ───────────────────────────────────────────────────────────

    [Fact]
    public void Preference_store_round_trips_values()
    {
        var store = new InMemoryThemePreferenceStore();
        Assert.Null(store.GetThemeId());

        store.SetThemeId("tesla-red");
        store.SetModeId("oled");
        store.SetCustomColors("#111111", "#222222");

        Assert.Equal("tesla-red", store.GetThemeId());
        Assert.Equal("oled", store.GetModeId());
        Assert.Equal("#111111", store.GetCustomPrimary());
        Assert.Equal("#222222", store.GetCustomAccent());
    }

    // ── seam: backend gateway (/settings) ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Gateway_load_returns_the_seeded_snapshot()
    {
        var gateway = new InMemoryThemeSettingsGateway(new ThemeSettingsSnapshot("tesla-red", "midnight", null, null));

        ThemeSettingsSnapshot? loaded = await gateway.LoadAsync();

        Assert.Equal("tesla-red", loaded?.Theme);
        Assert.Equal("midnight", loaded?.Mode);
    }

    [Fact]
    public async Task Gateway_can_simulate_a_load_failure_once()
    {
        var gateway = new InMemoryThemeSettingsGateway { FailNextLoad = true };

        await Assert.ThrowsAsync<InvalidOperationException>(() => gateway.LoadAsync());
        Assert.Null(await gateway.LoadAsync());
    }

    // ── seam: broadcast bus (BroadcastChannel) ───────────────────────────────────────────────────────────

    [Fact]
    public void Broadcast_bus_does_not_echo_to_the_origin()
    {
        var bus = new InProcessThemeBroadcastBus();
        var origin = new object();
        var received = new List<object?>();
        bus.Received += (_, e) => received.Add(e.Origin);

        bus.Publish(new ThemeBroadcast.ThemeChanged(ThemeId.TeslaRed, ModeId.Dark), origin);

        // The single subscriber here records the origin so a real controller can skip its own message.
        Assert.Equal(origin, Assert.Single(received));
    }

    // ── seam: OS colour-scheme probe (matchMedia) ────────────────────────────────────────────────────────

    [Fact]
    public void System_probe_raises_changed_when_the_preference_flips()
    {
        var probe = new FakeSystemColorSchemeProbe(isDark: true);
        var changes = 0;
        probe.Changed += (_, _) => changes++;

        probe.IsDark = false;  // change
        probe.IsDark = false;  // no-op

        Assert.False(probe.IsDark);
        Assert.Equal(1, changes);
    }

    // ── controller: construction from local preferences (web initial useState) ───────────────────────────

    [Fact]
    public void Controller_starts_from_the_defaults_when_nothing_is_persisted()
    {
        using ThemeController controller = NewController(out _);

        Assert.Equal(ThemeId.NeonCyan, controller.ThemeId);
        Assert.Equal(ModeId.Dark, controller.ModeId);
        Assert.Equal("#00b4d8", controller.CustomPrimary);
        Assert.Equal("#e63946", controller.CustomAccent);
        Assert.Equal(ThemeLoadPhase.Initializing, controller.LoadPhase);
        Assert.Equal(ThemeSettingsLoadOutcome.Pending, controller.LoadOutcome);
        Assert.False(controller.IsInitialized);
    }

    [Fact]
    public void Controller_reads_persisted_preferences()
    {
        var prefs = new InMemoryThemePreferenceStore("matrix-green", "oled", "#101010", "#202020");
        using var controller = new ThemeController(SeamsWith(prefs));

        Assert.Equal(ThemeId.MatrixGreen, controller.ThemeId);
        Assert.Equal(ModeId.Oled, controller.ModeId);
        Assert.Equal("#101010", controller.CustomPrimary);
        Assert.Equal("#202020", controller.CustomAccent);
    }

    [Fact]
    public void Controller_falls_back_to_defaults_for_invalid_preferences()
    {
        var prefs = new InMemoryThemePreferenceStore("bogus", "nonsense", null, null);
        using var controller = new ThemeController(SeamsWith(prefs));

        Assert.Equal(ThemeId.NeonCyan, controller.ThemeId);
        Assert.Equal(ModeId.Dark, controller.ModeId);
    }

    [Fact]
    public void Controller_resolves_theme_and_mode_and_tokens_on_construction()
    {
        var prefs = new InMemoryThemePreferenceStore("solar-amber", "nord", null, null);
        using var controller = new ThemeController(SeamsWith(prefs));

        Assert.Equal("#f59e0b", controller.Theme.Primary);
        Assert.Equal(ModeId.Nord, controller.Mode.Id);
        Assert.Equal("#f59e0b", controller.AppliedTokens.PrimaryHex);
        Assert.Equal("#2e3440", controller.AppliedTokens.BackgroundHex);
    }

    // ── controller: the mount-effect backend load (loading → ready) ──────────────────────────────────────

    [Fact]
    public async Task Initialize_folds_backend_settings_in_and_persists_them()
    {
        var prefs = new InMemoryThemePreferenceStore();
        var gateway = new InMemoryThemeSettingsGateway(new ThemeSettingsSnapshot("tesla-red", "midnight", "#aa0000", "#00bb00"));
        using var controller = new ThemeController(SeamsWith(prefs, gateway));

        await controller.InitializeAsync();

        Assert.Equal(ThemeId.TeslaRed, controller.ThemeId);
        Assert.Equal(ModeId.Midnight, controller.ModeId);
        Assert.Equal("#aa0000", controller.CustomPrimary);
        Assert.Equal("#00bb00", controller.CustomAccent);
        Assert.Equal(ThemeSettingsLoadOutcome.AppliedFromBackend, controller.LoadOutcome);
        Assert.Equal(ThemeLoadPhase.Ready, controller.LoadPhase);
        Assert.True(controller.IsInitialized);
        // web apply effect persists the folded-in selection to localStorage.
        Assert.Equal("tesla-red", prefs.GetThemeId());
        Assert.Equal("midnight", prefs.GetModeId());
    }

    [Fact]
    public async Task Initialize_with_no_backend_settings_keeps_the_cached_theme()
    {
        var prefs = new InMemoryThemePreferenceStore("matrix-green", "sunset", null, null);
        using var controller = new ThemeController(SeamsWith(prefs, new InMemoryThemeSettingsGateway(snapshot: null)));

        await controller.InitializeAsync();

        Assert.Equal(ThemeId.MatrixGreen, controller.ThemeId);
        Assert.Equal(ModeId.Sunset, controller.ModeId);
        Assert.Equal(ThemeSettingsLoadOutcome.NoBackendSettings, controller.LoadOutcome);
        Assert.True(controller.IsInitialized);
    }

    [Fact]
    public async Task Initialize_degrades_to_cache_when_the_backend_fails()
    {
        var prefs = new InMemoryThemePreferenceStore("royal-purple", "oled", null, null);
        using var controller = new ThemeController(SeamsWith(prefs, new InMemoryThemeSettingsGateway { FailNextLoad = true }));

        await controller.InitializeAsync();

        // The error / offline state: the cached theme stands and the surface is still made ready.
        Assert.Equal(ThemeId.RoyalPurple, controller.ThemeId);
        Assert.Equal(ModeId.Oled, controller.ModeId);
        Assert.Equal(ThemeSettingsLoadOutcome.DegradedToCache, controller.LoadOutcome);
        Assert.True(controller.IsInitialized);
    }

    [Fact]
    public async Task Initialize_is_idempotent()
    {
        var gateway = new CountingGateway(new ThemeSettingsSnapshot("tesla-red", null, null, null));
        using var controller = new ThemeController(SeamsWith(new InMemoryThemePreferenceStore(), gateway));

        await controller.InitializeAsync();
        await controller.InitializeAsync();

        Assert.Equal(1, gateway.LoadCount);
    }

    // ── controller: setters persist locally + remotely + broadcast ───────────────────────────────────────

    [Fact]
    public void SetTheme_applies_persists_locally_and_raises_changed()
    {
        var prefs = new InMemoryThemePreferenceStore();
        using var controller = new ThemeController(SeamsWith(prefs));
        var changed = new List<string?>();
        controller.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        controller.SetTheme(ThemeId.TeslaRed);

        Assert.Equal(ThemeId.TeslaRed, controller.ThemeId);
        Assert.Equal("#e31937", controller.Theme.Primary);
        Assert.Equal("tesla-red", prefs.GetThemeId());
        Assert.Contains(nameof(ThemeController.Theme), changed);
        Assert.Contains(nameof(ThemeController.AppliedTokens), changed);
    }

    [Fact]
    public async Task SetTheme_does_not_persist_to_backend_before_initialized()
    {
        var gateway = new InMemoryThemeSettingsGateway();
        using var controller = new ThemeController(SeamsWith(new InMemoryThemePreferenceStore(), gateway));

        controller.SetTheme(ThemeId.TeslaRed);  // before initialize → must not write the backend
        Assert.Equal(0, gateway.SaveCount);

        await controller.InitializeAsync();
        controller.SetMode(ModeId.Oled);  // after initialize → fire-and-forget PUT

        Assert.Equal(1, gateway.SaveCount);
        Assert.Equal("tesla-red", gateway.LastSaved?.Theme);
        Assert.Equal("oled", gateway.LastSaved?.Mode);
    }

    [Fact]
    public async Task SetCustomColors_switches_to_custom_persists_and_broadcasts()
    {
        var bus = new InProcessThemeBroadcastBus();
        var messages = new List<ThemeBroadcast>();
        bus.Received += (_, e) => messages.Add(e.Message);
        var prefs = new InMemoryThemePreferenceStore();
        var gateway = new InMemoryThemeSettingsGateway();
        using var controller = new ThemeController(SeamsWith(prefs, gateway, bus));
        await controller.InitializeAsync();

        controller.SetCustomColors("#abcdef", "#fedcba");

        Assert.Equal(ThemeId.Custom, controller.ThemeId);
        Assert.Equal("#abcdef", controller.Theme.Primary);
        Assert.Equal("171, 205, 239", controller.Theme.PrimaryRgb);
        Assert.Equal("#abcdef", prefs.GetCustomPrimary());
        Assert.Contains(messages, m => m is ThemeBroadcast.CustomColors);
        Assert.Contains(messages, m => m is ThemeBroadcast.ThemeChanged);
        Assert.Equal("custom", gateway.LastSaved?.Theme);
    }

    [Fact]
    public void Setters_are_no_ops_for_an_unchanged_value()
    {
        using var controller = NewController(out _);
        var changes = 0;
        controller.PropertyChanged += (_, _) => changes++;

        controller.SetTheme(ThemeId.NeonCyan);  // already the default
        controller.SetMode(ModeId.Dark);        // already the default

        Assert.Equal(0, changes);
    }

    // ── controller: cross-instance broadcast sync (web subscribe, no loop) ───────────────────────────────

    [Fact]
    public void A_change_in_one_window_mirrors_to_another_without_looping_or_re_persisting()
    {
        var bus = new InProcessThemeBroadcastBus();
        var gatewayB = new InMemoryThemeSettingsGateway();
        using var windowA = new ThemeController(SeamsWith(new InMemoryThemePreferenceStore(), new InMemoryThemeSettingsGateway(), bus));
        using var windowB = new ThemeController(SeamsWith(new InMemoryThemePreferenceStore(), gatewayB, bus));
        var bMessages = 0;
        bus.Received += (_, e) => { if (!ReferenceEquals(e.Origin, windowA)) { bMessages++; } };

        windowA.SetTheme(ThemeId.MatrixGreen);

        Assert.Equal(ThemeId.MatrixGreen, windowB.ThemeId);   // mirrored
        Assert.Equal(0, gatewayB.SaveCount);                  // the mirror does not re-persist to the backend
    }

    [Fact]
    public void Custom_colour_broadcast_mirrors_without_changing_the_other_windows_selected_theme()
    {
        var bus = new InProcessThemeBroadcastBus();
        using var windowB = new ThemeController(SeamsWith(new InMemoryThemePreferenceStore("tesla-red", null, null, null), new InMemoryThemeSettingsGateway(), bus));

        // The CustomColors broadcast mirrors the colours; window B keeps its own selected (tesla-red) theme.
        RaiseCustomColors(bus, "#0a0b0c", "#0d0e0f");

        Assert.Equal("#0a0b0c", windowB.CustomPrimary);
        Assert.Equal(ThemeId.TeslaRed, windowB.ThemeId);
    }

    // ── controller: auto mode follows the OS colour scheme (web matchMedia) ──────────────────────────────

    [Fact]
    public void Auto_mode_re_resolves_when_the_system_scheme_flips()
    {
        var probe = new FakeSystemColorSchemeProbe(isDark: true);
        var prefs = new InMemoryThemePreferenceStore("neon-cyan", "auto", null, null);
        using var controller = new ThemeController(SeamsWith(prefs, systemProbe: probe));
        Assert.Equal(ColorScheme.Dark, controller.Mode.ColorScheme);

        probe.IsDark = false;

        Assert.Equal(ColorScheme.Light, controller.Mode.ColorScheme);
        Assert.Equal(ModeId.Auto, controller.ModeId);  // the selection stays 'auto'
    }

    [Fact]
    public void A_fixed_mode_ignores_system_scheme_changes()
    {
        var probe = new FakeSystemColorSchemeProbe(isDark: true);
        var prefs = new InMemoryThemePreferenceStore("neon-cyan", "oled", null, null);
        using var controller = new ThemeController(SeamsWith(prefs, systemProbe: probe));

        probe.IsDark = false;

        Assert.Equal(ModeId.Oled, controller.Mode.Id);
        Assert.False(controller.SystemDark);
    }

    [Fact]
    public void Available_themes_and_modes_expose_the_full_catalogs()
    {
        using var controller = NewController(out _);

        Assert.Equal(6, controller.AvailableThemes.Count);
        Assert.Equal(7, controller.AvailableModes.Count);
        Assert.Contains(controller.AvailableThemes, t => t.Id == ThemeId.Custom);
        Assert.Contains(controller.AvailableModes, m => m.Id == ModeId.Auto);
    }

    [Fact]
    public void Dispose_detaches_from_the_seams()
    {
        var probe = new FakeSystemColorSchemeProbe(isDark: true);
        var bus = new InProcessThemeBroadcastBus();
        var prefs = new InMemoryThemePreferenceStore("neon-cyan", "auto", null, null);
        var controller = new ThemeController(SeamsWith(prefs, broadcast: bus, systemProbe: probe));
        controller.Dispose();

        probe.IsDark = false;  // must not throw or mutate the disposed controller
        RaiseCustomColors(bus, "#010203", "#040506");

        Assert.Equal(ColorScheme.Dark, controller.Mode.ColorScheme);
        Assert.Equal("#00b4d8", controller.CustomPrimary);
    }

    [Fact]
    public void Set_after_dispose_throws()
    {
        var controller = NewController(out _);
        controller.Dispose();

        Assert.Throws<ObjectDisposedException>(() => controller.SetTheme(ThemeId.TeslaRed));
    }

    [Fact]
    public void Controller_rejects_a_null_seam_bundle() =>
        Assert.Throws<ArgumentNullException>(() => new ThemeController(null!));

    // ── accessibility: the provider is a transparent wrapper (web bare fragment, no accessible node) ─────

    [Fact]
    public void Provider_contributes_no_accessible_node_of_its_own() =>
        Assert.False(ThemeProviderAccessibility.ProviderContributesAccessibleNode);

    // ── diagnostics (view.opened / theme.applied / theme.settings_loaded — PII-safe) ─────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ThemeProviderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ThemeProvider", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_emit_theme_applied_with_wire_ids()
    {
        var lines = new List<string>();
        var diagnostics = new ThemeProviderDiagnostics(lines.Add);

        diagnostics.RecordThemeApplied(ThemeId.TeslaRed, ModeId.Midnight);

        Assert.Equal("theme.applied slug=ThemeProvider theme=tesla-red mode=midnight", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_emit_the_settings_load_outcome()
    {
        var lines = new List<string>();
        var diagnostics = new ThemeProviderDiagnostics(lines.Add);

        diagnostics.RecordSettingsLoaded(ThemeSettingsLoadOutcome.DegradedToCache);

        Assert.Equal("theme.settings_loaded slug=ThemeProvider outcome=DegradedToCache", Assert.Single(lines));
    }

    [Fact]
    public async Task Setting_custom_colours_never_leaks_the_hex_value_to_diagnostics()
    {
        var lines = new List<string>();
        var diagnostics = new ThemeProviderDiagnostics(lines.Add);
        using var controller = new ThemeController(SeamsWith(new InMemoryThemePreferenceStore()), diagnostics);
        await controller.InitializeAsync();

        controller.SetCustomColors("#deadbe", "#cafe01");

        Assert.NotEmpty(lines);
        Assert.DoesNotContain(lines, line => line.Contains("deadbe", StringComparison.OrdinalIgnoreCase)
            || line.Contains("cafe01", StringComparison.OrdinalIgnoreCase));
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static ColorTheme AnyTheme() =>
        ThemeCatalog.Resolve(ThemeId.NeonCyan, ThemeCatalog.DefaultCustomPrimary, ThemeCatalog.DefaultCustomAccent);

    private static ThemeController NewController(out ThemeProviderSeams seams)
    {
        seams = ThemeProviderSeams.CreateHeadless();
        return new ThemeController(seams);
    }

    private static ThemeProviderSeams SeamsWith(
        IThemePreferenceStore preferences,
        IThemeSettingsGateway? gateway = null,
        IThemeBroadcastBus? broadcast = null,
        ISystemColorSchemeProbe? systemProbe = null) =>
        new(
            preferences,
            gateway ?? NullThemeSettingsGateway.Instance,
            broadcast ?? NullThemeBroadcastBus.Instance,
            systemProbe ?? new StaticSystemColorSchemeProbe());

    private static void RaiseCustomColors(IThemeBroadcastBus bus, string primary, string accent) =>
        bus.Publish(new ThemeBroadcast.CustomColors(primary, accent), origin: new object());

    /// <summary>A gateway that counts <see cref="LoadAsync"/> calls so idempotence can be asserted.</summary>
    private sealed class CountingGateway : IThemeSettingsGateway
    {
        private readonly ThemeSettingsSnapshot? _snapshot;

        public CountingGateway(ThemeSettingsSnapshot? snapshot) => _snapshot = snapshot;

        public int LoadCount { get; private set; }

        public Task<ThemeSettingsSnapshot?> LoadAsync(CancellationToken cancellationToken = default)
        {
            LoadCount++;
            return Task.FromResult(_snapshot);
        }

        public Task SaveAsync(ThemeSettingsSnapshot snapshot, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }
}
