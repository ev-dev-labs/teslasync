using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the NewVersionBanner shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner / action automation ids, the ARIA role/live contract, the emerald token keys + sparkle glyph,
/// the per-version sessionStorage key, the version-field names, and the i18n keys + fallbacks the projection
/// references), the pure version helpers (<see cref="NewVersionBannerRegistration.NormalizeVersion"/>,
/// <see cref="NewVersionBannerRegistration.ReadAppVersion"/>, <see cref="NewVersionBannerRegistration.IsNewVersionAvailable"/>),
/// the pure <see cref="NewVersionBannerProjection"/> (visibility gating across pending / same-version / new-version /
/// deferred / re-surface, the localized message + action labels, and the accessible-name contract), the
/// <see cref="StaticVersionWatcherSource"/> and <see cref="RepositoryVersionWatcherSource"/> boot-then-poll model,
/// the <see cref="InMemoryVersionDismissalStore"/>, the <see cref="NewVersionBannerViewModel"/> state holder
/// (initial projection, reprojection on a new deploy + deferral, deferral persistence, reload request, subscription
/// cleanup), and the PII-safe diagnostics. Mirrors the web spec (web/src/components/feedback/NewVersionBanner.tsx,
/// web/src/hooks/useVersionWatcher.ts and their __tests__). The WinUI view itself
/// (shared-surfaces/NewVersionBanner.cs) and its process-lifetime SessionVersionDismissalStore are exercised by the
/// app build.
/// </summary>
public sealed class NewVersionBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("NewVersionBanner", NewVersionBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("new-version-banner", NewVersionBannerRegistration.BannerAutomationId);
        Assert.Equal("new-version-banner-later", NewVersionBannerRegistration.LaterAutomationId);
        Assert.Equal("new-version-banner-reload", NewVersionBannerRegistration.ReloadAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        // web wrapper div: role="status" aria-live="polite".
        Assert.Equal("status", NewVersionBannerRegistration.StatusRole);
        Assert.Equal("polite", NewVersionBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Emerald_token_keys_glyph_and_opacities_match_the_web_accent()
    {
        Assert.Equal("TsColorSuccessColor", NewVersionBannerRegistration.AccentColorKey);
        Assert.Equal("TsColorSuccessBrush", NewVersionBannerRegistration.AccentBrushKey);
        Assert.Equal("TsMaterialOverlayBrush", NewVersionBannerRegistration.OverlayBrushKey);
        Assert.Equal("\uE734", NewVersionBannerRegistration.SparkleGlyph);
        Assert.Equal(0.10, NewVersionBannerRegistration.ChipBackgroundOpacity);
        Assert.Equal(0.30, NewVersionBannerRegistration.CardBorderOpacity);
    }

    [Fact]
    public void Session_dismiss_key_matches_the_web_sessionstorage_key()
    {
        // web/src/components/feedback/NewVersionBanner.tsx L25 — reused verbatim.
        Assert.Equal("teslasync:new-version-dismissed-for", NewVersionBannerRegistration.SessionDismissStorageKey);
    }

    [Fact]
    public void Version_field_names_cover_the_camelcase_duality()
    {
        Assert.Equal("app_version", NewVersionBannerRegistration.AppVersionField);
        Assert.Equal("appVersion", NewVersionBannerRegistration.AppVersionFieldCamel);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.app.newVersion.message", NewVersionBannerRegistration.MessageKey);
        Assert.Equal("A new version of TeslaSync is available.", NewVersionBannerRegistration.MessageFallback);
        Assert.Equal("translation.app.newVersion.later", NewVersionBannerRegistration.LaterKey);
        Assert.Equal("Later", NewVersionBannerRegistration.LaterFallback);
        Assert.Equal("translation.app.newVersion.reload", NewVersionBannerRegistration.ReloadKey);
        Assert.Equal("Reload", NewVersionBannerRegistration.ReloadFallback);
    }

    // ── version helpers ───────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("v1.0.0", "v1.0.0")]
    public void NormalizeVersion_treats_null_or_empty_as_no_version(string? input, string? expected) =>
        Assert.Equal(expected, NewVersionBannerRegistration.NormalizeVersion(input));

    [Fact]
    public void ReadAppVersion_reads_the_snake_case_field()
    {
        var payload = Parse("{\"app_version\":\"v1.4.2\"}");
        Assert.Equal("v1.4.2", NewVersionBannerRegistration.ReadAppVersion(payload));
    }

    [Fact]
    public void ReadAppVersion_falls_back_to_the_camelcase_alias()
    {
        // After the web camelCaseKeys transform both shapes may be present; the camel alias is honoured.
        var payload = Parse("{\"appVersion\":\"v9.9.9\"}");
        Assert.Equal("v9.9.9", NewVersionBannerRegistration.ReadAppVersion(payload));
    }

    [Fact]
    public void ReadAppVersion_ignores_an_empty_or_missing_version()
    {
        // web: app_version must be a non-empty string (useVersionWatcher.ts L60).
        Assert.Null(NewVersionBannerRegistration.ReadAppVersion(Parse("{\"app_version\":\"\"}")));
        Assert.Null(NewVersionBannerRegistration.ReadAppVersion(Parse("{\"other\":1}")));
        Assert.Null(NewVersionBannerRegistration.ReadAppVersion(Parse("\"not-an-object\"")));
    }

    [Theory]
    [InlineData(null, null, false)]
    [InlineData("v1.0.0", null, false)]
    [InlineData(null, "v1.0.0", false)]
    [InlineData("v1.0.0", "v1.0.0", false)]
    [InlineData("v1.0.0", "v1.1.0", true)]
    public void IsNewVersionAvailable_matches_the_web_derivation(string? boot, string? latest, bool expected) =>
        Assert.Equal(expected, NewVersionBannerRegistration.IsNewVersionAvailable(boot, latest));

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_collapsed_before_any_version_is_known()
    {
        var projection = NewVersionBannerProjection.Project(null, null, null, Localizer);
        Assert.False(projection.IsVisible);
    }

    [Fact]
    public void Projection_is_collapsed_when_the_version_is_unchanged()
    {
        // web: !newVersionAvailable -> render null.
        var projection = NewVersionBannerProjection.Project("v1.0.0", "v1.0.0", null, Localizer);

        Assert.False(projection.IsVisible);
        // Labels are still resolved so they are ready the instant a new version is detected.
        Assert.Equal("A new version of TeslaSync is available.", projection.Message);
        Assert.Equal("Later", projection.LaterLabel);
        Assert.Equal("Reload", projection.ReloadLabel);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_shown_with_message_and_actions_when_a_new_version_is_available()
    {
        var projection = NewVersionBannerProjection.Project("v1.0.0", "v1.1.0", null, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("A new version of TeslaSync is available.", projection.Message);
        Assert.Equal("Later", projection.LaterLabel);
        Assert.Equal("Reload", projection.ReloadLabel);
        Assert.Equal("v1.1.0", projection.LatestVersion);
    }

    [Fact]
    public void Projection_is_collapsed_when_the_current_version_was_deferred()
    {
        // web: dismissedVersion === latestVersion -> render null.
        var projection = NewVersionBannerProjection.Project("v1.0.0", "v1.1.0", "v1.1.0", Localizer);
        Assert.False(projection.IsVisible);
    }

    [Fact]
    public void Projection_re_surfaces_when_a_newer_version_arrives_after_a_deferral()
    {
        // web: a deferral keyed on v1.1.0 does not suppress the banner once latestVersion advances to v1.2.0.
        var projection = NewVersionBannerProjection.Project("v1.0.0", "v1.2.0", "v1.1.0", Localizer);
        Assert.True(projection.IsVisible);
        Assert.Equal("v1.2.0", projection.LatestVersion);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_is_the_message()
    {
        var projection = NewVersionBannerProjection.Project("v1.0.0", "v1.1.0", null, Localizer);
        Assert.Equal(projection.Message, projection.AccessibleName);
    }

    // ── static watcher source (boot-then-poll model) ──────────────────────────────────────────────────────

    [Fact]
    public void Static_source_starts_with_no_version_and_no_new_version()
    {
        var source = new StaticVersionWatcherSource();
        Assert.Null(source.BootVersion);
        Assert.Null(source.LatestVersion);
        Assert.False(source.NewVersionAvailable);
    }

    [Fact]
    public void Static_source_boot_captures_the_baseline_without_flagging_a_new_version()
    {
        // web: captures the boot version on first mount, newVersionAvailable=false initially.
        var source = new StaticVersionWatcherSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Boot("v2.0.0");

        Assert.Equal("v2.0.0", source.BootVersion);
        Assert.Equal("v2.0.0", source.LatestVersion);
        Assert.False(source.NewVersionAvailable);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Static_source_flags_a_new_version_when_a_poll_returns_a_different_version()
    {
        // web: flips newVersionAvailable=true when a poll returns a different app_version.
        var source = new StaticVersionWatcherSource();
        source.Boot("v2.0.0");
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Poll("v2.1.0");

        Assert.Equal("v2.0.0", source.BootVersion);
        Assert.Equal("v2.1.0", source.LatestVersion);
        Assert.True(source.NewVersionAvailable);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Static_source_keeps_hidden_when_the_polled_version_matches_boot()
    {
        // web: keeps newVersionAvailable=false when the polled version matches boot.
        var source = new StaticVersionWatcherSource();
        source.Boot("v2.0.0");
        source.Poll("v2.0.0");

        Assert.False(source.NewVersionAvailable);
    }

    [Fact]
    public void Static_source_ignores_an_empty_observation()
    {
        // web: ignores responses with a missing or empty app_version field.
        var source = new StaticVersionWatcherSource();
        source.Boot("v3.0.0");
        source.Poll("");
        source.Poll(null);

        Assert.Equal("v3.0.0", source.LatestVersion);
        Assert.False(source.NewVersionAvailable);
    }

    [Fact]
    public void Static_source_seeded_constructor_is_data_bearing()
    {
        var source = new StaticVersionWatcherSource("v1.0.0", "v1.1.0");
        Assert.Equal("v1.0.0", source.BootVersion);
        Assert.Equal("v1.1.0", source.LatestVersion);
        Assert.True(source.NewVersionAvailable);
    }

    // ── repository watcher source ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Repository_source_captures_boot_then_flags_a_new_version_from_the_stream()
    {
        using var source = new RepositoryVersionWatcherSource(
            _ => VersionStream(Loaded("v1.0.0"), Loaded("v1.1.0")));

        await WaitUntilAsync(() => source.NewVersionAvailable);

        Assert.Equal("v1.0.0", source.BootVersion);
        Assert.Equal("v1.1.0", source.LatestVersion);
        Assert.True(source.NewVersionAvailable);
    }

    [Fact]
    public async Task Repository_source_ignores_value_less_emissions()
    {
        using var source = new RepositoryVersionWatcherSource(
            _ => VersionStream(
                RepositoryResult<JsonElement>.Loading(),
                RepositoryResult<JsonElement>.Empty(),
                Loaded("v2.0.0")));

        await WaitUntilAsync(() => source.BootVersion is not null);

        Assert.Equal("v2.0.0", source.BootVersion);
        Assert.Equal("v2.0.0", source.LatestVersion);
        Assert.False(source.NewVersionAvailable);
    }

    [Fact]
    public async Task Repository_source_refresh_reruns_the_stream()
    {
        var calls = 0;
        using var source = new RepositoryVersionWatcherSource(_ =>
        {
            Interlocked.Increment(ref calls);
            return VersionStream(Loaded("v1.0.0"));
        });

        await WaitUntilAsync(() => source.BootVersion is not null);
        source.Refresh();
        await WaitUntilAsync(() => Volatile.Read(ref calls) >= 2);

        Assert.True(Volatile.Read(ref calls) >= 2);
    }

    [Fact]
    public void Repository_source_does_not_stream_after_dispose()
    {
        var calls = 0;
        var source = new RepositoryVersionWatcherSource(
            _ =>
            {
                Interlocked.Increment(ref calls);
                return VersionStream(Loaded("v1.0.0"));
            },
            autoStart: false);

        source.Dispose();
        source.Refresh();

        Assert.Equal(0, Volatile.Read(ref calls));
    }

    // ── dismissal store ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void In_memory_dismissal_store_persists_the_deferred_version_and_is_idempotent()
    {
        var store = new InMemoryVersionDismissalStore();
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.Dismiss("v1.1.0");
        store.Dismiss("v1.1.0");

        Assert.Equal("v1.1.0", store.DismissedVersion);
        Assert.Equal(1, store.DismissCount);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void In_memory_dismissal_store_seeded_constructor_reports_the_prior_deferral()
    {
        var store = new InMemoryVersionDismissalStore("v1.0.0");
        Assert.Equal("v1.0.0", store.DismissedVersion);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_collapsed_when_the_version_is_unchanged()
    {
        var source = new StaticVersionWatcherSource("v1.0.0", "v1.0.0");
        var store = new InMemoryVersionDismissalStore();
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_reprojects_to_visible_when_a_new_deploy_is_detected()
    {
        var source = new StaticVersionWatcherSource();
        source.Boot("v1.0.0");
        var store = new InMemoryVersionDismissalStore();
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Poll("v1.1.0");

        Assert.True(vm.IsVisible);
        Assert.Equal("v1.1.0", vm.LatestVersion);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_dismiss_defers_the_current_version_and_collapses_the_banner()
    {
        // web handleLater: persists latestVersion in sessionStorage and hides the banner.
        var source = new StaticVersionWatcherSource("v1.0.0", "v1.1.0");
        var store = new InMemoryVersionDismissalStore();
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);
        Assert.True(vm.IsVisible);

        vm.DismissForCurrentVersion();

        Assert.False(vm.IsVisible);
        Assert.Equal("v1.1.0", store.DismissedVersion);
        Assert.Equal(1, store.DismissCount);
    }

    [Fact]
    public void View_model_dismiss_is_a_noop_without_a_known_latest_version()
    {
        // web guard: if (latestVersion) { ... } — nothing is persisted when there is no version.
        var source = new StaticVersionWatcherSource();
        var store = new InMemoryVersionDismissalStore();
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);

        vm.DismissForCurrentVersion();

        Assert.Null(store.DismissedVersion);
        Assert.Equal(0, store.DismissCount);
    }

    [Fact]
    public void View_model_starts_collapsed_when_the_current_version_was_already_deferred()
    {
        var source = new StaticVersionWatcherSource("v1.0.0", "v1.1.0");
        var store = new InMemoryVersionDismissalStore("v1.1.0");
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_re_surfaces_when_a_newer_version_arrives_after_a_deferral()
    {
        var source = new StaticVersionWatcherSource("v1.0.0", "v1.2.0");
        var store = new InMemoryVersionDismissalStore("v1.1.0");
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);

        Assert.True(vm.IsVisible);
        Assert.Equal("v1.2.0", vm.LatestVersion);
    }

    [Fact]
    public void View_model_request_reload_raises_the_reload_event()
    {
        // web handleReload -> window.location.reload(); the view performs the restart.
        var source = new StaticVersionWatcherSource("v1.0.0", "v1.1.0");
        var store = new InMemoryVersionDismissalStore();
        using var vm = new NewVersionBannerViewModel(Localizer, source, store);

        var reloads = 0;
        vm.ReloadRequested += (_, _) => reloads++;

        vm.RequestReload();

        Assert.Equal(1, reloads);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticVersionWatcherSource();
        source.Boot("v1.0.0");
        var store = new InMemoryVersionDismissalStore();
        var vm = new NewVersionBannerViewModel(Localizer, source, store);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Poll("v1.1.0");
        store.Dismiss("v1.1.0");

        Assert.Equal(0, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new NewVersionBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=NewVersionBanner", "view.opened slug=NewVersionBanner" },
            lines);
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static RepositoryResult<JsonElement> Loaded(string appVersion) =>
        RepositoryResult<JsonElement>.Loaded(
            Parse($"{{\"app_version\":\"{appVersion}\"}}"),
            DateTimeOffset.UtcNow);

    private static async IAsyncEnumerable<RepositoryResult<JsonElement>> VersionStream(
        params RepositoryResult<JsonElement>[] items)
    {
        await Task.Yield();
        foreach (var item in items)
        {
            yield return item;
        }
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 200; attempt++)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(10);
        }

        Assert.True(condition(), "condition was not met within the timeout");
    }
}
