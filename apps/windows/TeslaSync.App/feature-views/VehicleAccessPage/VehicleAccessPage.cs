using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The native WinUI 3 <c>VehicleAccessPage</c> — a parity port of the web page
/// <c>web/src/features/vehicles/pages/VehicleAccessPage.tsx</c> (route <c>/vehicles/:id/access</c>, nav name
/// <c>VehicleAccess</c>). It binds to a <see cref="VehicleAccessPageViewModel"/> and renders every web region
/// with Fluent components and design tokens: the page title + subtitle (with the vehicle name from
/// <c>useVehicle</c>), the Drivers glass panel (its header with the count badge + refresh button, then the
/// loading skeletons, the error surface, the empty state, or the drivers table with the role chips and the
/// remove affordance), and the Share Invitations glass panel (its header with the count badge + refresh + invite
/// buttons, then the loading skeletons, the error surface, the empty state, or the invitations table with the
/// status badge, creator, expiry timestamp, copy-link button and revoke affordance). The two destructive actions
/// confirm through a <see cref="TsConfirmDialog"/>. The view is a thin renderer: all branch selection, formatting
/// and i18n happen in the view-model's <see cref="VehicleAccessDisplay"/> projection. State changes are
/// marshalled onto the UI thread.
/// </summary>
public sealed partial class VehicleAccessPage : UserControl, IDisposable
{
    private const string DriversGlyph = "\uE716";       // Segoe Fluent "People" (web Users).
    private const string InvitationsGlyph = "\uE715";   // Segoe Fluent "Mail" (web Mail).
    private const string ShieldGlyph = "\uEA18";        // Segoe Fluent "Shield" (web Shield, invitations empty).
    private const string RefreshGlyph = "\uE72C";       // Segoe Fluent "Refresh" (web RefreshCw).
    private const string InviteGlyph = "\uE8FA";        // Segoe Fluent "AddFriend" (web UserPlus).
    private const string RemoveGlyph = "\uE74D";        // Segoe Fluent "Delete" (web UserMinus).
    private const string RevokeGlyph = "\uE711";        // Segoe Fluent "Cancel" (web XCircle).

    private readonly VehicleAccessPageViewModel _viewModel;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly Caption _vehicleCaption = new() { Visibility = Visibility.Collapsed };

    // GlassPanel1 — drivers.
    private readonly SectionTitle _driversTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _driversCount = new() { Status = StatusKind.Neutral, Visibility = Visibility.Collapsed, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _driversRefresh = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RefreshGlyph };
    private readonly StackPanel _driversLoadingPanel;
    private readonly TsErrorDisplay _driversErrorState = new();
    private readonly TsEmptyState _driversEmpty = new() { IconGlyph = DriversGlyph };
    private readonly Grid _driversHeaderRow = new() { Padding = new Thickness(12, 8, 12, 8), ColumnSpacing = 12 };
    private readonly StackPanel _driversRowsPanel = new() { Spacing = 0 };
    private readonly StackPanel _driversTable;

    // GlassPanel2 — share invitations.
    private readonly SectionTitle _invitationsTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _invitationsCount = new() { Status = StatusKind.Neutral, Visibility = Visibility.Collapsed, VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _invitationsRefresh = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RefreshGlyph };
    private readonly TsButton _invitationsCreate = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = InviteGlyph };
    private readonly StackPanel _invitationsLoadingPanel;
    private readonly TsErrorDisplay _invitationsErrorState = new();
    private readonly TsEmptyState _invitationsEmpty = new() { IconGlyph = ShieldGlyph };
    private readonly Grid _invitationsHeaderRow = new() { Padding = new Thickness(12, 8, 12, 8), ColumnSpacing = 12 };
    private readonly StackPanel _invitationsRowsPanel = new() { Spacing = 0 };
    private readonly StackPanel _invitationsTable;

    private DriversSectionDisplay? _driversDisplay;
    private InvitationsSectionDisplay? _invitationsDisplay;

    /// <summary>Creates the page over the default empty feed + shell localizer for a route-supplied vehicle id.</summary>
    /// <param name="vehicleId">The vehicle id from the <c>/vehicles/:id/access</c> route param.</param>
    public VehicleAccessPage(string? vehicleId)
        : this(EmptyVehicleAccessFeed.Instance, ShellLocalizer.Instance, vehicleId)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and vehicle id (used by tests / dependency injection).</summary>
    /// <param name="feed">The drivers + invitations + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The vehicle id from the route.</param>
    public VehicleAccessPage(IVehicleAccessFeed feed, ILocalizer localizer, string? vehicleId)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new VehicleAccessPageViewModel(feed, localizer, vehicleId);

        _driversLoadingPanel = BuildLoadingPanel();
        _invitationsLoadingPanel = BuildLoadingPanel();
        _driversTable = BuildTableSection(_driversHeaderRow, _driversRowsPanel);
        _invitationsTable = BuildTableSection(_invitationsHeaderRow, _invitationsRowsPanel);

        Content = BuildLayout();

        _driversRefresh.Click += OnRefreshDriversClick;
        _invitationsRefresh.Click += OnRefreshInvitationsClick;
        _invitationsCreate.Click += OnCreateInvitationClick;
        _driversErrorState.ActionInvoked += OnRetryDrivers;
        _invitationsErrorState.ActionInvoked += OnRetryInvitations;

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>VehicleAccessPage</c>).</summary>
    public static string Slug => VehicleAccessRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public VehicleAccessPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(_title);
        stack.Children.Add(_subtitle);
        stack.Children.Add(_vehicleCaption);
        stack.Children.Add(BuildDriversPanel());
        stack.Children.Add(BuildInvitationsPanel());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private TsGlassPanel BuildDriversPanel()
    {
        ApplyDriverColumns(_driversHeaderRow);

        var header = BuildSectionHeader(
            DriversGlyph,
            _driversTitle,
            _driversCount,
            new UIElement[] { _driversRefresh });

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(header);

        var content = new StackPanel { Spacing = 0 };
        content.Children.Add(_driversLoadingPanel);
        content.Children.Add(_driversErrorState);
        content.Children.Add(_driversEmpty);
        content.Children.Add(_driversTable);
        body.Children.Add(content);

        return new TsGlassPanel { Padding = new Thickness(24), Content = body };
    }

    private TsGlassPanel BuildInvitationsPanel()
    {
        ApplyInvitationColumns(_invitationsHeaderRow);

        var header = BuildSectionHeader(
            InvitationsGlyph,
            _invitationsTitle,
            _invitationsCount,
            new UIElement[] { _invitationsRefresh, _invitationsCreate });

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(header);

        var content = new StackPanel { Spacing = 0 };
        content.Children.Add(_invitationsLoadingPanel);
        content.Children.Add(_invitationsErrorState);
        content.Children.Add(_invitationsEmpty);
        content.Children.Add(_invitationsTable);
        body.Children.Add(content);

        return new TsGlassPanel { Padding = new Thickness(24), Content = body };
    }

    private static Grid BuildSectionHeader(string glyph, SectionTitle title, TsBadge count, IReadOnlyList<UIElement> actions)
    {
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        left.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 18,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Center,
        });
        left.Children.Add(title);
        left.Children.Add(count);
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        foreach (var action in actions)
        {
            right.Children.Add(action);
        }

        Grid.SetColumn(right, 1);
        grid.Children.Add(right);
        return grid;
    }

    private static StackPanel BuildTableSection(Grid header, StackPanel rows)
    {
        var section = new StackPanel { Spacing = 0 };
        section.Children.Add(header);
        section.Children.Add(rows);
        return section;
    }

    private static StackPanel BuildLoadingPanel()
    {
        var panel = new StackPanel { Spacing = 8, Padding = new Thickness(0, 8, 0, 8) };
        for (int i = 0; i < 3; i++)
        {
            panel.Children.Add(new TsSkeleton { BlockHeight = 40, HorizontalAlignment = HorizontalAlignment.Stretch });
        }

        return panel;
    }

    private static void ApplyDriverColumns(Grid grid)
    {
        grid.ColumnDefinitions.Clear();
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Name
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Email
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(140) });                  // Role
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) });                   // Action
    }

    private static void ApplyInvitationColumns(Grid grid)
    {
        grid.ColumnDefinitions.Clear();
        grid.ColumnSpacing = 12;
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });                  // Status
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) }); // Created By
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(190) });                  // Expires
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(64) });                   // Link
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(56) });                   // Action
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + hosted surfaces (idempotent; CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _driversRefresh.Click -= OnRefreshDriversClick;
        _invitationsRefresh.Click -= OnRefreshInvitationsClick;
        _invitationsCreate.Click -= OnCreateInvitationClick;
        _driversErrorState.ActionInvoked -= OnRetryDrivers;
        _invitationsErrorState.ActionInvoked -= OnRetryInvitations;
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

    private void Render(VehicleAccessDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        RenderVehicleName();
        RenderDrivers(display.Drivers);
        RenderInvitations(display.Invitations);
    }

    private void RenderVehicleName()
    {
        string? name = _viewModel.VehicleName;
        bool hasName = !string.IsNullOrEmpty(name);
        _vehicleCaption.Value = hasName ? name! : string.Empty;
        _vehicleCaption.Visibility = hasName ? Visibility.Visible : Visibility.Collapsed;
    }

    private void RenderDrivers(DriversSectionDisplay display)
    {
        _driversDisplay = display;

        _driversTitle.Value = display.Title;
        _driversCount.Content = display.Count.ToString(CultureInfo.CurrentCulture);
        _driversCount.Visibility = Show(display.ShowCount);

        _driversRefresh.Text = display.RefreshLabel;
        _driversRefresh.IsLoading = display.Refreshing;
        AutomationProperties.SetName(_driversRefresh, display.RefreshAriaLabel);
        ToolTipService.SetToolTip(_driversRefresh, display.RefreshAriaLabel);

        _driversLoadingPanel.Visibility = Show(display.ShowLoading);

        _driversErrorState.Visibility = Show(display.ShowError);
        _driversErrorState.Title = display.ErrorText;
        _driversErrorState.ActionText = display.RetryLabel;

        _driversEmpty.Visibility = Show(display.ShowEmpty);
        _driversEmpty.Message = display.EmptyMessage;

        _driversTable.Visibility = Show(display.ShowRows);
        RebuildDriverHeader(display.Columns);
        RebuildDriverRows(display);
    }

    private void RenderInvitations(InvitationsSectionDisplay display)
    {
        _invitationsDisplay = display;

        _invitationsTitle.Value = display.Title;
        _invitationsCount.Content = display.Count.ToString(CultureInfo.CurrentCulture);
        _invitationsCount.Visibility = Show(display.ShowCount);

        _invitationsRefresh.Text = display.RefreshLabel;
        _invitationsRefresh.IsLoading = display.Refreshing;
        AutomationProperties.SetName(_invitationsRefresh, display.RefreshAriaLabel);
        ToolTipService.SetToolTip(_invitationsRefresh, display.RefreshAriaLabel);

        _invitationsCreate.Text = display.CreateLabel;
        _invitationsCreate.IsLoading = display.Creating;
        AutomationProperties.SetName(_invitationsCreate, display.CreateAriaLabel);
        ToolTipService.SetToolTip(_invitationsCreate, display.CreateAriaLabel);

        _invitationsLoadingPanel.Visibility = Show(display.ShowLoading);

        _invitationsErrorState.Visibility = Show(display.ShowError);
        _invitationsErrorState.Title = display.ErrorText;
        _invitationsErrorState.ActionText = display.RetryLabel;

        _invitationsEmpty.Visibility = Show(display.ShowEmpty);
        _invitationsEmpty.Message = display.EmptyMessage;

        _invitationsTable.Visibility = Show(display.ShowRows);
        RebuildInvitationHeader(display.Columns);
        RebuildInvitationRows(display);
    }

    private void RebuildDriverHeader(DriversColumnLabels columns)
    {
        _driversHeaderRow.Children.Clear();
        ApplyDriverColumns(_driversHeaderRow);
        AddHeaderCell(_driversHeaderRow, columns.Name, 0);
        AddHeaderCell(_driversHeaderRow, columns.Email, 1);
        AddHeaderCell(_driversHeaderRow, columns.Role, 2);
    }

    private void RebuildInvitationHeader(InvitationsColumnLabels columns)
    {
        _invitationsHeaderRow.Children.Clear();
        ApplyInvitationColumns(_invitationsHeaderRow);
        AddHeaderCell(_invitationsHeaderRow, columns.Status, 0);
        AddHeaderCell(_invitationsHeaderRow, columns.CreatedBy, 1);
        AddHeaderCell(_invitationsHeaderRow, columns.Expires, 2);
        AddHeaderCell(_invitationsHeaderRow, columns.Link, 3);
    }

    private static void AddHeaderCell(Grid grid, string text, int column)
    {
        var label = new Label { Value = text, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(label, column);
        grid.Children.Add(label);
    }

    private void RebuildDriverRows(DriversSectionDisplay display)
    {
        _driversRowsPanel.Children.Clear();
        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _driversRowsPanel.Children.Add(BuildDriverRow(row));
        }
    }

    private void RebuildInvitationRows(InvitationsSectionDisplay display)
    {
        _invitationsRowsPanel.Children.Clear();
        if (!display.ShowRows)
        {
            return;
        }

        foreach (var row in display.Rows)
        {
            _invitationsRowsPanel.Children.Add(BuildInvitationRow(row, display.CopiedLabel));
        }
    }

    private Border BuildDriverRow(DriverRow row)
    {
        var grid = new Grid { Padding = new Thickness(12, 8, 12, 8), VerticalAlignment = VerticalAlignment.Center };
        ApplyDriverColumns(grid);

        var name = PrimaryCell(row.Name);
        Grid.SetColumn(name, 0);
        grid.Children.Add(name);

        var email = SecondaryCell(row.Email);
        Grid.SetColumn(email, 1);
        grid.Children.Add(email);

        FrameworkElement roleCell = row.HasRole
            ? new TsBadge { Status = StatusKind.Info, Content = row.Role, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Left }
            : MutedCell(VehicleAccessProjection.EmDash);
        Grid.SetColumn(roleCell, 2);
        grid.Children.Add(roleCell);

        if (row.CanRemove)
        {
            long shareUserId = row.ShareUserId;
            var remove = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                IconGlyph = RemoveGlyph,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            AutomationProperties.SetName(remove, row.RemoveLabel);
            ToolTipService.SetToolTip(remove, row.RemoveLabel);
            remove.Click += async (_, _) => await ConfirmRemoveDriverAsync(shareUserId).ConfigureAwait(true);
            Grid.SetColumn(remove, 3);
            grid.Children.Add(remove);
        }

        return RowBorder(grid, row.AutomationName);
    }

    private Border BuildInvitationRow(InvitationRow row, string copiedLabel)
    {
        var grid = new Grid { Padding = new Thickness(12, 8, 12, 8), VerticalAlignment = VerticalAlignment.Center };
        ApplyInvitationColumns(grid);

        var status = new TsStatusBadge
        {
            Status = row.StatusWord,
            AccentBrushKey = row.StatusAccentBrushKey,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        Grid.SetColumn(status, 0);
        grid.Children.Add(status);

        var createdBy = SecondaryCell(row.CreatedBy);
        Grid.SetColumn(createdBy, 1);
        grid.Children.Add(createdBy);

        var expires = new TsDateTime { Value = row.ExpiresAt, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(expires, 2);
        grid.Children.Add(expires);

        if (row.HasLink)
        {
            var copy = new TsCopyButton
            {
                ValueToCopy = row.InviteUrl,
                CopiedLabel = copiedLabel,
                Size = ControlSize.Small,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Left,
            };
            AutomationProperties.SetName(copy, row.CopyLinkLabel);
            ToolTipService.SetToolTip(copy, row.CopyLinkLabel);
            Grid.SetColumn(copy, 3);
            grid.Children.Add(copy);
        }
        else
        {
            var dash = MutedCell(VehicleAccessProjection.EmDash);
            Grid.SetColumn(dash, 3);
            grid.Children.Add(dash);
        }

        if (row.CanRevoke)
        {
            string invitationId = row.InvitationId;
            var revoke = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                IconGlyph = RevokeGlyph,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
            };
            AutomationProperties.SetName(revoke, row.RevokeLabel);
            ToolTipService.SetToolTip(revoke, row.RevokeLabel);
            revoke.Click += async (_, _) => await ConfirmRevokeInvitationAsync(invitationId).ConfigureAwait(true);
            Grid.SetColumn(revoke, 4);
            grid.Children.Add(revoke);
        }

        return RowBorder(grid, row.AutomationName);
    }

    private async Task ConfirmRemoveDriverAsync(long shareUserId)
    {
        var display = _driversDisplay;
        if (display is null)
        {
            return;
        }

        var dialog = new TsConfirmDialog
        {
            Title = display.RemoveTitle,
            Content = display.RemoveMessage,
            PrimaryButtonText = display.RemoveConfirm,
            CloseButtonText = display.CancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await _viewModel.RemoveDriverAsync(shareUserId).ConfigureAwait(true);
        }
    }

    private async Task ConfirmRevokeInvitationAsync(string invitationId)
    {
        var display = _invitationsDisplay;
        if (display is null)
        {
            return;
        }

        var dialog = new TsConfirmDialog
        {
            Title = display.RevokeTitle,
            Content = display.RevokeMessage,
            PrimaryButtonText = display.RevokeConfirm,
            CloseButtonText = display.CancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };

        if (await dialog.ShowAsync() == ContentDialogResult.Primary)
        {
            await _viewModel.RevokeInvitationAsync(invitationId).ConfigureAwait(true);
        }
    }

    private void OnRefreshDriversClick(object sender, RoutedEventArgs e) =>
        InvokeAsync(() => _viewModel.RefreshDriversAsync());

    private void OnRefreshInvitationsClick(object sender, RoutedEventArgs e) =>
        InvokeAsync(() => _viewModel.RefreshInvitationsAsync());

    private void OnCreateInvitationClick(object sender, RoutedEventArgs e) =>
        InvokeAsync(() => _viewModel.CreateInvitationAsync());

    private void OnRetryDrivers(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RetryDriversAsync());

    private void OnRetryInvitations(object? sender, EventArgs e) =>
        InvokeAsync(() => _viewModel.RetryInvitationsAsync());

    private static Text PrimaryCell(string text) => new()
    {
        Value = text,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static TextBlock SecondaryCell(string text) => new()
    {
        Text = text,
        Foreground = DisplayTokens.TextSecondary,
        VerticalAlignment = VerticalAlignment.Center,
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    private static TextBlock MutedCell(string text) => new()
    {
        Text = text,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private static Border RowBorder(Grid grid, string automationName)
    {
        var border = new Border
        {
            Child = grid,
            BorderThickness = new Thickness(0, 0, 0, 1),
            BorderBrush = DisplayTokens.Border,
        };
        AutomationProperties.SetName(border, automationName);
        return border;
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}
