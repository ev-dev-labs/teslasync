using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Canonical metadata for the <c>NoVehicleSelected</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/onboarding/components/NoVehicleSelected.tsx</c>. The web source is a defensive empty
/// state rendered by any page that requires a selected vehicle when <c>useSelectedVehicle().vehicleId</c> is
/// null (a deep-link landing before the onboarding poll resolves, or a revoked Tesla token): rather than
/// scaffold data on a null id, the page shows an <c>EmptyState</c> (a car glyph, a localized title and message,
/// and a "Set up TeslaSync" call-to-action that navigates to <c>/onboarding</c>) inside a <c>GlassPanel</c>
/// inside a <c>PageContainer</c>. This holder pins the diagnostics slug, the three i18n keys + English
/// fallbacks for the visible copy, the canonical onboarding route name the call-to-action navigates to, the
/// web-style onboarding href for parity assertions, and the Segoe Fluent car glyph standing in for the web
/// Lucide <c>Car</c> icon. UI-free so the metadata is asserted headlessly.
/// </summary>
public static class NoVehicleSelectedRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "NoVehicleSelected";

    /// <summary>i18n key for the empty-state title (web <c>t('common.noVehicleSelected.title', …)</c>).</summary>
    public const string TitleKey = "translation.common.noVehicleSelected.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (web default).</summary>
    public const string TitleFallback = "No vehicle selected";

    /// <summary>i18n key for the empty-state message (web <c>t('common.noVehicleSelected.desc', …)</c>).</summary>
    public const string MessageKey = "translation.common.noVehicleSelected.desc";

    /// <summary>English fallback for <see cref="MessageKey"/> (web default).</summary>
    public const string MessageFallback = "Add a vehicle to your fleet to see data on this page.";

    /// <summary>i18n key for the call-to-action label (web <c>t('common.noVehicleSelected.action', …)</c>).</summary>
    public const string ActionKey = "translation.common.noVehicleSelected.action";

    /// <summary>English fallback for <see cref="ActionKey"/> (web default).</summary>
    public const string ActionFallback = "Set up TeslaSync";

    /// <summary>The canonical native shell route name the call-to-action opens (web <c>navigate('/onboarding')</c>).</summary>
    public const string OnboardingRouteName = "Onboarding";

    /// <summary>The web-style absolute onboarding href the call-to-action mirrors (web <c>'/onboarding'</c>).</summary>
    public const string OnboardingHref = "/onboarding";

    /// <summary>Segoe Fluent "Car" glyph decorating the empty surface (web Lucide <c>Car</c>).</summary>
    public const string CarGlyph = "\uE804";
}

/// <summary>
/// The render-ready view of the no-vehicle-selected surface — everything the WinUI view needs to draw the
/// empty state without ever flashing a blank box. Holds the <see cref="PageTitle"/> forwarded to the page
/// scaffold (web <c>PageContainer title</c>), the localized <see cref="Title"/> and <see cref="Message"/>
/// (each honouring the optional prop override before falling back to the i18n copy, mirroring the web
/// <c>title ?? t(…)</c> / <c>description ?? t(…)</c>), the call-to-action <see cref="ActionText"/>, and the
/// composed <see cref="AutomationName"/> the surface announces to Narrator. Pure data so every field is
/// asserted without a UI host.
/// </summary>
/// <param name="PageTitle">The localized page title forwarded to the scaffold (web <c>pageTitle</c> prop).</param>
/// <param name="Title">The localized (or overridden) empty-state title.</param>
/// <param name="Message">The localized (or overridden) empty-state message.</param>
/// <param name="ActionText">The localized call-to-action label.</param>
/// <param name="AutomationName">The composed Narrator name for the surface (title + message).</param>
public sealed record NoVehicleSelectedDisplay(
    string PageTitle,
    string Title,
    string Message,
    string ActionText,
    string AutomationName);

/// <summary>
/// Pure projection from the surface's inputs (the page title plus optional title / description overrides) to
/// the render-ready <see cref="NoVehicleSelectedDisplay"/> — the native port of
/// <c>web/src/features/onboarding/components/NoVehicleSelected.tsx</c>. It reproduces the web's
/// <c>title ?? t('common.noVehicleSelected.title', 'No vehicle selected')</c> and
/// <c>description ?? t('common.noVehicleSelected.desc', …)</c> fallbacks (an explicit override wins; otherwise
/// the i18n copy resolves), always resolves the call-to-action label through the facade, and joins the title
/// and message into the surface's accessible name. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class NoVehicleSelectedProjection
{
    /// <summary>
    /// Project the page title and optional copy overrides into the render-ready display, resolving the visible
    /// copy through the i18n facade. Mirrors the web component's prop-driven fallbacks.
    /// </summary>
    /// <param name="pageTitle">The localized page title forwarded to the scaffold (web <c>pageTitle</c>).</param>
    /// <param name="titleOverride">An explicit title (web <c>title</c> prop), or null to use the i18n copy.</param>
    /// <param name="descriptionOverride">An explicit message (web <c>description</c> prop), or null for the i18n copy.</param>
    /// <param name="localizer">The i18n facade the title / message / action resolve through.</param>
    public static NoVehicleSelectedDisplay ProjectDisplay(
        string pageTitle,
        string? titleOverride,
        string? descriptionOverride,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(pageTitle);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = titleOverride
            ?? localizer.GetString(NoVehicleSelectedRegistration.TitleKey, NoVehicleSelectedRegistration.TitleFallback);
        string message = descriptionOverride
            ?? localizer.GetString(NoVehicleSelectedRegistration.MessageKey, NoVehicleSelectedRegistration.MessageFallback);
        string action = localizer.GetString(
            NoVehicleSelectedRegistration.ActionKey, NoVehicleSelectedRegistration.ActionFallback);

        string automationName = string.Create(CultureInfo.CurrentCulture, $"{title}. {message}");

        return new NoVehicleSelectedDisplay(pageTitle, title, message, action, automationName);
    }
}

/// <summary>
/// The navigation port the <c>NoVehicleSelected</c> call-to-action drives — the native analogue of the web
/// <c>useNavigate()</c> seam invoked as <c>navigate('/onboarding')</c>
/// (web/src/features/onboarding/components/NoVehicleSelected.tsx). The view never touches the shell directly;
/// activating "Set up TeslaSync" calls <see cref="NavigateToOnboarding"/> and a shell adapter resolves the
/// <see cref="NoVehicleSelectedRegistration.OnboardingRouteName"/> route and performs the navigation, while a
/// test double records the request. Keeping navigation behind this seam keeps the view free of any router
/// dependency and lets the behaviour be asserted headlessly.
/// </summary>
public interface INoVehicleSelectedNavigator
{
    /// <summary>Navigate the shell to the onboarding flow (web <c>navigate('/onboarding')</c>).</summary>
    void NavigateToOnboarding();
}

/// <summary>
/// PII-safe diagnostics for the <c>NoVehicleSelected</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event and the data-free call-to-action activation with the surface slug
/// — never a vehicle id, route or any user data — so a diagnostics line can never leak operational data.
/// Thread-safe.
/// </summary>
public sealed class NoVehicleSelectedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _setupRequests;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or null.</param>
    public NoVehicleSelectedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the "Set up TeslaSync" call-to-action has been activated.</summary>
    public long SetupRequests => Interlocked.Read(ref _setupRequests);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=NoVehicleSelected</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={NoVehicleSelectedRegistration.Slug}");
    }

    /// <summary>Record that setup was requested, emitting <c>no-vehicle.setup-requested slug=NoVehicleSelected</c>.</summary>
    public void RecordSetupRequested()
    {
        Interlocked.Increment(ref _setupRequests);
        _sink?.Invoke($"no-vehicle.setup-requested slug={NoVehicleSelectedRegistration.Slug}");
    }
}
