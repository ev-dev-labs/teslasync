using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ReloadPrompt shared surface's UI-thread-free logic — the registration metadata
/// (slug, the prompt / control automation ids, the sync glyph, the accent token keys + fallback, the countdown
/// length, the background update-check cadence, and the i18n keys with their verbatim web fallbacks), the pure
/// countdown-message interpolator (<see cref="ReloadPromptRegistration.FormatReloadingIn"/> across the web
/// <c>{{seconds}}</c> and the P1/S10 catalogue's <c>{0}</c> token forms), the pure
/// <see cref="ReloadPromptProjection"/> (the visibility gate, the seconds passthrough, the localized strings, and
/// the accessible name/description contract), the software-update seams
/// (<see cref="StaticSoftwareUpdateSource"/> / <see cref="DelegatedSoftwareUpdateSource"/> across the announced /
/// reloaded / dismissed states), the <see cref="ReloadPromptViewModel"/> state holder (initial projection,
/// reprojection on the seam, the per-second countdown with its auto-reload at zero, the immediate reload + dismiss
/// actions, the countdown reset on re-announce, and subscription cleanup), and the PII-safe diagnostics. Mirrors the
/// web spec (web/src/components/feedback/ReloadPrompt.tsx). The WinUI view itself (shared-surfaces/ReloadPrompt.cs)
/// is exercised by the app build.
/// </summary>
public sealed class ReloadPromptTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ReloadPromptProjection Project(bool needRefresh, int seconds, ILocalizer? localizer = null) =>
        ReloadPromptProjection.Project(needRefresh, seconds, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ReloadPrompt", ReloadPromptRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("reload-prompt", ReloadPromptRegistration.PromptAutomationId);
        Assert.Equal("reload-prompt-reload", ReloadPromptRegistration.ReloadAutomationId);
        Assert.Equal("reload-prompt-later", ReloadPromptRegistration.LaterAutomationId);
    }

    [Fact]
    public void Glyph_matches_the_shared_fluent_stand_in() =>
        Assert.Equal("\uE895", ReloadPromptRegistration.RefreshGlyph);

    [Fact]
    public void Accent_tokens_match_the_web_neon_cyan_ramp()
    {
        // web text-neon-cyan / bg-neon-cyan/10 / border-neon-cyan/30: the brand accent from the W1 design tokens.
        Assert.Equal("TsColorAccentColor", ReloadPromptRegistration.AccentColorKey);
        Assert.Equal("TsColorAccentBrush", ReloadPromptRegistration.AccentBrushKey);
        Assert.Equal("#00F0FF", ReloadPromptRegistration.AccentColorFallback);
        Assert.Equal(0.1, ReloadPromptRegistration.ChipTintOpacity);
        Assert.Equal(0.3, ReloadPromptRegistration.BorderTintOpacity);
    }

    [Fact]
    public void Countdown_contract_matches_the_web_constants()
    {
        Assert.Equal(3, ReloadPromptRegistration.CountdownSeconds);
        Assert.Equal(TimeSpan.FromMinutes(5), ReloadPromptRegistration.UpdateCheckInterval);
    }

    [Fact]
    public void I18n_keys_resolve_under_the_pwa_namespace()
    {
        string[] keys =
        {
            ReloadPromptRegistration.TitleKey,
            ReloadPromptRegistration.ReloadingInKey,
            ReloadPromptRegistration.LaterKey,
            ReloadPromptRegistration.ReloadNowKey,
        };

        Assert.All(keys, key => Assert.StartsWith("translation.pwa.", key, StringComparison.Ordinal));
    }

    [Fact]
    public void I18n_fallbacks_match_the_web_literals_verbatim()
    {
        Assert.Equal("New version available", ReloadPromptRegistration.TitleFallback);
        Assert.Equal("Reloading in {{seconds}}s...", ReloadPromptRegistration.ReloadingInFallback);
        Assert.Equal("Later", ReloadPromptRegistration.LaterFallback);
        Assert.Equal("Reload Now", ReloadPromptRegistration.ReloadNowFallback);
    }

    // ── countdown-message interpolation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void FormatReloadingIn_substitutes_the_web_i18next_token()
    {
        // PassthroughLocalizer returns the fallback verbatim ("Reloading in {{seconds}}s...").
        Assert.Equal("Reloading in 3s...", ReloadPromptRegistration.FormatReloadingIn(Localizer, 3));
        Assert.Equal("Reloading in 0s...", ReloadPromptRegistration.FormatReloadingIn(Localizer, 0));
    }

    [Fact]
    public void FormatReloadingIn_substitutes_the_native_positional_token()
    {
        // The P1/S10 catalogue stores the native form "Reloading in {0}s...".
        var localizer = new KeyedLocalizer(
            (ReloadPromptRegistration.ReloadingInKey, "Reloading in {0}s..."));
        Assert.Equal("Reloading in 2s...", ReloadPromptRegistration.FormatReloadingIn(localizer, 2));
    }

    [Fact]
    public void FormatReloadingIn_throws_on_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ReloadPromptRegistration.FormatReloadingIn(null!, 1));

    // ── projection ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_visible_only_when_an_update_is_pending()
    {
        Assert.True(Project(needRefresh: true, seconds: 3).IsVisible);
        Assert.False(Project(needRefresh: false, seconds: 3).IsVisible);
    }

    [Fact]
    public void Projection_passes_the_countdown_through_to_the_subtitle()
    {
        Assert.Equal(3, Project(needRefresh: true, seconds: 3).Seconds);
        Assert.Equal("Reloading in 3s...", Project(needRefresh: true, seconds: 3).CountdownMessage);
        Assert.Equal("Reloading in 1s...", Project(needRefresh: true, seconds: 1).CountdownMessage);
    }

    [Fact]
    public void Projection_resolves_every_label_through_the_localizer()
    {
        var p = Project(needRefresh: true, seconds: 3);
        Assert.Equal("New version available", p.Title);
        Assert.Equal("Later", p.LaterLabel);
        Assert.Equal("Reload Now", p.ReloadNowLabel);
    }

    [Fact]
    public void Projection_accessible_name_is_the_title_and_description_is_the_countdown()
    {
        var p = Project(needRefresh: true, seconds: 2);
        Assert.Equal(p.Title, p.AccessibleName);
        Assert.Equal(p.CountdownMessage, p.Description);
        Assert.False(string.IsNullOrWhiteSpace(p.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(p.ReloadNowLabel));
    }

    [Fact]
    public void Projection_throws_on_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ReloadPromptProjection.Project(true, 3, null!));

    // ── update sources ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_defaults_to_no_pending_update()
    {
        var source = new StaticSoftwareUpdateSource();
        Assert.False(source.NeedRefresh);
        Assert.Equal(0, source.ReloadCount);
    }

    [Fact]
    public void StaticSource_announce_raises_changed_and_exposes_the_pending_update()
    {
        var source = new StaticSoftwareUpdateSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Announce();

        Assert.True(source.NeedRefresh);
        Assert.Equal(1, raised);

        source.Announce(); // idempotent — no further change.
        Assert.Equal(1, raised);
    }

    [Fact]
    public void StaticSource_dismiss_clears_the_pending_update()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Dismiss();

        Assert.False(source.NeedRefresh);
        Assert.Equal(1, raised);

        source.Dismiss(); // no-op when nothing is pending.
        Assert.Equal(1, raised);
    }

    [Fact]
    public async Task StaticSource_reload_applies_the_update_and_consumes_the_pending_state()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        await source.ReloadAsync();

        Assert.Equal(1, source.ReloadCount);
        Assert.False(source.NeedRefresh); // one-shot relaunch consumed the pending state.
        Assert.Equal(1, raised);
    }

    [Fact]
    public async Task StaticSource_reload_without_a_pending_update_records_the_call_only()
    {
        var source = new StaticSoftwareUpdateSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        await source.ReloadAsync();

        Assert.Equal(1, source.ReloadCount);
        Assert.False(source.NeedRefresh);
        Assert.Equal(0, raised); // no state change to surface.
    }

    [Fact]
    public async Task DelegatedSource_reads_the_delegate_and_reload_invokes_the_hook()
    {
        var need = true;
        var reloaded = 0;
        var source = new DelegatedSoftwareUpdateSource(
            () => need,
            () =>
            {
                reloaded++;
                need = false;
                return Task.CompletedTask;
            },
            () => need = false);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        Assert.True(source.NeedRefresh);

        await source.ReloadAsync();

        Assert.Equal(1, reloaded);
        Assert.False(source.NeedRefresh);
        Assert.Equal(1, raised); // relaunch surfaced the state change.
    }

    [Fact]
    public async Task DelegatedSource_reload_without_a_hook_still_surfaces_the_change()
    {
        var source = new DelegatedSoftwareUpdateSource(() => true);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        await source.ReloadAsync();

        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedSource_dismiss_invokes_the_hook_and_surfaces_the_change()
    {
        var dismissed = 0;
        var source = new DelegatedSoftwareUpdateSource(() => true, dismiss: () => dismissed++);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Dismiss();

        Assert.Equal(1, dismissed);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedSource_raise_changed_surfaces_to_subscribers()
    {
        var source = new DelegatedSoftwareUpdateSource(() => false);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.RaiseChanged();

        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedSource_validates_its_reader() =>
        Assert.Throws<ArgumentNullException>(() => new DelegatedSoftwareUpdateSource(null!));

    // ── view model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_initial_projection_reflects_the_seam()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        using var vm = new ReloadPromptViewModel(Localizer, source);

        Assert.True(vm.IsVisible);
        Assert.Equal(3, vm.Seconds);
        Assert.Equal("New version available", vm.Title);
        Assert.Equal("Reloading in 3s...", vm.CountdownMessage);
        Assert.Equal("Later", vm.LaterLabel);
        Assert.Equal("Reload Now", vm.ReloadNowLabel);
        Assert.Equal(vm.Title, vm.AccessibleName);
        Assert.Equal(vm.CountdownMessage, vm.Description);
    }

    [Fact]
    public void ViewModel_stays_hidden_until_an_update_is_announced()
    {
        var source = new StaticSoftwareUpdateSource();
        using var vm = new ReloadPromptViewModel(Localizer, source);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        Assert.False(vm.IsVisible);

        source.Announce();

        Assert.True(vm.IsVisible);
        Assert.Equal(3, vm.Seconds);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_tick_counts_down_then_auto_reloads_at_zero()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        using var vm = new ReloadPromptViewModel(Localizer, source);

        Assert.Equal(3, vm.Seconds);

        vm.Tick();
        Assert.Equal(2, vm.Seconds);
        Assert.Equal("Reloading in 2s...", vm.CountdownMessage);
        Assert.True(vm.IsVisible);

        vm.Tick();
        Assert.Equal(1, vm.Seconds);
        Assert.True(vm.IsVisible);
        Assert.Equal(0, source.ReloadCount);

        vm.Tick(); // final second — web prev <= 1 -> reload.
        Assert.Equal(1, source.ReloadCount);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void ViewModel_tick_is_a_no_op_while_hidden()
    {
        var source = new StaticSoftwareUpdateSource();
        using var vm = new ReloadPromptViewModel(Localizer, source);

        vm.Tick();

        Assert.Equal(0, source.ReloadCount);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_reload_now_applies_the_update_immediately()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        using var vm = new ReloadPromptViewModel(Localizer, source);

        Assert.True(vm.IsVisible);

        await vm.ReloadAsync();

        Assert.Equal(1, source.ReloadCount);
        Assert.False(vm.IsVisible); // pending state consumed.
    }

    [Fact]
    public async Task ViewModel_reload_is_idempotent_while_a_reload_is_in_flight()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        using var vm = new ReloadPromptViewModel(Localizer, source);

        await vm.ReloadAsync();
        await vm.ReloadAsync(); // second call is guarded — no second relaunch.

        Assert.Equal(1, source.ReloadCount);
    }

    [Fact]
    public void ViewModel_dismiss_hides_without_reloading()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        using var vm = new ReloadPromptViewModel(Localizer, source);

        Assert.True(vm.IsVisible);

        vm.Dismiss();

        Assert.False(vm.IsVisible);
        Assert.False(source.NeedRefresh);
        Assert.Equal(0, source.ReloadCount);
    }

    [Fact]
    public void ViewModel_resets_the_countdown_on_a_fresh_announce()
    {
        var source = new StaticSoftwareUpdateSource(needRefresh: true);
        using var vm = new ReloadPromptViewModel(Localizer, source);

        vm.Tick(); // 3 -> 2
        Assert.Equal(2, vm.Seconds);

        vm.Dismiss();
        Assert.False(vm.IsVisible);

        source.Announce(); // a later update check re-surfaces the banner.

        Assert.True(vm.IsVisible);
        Assert.Equal(3, vm.Seconds); // web setCountdown(COUNTDOWN_SECONDS) on needRefresh -> true.
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_seam()
    {
        var source = new StaticSoftwareUpdateSource();
        var vm = new ReloadPromptViewModel(Localizer, source);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.Dispose();
        source.Announce();

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_validates_its_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new ReloadPromptViewModel(null!, new StaticSoftwareUpdateSource()));
        Assert.Throws<ArgumentNullException>(() => new ReloadPromptViewModel(Localizer, null!));
    }

    [Fact]
    public void ViewModel_exposes_the_canonical_slug() =>
        Assert.Equal("ReloadPrompt", ReloadPromptViewModel.Slug);

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_the_view_opened_event_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ReloadPromptDiagnostics(lines.Add);

        Assert.Equal(0, diagnostics.ViewsOpened);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=ReloadPrompt" }, lines);
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_counts()
    {
        var diagnostics = new ReloadPromptDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    private sealed class KeyedLocalizer : ILocalizer
    {
        private readonly Dictionary<string, string> _overrides = new(StringComparer.Ordinal);

        public KeyedLocalizer(params (string Key, string Value)[] overrides)
        {
            foreach (var (key, value) in overrides)
            {
                _overrides[key] = value;
            }
        }

        public string GetString(string key, string fallback) =>
            _overrides.TryGetValue(key, out var value) ? value : fallback;
    }
}
