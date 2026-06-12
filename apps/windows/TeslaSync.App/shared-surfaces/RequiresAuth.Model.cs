using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The capability flag a wrapped section needs in order to mount — the native analogue of the web
/// <c>RequiresAuthCapability = keyof AuthModeCapabilities</c> (web/src/components/feedback/RequiresAuth.tsx L42).
/// Each member maps to exactly one server-supplied flag in the <c>/system/auth-mode</c> capability matrix; the
/// snake_case wire name (used for the per-capability automation id, the web <c>requires-auth-empty-{capability}</c>
/// test id) and the camelCase i18n feature-name key suffix both live on <see cref="RequiresAuthRegistration"/>.
/// </summary>
public enum RequiresAuthCapability
{
    /// <summary>Step-up reauthentication (web <c>step_up_reauth</c>).</summary>
    StepUpReauth,

    /// <summary>TOTP enrollment (web <c>totp_enrollment</c>).</summary>
    TotpEnrollment,

    /// <summary>Active-session listing (web <c>session_list</c>).</summary>
    SessionList,

    /// <summary>User impersonation (web <c>impersonation</c>).</summary>
    Impersonation,

    /// <summary>Role-based access control (web <c>rbac</c>).</summary>
    Rbac,
}

/// <summary>
/// The deployment's authentication mode — the native analogue of the web <c>AuthMode = 'open' | 'forward_auth'</c>
/// union (web/src/api/types.ts). The string is the source of truth; the mode is never derived from the presence of
/// a subject header (the upstream proxy can momentarily strip it on a single request).
/// </summary>
public enum RequiresAuthMode
{
    /// <summary>Open mode — no upstream identity provider configured; every capability is unavailable.</summary>
    Open,

    /// <summary>Forward-auth mode — a ForwardAuth-shaped reverse proxy supplies the identity header.</summary>
    ForwardAuth,
}

/// <summary>
/// The per-feature capability matrix returned by <c>GET /api/v1/system/auth-mode</c> — the native analogue of the
/// web <c>AuthModeCapabilities</c> interface (web/src/api/types.ts). Every flag is <see langword="false"/> in open
/// mode and (per the contract) <see langword="true"/> in forward-auth mode; the per-feature server-side
/// preconditions live inside each feature's own handler, so this matrix only reports whether the deployment's auth
/// mode allows the feature to exist at all. Pure value type — no WinUI types — so it is asserted headlessly.
/// </summary>
public readonly record struct RequiresAuthCapabilities
{
    /// <summary>Creates a capability matrix from explicit per-feature flags.</summary>
    /// <param name="stepUpReauth">Whether step-up reauthentication is available.</param>
    /// <param name="totpEnrollment">Whether TOTP enrollment is available.</param>
    /// <param name="sessionList">Whether active-session listing is available.</param>
    /// <param name="impersonation">Whether user impersonation is available.</param>
    /// <param name="rbac">Whether role-based access control is available.</param>
    public RequiresAuthCapabilities(
        bool stepUpReauth,
        bool totpEnrollment,
        bool sessionList,
        bool impersonation,
        bool rbac)
    {
        StepUpReauth = stepUpReauth;
        TotpEnrollment = totpEnrollment;
        SessionList = sessionList;
        Impersonation = impersonation;
        Rbac = rbac;
    }

    /// <summary>Whether step-up reauthentication is available (web <c>step_up_reauth</c>).</summary>
    public bool StepUpReauth { get; }

    /// <summary>Whether TOTP enrollment is available (web <c>totp_enrollment</c>).</summary>
    public bool TotpEnrollment { get; }

    /// <summary>Whether active-session listing is available (web <c>session_list</c>).</summary>
    public bool SessionList { get; }

    /// <summary>Whether user impersonation is available (web <c>impersonation</c>).</summary>
    public bool Impersonation { get; }

    /// <summary>Whether role-based access control is available (web <c>rbac</c>).</summary>
    public bool Rbac { get; }

    /// <summary>Every flag <see langword="false"/> — the open-mode matrix (web open-mode default).</summary>
    public static RequiresAuthCapabilities AllDisabled { get; }

    /// <summary>Every flag <see langword="true"/> — the forward-auth matrix the contract returns when enabled.</summary>
    public static RequiresAuthCapabilities AllEnabled { get; } =
        new(stepUpReauth: true, totpEnrollment: true, sessionList: true, impersonation: true, rbac: true);

    /// <summary>Read the flag for a single capability (web <c>capabilities[capability]</c>).</summary>
    /// <param name="capability">The capability to read.</param>
    public bool IsEnabled(RequiresAuthCapability capability) => capability switch
    {
        RequiresAuthCapability.StepUpReauth => StepUpReauth,
        RequiresAuthCapability.TotpEnrollment => TotpEnrollment,
        RequiresAuthCapability.SessionList => SessionList,
        RequiresAuthCapability.Impersonation => Impersonation,
        RequiresAuthCapability.Rbac => Rbac,
        _ => false,
    };
}

/// <summary>
/// One immutable auth-mode contract snapshot — the native analogue of the web <c>useAuthMode()</c> result the web
/// <c>RequiresAuth</c> wrapper gates on (web/src/components/feedback/RequiresAuth.tsx L70-106,
/// web/src/api/hooks/useAuthMode.ts). <see cref="Resolved"/> is false until the contract has resolved (covering the
/// web <c>isLoading || !data</c> branch — a still-loading query AND a transport error both surface as "unresolved",
/// because the web reads <c>data</c> as <see langword="null"/> in both cases). Once resolved it carries the
/// <see cref="Mode"/>, the operator-supplied <see cref="ProviderHint"/> (rendered verbatim — the SPA never names a
/// specific IdP vendor itself), and the <see cref="Capabilities"/> matrix. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed class RequiresAuthSnapshot
{
    /// <summary>The not-yet-resolved snapshot — the contract is loading or errored (web <c>isLoading || !data</c>).</summary>
    public static RequiresAuthSnapshot Unresolved { get; } =
        new(resolved: false, RequiresAuthMode.Open, RequiresAuthCapabilities.AllDisabled, providerHint: null, subjectHeader: null, subject: null);

    /// <summary>Creates a snapshot from the resolved contract fields.</summary>
    /// <param name="resolved">Whether the contract has resolved (web <c>!isLoading &amp;&amp; data != null</c>).</param>
    /// <param name="mode">The deployment auth mode (web <c>data.mode</c>).</param>
    /// <param name="capabilities">The per-feature capability matrix (web <c>data.capabilities</c>).</param>
    /// <param name="providerHint">The operator-supplied provider hint, or null (web <c>data.provider_hint</c>).</param>
    /// <param name="subjectHeader">The identity header name, or null (web <c>data.subject_header</c>).</param>
    /// <param name="subject">The resolved request subject, or null (web <c>data.subject</c>).</param>
    public RequiresAuthSnapshot(
        bool resolved,
        RequiresAuthMode mode,
        RequiresAuthCapabilities capabilities,
        string? providerHint = null,
        string? subjectHeader = null,
        string? subject = null)
    {
        Resolved = resolved;
        Mode = mode;
        Capabilities = capabilities;
        ProviderHint = string.IsNullOrWhiteSpace(providerHint) ? null : providerHint;
        SubjectHeader = string.IsNullOrWhiteSpace(subjectHeader) ? null : subjectHeader;
        Subject = string.IsNullOrWhiteSpace(subject) ? null : subject;
    }

    /// <summary>Whether the contract has resolved; false covers the web loading AND transport-error branches.</summary>
    public bool Resolved { get; }

    /// <summary>The deployment auth mode (web <c>data.mode</c>).</summary>
    public RequiresAuthMode Mode { get; }

    /// <summary>The per-feature capability matrix (web <c>data.capabilities</c>).</summary>
    public RequiresAuthCapabilities Capabilities { get; }

    /// <summary>The operator-supplied provider hint rendered verbatim, or null (web <c>data.provider_hint</c>).</summary>
    public string? ProviderHint { get; }

    /// <summary>The identity header name, or null in open mode (web <c>data.subject_header</c>).</summary>
    public string? SubjectHeader { get; }

    /// <summary>The resolved request subject, or null in open mode / header-stripped (web <c>data.subject</c>).</summary>
    public string? Subject { get; }

    /// <summary>A resolved open-mode snapshot (all capabilities disabled), optionally carrying a provider hint.</summary>
    /// <param name="providerHint">The operator-supplied provider hint, or null.</param>
    public static RequiresAuthSnapshot OpenMode(string? providerHint = null) =>
        new(resolved: true, RequiresAuthMode.Open, RequiresAuthCapabilities.AllDisabled, providerHint);

    /// <summary>A resolved forward-auth snapshot carrying the supplied capability matrix and metadata.</summary>
    /// <param name="capabilities">The per-feature capability matrix.</param>
    /// <param name="providerHint">The operator-supplied provider hint, or null.</param>
    /// <param name="subjectHeader">The identity header name, or null.</param>
    /// <param name="subject">The resolved request subject, or null.</param>
    public static RequiresAuthSnapshot ForwardAuth(
        RequiresAuthCapabilities capabilities,
        string? providerHint = null,
        string? subjectHeader = null,
        string? subject = null) =>
        new(resolved: true, RequiresAuthMode.ForwardAuth, capabilities, providerHint, subjectHeader, subject);
}

/// <summary>
/// Canonical metadata + pure helpers for the RequiresAuth surface — the native analogue of the module-level
/// literals in web/src/components/feedback/RequiresAuth.tsx and the <c>requiresAuth.*</c> i18n bundle
/// (web/src/i18n/en.json L555-566). Carries the diagnostics slug, the ARIA role + live contract, the per-capability
/// automation-id builder (the web <c>requires-auth-empty-{capability}</c> test id), the snake_case wire names + the
/// camelCase i18n feature-name key suffixes, the title / body / body-with-hint i18n keys with the English fallbacks
/// the catalogue already ships (<c>translation.requiresAuth.*</c>, Strings/en/Resources.resw), and the Segoe Fluent
/// lock glyph standing in for the web Lucide <c>LockKeyhole</c>. UI-free so it is asserted in tests.
/// </summary>
public static class RequiresAuthRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RequiresAuth";

    /// <summary>ARIA role the gated notice exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the gated notice declares (web <c>role="status"</c> implies polite).</summary>
    public const string LiveSetting = "polite";

    /// <summary>Stable per-capability automation-id prefix (the web <c>requires-auth-empty-</c> test-id stem).</summary>
    public const string EmptyAutomationIdPrefix = "requires-auth-empty-";

    /// <summary>Segoe Fluent "Lock" glyph — the native stand-in for the web Lucide <c>LockKeyhole</c> icon.</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>i18n key for the notice title (web <c>t('requiresAuth.title', ...)</c>); <c>{0}</c> = feature.</summary>
    public const string TitleKey = "translation.requiresAuth.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the catalogue value, verbatim, with a .NET argument.</summary>
    public const string TitleFallback = "{0} requires authentication mode";

    /// <summary>i18n key for the vendor-neutral body (web <c>requiresAuth.body</c>); <c>{0}</c> = feature.</summary>
    public const string BodyKey = "translation.requiresAuth.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the catalogue value, verbatim, with a .NET argument.</summary>
    public const string BodyFallback =
        "{0} is only available when TeslaSync is configured behind an authentication provider " +
        "(Authentik, Authelia, oauth2-proxy, Keycloak, or similar). Set FORWARD_AUTH_HEADER on the API service to enable it.";

    /// <summary>i18n key for the body when a provider hint is set (web <c>requiresAuth.bodyWithHint</c>); <c>{0}</c> = feature, <c>{1}</c> = provider.</summary>
    public const string BodyWithHintKey = "translation.requiresAuth.bodyWithHint";

    /// <summary>English fallback for <see cref="BodyWithHintKey"/> — the catalogue value, verbatim, with .NET arguments.</summary>
    public const string BodyWithHintFallback =
        "{0} is only available when TeslaSync is configured behind an authentication provider ({1}). " +
        "Set FORWARD_AUTH_HEADER on the API service to enable it.";

    /// <summary>The complete capability set, in declaration order (for exhaustive iteration in hosts / tests).</summary>
    public static IReadOnlyList<RequiresAuthCapability> AllCapabilities { get; } = new[]
    {
        RequiresAuthCapability.StepUpReauth,
        RequiresAuthCapability.TotpEnrollment,
        RequiresAuthCapability.SessionList,
        RequiresAuthCapability.Impersonation,
        RequiresAuthCapability.Rbac,
    };

    /// <summary>The snake_case wire name for a capability (the server flag key + the web test-id suffix).</summary>
    /// <param name="capability">The capability to map.</param>
    public static string WireName(RequiresAuthCapability capability) => capability switch
    {
        RequiresAuthCapability.StepUpReauth => "step_up_reauth",
        RequiresAuthCapability.TotpEnrollment => "totp_enrollment",
        RequiresAuthCapability.SessionList => "session_list",
        RequiresAuthCapability.Impersonation => "impersonation",
        RequiresAuthCapability.Rbac => "rbac",
        _ => throw new ArgumentOutOfRangeException(nameof(capability), capability, null),
    };

    /// <summary>The camelCase i18n feature-name key suffix for a capability (web <c>requiresAuth.featureName.*</c>).</summary>
    /// <param name="capability">The capability to map.</param>
    public static string FeatureNameKeySuffix(RequiresAuthCapability capability) => capability switch
    {
        RequiresAuthCapability.StepUpReauth => "stepUpReauth",
        RequiresAuthCapability.TotpEnrollment => "totpEnrollment",
        RequiresAuthCapability.SessionList => "sessionList",
        RequiresAuthCapability.Impersonation => "impersonation",
        RequiresAuthCapability.Rbac => "rbac",
        _ => throw new ArgumentOutOfRangeException(nameof(capability), capability, null),
    };

    /// <summary>The English feature-name fallback for a capability (web <c>requiresAuth.featureName.*</c> values).</summary>
    /// <param name="capability">The capability to map.</param>
    public static string FeatureNameFallback(RequiresAuthCapability capability) => capability switch
    {
        RequiresAuthCapability.StepUpReauth => "Step-up reauthentication",
        RequiresAuthCapability.TotpEnrollment => "TOTP enrollment",
        RequiresAuthCapability.SessionList => "Active sessions",
        RequiresAuthCapability.Impersonation => "User impersonation",
        RequiresAuthCapability.Rbac => "Role-based access control",
        _ => throw new ArgumentOutOfRangeException(nameof(capability), capability, null),
    };

    /// <summary>The full i18n key for a capability's feature name (web <c>requiresAuth.featureName.{suffix}</c>).</summary>
    /// <param name="capability">The capability to map.</param>
    public static string FeatureNameKey(RequiresAuthCapability capability) =>
        "translation.requiresAuth.featureName." + FeatureNameKeySuffix(capability);

    /// <summary>
    /// The stable per-capability automation id for the gated notice — the native analogue of the web
    /// <c>requires-auth-empty-{capability}</c> test id (RequiresAuth.tsx L64-66), built from the snake_case wire name.
    /// </summary>
    /// <param name="capability">The capability the wrapped section needs.</param>
    public static string EmptyAutomationId(RequiresAuthCapability capability) =>
        EmptyAutomationIdPrefix + WireName(capability);

    /// <summary>Resolve the localized feature name for a capability (web consumers pass an already-translated string).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="capability">The capability whose feature name to resolve.</param>
    public static string ResolveFeatureName(ILocalizer localizer, RequiresAuthCapability capability)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(FeatureNameKey(capability), FeatureNameFallback(capability));
    }

    /// <summary>Resolve the localized notice title with the feature interpolated (web <c>t('requiresAuth.title')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="feature">The already-localized feature name.</param>
    public static string ResolveTitle(ILocalizer localizer, string feature)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(feature);
        var template = localizer.GetString(TitleKey, TitleFallback);
        return string.Format(CultureInfo.CurrentCulture, template, feature);
    }

    /// <summary>
    /// Resolve the localized notice body (web <c>requiresAuth.body</c> / <c>bodyWithHint</c>): when the operator set
    /// a provider hint it is surfaced verbatim, otherwise the generic vendor-neutral provider list is used. Both
    /// forms stay vendor-neutral — TeslaSync never claims to integrate with a specific IdP's admin API.
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="feature">The already-localized feature name.</param>
    /// <param name="providerHint">The operator-supplied provider hint, or null for the generic copy.</param>
    public static string ResolveBody(ILocalizer localizer, string feature, string? providerHint)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(feature);

        if (string.IsNullOrWhiteSpace(providerHint))
        {
            var generic = localizer.GetString(BodyKey, BodyFallback);
            return string.Format(CultureInfo.CurrentCulture, generic, feature);
        }

        var template = localizer.GetString(BodyWithHintKey, BodyWithHintFallback);
        return string.Format(CultureInfo.CurrentCulture, template, feature, providerHint);
    }
}

/// <summary>
/// Maps the raw <c>GET /api/v1/system/auth-mode</c> JSON envelope into a <see cref="RequiresAuthSnapshot"/> — the
/// native analogue of the web <c>request&lt;AuthModeResponse&gt;('/system/auth-mode')</c> read
/// (web/src/api/hooks/useAuthMode.ts L57-65). The generated Windows API client returns the body as a
/// <see cref="JsonElement"/>, so this is the genuine cached-response → snapshot adapter. Every read is defensive: a
/// missing / malformed field degrades to a safe default (open mode, capability disabled) rather than throwing, so a
/// transport hiccup can never crash the gated section — it simply keeps the section gated, exactly as the web
/// wrapper treats an unresolved contract.
/// </summary>
public static class AuthModeResponseAdapter
{
    private const string ForwardAuthWire = "forward_auth";

    /// <summary>
    /// Project a resolved auth-mode JSON body into a snapshot (web <c>data</c> → render inputs). The element is read
    /// defensively; an object that is not present or not an object yields the unresolved snapshot.
    /// </summary>
    /// <param name="element">The JSON body returned by the contract endpoint.</param>
    public static RequiresAuthSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return RequiresAuthSnapshot.Unresolved;
        }

        var mode = ReadString(element, "mode") == ForwardAuthWire
            ? RequiresAuthMode.ForwardAuth
            : RequiresAuthMode.Open;
        var providerHint = ReadString(element, "provider_hint");
        var subjectHeader = ReadString(element, "subject_header");
        var subject = ReadString(element, "subject");
        var capabilities = ReadCapabilities(element);

        return new RequiresAuthSnapshot(
            resolved: true,
            mode,
            capabilities,
            providerHint,
            subjectHeader,
            subject);
    }

    /// <summary>Parse a JSON document body string into a snapshot (defensive: invalid JSON yields unresolved).</summary>
    /// <param name="json">The raw JSON body, or null.</param>
    public static RequiresAuthSnapshot FromJsonText(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return RequiresAuthSnapshot.Unresolved;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return FromJson(document.RootElement);
        }
        catch (JsonException)
        {
            return RequiresAuthSnapshot.Unresolved;
        }
    }

    private static RequiresAuthCapabilities ReadCapabilities(JsonElement element)
    {
        if (!element.TryGetProperty("capabilities", out var caps) || caps.ValueKind != JsonValueKind.Object)
        {
            return RequiresAuthCapabilities.AllDisabled;
        }

        return new RequiresAuthCapabilities(
            stepUpReauth: ReadBool(caps, "step_up_reauth"),
            totpEnrollment: ReadBool(caps, "totp_enrollment"),
            sessionList: ReadBool(caps, "session_list"),
            impersonation: ReadBool(caps, "impersonation"),
            rbac: ReadBool(caps, "rbac"));
    }

    private static string? ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool ReadBool(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="RequiresAuthSnapshot"/> + the wrapped capability and
/// feature name — everything the web <c>RequiresAuth</c> derives before returning JSX
/// (web/src/components/feedback/RequiresAuth.tsx L68-106): whether the wrapped children mount
/// (<see cref="ShowChildren"/> — the web <c>mode === 'forward_auth' &amp;&amp; capabilities[capability]</c> branch),
/// and, for the gated notice, the localized <see cref="Title"/> and <see cref="Body"/>, the
/// <see cref="AccessibleName"/> a screen reader announces (title + body), the stable
/// <see cref="EmptyAutomationId"/>, and the ARIA <see cref="LiveSetting"/>. Pure value type so every field is
/// asserted headlessly.
/// </summary>
public readonly record struct RequiresAuthProjection
{
    private RequiresAuthProjection(
        RequiresAuthCapability capability,
        string feature,
        bool showChildren,
        string title,
        string body,
        string accessibleName,
        string emptyAutomationId,
        string liveSetting)
    {
        Capability = capability;
        Feature = feature;
        ShowChildren = showChildren;
        Title = title;
        Body = body;
        AccessibleName = accessibleName;
        EmptyAutomationId = emptyAutomationId;
        LiveSetting = liveSetting;
    }

    /// <summary>The capability the wrapped section needs (web <c>capability</c>).</summary>
    public RequiresAuthCapability Capability { get; }

    /// <summary>The already-localized feature name interpolated into the copy (web <c>feature</c>).</summary>
    public string Feature { get; }

    /// <summary>Whether the wrapped children mount — the web forward-auth + capability-enabled branch.</summary>
    public bool ShowChildren { get; }

    /// <summary>The localized notice title (web <c>t('requiresAuth.title')</c>). Always resolved.</summary>
    public string Title { get; }

    /// <summary>The localized notice body, with or without the provider hint (web <c>body</c>). Always resolved.</summary>
    public string Body { get; }

    /// <summary>The accessible name a screen reader announces for the gated notice — the title and body together.</summary>
    public string AccessibleName { get; }

    /// <summary>The stable per-capability automation id for the gated notice (web <c>requires-auth-empty-{capability}</c>).</summary>
    public string EmptyAutomationId { get; }

    /// <summary>The ARIA live urgency the gated notice declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a contract snapshot + the wrapped capability + an optional explicit feature name into a render-ready
    /// value, reproducing the web component (RequiresAuth.tsx L68-106): the children mount only in forward-auth mode
    /// with the capability enabled; otherwise (open mode, the capability disabled, OR a still-unresolved contract)
    /// the gated notice is shown. While the contract is unresolved the body uses the generic vendor-neutral copy (no
    /// provider hint is known yet — the web passes <c>providerHint={undefined}</c> in the loading branch); once
    /// resolved the operator-supplied hint, when present, is surfaced verbatim.
    /// </summary>
    /// <param name="snapshot">The auth-mode contract inputs (web <c>useAuthMode()</c> result).</param>
    /// <param name="capability">The capability the wrapped section needs (web <c>capability</c>).</param>
    /// <param name="feature">An already-localized feature name, or null to resolve it from the catalogue.</param>
    /// <param name="localizer">The i18n facade the strings resolve through.</param>
    public static RequiresAuthProjection Project(
        RequiresAuthSnapshot snapshot,
        RequiresAuthCapability capability,
        string? feature,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var resolvedFeature = string.IsNullOrWhiteSpace(feature)
            ? RequiresAuthRegistration.ResolveFeatureName(localizer, capability)
            : feature;

        var showChildren = snapshot.Resolved
            && snapshot.Mode == RequiresAuthMode.ForwardAuth
            && snapshot.Capabilities.IsEnabled(capability);

        // The loading branch renders the notice with no provider hint (web providerHint={undefined}); the resolved,
        // gated branch surfaces the operator hint verbatim.
        var providerHint = snapshot.Resolved ? snapshot.ProviderHint : null;

        var title = RequiresAuthRegistration.ResolveTitle(localizer, resolvedFeature);
        var body = RequiresAuthRegistration.ResolveBody(localizer, resolvedFeature, providerHint);

        return new RequiresAuthProjection(
            capability,
            resolvedFeature,
            showChildren,
            title,
            body,
            accessibleName: $"{title}. {body}",
            emptyAutomationId: RequiresAuthRegistration.EmptyAutomationId(capability),
            liveSetting: RequiresAuthRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the RequiresAuth surface (P1/S11 diagnostics contract). The surface carries only opaque
/// capability identifiers and vendor-neutral copy (no user content), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the subject, provider hint, or capability. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class RequiresAuthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RequiresAuthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RequiresAuth</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RequiresAuthRegistration.Slug}");
    }
}
