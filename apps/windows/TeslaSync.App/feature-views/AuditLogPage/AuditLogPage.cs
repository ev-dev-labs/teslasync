using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>AuditLogPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/AuditLogPage.tsx</c> (route <c>/admin/audit-log</c>, nav name <c>AuditLog</c>). It
/// binds to an <see cref="AuditLogPageViewModel"/> and renders every web region with Fluent components and design
/// tokens: the page header, the HTTP-503 subsystem-unavailable banner (web <c>subsystemMissing</c>), the hash-chain
/// integrity panel (Verify button + hint / failure banner / intact-or-broken result), the filters panel (since / until
/// / category / action / actor / entity-type / page-size + Reset / Search) and the entries panel whose body switches
/// between the loading spinner, the generic failure surface, the "no audit entries" empty state and the expandable
/// audit rows (each row's expanded detail carrying the IP, user-agent, trace id, before/after snapshots and row hash)
/// plus the pagination footer. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="AuditLogDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class AuditLogPage : UserControl, IDisposable
{
    private const double TsCol = 176;
    private const double ActorCol = 150;
    private const double CategoryCol = 128;
    private const double ActionCol = 168;
    private const double EntityCol = 148;
    private const double TraceCol = 152;
    private const double SuccessCol = 84;
    private const double ExpandCol = 96;

    private readonly AuditLogPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppressEvents;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly TsAlertBanner _subsystemBanner = new() { Variant = CalloutVariant.Warning, IsOpen = false, Dismissible = false };

    // ── Panel 1: hash-chain integrity ──
    private readonly PanelTitle _integrityTitle = new();
    private readonly TsButton _verifyButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = "\uE72E" };
    private readonly Caption _verifyHint = new();
    private readonly TsAlertBanner _verifyErrorBanner = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly StackPanel _verifyResultRow;
    private readonly TsBadge _verifyBadge = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly FontIcon _verifyBadgeIcon = new() { FontSize = 14 };
    private readonly TextBlock _verifyBadgeText = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _verifyRowsChecked = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _verifyFirstBad = new() { VerticalAlignment = VerticalAlignment.Center };

    // ── Panel 2: filters ──
    private readonly PanelTitle _filtersTitle = new();
    private readonly Label _sinceLabel = new();
    private readonly Label _untilLabel = new();
    private readonly Label _categoryLabel = new();
    private readonly Label _actionLabel = new();
    private readonly Label _actorLabel = new();
    private readonly Label _entityTypeLabel = new();
    private readonly Label _limitLabel = new();
    private readonly TsInput _sinceInput = new() { Hint = "YYYY-MM-DD HH:MM" };
    private readonly TsInput _untilInput = new() { Hint = "YYYY-MM-DD HH:MM" };
    private readonly TsSelect _categorySelect = new();
    private readonly TsSelect _actionSelect = new();
    private readonly TsInput _actorInput = new();
    private readonly TsInput _entityTypeInput = new();
    private readonly TsSelect _limitSelect = new();
    private readonly TsButton _resetButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Medium, IconGlyph = "\uE711" };
    private readonly TsButton _searchButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Medium, IconGlyph = "\uE721" };

    // ── Panel 3: entries ──
    private readonly PanelTitle _tableTitle = new();
    private readonly TsButton _previousButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE76B" };
    private readonly TsButton _nextButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = "\uE76C" };
    private readonly Caption _pageInfo = new() { VerticalAlignment = VerticalAlignment.Center };

    private readonly TextBlock _hdrTs = NewHeaderCell();
    private readonly TextBlock _hdrActor = NewHeaderCell();
    private readonly TextBlock _hdrCategory = NewHeaderCell();
    private readonly TextBlock _hdrAction = NewHeaderCell();
    private readonly TextBlock _hdrEntity = NewHeaderCell();
    private readonly TextBlock _hdrDetail = NewHeaderCell();
    private readonly TextBlock _hdrTrace = NewHeaderCell();
    private readonly TextBlock _hdrSuccess = NewHeaderCell();

    private readonly StackPanel _loadingPanel;
    private readonly Text _loadingText = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _emptyState = new() { IconGlyph = "\uE81C" }; // History
    private readonly StackPanel _rowsPanel = new() { Spacing = 0 };

    private string _copyLabel = "Copy";

    /// <summary>Creates the page over the default local-state feed and the shell resource localizer.</summary>
    public AuditLogPage()
        : this(EmptyAuditLogFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / dependency injection).</summary>
    /// <param name="feed">The audit-log data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public AuditLogPage(IAuditLogFeed feed, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new AuditLogPageViewModel(feed, localizer);

        _verifyResultRow = BuildVerifyResultRow();
        _loadingPanel = BuildLoadingPanel();

        Content = BuildLayout();

        _verifyButton.Click += OnVerifyClick;
        _resetButton.Click += OnResetClick;
        _searchButton.Click += OnSearchClick;
        _previousButton.Click += OnPreviousClick;
        _nextButton.Click += OnNextClick;
        _errorState.ActionInvoked += OnRetryInvoked;

        _categorySelect.SelectionChanged += OnCategoryChanged;
        _actionSelect.SelectionChanged += OnActionChanged;
        _limitSelect.SelectionChanged += OnLimitChanged;
        _actorInput.KeyDown += OnActorKeyDown;
        _actorInput.LostFocus += OnActorCommitted;
        _entityTypeInput.KeyDown += OnEntityKeyDown;
        _entityTypeInput.LostFocus += OnEntityCommitted;
        _sinceInput.KeyDown += OnSinceKeyDown;
        _sinceInput.LostFocus += OnSinceCommitted;
        _untilInput.KeyDown += OnUntilKeyDown;
        _untilInput.LostFocus += OnUntilCommitted;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        SeedStaticOptions();
        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>AuditLogPage</c>).</summary>
    public static string Slug => AuditLogRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };

        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        stack.Children.Add(header);

        stack.Children.Add(_subsystemBanner);
        stack.Children.Add(BuildIntegrityPanel());
        stack.Children.Add(BuildFiltersPanel());
        stack.Children.Add(BuildTablePanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildIntegrityPanel()
    {
        var headerRow = new Grid();
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _integrityTitle.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_integrityTitle, 0);
        Grid.SetColumn(_verifyButton, 1);
        headerRow.Children.Add(_integrityTitle);
        headerRow.Children.Add(_verifyButton);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(headerRow);
        body.Children.Add(_verifyHint);
        body.Children.Add(_verifyErrorBanner);
        body.Children.Add(_verifyResultRow);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(24), Child = body } };
    }

    private StackPanel BuildVerifyResultRow()
    {
        var badgeContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        badgeContent.Children.Add(_verifyBadgeIcon);
        badgeContent.Children.Add(_verifyBadgeText);
        _verifyBadge.Content = badgeContent;

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(_verifyBadge);
        row.Children.Add(_verifyRowsChecked);
        row.Children.Add(_verifyFirstBad);
        return row;
    }

    private TsGlassPanel BuildFiltersPanel()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        AddFilterCell(grid, 0, 0, _sinceLabel, _sinceInput);
        AddFilterCell(grid, 1, 0, _untilLabel, _untilInput);
        AddFilterCell(grid, 2, 0, _categoryLabel, _categorySelect);
        AddFilterCell(grid, 3, 0, _actionLabel, _actionSelect);
        AddFilterCell(grid, 0, 1, _actorLabel, _actorInput);
        AddFilterCell(grid, 1, 1, _entityTypeLabel, _entityTypeInput);
        AddFilterCell(grid, 2, 1, _limitLabel, _limitSelect);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        buttons.Children.Add(_resetButton);
        buttons.Children.Add(_searchButton);
        Grid.SetColumn(buttons, 3);
        Grid.SetRow(buttons, 1);
        grid.Children.Add(buttons);

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(_filtersTitle);
        body.Children.Add(grid);

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(24), Child = body } };
    }

    private static void AddFilterCell(Grid grid, int column, int row, Label label, FrameworkElement control)
    {
        control.HorizontalAlignment = HorizontalAlignment.Stretch;
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(label);
        cell.Children.Add(control);
        Grid.SetColumn(cell, column);
        Grid.SetRow(cell, row);
        grid.Children.Add(cell);
    }

    private TsGlassPanel BuildTablePanel()
    {
        var headerGrid = new Grid { Padding = new Thickness(24, 20, 24, 12) };
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _tableTitle.VerticalAlignment = VerticalAlignment.Center;

        var pager = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        pager.Children.Add(_previousButton);
        pager.Children.Add(_pageInfo);
        pager.Children.Add(_nextButton);

        Grid.SetColumn(_tableTitle, 0);
        Grid.SetColumn(pager, 1);
        headerGrid.Children.Add(_tableTitle);
        headerGrid.Children.Add(pager);

        var columnHeader = new Border
        {
            Padding = new Thickness(24, 0, 24, 8),
            Child = BuildColumnHeader(),
        };

        var body = new StackPanel { Spacing = 0 };
        body.Children.Add(headerGrid);
        body.Children.Add(columnHeader);
        body.Children.Add(_loadingPanel);
        body.Children.Add(_errorState);
        body.Children.Add(_emptyState);
        body.Children.Add(new Border { Padding = new Thickness(12, 0, 12, 12), Child = _rowsPanel });

        return new TsGlassPanel { Content = body };
    }

    private Grid BuildColumnHeader()
    {
        var grid = NewRowGrid();
        AddCell(grid, 0, _hdrTs);
        AddCell(grid, 1, _hdrActor);
        AddCell(grid, 2, _hdrCategory);
        AddCell(grid, 3, _hdrAction);
        AddCell(grid, 4, _hdrEntity);
        AddCell(grid, 5, _hdrDetail);
        AddCell(grid, 6, _hdrTrace);
        AddCell(grid, 7, _hdrSuccess);
        return grid;
    }

    private StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel
        {
            Spacing = 8,
            Padding = new Thickness(32),
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        panel.Children.Add(new ProgressRing { IsActive = true, Width = 28, Height = 28 });
        panel.Children.Add(_loadingText);
        return panel;
    }

    private void SeedStaticOptions()
    {
        _suppressEvents = true;

        _categorySelect.DisplayMemberPath = nameof(AuditSelectOption.Label);
        _categorySelect.SelectedValuePath = nameof(AuditSelectOption.Value);
        _actionSelect.DisplayMemberPath = nameof(AuditSelectOption.Label);
        _actionSelect.SelectedValuePath = nameof(AuditSelectOption.Value);

        _limitSelect.ItemsSource = _viewModel.Display.LimitOptions;
        _limitSelect.DisplayMemberPath = nameof(AuditSelectOption.Label);
        _limitSelect.SelectedValuePath = nameof(AuditSelectOption.Value);
        _limitSelect.SelectedValue = _viewModel.Display.SelectedLimit;

        _suppressEvents = false;
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

    private void Render(AuditLogDisplay display)
    {
        _suppressEvents = true;

        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.AutomationName);
        _copyLabel = display.CopyLabel;

        _subsystemBanner.IsOpen = display.ShowSubsystemUnavailable;
        _subsystemBanner.Title = display.SubsystemTitle;
        _subsystemBanner.Message = display.SubsystemMessage;

        // ── Panel 1: integrity ──
        _integrityTitle.Value = display.IntegrityTitle;
        _verifyButton.Text = display.VerifyButtonLabel;
        _verifyButton.IsEnabled = !display.VerifyDisabled;
        _verifyHint.Value = display.VerifyHint;
        _verifyHint.Visibility = Show(display.ShowVerifyHint);
        _verifyErrorBanner.IsOpen = display.ShowVerifyError;
        _verifyErrorBanner.Title = display.VerifyErrorTitle;
        _verifyErrorBanner.Message = display.VerifyErrorText;
        _verifyResultRow.Visibility = Show(display.ShowVerifyResult);
        _verifyBadge.Status = display.VerifyBadgeVariant;
        _verifyBadgeIcon.Glyph = display.VerifyIntact ? "\uE73E" : "\uE7BA"; // Completed / Warning
        _verifyBadgeText.Text = display.VerifyBadgeLabel;
        AutomationProperties.SetName(_verifyBadge, display.VerifyBadgeLabel);
        _verifyRowsChecked.Value = display.VerifyRowsCheckedText;
        _verifyFirstBad.Value = display.FirstBadText;
        _verifyFirstBad.Visibility = Show(display.ShowFirstBad);

        // ── Panel 2: filters ──
        _filtersTitle.Value = display.FiltersTitle;
        _sinceLabel.Value = display.SinceLabel;
        _untilLabel.Value = display.UntilLabel;
        _categoryLabel.Value = display.CategoryLabel;
        _actionLabel.Value = display.ActionLabel;
        _actorLabel.Value = display.ActorLabel;
        _entityTypeLabel.Value = display.EntityTypeLabel;
        _limitLabel.Value = display.LimitLabel;
        _resetButton.Text = display.ResetLabel;
        _searchButton.Text = display.SearchLabel;
        _actorInput.Hint = display.ActorPlaceholder; // parity:allow input-hint placeholder text mirroring the web actorPlaceholder, not a stub
        _entityTypeInput.Hint = display.EntityTypePlaceholder; // parity:allow input-hint placeholder text mirroring the web entityTypePlaceholder, not a stub
        AutomationProperties.SetName(_categorySelect, display.CategoryLabel);
        AutomationProperties.SetName(_actionSelect, display.ActionLabel);
        AutomationProperties.SetName(_limitSelect, display.LimitLabel);
        AutomationProperties.SetName(_sinceInput, display.SinceLabel);
        AutomationProperties.SetName(_untilInput, display.UntilLabel);
        AutomationProperties.SetName(_actorInput, display.ActorLabel);
        AutomationProperties.SetName(_entityTypeInput, display.EntityTypeLabel);

        _categorySelect.ItemsSource = display.CategoryOptions;
        _categorySelect.SelectedValue = display.SelectedCategory;
        _actionSelect.ItemsSource = display.ActionOptions;
        _actionSelect.SelectedValue = display.SelectedAction;
        _limitSelect.SelectedValue = display.SelectedLimit;

        if (_sinceInput.FocusState == FocusState.Unfocused && _sinceInput.Text != display.SinceValue)
        {
            _sinceInput.Text = display.SinceValue;
        }

        if (_untilInput.FocusState == FocusState.Unfocused && _untilInput.Text != display.UntilValue)
        {
            _untilInput.Text = display.UntilValue;
        }

        if (_actorInput.FocusState == FocusState.Unfocused && _actorInput.Text != display.ActorValue)
        {
            _actorInput.Text = display.ActorValue;
        }

        if (_entityTypeInput.FocusState == FocusState.Unfocused && _entityTypeInput.Text != display.EntityTypeValue)
        {
            _entityTypeInput.Text = display.EntityTypeValue;
        }

        // ── Panel 3: entries ──
        _tableTitle.Value = display.TableTitle;
        _previousButton.Text = display.PreviousLabel;
        _nextButton.Text = display.NextLabel;
        _pageInfo.Value = display.PageInfoText;
        _previousButton.IsEnabled = display.CanGoPrevious;
        _nextButton.IsEnabled = display.CanGoNext;

        _hdrTs.Text = display.Columns.Ts;
        _hdrActor.Text = display.Columns.Actor;
        _hdrCategory.Text = display.Columns.Category;
        _hdrAction.Text = display.Columns.Action;
        _hdrEntity.Text = display.Columns.Entity;
        _hdrDetail.Text = display.Columns.Detail;
        _hdrTrace.Text = display.Columns.Trace;
        _hdrSuccess.Text = display.Columns.Success;

        _loadingPanel.Visibility = Show(display.ShowLoading);
        _loadingText.Value = display.LoadingText;

        _errorState.Visibility = Show(display.ShowError);
        _errorState.Message = display.ErrorText;
        _errorState.ActionText = display.RetryLabel;

        _emptyState.Visibility = Show(display.ShowEmpty);
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;

        _rowsPanel.Visibility = Show(display.ShowRows);
        RebuildRows(display);

        _suppressEvents = false;
    }

    private void RebuildRows(AuditLogDisplay display)
    {
        _rowsPanel.Children.Clear();
        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _rowsPanel.Children.Add(BuildRow(row));
        }
    }

    private StackPanel BuildRow(AuditRowDisplay row)
    {
        var grid = NewRowGrid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ExpandCol) });

        var timestamp = new StackPanel { Spacing = 0 };
        timestamp.Children.Add(new TextBlock
        {
            Text = row.Timestamp,
            FontSize = 12,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        timestamp.Children.Add(new Caption { Value = row.Relative });
        AddCell(grid, 0, timestamp);

        AddCell(grid, 1, ValueText(row.Actor, "TsColorTextPrimaryBrush"));

        if (row.ShowCategory)
        {
            AddCell(grid, 2, new TsBadge { Status = StatusKind.Neutral, Content = row.Category, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center });
        }
        else
        {
            AddCell(grid, 2, ValueText(AuditLogProjection.EmDash, "TsColorTextMutedBrush"));
        }

        var action = ValueText(row.Action, "TsColorTextPrimaryBrush");
        action.FontWeight = FontWeights.SemiBold;
        AddCell(grid, 3, action);

        var entity = new StackPanel { Spacing = 0 };
        entity.Children.Add(new TextBlock
        {
            Text = row.EntityType,
            FontSize = 13,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextTrimming = TextTrimming.CharacterEllipsis,
        });
        if (row.ShowEntityId)
        {
            entity.Children.Add(new Caption { Value = row.EntityId });
        }

        AddCell(grid, 4, entity);

        AddCell(grid, 5, new TextBlock
        {
            Text = row.Detail,
            FontSize = 13,
            Foreground = Brush("TsColorTextSecondaryBrush"),
            TextWrapping = TextWrapping.Wrap,
            MaxLines = 2,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AddCell(grid, 6, row.ShowTrace ? BuildTraceCell(row.TraceShort, row.TraceId) : ValueText(AuditLogProjection.EmDash, "TsColorTextMutedBrush"));

        AddCell(grid, 7, new TsBadge
        {
            Status = row.SuccessVariant,
            Content = row.SuccessText,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var expand = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, Text = row.ExpandLabel, VerticalAlignment = VerticalAlignment.Center };
        long id = row.Id;
        expand.Click += (_, _) => _viewModel.ToggleExpanded(id);
        AddCell(grid, 8, expand);

        AutomationProperties.SetName(grid, row.AutomationName);

        var container = new StackPanel { Spacing = 8 };
        container.Children.Add(new Border
        {
            Child = grid,
            BorderBrush = Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Padding = new Thickness(12, 8, 12, 8),
        });

        if (row.IsExpanded)
        {
            container.Children.Add(BuildExpandedDetail(row.Expanded));
        }

        return container;
    }

    private StackPanel BuildTraceCell(string shortTrace, string traceId)
    {
        var panel = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 4,
            VerticalAlignment = VerticalAlignment.Center,
        };
        panel.Children.Add(new TextBlock
        {
            Text = shortTrace,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = Brush("TsColorTextSecondaryBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        panel.Children.Add(NewCopyButton(traceId));
        return panel;
    }

    private TsGlassPanel BuildExpandedDetail(AuditExpandedDisplay detail)
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 12, Padding = new Thickness(16) };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        int row = 0;
        AddDetailField(grid, 0, row, detail.IpLabel, MonoValue(detail.IpValue));
        AddDetailField(grid, 1, row, detail.UserAgentLabel, WrapValue(detail.UserAgentValue));
        row++;

        if (detail.ShowTrace)
        {
            AddDetailSpan(grid, row, detail.TraceLabel, BuildCopyableValue(detail.TraceValue));
            row++;
        }

        if (detail.ShowBefore)
        {
            AddDetailField(grid, 0, row, detail.BeforeLabel, BuildCodeBlock(detail.BeforeJson));
        }

        if (detail.ShowAfter)
        {
            AddDetailField(grid, 1, row, detail.AfterLabel, BuildCodeBlock(detail.AfterJson));
        }

        if (detail.ShowBefore || detail.ShowAfter)
        {
            row++;
        }

        if (detail.ShowHash)
        {
            AddDetailSpan(grid, row, detail.HashLabel, BuildCopyableValue(detail.HashValue));
        }

        return new TsGlassPanel { Content = new Border { Padding = new Thickness(8), Child = grid } };
    }

    private static void AddDetailField(Grid grid, int column, int row, string label, FrameworkElement value)
    {
        EnsureRow(grid, row);
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(new Label { Value = label });
        cell.Children.Add(value);
        Grid.SetColumn(cell, column);
        Grid.SetRow(cell, row);
        grid.Children.Add(cell);
    }

    private static void AddDetailSpan(Grid grid, int row, string label, FrameworkElement value)
    {
        EnsureRow(grid, row);
        var cell = new StackPanel { Spacing = 4 };
        cell.Children.Add(new Label { Value = label });
        cell.Children.Add(value);
        Grid.SetColumn(cell, 0);
        Grid.SetColumnSpan(cell, 2);
        Grid.SetRow(cell, row);
        grid.Children.Add(cell);
    }

    private static void EnsureRow(Grid grid, int row)
    {
        while (grid.RowDefinitions.Count <= row)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        }
    }

    private StackPanel BuildCopyableValue(string value)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        panel.Children.Add(new TextBlock
        {
            Text = value,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
            VerticalAlignment = VerticalAlignment.Center,
        });
        panel.Children.Add(NewCopyButton(value));
        return panel;
    }

    private TsCopyButton NewCopyButton(string value)
    {
        var button = new TsCopyButton
        {
            ValueToCopy = value,
            CopyLabel = _copyLabel,
            Size = ControlSize.Small,
            IconGlyph = "\uE8C8", // Copy
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _copyLabel);
        return button;
    }

    private static TextBlock MonoValue(string value) => new()
    {
        Text = value,
        FontFamily = MonoFont,
        FontSize = 13,
        Foreground = Brush("TsColorTextPrimaryBrush"),
        TextWrapping = TextWrapping.Wrap,
        IsTextSelectionEnabled = true,
    };

    private static TextBlock WrapValue(string value) => new()
    {
        Text = value,
        FontSize = 13,
        Foreground = Brush("TsColorTextPrimaryBrush"),
        TextWrapping = TextWrapping.Wrap,
        IsTextSelectionEnabled = true,
    };

    private static Border BuildCodeBlock(string json)
    {
        var code = new TextBlock
        {
            Text = json,
            FontFamily = MonoFont,
            FontSize = 12,
            Foreground = Brush("TsColorTextPrimaryBrush"),
            TextWrapping = TextWrapping.Wrap,
            IsTextSelectionEnabled = true,
        };

        return new Border
        {
            Padding = new Thickness(12),
            CornerRadius = new CornerRadius(6),
            Background = Brush("TsColorSurfaceOverlayBrush") ?? Brush("TsColorSurfaceBrush"),
            Child = new ScrollViewer
            {
                Content = code,
                MaxHeight = 256,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollMode = ScrollMode.Auto,
            },
        };
    }

    private static TextBlock ValueText(string text, string brushKey) => new()
    {
        Text = text,
        FontSize = 13,
        Foreground = Brush(brushKey),
        VerticalAlignment = VerticalAlignment.Center,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnVerifyClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.VerifyChainAsync());

    private void OnResetClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.ResetFiltersAsync());

    private void OnSearchClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.ApplyFiltersAsync());

    private void OnPreviousClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.PreviousPageAsync());

    private void OnNextClick(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.NextPageAsync());

    private void OnCategoryChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_suppressEvents && _categorySelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetCategoryAsync(value));
        }
    }

    private void OnActionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_suppressEvents && _actionSelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetActionAsync(value));
        }
    }

    private void OnLimitChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_suppressEvents && _limitSelect.SelectedValue is string value)
        {
            InvokeAsync(() => _viewModel.SetLimitAsync(value));
        }
    }

    private void OnActorKeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            CommitActor();
        }
    }

    private void OnActorCommitted(object sender, RoutedEventArgs e) => CommitActor();

    private void CommitActor()
    {
        if (!_suppressEvents)
        {
            InvokeAsync(() => _viewModel.SetActorAsync(_actorInput.Text ?? string.Empty));
        }
    }

    private void OnEntityKeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            CommitEntity();
        }
    }

    private void OnEntityCommitted(object sender, RoutedEventArgs e) => CommitEntity();

    private void CommitEntity()
    {
        if (!_suppressEvents)
        {
            InvokeAsync(() => _viewModel.SetEntityTypeAsync(_entityTypeInput.Text ?? string.Empty));
        }
    }

    private void OnSinceKeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            CommitSince();
        }
    }

    private void OnSinceCommitted(object sender, RoutedEventArgs e) => CommitSince();

    private void CommitSince()
    {
        if (!_suppressEvents)
        {
            InvokeAsync(() => _viewModel.SetSinceAsync(_sinceInput.Text ?? string.Empty));
        }
    }

    private void OnUntilKeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            CommitUntil();
        }
    }

    private void OnUntilCommitted(object sender, RoutedEventArgs e) => CommitUntil();

    private void CommitUntil()
    {
        if (!_suppressEvents)
        {
            InvokeAsync(() => _viewModel.SetUntilAsync(_untilInput.Text ?? string.Empty));
        }
    }

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the dashboard-widget views).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private static Grid NewRowGrid()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TsCol) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ActorCol) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(CategoryCol) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(ActionCol) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(EntityCol) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(TraceCol) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(SuccessCol) });
        return grid;
    }

    private static void AddCell(Grid grid, int column, FrameworkElement element)
    {
        Grid.SetColumn(element, column);
        grid.Children.Add(element);
    }

    private static TextBlock NewHeaderCell() => new()
    {
        FontSize = 12,
        FontWeight = FontWeights.SemiBold,
        Foreground = Brush("TsColorTextMutedBrush"),
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush brush ? brush : null;

    private static FontFamily? MonoFont =>
        Application.Current.Resources.TryGetValue("TsTypeFontFamilyMono", out var value) && value is FontFamily family ? family : null;
}
