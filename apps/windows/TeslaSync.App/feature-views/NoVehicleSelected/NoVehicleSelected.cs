using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Layout;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>NoVehicleSelected</c> feature surface — a parity port of
/// web/src/features/onboarding/components/NoVehicleSelected.tsx. The web component renders an
/// <c>&lt;EmptyState&gt;</c> (a <c>Car</c> glyph, a localized title and message, and a "Set up TeslaSync"
/// call-to-action that navigates to <c>/onboarding</c>) inside a <c>&lt;GlassPanel&gt;</c> inside a
/// <c>&lt;PageContainer&gt;</c>; it is the defensive surface a page shows when no vehicle is selected, so it
/// never scaffolds data on a null id. This view reproduces that composition with the native primitives — a
/// <see cref="TsPageContainer"/> (the <c>PageContainer</c>) carrying the page title, hosting a
/// <see cref="TsGlassPanel"/> (the <c>GlassPanel</c>, web <c>p-8</c> padding) that hosts a
/// <see cref="TsEmptyState"/> (the <c>EmptyState</c>) with the car glyph, the localized title / message and the
/// call-to-action. All projection and the localized copy flow through the UI-free
/// <see cref="NoVehicleSelectedViewModel"/>; the view holds no router and performs no HTTP — activating the
/// call-to-action leaves through the bound <see cref="INoVehicleSelectedNavigator"/>, and the
/// <c>view.opened</c> diagnostic is emitted once on <see cref="FrameworkElement.Loaded"/>. Every string
/// resolves through the i18n facade, the surface carries a Narrator name and the empty state is a polite live
/// region, and no custom motion is added (the button visual states are system-driven, so the reduced-motion
/// setting is honoured by construction). The web source performs no asynchronous read, so — like the empty
/// state it ports — this surface reproduces that single state faithfully (there is no loading / error / stale /
/// offline branch to model).
/// </summary>
public sealed partial class NoVehicleSelected : ContentControl
{
    // web GlassPanel className="p-8" → 2rem padding around the empty state.
    private const double PanelPadding = 32;

    private readonly NoVehicleSelectedViewModel _viewModel;
    private bool _opened;

    /// <summary>
    /// Creates the surface over its navigation port, i18n facade, the page title, optional copy overrides and
    /// (optional) diagnostics. The empty state is composed immediately so it renders before the surface is
    /// marked opened.
    /// </summary>
    /// <param name="navigator">The navigation port the "Set up TeslaSync" call-to-action is dispatched through.</param>
    /// <param name="localizer">The i18n facade the title / message / action resolve through.</param>
    /// <param name="pageTitle">The localized page title forwarded to the scaffold (web <c>pageTitle</c> prop).</param>
    /// <param name="title">An explicit empty-state title (web <c>title</c> prop), or null for the i18n copy.</param>
    /// <param name="description">An explicit empty-state message (web <c>description</c> prop), or null for the i18n copy.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> / activation events.</param>
    public NoVehicleSelected(
        INoVehicleSelectedNavigator navigator,
        ILocalizer localizer,
        string pageTitle,
        string? title = null,
        string? description = null,
        NoVehicleSelectedDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(pageTitle);

        _viewModel = new NoVehicleSelectedViewModel(navigator, localizer, pageTitle, title, description, diagnostics);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        Content = BuildContent(_viewModel.Display);
        AutomationProperties.SetName(this, _viewModel.Display.AutomationName);

        Loaded += OnLoaded;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>NoVehicleSelected</c>).</summary>
    public static string Slug => NoVehicleSelectedRegistration.Slug;

    /// <summary>The render-ready empty-state surface (page title + localized copy + Narrator name).</summary>
    public NoVehicleSelectedDisplay Display => _viewModel.Display;

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirrors the web component mounting: emit the view.opened diagnostic exactly once. Idempotent inside
        // the view-model, so a re-entrant Loaded never re-fires.
        _viewModel.MarkOpened();
    }

    private void OnSetupRequested(object? sender, EventArgs e) => _viewModel.RequestSetup();

    private TsPageContainer BuildContent(NoVehicleSelectedDisplay display)
    {
        // web <EmptyState icon={Car} title=… message=… action={{ label, onClick }} />
        var emptyState = new TsEmptyState
        {
            IconGlyph = NoVehicleSelectedRegistration.CarGlyph,
            Title = display.Title,
            Message = display.Message,
            ActionText = display.ActionText,
        };
        emptyState.ActionInvoked += OnSetupRequested;

        // web <GlassPanel className="p-8">…</GlassPanel>
        var panel = new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = emptyState,
        };

        // web <PageContainer title={pageTitle}>…</PageContainer>
        return new TsPageContainer
        {
            Title = display.PageTitle,
            PageContent = panel,
        };
    }
}
