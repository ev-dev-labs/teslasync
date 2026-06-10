using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Commands;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>CommandTile</c> feature surface's UI-thread-free logic — the label /
/// sublabel resolution through the i18n facade, the last-status success/failure colouring (web
/// <c>lastStatus.startsWith('✓')</c>), the variant hover accent (web <c>hoverStyles</c>), the favorite
/// glyph / brush, the dangerous mark, the busy spinner, the click <see cref="CommandTileActivation"/> branch
/// (web <c>handleClick</c>), the composed Narrator name, the execute event payload, the PII-safe diagnostics
/// and the registration metadata. Mirrors the web spec
/// (web/src/features/system/components/CommandTile.tsx). The WinUI view itself
/// (feature-views\CommandTile\CommandTile.cs) is exercised by the app build.
/// </summary>
public sealed class CommandTileTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string SuccessKey = "TsColorSuccessBrush";
    private const string DangerKey = "TsColorDangerBrush";
    private const string MutedKey = "TsColorTextMutedBrush";
    private const string WarningKey = "TsColorWarningBrush";
    private const string CyanKey = "TsChartSpeedBrush";

    private const string StarOutline = "\uE734";
    private const string StarFilled = "\uE735";

    private static CommandTileModel Model(
        string command = "lock",
        string labelKey = "commands.security.lock",
        string labelFallback = "Lock",
        string? sublabelKey = null,
        string? sublabelFallback = null,
        string iconGlyph = "\uE72E",
        CommandTileVariant variant = CommandTileVariant.Default,
        bool dangerous = false,
        bool loading = false,
        string? lastStatus = null,
        bool isFavorite = false,
        IReadOnlyDictionary<string, object?>? @params = null) =>
        new(command, labelKey, labelFallback, sublabelKey, sublabelFallback, iconGlyph,
            variant, dangerous, loading, lastStatus, isFavorite, @params);

    private static CommandTileDisplay Project(CommandTileModel model) =>
        CommandTileProjection.Project(model, Localizer);

    // ── Label / sublabel (web `t(def.labelKey, def.labelFallback)` / `t(def.sublabelKey ?? '', …)`) ─────

    [Fact]
    public void Label_resolves_to_the_fallback_through_the_localizer()
    {
        Assert.Equal("Lock", Project(Model(labelFallback: "Lock")).Label);
    }

    [Fact]
    public void Label_is_resolved_with_the_label_key()
    {
        var echo = new KeyEchoLocalizer();
        var display = CommandTileProjection.Project(Model(labelKey: "commands.security.lock"), echo);

        Assert.Equal("[commands.security.lock]", display.Label);
        Assert.Contains(("commands.security.lock", "Lock"), echo.Calls);
    }

    [Fact]
    public void Sublabel_is_hidden_when_no_fallback_is_supplied()
    {
        var d = Project(Model(sublabelKey: null, sublabelFallback: null));

        Assert.False(d.ShowSublabel);
        Assert.Equal(string.Empty, d.Sublabel);
    }

    [Fact]
    public void Sublabel_is_shown_and_resolved_when_a_fallback_is_supplied()
    {
        var d = Project(Model(sublabelKey: "commands.security.setMph", sublabelFallback: "Set MPH"));

        Assert.True(d.ShowSublabel);
        Assert.Equal("Set MPH", d.Sublabel);
    }

    [Fact]
    public void Sublabel_uses_the_empty_key_when_sublabel_key_is_null_like_the_web()
    {
        // web: t(def.sublabelKey ?? '', def.sublabelFallback)
        var echo = new KeyEchoLocalizer();
        CommandTileProjection.Project(Model(sublabelKey: null, sublabelFallback: "Wake vehicle"), echo);

        Assert.Contains((string.Empty, "Wake vehicle"), echo.Calls);
    }

    // ── Last-status caption (web shown only when present; green when startsWith('✓') else red) ──────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void LastStatus_is_hidden_when_absent(string? status)
    {
        var d = Project(Model(lastStatus: status));

        Assert.False(d.ShowLastStatus);
        Assert.False(d.LastStatusSuccess);
        Assert.Equal(string.Empty, d.LastStatus);
    }

    [Fact]
    public void LastStatus_success_is_green_when_it_starts_with_the_check_mark()
    {
        var d = Project(Model(lastStatus: "\u2713 5m ago"));

        Assert.True(d.ShowLastStatus);
        Assert.True(d.LastStatusSuccess);
        Assert.Equal(SuccessKey, d.LastStatusBrushKey);
        Assert.Equal("\u2713 5m ago", d.LastStatus);
    }

    [Theory]
    [InlineData("\u2717 5m ago")] // the web failure caption "✗ …"
    [InlineData("failed")]
    [InlineData(" \u2713 leading space is not a prefix")]
    public void LastStatus_failure_is_red_when_it_does_not_start_with_the_check_mark(string status)
    {
        var d = Project(Model(lastStatus: status));

        Assert.True(d.ShowLastStatus);
        Assert.False(d.LastStatusSuccess);
        Assert.Equal(DangerKey, d.LastStatusBrushKey);
    }

    // ── Variant hover accent (web hoverStyles: default→cyan / danger→red / success→green) ───────────────

    [Theory]
    [InlineData(CommandTileVariant.Default, CyanKey)]
    [InlineData(CommandTileVariant.Danger, DangerKey)]
    [InlineData(CommandTileVariant.Success, SuccessKey)]
    public void Variant_selects_its_hover_accent_token(CommandTileVariant variant, string expectedKey)
    {
        Assert.Equal(expectedKey, CommandTileProjection.VariantAccentKey(variant));
        Assert.Equal(expectedKey, Project(Model(variant: variant)).VariantAccentBrushKey);
    }

    // ── Favorite control (web filled amber star vs muted outline) ──────────────────────────────────────

    [Fact]
    public void Favorite_on_is_the_filled_amber_star()
    {
        var d = Project(Model(isFavorite: true));

        Assert.True(d.IsFavorite);
        Assert.Equal(StarFilled, d.FavoriteGlyph);
        Assert.Equal(WarningKey, d.FavoriteBrushKey);
    }

    [Fact]
    public void Favorite_off_is_the_muted_outline_star()
    {
        var d = Project(Model(isFavorite: false));

        Assert.False(d.IsFavorite);
        Assert.Equal(StarOutline, d.FavoriteGlyph);
        Assert.Equal(MutedKey, d.FavoriteBrushKey);
    }

    [Fact]
    public void Favorite_toggle_label_resolves_to_the_source_fallback()
    {
        Assert.Equal("Toggle favorite", Project(Model()).FavoriteToggleLabel);
    }

    [Fact]
    public void Favorite_toggle_label_uses_the_commands_toggle_favorite_key()
    {
        var echo = new KeyEchoLocalizer();
        var d = CommandTileProjection.Project(Model(), echo);

        Assert.Equal("[commands.toggleFavorite]", d.FavoriteToggleLabel);
        Assert.Contains(("commands.toggleFavorite", "Toggle favorite"), echo.Calls);
    }

    // ── Dangerous mark + spinner + activation (web handleClick) ─────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ShowDanger_tracks_the_dangerous_flag(bool dangerous)
    {
        Assert.Equal(dangerous, Project(Model(dangerous: dangerous)).ShowDanger);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ShowSpinner_tracks_the_loading_flag(bool loading)
    {
        Assert.Equal(loading, Project(Model(loading: loading)).ShowSpinner);
    }

    [Fact]
    public void Idle_non_dangerous_tile_executes_on_click()
    {
        Assert.Equal(CommandTileActivation.Execute, Project(Model()).Activation);
        Assert.Equal(CommandTileActivation.Execute, CommandTileProjection.ActivationOf(Model()));
    }

    [Fact]
    public void Idle_dangerous_tile_opens_the_dialog_on_click()
    {
        Assert.Equal(CommandTileActivation.Dialog, Project(Model(dangerous: true)).Activation);
    }

    [Fact]
    public void Loading_tile_is_a_no_op_even_when_dangerous()
    {
        Assert.Equal(CommandTileActivation.None, Project(Model(loading: true)).Activation);
        Assert.Equal(CommandTileActivation.None, Project(Model(loading: true, dangerous: true)).Activation);
    }

    // ── Per-command icon (web def.icon; spinner replaces it while loading) ──────────────────────────────

    [Fact]
    public void Icon_glyph_passes_through()
    {
        Assert.Equal("\uE72E", Project(Model(iconGlyph: "\uE72E")).IconGlyph);
    }

    [Fact]
    public void Icon_glyph_falls_back_when_empty()
    {
        Assert.Equal(CommandTileRegistration.DefaultIconGlyph, Project(Model(iconGlyph: string.Empty)).IconGlyph);
    }

    // ── Accessibility (Narrator name) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_is_the_command_label()
    {
        Assert.Equal("Lock", Project(Model(labelFallback: "Lock")).AutomationName);
    }

    [Fact]
    public void AutomationName_falls_back_to_the_command_id_when_unlabeled()
    {
        var d = Project(Model(command: "wake_up", labelKey: string.Empty, labelFallback: string.Empty));

        Assert.Equal("wake_up", d.AutomationName);
    }

    // ── i18n: the surface injects no English of its own beyond the prop fallbacks ───────────────────────

    [Fact]
    public void Projection_passes_a_non_english_label_through_verbatim()
    {
        const string localized = "ロック"; // the parent already localized the label
        var d = Project(Model(labelKey: "commands.security.lock", labelFallback: localized));

        Assert.Equal(localized, d.Label);
        Assert.Equal(localized, d.AutomationName);
    }

    // ── Per-state "snapshots": every state renders a complete, distinct display ─────────────────────────

    [Fact]
    public void Idle_execute_tile_renders_a_complete_display()
    {
        var d = Project(Model(
            command: "honk_horn", labelKey: "commands.alerts.honk", labelFallback: "Honk",
            sublabelKey: "commands.alerts.horn", sublabelFallback: "Sound horn", iconGlyph: "\uE7F6"));

        Assert.Equal("Honk", d.Label);
        Assert.True(d.ShowSublabel);
        Assert.Equal("Sound horn", d.Sublabel);
        Assert.False(d.ShowLastStatus);
        Assert.False(d.ShowSpinner);
        Assert.False(d.ShowDanger);
        Assert.Equal(StarOutline, d.FavoriteGlyph);
        Assert.Equal(CyanKey, d.VariantAccentBrushKey);
        Assert.Equal(CommandTileActivation.Execute, d.Activation);
        Assert.Equal("\uE7F6", d.IconGlyph);
        Assert.Equal("Honk", d.AutomationName);
    }

    [Fact]
    public void Dangerous_dialog_tile_renders_a_complete_display()
    {
        var d = Project(Model(
            command: "remote_start", labelFallback: "Remote Start", variant: CommandTileVariant.Danger,
            dangerous: true, lastStatus: "\u2717 2m ago"));

        Assert.True(d.ShowDanger);
        Assert.Equal(CommandTileActivation.Dialog, d.Activation);
        Assert.Equal(DangerKey, d.VariantAccentBrushKey);
        Assert.True(d.ShowLastStatus);
        Assert.False(d.LastStatusSuccess);
        Assert.Equal(DangerKey, d.LastStatusBrushKey);
        Assert.False(d.ShowSpinner);
    }

    [Fact]
    public void Loading_favorite_tile_with_success_status_renders_a_complete_display()
    {
        var d = Project(Model(
            labelFallback: "Lock", loading: true, isFavorite: true,
            lastStatus: "\u2713 just now", variant: CommandTileVariant.Success));

        Assert.True(d.ShowSpinner);
        Assert.Equal(CommandTileActivation.None, d.Activation);
        Assert.True(d.IsFavorite);
        Assert.Equal(StarFilled, d.FavoriteGlyph);
        Assert.Equal(WarningKey, d.FavoriteBrushKey);
        Assert.True(d.LastStatusSuccess);
        Assert.Equal(SuccessKey, d.LastStatusBrushKey);
        Assert.Equal(SuccessKey, d.VariantAccentBrushKey);
    }

    // ── Execute event payload (web onExecute(def.command, def.params)) ──────────────────────────────────

    [Fact]
    public void Command_event_args_carry_the_command_and_params()
    {
        var prms = new Dictionary<string, object?> { ["limit"] = 50 };
        var args = new CommandTileCommandEventArgs("speed_limit_set_limit", prms);

        Assert.Equal("speed_limit_set_limit", args.Command);
        Assert.Same(prms, args.Params);
    }

    [Fact]
    public void Command_event_args_default_params_to_null_and_guard_a_null_command()
    {
        var args = new CommandTileCommandEventArgs(null!);

        Assert.Equal(string.Empty, args.Command);
        Assert.Null(args.Params);
    }

    // ── Model defaults ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_model_is_an_idle_unlabeled_non_favorite_tile()
    {
        var m = CommandTileModel.Empty;

        Assert.Equal(string.Empty, m.Command);
        Assert.Equal(CommandTileRegistration.DefaultIconGlyph, m.IconGlyph);
        Assert.Equal(CommandTileVariant.Default, m.Variant);
        Assert.False(m.Dangerous);
        Assert.False(m.Loading);
        Assert.False(m.IsFavorite);
        Assert.Null(m.LastStatus);

        var d = CommandTileProjection.Project(m, Localizer);
        Assert.Equal(CommandTileActivation.Execute, d.Activation);
        Assert.False(d.ShowSublabel);
        Assert.False(d.ShowLastStatus);
    }

    // ── Null guards ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => CommandTileProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => CommandTileProjection.Project(Model(), null!));

    [Fact]
    public void ActivationOf_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => CommandTileProjection.ActivationOf(null!));

    // ── Diagnostics (P1/S11): view.opened slug=CommandTile, PII-safe ────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new CommandTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CommandTile", captured[0]);
        Assert.Equal("view.opened slug=CommandTile", captured[1]);
    }

    [Fact]
    public void Diagnostics_leaks_no_command_or_label()
    {
        var captured = new List<string>();
        var diagnostics = new CommandTileDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        // The only datum on the line is the static surface slug — never a command id or label.
        Assert.All(captured, line => Assert.Equal("view.opened slug=CommandTile", line));
    }

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_glyphs_and_i18n_key()
    {
        Assert.Equal("CommandTile", CommandTileRegistration.Slug);
        Assert.Equal(StarOutline, CommandTileRegistration.FavoriteStarGlyph);
        Assert.Equal(StarFilled, CommandTileRegistration.FavoriteStarFilledGlyph);
        Assert.Equal("\uE7BA", CommandTileRegistration.DangerGlyph);
        Assert.Equal("\uE945", CommandTileRegistration.DefaultIconGlyph);
        Assert.Equal("commands.toggleFavorite", CommandTileRegistration.FavoriteToggleKey);
        Assert.Equal("Toggle favorite", CommandTileRegistration.FavoriteToggleFallback);
    }

    /// <summary>An <see cref="ILocalizer"/> that echoes the requested key (wrapped) and records every call,
    /// so a test can assert which keys the projection resolves.</summary>
    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public List<(string Key, string Fallback)> Calls { get; } = new();

        public string GetString(string key, string fallback)
        {
            Calls.Add((key, fallback));
            return $"[{key}]";
        }
    }
}
