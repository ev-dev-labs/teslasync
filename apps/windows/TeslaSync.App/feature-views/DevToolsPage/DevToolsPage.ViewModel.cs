using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DevToolsPage</c> view — the native port of the web page's
/// thin shell (web/src/features/admin/pages/DevToolsPage.tsx). The web page owns no API data; it renders a
/// title + subtitle header and a five-tab navigator that swaps between the section surfaces. This holder owns
/// the resolved copy (the two parity strings), the ordered tab catalog and the selected-tab state (web the
/// <c>useUrlEnum('tab', …)</c> local state), and re-resolves every label from the localizer on
/// <see cref="Reload"/> (the native analogue of react-i18next re-rendering after a language change). Observable
/// so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread).
/// </summary>
public sealed class DevToolsPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly IReadOnlyList<DevToolsTab> _tabs = DevToolsCatalog.Tabs;
    private DevToolsTabKey _activeTab = DevToolsCatalog.DefaultTab;

    /// <summary>Creates the holder over the i18n facade every label resolves through.</summary>
    /// <param name="localizer">The localizer (the shell resource bridge in the app; passthrough in tests).</param>
    public DevToolsPageViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The localized page title (web <c>devtools.title</c> → "Developer Tools").</summary>
    public string Title => DevToolsCatalog.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>devtools.subtitle</c>).</summary>
    public string Subtitle => DevToolsCatalog.Subtitle(_localizer);

    /// <summary>The ordered tab catalog (web <c>TABS</c>).</summary>
    public IReadOnlyList<DevToolsTab> Tabs => _tabs;

    /// <summary>The currently selected tab (web the <c>tab</c> state); defaults to Fleet API.</summary>
    public DevToolsTabKey ActiveTab
    {
        get => _activeTab;
        set
        {
            if (_activeTab == value)
            {
                return;
            }

            _activeTab = value;
            Raise(nameof(ActiveTab));
        }
    }

    /// <summary>Resolve the localized label for <paramref name="tab"/> (web the literal <c>TABS[].label</c>).</summary>
    public string Label(DevToolsTab tab)
    {
        ArgumentNullException.ThrowIfNull(tab);
        return tab.Label(_localizer);
    }

    /// <summary>
    /// Re-resolve every label from the localizer and notify the view — call after the active language changes
    /// so the header and tab copy update without reconstructing the page (react-i18next parity).
    /// </summary>
    public void Reload()
    {
        Raise(nameof(Title));
        Raise(nameof(Subtitle));
        Raise(nameof(Tabs));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
