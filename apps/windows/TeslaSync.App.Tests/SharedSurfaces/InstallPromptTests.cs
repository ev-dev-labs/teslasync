using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the InstallPrompt shared surface's UI-thread-free logic — the registration metadata
/// (slug, the prompt / control automation ids, the download / dismiss glyphs, the brand gradient token keys, the
/// dismissal storage key + 14-day window, the broadcast message type, and the i18n keys with their verbatim web
/// fallbacks), the pure dismissal helpers (<see cref="InstallPromptRegistration.ParseDismissedAt"/>,
/// <see cref="InstallPromptRegistration.FormatDismissedAt"/>,
/// <see cref="InstallPromptRegistration.IsDismissedRecently(string?, System.DateTimeOffset)"/>), the pure
/// <see cref="InstallPromptProjection"/> (the visibility gate, the localized strings, and the accessible
/// name/description contract), the availability seams
/// (<see cref="StaticInstallAvailabilitySource"/> / <see cref="DelegatedInstallAvailabilitySource"/> across the
/// offer / installed / consumed states), the dismissal stores
/// (<see cref="InMemoryInstallDismissalStore"/> / <see cref="DelegatedInstallDismissalStore"/>), the
/// <see cref="InstallPromptViewModel"/> state holder (initial projection, reprojection on both seams, the install
/// presentation + dismissal actions, and subscription cleanup), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/InstallPrompt.tsx). The WinUI view itself (shared-surfaces/InstallPrompt.cs) and its
/// ApplicationData-backed store are exercised by the app build.
/// </summary>
public sealed class InstallPromptTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 11, 12, 0, 0, TimeSpan.Zero);

    private static InstallPromptProjection Project(
        bool canInstall,
        bool isInstalled,
        bool dismissedRecently,
        ILocalizer? localizer = null) =>
        InstallPromptProjection.Project(canInstall, isInstalled, dismissedRecently, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("InstallPrompt", InstallPromptRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("install-prompt", InstallPromptRegistration.PromptAutomationId);
        Assert.Equal("install-prompt-install", InstallPromptRegistration.InstallAutomationId);
        Assert.Equal("install-prompt-dismiss", InstallPromptRegistration.DismissAutomationId);
    }

    [Fact]
    public void Glyphs_match_the_shared_fluent_stand_ins()
    {
        Assert.Equal("\uE896", InstallPromptRegistration.DownloadGlyph);
        Assert.Equal("\uE711", InstallPromptRegistration.DismissGlyph);
    }

    [Fact]
    public void Gradient_tokens_match_the_web_brand_ramp()
    {
        // web from-[#00f0ff] to-[#10b981]: accent cyan -> battery green, sourced from the W1 design tokens.
        Assert.Equal("TsColorAccentColor", InstallPromptRegistration.GradientStartColorKey);
        Assert.Equal("#00F0FF", InstallPromptRegistration.GradientStartFallback);
        Assert.Equal("TsChartBatteryBrush", InstallPromptRegistration.GradientEndBrushKey);
        Assert.Equal("#10B981", InstallPromptRegistration.GradientEndFallback);
    }

    [Fact]
    public void Dismissal_contract_matches_the_web_localstorage_helper()
    {
        Assert.Equal("teslasync-pwa-install-dismissed", InstallPromptRegistration.DismissStorageKey);
        Assert.Equal(14, InstallPromptRegistration.DismissWindowDays);
        Assert.Equal(TimeSpan.FromDays(14), InstallPromptRegistration.DismissWindow);
        Assert.Equal("install.dismissed", InstallPromptRegistration.BroadcastMessageType);
    }

    [Fact]
    public void I18n_keys_resolve_under_the_install_prompt_namespace()
    {
        string[] keys =
        {
            InstallPromptRegistration.TitleKey,
            InstallPromptRegistration.SubtitleKey,
            InstallPromptRegistration.InstallKey,
            InstallPromptRegistration.DismissKey,
        };

        Assert.All(keys, key => Assert.StartsWith("translation.installPrompt.", key, StringComparison.Ordinal));
    }

    [Fact]
    public void I18n_fallbacks_match_the_web_literals_verbatim()
    {
        Assert.Equal("Install TeslaSync", InstallPromptRegistration.TitleFallback);
        Assert.Equal("Add to home screen for native experience", InstallPromptRegistration.SubtitleFallback);
        Assert.Equal("Install", InstallPromptRegistration.InstallFallback);
        Assert.Equal("Dismiss install prompt", InstallPromptRegistration.DismissFallback);
    }

    // ── dismissal helpers ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("NaN")]
    public void ParseDismissedAt_rejects_absent_or_non_numeric_tokens(string? raw) =>
        Assert.Null(InstallPromptRegistration.ParseDismissedAt(raw));

    [Fact]
    public void ParseDismissedAt_reads_epoch_milliseconds()
    {
        var at = InstallPromptRegistration.ParseDismissedAt("0");
        Assert.Equal(DateTimeOffset.FromUnixTimeMilliseconds(0), at);
    }

    [Fact]
    public void FormatDismissedAt_round_trips_through_ParseDismissedAt()
    {
        var raw = InstallPromptRegistration.FormatDismissedAt(Now);
        var parsed = InstallPromptRegistration.ParseDismissedAt(raw);
        Assert.Equal(Now.ToUnixTimeMilliseconds(), parsed!.Value.ToUnixTimeMilliseconds());
    }

    [Fact]
    public void IsDismissedRecently_instant_overload_honours_the_window()
    {
        Assert.False(InstallPromptRegistration.IsDismissedRecently((DateTimeOffset?)null, Now));
        Assert.True(InstallPromptRegistration.IsDismissedRecently(Now.AddDays(-13), Now));
        Assert.False(InstallPromptRegistration.IsDismissedRecently(Now.AddDays(-15), Now));
        // exactly the window boundary is no longer "recent" (web strict <).
        Assert.False(InstallPromptRegistration.IsDismissedRecently(Now.AddDays(-14), Now));
        // a future stamp keeps the prompt suppressed (web Date.now() - ts < window with negative diff).
        Assert.True(InstallPromptRegistration.IsDismissedRecently(Now.AddDays(1), Now));
    }

    [Fact]
    public void IsDismissedRecently_string_overload_parses_then_applies_the_window()
    {
        var recent = InstallPromptRegistration.FormatDismissedAt(Now.AddDays(-1));
        var stale = InstallPromptRegistration.FormatDismissedAt(Now.AddDays(-30));

        Assert.True(InstallPromptRegistration.IsDismissedRecently(recent, Now));
        Assert.False(InstallPromptRegistration.IsDismissedRecently(stale, Now));
        Assert.False(InstallPromptRegistration.IsDismissedRecently((string?)null, Now));
        Assert.False(InstallPromptRegistration.IsDismissedRecently(string.Empty, Now));
    }

    // ── projection ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_visible_only_when_installable_not_installed_and_not_dismissed()
    {
        Assert.True(Project(canInstall: true, isInstalled: false, dismissedRecently: false).IsVisible);
        Assert.False(Project(canInstall: false, isInstalled: false, dismissedRecently: false).IsVisible);
        Assert.False(Project(canInstall: true, isInstalled: true, dismissedRecently: false).IsVisible);
        Assert.False(Project(canInstall: true, isInstalled: false, dismissedRecently: true).IsVisible);
    }

    [Fact]
    public void Projection_resolves_every_label_through_the_localizer()
    {
        var p = Project(canInstall: true, isInstalled: false, dismissedRecently: false);
        Assert.Equal("Install TeslaSync", p.Title);
        Assert.Equal("Add to home screen for native experience", p.Subtitle);
        Assert.Equal("Install", p.InstallLabel);
        Assert.Equal("Dismiss install prompt", p.DismissLabel);
    }

    [Fact]
    public void Projection_accessible_name_is_the_title_and_description_is_the_subtitle()
    {
        var p = Project(canInstall: true, isInstalled: false, dismissedRecently: false);
        Assert.Equal(p.Title, p.AccessibleName);
        Assert.Equal(p.Subtitle, p.Description);
        Assert.False(string.IsNullOrWhiteSpace(p.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(p.DismissLabel));
    }

    [Fact]
    public void Projection_throws_on_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => InstallPromptProjection.Project(true, false, false, null!));

    // ── availability sources ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_defaults_to_no_offer_and_not_installed()
    {
        var source = new StaticInstallAvailabilitySource();
        Assert.False(source.CanInstall);
        Assert.False(source.IsInstalled);
    }

    [Fact]
    public void StaticSource_offer_raises_changed_and_exposes_the_affordance()
    {
        var source = new StaticInstallAvailabilitySource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Offer();

        Assert.True(source.CanInstall);
        Assert.Equal(1, raised);

        source.Offer(); // idempotent — no further change.
        Assert.Equal(1, raised);
    }

    [Fact]
    public void StaticSource_mark_installed_clears_the_offer()
    {
        var source = new StaticInstallAvailabilitySource(canInstall: true);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.MarkInstalled();

        Assert.True(source.IsInstalled);
        Assert.False(source.CanInstall);
        Assert.Equal(1, raised);
    }

    [Fact]
    public async Task StaticSource_prompt_consumes_the_affordance_and_returns_the_outcome()
    {
        var source = new StaticInstallAvailabilitySource(canInstall: true) { NextOutcome = InstallChoiceOutcome.Accepted };
        var raised = 0;
        source.Changed += (_, _) => raised++;

        var outcome = await source.PromptAsync();

        Assert.Equal(InstallChoiceOutcome.Accepted, outcome);
        Assert.False(source.CanInstall); // one-shot affordance consumed (web setDeferredPrompt(null)).
        Assert.Equal(1, raised);
        Assert.Equal(1, source.PromptCount);
    }

    [Fact]
    public async Task StaticSource_prompt_without_an_offer_returns_dismissed()
    {
        var source = new StaticInstallAvailabilitySource();
        var outcome = await source.PromptAsync();
        Assert.Equal(InstallChoiceOutcome.Dismissed, outcome);
        Assert.Equal(1, source.PromptCount);
    }

    [Fact]
    public async Task DelegatedSource_reads_delegates_and_presents_the_affordance()
    {
        var canInstall = true;
        var installed = false;
        var presented = 0;
        var source = new DelegatedInstallAvailabilitySource(
            () => canInstall,
            () => installed,
            () =>
            {
                presented++;
                return Task.FromResult(InstallChoiceOutcome.Accepted);
            });
        var raised = 0;
        source.Changed += (_, _) => raised++;

        Assert.True(source.CanInstall);
        Assert.False(source.IsInstalled);

        var outcome = await source.PromptAsync();
        Assert.Equal(InstallChoiceOutcome.Accepted, outcome);
        Assert.Equal(1, presented);
        Assert.Equal(1, raised); // consumption surfaced.

        source.RaiseChanged();
        Assert.Equal(2, raised);
    }

    [Fact]
    public async Task DelegatedSource_without_a_presenter_or_offer_returns_dismissed()
    {
        var withoutPresenter = new DelegatedInstallAvailabilitySource(() => true, () => false);
        Assert.Equal(InstallChoiceOutcome.Dismissed, await withoutPresenter.PromptAsync());

        var notOffered = new DelegatedInstallAvailabilitySource(
            () => false,
            () => false,
            () => Task.FromResult(InstallChoiceOutcome.Accepted));
        Assert.Equal(InstallChoiceOutcome.Dismissed, await notOffered.PromptAsync());
    }

    [Fact]
    public void DelegatedSource_validates_its_readers()
    {
        Assert.Throws<ArgumentNullException>(() => new DelegatedInstallAvailabilitySource(null!, () => false));
        Assert.Throws<ArgumentNullException>(() => new DelegatedInstallAvailabilitySource(() => false, null!));
    }

    // ── dismissal stores ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void InMemoryStore_starts_not_dismissed_and_records_a_dismissal()
    {
        var store = new InMemoryInstallDismissalStore(() => Now);
        var raised = 0;
        store.Changed += (_, _) => raised++;

        Assert.False(store.IsDismissedRecently);

        store.Dismiss();

        Assert.True(store.IsDismissedRecently);
        Assert.Equal(Now, store.DismissedAt);
        Assert.Equal(1, store.DismissCount);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void InMemoryStore_reset_clears_the_dismissal()
    {
        var store = new InMemoryInstallDismissalStore(() => Now);
        store.Dismiss();
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.Reset();

        Assert.False(store.IsDismissedRecently);
        Assert.Null(store.DismissedAt);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void InMemoryStore_seeded_stale_dismissal_is_not_recent()
    {
        var store = new InMemoryInstallDismissalStore(() => Now, Now.AddDays(-30));
        Assert.False(store.IsDismissedRecently);
    }

    [Fact]
    public void DelegatedStore_round_trips_through_the_host_reader_writer()
    {
        string? stored = null;
        var store = new DelegatedInstallDismissalStore(() => stored, v => stored = v, () => Now);
        var raised = 0;
        store.Changed += (_, _) => raised++;

        Assert.False(store.IsDismissedRecently);

        store.Dismiss();

        Assert.NotNull(stored);
        Assert.True(store.IsDismissedRecently);
        Assert.Equal(1, raised);
        Assert.Equal(InstallPromptRegistration.FormatDismissedAt(Now), stored);
    }

    [Fact]
    public void DelegatedStore_read_failure_degrades_to_not_dismissed()
    {
        var store = new DelegatedInstallDismissalStore(
            () => throw new InvalidOperationException("storage unavailable"),
            _ => { },
            () => Now);

        Assert.False(store.IsDismissedRecently);
    }

    [Fact]
    public void DelegatedStore_write_failure_is_swallowed_but_still_notifies()
    {
        var store = new DelegatedInstallDismissalStore(
            () => null,
            _ => throw new InvalidOperationException("quota exceeded"),
            () => Now);
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.Dismiss(); // must not throw.

        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedStore_external_dismissal_notification_re_renders()
    {
        var store = new DelegatedInstallDismissalStore(() => null, _ => { }, () => Now);
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.NotifyExternalDismissal();

        Assert.Equal(1, raised);
    }

    [Fact]
    public void DelegatedStore_validates_its_reader_and_writer()
    {
        Assert.Throws<ArgumentNullException>(() => new DelegatedInstallDismissalStore(null!, _ => { }));
        Assert.Throws<ArgumentNullException>(() => new DelegatedInstallDismissalStore(() => null, null!));
    }

    // ── view model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_initial_projection_reflects_the_seams()
    {
        var availability = new StaticInstallAvailabilitySource(canInstall: true);
        using var vm = new InstallPromptViewModel(Localizer, availability, new InMemoryInstallDismissalStore(() => Now));

        Assert.True(vm.IsVisible);
        Assert.Equal("Install TeslaSync", vm.Title);
        Assert.Equal("Add to home screen for native experience", vm.Subtitle);
        Assert.Equal("Install", vm.InstallLabel);
        Assert.Equal("Dismiss install prompt", vm.DismissLabel);
        Assert.Equal(vm.Title, vm.AccessibleName);
        Assert.Equal(vm.Subtitle, vm.Description);
    }

    [Fact]
    public void ViewModel_reprojects_when_an_offer_arrives()
    {
        var availability = new StaticInstallAvailabilitySource();
        using var vm = new InstallPromptViewModel(Localizer, availability, new InMemoryInstallDismissalStore(() => Now));
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        Assert.False(vm.IsVisible);
        availability.Offer();

        Assert.True(vm.IsVisible);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_dismiss_persists_and_collapses_the_prompt()
    {
        var availability = new StaticInstallAvailabilitySource(canInstall: true);
        var store = new InMemoryInstallDismissalStore(() => Now);
        using var vm = new InstallPromptViewModel(Localizer, availability, store);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        Assert.True(vm.IsVisible);
        vm.Dismiss();

        Assert.False(vm.IsVisible);
        Assert.Equal(1, store.DismissCount);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void ViewModel_hides_once_the_app_is_installed()
    {
        var availability = new StaticInstallAvailabilitySource(canInstall: true);
        using var vm = new InstallPromptViewModel(Localizer, availability, new InMemoryInstallDismissalStore(() => Now));

        Assert.True(vm.IsVisible);
        availability.MarkInstalled();
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_install_presents_the_affordance_and_collapses_the_prompt()
    {
        var availability = new StaticInstallAvailabilitySource(canInstall: true) { NextOutcome = InstallChoiceOutcome.Accepted };
        using var vm = new InstallPromptViewModel(Localizer, availability, new InMemoryInstallDismissalStore(() => Now));

        Assert.True(vm.IsVisible);
        var outcome = await vm.InstallAsync();

        Assert.Equal(InstallChoiceOutcome.Accepted, outcome);
        Assert.Equal(1, availability.PromptCount);
        Assert.False(vm.IsVisible); // affordance consumed.
    }

    [Fact]
    public async Task ViewModel_install_without_an_offer_is_a_no_op()
    {
        var availability = new StaticInstallAvailabilitySource();
        using var vm = new InstallPromptViewModel(Localizer, availability, new InMemoryInstallDismissalStore(() => Now));

        var outcome = await vm.InstallAsync();

        Assert.Equal(InstallChoiceOutcome.Dismissed, outcome);
        Assert.Equal(0, availability.PromptCount);
    }

    [Fact]
    public async Task ViewModel_install_swallows_a_presenter_failure()
    {
        var availability = new DelegatedInstallAvailabilitySource(
            () => true,
            () => false,
            () => throw new InvalidOperationException("presenter unavailable"));
        using var vm = new InstallPromptViewModel(Localizer, availability, new InMemoryInstallDismissalStore(() => Now));

        var outcome = await vm.InstallAsync();

        Assert.Equal(InstallChoiceOutcome.Dismissed, outcome);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_both_seams()
    {
        var availability = new StaticInstallAvailabilitySource();
        var store = new InMemoryInstallDismissalStore(() => Now);
        var vm = new InstallPromptViewModel(Localizer, availability, store);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;

        vm.Dispose();
        availability.Offer();
        store.Dismiss();

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_validates_its_dependencies()
    {
        var availability = new StaticInstallAvailabilitySource();
        var store = new InMemoryInstallDismissalStore();
        Assert.Throws<ArgumentNullException>(() => new InstallPromptViewModel(null!, availability, store));
        Assert.Throws<ArgumentNullException>(() => new InstallPromptViewModel(Localizer, null!, store));
        Assert.Throws<ArgumentNullException>(() => new InstallPromptViewModel(Localizer, availability, null!));
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_the_view_opened_event_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new InstallPromptDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InstallPrompt", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count()
    {
        var diagnostics = new InstallPromptDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
