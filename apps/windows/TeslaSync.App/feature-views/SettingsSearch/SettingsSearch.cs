using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Carries the deep-link destination a <see cref="SettingsSearch"/> asks the host to navigate to when a
/// setting is chosen — the native analogue of the web component's <c>commit</c> step
/// (web/src/features/settings/components/SettingsSearch.tsx), which calls <c>navigate(entry.href)</c> and
/// then scrolls the resolved <c>#section</c> into view. The shell host subscribes to
/// <see cref="SettingsSearch.NavigationRequested"/> and performs the navigation; the surface itself stays a
/// thin search box.
/// </summary>
public sealed class SettingsSearchNavigationEventArgs(SettingsNavigationTarget target) : EventArgs
{
    /// <summary>The resolved deep-link destination (web <c>entry.href</c> split into path + section).</summary>
    public SettingsNavigationTarget Target { get; } = target;

    /// <summary>The route portion to navigate to (web <c>navigate(entry.href)</c> path).</summary>
    public string Path => Target.Path;

    /// <summary>The optional same-page anchor to scroll into view (web <c>entry.href.split('#')[1]</c>), or null.</summary>
    public string? Section => Target.Section;

    /// <summary>The original target URL (web <c>entry.href</c>).</summary>
    public string Href => Target.Href;
}

/// <summary>
/// The native WinUI 3 <c>SettingsSearch</c> feature surface — a parity port of
/// web/src/features/settings/components/SettingsSearch.tsx. The web component is a find-as-you-type combobox:
/// a single <c>Input</c> (@/components/ui) with a leading search glyph plus a hand-rolled
/// <c>&lt;ul role="listbox"&gt;</c> popover whose rows each deep-link to a settings section. Its native
/// counterpart is the Fluent <see cref="AutoSuggestBox"/> — the same primitive the atomic <c>TsCombobox</c>
/// wraps and the same mapping the sibling <c>AddressInput</c> surface chose — because it provides, out of the
/// box, exactly what the web hand-wires with <c>role="combobox"</c> / <c>aria-autocomplete</c> /
/// <c>aria-activedescendant</c> / <c>useId</c>: a text field with a suggestion popup, arrow/enter/escape
/// keyboarding, click-outside dismissal, and the combobox↔listbox accessibility relationship. All data flows
/// through the WinUI-free <see cref="SettingsSearchViewModel"/>; the view never builds the index or searches
/// itself. The search is synchronous (no network), so every state the web has is rendered — the populated
/// results dropdown and the "No matching settings." note — with no hidden surface; there is no
/// loading / error / stale / offline branch because there is nothing to fetch. Every string resolves through
/// the i18n facade, the field carries a Narrator name, the decorative search glyph is hidden from Narrator,
/// and the empty-result note announces through a polite live region. The surface adds no custom motion, so
/// reduced-motion is honoured by construction.
/// </summary>
public sealed partial class SettingsSearch : ContentControl, IDisposable
{
    private const double IconSize = 16;

    private readonly SettingsSearchViewModel _viewModel;
    private readonly SettingsSearchDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 6 };
    private readonly AutoSuggestBox _box = new();
    private readonly TextBlock _liveRegion;
    private readonly DataTemplate _entryTemplate = BuildEntryTemplate();
    private readonly DataTemplate _noResultsTemplate = BuildNoResultsTemplate();

    private IReadOnlyList<SettingsSearchRow> _renderedRows = Array.Empty<SettingsSearchRow>();
    private string? _announced;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its index source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The settings-index state-holder seam the search resolves against (P1/S8).</param>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SettingsSearch(
        ISettingsIndexSource source,
        ILocalizer localizer,
        SettingsSearchDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new SettingsSearchViewModel(source, localizer);
        _diagnostics = diagnostics ?? new SettingsSearchDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _liveRegion = DisplayPrimitives.Caption();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetAutomationId(this, SettingsSearchRegistration.Id);

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _box.TextChanged += OnBoxTextChanged;
        _box.QuerySubmitted += OnQuerySubmitted;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when a setting is chosen, asking the host to deep-link to it (web <c>navigate(entry.href)</c>).</summary>
    public event EventHandler<SettingsSearchNavigationEventArgs>? NavigationRequested;

    /// <summary>The canonical surface id (<c>settings-search</c>).</summary>
    public static string SurfaceId => SettingsSearchRegistration.Id;

    /// <summary>The diagnostics surface slug this view registers under (<c>SettingsSearch</c>).</summary>
    public static string Slug => SettingsSearchRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SettingsSearchViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory that wires the localizer-backed <see cref="SettingsIndexSource"/>.</summary>
    public static SettingsSearch Create(ILocalizer localizer, SettingsSearchDiagnostics? diagnostics = null) =>
        new(new SettingsIndexSource(localizer), localizer, diagnostics);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _box.TextChanged -= OnBoxTextChanged;
        _box.QuerySubmitted -= OnQuerySubmitted;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _box.PlaceholderText = _viewModel.PromptText; // parity:allow PlaceholderText is the WinUI hint API
        _box.QueryIcon = new FontIcon { Glyph = SettingsSearchRegistration.SearchGlyph, FontSize = IconSize };
        _box.TextMemberPath = nameof(SettingsSearchRow.PrimaryText);
        _box.UpdateTextOnSelect = false; // web keeps the typed query while arrowing (aria-activedescendant)
        _box.ItemTemplate = _entryTemplate;
        _box.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_box, _viewModel.AriaLabel);

        _liveRegion.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_liveRegion);

        _root.Children.Add(_box);
        _root.Children.Add(_liveRegion);
        Content = _root;
    }

    private static DataTemplate BuildEntryTemplate()
    {
        // web row: <span className="text-sm font-medium">{title}</span> + <span className="text-xs text-muted">{desc}</span>
        const string xaml = """
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
                <StackPanel Spacing="2" Padding="4,6,4,6">
                    <TextBlock Text="{Binding PrimaryText}" FontWeight="SemiBold"
                               TextWrapping="NoWrap" TextTrimming="CharacterEllipsis" />
                    <TextBlock Text="{Binding SecondaryText}" FontSize="12"
                               TextWrapping="NoWrap" TextTrimming="CharacterEllipsis"
                               Foreground="{ThemeResource TextFillColorSecondaryBrush}" />
                </StackPanel>
            </DataTemplate>
            """;
        return (DataTemplate)XamlReader.Load(xaml);
    }

    private static DataTemplate BuildNoResultsTemplate()
    {
        // web no-results option: <li className="text-xs text-muted">{t('settings.search.noResults')}</li>
        const string xaml = """
            <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
                <TextBlock Text="{Binding PrimaryText}" FontSize="12" Padding="4,8,4,8"
                           TextWrapping="Wrap" Foreground="{ThemeResource TextFillColorSecondaryBrush}" />
            </DataTemplate>
            """;
        return (DataTemplate)XamlReader.Load(xaml);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnBoxTextChanged(AutoSuggestBox sender, AutoSuggestBoxTextChangedEventArgs args)
    {
        if (args.Reason != AutoSuggestionBoxTextChangeReason.UserInput)
        {
            return;
        }

        _viewModel.SetQuery(sender.Text);
    }

    private void OnQuerySubmitted(AutoSuggestBox sender, AutoSuggestBoxQuerySubmittedEventArgs args)
    {
        // Choosing a suggestion (tap or arrow+Enter) commits it; the non-actionable no-results row is ignored.
        if (args.ChosenSuggestion is SettingsSearchRow row)
        {
            if (!row.IsNoResults && row.Entry is { } chosen)
            {
                Commit(chosen);
            }

            return;
        }

        // Enter with nothing highlighted commits the active (default first) match — web matches[activeIndex].
        if (_viewModel.Matches.Count > 0)
        {
            Commit(_viewModel.Matches[0]);
        }
    }

    private void Commit(SettingsEntry entry)
    {
        SettingsNavigationTarget target = SettingsSearchViewModel.ResolveTarget(entry);

        // web commit: setQuery('') + close, then navigate. Clearing the field text raises a non-UserInput
        // TextChanged (ignored), and the view-model returns to the idle (closed) surface.
        _viewModel.Clear();
        _box.Text = string.Empty;
        _box.IsSuggestionListOpen = false;

        NavigationRequested?.Invoke(this, new SettingsSearchNavigationEventArgs(target));
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        // Swap the item template to match the row kind: two-line entries, or the single muted no-results note.
        DataTemplate template = _viewModel.State == SettingsSearchState.Empty
            ? _noResultsTemplate
            : _entryTemplate;
        if (!ReferenceEquals(_box.ItemTemplate, template))
        {
            _box.ItemTemplate = template;
        }

        if (!ReferenceEquals(_renderedRows, _viewModel.Rows))
        {
            _renderedRows = _viewModel.Rows;
            _box.ItemsSource = _renderedRows;
        }

        bool focused = _box.FocusState != FocusState.Unfocused;
        if (_viewModel.ShowDropdown && focused)
        {
            _box.IsSuggestionListOpen = true;
        }
        else if (!_viewModel.ShowDropdown)
        {
            _box.IsSuggestionListOpen = false;
        }

        UpdateLiveRegion();
    }

    private void UpdateLiveRegion()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _liveRegion.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _liveRegion.Text = message;
        _liveRegion.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_liveRegion, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_liveRegion);
        }
    }
}
