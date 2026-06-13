using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// The native WinUI 3 <c>ScheduledExportsPanel</c> — a parity port of the web panel
/// <c>web/src/features/system/pages/ScheduledExportsPanel.tsx</c> (mounted on the data-export page). It binds to a
/// <see cref="ScheduledExportsPanelViewModel"/> and renders every web region with Fluent components and design
/// tokens inside one glass panel (GlassPanel1): the header (title + subtitle + "New schedule" button), the inline
/// create/edit form (name / cron / export-type / format / range-window / delivery-kind, plus the conditional
/// delivery-target field, with Cancel + Save), and the body that switches between the loading skeletons, the empty
/// state and the schedules table. Each table row carries the type, cron, delivery, next-run, last-run and status
/// cells plus the Run-now / Enable-Disable / Edit / Delete actions; the destructive delete confirms through a
/// <see cref="TsConfirmDialog"/>. The view is a thin renderer: all branch selection, formatting and i18n happen in
/// the view-model's <see cref="ScheduledExportsDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class ScheduledExportsPanel : UserControl, IDisposable
{
    private const string AddGlyph = "\uE710";      // Segoe Fluent "Add".
    private const string RunGlyph = "\uE768";      // Segoe Fluent "Play".
    private const string DeleteGlyph = "\uE74D";   // Segoe Fluent "Delete".
    private const string EditGlyph = "\uE70F";     // Segoe Fluent "Edit".
    private const string EmptyGlyph = "\uE787";    // Segoe Fluent "Calendar".

    private const double NameColumn = 180;
    private const double TypeColumn = 130;
    private const double CronColumn = 140;
    private const double DeliveryColumn = 190;
    private const double NextRunColumn = 160;
    private const double LastRunColumn = 160;
    private const double StatusColumn = 96;
    private const double ActionsColumn = 320;

    private readonly ScheduledExportsPanelViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;
    private int _renderedFormEpoch = -1;
    private string _rowsSignature = "\u0000";

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _newButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = AddGlyph };

    private readonly Border _formRegion = new() { CornerRadius = new CornerRadius(8), Padding = new Thickness(16) };
    private readonly Label _nameLabel = new();
    private readonly TsInput _nameInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _cronLabel = new();
    private readonly TsInput _cronInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly HelperText _cronHelp = new();
    private readonly Label _exportTypeLabel = new();
    private readonly TsSelect _exportTypeSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _formatLabel = new();
    private readonly TsSelect _formatSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _rangeWindowLabel = new();
    private readonly TsInput _rangeWindowInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly HelperText _rangeWindowHelp = new();
    private readonly Label _deliveryKindLabel = new();
    private readonly TsSelect _deliveryKindSelect = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Label _deliveryTargetLabel = new();
    private readonly TsInput _deliveryTargetInput = new() { HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly HelperText _deliveryTargetHelp = new();
    private readonly StackPanel _deliveryTargetField = new() { Spacing = 4 };
    private readonly TsButton _cancelButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _submitButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small };

    private readonly StackPanel _loadingPanel;
    private readonly TsEmptyState _emptyState = new() { IconGlyph = EmptyGlyph };

    private readonly StackPanel _tableSection = new() { Spacing = 0 };
    private readonly Grid _tableHeader = new() { Padding = new Thickness(0, 0, 0, 8) };
    private readonly Label _hName = new();
    private readonly Label _hType = new();
    private readonly Label _hCron = new();
    private readonly Label _hDelivery = new();
    private readonly Label _hNextRun = new();
    private readonly Label _hLastRun = new();
    private readonly Label _hStatus = new();
    private readonly Label _hActions = new();
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };

    /// <summary>Creates the panel over the default empty feed and the shell resource localizer.</summary>
    public ScheduledExportsPanel()
        : this(EmptyScheduledExportsFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the panel over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The schedule-list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public ScheduledExportsPanel(IScheduledExportsFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ScheduledExportsPanelViewModel(feed, localizer);

        _loadingPanel = BuildLoadingPanel();
        BuildForm();
        BuildTableSection();

        Content = BuildLayout();

        _newButton.Click += OnNewClick;
        _cancelButton.Click += OnCancelClick;
        _submitButton.Click += OnSubmitClick;
        _nameInput.TextChanged += OnNameChanged;
        _cronInput.TextChanged += OnCronChanged;
        _rangeWindowInput.TextChanged += OnRangeWindowChanged;
        _deliveryTargetInput.TextChanged += OnDeliveryTargetChanged;
        _exportTypeSelect.SelectionChanged += OnExportTypeChanged;
        _formatSelect.SelectionChanged += OnFormatChanged;
        _deliveryKindSelect.SelectionChanged += OnDeliveryKindChanged;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>ScheduledExportsPanel</c>).</summary>
    public static string Slug => ScheduledExportsRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_formRegion);
        stack.Children.Add(BuildBody());

        var panel = new TsGlassPanel { Content = stack };

        return new ScrollViewer
        {
            Content = panel,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel { Spacing = 4 };
        heading.Children.Add(_title);
        heading.Children.Add(_subtitle);
        Grid.SetColumn(heading, 0);
        grid.Children.Add(heading);

        _newButton.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(_newButton, 1);
        grid.Children.Add(_newButton);
        return grid;
    }

    private void BuildForm()
    {
        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(PairRow(Field(_nameLabel, _nameInput, null), Field(_cronLabel, _cronInput, _cronHelp)));
        body.Children.Add(PairRow(Field(_exportTypeLabel, _exportTypeSelect, null), Field(_formatLabel, _formatSelect, null)));
        body.Children.Add(PairRow(Field(_rangeWindowLabel, _rangeWindowInput, _rangeWindowHelp), Field(_deliveryKindLabel, _deliveryKindSelect, null)));

        _deliveryTargetField.Children.Add(_deliveryTargetLabel);
        _deliveryTargetField.Children.Add(_deliveryTargetInput);
        _deliveryTargetField.Children.Add(_deliveryTargetHelp);
        body.Children.Add(_deliveryTargetField);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        buttons.Children.Add(_cancelButton);
        buttons.Children.Add(_submitButton);
        body.Children.Add(buttons);

        _exportTypeSelect.ItemsSource = ScheduledExportsRegistration.ExportTypes.ToList();
        _formatSelect.ItemsSource = ScheduledExportsRegistration.Formats.ToList();
        _deliveryKindSelect.ItemsSource = ScheduledExportsRegistration.DeliveryKinds.ToList();

        _formRegion.BorderBrush = Brush("TsColorBorderBrush");
        _formRegion.BorderThickness = new Thickness(1);
        _formRegion.Child = body;
    }

    private Grid BuildBody()
    {
        var grid = new Grid();
        grid.Children.Add(_loadingPanel);
        grid.Children.Add(_emptyState);
        grid.Children.Add(_tableSection);
        return grid;
    }

    private void BuildTableSection()
    {
        ApplyColumns(_tableHeader);
        AddHeaderCell(_hName, 0);
        AddHeaderCell(_hType, 1);
        AddHeaderCell(_hCron, 2);
        AddHeaderCell(_hDelivery, 3);
        AddHeaderCell(_hNextRun, 4);
        AddHeaderCell(_hLastRun, 5);
        AddHeaderCell(_hStatus, 6);
        AddHeaderCell(_hActions, 7);

        var inner = new StackPanel { Spacing = 0 };
        inner.Children.Add(_tableHeader);
        inner.Children.Add(_rowsPanel);

        _tableSection.Children.Add(new ScrollViewer
        {
            Content = inner,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollMode = ScrollMode.Auto,
        });
    }

    private void AddHeaderCell(Label label, int column)
    {
        label.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(label, column);
        _tableHeader.Children.Add(label);
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 8, Padding = new Thickness(0, 8, 0, 0) };
        for (int i = 0; i < 3; i++)
        {
            panel.Children.Add(new TsSkeleton { BlockHeight = 48, HorizontalAlignment = HorizontalAlignment.Stretch });
        }

        return panel;
    }

    private static void ApplyColumns(Grid grid)
    {
        grid.ColumnDefinitions.Clear();
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(NameColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TypeColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(CronColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(DeliveryColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(NextRunColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(LastRunColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(StatusColumn) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ActionsColumn) });
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the sibling feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _newButton.Click -= OnNewClick;
        _cancelButton.Click -= OnCancelClick;
        _submitButton.Click -= OnSubmitClick;
        _nameInput.TextChanged -= OnNameChanged;
        _cronInput.TextChanged -= OnCronChanged;
        _rangeWindowInput.TextChanged -= OnRangeWindowChanged;
        _deliveryTargetInput.TextChanged -= OnDeliveryTargetChanged;
        _exportTypeSelect.SelectionChanged -= OnExportTypeChanged;
        _formatSelect.SelectionChanged -= OnFormatChanged;
        _deliveryKindSelect.SelectionChanged -= OnDeliveryKindChanged;
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

    private void Render(ScheduledExportsDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _newButton.Text = display.NewScheduleLabel;
        AutomationProperties.SetName(this, display.Title);
        AutomationProperties.SetName(_newButton, display.NewScheduleLabel);

        RenderForm(display);

        _loadingPanel.Visibility = Show(display.ShowLoading);

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _tableSection.Visibility = Show(display.ShowRows);
        RenderHeader(display.ColumnLabels);
        RenderRows(display);
    }

    private void RenderForm(ScheduledExportsDisplay display)
    {
        _formRegion.Visibility = Show(display.ShowForm);

        var labels = display.FormLabels;
        _nameLabel.Value = labels.NameLabel;
        _cronLabel.Value = labels.CronLabel;
        _cronHelp.Value = labels.CronHelp;
        _exportTypeLabel.Value = labels.ExportTypeLabel;
        _formatLabel.Value = labels.FormatLabel;
        _rangeWindowLabel.Value = labels.RangeWindowLabel;
        _rangeWindowHelp.Value = labels.RangeWindowHelp;
        _deliveryKindLabel.Value = labels.DeliveryKindLabel;
        _deliveryTargetLabel.Value = labels.DeliveryTargetLabel;
        _deliveryTargetHelp.Value = labels.DeliveryTargetHelp;
        _nameInput.Hint = labels.NameHint;

        _cancelButton.Text = labels.CancelLabel;
        _submitButton.Text = labels.SubmitLabel;
        _submitButton.IsLoading = display.Submitting;
        AutomationProperties.SetName(_submitButton, labels.SubmitLabel);
        AutomationProperties.SetName(_cancelButton, labels.CancelLabel);

        _deliveryTargetField.Visibility = Show(display.ShowDeliveryTarget);

        if (_renderedFormEpoch != _viewModel.FormEpoch)
        {
            _renderedFormEpoch = _viewModel.FormEpoch;
            PopulateForm(display.Form);
        }
    }

    private void PopulateForm(ScheduledExportFormState form)
    {
        _suppressEvents = true;
        _nameInput.Text = form.Name;
        _cronInput.Text = form.ScheduleCron;
        _rangeWindowInput.Text = form.RangeWindow;
        _deliveryTargetInput.Text = form.DeliveryTarget;
        _exportTypeSelect.SelectedItem = form.ExportType;
        _formatSelect.SelectedItem = form.Format;
        _deliveryKindSelect.SelectedItem = form.DeliveryKind;
        _suppressEvents = false;
    }

    private void RenderHeader(ScheduledExportsColumnLabels labels)
    {
        _hName.Value = labels.Name;
        _hType.Value = labels.Type;
        _hCron.Value = labels.Cron;
        _hDelivery.Value = labels.Delivery;
        _hNextRun.Value = labels.NextRun;
        _hLastRun.Value = labels.LastRun;
        _hStatus.Value = labels.Status;
        _hActions.Value = labels.Actions;
    }

    private void RenderRows(ScheduledExportsDisplay display)
    {
        string signature = RowsSignature(display.Rows);
        if (signature == _rowsSignature)
        {
            return;
        }

        _rowsSignature = signature;
        _rowsPanel.Children.Clear();

        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row, display.ActionLabels));
        }
    }

    private Border BuildRow(ScheduledExportRow row, ScheduledExportsActionLabels actions)
    {
        var grid = new Grid
        {
            Padding = new Thickness(0, 8, 0, 8),
            VerticalAlignment = VerticalAlignment.Center,
            Opacity = row.Enabled ? 1.0 : 0.5,
        };
        ApplyColumns(grid);

        AddCell(grid, new Text { Value = row.Name }, 0);
        AddCell(grid, new Text { Value = row.TypeLabel }, 1);
        AddCell(grid, new Code { Value = row.Cron }, 2);
        AddCell(grid, new Text { Value = row.Delivery }, 3);
        AddCell(grid, new Text { Value = row.NextRun }, 4);
        AddCell(grid, new Text { Value = row.LastRun }, 5);

        FrameworkElement status = row.HasStatusBadge
            ? new TsBadge { Status = row.StatusVariant, Content = row.StatusLabel, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center }
            : new Text { Value = row.StatusLabel, VerticalAlignment = VerticalAlignment.Center };
        AddCell(grid, status, 6);

        AddCell(grid, BuildActions(row, actions), 7);

        var border = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = Brush("TsColorBorderBrush"),
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private StackPanel BuildActions(ScheduledExportRow row, ScheduledExportsActionLabels actions)
    {
        long id = row.Id;
        string name = row.Name;

        var runButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = actions.RunNow,
            IconGlyph = RunGlyph,
            IsLoading = row.IsRunning,
        };
        AutomationProperties.SetName(runButton, Compose(actions.RunNow, name));
        runButton.Click += (_, _) => InvokeAsync(() => _viewModel.RunNowAsync(id));

        var toggleButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = row.ToggleLabel,
        };
        AutomationProperties.SetName(toggleButton, Compose(row.ToggleLabel, name));
        toggleButton.Click += (_, _) => InvokeAsync(() => _viewModel.ToggleEnabledAsync(id));

        var editButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = actions.Edit,
            IconGlyph = EditGlyph,
        };
        AutomationProperties.SetName(editButton, Compose(actions.Edit, name));
        editButton.Click += (_, _) => _viewModel.StartEdit(id);

        var deleteButton = new TsButton
        {
            Variant = ButtonVariant.Destructive,
            Size = ControlSize.Small,
            Text = actions.Delete,
            IconGlyph = DeleteGlyph,
        };
        AutomationProperties.SetName(deleteButton, Compose(actions.Delete, name));
        deleteButton.Click += (_, _) => ConfirmDelete(id, name);

        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        panel.Children.Add(runButton);
        panel.Children.Add(toggleButton);
        panel.Children.Add(editButton);
        panel.Children.Add(deleteButton);
        return panel;
    }

    private static void AddCell(Grid grid, FrameworkElement element, int column)
    {
        element.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private void OnNewClick(object sender, RoutedEventArgs e) => _viewModel.StartCreate();

    private void OnCancelClick(object sender, RoutedEventArgs e) => _viewModel.CloseForm();

    private void OnSubmitClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.SubmitAsync());

    private void OnNameChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressEvents)
        {
            _viewModel.SetName(_nameInput.Text);
        }
    }

    private void OnCronChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressEvents)
        {
            _viewModel.SetScheduleCron(_cronInput.Text);
        }
    }

    private void OnRangeWindowChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressEvents)
        {
            _viewModel.SetRangeWindow(_rangeWindowInput.Text);
        }
    }

    private void OnDeliveryTargetChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppressEvents)
        {
            _viewModel.SetDeliveryTarget(_deliveryTargetInput.Text);
        }
    }

    private void OnExportTypeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_suppressEvents && _exportTypeSelect.SelectedItem is string value)
        {
            _viewModel.SetExportType(value);
        }
    }

    private void OnFormatChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_suppressEvents && _formatSelect.SelectedItem is string value)
        {
            _viewModel.SetFormat(value);
        }
    }

    private void OnDeliveryKindChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_suppressEvents && _deliveryKindSelect.SelectedItem is string value)
        {
            _viewModel.SetDeliveryKind(value);
        }
    }

    private async void ConfirmDelete(long id, string name)
    {
        var display = _viewModel.Display;
        var dialog = new TsConfirmDialog
        {
            Title = display.DeleteConfirmTitle,
            Content = display.DeleteConfirmBody(name),
            PrimaryButtonText = display.DeleteConfirmLabel,
            CloseButtonText = display.DeleteCancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await _viewModel.DeleteAsync(id).ConfigureAwait(true);
        }
    }

    private static StackPanel Field(Label label, FrameworkElement control, HelperText? help)
    {
        var panel = new StackPanel { Spacing = 4 };
        panel.Children.Add(label);
        panel.Children.Add(control);
        if (help is not null)
        {
            panel.Children.Add(help);
        }

        return panel;
    }

    private static Grid PairRow(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);
        return grid;
    }

    private static string Compose(string action, string name) =>
        string.Create(CultureInfo.CurrentCulture, $"{action}: {name}");

    private static string RowsSignature(IReadOnlyList<ScheduledExportRow> rows)
    {
        if (rows.Count == 0)
        {
            return "\u0001";
        }

        var parts = rows.Select(r => string.Create(
            CultureInfo.InvariantCulture,
            $"{r.Id}:{r.Name}:{r.TypeLabel}:{r.Cron}:{r.Delivery}:{r.NextRun}:{r.LastRun}:{r.StatusLabel}:{r.Enabled}:{r.IsRunning}"));
        return string.Join("|", parts);
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;
}
