using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ToggleCommandTile</c> feature surface's UI-thread-free logic — the lifecycle
/// projection (ready / loading), the on / off state propagation, the on / off icon swap with fallback, the
/// variant → accent mapping, the web variant-string resolver, the per-element on / off token keys (icon glyph,
/// status dot, ON / OFF caption), the label + ON / OFF copy resolution, the last-command status tone rule
/// (<c>✓</c> → success/green, any other non-blank text → failure/red, blank → none), the favorite glyph + accent,
/// the favorite-toggle accessible label, the composed Narrator name, the executed-command payload and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/features/system/components/ToggleCommandTile.tsx). The
/// WinUI view itself is exercised by the app build.
/// </summary>
public sealed class ToggleCommandTileTests
{
    private const string SuccessStatus = "\u2713 Sent";   // web ✓-prefixed success caption
    private const string FailureStatus = "Failed";          // web non-✓ caption → failure tone
    private const string OnGlyph = "\uE945";                // an arbitrary on-state command glyph
    private const string OffGlyph = "\uE7E8";               // an arbitrary off-state command glyph
    private const string AccentBrushKey = "TsColorAccentBrush";
    private const string DangerBrushKey = "TsColorDangerBrush";
    private const string SuccessBrushKey = "TsColorSuccessBrush";

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ToggleCommandTileModel Make(
        string iconOn = OnGlyph,
        string? iconOff = OffGlyph,
        ToggleCommandVariant variant = ToggleCommandVariant.Default,
        string labelKey = "commands.climate.start",
        string labelFallback = "Climate",
        string command = "auto_conditioning_start",
        string? commandOff = "auto_conditioning_stop",
        bool hasStateField = true,
        bool hasInputConfig = false,
        IReadOnlyDictionary<string, object?>? parameters = null,
        bool isOn = false,
        bool loading = false,
        string? lastStatus = null,
        bool isFavorite = false) =>
        new(
            iconOn,
            iconOff,
            variant,
            labelKey,
            labelFallback,
            command,
            commandOff,
            hasStateField,
            hasInputConfig,
            parameters,
            isOn,
            loading,
            lastStatus,
            isFavorite);

    private static ToggleCommandTileDisplay Project(ToggleCommandTileModel model) =>
        ToggleCommandTileProjection.Project(model, Localizer);

    // ── Lifecycle branch: ready vs in-flight (loading) ───────────────────────────────────────────────────

    [Fact]
    public void Ready_when_not_loading()
    {
        var display = Project(Make());

        Assert.Equal(ToggleCommandTileState.Ready, display.State);
        Assert.False(display.IsLoading);
    }

    [Fact]
    public void Loading_when_a_dispatch_is_in_flight()
    {
        var display = Project(Make(loading: true));

        Assert.Equal(ToggleCommandTileState.Loading, display.State);
        Assert.True(display.IsLoading);
    }

    // ── On / off state propagation ───────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void On_off_state_is_passed_through(bool isOn) =>
        Assert.Equal(isOn, Project(Make(isOn: isOn)).IsOn);

    // ── Icon swap: on glyph vs off glyph, with fallback ──────────────────────────────────────────────────

    [Fact]
    public void Icon_uses_the_on_glyph_when_on() =>
        Assert.Equal(OnGlyph, Project(Make(isOn: true)).IconGlyph);

    [Fact]
    public void Icon_uses_the_off_glyph_when_off() =>
        Assert.Equal(OffGlyph, Project(Make(isOn: false)).IconGlyph);

    [Fact]
    public void Icon_falls_back_to_the_on_glyph_when_no_off_glyph()
    {
        Assert.Equal(OnGlyph, Project(Make(iconOff: null, isOn: false)).IconGlyph);
        Assert.Equal(OnGlyph, Project(Make(iconOff: string.Empty, isOn: false)).IconGlyph);
    }

    [Fact]
    public void Icon_falls_back_to_the_default_glyph_when_blank()
    {
        Assert.Equal(
            ToggleCommandTileRegistration.DefaultCommandGlyph,
            Project(Make(iconOn: string.Empty, iconOff: null, isOn: true)).IconGlyph);
        Assert.Equal(
            ToggleCommandTileRegistration.DefaultCommandGlyph,
            Project(Make(iconOn: string.Empty, iconOff: null, isOn: false)).IconGlyph);
    }

    // ── Variant → accent (web onStyles) ──────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(ToggleCommandVariant.Default, AccentBrushKey)]
    [InlineData(ToggleCommandVariant.Danger, DangerBrushKey)]
    [InlineData(ToggleCommandVariant.Success, SuccessBrushKey)]
    public void Accent_follows_the_web_on_styles(ToggleCommandVariant variant, string expected)
    {
        Assert.Equal(expected, ToggleCommandTileProjection.AccentKey(variant));
        Assert.Equal(expected, Project(Make(variant: variant)).AccentKey);
    }

    [Fact]
    public void Variant_is_passed_through_to_the_display() =>
        Assert.Equal(ToggleCommandVariant.Danger, Project(Make(variant: ToggleCommandVariant.Danger)).Variant);

    // ── Variant string resolver (web def.variant ?? 'default') ───────────────────────────────────────────

    [Theory]
    [InlineData("default", ToggleCommandVariant.Default)]
    [InlineData("danger", ToggleCommandVariant.Danger)]
    [InlineData("success", ToggleCommandVariant.Success)]
    [InlineData("DANGER", ToggleCommandVariant.Danger)]
    [InlineData("  Success  ", ToggleCommandVariant.Success)]
    public void ResolveVariant_maps_known_web_strings(string variant, ToggleCommandVariant expected) =>
        Assert.Equal(expected, ToggleCommandTileProjection.ResolveVariant(variant));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("warning")]
    public void ResolveVariant_falls_back_to_default_for_unknown(string? variant) =>
        Assert.Equal(ToggleCommandVariant.Default, ToggleCommandTileProjection.ResolveVariant(variant));

    // ── Per-element on / off token keys ──────────────────────────────────────────────────────────────────

    [Fact]
    public void On_state_tints_icon_dot_and_caption_with_the_accent()
    {
        var display = Project(Make(variant: ToggleCommandVariant.Success, isOn: true));

        Assert.Equal(SuccessBrushKey, display.IconForegroundKey);
        Assert.Equal(SuccessBrushKey, display.DotBrushKey);
        Assert.Equal(SuccessBrushKey, display.ToggleStateAccentKey);
    }

    [Fact]
    public void Off_state_collapses_icon_dot_and_caption_to_muted_surface()
    {
        var display = Project(Make(variant: ToggleCommandVariant.Success, isOn: false));

        Assert.Equal(ToggleCommandTileRegistration.OffForegroundKey, display.IconForegroundKey);
        Assert.Equal(ToggleCommandTileRegistration.OffSurfaceKey, display.DotBrushKey);
        Assert.Equal(ToggleCommandTileRegistration.OffForegroundKey, display.ToggleStateAccentKey);
    }

    // ── Label + ON / OFF caption resolution ──────────────────────────────────────────────────────────────

    [Fact]
    public void Label_resolves_through_the_localizer() =>
        Assert.Equal("Climate", Project(Make(labelFallback: "Climate")).Label);

    [Fact]
    public void Toggle_caption_resolves_on_and_off()
    {
        Assert.Equal("ON", Project(Make(isOn: true)).ToggleStateText);
        Assert.Equal("OFF", Project(Make(isOn: false)).ToggleStateText);
    }

    // ── Last-command status tone (web ✓ → green, else red, blank → none) ─────────────────────────────────

    [Theory]
    [InlineData("\u2713 Sent", ToggleCommandStatusTone.Success)]
    [InlineData("\u2713", ToggleCommandStatusTone.Success)]
    [InlineData("Failed", ToggleCommandStatusTone.Error)]
    [InlineData("Error: timeout", ToggleCommandStatusTone.Error)]
    public void Status_tone_follows_the_web_check_prefix_rule(string status, ToggleCommandStatusTone expected) =>
        Assert.Equal(expected, ToggleCommandTileProjection.ToneFor(status));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Status_tone_is_none_when_blank(string? status) =>
        Assert.Equal(ToggleCommandStatusTone.None, ToggleCommandTileProjection.ToneFor(status));

    [Fact]
    public void Success_status_is_shown_and_tinted_success()
    {
        var display = Project(Make(lastStatus: SuccessStatus));

        Assert.True(display.HasStatus);
        Assert.Equal(SuccessStatus, display.StatusText);
        Assert.Equal(ToggleCommandStatusTone.Success, display.StatusTone);
        Assert.Equal(SuccessBrushKey, display.StatusAccentKey);
    }

    [Fact]
    public void Failure_status_is_shown_and_tinted_danger()
    {
        var display = Project(Make(lastStatus: FailureStatus));

        Assert.True(display.HasStatus);
        Assert.Equal(ToggleCommandStatusTone.Error, display.StatusTone);
        Assert.Equal(DangerBrushKey, display.StatusAccentKey);
    }

    [Fact]
    public void Absent_status_shows_no_caption()
    {
        var display = Project(Make(lastStatus: null));

        Assert.False(display.HasStatus);
        Assert.Equal(string.Empty, display.StatusText);
        Assert.Equal(ToggleCommandStatusTone.None, display.StatusTone);
        Assert.Equal(string.Empty, display.StatusAccentKey);
    }

    [Theory]
    [InlineData(ToggleCommandStatusTone.Success, SuccessBrushKey)]
    [InlineData(ToggleCommandStatusTone.Error, DangerBrushKey)]
    [InlineData(ToggleCommandStatusTone.None, "")]
    public void Status_accent_key_maps_each_tone(ToggleCommandStatusTone tone, string expected) =>
        Assert.Equal(expected, ToggleCommandTileProjection.StatusAccentKey(tone));

    // ── Favorite glyph + accent ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Favorite_pinned_uses_the_filled_amber_star()
    {
        var display = Project(Make(isFavorite: true));

        Assert.True(display.IsFavorite);
        Assert.Equal(ToggleCommandTileRegistration.FavoriteFilledGlyph, display.FavoriteGlyph);
        Assert.Equal("TsColorWarningBrush", display.FavoriteAccentKey);
    }

    [Fact]
    public void Favorite_unpinned_uses_the_muted_outline_star()
    {
        var display = Project(Make(isFavorite: false));

        Assert.False(display.IsFavorite);
        Assert.Equal(ToggleCommandTileRegistration.FavoriteOutlineGlyph, display.FavoriteGlyph);
        Assert.Equal("TsColorTextMutedBrush", display.FavoriteAccentKey);
    }

    // ── i18n keys (web commands.toggleFavorite / commands.on / commands.off) ─────────────────────────────

    [Fact]
    public void Favorite_toggle_label_resolves_the_source_key()
    {
        Assert.Equal("commands.toggleFavorite", ToggleCommandTileRegistration.FavoriteToggleKey);
        Assert.Equal("Toggle favorite", ToggleCommandTileRegistration.FavoriteToggleFallback);
        Assert.Equal("Toggle favorite", Project(Make()).FavoriteToggleLabel);
    }

    [Fact]
    public void On_off_keys_match_the_source()
    {
        Assert.Equal("commands.on", ToggleCommandTileRegistration.OnKey);
        Assert.Equal("ON", ToggleCommandTileRegistration.OnFallback);
        Assert.Equal("commands.off", ToggleCommandTileRegistration.OffKey);
        Assert.Equal("OFF", ToggleCommandTileRegistration.OffFallback);
    }

    // ── Accessibility: Narrator name composition ─────────────────────────────────────────────────────────

    [Fact]
    public void Automation_name_carries_label_state_and_status()
    {
        var display = Project(Make(labelFallback: "Sentry Mode", isOn: true, lastStatus: SuccessStatus));

        Assert.Equal($"Sentry Mode. ON. {SuccessStatus}", display.AutomationName);
    }

    [Fact]
    public void Automation_name_omits_absent_status()
    {
        var display = Project(Make(labelFallback: "Sentry Mode", isOn: false, lastStatus: null));

        Assert.Equal("Sentry Mode. OFF", display.AutomationName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name_and_favorite_label()
    {
        Assert.All(
            new[]
            {
                Project(Make()),
                Project(Make(isOn: true)),
                Project(Make(loading: true)),
                Project(Make(lastStatus: FailureStatus, isFavorite: true)),
                Project(Make(variant: ToggleCommandVariant.Danger, isOn: true)),
            },
            display =>
            {
                Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
                Assert.False(string.IsNullOrWhiteSpace(display.FavoriteToggleLabel));
                Assert.False(string.IsNullOrWhiteSpace(display.ToggleStateText));
            });
    }

    // ── Executed-command payload (web onExecute) ─────────────────────────────────────────────────────────

    [Fact]
    public void Executed_event_args_carry_command_and_parameters()
    {
        var parameters = new Dictionary<string, object?> { ["temp"] = 21 };
        var args = new ToggleCommandExecutedEventArgs("auto_conditioning_start", parameters);

        Assert.Equal("auto_conditioning_start", args.Command);
        Assert.Same(parameters, args.Parameters);
    }

    [Fact]
    public void Executed_event_args_tolerate_null_parameters()
    {
        var args = new ToggleCommandExecutedEventArgs("auto_conditioning_stop", null);

        Assert.Equal("auto_conditioning_stop", args.Command);
        Assert.Null(args.Parameters);
    }

    // ── Diagnostics (P1/S11): operational, PII-safe ──────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ToggleCommandTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ToggleCommandTile", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_command_dialog_and_favorite_activations()
    {
        var captured = new List<string>();
        var diagnostics = new ToggleCommandTileDiagnostics(captured.Add);

        diagnostics.RecordCommandExecuted();
        diagnostics.RecordDialogRequested();
        diagnostics.RecordFavoriteToggled();
        diagnostics.RecordFavoriteToggled();

        Assert.Equal(1, diagnostics.CommandsExecuted);
        Assert.Equal(1, diagnostics.DialogsRequested);
        Assert.Equal(2, diagnostics.FavoritesToggled);
        Assert.Equal("command.executed slug=ToggleCommandTile", captured[0]);
        Assert.Equal("dialog.requested slug=ToggleCommandTile", captured[1]);
        Assert.Equal("favorite.toggled slug=ToggleCommandTile", captured[2]);
    }

    [Fact]
    public void Diagnostics_never_leak_command_content()
    {
        var captured = new List<string>();
        var diagnostics = new ToggleCommandTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordCommandExecuted();
        diagnostics.RecordDialogRequested();
        diagnostics.RecordFavoriteToggled();

        Assert.All(captured, line =>
        {
            Assert.DoesNotContain("auto_conditioning", line, StringComparison.Ordinal);
            Assert.DoesNotContain("Climate", line, StringComparison.Ordinal);
            Assert.EndsWith("slug=ToggleCommandTile", line, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Diagnostics_tolerate_a_null_sink()
    {
        var diagnostics = new ToggleCommandTileDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordCommandExecuted();
        diagnostics.RecordDialogRequested();
        diagnostics.RecordFavoriteToggled();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.CommandsExecuted);
        Assert.Equal(1, diagnostics.DialogsRequested);
        Assert.Equal(1, diagnostics.FavoritesToggled);
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ToggleCommandTile", ToggleCommandTileRegistration.Slug);

    [Fact]
    public void Registration_exposes_distinct_favorite_glyphs() =>
        Assert.NotEqual(
            ToggleCommandTileRegistration.FavoriteFilledGlyph,
            ToggleCommandTileRegistration.FavoriteOutlineGlyph);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ToggleCommandTileProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ToggleCommandTileProjection.Project(ToggleCommandTileModel.Idle, null!));
}
