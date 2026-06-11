using System.ComponentModel;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 keyboard-shortcuts cheatsheet — a parity port of
/// web/src/components/feedback/KeyboardShortcutsModal.tsx. Wraps <see cref="TsModal"/> (a WinUI
/// <see cref="ContentDialog"/>, so it gets a focus trap, light dismiss and focus restore for free) and composes
/// the web's three controls: a search box (<see cref="TsSearchInput"/>, web <c>SearchInput</c>), an All / Global
/// / This-page filter pill bar (<see cref="TsPillFilterBar"/>, web filter tablist) and a scrollable, grouped list
/// of shortcut rows — each a description and its key combination rendered as <c>kbd</c> chips. Every body state
/// renders: a loading skeleton for the initial pre-open tick, the populated groups, and a friendly empty state
/// when nothing matches the filter + search. All data flows through the shared
/// <see cref="KeyboardShortcutsModalViewModel"/>; the view performs no data access. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name; entrance motion honors the OS
/// reduce-motion setting and all text honors the system font scale.
/// </summary>
public sealed partial class KeyboardShortcutsModal : TsModal, IDisposable
{
    private const double BodyMaxHeight = 460;   // web max-h-[60vh]
    private const double ContentMinWidth = 480;
    private const double GroupSpacing = 24;     // web space-y-6 between groups
    private const double RowSpacing = 6;        // web space-y-1.5 between rows
    private const double KeyChipMinWidth = 24;  // web min-w-[24px]

    private readonly KeyboardShortcutsModalViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsSearchInput _searchInput = new();
    private readonly TsPillFilterBar _pillBar = new();
    private readonly StackPanel _bodyHost = new() { Spacing = GroupSpacing };

    private readonly long _searchToken;
    private bool _renderQueued;
    private bool _syncingSearch;
    private bool _disposed;

    /// <summary>Creates the cheatsheet over the registry, route, localizer and (optional) filter store + diagnostics.</summary>
    public KeyboardShortcutsModal(
        IShortcutRegistry registry,
        IRouteContext route,
        ILocalizer localizer,
        IShortcutFilterStore? filterStore = null,
        KeyboardShortcutsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(route);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new KeyboardShortcutsModalViewModel(registry, route, localizer, filterStore, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        Title = _viewModel.Title;
        CloseButtonText = localizer.GetString("translation.common.close", "Close");
        DefaultButton = ContentDialogButton.Close;
        AutomationProperties.SetName(this, _viewModel.Title);

        _searchInput.PromptText = _viewModel.SearchPrompt;
        _searchInput.Query = _viewModel.Search;
        AutomationProperties.SetName(_searchInput, _viewModel.SearchPrompt);

        _pillBar.Options = _viewModel.FilterOptions;
        _pillBar.SelectedValue = _viewModel.SelectedFilterValue;
        // web: aria-label={t('shortcuts.filter.all', 'All')} on the tablist.
        AutomationProperties.SetName(_pillBar, KeyboardShortcutsModalRegistration.FilterAll(localizer));

        var controls = new StackPanel { Spacing = 12 };
        controls.Children.Add(_searchInput);
        controls.Children.Add(_pillBar);

        if (!MotionPreference.ReduceMotion)
        {
            _bodyHost.ChildrenTransitions = new TransitionCollection { new EntranceThemeTransition() };
        }

        var scroll = new ScrollViewer
        {
            Content = _bodyHost,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            MaxHeight = BodyMaxHeight,
        };

        var root = new StackPanel { Spacing = 16, MinWidth = ContentMinWidth };
        root.Children.Add(controls);
        root.Children.Add(scroll);
        Content = root;

        _searchToken = _searchInput.RegisterPropertyChangedCallback(TsSearchInput.QueryProperty, OnSearchQueryChanged);
        _pillBar.SelectionChanged += OnFilterSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;

        Render();
    }

    /// <summary>The backing state holder (exposed for hosting/diagnostics/tests).</summary>
    public KeyboardShortcutsModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Show the cheatsheet over <paramref name="xamlRoot"/>. Records the <c>view.opened</c> diagnostic on open and
    /// resets the live search box on close (web open/close semantics). Returns the dialog result.
    /// </summary>
    public async Task<ContentDialogResult> ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        XamlRoot = xamlRoot;
        _viewModel.Open();
        try
        {
            return await ShowAsync();
        }
        finally
        {
            _viewModel.Close();
        }
    }

    private void OnSearchQueryChanged(DependencyObject sender, DependencyProperty dp)
    {
        if (_syncingSearch)
        {
            return;
        }

        _viewModel.Search = _searchInput.Query;
    }

    private void OnFilterSelectionChanged(object? sender, string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            _viewModel.SelectFilter(value);
        }
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(KeyboardShortcutsModalViewModel.Search):
                SyncSearchBox();
                break;
            case nameof(KeyboardShortcutsModalViewModel.SelectedFilterValue):
                _pillBar.SelectedValue = _viewModel.SelectedFilterValue;
                break;
            default:
                break;
        }

        ScheduleRender();
    }

    private void SyncSearchBox()
    {
        _syncingSearch = true;
        _searchInput.Query = _viewModel.Search;
        _syncingSearch = false;
    }

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
        _bodyHost.Children.Clear();

        switch (_viewModel.State)
        {
            case KeyboardShortcutsState.Loading:
                _bodyHost.Children.Add(BuildLoading());
                break;

            case KeyboardShortcutsState.Empty:
                _bodyHost.Children.Add(BuildEmpty());
                break;

            default:
                foreach (ShortcutGroup group in _viewModel.Groups)
                {
                    _bodyHost.Children.Add(BuildGroup(group));
                }

                break;
        }
    }

    private TsEmptyState BuildEmpty() => new() { Message = _viewModel.EmptyMessage };

    private static StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = RowSpacing };
        for (int i = 0; i < 4; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 18, Radius = 6, ReduceMotion = MotionPreference.ReduceMotion });
        }

        return column;
    }

    private static StackPanel BuildGroup(ShortcutGroup group)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(new SectionTitle { Value = group.Title });

        var rows = new StackPanel { Spacing = RowSpacing };
        foreach (ShortcutDefinition shortcut in group.Shortcuts)
        {
            rows.Children.Add(BuildRow(shortcut));
        }

        section.Children.Add(rows);
        return section;
    }

    private static Grid BuildRow(ShortcutDefinition shortcut)
    {
        var grid = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var description = new Text
        {
            Value = shortcut.Description,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(description, 0);
        grid.Children.Add(description);

        StackPanel keys = BuildKeys(shortcut.Keys);
        Grid.SetColumn(keys, 1);
        grid.Children.Add(keys);

        AutomationProperties.SetName(grid, shortcut.AccessibleName);
        return grid;
    }

    private static StackPanel BuildKeys(IReadOnlyList<string> keys)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };

        for (int i = 0; i < keys.Count; i++)
        {
            if (i > 0)
            {
                row.Children.Add(new Caption
                {
                    Value = "+",
                    Foreground = DisplayTokens.TextMuted,
                    VerticalAlignment = VerticalAlignment.Center,
                });
            }

            row.Children.Add(BuildKeyChip(keys[i]));
        }

        return row;
    }

    private static Border BuildKeyChip(string token)
    {
        var label = new TextBlock
        {
            Text = token,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextAlignment = TextAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            MinWidth = KeyChipMinWidth,
        };

        return new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 4),
            Padding = new Thickness(8, 1, 8, 1),
            Child = label,
        };
    }

    /// <summary>Detach from the view-model and the control callbacks (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _pillBar.SelectionChanged -= OnFilterSelectionChanged;
        _searchInput.UnregisterPropertyChangedCallback(TsSearchInput.QueryProperty, _searchToken);
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }
}
