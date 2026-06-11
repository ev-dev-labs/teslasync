using System.Globalization;
using System.Runtime.InteropServices;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One immutable browser/host-capability snapshot — the native analogue of the web
/// <c>detectMissingFeatures()</c> result the web <c>BrowserCompatBanner</c> seeds its <c>missing</c> state with
/// (web/src/components/feedback/BrowserCompatBanner.tsx L49-51, web/src/lib/browserCompat.ts L51-88).
/// <see cref="Detected"/> is false until the host has been probed (the web detection runs synchronously at mount,
/// so this maps the "not yet resolved" loading branch); once detected, <see cref="MissingFeatures"/> carries the
/// required capabilities the host is missing (empty == a supported host, the web <c>missing.length === 0</c>
/// collapsed case). Exposed by the P1/S8 <see cref="IBrowserCompatSource"/> and consumed by
/// <see cref="BrowserCompatBannerProjection.Project"/>. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed class BrowserCompatSnapshot
{
    /// <summary>The not-yet-detected snapshot — the host has not been probed (the web pre-mount state).</summary>
    public static BrowserCompatSnapshot Pending { get; } = new(detected: false, Array.Empty<string>());

    /// <summary>The supported-host snapshot — detection ran and nothing is missing (web <c>missing.length === 0</c>).</summary>
    public static BrowserCompatSnapshot Supported { get; } = new(detected: true, Array.Empty<string>());

    /// <summary>Creates a snapshot from a detection result.</summary>
    /// <param name="detected">Whether the host has been probed yet (web detection has run).</param>
    /// <param name="missingFeatures">The required capabilities the host is missing (web <c>missing</c>).</param>
    public BrowserCompatSnapshot(bool detected, IReadOnlyList<string> missingFeatures)
    {
        ArgumentNullException.ThrowIfNull(missingFeatures);
        Detected = detected;
        MissingFeatures = missingFeatures.ToArray();
    }

    /// <summary>Whether the host has been probed (web detection has run).</summary>
    public bool Detected { get; }

    /// <summary>The required capabilities the host is missing (web <c>missing</c>), verbatim and ordered.</summary>
    public IReadOnlyList<string> MissingFeatures { get; }

    /// <summary>True once detection has run AND at least one feature is missing — the banner's data gate (web <c>missing.length &gt; 0</c>).</summary>
    public bool HasMissing => Detected && MissingFeatures.Count > 0;

    /// <summary>A detected snapshot carrying the supplied missing capabilities (web <c>setMissing(...)</c>).</summary>
    /// <param name="features">The required capabilities the host is missing.</param>
    public static BrowserCompatSnapshot Missing(IReadOnlyList<string> features) => new(detected: true, features);
}

/// <summary>
/// One required host capability and its probe — the native analogue of a single feature check inside the web
/// <c>detectMissingFeatures()</c> (e.g. <c>typeof globalThis.BroadcastChannel === 'undefined'</c>,
/// web/src/lib/browserCompat.ts L54-87). <see cref="Name"/> is the verbatim identifier interpolated into the
/// banner body (the web joins the raw feature names; they are NOT localized at the source). <see cref="IsAvailable"/>
/// runs the probe defensively: a throw is itself evidence of incompatibility, so it is reported as missing rather
/// than crashing detection (mirrors the web try/catch around each probe).
/// </summary>
public sealed class BrowserCompatRequirement
{
    private readonly Func<bool> _probe;

    /// <summary>Creates a requirement over a verbatim capability name and its presence probe.</summary>
    /// <param name="name">The verbatim capability identifier (web feature name).</param>
    /// <param name="probe">Returns true when the capability is present on the host.</param>
    public BrowserCompatRequirement(string name, Func<bool> probe)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentNullException.ThrowIfNull(probe);
        Name = name;
        _probe = probe;
    }

    /// <summary>The verbatim capability identifier interpolated into the banner body (web feature name).</summary>
    public string Name { get; }

    /// <summary>True when the capability is present; a throwing probe is treated as missing (web defensive try/catch).</summary>
    public bool IsAvailable()
    {
        try
        {
            return _probe();
        }
        catch (Exception)
        {
            // A throw while probing is itself evidence the capability is unusable — record it as missing
            // rather than crashing the boot sequence (web/src/lib/browserCompat.ts L62-81).
            return false;
        }
    }
}

/// <summary>
/// Canonical metadata for the BrowserCompatBanner surface — the native analogue of the module-level literals in
/// web/src/components/feedback/BrowserCompatBanner.tsx and web/src/lib/browserCompat.ts. Carries the diagnostics
/// slug, the banner / dismiss automation ids, the ARIA role + live contract, the i18n keys (each with the English
/// fallback the web renders verbatim — these keys already exist in the P1/S10 catalogue under
/// <c>translation.compat.banner.*</c>), the versioned dismissal storage key (the web localStorage key, reused
/// verbatim), the generated warning design-token keys + Segoe Fluent glyph standing in for the web Lucide
/// <c>AlertTriangle</c>, the banner tint alphas, and the default required-capability registry + detection helper.
/// UI-free so it is asserted in tests.
/// </summary>
public static class BrowserCompatRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "BrowserCompatBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by.</summary>
    public const string BannerAutomationId = "browser-compat-banner";

    /// <summary>The automation id Narrator and UI-automation resolve the dismiss button by.</summary>
    public const string DismissAutomationId = "browser-compat-banner-dismiss";

    /// <summary>ARIA role the surface exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the surface declares (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>The versioned dismissal flag key — the web localStorage key, reused verbatim (browserCompat.ts L39).</summary>
    public const string DismissalStorageKey = "teslasync:compat-warning-dismissed:v1";

    /// <summary>The persisted value written for a dismissed banner (web localStorage value '1').</summary>
    public const string DismissalStorageValue = "1";

    /// <summary>The separator the missing-feature names are joined with (web <c>missing.join(', ')</c>).</summary>
    public const string FeatureSeparator = ", ";

    /// <summary>Generated design-token colour key the banner tint is derived from (web amber-500).</summary>
    public const string WarningColorKey = "TsColorWarningColor";

    /// <summary>Generated design-token brush key for the banner text colour for the unsupported state (web text-primary).</summary>
    public const string TextPrimaryBrushKey = "TsColorTextPrimaryBrush";

    /// <summary>Banner background alpha over the warning colour (web <c>bg-neon-amber/5</c>, nudged for native legibility).</summary>
    public const double BannerBackgroundOpacity = 0.08;

    /// <summary>Banner border alpha over the warning colour (web <c>border-neon-amber/20</c>).</summary>
    public const double BannerBorderOpacity = 0.20;

    /// <summary>Generated warning brush key the banner icon / accent tints from — the shared callout warning brush.</summary>
    public static string WarningBrushKey { get; } = CalloutVariants.AccentBrushKey(CalloutVariant.Warning);

    /// <summary>Segoe Fluent "warning" glyph — the native stand-in for the web Lucide <c>AlertTriangle</c> icon.</summary>
    public static string WarningGlyph { get; } = CalloutVariants.Glyph(CalloutVariant.Warning);

    /// <summary>i18n key for the banner title (web <c>t('compat.banner.title', ...)</c> at BrowserCompatBanner.tsx L70).</summary>
    public const string TitleKey = "translation.compat.banner.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web default value, verbatim.</summary>
    public const string TitleFallback = "Your browser is missing required features";

    /// <summary>i18n key for the banner body template (web <c>t('compat.banner.body', ...)</c> at BrowserCompatBanner.tsx L71-75); <c>{0}</c>=features, <c>{1}</c>=recommendation.</summary>
    public const string BodyKey = "translation.compat.banner.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web template with .NET positional format arguments.</summary>
    public const string BodyFallback = "TeslaSync needs {0} to work correctly. {1}";

    /// <summary>i18n key for the recommended-environment sentence interpolated into the body.</summary>
    public const string RecommendationKey = "translation.compat.banner.recommendation";

    /// <summary>English fallback for <see cref="RecommendationKey"/> — the web <c>RECOMMENDED_BROWSERS_FALLBACK</c>, verbatim.</summary>
    public const string RecommendationFallback = "Use Chrome ≥ 110, Edge ≥ 110, Firefox ≥ 109, or Safari ≥ 16.";

    /// <summary>i18n key for the dismiss control's accessible name (web comment at BrowserCompatBanner.tsx L77-80).</summary>
    public const string DismissKey = "translation.compat.banner.dismiss";

    /// <summary>English fallback for <see cref="DismissKey"/> — the catalogue value, verbatim.</summary>
    public const string DismissFallback = "Dismiss";

    /// <summary>Verbatim capability identifier: the app's Windows baseline (TargetPlatformMinVersion 10.0.17763).</summary>
    public const string WindowsBaselineFeature = "Windows 10 (1809+)";

    /// <summary>Verbatim capability identifier: ICU globalization (the native analogue of <c>Intl.RelativeTimeFormat</c>).</summary>
    public const string GlobalizationFeature = "ICU globalization";

    /// <summary>Verbatim capability identifier: a supported 64-bit process architecture (the app ships x64/ARM64).</summary>
    public const string ArchitectureFeature = "64-bit runtime";

    /// <summary>
    /// The default required-capability registry — the native analogue of the fixed feature list the web probes
    /// (web/src/lib/browserCompat.ts L51-88). Each probe is BCL-only so it runs in the headless test host; on a
    /// healthy Windows x64/ARM64 runner with ICU loaded all three pass, so detection yields <see cref="BrowserCompatSnapshot.Supported"/>
    /// and the banner stays collapsed — exactly as the web banner is hidden on every supported browser.
    /// </summary>
    public static IReadOnlyList<BrowserCompatRequirement> DefaultRequirements { get; } = new[]
    {
        new BrowserCompatRequirement(WindowsBaselineFeature, static () => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763)),
        new BrowserCompatRequirement(GlobalizationFeature, static () => !IsInvariantGlobalization()),
        new BrowserCompatRequirement(
            ArchitectureFeature,
            static () => RuntimeInformation.ProcessArchitecture is Architecture.X64 or Architecture.Arm64),
    };

    /// <summary>
    /// Probe the supplied requirements and return the verbatim names of those that are missing — the native port
    /// of <c>detectMissingFeatures()</c> (web/src/lib/browserCompat.ts L51-88). Order is preserved so the joined
    /// body lists capabilities in registry order.
    /// </summary>
    /// <param name="requirements">The required capabilities to probe.</param>
    public static IReadOnlyList<string> DetectMissing(IEnumerable<BrowserCompatRequirement> requirements)
    {
        ArgumentNullException.ThrowIfNull(requirements);

        var missing = new List<string>();
        foreach (var requirement in requirements)
        {
            if (requirement is not null && !requirement.IsAvailable())
            {
                missing.Add(requirement.Name);
            }
        }

        return missing;
    }

    /// <summary>Join the missing-feature names with <see cref="FeatureSeparator"/> (web <c>missing.join(', ')</c>).</summary>
    /// <param name="features">The missing capability names.</param>
    public static string JoinFeatures(IReadOnlyList<string> features)
    {
        ArgumentNullException.ThrowIfNull(features);
        return string.Join(FeatureSeparator, features);
    }

    /// <summary>Resolve the localized banner title (web <c>t('compat.banner.title')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized recommended-environment sentence (web <c>RECOMMENDED_BROWSERS_FALLBACK</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveRecommendation(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(RecommendationKey, RecommendationFallback);
    }

    /// <summary>Resolve the localized dismiss-control accessible name (web <c>t('compat.banner.dismiss')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveDismissLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DismissKey, DismissFallback);
    }

    /// <summary>
    /// Build the localized banner body by interpolating the joined feature list and the recommendation into the
    /// body template (web <c>t('compat.banner.body', '...{{features}}...{{recommendation}}', { features, recommendation })</c>).
    /// </summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="featureList">The joined missing-feature list (<see cref="JoinFeatures"/>).</param>
    public static string FormatBody(ILocalizer localizer, string featureList)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(featureList);

        var template = localizer.GetString(BodyKey, BodyFallback);
        var recommendation = ResolveRecommendation(localizer);
        return string.Format(CultureInfo.CurrentCulture, template, featureList, recommendation);
    }

    private static bool IsInvariantGlobalization() =>
        AppContext.TryGetSwitch("System.Globalization.Invariant", out var invariant) && invariant;
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="BrowserCompatSnapshot"/> + the persisted dismissal flag —
/// everything the web <c>BrowserCompatBanner</c> derives before returning JSX
/// (web/src/components/feedback/BrowserCompatBanner.tsx L67-97): whether the banner is shown
/// (<see cref="IsVisible"/> — the web <c>dismissed || missing.length === 0</c> early-return inverted), the
/// localized <see cref="Title"/> and <see cref="Body"/>, the joined <see cref="FeatureList"/> (the web
/// <c>data-missing</c> value), the localized <see cref="DismissLabel"/>, the <see cref="AccessibleName"/> a screen
/// reader announces (title + body), and the ARIA <see cref="LiveSetting"/>. Pure value type so every field is
/// asserted headlessly.
/// </summary>
public readonly record struct BrowserCompatBannerProjection
{
    private BrowserCompatBannerProjection(
        bool isVisible,
        string title,
        string body,
        string featureList,
        string dismissLabel,
        string accessibleName,
        string liveSetting)
    {
        IsVisible = isVisible;
        Title = title;
        Body = body;
        FeatureList = featureList;
        DismissLabel = dismissLabel;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>dismissed || missing.length === 0</c> render gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner title (web <c>t('compat.banner.title')</c>).</summary>
    public string Title { get; }

    /// <summary>The localized banner body with the feature list + recommendation interpolated (web <c>body</c>).</summary>
    public string Body { get; }

    /// <summary>The joined missing-feature list (web <c>featureList</c> / <c>data-missing</c>).</summary>
    public string FeatureList { get; }

    /// <summary>The localized dismiss-control accessible name (web <c>t('compat.banner.dismiss')</c>).</summary>
    public string DismissLabel { get; }

    /// <summary>The accessible name a screen reader announces — the title and body together.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a capability snapshot + dismissal flag into a render-ready banner value, reproducing the web
    /// component (web/src/components/feedback/BrowserCompatBanner.tsx L67-97): the banner is visible only when
    /// detection found a missing capability AND the user has not dismissed it; the title / body / dismiss strings
    /// are always resolved so they are ready to announce the moment the banner shows.
    /// </summary>
    /// <param name="snapshot">The capability inputs (web <c>missing</c>).</param>
    /// <param name="dismissed">Whether the warning has been dismissed (web <c>dismissed</c>).</param>
    /// <param name="localizer">The i18n facade the strings resolve through.</param>
    public static BrowserCompatBannerProjection Project(
        BrowserCompatSnapshot snapshot,
        bool dismissed,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var featureList = BrowserCompatRegistration.JoinFeatures(snapshot.MissingFeatures);
        var title = BrowserCompatRegistration.ResolveTitle(localizer);
        var body = BrowserCompatRegistration.FormatBody(localizer, featureList);
        var dismissLabel = BrowserCompatRegistration.ResolveDismissLabel(localizer);
        var accessibleName = $"{title}. {body}";

        return new BrowserCompatBannerProjection(
            isVisible: snapshot.HasMissing && !dismissed,
            title: title,
            body: body,
            featureList: featureList,
            dismissLabel: dismissLabel,
            accessibleName: accessibleName,
            liveSetting: BrowserCompatRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the BrowserCompatBanner surface (P1/S11 diagnostics contract). The banner carries only
/// opaque technical capability identifiers (no user content), so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug — never the missing-feature names. Thread-safe; mirrors the peer
/// surfaces' diagnostics collectors.
/// </summary>
public sealed class BrowserCompatDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public BrowserCompatDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BrowserCompatBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BrowserCompatRegistration.Slug}");
    }
}
