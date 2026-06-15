using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TeslaRegionPage</c> view — the native port of the web page
/// (web/src/features/admin/pages/TeslaRegionPage.tsx). The web page owns no API data: it renders a
/// <c>PageContainer</c> title + subtitle header (the two parity strings, web <c>t('region.title')</c> /
/// <c>t('region.subtitle')</c>) around the shared <c>RegionSettings</c> component, which owns its own data flow.
/// This holder owns the resolved page-chrome copy and re-resolves it from the localizer on <see cref="Reload"/>
/// (the native analogue of react-i18next re-rendering after a language change). Observable so the view re-renders
/// on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class TeslaRegionPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    /// <summary>Creates the holder over the i18n facade every label resolves through.</summary>
    /// <param name="localizer">The localizer (the shell resource bridge in the app; passthrough in tests).</param>
    public TeslaRegionPageViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The localized page title (web <c>region.title</c> → "Region &amp; API").</summary>
    public string Title => TeslaRegionRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>region.subtitle</c>).</summary>
    public string Subtitle => TeslaRegionRegistration.Subtitle(_localizer);

    /// <summary>
    /// Re-resolve the title + subtitle from the localizer and notify the view — call after the active language
    /// changes so the header copy updates without reconstructing the page (react-i18next parity).
    /// </summary>
    public void Reload()
    {
        Raise(nameof(Title));
        Raise(nameof(Subtitle));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
