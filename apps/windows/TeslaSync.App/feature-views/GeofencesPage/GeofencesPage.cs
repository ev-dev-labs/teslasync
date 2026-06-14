using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The native WinUI 3 <c>GeofencesPage</c> — a parity port of the web page
/// <c>web/src/features/maps/pages/GeofencesPage.tsx</c> (route <c>/geofences</c>, nav name <c>Geofences</c>). It
/// binds to a <see cref="GeofencesPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the header (title + subtitle + data-freshness chip + "Add Geofence"), the four summary metric cards
/// (or their no-data empty state), the AI suggest-new-geofences section (the pick-location input + the
/// flag-gated Helix card), the bulk-action toolbar, the searchable + pin-sorted geofence list (each card carrying
/// a selection checkbox, an inline-rename editor, the enabled + alert chips, the coordinates + radius, an enabled
/// toggle and edit / delete actions), and the three list empty surfaces. The create / edit modal (with its
/// "use current location" vehicle / browser / draw-on-map sources and the Fluent map + geofence drawer) and the
/// delete confirmation are presented as Fluent <see cref="ContentDialog"/>s. The view is a thin renderer: all
/// branch selection, formatting and i18n happen in the view-model's <see cref="GeofencesDisplay"/> projection.
/// State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class GeofencesPage : UserControl, IDisposable
{
    private const double SectionSpacing = 24;
    private const double PanelPadding = 20;
    private const string AddGlyph = "\uE710";       // Segoe Fluent "Add".
    private const string EditGlyph = "\uE70F";      // Segoe Fluent "Edit".
    private const string DeleteGlyph = "\uE74D";    // Segoe Fluent "Delete".
    private const string MapPinGlyph = "\uE707";    // Segoe Fluent "MapPin".
    private const string NavigateGlyph = "\uE81D";  // Segoe Fluent "Location".
    private const string GlobeGlyph = "\uE909";     // Segoe Fluent "World".
    private const string RulerGlyph = "\uE799";     // Segoe Fluent "Ruler".

    private readonly GeofencesPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;
    private string _rowsSignature = "\u0000";
    private int _lastToastSequence;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _addButton = new() { Variant = ButtonVariant.Primary, IconGlyph = AddGlyph, VerticalAlignment = VerticalAlignment.Center };

    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly BulkActionsToolbar _bulkBar;
    private readonly AISuggestNewGeofences _aiSuggest;
    private readonly TsInput _aiInput = new() { HorizontalAlignment = HorizontalAlignment.Left, MinWidth = 260 };

    private readonly StackPanel _loadingPanel = new() { Spacing = 16 };
    private readonly TsErrorDisplay _errorState = new();
    private readonly StackPanel _content = new() { Spacing = SectionSpacing };

    private readonly Grid _statsGrid = new() { ColumnSpacing = 12, RowSpacing = 12 };
    private readonly TsEmptyState _statsEmpty = new() { IconGlyph = GeofencesProjection.ActivityGlyph, Visibility = Visibility.Collapsed };

    private readonly SectionTitle _aiInputLabel = new();
    private readonly TsSearchInput _searchInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Border _filterChip = new() { Visibility = Visibility.Collapsed, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly Caption _filterChipText = new();
    private readonly StackPanel _rowsPanel = new() { Spacing = 12 };
    private readonly TsEmptyState _noMatchesEmpty = new() { IconGlyph = GeofencesProjection.ActivityGlyph, Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _definedEmpty = new() { IconGlyph = GeofencesProjection.ShieldGlyph, Visibility = Visibility.Collapsed };
    private readonly TsGlassPanel _listPanel = new();

    private readonly Dictionary<long, TsCheckbox> _rowChecks = new();
    private readonly Dictionary<long, TsToggle> _rowToggles = new();

    /// <summary>Creates the page over the default empty feed and the shell resource localizer.</summary>
    public GeofencesPage()
        : this(EmptyGeofencesFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The geofence list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public GeofencesPage(IGeofencesFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new GeofencesPageViewModel(feed, localizer);

        _bulkBar = new BulkActionsToolbar(
            BuildBulkActions(_viewModel.Display),
            localizer,
            new BulkItemNoun(_viewModel.Display.BulkNounOne, _viewModel.Display.BulkNounOther));

        _aiSuggest = new AISuggestNewGeofences(
            InertGeofenceDraftTransport.Instance,
            StaticAiFeatureGate.Off,
            localizer,
            locationId: null,
            currentName: null,
            onApplyDraft: OnApplyAiDraft);

        BuildLoadingPanel();
        Content = BuildLayout();

        _addButton.Click += OnAddClicked;
        _errorState.ActionInvoked += OnRetryInvoked;
        _searchInput.QueryChanged += OnSearchChanged;
        _noMatchesEmpty.ActionInvoked += OnClearSearch;
        _definedEmpty.ActionInvoked += OnAddClicked;
        _bulkBar.SelectionCleared += OnSelectionCleared;
        _aiInput.TextChanged += OnAiLocationChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The navigation route name the shell registers this page under (<c>Geofences</c>).</summary>
    public static string RouteName => GeofencesRegistration.RouteName;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public GeofencesPageViewModel ViewModel => _viewModel;

    private BulkAction[] BuildBulkActions(GeofencesDisplay display)
    {
        var delete = new BulkAction(
            "delete",
            display.BulkDeleteLabel,
            ids => _viewModel.BulkDeleteAsync(ids.Select(i => long.Parse(i.ToString(), CultureInfo.InvariantCulture)).ToArray()),
            BulkActionVariant.Danger,
            iconGlyph: DeleteGlyph,
            confirm: new BulkActionConfirmation(
                display.BulkDeleteConfirmTitle,
                display.BulkDeleteConfirmBody,
                display.BulkDeleteConfirmLabel));

        return new[] { delete };
    }

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = SectionSpacing, Padding = new Thickness(PanelPadding + 4) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_toast);
        stack.Children.Add(_loadingPanel);
        stack.Children.Add(_errorState);
        stack.Children.Add(BuildContent());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        _freshness.Margin = new Thickness(0, 0, 12, 0);
        Grid.SetColumn(_freshness, 1);
        grid.Children.Add(_freshness);

        Grid.SetColumn(_addButton, 2);
        grid.Children.Add(_addButton);

        return grid;
    }

    private void BuildLoadingPanel()
    {
        _loadingPanel.Children.Add(ColumnsGrid(4, 12, BuildSkeletonBlocks(4, 84)));
        _loadingPanel.Children.Add(new TsGlassPanel
        {
            Padding = new Thickness(PanelPadding),
            Content = new StackPanel
            {
                Spacing = 12,
                Children =
                {
                    new TsSkeleton { BlockHeight = 24 },
                    new TsSkeleton { BlockHeight = 80 },
                    new TsSkeleton { BlockHeight = 80 },
                    new TsSkeleton { BlockHeight = 80 },
                },
            },
        });
    }

    private static List<FrameworkElement> BuildSkeletonBlocks(int count, double height)
    {
        var blocks = new List<FrameworkElement>(count);
        for (int i = 0; i < count; i++)
        {
            blocks.Add(new TsSkeleton { BlockHeight = height });
        }

        return blocks;
    }

    private StackPanel BuildContent()
    {
        _content.Children.Add(BuildStatsPanel());
        _content.Children.Add(BuildAiPanel());
        _content.Children.Add(_bulkBar);
        _content.Children.Add(BuildListPanel());
        _content.Children.Add(_definedEmpty);
        return _content;
    }

    private TsGlassPanel BuildStatsPanel()
    {
        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(_statsGrid);
        body.Children.Add(_statsEmpty);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = body };
    }

    private TsGlassPanel BuildAiPanel()
    {
        _aiInputLabel.Margin = new Thickness(0, 0, 0, 8);
        _aiInput.Margin = new Thickness(0, 0, 0, 12);

        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(_aiInputLabel);
        column.Children.Add(_aiInput);
        column.Children.Add(_aiSuggest);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = column };
    }

    private TsGlassPanel BuildListPanel()
    {
        var column = new StackPanel { Spacing = 16 };

        _searchInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        column.Children.Add(_searchInput);

        _filterChip.Padding = new Thickness(10, 4, 10, 4);
        _filterChip.CornerRadius = new CornerRadius(999);
        _filterChip.Background = Brush("TsColorSurfaceGlassBrush");
        _filterChip.BorderBrush = Brush("TsColorBorderBrush");
        _filterChip.BorderThickness = new Thickness(1);
        _filterChip.Child = _filterChipText;
        column.Children.Add(_filterChip);

        column.Children.Add(_rowsPanel);
        column.Children.Add(_noMatchesEmpty);

        _listPanel.Padding = new Thickness(PanelPadding);
        _listPanel.Content = column;
        return _listPanel;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + hosted surfaces (CA1001; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _addButton.Click -= OnAddClicked;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _searchInput.QueryChanged -= OnSearchChanged;
        _noMatchesEmpty.ActionInvoked -= OnClearSearch;
        _definedEmpty.ActionInvoked -= OnAddClicked;
        _bulkBar.SelectionCleared -= OnSelectionCleared;
        _aiInput.TextChanged -= OnAiLocationChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _bulkBar.Dispose();
        _aiSuggest.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RefreshAsync();

    private void OnSearchChanged(object? sender, string query)
    {
        if (!_suppressEvents)
        {
            _viewModel.Search = query;
        }
    }

    private void OnClearSearch(object? sender, EventArgs e) => _viewModel.Search = string.Empty;

    private void OnSelectionCleared(object? sender, EventArgs e) => _viewModel.ClearSelection();

    private void OnAddClicked(object? sender, RoutedEventArgs e) => _ = OpenModalAsync(null);

    private void OnAddClicked(object? sender, EventArgs e) => _ = OpenModalAsync(null);

    private void OnAiLocationChanged(object sender, TextChangedEventArgs e)
    {
        _aiSuggest.LocationId = long.TryParse(_aiInput.Text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && id > 0
            ? id
            : null;
    }

    private void OnApplyAiDraft(GeofenceDraftApplication draft) =>
        _ = OpenModalAsync(null, new GeofenceFormState(
            draft.Name,
            draft.Latitude.ToString(CultureInfo.InvariantCulture),
            draft.Longitude.ToString(CultureInfo.InvariantCulture),
            Math.Round(draft.Radius).ToString(CultureInfo.InvariantCulture),
            GeofenceAlertKind.Both,
            true));

    private void Render(GeofencesDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _addButton.Text = display.AddLabel;
        AutomationProperties.SetName(_addButton, display.AddLabel);
        AutomationProperties.SetName(this, display.Title);

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;

        _loadingPanel.Visibility = Show(display.ShowLoading);

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;
        AutomationProperties.SetName(_errorState, display.ErrorText);

        _content.Visibility = Show(display.ShowContent);
        _addButton.Visibility = Show(!display.ShowError);

        if (display.ShowContent)
        {
            RenderStats(display);
            RenderAiSection();
            RenderList(display);
        }

        SyncToast();
        _suppressEvents = false;
    }

    private void RenderStats(GeofencesDisplay display)
    {
        _statsGrid.Visibility = Show(display.StatsHasData);
        _statsEmpty.Visibility = Show(!display.StatsHasData);
        _statsEmpty.Message = display.StatsEmptyMessage;

        if (!display.StatsHasData)
        {
            _statsGrid.Children.Clear();
            return;
        }

        var cards = new List<FrameworkElement>(display.Metrics.Count);
        foreach (var metric in display.Metrics)
        {
            var card = new TsMetricCard { Label = metric.Label, Value = metric.Value, AccentBrushKey = metric.AccentBrushKey };
            AutomationProperties.SetName(card, $"{metric.Label}: {metric.Value}");
            cards.Add(card);
        }

        FillColumnsGrid(_statsGrid, 4, cards);
    }

    private void RenderAiSection() =>
        _aiInputLabel.Value = _localizer.GetString(
            "geofences.aiSuggest.pickLocation",
            "Pick a visited location to draft a geofence around"); // parity:allow web i18n key name 'aiSuggest.pickLocation', not a stub marker

    private void RenderList(GeofencesDisplay display)
    {
        _searchInput.PromptText = display.SearchHint;
        _searchInput.Visibility = Show(display.ShowSearch);

        _filterChip.Visibility = Show(display.ShowFilterChip);
        _filterChipText.Value = display.FilterChipLabel;

        _listPanel.Visibility = Show(display.ShowRows || display.ShowNoMatches || display.ShowSearch);
        _rowsPanel.Visibility = Show(display.ShowRows);

        _noMatchesEmpty.Visibility = Show(display.ShowNoMatches);
        _noMatchesEmpty.Message = display.NoMatchesMessage;
        _noMatchesEmpty.ActionText = display.ClearSearchLabel;

        _definedEmpty.Visibility = Show(display.ShowDefinedEmpty);
        _definedEmpty.Title = display.DefinedEmptyTitle;
        _definedEmpty.Message = display.DefinedEmptyMessage;
        _definedEmpty.ActionText = display.AddLabel;

        _bulkBar.Visibility = Show(display.ShowContent && display.StatsHasData);
        _bulkBar.SetSelection(
            display.Rows.Where(r => r.IsSelected).Select(r => BulkSelectionId.Number(r.Id)).ToList(),
            display.Rows.Count);

        RenderRows(display);
    }

    private void RenderRows(GeofencesDisplay display)
    {
        string signature = RowsSignature(display.Rows);
        if (signature != _rowsSignature)
        {
            _rowsSignature = signature;
            _rowsPanel.Children.Clear();
            _rowChecks.Clear();
            _rowToggles.Clear();

            if (display.ShowRows)
            {
                foreach (var row in display.Rows)
                {
                    _rowsPanel.Children.Add(BuildRow(row));
                }
            }

            return;
        }

        foreach (var row in display.Rows)
        {
            if (_rowChecks.TryGetValue(row.Id, out var check))
            {
                check.IsChecked = row.IsSelected;
            }

            if (_rowToggles.TryGetValue(row.Id, out var toggle))
            {
                toggle.IsOn = row.Enabled;
            }
        }
    }

    private TsGlassPanel BuildRow(GeofenceRowDisplay row)
    {
        long id = row.Id;

        var grid = new Grid { ColumnSpacing = 16, VerticalAlignment = VerticalAlignment.Center };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var check = new TsCheckbox { IsChecked = row.IsSelected, MinWidth = 0, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(check, row.SelectLabel);
        ToolTipService.SetToolTip(check, row.SelectLabel);
        check.Click += (_, _) =>
        {
            if (!_suppressEvents)
            {
                _viewModel.ToggleSelect(id);
            }
        };
        _rowChecks[id] = check;
        Grid.SetColumn(check, 0);
        grid.Children.Add(check);

        var iconBox = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(12),
            Background = Brush("TsColorSurfaceGlassBrush"),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new FontIcon { Glyph = MapPinGlyph, FontSize = 18, Foreground = Brush("TsColorTextMutedBrush") },
        };
        Grid.SetColumn(iconBox, 1);
        grid.Children.Add(iconBox);

        Grid.SetColumn(BuildRowDetails(row), 2);
        grid.Children.Add(BuildRowDetails(row));

        var actions = BuildRowActions(row);
        Grid.SetColumn(actions, 3);
        grid.Children.Add(actions);

        AutomationProperties.SetName(grid, row.AutomationName);
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = grid };
    }

    private StackPanel BuildRowDetails(GeofenceRowDisplay row)
    {
        long id = row.Id;

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };

        var editor = new TsEditableText
        {
            Value = row.Name,
            EditLabel = row.RenameLabel,
            ConfirmLabel = _localizer.GetString("common.save", "Save"),
            CancelLabel = _localizer.GetString("Cancel", "Cancel"),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(editor, row.RenameLabel);
        string original = row.Name;
        editor.ValueCommitted += async (_, next) =>
        {
            if ((next ?? string.Empty).Length > 120)
            {
                ShowToast(_localizer.GetString("geofences.error.nameTooLong", "Max 120 characters"), isError: true);
                editor.Value = original;
                return;
            }

            bool ok = await _viewModel.RenameAsync(id, next ?? string.Empty).ConfigureAwait(true);
            if (!ok)
            {
                editor.Value = original;
            }
        };
        titleRow.Children.Add(editor);

        titleRow.Children.Add(new TsBadge { Status = row.EnabledStatus, Content = row.EnabledLabel, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(new TsBadge { Status = row.AlertStatus, Content = row.AlertLabel, VerticalAlignment = VerticalAlignment.Center });

        var metaRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16, Margin = new Thickness(0, 4, 0, 0) };
        metaRow.Children.Add(MetaChip(GlobeGlyph, row.Coordinates));
        metaRow.Children.Add(MetaChip(RulerGlyph, row.RadiusText));

        return new StackPanel
        {
            Spacing = 2,
            VerticalAlignment = VerticalAlignment.Center,
            Children = { titleRow, metaRow },
        };
    }

    private StackPanel BuildRowActions(GeofenceRowDisplay row)
    {
        long id = row.Id;

        var toggle = new TsToggle { IsOn = row.Enabled, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(toggle, row.EnabledLabel);
        toggle.Toggled += (_, _) =>
        {
            if (!_suppressEvents)
            {
                _ = _viewModel.ToggleAsync(id, toggle.IsOn);
            }
        };
        _rowToggles[id] = toggle;

        var edit = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = EditGlyph, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(edit, $"{_localizer.GetString("Edit Geofence", "Edit Geofence")}: {row.Name}");
        edit.Click += (_, _) =>
        {
            var geofence = _viewModel.FindById(id);
            if (geofence is not null)
            {
                _ = OpenModalAsync(geofence);
            }
        };

        var delete = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = DeleteGlyph, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(delete, $"{_localizer.GetString("Delete Geofence", "Delete Geofence")}: {row.Name}");
        delete.Click += (_, _) =>
        {
            var geofence = _viewModel.FindById(id);
            if (geofence is not null)
            {
                _ = ConfirmDeleteAsync(geofence);
            }
        };

        return new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
            Children = { toggle, edit, delete },
        };
    }

    private static StackPanel MetaChip(string glyph, string text)
    {
        var chip = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        chip.Children.Add(new FontIcon { Glyph = glyph, FontSize = 12, Foreground = Brush("TsColorTextMutedBrush") });
        chip.Children.Add(new Caption { Value = text });
        return chip;
    }

    // ── Toast ───────────────────────────────────────────────────────────────────────────────────────────────
    private void SyncToast()
    {
        if (_viewModel.ToastSequence == _lastToastSequence)
        {
            return;
        }

        _lastToastSequence = _viewModel.ToastSequence;
        ShowToast(_viewModel.ToastMessage, _viewModel.ToastIsError);
    }

    private void ShowToast(string message, bool isError)
    {
        _toast.Title = message;
        _toast.Message = string.Empty;
        _toast.Severity = isError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
        _toast.IsOpen = !string.IsNullOrEmpty(message);
    }

    /// <summary>Surface a transient toast from a hosted form surface (the create-modal location flow).</summary>
    internal void PushToast(string message, bool isError) => ShowToast(message, isError);

    // ── Create / edit modal ─────────────────────────────────────────────────────────────────────────────────
    private async Task OpenModalAsync(Geofence? editing, GeofenceFormState? seed = null)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var form = seed ?? (editing is null
            ? GeofenceFormState.Empty
            : new GeofenceFormState(
                editing.Name,
                editing.Latitude.ToString(CultureInfo.InvariantCulture),
                editing.Longitude.ToString(CultureInfo.InvariantCulture),
                editing.Radius.ToString("0", CultureInfo.InvariantCulture),
                editing.AlertKind,
                editing.Enabled));

        var builder = new GeofenceFormBuilder(this, _localizer, editing is null, form);
        var dialog = new TsModal
        {
            Title = _localizer.GetString(editing is null ? "Create Geofence" : "Edit Geofence", editing is null ? "Create Geofence" : "Edit Geofence"),
            Content = builder.Root,
            PrimaryButtonText = _localizer.GetString(editing is null ? "Create" : "Update", editing is null ? "Create" : "Update"),
            CloseButtonText = _localizer.GetString("Cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                var current = builder.Snapshot();
                var errors = GeofenceFormValidator.Validate(current);
                if (errors.HasAny)
                {
                    builder.ShowErrors(errors, _localizer.GetString("forms.validationFailed", "Please fix the highlighted fields before saving."));
                    args.Cancel = true;
                    return;
                }

                bool ok = editing is null
                    ? await _viewModel.CreateAsync(current).ConfigureAwait(true)
                    : await _viewModel.UpdateAsync(editing.Id, current).ConfigureAwait(true);
                if (!ok)
                {
                    args.Cancel = true;
                }
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }

    private async Task ConfirmDeleteAsync(Geofence geofence)
    {
        if (XamlRoot is null)
        {
            return;
        }

        string message = GeofencesProjection.Interpolate(
            _localizer.GetString(
                "Are you sure you want to delete \"{{name}}\"? This action cannot be undone.",
                "Are you sure you want to delete \"{{name}}\"? This action cannot be undone."),
            geofence.Name);

        var dialog = new TsConfirmDialog
        {
            Title = _localizer.GetString("Delete Geofence", "Delete Geofence"),
            Content = new Text { Value = message },
            PrimaryButtonText = _localizer.GetString("Delete", "Delete"),
            CloseButtonText = _localizer.GetString("Cancel", "Cancel"),
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                await _viewModel.DeleteAsync(geofence.Id).ConfigureAwait(true);
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────
    private static string RowsSignature(IReadOnlyList<GeofenceRowDisplay> rows)
    {
        if (rows.Count == 0)
        {
            return "\u0001";
        }

        return string.Join("|", rows.Select(r => string.Create(
            CultureInfo.InvariantCulture,
            $"{r.Id}:{r.Name}:{r.Enabled}:{r.AlertLabel}:{r.Coordinates}:{r.RadiusText}")));
    }

    private static Grid ColumnsGrid(int columns, double spacing, List<FrameworkElement> children)
    {
        var grid = new Grid { ColumnSpacing = spacing, RowSpacing = spacing };
        FillColumnsGrid(grid, columns, children);
        return grid;
    }

    private static void FillColumnsGrid(Grid grid, int columns, List<FrameworkElement> children)
    {
        int cols = Math.Max(1, columns);
        int rows = (int)Math.Ceiling(children.Count / (double)cols);

        grid.Children.Clear();
        grid.ColumnDefinitions.Clear();
        grid.RowDefinitions.Clear();

        for (int c = 0; c < cols; c++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        for (int r = 0; r < Math.Max(1, rows); r++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }

        for (int i = 0; i < children.Count; i++)
        {
            var child = children[i];
            Grid.SetColumn(child, i % cols);
            Grid.SetRow(child, i / cols);
            grid.Children.Add(child);
        }
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    internal static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    /// <summary>
    /// An inert geofence-draft transport — the off-mode default for the hosted <c>AISuggestNewGeofences</c> card.
    /// The AI feature ships disabled (web <c>withAiFeature</c> default-off), so the gate keeps the surface
    /// collapsed and this transport is never opened; it yields no events.
    /// </summary>
    private sealed class InertGeofenceDraftTransport : IAiGeofenceDraftStreamTransport
    {
        public static InertGeofenceDraftTransport Instance { get; } = new();

        public async IAsyncEnumerable<AiGeofenceDraftStreamEvent> StreamAsync(
            AiGeofenceDraftRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask.ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            yield break;
        }
    }
}
