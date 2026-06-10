using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 notification-inbox surface — a parity port of
/// web/src/features/notifications/components/InboxBody.tsx. It composes the glass inbox panel the web source
/// owns: a header with the select-all checkbox (flat view), the live "{n} notifications" count, the
/// grouped / flat view toggle (inbox tab) and the mark-all-read action; a bulk-selection toolbar that
/// surfaces the tab-specific actions (mark read + archive on the inbox, restore on the archive, delete on
/// both) with a delete confirmation; and a body that renders exactly one of the skeleton, the retriable
/// error surface, the friendly empty state, the day-grouped flat list, or the threaded grouped list — each
/// row carrying a context menu (mark read / unread, archive / restore, view context, delete). All data flows
/// through the shared <see cref="InboxBodyViewModel"/>; the view never performs HTTP. Every string resolves
/// through the i18n facade and every interactive element carries a Narrator name. The sibling
/// notification-filter bar and AI auto-categorisation panel are composed separately (their own surfaces); the
/// filter state they drive lives on the view-model.
/// </summary>
public sealed partial class InboxBody : ContentControl, IDisposable
{
    private const double RowTitleFontSize = 14;
    private const double RowMessageFontSize = 13;
    private const double MetaFontSize = 12;
    private const double DayHeaderFontSize = 11;

    private readonly InboxBodyViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly InboxBodyDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _panelStack = new() { Spacing = 8 };
    private readonly Grid _header = new();
    private readonly StackPanel _titleRow = new() { Orientation = Orientation.Horizontal, Spacing = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsCheckbox _selectAll = new();
    private readonly TextBlock _countText = new() { VerticalAlignment = VerticalAlignment.Center, FontSize = MetaFontSize, Foreground = DisplayTokens.TextMuted };
    private readonly StackPanel _actions = new() { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Right };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Border _viewToggle = new();
    private readonly TsButton _groupedButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _flatButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _markAllRead = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = InboxBodyRegistration.MarkAllReadGlyph };
    private readonly Border _bulkBar = new() { Visibility = Visibility.Collapsed, Margin = new Thickness(0, 0, 0, 4) };
    private readonly ContentControl _bodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };

    private bool _started;
    private bool _renderQueued;
    private bool _suppressSelectAll;
    private bool _disposed;

    /// <summary>Creates the surface over its read source, command port, localizer, tab and diagnostics.</summary>
    /// <param name="source">The cache-then-network inbox read source.</param>
    /// <param name="commands">The inbox mutation command port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="archived">Whether this is the archive tab (web <c>archived</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">Injectable clock so the relative-time / day tiers are deterministic in tests.</param>
    public InboxBody(
        IInboxSource source,
        IInboxCommands commands,
        ILocalizer localizer,
        bool archived,
        InboxBodyDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new InboxBodyDiagnostics();
        _viewModel = new InboxBodyViewModel(source, commands, localizer, archived, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, SurfaceName());

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>Raised when the empty-state CTA is invoked — the host navigates to the alert-rule studio.</summary>
    public event EventHandler? ConfigureAlertRulesRequested;

    /// <summary>Raised when a row's "View context" command is invoked — the host navigates to the drill-through.</summary>
    public event EventHandler<long>? ViewContextRequested;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>InboxBody</c>).</summary>
    public static string Slug => InboxBodyRegistration.Slug;

    /// <summary>The backing state holder (exposed so a host filter bar can drive the shared filter state).</summary>
    public InboxBodyViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="InboxSource"/> + <see cref="InboxCommands"/>
    /// from the shared data layer. Neither notification endpoint is vehicle-scoped, so no vehicle source is
    /// required.
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="archived">Whether this is the archive tab.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    public static InboxBody Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        bool archived,
        InboxBodyDiagnostics? diagnostics = null)
    {
        var source = new InboxSource(api, engine, options);
        var commands = new InboxCommands(api);
        return new InboxBody(source, commands, localizer, archived, diagnostics);
    }

    private void BuildChrome()
    {
        AutomationProperties.SetName(_selectAll, _localizer.GetString(InboxBodyProjection.SelectAllKey, "Select all visible"));
        _selectAll.Checked += OnSelectAllToggled;
        _selectAll.Unchecked += OnSelectAllToggled;

        _titleRow.Children.Add(_selectAll);
        _titleRow.Children.Add(_countText);

        _groupedButton.Text = _localizer.GetString(InboxBodyProjection.GroupedKey, "Grouped");
        _groupedButton.IconGlyph = InboxBodyRegistration.GroupedGlyph;
        _groupedButton.Click += (_, _) => _ = _viewModel.SetViewAsync(InboxView.Grouped);
        _flatButton.Text = _localizer.GetString(InboxBodyProjection.FlatKey, "Flat");
        _flatButton.IconGlyph = InboxBodyRegistration.FlatGlyph;
        _flatButton.Click += (_, _) => _ = _viewModel.SetViewAsync(InboxView.Flat);

        var toggleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        toggleRow.Children.Add(_groupedButton);
        toggleRow.Children.Add(_flatButton);
        _viewToggle.Child = toggleRow;
        _viewToggle.CornerRadius = new CornerRadius(8);
        _viewToggle.BorderBrush = DisplayTokens.Border;
        _viewToggle.BorderThickness = new Thickness(1);
        _viewToggle.Padding = new Thickness(2);
        AutomationProperties.SetName(_viewToggle, _localizer.GetString(InboxBodyProjection.ViewLabelKey, "View"));

        _markAllRead.Text = _localizer.GetString(InboxBodyProjection.MarkAllReadKey, "Mark all read");
        AutomationProperties.SetName(_markAllRead, _markAllRead.Text);
        _markAllRead.Click += (_, _) => _ = _viewModel.MarkAllReadAsync();

        _actions.Children.Add(_freshness);
        _actions.Children.Add(_viewToggle);
        _actions.Children.Add(_markAllRead);

        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _header.Padding = new Thickness(4, 0, 4, 8);
        _header.BorderBrush = DisplayTokens.Border;
        _header.BorderThickness = new Thickness(0, 0, 0, 1);
        Grid.SetColumn(_titleRow, 0);
        Grid.SetColumn(_actions, 1);
        _header.Children.Add(_titleRow);
        _header.Children.Add(_actions);

        _panelStack.Children.Add(_header);
        _panelStack.Children.Add(_bulkBar);
        _panelStack.Children.Add(_bodyHost);

        var panel = new TsGlassPanel
        {
            Padding = new Thickness(16),
            Content = _panelStack,
        };
        AutomationProperties.SetName(panel, SurfaceName());

        Content = new TsFadeIn { Content = panel };
    }

    private string SurfaceName() => _viewModel.Archived
        ? _localizer.GetString(InboxBodyProjection.EmptyArchivedTitleKey, "No archived notifications")
        : _localizer.GetString("notifications.inbox.title", "Inbox");

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        InboxBodyDisplay display = _viewModel.Display;

        UpdateHeader(display);
        UpdateBulkBar(display);
        _bodyHost.Content = BuildBody(display);
        AutomationProperties.SetName(this, display.AutomationName);
    }

    private void UpdateHeader(InboxBodyDisplay display)
    {
        // Web parity: the select-all checkbox is shown only in the flat list (grouped rows are not row-selectable).
        _selectAll.Visibility = display.IsGrouped ? Visibility.Collapsed : Visibility.Visible;
        _suppressSelectAll = true;
        _selectAll.IsChecked = display.AllVisibleSelected;
        _suppressSelectAll = false;

        _countText.Text = display.CountLabel;

        // Web parity: the view toggle lives on the inbox tab only (the archive is always row-by-row, flat).
        _viewToggle.Visibility = display.Archived ? Visibility.Collapsed : Visibility.Visible;
        StyleToggle(_groupedButton, display.IsGrouped);
        StyleToggle(_flatButton, !display.IsGrouped);

        // Web parity: mark-all-read shows on the inbox flat view only when there is something unread.
        _markAllRead.Visibility = !display.Archived && !display.IsGrouped && display.UnreadCount > 0
            ? Visibility.Visible
            : Visibility.Collapsed;

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
    }

    private static void StyleToggle(TsButton button, bool active)
    {
        button.Variant = active ? ButtonVariant.Primary : ButtonVariant.Subtle;
        AutomationProperties.SetName(button, button.Text);
    }

    private void UpdateBulkBar(InboxBodyDisplay display)
    {
        if (display.SelectedCount == 0)
        {
            _bulkBar.Visibility = Visibility.Collapsed;
            _bulkBar.Child = null;
            return;
        }

        _bulkBar.Visibility = Visibility.Visible;
        _bulkBar.Background = DisplayTokens.Surface;
        _bulkBar.BorderBrush = DisplayTokens.Border;
        _bulkBar.BorderThickness = new Thickness(1);
        _bulkBar.CornerRadius = new CornerRadius(10);
        _bulkBar.Padding = new Thickness(10, 6, 10, 6);

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };

        string noun = display.SelectedCount == 1 ? display.ItemNounSingular : display.ItemNounPlural;
        row.Children.Add(new TextBlock
        {
            Text = $"{display.SelectedCount} {noun}",
            FontSize = MetaFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var clear = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = "\uE711",
        };
        AutomationProperties.SetName(clear, _localizer.GetString("bulk.clearSelection", "Clear selection"));
        clear.Click += (_, _) => _viewModel.ClearSelection();
        row.Children.Add(clear);

        foreach (InboxBulkActionItem action in display.BulkActions)
        {
            row.Children.Add(BuildBulkButton(action));
        }

        _bulkBar.Child = row;
        AutomationProperties.SetName(_bulkBar, $"{display.SelectedCount} {noun}");
    }

    private TsButton BuildBulkButton(InboxBulkActionItem action)
    {
        var button = new TsButton
        {
            Variant = action.Destructive ? ButtonVariant.Destructive : ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = action.Label,
            IconGlyph = action.Glyph,
        };
        AutomationProperties.SetName(button, action.Label);
        button.Click += (_, _) => _ = InvokeBulkAsync(action);
        return button;
    }

    private async Task InvokeBulkAsync(InboxBulkActionItem action)
    {
        if (action.Destructive && action.ConfirmTitle is { } title)
        {
            bool confirmed = await ConfirmAsync(title, action.ConfirmBody, action.ConfirmLabel).ConfigureAwait(true);
            if (!confirmed)
            {
                return;
            }
        }

        await _viewModel.InvokeBulkActionAsync(action.Action).ConfigureAwait(true);
    }

    private UIElement BuildBody(InboxBodyDisplay display) => _viewModel.State switch
    {
        InboxBodyState.Loading => BuildSkeleton(),
        InboxBodyState.Error => BuildError(),
        InboxBodyState.Empty => BuildEmpty(display),
        _ => display.HasContent ? BuildContent(display) : BuildEmpty(display),
    };

    private StackPanel BuildSkeleton()
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(0, 8, 0, 0) };
        for (int i = 0; i < 5; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 56, Radius = 12 });
        }

        AutomationProperties.SetName(column, _localizer.GetString("notifications.inbox.loading", "Loading notifications"));
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _localizer.GetString(InboxBodyProjection.GroupEmptyTitleKey, "Could not load notifications"),
            ActionText = _localizer.GetString("common.retry", "Retry"),
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();
        return error;
    }

    private TsEmptyState BuildEmpty(InboxBodyDisplay display)
    {
        var empty = new TsEmptyState
        {
            IconGlyph = InboxBodyRegistration.BellGlyph,
            Title = display.EmptyTitle,
            Message = display.EmptyMessage,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (display.EmptyCtaLabel is { } cta)
        {
            empty.ActionText = cta;
            empty.ActionInvoked += (_, _) => ConfigureAlertRulesRequested?.Invoke(this, EventArgs.Empty);
        }

        return empty;
    }

    private StackPanel BuildContent(InboxBodyDisplay display) =>
        display.IsGrouped ? BuildGroupedList(display) : BuildFlatList(display);

    private StackPanel BuildFlatList(InboxBodyDisplay display)
    {
        var column = new StackPanel { Spacing = 16, Padding = new Thickness(0, 8, 0, 0) };
        foreach (InboxDayGroup day in display.Days)
        {
            var section = new StackPanel { Spacing = 4 };
            section.Children.Add(new TextBlock
            {
                Text = day.DayLabel.ToUpper(System.Globalization.CultureInfo.CurrentCulture),
                FontSize = DayHeaderFontSize,
                FontWeight = FontWeights.SemiBold,
                CharacterSpacing = 80,
                Foreground = DisplayTokens.TextMuted,
                Margin = new Thickness(2, 0, 0, 2),
            });

            var rows = new StackPanel { Spacing = 4 };
            foreach (InboxRowDisplay row in day.Rows)
            {
                rows.Children.Add(BuildRowCard(row));
            }

            section.Children.Add(rows);
            column.Children.Add(section);
        }

        return column;
    }

    private StackPanel BuildGroupedList(InboxBodyDisplay display)
    {
        var column = new StackPanel { Spacing = 6, Padding = new Thickness(0, 8, 0, 0) };
        foreach (InboxGroupRowDisplay group in display.Groups)
        {
            column.Children.Add(BuildGroupCard(group));
        }

        return column;
    }

    private Border BuildRowCard(InboxRowDisplay row)
    {
        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var checkbox = new TsCheckbox { IsChecked = row.Selected, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(checkbox, row.Title);
        checkbox.Checked += (_, _) => _viewModel.ToggleSelection(row.Id, true);
        checkbox.Unchecked += (_, _) => _viewModel.ToggleSelection(row.Id, false);
        Grid.SetColumn(checkbox, 0);
        grid.Children.Add(checkbox);

        grid.Children.Add(PlaceUnreadDot(row.IsRead, 1));

        var content = BuildRowContent(row.Title, row.Message, row.SeverityLabel, row.SeverityStatus, row.TimeText, row.IsRead);
        Grid.SetColumn(content, 2);
        grid.Children.Add(content);

        var overflow = BuildOverflowButton(row.ContextMenu, row.Id);
        Grid.SetColumn(overflow, 3);
        grid.Children.Add(overflow);

        return WrapRow(grid, row.AutomationName, row.ContextMenu, row.Id, row.IsRead);
    }

    private Border BuildGroupCard(InboxGroupRowDisplay group)
    {
        var grid = new Grid { ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        grid.Children.Add(PlaceUnreadDot(group.UnreadCount == 0, 0));

        bool unread = group.UnreadCount > 0;
        var content = BuildRowContent(group.Title, group.Message, group.SeverityLabel, group.SeverityStatus, group.TimeText, !unread);
        Grid.SetColumn(content, 1);
        grid.Children.Add(content);

        var count = new TsBadge
        {
            Status = unread ? StatusKind.Info : StatusKind.Neutral,
            VerticalAlignment = VerticalAlignment.Center,
            Content = new TextBlock { Text = group.CountText, FontSize = MetaFontSize },
        };
        AutomationProperties.SetAccessibilityView(count, AccessibilityView.Raw);
        Grid.SetColumn(count, 2);
        grid.Children.Add(count);

        var overflow = BuildOverflowButton(group.ContextMenu, group.LatestId);
        Grid.SetColumn(overflow, 3);
        grid.Children.Add(overflow);

        return WrapRow(grid, group.AutomationName, group.ContextMenu, group.LatestId, !unread);
    }

    private static StackPanel BuildRowContent(
        string title,
        string message,
        string? severityLabel,
        StatusKind severityStatus,
        string time,
        bool isRead)
    {
        var column = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (severityLabel is { } label)
        {
            var badge = new TsBadge
            {
                Status = severityStatus,
                VerticalAlignment = VerticalAlignment.Center,
                Content = new TextBlock { Text = label, FontSize = 11 },
            };
            AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
            titleRow.Children.Add(badge);
        }

        titleRow.Children.Add(new TextBlock
        {
            Text = title,
            FontSize = RowTitleFontSize,
            FontWeight = isRead ? FontWeights.Normal : FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        });
        column.Children.Add(titleRow);

        if (!string.IsNullOrEmpty(message))
        {
            column.Children.Add(new TextBlock
            {
                Text = message,
                FontSize = RowMessageFontSize,
                Foreground = DisplayTokens.TextSecondary,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxLines = 2,
                TextWrapping = TextWrapping.Wrap,
            });
        }

        column.Children.Add(new TextBlock
        {
            Text = time,
            FontSize = MetaFontSize,
            Foreground = DisplayTokens.TextMuted,
        });

        return column;
    }

    private static FrameworkElement PlaceUnreadDot(bool isRead, int column)
    {
        FrameworkElement element = isRead
            ? new Border { Width = 8, Height = 8, Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent) }
            : new Ellipse { Width = 8, Height = 8, Fill = DisplayTokens.Accent, VerticalAlignment = VerticalAlignment.Center };

        element.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetAccessibilityView(element, AccessibilityView.Raw);
        Grid.SetColumn(element, column);
        return element;
    }

    private TsButton BuildOverflowButton(IReadOnlyList<InboxRowMenuItem> items, long id)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Icon,
            IconGlyph = "\uE712",
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _localizer.GetString("common.moreActions", "More actions"));

        MenuFlyout flyout = BuildRowMenu(items, id);
        button.Click += (_, _) => flyout.ShowAt(button);
        return button;
    }

    private Border WrapRow(UIElement content, string automationName, IReadOnlyList<InboxRowMenuItem> items, long id, bool isRead)
    {
        var card = new Border
        {
            Padding = new Thickness(12, 10, 8, 10),
            CornerRadius = new CornerRadius(10),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Child = content,
            ContextFlyout = BuildRowMenu(items, id),
        };

        AutomationProperties.SetName(card, automationName);
        AutomationProperties.SetAccessibilityView(card, AccessibilityView.Content);
        return card;
    }

    private MenuFlyout BuildRowMenu(IReadOnlyList<InboxRowMenuItem> items, long id)
    {
        var flyout = new MenuFlyout();
        foreach (InboxRowMenuItem item in items)
        {
            var menuItem = new MenuFlyoutItem
            {
                Text = item.Label,
                Icon = new FontIcon { Glyph = item.Glyph },
            };
            AutomationProperties.SetName(menuItem, item.Label);
            InboxRowAction action = item.Action;
            menuItem.Click += (_, _) => _ = InvokeRowActionAsync(action, id, item.Destructive, item.Label);
            flyout.Items.Add(menuItem);
        }

        return flyout;
    }

    private async Task InvokeRowActionAsync(InboxRowAction action, long id, bool destructive, string label)
    {
        if (action == InboxRowAction.ViewContext)
        {
            ViewContextRequested?.Invoke(this, id);
            return;
        }

        if (destructive)
        {
            bool confirmed = await ConfirmAsync(
                _localizer.GetString(InboxBodyProjection.DeleteConfirmTitleKey, "Delete notifications?"),
                _localizer.GetString(
                    InboxBodyProjection.DeleteConfirmBodyKey,
                    "These notifications will be permanently removed. Archive is usually the safer choice."),
                _localizer.GetString(InboxBodyProjection.CommonDeleteKey, "Delete")).ConfigureAwait(true);
            if (!confirmed)
            {
                return;
            }
        }

        await _viewModel.InvokeRowActionAsync(action, id).ConfigureAwait(true);
    }

    private async Task<bool> ConfirmAsync(string title, string? body, string? confirmLabel)
    {
        if (XamlRoot is null)
        {
            return true;
        }

        var dialog = new ContentDialog
        {
            Title = title,
            Content = body,
            PrimaryButtonText = confirmLabel ?? _localizer.GetString(InboxBodyProjection.CommonDeleteKey, "Delete"),
            CloseButtonText = _localizer.GetString("common.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };

        ContentDialogResult result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    private void OnSelectAllToggled(object sender, RoutedEventArgs e)
    {
        if (_suppressSelectAll)
        {
            return;
        }

        if (_selectAll.IsChecked == true)
        {
            _viewModel.SelectAllVisible();
        }
        else
        {
            _viewModel.ClearSelection();
        }
    }
}
