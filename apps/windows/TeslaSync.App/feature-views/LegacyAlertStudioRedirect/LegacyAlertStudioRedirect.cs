using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>LegacyAlertStudioRedirect</c> feature surface — a parity port of
/// web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx. The web component is a query-preserving
/// redirect: it reads <c>useLocation().search</c> and renders <c>&lt;Navigate to={`/notifications/studio${search}`}
/// replace /&gt;</c>, navigating as a side effect of mounting and drawing nothing. Because a Windows surface must
/// never flash a blank box, this view renders a tokenized Fluent "redirecting" indicator — a
/// <see cref="TsGlassPanel"/> hosting a <see cref="TsSpinner"/> labelled with the in-progress title and a
/// destination-naming message — and performs the navigation on <see cref="FrameworkElement.Loaded"/>, exactly once,
/// through the UI-free <see cref="LegacyAlertStudioRedirectViewModel"/>. The view holds no router or query parsing of
/// its own: the current query arrives through the bound <see cref="ILegacyAlertStudioRedirectLocation"/> state
/// holder and the navigation leaves through the bound <see cref="ILegacyAlertStudioRedirectNavigator"/>. Every string
/// resolves through the i18n facade, the surface carries a Narrator name, and the indicator is a polite live region
/// so the redirect is announced without a focus move. The web source has no loading / empty / error / stale /
/// offline branch (it is a deterministic redirect), so this surface reproduces that single state faithfully.
/// </summary>
public sealed partial class LegacyAlertStudioRedirect : ContentControl
{
    private const double PanelPadding = 32;
    private const double ColumnSpacing = 16;

    private readonly LegacyAlertStudioRedirectViewModel _viewModel;
    private bool _ran;

    /// <summary>
    /// Creates the surface over its i18n facade, the current-location state holder, the navigation port and
    /// (optional) diagnostics. The redirect target is projected immediately so the indicator renders before the
    /// navigation is requested.
    /// </summary>
    /// <param name="localizer">The i18n facade the redirect copy resolves through.</param>
    /// <param name="location">The current-location port (the web <c>useLocation</c> seam) supplying the query string.</param>
    /// <param name="navigator">The navigation port the redirect is dispatched through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public LegacyAlertStudioRedirect(
        ILocalizer localizer,
        ILegacyAlertStudioRedirectLocation location,
        ILegacyAlertStudioRedirectNavigator navigator,
        LegacyAlertStudioRedirectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(navigator);

        _viewModel = new LegacyAlertStudioRedirectViewModel(location, navigator, localizer, diagnostics);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildContent(_viewModel.Display);
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        Loaded += OnLoaded;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>LegacyAlertStudioRedirect</c>).</summary>
    public static string Slug => LegacyAlertStudioRedirectRegistration.Slug;

    /// <summary>The render-ready redirect surface (target + localized copy + Narrator name).</summary>
    public LegacyAlertStudioRedirectDisplay Display => _viewModel.Display;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_ran)
        {
            return;
        }

        _ran = true;

        // Mirrors the web <Navigate> firing as a side effect of mounting: emit the view.opened diagnostic and
        // request the replace-navigation. Idempotent inside the view-model, so a re-entrant Loaded never re-fires.
        _viewModel.Run();
    }

    private static TsGlassPanel BuildContent(LegacyAlertStudioRedirectDisplay display)
    {
        var spinner = new TsSpinner
        {
            Size = ControlSize.Large,
            Label = display.Title,
        };

        var message = new Subhead
        {
            Value = display.Message,
            HorizontalAlignment = HorizontalAlignment.Center,
            HorizontalContentAlignment = HorizontalAlignment.Center,
        };

        var column = new StackPanel
        {
            Spacing = ColumnSpacing,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Children = { spinner, message },
        };

        AutomationProperties.SetName(column, display.AutomationName);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);

        return new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            HorizontalContentAlignment = HorizontalAlignment.Center,
            VerticalContentAlignment = VerticalAlignment.Center,
            Content = column,
        };
    }
}
