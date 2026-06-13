// Admin / API Keys page — WinUI 3 view.
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

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The native WinUI 3 <c>APIKeysPage</c> — a parity port of the web page
/// <c>web/src/features/admin/pages/APIKeysPage.tsx</c> (route <c>/api-keys</c>, nav name <c>APIKeys</c>). It binds
/// to an <see cref="ApiKeysPageViewModel"/> and renders every web region with Fluent components and design tokens:
/// the page header (title + subtitle + the "Create Key" action), the create modal (name + permission level, then
/// the one-time "API Key Created" reveal panel with a masked value + copy), the key list whose body switches
/// between the loading skeletons, the friendly empty surface and the per-key panels (permission badge, expired
/// badge, prefix + created/last-used metadata, and the revoke + delete actions), the retriable error surface and
/// the delete confirmation. The view is a thin renderer: all branch selection, formatting and i18n happen in the
/// view-model's <see cref="ApiKeysDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class APIKeysPage : UserControl, IDisposable
{
    private const string KeyGlyph = "\uE192";      // Permissions / key
    private const string AddGlyph = "\uE710";      // Add
    private const string RevokeGlyph = "\uE711";   // Cancel — revoke
    private const string DeleteGlyph = "\uE74D";   // Delete

    private readonly ApiKeysPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher = DispatcherQueue.GetForCurrentThread();

    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _createButton = new() { Variant = ButtonVariant.Primary, IconGlyph = AddGlyph };

    private readonly TsBadge _freshnessChip = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };

    private readonly StackPanel _loading = new() { Spacing = 12 };
    private readonly TsQueryError _errorSurface = new();
    private readonly StackPanel _listArea = new() { Spacing = 12 };
    private readonly StackPanel _keyList = new() { Spacing = 12 };
    private readonly TsEmptyState _emptyState = new() { IconGlyph = KeyGlyph };

    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the page over the inert default key source and the shell resource localizer.</summary>
    public APIKeysPage()
        : this(EmptyApiKeysSource.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit key source and a localizer (used by tests / DI hosts).</summary>
    /// <param name="source">The key data port handed to the view-model.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public APIKeysPage(IApiKeysSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new ApiKeysPageViewModel(source, localizer);

        _freshnessChip.Content = _freshnessChipText;
        _createButton.Click += OnCreateClick;
        _errorSurface.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        Content = BuildLayout();

        _viewModel.PropertyChanged += OnViewModelChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The navigation route name the shell registers this page under (<c>APIKeys</c>).</summary>
    public static string RouteName => ApiKeysRegistration.RouteName;

    /// <summary>The diagnostics surface slug (<c>APIKeysPage</c>).</summary>
    public static string Slug => ApiKeysRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public ApiKeysPageViewModel ViewModel => _viewModel;

    private ScrollViewer BuildLayout()
    {
        for (int i = 0; i < 3; i++)
        {
            _loading.Children.Add(BuildSkeletonRow());
        }

        LiveRegion.Configure(_loading);

        _listArea.Children.Add(_keyList);
        _listArea.Children.Add(_emptyState);

        var stack = new StackPanel { Spacing = 24, Padding = new Thickness(24) };
        stack.Children.Add(_toast);
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loading);
        stack.Children.Add(_errorSurface);
        stack.Children.Add(_listArea);

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_freshnessChip);
        actions.Children.Add(_createButton);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        return grid;
    }

    private static TsGlassPanel BuildSkeletonRow()
    {
        var stack = new StackPanel { Spacing = 10 };
        stack.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 220 });
        stack.Children.Add(new TsSkeleton { BlockHeight = 12, BlockWidth = 320 });
        return new TsGlassPanel { Padding = new Thickness(16), Content = stack };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model (CA1001; mirrors the other feature-view pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _viewModel.ToastRequested -= OnToastRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnCreateClick(object sender, RoutedEventArgs e) => _ = OpenCreateModalAsync();

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnToastRequested(object? sender, ApiKeysToast toast) =>
        Marshal(() =>
        {
            _toast.Title = toast.Message;
            _toast.Message = string.Empty;
            _toast.Severity = toast.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
            _toast.IsOpen = !string.IsNullOrEmpty(toast.Message);
        });

    private void Marshal(DispatcherQueueHandler action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(action);
        }
        else
        {
            action();
        }
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
        var display = _viewModel.Display;
        var state = _viewModel.State;

        AutomationProperties.SetName(this, display.AutomationName);
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        _createButton.Text = display.CreateLabel;
        AutomationProperties.SetName(_createButton, display.CreateAutomationName);

        bool loading = state == ApiKeysState.Loading;
        bool error = state == ApiKeysState.Error;
        bool hasContent = !loading && !error;

        _loading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _errorSurface.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _listArea.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;

        RenderHeaderChip(state);

        if (error)
        {
            RenderError();
            return;
        }

        if (loading)
        {
            return;
        }

        RenderList(display);
    }

    private void RenderHeaderChip(ApiKeysState state)
    {
        bool stale = state == ApiKeysState.Stale;
        bool offline = state == ApiKeysState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString("apiKeys.offlineChip", "Offline")
                : _localizer.GetString("apiKeys.staleChip", "Stale");
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = text;
            AutomationProperties.SetName(_freshnessChip, text);
            _freshnessChip.Visibility = Visibility.Visible;
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }
    }

    private void RenderError()
    {
        _errorSurface.Title = _localizer.GetString("apiKeys.error.title", "Couldn't load API keys");
        _errorSurface.Message = _viewModel.ErrorMessage
            ?? _localizer.GetString("apiKeys.error.load", "Failed to load API keys");
        _errorSurface.ActionText = _localizer.GetString("common.retry", "Retry");
        _errorSurface.AttemptCount = _viewModel.Attempts;
    }

    private void RenderList(ApiKeysDisplay display)
    {
        _keyList.Children.Clear();
        foreach (var row in display.Rows)
        {
            _keyList.Children.Add(BuildRow(row));
        }

        bool hasRows = display.Rows.Count > 0;
        _keyList.Visibility = hasRows ? Visibility.Visible : Visibility.Collapsed;

        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.Visibility = hasRows ? Visibility.Collapsed : Visibility.Visible;
    }

    private TsGlassPanel BuildRow(ApiKeyRowDisplay row)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var iconBox = BuildIconBox(new FontIcon { Glyph = KeyGlyph, FontSize = 20 });
        Grid.SetColumn(iconBox, 0);
        grid.Children.Add(iconBox);

        var identity = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new PanelTitle { Value = row.Name, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(BuildPermissionBadge(row));
        if (row.IsExpired)
        {
            var expiredBadge = new TsBadge { Status = StatusKind.Danger, VerticalAlignment = VerticalAlignment.Center };
            expiredBadge.Content = new TextBlock { Text = row.ExpiredLabel, FontSize = 12 };
            AutomationProperties.SetName(expiredBadge, row.ExpiredLabel);
            titleRow.Children.Add(expiredBadge);
        }

        identity.Children.Add(titleRow);

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        meta.Children.Add(new Code { Value = row.KeyPrefix, VerticalAlignment = VerticalAlignment.Center });
        meta.Children.Add(new Caption { Value = row.CreatedText, VerticalAlignment = VerticalAlignment.Center });
        if (row.HasLastUsed)
        {
            meta.Children.Add(new Caption { Value = row.LastUsedText, VerticalAlignment = VerticalAlignment.Center });
        }

        identity.Children.Add(meta);
        Grid.SetColumn(identity, 1);
        grid.Children.Add(identity);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        if (row.CanRevoke)
        {
            var revoke = new TsButton { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = RevokeGlyph };
            AutomationProperties.SetName(revoke, row.RevokeAutomationName);
            ToolTipService.SetToolTip(revoke, row.RevokeTooltip);
            revoke.Click += (_, _) => _ = _viewModel.RevokeKeyAsync(row.Id);
            actions.Children.Add(revoke);
        }

        var delete = new TsButton { Variant = ButtonVariant.Destructive, Size = ControlSize.Small, IconGlyph = DeleteGlyph };
        AutomationProperties.SetName(delete, row.DeleteAutomationName);
        ToolTipService.SetToolTip(delete, row.DeleteTooltip);
        delete.Click += (_, _) => _ = ConfirmDeleteAsync(row);
        actions.Children.Add(delete);

        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        var panel = new TsGlassPanel { Padding = new Thickness(16), Content = grid };
        if (row.IsExpired)
        {
            panel.Opacity = 0.5;
        }

        return panel;
    }

    private static TsBadge BuildPermissionBadge(ApiKeyRowDisplay row)
    {
        var badge = new TsBadge { Status = row.PermissionStatus, VerticalAlignment = VerticalAlignment.Center };
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        content.Children.Add(new FontIcon { Glyph = row.PermissionGlyph, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        content.Children.Add(new TextBlock { Text = row.PermissionLabel, FontSize = 12, VerticalAlignment = VerticalAlignment.Center });
        badge.Content = content;
        AutomationProperties.SetName(badge, row.PermissionLabel);
        return badge;
    }

    private static Border BuildIconBox(FontIcon icon)
    {
        icon.Foreground = DisplayTokens.Brush("TsColorInfoBrush");
        icon.HorizontalAlignment = HorizontalAlignment.Center;
        icon.VerticalAlignment = VerticalAlignment.Center;

        return new Border
        {
            Width = 44,
            Height = 44,
            CornerRadius = new CornerRadius(12),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
            Child = icon,
        };
    }

    private async Task OpenCreateModalAsync()
    {
        if (XamlRoot is null)
        {
            return;
        }

        var nameInput = new TsInput
        {
            Header = _localizer.GetString("apiKeys.form.name", "Name"),
            Hint = _localizer.GetString("apiKeys.form.nameHint", "My Application"),
            Text = string.Empty,
        };
        AutomationProperties.SetName(nameInput, _localizer.GetString("apiKeys.form.name", "Name"));

        var permLabel = new Label { Value = _localizer.GetString("apiKeys.form.permissions", "Permissions") };
        var permSelect = BuildPermissionSelect();

        var permStack = new StackPanel { Spacing = 6 };
        permStack.Children.Add(permLabel);
        permStack.Children.Add(permSelect);

        var errorText = new ErrorText { Visibility = Visibility.Collapsed };

        var form = new StackPanel { Spacing = 16, MinWidth = 380 };
        form.Children.Add(nameInput);
        form.Children.Add(permStack);
        form.Children.Add(errorText);

        var dialog = new TsModal
        {
            Title = _localizer.GetString("apiKeys.modal.newTitle", "New API Key"),
            Content = form,
            PrimaryButtonText = _localizer.GetString("apiKeys.form.generate", "Generate Key"),
            CloseButtonText = _localizer.GetString("apiKeys.form.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                string name = nameInput.Text?.Trim() ?? string.Empty;
                if (string.IsNullOrEmpty(name))
                {
                    errorText.Value = _localizer.GetString("apiKeys.form.nameRequired", "Name is required.");
                    errorText.Visibility = Visibility.Visible;
                    args.Cancel = true;
                    return;
                }

                string permissions = SelectedPermission(permSelect);
                var created = await _viewModel.CreateKeyAsync(name, permissions).ConfigureAwait(true);
                if (created is null)
                {
                    errorText.Value = _localizer.GetString("apiKeys.toast.createError", "Failed to create API key");
                    errorText.Visibility = Visibility.Visible;
                    args.Cancel = true;
                    return;
                }

                // web parity: the single modal swaps in place to the one-time "API Key Created" reveal.
                args.Cancel = true;
                dialog.Title = _localizer.GetString("apiKeys.modal.createdTitle", "API Key Created");
                dialog.Content = BuildGeneratedKeyContent(created.Key);
                dialog.PrimaryButtonText = string.Empty;
                dialog.CloseButtonText = _localizer.GetString("apiKeys.created.done", "Done");
                dialog.DefaultButton = ContentDialogButton.Close;
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }

    private TsSelect BuildPermissionSelect()
    {
        var select = new TsSelect();
        AutomationProperties.SetName(select, _localizer.GetString("apiKeys.form.permissions", "Permissions"));
        AddPermissionOption(select, "read", "apiKeys.permission.read", "Read");
        AddPermissionOption(select, "read-write", "apiKeys.permission.readWrite", "Read-Write");
        AddPermissionOption(select, "admin", "apiKeys.permission.admin", "Admin");
        select.SelectedIndex = 0;
        return select;
    }

    private void AddPermissionOption(TsSelect select, string value, string key, string fallback) =>
        select.Items.Add(new ComboBoxItem
        {
            Content = _localizer.GetString(key, fallback),
            Tag = value,
        });

    private static string SelectedPermission(TsSelect select) =>
        select.SelectedItem is ComboBoxItem { Tag: string value } ? value : "read";

    private StackPanel BuildGeneratedKeyContent(string key)
    {
        var stack = new StackPanel { Spacing = 16, MinWidth = 380 };
        stack.Children.Add(new Caption
        {
            Value = _localizer.GetString("apiKeys.created.warning", "Copy this key now — it won't be shown again."),
            Foreground = DisplayTokens.TextMuted,
        });

        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var masked = new TsMaskedValue
        {
            Value = key,
            Variant = MaskVariant.Token,
            RevealLabel = _localizer.GetString("apiKeys.reveal.aria", "API key, click to reveal"),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = masked };
        Grid.SetColumn(panel, 0);
        row.Children.Add(panel);

        var copy = new TsCopyButton
        {
            Variant = ButtonVariant.Secondary,
            Size = ControlSize.Medium,
            ValueToCopy = key,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(copy, _localizer.GetString("apiKeys.copy.aria", "Copy API key"));
        ToolTipService.SetToolTip(copy, _localizer.GetString("apiKeys.copy.title", "Copy"));
        Grid.SetColumn(copy, 1);
        row.Children.Add(copy);

        stack.Children.Add(row);
        return stack;
    }

    private async Task ConfirmDeleteAsync(ApiKeyRowDisplay row)
    {
        if (XamlRoot is null)
        {
            return;
        }

        string message = _localizer
            .GetString("apiKeys.delete.message", "Are you sure you want to permanently delete the key \"{{name}}\"?")
            .Replace("{{name}}", row.Name, StringComparison.Ordinal);

        var dialog = new TsModal
        {
            Title = _localizer.GetString("apiKeys.delete.title", "Delete API Key"),
            Content = new Text { Value = message },
            PrimaryButtonText = _localizer.GetString("apiKeys.delete.confirm", "Delete"),
            CloseButtonText = _localizer.GetString("apiKeys.delete.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                await _viewModel.DeleteKeyAsync(row.Id).ConfigureAwait(true);
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }
}
