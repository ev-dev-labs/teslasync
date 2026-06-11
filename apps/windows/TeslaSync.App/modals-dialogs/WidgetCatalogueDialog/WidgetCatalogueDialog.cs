using System.ComponentModel;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 widget catalogue dialog — a parity port of
/// web/src/features/dashboard/components/WidgetCatalogueDialog.tsx. Wraps <see cref="TsModal"/> (a WinUI
/// <see cref="ContentDialog"/>, so it gets a focus trap, light dismiss, Esc-to-close and focus restore for free)
/// and composes the web's discoverable picker: a subtitle with the live added / total counts, a search box
/// (<see cref="TsSearchInput"/>, web <c>Input type="search"</c>) over a polite live result-count line, and a
/// scrollable, category-grouped list of widget cards — each an icon, name, an "Added" badge when the widget is
/// already on the dashboard, a description and an Add button (disabled once added). Every body state renders: a
/// loading skeleton for the pre-open tick, the populated category sections, and the friendly "no widgets match"
/// empty panel (with a Clear-search affordance) when a search matches nothing. There is deliberately no
/// error / stale / offline state — the web source composes no network read (see <see cref="WidgetCatalogueState"/>).
/// Picking a not-yet-added widget raises <see cref="WidgetAdded"/> then dismisses (web <c>onAdd</c> + <c>onClose</c>).
/// All data flows through the shared <see cref="WidgetCatalogueDialogViewModel"/>; the view performs no data access.
/// Every string resolves through the i18n facade and every interactive element carries a Narrator name; entrance
/// motion honors the OS reduce-motion setting and all text honors the system font scale.
/// </summary>
public sealed partial class WidgetCatalogueDialog : TsModal, IDisposable
{
    private const double DialogMaxWidth = 1100;  // web sm:max-w-[min(96vw,1100px)]
    private const double ContentMinWidth = 720;
    private const double BodyMaxHeight = 520;     // web modal body scroll cap
    private const double SectionSpacing = 24;     // web space-y-6 between sections
    private const double CardSpacing = 8;          // web gap-2 between cards
    private const double IconBoxSize = 32;

    private readonly WidgetCatalogueDialogViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Text _subtitle = new() { Foreground = DisplayTokens.TextSecondary };
    private readonly TsSearchInput _searchInput = new();
    private readonly Caption _resultCount = new() { Visibility = Visibility.Collapsed };
    private readonly StackPanel _bodyHost = new() { Spacing = SectionSpacing };

    private readonly long _searchToken;
    private bool _renderQueued;
    private bool _syncingSearch;
    private bool _closing;
    private bool _disposed;

    /// <summary>Creates the catalogue over the widget catalogue, localizer and (optional) diagnostics.</summary>
    /// <param name="catalogue">The widget catalogue seam (web <c>WIDGET_REGISTRY</c>); defaults to the app catalogue.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public WidgetCatalogueDialog(
        IWidgetCatalogue? catalogue = null,
        ILocalizer? localizer = null,
        WidgetCatalogueDialogDiagnostics? diagnostics = null)
    {
        ILocalizer loc = localizer ?? PassthroughLocalizer.Instance;
        _viewModel = new WidgetCatalogueDialogViewModel(catalogue ?? WidgetCatalogue.Instance, loc, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // web size="full" → min(96vw, 1100px); widen the themed ContentDialog cap accordingly.
        Resources["ContentDialogMaxWidth"] = DialogMaxWidth;

        Title = _viewModel.Title;
        CloseButtonText = loc.GetString("translation.common.close", "Close");
        DefaultButton = ContentDialogButton.Close;
        AutomationProperties.SetName(this, _viewModel.Title);

        _subtitle.Value = _viewModel.Subtitle;

        _searchInput.PromptText = _viewModel.SearchPrompt;
        _searchInput.Query = _viewModel.Search;
        AutomationProperties.SetName(_searchInput, _viewModel.SearchLabel);

        _resultCount.Value = _viewModel.ResultCountText;
        AutomationProperties.SetLiveSetting(_resultCount, AutomationLiveSetting.Polite);

        var header = new StackPanel { Spacing = 12 };
        header.Children.Add(_subtitle);
        header.Children.Add(_searchInput);
        header.Children.Add(_resultCount);

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
        root.Children.Add(header);
        root.Children.Add(scroll);
        Content = root;

        _searchToken = _searchInput.RegisterPropertyChangedCallback(TsSearchInput.QueryProperty, OnSearchQueryChanged);
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.CloseRequested += OnCloseRequested;
        _viewModel.WidgetAddRequested += OnWidgetAddRequested;

        Render();
    }

    /// <summary>Raised when the user picks a not-yet-added widget (web <c>onAdd(widgetId)</c>); carries its id.</summary>
    public event EventHandler<string>? WidgetAdded;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public WidgetCatalogueDialogViewModel ViewModel => _viewModel;

    /// <summary>
    /// Show the catalogue over <paramref name="xamlRoot"/> with the set of <paramref name="activeWidgetIds"/> already
    /// on the dashboard (web <c>activeWidgetIds</c> prop). Records the <c>view.opened</c> diagnostic and resets the
    /// live search on open / close (web open/close semantics). Returns the dialog result.
    /// </summary>
    public async Task<ContentDialogResult> ShowAsync(XamlRoot xamlRoot, IEnumerable<string>? activeWidgetIds = null)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        XamlRoot = xamlRoot;
        _viewModel.SetActiveWidgets(activeWidgetIds);
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

    private void OnCloseRequested(object? sender, EventArgs e)
    {
        if (_closing)
        {
            return;
        }

        _closing = true;
        Hide();
    }

    private void OnWidgetAddRequested(object? sender, string widgetId) =>
        WidgetAdded?.Invoke(this, widgetId);

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        switch (e.PropertyName)
        {
            case nameof(WidgetCatalogueDialogViewModel.Search):
                SyncSearchBox();
                break;
            case nameof(WidgetCatalogueDialogViewModel.Subtitle):
                _subtitle.Value = _viewModel.Subtitle;
                break;
            case nameof(WidgetCatalogueDialogViewModel.IsFiltering):
            case nameof(WidgetCatalogueDialogViewModel.ResultCountText):
                _resultCount.Value = _viewModel.ResultCountText;
                _resultCount.Visibility = _viewModel.IsFiltering ? Visibility.Visible : Visibility.Collapsed;
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
            case WidgetCatalogueState.Loading:
                _bodyHost.Children.Add(BuildLoading());
                break;

            case WidgetCatalogueState.Empty:
                _bodyHost.Children.Add(BuildEmpty());
                break;

            default:
                foreach (WidgetCatalogueGroup group in _viewModel.Groups)
                {
                    _bodyHost.Children.Add(BuildSection(group));
                }

                break;
        }
    }

    private static StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = CardSpacing };
        for (int i = 0; i < 5; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 64, Radius = 12, ReduceMotion = MotionPreference.ReduceMotion });
        }

        return column;
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            IconGlyph = string.Empty,   // web empty panel shows no icon
            Title = _viewModel.EmptyTitle,
            Message = _viewModel.EmptyBody,
            ActionText = _viewModel.ClearSearchLabel,
        };
        empty.ActionInvoked += (_, _) => _viewModel.ClearSearch();
        return empty;
    }

    private StackPanel BuildSection(WidgetCatalogueGroup group)
    {
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(BuildSectionHeading(group));
        section.Children.Add(BuildCardGrid(group));
        return section;
    }

    private static StackPanel BuildSectionHeading(WidgetCatalogueGroup group)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(new FontIcon
        {
            Glyph = group.Glyph,
            FontSize = 14,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Label { Value = group.Label, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Caption
        {
            Value = WidgetCatalogueDialogViewModel.SectionCountLabel(group),
            VerticalAlignment = VerticalAlignment.Center,
        });

        // web: <h3 id=... aria-labelledby>; expose the section as a labelled group for Narrator.
        AutomationProperties.SetName(row, $"{group.Label} {WidgetCatalogueDialogViewModel.SectionCountLabel(group)}");
        return row;
    }

    private Grid BuildCardGrid(WidgetCatalogueGroup group)
    {
        var grid = new Grid { ColumnSpacing = CardSpacing, RowSpacing = CardSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        int count = group.Entries.Count;
        int rows = (count + 1) / 2;
        for (int r = 0; r < rows; r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < count; i++)
        {
            Border card = BuildCard(group.Entries[i]);
            Grid.SetColumn(card, i % 2);
            Grid.SetRow(card, i / 2);
            grid.Children.Add(card);
        }

        return grid;
    }

    private Border BuildCard(WidgetCatalogueEntry entry)
    {
        bool isAdded = _viewModel.IsAdded(entry.Id);

        var layout = new Grid { ColumnSpacing = 12, VerticalAlignment = VerticalAlignment.Top };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var iconBox = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            Background = DisplayTokens.Surface,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon
            {
                Glyph = entry.Glyph,
                FontSize = 16,
                Foreground = DisplayTokens.Accent,
            },
        };
        Grid.SetColumn(iconBox, 0);
        layout.Children.Add(iconBox);

        var nameRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        nameRow.Children.Add(new Text
        {
            Value = entry.Name,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });
        if (isAdded)
        {
            nameRow.Children.Add(new TsBadge
            {
                Status = StatusKind.Neutral,
                Content = _viewModel.AddedLabel,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        var content = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(nameRow);
        content.Children.Add(new Caption { Value = entry.Description });
        Grid.SetColumn(content, 1);
        layout.Children.Add(content);

        var addButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.AddButtonLabel(entry),
            IsEnabled = !isAdded,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(addButton, _viewModel.AddAccessibleName(entry));
        addButton.Click += (_, _) => _viewModel.Add(entry.Id);
        Grid.SetColumn(addButton, 2);
        layout.Children.Add(addButton);

        return new Border
        {
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Padding = new Thickness(12),
            Child = layout,
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
        _viewModel.CloseRequested -= OnCloseRequested;
        _viewModel.WidgetAddRequested -= OnWidgetAddRequested;
        _searchInput.UnregisterPropertyChangedCallback(TsSearchInput.QueryProperty, _searchToken);
        GC.SuppressFinalize(this);
    }
}
