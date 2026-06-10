using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>InputCommandTile</c> feature surface's UI-thread-free logic — the branch
/// projection (ready / loading), the icon fallback, the variant → hover-accent mapping, the web variant-string
/// resolver, the label / sublabel resolution, the last-command status tone rule (<c>✓</c> → success/green,
/// any other non-blank text → failure/red, blank → none), the favorite glyph + accent, the favorite-toggle
/// accessible label, the composed Narrator name, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/InputCommandTile.tsx). The WinUI view itself is exercised by the app
/// build.
/// </summary>
public sealed class InputCommandTileTests
{
    private const string SuccessStatus = "\u2713 Sent";   // web ✓-prefixed success caption
    private const string FailureStatus = "Failed";          // web non-✓ caption → failure tone
    private const string SampleGlyph = "\uE945";            // an arbitrary command glyph supplied by the host

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static InputCommandTileModel Ready(
        string icon = SampleGlyph,
        InputCommandVariant variant = InputCommandVariant.Default,
        string labelKey = "commands.security.lock",
        string labelFallback = "Lock",
        string? sublabelKey = null,
        string? sublabelFallback = null,
        bool loading = false,
        string? lastStatus = null,
        bool isFavorite = false) =>
        new(icon, variant, labelKey, labelFallback, sublabelKey, sublabelFallback, loading, lastStatus, isFavorite);

    private static InputCommandTileDisplay Project(InputCommandTileModel model) =>
        InputCommandTileProjection.Project(model, Localizer);

    // ── Branch: ready vs in-flight (loading) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Ready_when_not_loading()
    {
        var display = Project(Ready());

        Assert.Equal(InputCommandTileState.Ready, display.State);
        Assert.False(display.IsLoading);
    }

    [Fact]
    public void Loading_when_a_dispatch_is_in_flight()
    {
        var display = Project(Ready(loading: true));

        Assert.Equal(InputCommandTileState.Loading, display.State);
        Assert.True(display.IsLoading);
    }

    // ── Icon: passed through, fallback when blank ────────────────────────────────────────────────────────

    [Fact]
    public void Icon_glyph_is_passed_through() =>
        Assert.Equal(SampleGlyph, Project(Ready(icon: SampleGlyph)).IconGlyph);

    [Fact]
    public void Icon_glyph_falls_back_when_blank()
    {
        Assert.Equal(InputCommandTileRegistration.DefaultCommandGlyph, Project(Ready(icon: string.Empty)).IconGlyph);
        Assert.Equal(InputCommandTileRegistration.DefaultCommandGlyph, Project(Ready(icon: null!)).IconGlyph);
    }

    // ── Variant → hover-accent (web hoverStyles) ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(InputCommandVariant.Default, "TsColorAccentBrush")]
    [InlineData(InputCommandVariant.Danger, "TsColorDangerBrush")]
    [InlineData(InputCommandVariant.Success, "TsColorSuccessBrush")]
    public void Hover_accent_follows_the_web_hover_styles(InputCommandVariant variant, string expected)
    {
        Assert.Equal(expected, InputCommandTileProjection.HoverAccentKey(variant));
        Assert.Equal(expected, Project(Ready(variant: variant)).HoverAccentKey);
    }

    [Fact]
    public void Variant_is_passed_through_to_the_display() =>
        Assert.Equal(InputCommandVariant.Danger, Project(Ready(variant: InputCommandVariant.Danger)).Variant);

    // ── Variant string resolver (web def.variant ?? 'default') ───────────────────────────────────────────

    [Theory]
    [InlineData("default", InputCommandVariant.Default)]
    [InlineData("danger", InputCommandVariant.Danger)]
    [InlineData("success", InputCommandVariant.Success)]
    [InlineData("DANGER", InputCommandVariant.Danger)]
    [InlineData("  Success  ", InputCommandVariant.Success)]
    public void ResolveVariant_maps_known_web_strings(string variant, InputCommandVariant expected) =>
        Assert.Equal(expected, InputCommandTileProjection.ResolveVariant(variant));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("warning")]
    public void ResolveVariant_falls_back_to_default_for_unknown(string? variant) =>
        Assert.Equal(InputCommandVariant.Default, InputCommandTileProjection.ResolveVariant(variant));

    // ── Label + sublabel resolution ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Label_resolves_through_the_localizer() =>
        Assert.Equal("Lock", Project(Ready(labelFallback: "Lock")).Label);

    [Fact]
    public void Sublabel_renders_only_when_a_fallback_is_present()
    {
        var with = Project(Ready(sublabelKey: "commands.security.setMph", sublabelFallback: "Set MPH"));
        Assert.True(with.HasSublabel);
        Assert.Equal("Set MPH", with.Sublabel);

        var without = Project(Ready(sublabelFallback: null));
        Assert.False(without.HasSublabel);
        Assert.Equal(string.Empty, without.Sublabel);
    }

    [Fact]
    public void Sublabel_is_absent_when_the_fallback_is_blank() =>
        Assert.False(Project(Ready(sublabelFallback: "   ")).HasSublabel);

    // ── Last-command status tone (web ✓ → green, else red, blank → none) ─────────────────────────────────

    [Theory]
    [InlineData("\u2713 Sent", InputCommandStatusTone.Success)]
    [InlineData("\u2713", InputCommandStatusTone.Success)]
    [InlineData("Failed", InputCommandStatusTone.Error)]
    [InlineData("Error: timeout", InputCommandStatusTone.Error)]
    public void Status_tone_follows_the_web_check_prefix_rule(string status, InputCommandStatusTone expected) =>
        Assert.Equal(expected, InputCommandTileProjection.ToneFor(status));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Status_tone_is_none_when_blank(string? status) =>
        Assert.Equal(InputCommandStatusTone.None, InputCommandTileProjection.ToneFor(status));

    [Fact]
    public void Success_status_is_shown_and_tinted_success()
    {
        var display = Project(Ready(lastStatus: SuccessStatus));

        Assert.True(display.HasStatus);
        Assert.Equal(SuccessStatus, display.StatusText);
        Assert.Equal(InputCommandStatusTone.Success, display.StatusTone);
        Assert.Equal("TsColorSuccessBrush", display.StatusAccentKey);
    }

    [Fact]
    public void Failure_status_is_shown_and_tinted_danger()
    {
        var display = Project(Ready(lastStatus: FailureStatus));

        Assert.True(display.HasStatus);
        Assert.Equal(InputCommandStatusTone.Error, display.StatusTone);
        Assert.Equal("TsColorDangerBrush", display.StatusAccentKey);
    }

    [Fact]
    public void Absent_status_shows_no_caption()
    {
        var display = Project(Ready(lastStatus: null));

        Assert.False(display.HasStatus);
        Assert.Equal(string.Empty, display.StatusText);
        Assert.Equal(InputCommandStatusTone.None, display.StatusTone);
        Assert.Equal(string.Empty, display.StatusAccentKey);
    }

    [Theory]
    [InlineData(InputCommandStatusTone.Success, "TsColorSuccessBrush")]
    [InlineData(InputCommandStatusTone.Error, "TsColorDangerBrush")]
    [InlineData(InputCommandStatusTone.None, "")]
    public void Status_accent_key_maps_each_tone(InputCommandStatusTone tone, string expected) =>
        Assert.Equal(expected, InputCommandTileProjection.StatusAccentKey(tone));

    // ── Favorite glyph + accent ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Favorite_pinned_uses_the_filled_amber_star()
    {
        var display = Project(Ready(isFavorite: true));

        Assert.True(display.IsFavorite);
        Assert.Equal(InputCommandTileRegistration.FavoriteFilledGlyph, display.FavoriteGlyph);
        Assert.Equal("TsColorWarningBrush", display.FavoriteAccentKey);
    }

    [Fact]
    public void Favorite_unpinned_uses_the_muted_outline_star()
    {
        var display = Project(Ready(isFavorite: false));

        Assert.False(display.IsFavorite);
        Assert.Equal(InputCommandTileRegistration.FavoriteOutlineGlyph, display.FavoriteGlyph);
        Assert.Equal("TsColorTextMutedBrush", display.FavoriteAccentKey);
    }

    // ── i18n key (web commands.toggleFavorite) ───────────────────────────────────────────────────────────

    [Fact]
    public void Favorite_toggle_label_resolves_the_source_key()
    {
        Assert.Equal("commands.toggleFavorite", InputCommandTileRegistration.FavoriteToggleKey);
        Assert.Equal("Toggle favorite", InputCommandTileRegistration.FavoriteToggleFallback);
        Assert.Equal("Toggle favorite", Project(Ready()).FavoriteToggleLabel);
    }

    // ── Accessibility: Narrator name composition ─────────────────────────────────────────────────────────

    [Fact]
    public void Automation_name_carries_label_sublabel_and_status()
    {
        var display = Project(Ready(
            labelFallback: "Speed Limit",
            sublabelKey: "commands.security.setMph",
            sublabelFallback: "Set MPH",
            lastStatus: SuccessStatus));

        Assert.Equal($"Speed Limit. Set MPH. {SuccessStatus}", display.AutomationName);
    }

    [Fact]
    public void Automation_name_omits_absent_parts()
    {
        var display = Project(Ready(labelFallback: "Lock", sublabelFallback: null, lastStatus: null));

        Assert.Equal("Lock", display.AutomationName);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name_and_favorite_label()
    {
        Assert.All(
            new[]
            {
                Project(Ready()),
                Project(Ready(loading: true)),
                Project(Ready(lastStatus: FailureStatus, isFavorite: true)),
                Project(Ready(sublabelFallback: "Set MPH", variant: InputCommandVariant.Danger)),
            },
            display =>
            {
                Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
                Assert.False(string.IsNullOrWhiteSpace(display.FavoriteToggleLabel));
            });
    }

    // ── Diagnostics (P1/S11): operational, PII-safe ──────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var captured = new List<string>();
        var diagnostics = new InputCommandTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InputCommandTile", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_dialog_requested_and_favorite_toggled()
    {
        var captured = new List<string>();
        var diagnostics = new InputCommandTileDiagnostics(captured.Add);

        diagnostics.RecordDialogRequested();
        diagnostics.RecordFavoriteToggled();
        diagnostics.RecordFavoriteToggled();

        Assert.Equal(1, diagnostics.DialogsRequested);
        Assert.Equal(2, diagnostics.FavoritesToggled);
        Assert.Equal("dialog.requested slug=InputCommandTile", captured[0]);
        Assert.Equal("favorite.toggled slug=InputCommandTile", captured[1]);
    }

    [Fact]
    public void Diagnostics_never_leak_command_content()
    {
        var captured = new List<string>();
        var diagnostics = new InputCommandTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordDialogRequested();
        diagnostics.RecordFavoriteToggled();

        Assert.All(captured, line =>
        {
            Assert.DoesNotContain("Lock", line, StringComparison.Ordinal);
            Assert.DoesNotContain("Set MPH", line, StringComparison.Ordinal);
            Assert.EndsWith("slug=InputCommandTile", line, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Diagnostics_tolerate_a_null_sink()
    {
        var diagnostics = new InputCommandTileDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordDialogRequested();
        diagnostics.RecordFavoriteToggled();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.DialogsRequested);
        Assert.Equal(1, diagnostics.FavoritesToggled);
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("InputCommandTile", InputCommandTileRegistration.Slug);

    [Fact]
    public void Registration_exposes_distinct_favorite_glyphs() =>
        Assert.NotEqual(InputCommandTileRegistration.FavoriteFilledGlyph, InputCommandTileRegistration.FavoriteOutlineGlyph);

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => InputCommandTileProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => InputCommandTileProjection.Project(InputCommandTileModel.Idle, null!));
}
