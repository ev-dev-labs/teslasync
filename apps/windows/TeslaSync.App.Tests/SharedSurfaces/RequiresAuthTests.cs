using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the RequiresAuth shared surface's UI-thread-free logic — the registration metadata
/// (slug, the ARIA role/live contract, the snake_case wire names + the per-capability automation id, the camelCase
/// i18n feature-name key suffixes, the lock glyph, and the title / body / body-with-hint i18n keys + fallbacks the
/// <c>translation.requiresAuth.*</c> catalogue ships), the <see cref="AuthModeResponseAdapter"/> (JSON envelope →
/// snapshot, defensive on missing / malformed fields), the <see cref="RequiresAuthSnapshot"/> states, the pure
/// <see cref="RequiresAuthProjection"/> (the children-vs-notice gate across loading / open / forward-auth-enabled /
/// forward-auth-disabled, the localized title / body with and without a provider hint, the feature-name resolution,
/// the stable automation id, and the accessible-name contract), the <see cref="RequiresAuthViewModel"/> state holder
/// (initial projection, reprojection on contract resolution, subscription cleanup), the static source, and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/components/feedback/RequiresAuth.tsx,
/// web/src/components/feedback/RequiresAuth.test.tsx). The WinUI view itself (shared-surfaces/RequiresAuth.cs) is
/// exercised by the app build.
/// </summary>
public sealed class RequiresAuthTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private const string GenericProviderList = "Authentik, Authelia, oauth2-proxy, Keycloak";

    private static RequiresAuthSnapshot ParseJson(string json)
    {
        using var document = JsonDocument.Parse(json);
        return AuthModeResponseAdapter.FromJson(document.RootElement);
    }

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("RequiresAuth", RequiresAuthRegistration.Slug);

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        // web role="status".
        Assert.Equal("status", RequiresAuthRegistration.StatusRole);
        Assert.Equal("polite", RequiresAuthRegistration.LiveSetting);
    }

    [Fact]
    public void Lock_glyph_is_the_segoe_fluent_lock()
    {
        // Native stand-in for the web Lucide LockKeyhole.
        Assert.Equal("\uE72E", RequiresAuthRegistration.LockGlyph);
    }

    [Theory]
    [InlineData(RequiresAuthCapability.StepUpReauth, "step_up_reauth")]
    [InlineData(RequiresAuthCapability.TotpEnrollment, "totp_enrollment")]
    [InlineData(RequiresAuthCapability.SessionList, "session_list")]
    [InlineData(RequiresAuthCapability.Impersonation, "impersonation")]
    [InlineData(RequiresAuthCapability.Rbac, "rbac")]
    public void Wire_name_matches_the_server_flag_key(RequiresAuthCapability capability, string expected) =>
        Assert.Equal(expected, RequiresAuthRegistration.WireName(capability));

    [Theory]
    [InlineData(RequiresAuthCapability.StepUpReauth, "requires-auth-empty-step_up_reauth")]
    [InlineData(RequiresAuthCapability.TotpEnrollment, "requires-auth-empty-totp_enrollment")]
    [InlineData(RequiresAuthCapability.SessionList, "requires-auth-empty-session_list")]
    [InlineData(RequiresAuthCapability.Impersonation, "requires-auth-empty-impersonation")]
    [InlineData(RequiresAuthCapability.Rbac, "requires-auth-empty-rbac")]
    public void Empty_automation_id_matches_the_web_testid(RequiresAuthCapability capability, string expected) =>
        Assert.Equal(expected, RequiresAuthRegistration.EmptyAutomationId(capability));

    [Theory]
    [InlineData(RequiresAuthCapability.StepUpReauth, "translation.requiresAuth.featureName.stepUpReauth", "Step-up reauthentication")]
    [InlineData(RequiresAuthCapability.TotpEnrollment, "translation.requiresAuth.featureName.totpEnrollment", "TOTP enrollment")]
    [InlineData(RequiresAuthCapability.SessionList, "translation.requiresAuth.featureName.sessionList", "Active sessions")]
    [InlineData(RequiresAuthCapability.Impersonation, "translation.requiresAuth.featureName.impersonation", "User impersonation")]
    [InlineData(RequiresAuthCapability.Rbac, "translation.requiresAuth.featureName.rbac", "Role-based access control")]
    public void Feature_name_keys_and_fallbacks_match_the_catalogue(
        RequiresAuthCapability capability,
        string expectedKey,
        string expectedFallback)
    {
        Assert.Equal(expectedKey, RequiresAuthRegistration.FeatureNameKey(capability));
        Assert.Equal(expectedFallback, RequiresAuthRegistration.FeatureNameFallback(capability));
        Assert.Equal(expectedFallback, RequiresAuthRegistration.ResolveFeatureName(Localizer, capability));
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_catalogue()
    {
        Assert.Equal("translation.requiresAuth.title", RequiresAuthRegistration.TitleKey);
        Assert.Equal("{0} requires authentication mode", RequiresAuthRegistration.TitleFallback);

        Assert.Equal("translation.requiresAuth.body", RequiresAuthRegistration.BodyKey);
        Assert.Contains(GenericProviderList, RequiresAuthRegistration.BodyFallback, StringComparison.Ordinal);
        Assert.Contains("FORWARD_AUTH_HEADER", RequiresAuthRegistration.BodyFallback, StringComparison.Ordinal);

        Assert.Equal("translation.requiresAuth.bodyWithHint", RequiresAuthRegistration.BodyWithHintKey);
        Assert.Contains("{1}", RequiresAuthRegistration.BodyWithHintFallback, StringComparison.Ordinal);
        Assert.DoesNotContain(GenericProviderList, RequiresAuthRegistration.BodyWithHintFallback, StringComparison.Ordinal);
    }

    [Fact]
    public void All_capabilities_lists_the_five_flags_in_order() =>
        Assert.Equal(
            new[]
            {
                RequiresAuthCapability.StepUpReauth,
                RequiresAuthCapability.TotpEnrollment,
                RequiresAuthCapability.SessionList,
                RequiresAuthCapability.Impersonation,
                RequiresAuthCapability.Rbac,
            },
            RequiresAuthRegistration.AllCapabilities);

    // ── capability matrix ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void All_disabled_matrix_reports_every_capability_false()
    {
        var caps = RequiresAuthCapabilities.AllDisabled;
        foreach (var capability in RequiresAuthRegistration.AllCapabilities)
        {
            Assert.False(caps.IsEnabled(capability));
        }
    }

    [Fact]
    public void All_enabled_matrix_reports_every_capability_true()
    {
        var caps = RequiresAuthCapabilities.AllEnabled;
        foreach (var capability in RequiresAuthRegistration.AllCapabilities)
        {
            Assert.True(caps.IsEnabled(capability));
        }
    }

    [Fact]
    public void Matrix_reads_a_single_flag()
    {
        var caps = new RequiresAuthCapabilities(
            stepUpReauth: false,
            totpEnrollment: true,
            sessionList: false,
            impersonation: false,
            rbac: false);

        Assert.True(caps.IsEnabled(RequiresAuthCapability.TotpEnrollment));
        Assert.False(caps.IsEnabled(RequiresAuthCapability.Rbac));
    }

    // ── adapter (the web request<AuthModeResponse> port) ──────────────────────────────────────────────────

    [Fact]
    public void Adapter_reads_open_mode_with_every_capability_disabled()
    {
        var snapshot = ParseJson(
            """{"mode":"open","capabilities":{"step_up_reauth":false,"totp_enrollment":false,"session_list":false,"impersonation":false,"rbac":false}}""");

        Assert.True(snapshot.Resolved);
        Assert.Equal(RequiresAuthMode.Open, snapshot.Mode);
        Assert.Null(snapshot.ProviderHint);
        Assert.False(snapshot.Capabilities.IsEnabled(RequiresAuthCapability.SessionList));
    }

    [Fact]
    public void Adapter_reads_forward_auth_all_enabled_with_metadata()
    {
        var snapshot = ParseJson(
            """{"mode":"forward_auth","subject_header":"X-Forwarded-User","subject":"alice","provider_hint":"authentik","capabilities":{"step_up_reauth":true,"totp_enrollment":true,"session_list":true,"impersonation":true,"rbac":true}}""");

        Assert.True(snapshot.Resolved);
        Assert.Equal(RequiresAuthMode.ForwardAuth, snapshot.Mode);
        Assert.Equal("authentik", snapshot.ProviderHint);
        Assert.Equal("X-Forwarded-User", snapshot.SubjectHeader);
        Assert.Equal("alice", snapshot.Subject);
        Assert.True(snapshot.Capabilities.IsEnabled(RequiresAuthCapability.Rbac));
    }

    [Fact]
    public void Adapter_reads_forward_auth_all_disabled()
    {
        var snapshot = ParseJson(
            """{"mode":"forward_auth","subject_header":"X-Forwarded-User","subject":"alice","capabilities":{"step_up_reauth":false,"totp_enrollment":false,"session_list":false,"impersonation":false,"rbac":false}}""");

        Assert.True(snapshot.Resolved);
        Assert.Equal(RequiresAuthMode.ForwardAuth, snapshot.Mode);
        Assert.Null(snapshot.ProviderHint);
        Assert.False(snapshot.Capabilities.IsEnabled(RequiresAuthCapability.Impersonation));
    }

    [Fact]
    public void Adapter_defaults_missing_capabilities_object_to_all_disabled()
    {
        var snapshot = ParseJson("""{"mode":"forward_auth"}""");

        Assert.True(snapshot.Resolved);
        Assert.Equal(RequiresAuthMode.ForwardAuth, snapshot.Mode);
        foreach (var capability in RequiresAuthRegistration.AllCapabilities)
        {
            Assert.False(snapshot.Capabilities.IsEnabled(capability));
        }
    }

    [Fact]
    public void Adapter_treats_a_non_object_body_as_unresolved()
    {
        var snapshot = ParseJson("\"nope\"");
        Assert.False(snapshot.Resolved);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("{ not json")]
    public void Adapter_text_overload_degrades_to_unresolved(string? json)
    {
        var snapshot = AuthModeResponseAdapter.FromJsonText(json);
        Assert.False(snapshot.Resolved);
    }

    [Fact]
    public void Adapter_text_overload_parses_a_valid_body()
    {
        var snapshot = AuthModeResponseAdapter.FromJsonText(
            """{"mode":"forward_auth","capabilities":{"step_up_reauth":true,"totp_enrollment":false,"session_list":false,"impersonation":false,"rbac":false}}""");

        Assert.True(snapshot.Resolved);
        Assert.True(snapshot.Capabilities.IsEnabled(RequiresAuthCapability.StepUpReauth));
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_while_loading_shows_the_notice_with_vendor_neutral_copy()
    {
        // web isLoading || !data → render the notice (NOT the children) with the generic copy (no hint yet).
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.Unresolved,
            RequiresAuthCapability.TotpEnrollment,
            feature: "TOTP enrollment",
            Localizer);

        Assert.False(projection.ShowChildren);
        Assert.Contains("TOTP enrollment", projection.Title, StringComparison.Ordinal);
        Assert.Contains("TOTP enrollment is only available", projection.Body, StringComparison.Ordinal);
        Assert.Contains(GenericProviderList, projection.Body, StringComparison.Ordinal);
        Assert.Equal("requires-auth-empty-totp_enrollment", projection.EmptyAutomationId);
    }

    [Fact]
    public void Projection_in_open_mode_shows_the_notice_with_generic_copy()
    {
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.OpenMode(),
            RequiresAuthCapability.Impersonation,
            feature: "Impersonation",
            Localizer);

        Assert.False(projection.ShowChildren);
        Assert.Contains(GenericProviderList, projection.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_in_forward_auth_with_capability_enabled_shows_the_children()
    {
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllEnabled, providerHint: "authentik"),
            RequiresAuthCapability.TotpEnrollment,
            feature: "TOTP enrollment",
            Localizer);

        Assert.True(projection.ShowChildren);
    }

    [Fact]
    public void Projection_in_forward_auth_with_capability_disabled_shows_the_notice_with_hint()
    {
        // Defensive branch (currently unreachable — forward-auth is uniformly enabled — but kept covered).
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllDisabled, providerHint: "authentik"),
            RequiresAuthCapability.Rbac,
            feature: "RBAC",
            Localizer);

        Assert.False(projection.ShowChildren);
        Assert.Contains("authentik", projection.Body, StringComparison.Ordinal);
        // Only one body template renders: the provider-list fallback must NOT appear when a hint is present.
        Assert.DoesNotContain(GenericProviderList, projection.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_surfaces_the_provider_hint_verbatim_when_present()
    {
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.OpenMode(providerHint: "Keycloak (corp)"),
            RequiresAuthCapability.SessionList,
            feature: "Active sessions",
            Localizer);

        Assert.False(projection.ShowChildren);
        Assert.Contains("Keycloak (corp)", projection.Body, StringComparison.Ordinal);
        Assert.DoesNotContain(GenericProviderList, projection.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_resolves_the_feature_name_from_the_catalogue_when_unset()
    {
        // web consumers pass an already-translated feature; the native surface falls back to the catalogue name.
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.OpenMode(),
            RequiresAuthCapability.SessionList,
            feature: null,
            Localizer);

        Assert.Equal("Active sessions", projection.Feature);
        Assert.Contains("Active sessions requires authentication mode", projection.Title, StringComparison.Ordinal);
        Assert.Contains("Active sessions is only available", projection.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_uses_the_supplied_feature_in_title_and_body()
    {
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.OpenMode(),
            RequiresAuthCapability.SessionList,
            feature: "Active sessions",
            Localizer);

        Assert.Contains("Active sessions requires authentication mode", projection.Title, StringComparison.Ordinal);
        Assert.Contains("Active sessions is only available", projection.Body, StringComparison.Ordinal);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_is_the_title_and_body()
    {
        var projection = RequiresAuthProjection.Project(
            RequiresAuthSnapshot.OpenMode(),
            RequiresAuthCapability.Rbac,
            feature: "RBAC",
            Localizer);

        Assert.Equal($"{projection.Title}. {projection.Body}", projection.AccessibleName);
        Assert.False(string.IsNullOrWhiteSpace(projection.AccessibleName));
        Assert.Equal("polite", projection.LiveSetting);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_gated_while_the_contract_is_unresolved()
    {
        var source = new StaticAuthModeSource();
        using var vm = new RequiresAuthViewModel(Localizer, source, RequiresAuthCapability.TotpEnrollment, feature: "TOTP enrollment");

        Assert.False(vm.ShowChildren);
        Assert.Equal("requires-auth-empty-totp_enrollment", vm.EmptyAutomationId);
        Assert.Contains(GenericProviderList, vm.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void View_model_mounts_children_when_the_contract_resolves_to_forward_auth_enabled()
    {
        var source = new StaticAuthModeSource();
        using var vm = new RequiresAuthViewModel(Localizer, source, RequiresAuthCapability.TotpEnrollment, feature: "TOTP enrollment");
        Assert.False(vm.ShowChildren);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllEnabled));

        Assert.True(vm.ShowChildren);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_stays_gated_with_hint_when_resolved_to_disabled()
    {
        var source = new StaticAuthModeSource();
        using var vm = new RequiresAuthViewModel(Localizer, source, RequiresAuthCapability.Rbac, feature: "RBAC");

        source.Set(RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllDisabled, providerHint: "authentik"));

        Assert.False(vm.ShowChildren);
        Assert.Contains("authentik", vm.Body, StringComparison.Ordinal);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticAuthModeSource();
        var vm = new RequiresAuthViewModel(Localizer, source, RequiresAuthCapability.SessionList);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(RequiresAuthSnapshot.ForwardAuth(RequiresAuthCapabilities.AllEnabled));

        Assert.Equal(0, raised);
    }

    // ── source ────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_starts_unresolved()
    {
        var source = new StaticAuthModeSource();
        Assert.False(source.Current.Resolved);
    }

    [Fact]
    public void Static_source_raises_changed_on_set()
    {
        var source = new StaticAuthModeSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        var resolved = RequiresAuthSnapshot.OpenMode();
        source.Set(resolved);

        Assert.True(source.Current.Resolved);
        Assert.Equal(1, raised);

        // Setting the same reference is a no-op.
        source.Set(resolved);
        Assert.Equal(1, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RequiresAuthDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=RequiresAuth", "view.opened slug=RequiresAuth" },
            lines);
    }
}
