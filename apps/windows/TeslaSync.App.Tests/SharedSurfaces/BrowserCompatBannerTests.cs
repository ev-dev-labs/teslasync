using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the BrowserCompatBanner shared surface's UI-thread-free logic — the registration
/// metadata (slug, the banner / dismiss automation ids, the ARIA role/live contract, the warning token keys + glyph,
/// the versioned dismissal key, the feature separator, and the i18n keys + fallbacks the projection references), the
/// <see cref="BrowserCompatRegistration.DetectMissing"/> adapter (collects missing names in order, treats a throwing
/// probe as missing) and the default capability registry (all present on a healthy host), the
/// <see cref="BrowserCompatSnapshot"/> states, the pure <see cref="BrowserCompatBannerProjection"/> (visibility
/// gating across pending / supported / unsupported / dismissed, the localized title / body / dismiss label, and the
/// accessible-name contract), the <see cref="BrowserCompatBannerViewModel"/> state holder (initial projection,
/// reprojection on detection + dismissal, dismissal persistence, subscription cleanup), the static / capability
/// sources, the in-memory dismissal store, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/BrowserCompatBanner.tsx, web/src/lib/browserCompat.ts). The WinUI view itself
/// (shared-surfaces/BrowserCompatBanner.cs) and its ApplicationData-backed store are exercised by the app build.
/// </summary>
public sealed class BrowserCompatBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly IReadOnlyList<string> SampleMissing = new[] { "BroadcastChannel", "CSS :has()" };

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("BrowserCompatBanner", BrowserCompatRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("browser-compat-banner", BrowserCompatRegistration.BannerAutomationId);
        Assert.Equal("browser-compat-banner-dismiss", BrowserCompatRegistration.DismissAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        // web wrapper div: role="status" aria-live="polite".
        Assert.Equal("status", BrowserCompatRegistration.StatusRole);
        Assert.Equal("polite", BrowserCompatRegistration.LiveSetting);
    }

    [Fact]
    public void Warning_token_keys_and_glyph_match_the_shared_callout_warning()
    {
        Assert.Equal("TsColorWarningBrush", BrowserCompatRegistration.WarningBrushKey);
        Assert.Equal("TsColorWarningColor", BrowserCompatRegistration.WarningColorKey);
        Assert.Equal("\uE7BA", BrowserCompatRegistration.WarningGlyph);
        Assert.Equal(0.08, BrowserCompatRegistration.BannerBackgroundOpacity);
        Assert.Equal(0.20, BrowserCompatRegistration.BannerBorderOpacity);
    }

    [Fact]
    public void Dismissal_storage_key_matches_the_web_localstorage_key()
    {
        // web/src/lib/browserCompat.ts L39 — reused verbatim so a dismissal carries across web/native parity intent.
        Assert.Equal("teslasync:compat-warning-dismissed:v1", BrowserCompatRegistration.DismissalStorageKey);
        Assert.Equal("1", BrowserCompatRegistration.DismissalStorageValue);
    }

    [Fact]
    public void Feature_separator_matches_the_web_join()
    {
        // web: missing.join(', ').
        Assert.Equal(", ", BrowserCompatRegistration.FeatureSeparator);
        Assert.Equal("BroadcastChannel, CSS :has()", BrowserCompatRegistration.JoinFeatures(SampleMissing));
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.compat.banner.title", BrowserCompatRegistration.TitleKey);
        Assert.Equal("Your browser is missing required features", BrowserCompatRegistration.TitleFallback);
        Assert.Equal("translation.compat.banner.body", BrowserCompatRegistration.BodyKey);
        Assert.Equal("TeslaSync needs {0} to work correctly. {1}", BrowserCompatRegistration.BodyFallback);
        Assert.Equal("translation.compat.banner.recommendation", BrowserCompatRegistration.RecommendationKey);
        Assert.Equal(
            "Use Chrome \u2265 110, Edge \u2265 110, Firefox \u2265 109, or Safari \u2265 16.",
            BrowserCompatRegistration.RecommendationFallback);
        Assert.Equal("translation.compat.banner.dismiss", BrowserCompatRegistration.DismissKey);
        Assert.Equal("Dismiss", BrowserCompatRegistration.DismissFallback);
    }

    // ── detection adapter (the web detectMissingFeatures port) ────────────────────────────────────────────

    [Fact]
    public void DetectMissing_collects_only_absent_capabilities_in_registry_order()
    {
        var requirements = new[]
        {
            new BrowserCompatRequirement("Alpha", static () => true),
            new BrowserCompatRequirement("Bravo", static () => false),
            new BrowserCompatRequirement("Charlie", static () => false),
            new BrowserCompatRequirement("Delta", static () => true),
        };

        var missing = BrowserCompatRegistration.DetectMissing(requirements);

        Assert.Equal(new[] { "Bravo", "Charlie" }, missing);
    }

    [Fact]
    public void DetectMissing_treats_a_throwing_probe_as_missing()
    {
        // web: a probe that throws is itself evidence of incompatibility (browserCompat.ts try/catch).
        var requirements = new[]
        {
            new BrowserCompatRequirement("Boom", static () => throw new InvalidOperationException("nope")),
        };

        var missing = BrowserCompatRegistration.DetectMissing(requirements);

        Assert.Equal(new[] { "Boom" }, missing);
    }

    [Fact]
    public void DetectMissing_returns_empty_when_everything_is_present()
    {
        var requirements = new[]
        {
            new BrowserCompatRequirement("Alpha", static () => true),
            new BrowserCompatRequirement("Bravo", static () => true),
        };

        Assert.Empty(BrowserCompatRegistration.DetectMissing(requirements));
    }

    [Fact]
    public void Default_requirements_are_all_present_on_a_healthy_host()
    {
        // The CI/runner is Windows x64/ARM64 with ICU loaded, so the production registry yields a supported host —
        // exactly as the web banner is hidden on every supported browser.
        Assert.Empty(BrowserCompatRegistration.DetectMissing(BrowserCompatRegistration.DefaultRequirements));
    }

    // ── snapshot ──────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Pending_snapshot_has_not_detected_and_is_not_data_bearing()
    {
        Assert.False(BrowserCompatSnapshot.Pending.Detected);
        Assert.False(BrowserCompatSnapshot.Pending.HasMissing);
        Assert.Empty(BrowserCompatSnapshot.Pending.MissingFeatures);
    }

    [Fact]
    public void Supported_snapshot_is_detected_with_no_missing_features()
    {
        Assert.True(BrowserCompatSnapshot.Supported.Detected);
        Assert.False(BrowserCompatSnapshot.Supported.HasMissing);
    }

    [Fact]
    public void Missing_snapshot_is_detected_and_data_bearing()
    {
        var snapshot = BrowserCompatSnapshot.Missing(SampleMissing);

        Assert.True(snapshot.Detected);
        Assert.True(snapshot.HasMissing);
        Assert.Equal(SampleMissing, snapshot.MissingFeatures);
    }

    [Fact]
    public void Snapshot_defensively_copies_the_missing_list()
    {
        var source = new List<string> { "BroadcastChannel" };
        var snapshot = BrowserCompatSnapshot.Missing(source);
        source.Add("structuredClone");

        Assert.Single(snapshot.MissingFeatures);
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_collapsed_while_detection_is_pending()
    {
        var projection = BrowserCompatBannerProjection.Project(BrowserCompatSnapshot.Pending, dismissed: false, Localizer);

        Assert.False(projection.IsVisible);
    }

    [Fact]
    public void Projection_is_collapsed_on_a_supported_host()
    {
        // web: missing.length === 0 -> render null.
        var projection = BrowserCompatBannerProjection.Project(BrowserCompatSnapshot.Supported, dismissed: false, Localizer);

        Assert.False(projection.IsVisible);
        // The strings are still resolved so they are ready the instant a capability is found missing.
        Assert.Equal("Your browser is missing required features", projection.Title);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_shown_with_title_body_and_features_when_unsupported()
    {
        var projection = BrowserCompatBannerProjection.Project(
            BrowserCompatSnapshot.Missing(SampleMissing),
            dismissed: false,
            Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("Your browser is missing required features", projection.Title);
        Assert.Equal("BroadcastChannel, CSS :has()", projection.FeatureList);
        Assert.Contains("BroadcastChannel, CSS :has()", projection.Body);
        Assert.Contains("TeslaSync needs", projection.Body);
        Assert.Contains(BrowserCompatRegistration.RecommendationFallback, projection.Body);
    }

    [Fact]
    public void Projection_is_collapsed_when_dismissed_even_with_missing_features()
    {
        // web: dismissed || missing.length === 0 -> render null.
        var projection = BrowserCompatBannerProjection.Project(
            BrowserCompatSnapshot.Missing(SampleMissing),
            dismissed: true,
            Localizer);

        Assert.False(projection.IsVisible);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_is_the_title_and_body()
    {
        var projection = BrowserCompatBannerProjection.Project(
            BrowserCompatSnapshot.Missing(SampleMissing),
            dismissed: false,
            Localizer);

        Assert.Equal($"{projection.Title}. {projection.Body}", projection.AccessibleName);
    }

    [Fact]
    public void Projection_exposes_a_localized_dismiss_label()
    {
        var projection = BrowserCompatBannerProjection.Project(
            BrowserCompatSnapshot.Missing(SampleMissing),
            dismissed: false,
            Localizer);

        Assert.Equal("Dismiss", projection.DismissLabel);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_collapsed_on_a_supported_host()
    {
        var source = new StaticBrowserCompatSource(BrowserCompatSnapshot.Supported);
        var store = new InMemoryBrowserCompatDismissalStore();
        using var vm = new BrowserCompatBannerViewModel(Localizer, source, store);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_reprojects_when_detection_finds_missing_features()
    {
        var source = new StaticBrowserCompatSource(BrowserCompatSnapshot.Pending);
        var store = new InMemoryBrowserCompatDismissalStore();
        using var vm = new BrowserCompatBannerViewModel(Localizer, source, store);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(BrowserCompatSnapshot.Missing(SampleMissing));

        Assert.True(vm.IsVisible);
        Assert.Equal("BroadcastChannel, CSS :has()", vm.FeatureList);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_dismiss_persists_and_collapses_the_banner()
    {
        var source = new StaticBrowserCompatSource(BrowserCompatSnapshot.Missing(SampleMissing));
        var store = new InMemoryBrowserCompatDismissalStore();
        using var vm = new BrowserCompatBannerViewModel(Localizer, source, store);
        Assert.True(vm.IsVisible);

        vm.Dismiss();

        Assert.False(vm.IsVisible);
        Assert.True(store.IsDismissed);
        Assert.Equal(1, store.DismissCount);
    }

    [Fact]
    public void View_model_starts_collapsed_when_already_dismissed()
    {
        // Simulated relaunch: a prior acknowledgement persists, so the banner stays hidden (web localStorage flag).
        var source = new StaticBrowserCompatSource(BrowserCompatSnapshot.Missing(SampleMissing));
        var store = new InMemoryBrowserCompatDismissalStore(dismissed: true);
        using var vm = new BrowserCompatBannerViewModel(Localizer, source, store);

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticBrowserCompatSource(BrowserCompatSnapshot.Pending);
        var store = new InMemoryBrowserCompatDismissalStore();
        var vm = new BrowserCompatBannerViewModel(Localizer, source, store);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(BrowserCompatSnapshot.Missing(SampleMissing));
        store.Dismiss();

        Assert.Equal(0, raised);
    }

    // ── sources + dismissal store ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_raises_changed_on_set()
    {
        var source = new StaticBrowserCompatSource(BrowserCompatSnapshot.Pending);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(BrowserCompatSnapshot.Missing(SampleMissing));

        Assert.True(source.Current.HasMissing);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Static_source_missing_list_constructor_is_data_bearing()
    {
        var source = new StaticBrowserCompatSource(SampleMissing);

        Assert.True(source.Current.HasMissing);
        Assert.Equal(SampleMissing, source.Current.MissingFeatures);
    }

    [Fact]
    public void Capability_source_maps_empty_detection_to_supported()
    {
        var source = new CapabilityBrowserCompatSource(new[]
        {
            new BrowserCompatRequirement("Alpha", static () => true),
        });

        Assert.True(source.Current.Detected);
        Assert.False(source.Current.HasMissing);
    }

    [Fact]
    public void Capability_source_maps_failed_probes_to_missing()
    {
        var source = new CapabilityBrowserCompatSource(new[]
        {
            new BrowserCompatRequirement("Alpha", static () => false),
        });

        Assert.True(source.Current.HasMissing);
        Assert.Equal(new[] { "Alpha" }, source.Current.MissingFeatures);
    }

    [Fact]
    public void Capability_source_change_subscription_is_a_noop()
    {
        // A process's host capabilities cannot change; subscribing must be safe and never fire.
        var source = new CapabilityBrowserCompatSource(new[]
        {
            new BrowserCompatRequirement("Alpha", static () => false),
        });

        var raised = 0;
        source.Changed += (_, _) => raised++;

        Assert.Equal(0, raised);
        Assert.True(source.Current.HasMissing);
    }

    [Fact]
    public void In_memory_dismissal_store_persists_and_is_idempotent()
    {
        var store = new InMemoryBrowserCompatDismissalStore();
        var raised = 0;
        store.Changed += (_, _) => raised++;

        store.Dismiss();
        store.Dismiss();

        Assert.True(store.IsDismissed);
        Assert.Equal(1, store.DismissCount);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void In_memory_dismissal_store_reset_clears_the_flag()
    {
        // web __resetCompatWarningForTests: clearing storage re-arms the banner.
        var store = new InMemoryBrowserCompatDismissalStore(dismissed: true);
        Assert.True(store.IsDismissed);

        store.Reset();

        Assert.False(store.IsDismissed);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BrowserCompatDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=BrowserCompatBanner", "view.opened slug=BrowserCompatBanner" },
            lines);
    }
}
