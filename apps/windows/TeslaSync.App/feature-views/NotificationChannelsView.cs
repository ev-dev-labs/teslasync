using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Motion;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 NotificationChannels surface — a parity port of
/// web/src/features/notifications/components/NotificationChannelsView.tsx. It composes the web component's four
/// metric cards (or their skeleton while the stats query loads), the "Add Channel" action, the channel-card grid
/// (each card carrying the transport glyph, a status badge, a redacted credential preview and the Test / Edit /
/// Delete actions) and the add/edit modal (the type picker, the per-type configuration fields, the enabled
/// toggle and the in-place Test affordance). The channel list flows through the cache-then-network
/// <see cref="NotificationChannelsViewModel"/>, so the surface renders every state the P2 contract requires —
/// card skeletons while loading, a retry surface on a hard failure, a friendly empty surface when no channels
/// exist, and a freshness chip (stale / offline) otherwise. The view never performs HTTP; every string resolves
/// through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class NotificationChannelsView : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string AddGlyph = "\uE710";     // Segoe Fluent — Add
    private const string TestGlyph = "\uE9D9";    // Segoe Fluent — TestBeaker
    private const string EditGlyph = "\uE70F";    // Segoe Fluent — Edit
    private const string DeleteGlyph = "\uE74D";  // Segoe Fluent — Delete
    private const double PanelPadding = 20;

    private readonly NotificationChannelsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly NotificationChannelsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsBadge _freshnessChip = new();
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refreshButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _loading = new() { Spacing = 16 };
    private readonly TsQueryError _errorSurface = new();

    private readonly StackPanel _content = new() { Spacing = 16 };
    private readonly Grid _statsHost = new() { ColumnSpacing = 12 };
    private readonly TsButton _addButton = new() { Variant = ButtonVariant.Primary, IconGlyph = AddGlyph };
    private readonly StackPanel _channelList = new() { Spacing = 16 };
    private readonly TsEmptyState _emptyState = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the channels source, the i18n facade and optional diagnostics.</summary>
    /// <param name="source">The cache-then-network channels/stats source plus the four mutations.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public NotificationChannelsView(
        INotificationChannelsSource source,
        ILocalizer localizer,
        NotificationChannelsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new NotificationChannelsDiagnostics();
        _viewModel = new NotificationChannelsViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>NotificationChannelsView</c>).</summary>
    public static string Slug => NotificationChannelsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public NotificationChannelsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="NotificationChannelsSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The cache-then-network engine.</param>
    /// <param name="options">The API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public static NotificationChannelsView Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        NotificationChannelsDiagnostics? diagnostics = null)
    {
        var source = new NotificationChannelsSource(api, engine, options);
        return new NotificationChannelsView(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;
        _freshnessChip.VerticalAlignment = VerticalAlignment.Center;
        _refreshButton.Click += OnRefreshClick;
        _header.Children.Add(_freshnessChip);
        _header.Children.Add(_freshness);
        _header.Children.Add(_refreshButton);

        _loading.Children.Add(BuildStatsSkeletonRow());
        for (int i = 0; i < 3; i++)
        {
            _loading.Children.Add(BuildSkeletonPanel());
        }

        LiveRegion.Configure(_loading);
        _errorSurface.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        _addButton.Click += OnAddClick;
        var addRow = new StackPanel { HorizontalAlignment = HorizontalAlignment.Right };
        addRow.Children.Add(_addButton);

        _content.Children.Add(_statsHost);
        _content.Children.Add(addRow);
        _content.Children.Add(_channelList);
        _content.Children.Add(_emptyState);

        _root.Children.Add(_toast);
        _root.Children.Add(_header);
        _root.Children.Add(_loading);
        _root.Children.Add(_errorSurface);
        _root.Children.Add(_content);

        Content = new ScrollViewer
        {
            Content = _root,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };
    }

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
        _viewModel.ToastRequested -= OnToastRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnAddClick(object sender, RoutedEventArgs e) => _ = OpenFormAsync(null);

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnToastRequested(object? sender, NotificationChannelsToast toast) =>
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

        bool loading = state == NotificationChannelsState.Loading;
        bool error = state == NotificationChannelsState.Error;
        bool hasContent = !loading && !error;

        _loading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _errorSurface.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _content.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;
        _header.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;

        if (error)
        {
            RenderError();
            return;
        }

        if (loading)
        {
            return;
        }

        RenderHeader(state);
        RenderStats(display);
        RenderChannels(display);
    }

    private void RenderError()
    {
        _errorSurface.Title = _localizer.GetString("notifications.channels.error.title", "Couldn't load notification channels");
        _errorSurface.Message = _viewModel.ErrorMessage
            ?? _localizer.GetString("notifications.channels.error.load", "Couldn't load notification channels");
        _errorSurface.ActionText = _localizer.GetString("common.retry", "Retry");
        _errorSurface.AttemptCount = _viewModel.Attempts;
    }

    private void RenderHeader(NotificationChannelsState state)
    {
        bool stale = state == NotificationChannelsState.Stale;
        bool offline = state == NotificationChannelsState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString("notifications.channels.offlineChip", "Offline")
                : _localizer.GetString("notifications.channels.staleChip", "Stale");
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = text;
            AutomationProperties.SetName(_freshnessChip, text);
            _freshnessChip.Visibility = Visibility.Visible;
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(_refreshButton, _localizer.GetString("notifications.channels.refresh", "Refresh channels"));
    }

    private void RenderStats(NotificationChannelsDisplay display)
    {
        _statsHost.Children.Clear();
        _statsHost.ColumnDefinitions.Clear();

        if (display.HasStats)
        {
            for (int i = 0; i < display.StatCards.Count; i++)
            {
                _statsHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var card = display.StatCards[i];
                var metric = new TsMetricCard
                {
                    Label = card.Label,
                    Value = card.Value,
                    AccentBrushKey = card.AccentBrushKey,
                };
                AutomationProperties.SetName(metric, card.AutomationName);
                Grid.SetColumn(metric, i);
                _statsHost.Children.Add(metric);
            }
        }
        else
        {
            for (int i = 0; i < 4; i++)
            {
                _statsHost.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var skeleton = new TsSkeleton { BlockHeight = 76 };
                Grid.SetColumn(skeleton, i);
                _statsHost.Children.Add(skeleton);
            }
        }
    }

    private void RenderChannels(NotificationChannelsDisplay display)
    {
        _addButton.Text = display.AddLabel;
        AutomationProperties.SetName(_addButton, display.AddLabel);

        _channelList.Children.Clear();
        foreach (var card in display.Channels)
        {
            _channelList.Children.Add(BuildChannelCard(card));
        }

        bool hasChannels = display.Channels.Count > 0;
        _channelList.Visibility = hasChannels ? Visibility.Visible : Visibility.Collapsed;

        _emptyState.IconGlyph = NotificationChannelsProjectionGlyphs.Bell;
        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.Visibility = hasChannels ? Visibility.Collapsed : Visibility.Visible;
    }

    private TsGlassPanel BuildChannelCard(ChannelCardDisplay card)
    {
        var content = new StackPanel { Spacing = 12 };

        // Header: icon + name + kind + status badge, with the enable toggle trailing.
        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var identity = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        identity.Children.Add(BuildIconBox(card.Glyph));

        var titleStack = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(new PanelTitle { Value = card.Name });
        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        meta.Children.Add(new Caption { Value = card.KindLabel, VerticalAlignment = VerticalAlignment.Center });
        var statusBadge = new TsBadge { Status = card.StatusKind, VerticalAlignment = VerticalAlignment.Center };
        statusBadge.Content = new TextBlock { Text = card.StatusLabel, FontSize = 12 };
        AutomationProperties.SetName(statusBadge, card.StatusLabel);
        meta.Children.Add(statusBadge);
        titleStack.Children.Add(meta);
        identity.Children.Add(titleStack);
        Grid.SetColumn(identity, 0);
        headerGrid.Children.Add(identity);

        var toggle = new TsToggle { IsOn = card.Enabled, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(toggle, card.ToggleAutomationName);
        toggle.Toggled += (_, _) => OnChannelToggled(card.Id);
        Grid.SetColumn(toggle, 1);
        headerGrid.Children.Add(toggle);
        content.Children.Add(headerGrid);

        // Credential preview (redacted), web's sliced config box.
        if (card.ConfigPreview.Count > 0)
        {
            var previewStack = new StackPanel { Spacing = 2 };
            foreach (var line in card.ConfigPreview)
            {
                previewStack.Children.Add(new Caption
                {
                    Value = string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0}: {1}", line.Label, line.Value),
                });
            }

            content.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(8),
                Background = DisplayTokens.Surface,
                Padding = new Thickness(10),
                Child = previewStack,
            });
        }

        // Actions: test / edit / delete.
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var testButton = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            IconGlyph = TestGlyph,
            Text = card.TestLabel,
        };
        AutomationProperties.SetName(testButton, card.TestAutomationName);
        testButton.Click += (_, _) => _ = RunChannelTestAsync(card.Id, testButton);
        actions.Children.Add(testButton);

        var editButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = EditGlyph,
            Text = card.EditLabel,
        };
        AutomationProperties.SetName(editButton, card.EditAutomationName);
        editButton.Click += (_, _) => OnChannelEdit(card.Id);
        actions.Children.Add(editButton);

        var deleteButton = new TsButton
        {
            Variant = ButtonVariant.Destructive,
            Size = ControlSize.Small,
            IconGlyph = DeleteGlyph,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(8, 0, 0, 0),
        };
        AutomationProperties.SetName(deleteButton, card.DeleteAutomationName);
        deleteButton.Click += (_, _) => OnChannelDelete(card.Id);
        actions.Children.Add(deleteButton);

        content.Children.Add(actions);

        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
    }

    private NotificationChannel? FindChannel(long id)
    {
        foreach (var channel in _viewModel.Channels.Channels)
        {
            if (channel.Id == id)
            {
                return channel;
            }
        }

        return null;
    }

    private void OnChannelToggled(long id)
    {
        if (FindChannel(id) is { } channel)
        {
            _ = _viewModel.ToggleChannelAsync(channel);
        }
    }

    private async Task RunChannelTestAsync(long id, TsButton button)
    {
        button.IsLoading = true;
        try
        {
            await _viewModel.TestChannelAsync(id).ConfigureAwait(true);
        }
        finally
        {
            button.IsLoading = false;
        }
    }

    private void OnChannelDelete(long id) => _ = _viewModel.DeleteChannelAsync(id);

    private void OnChannelEdit(long id)
    {
        if (FindChannel(id) is { } channel)
        {
            _ = OpenFormAsync(channel);
        }
    }

    private static Border BuildIconBox(string glyph)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Width = 44,
            Height = 44,
            CornerRadius = new CornerRadius(12),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = icon,
        };
    }

    private static Grid BuildStatsSkeletonRow()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        for (int i = 0; i < 4; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var skeleton = new TsSkeleton { BlockHeight = 76 };
            Grid.SetColumn(skeleton, i);
            grid.Children.Add(skeleton);
        }

        return grid;
    }

    private static TsGlassPanel BuildSkeletonPanel()
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 200 });
        content.Children.Add(new TsSkeleton { BlockHeight = 64 });
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
    }

    // ── Add / edit modal ─────────────────────────────────────────────────────────────────────────────────

    private async Task OpenFormAsync(NotificationChannel? editing)
    {
        if (XamlRoot is null)
        {
            return;
        }

        bool isEdit = editing is not null;
        var state = new ChannelFormState
        {
            Kind = editing?.ResolvedKind ?? NotificationChannelKind.Discord,
            Config = editing is null
                ? new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(editing.Config, StringComparer.Ordinal),
        };

        var body = new StackPanel { Spacing = 16, MinWidth = 360 };

        var nameInput = new TsInput
        {
            Header = _localizer.GetString("notifications.channels.nameLabel", "Channel Name"),
            Text = editing?.Name ?? string.Empty,
        };
        AutomationProperties.SetName(nameInput, _localizer.GetString("notifications.channels.nameLabel", "Channel Name"));

        var configHeader = new Caption();
        var fieldsPanel = new StackPanel { Spacing = 12 };
        var testHint = new HelperText
        {
            Value = _localizer.GetString(
                "notifications.channels.testHint", "Save then click \"Send Test\" to verify the configuration."),
        };

        var enabledToggle = new TsToggle { IsOn = editing?.Enabled ?? true };
        void SyncToggleHeader() => enabledToggle.Header = enabledToggle.IsOn
            ? _localizer.GetString("notifications.channels.enabled", "Enabled")
            : _localizer.GetString("notifications.channels.disabled", "Disabled");
        SyncToggleHeader();
        enabledToggle.Toggled += (_, _) => SyncToggleHeader();
        AutomationProperties.SetName(enabledToggle, _localizer.GetString("notifications.channels.enabledToggle", "Channel enabled"));

        var errorText = new ErrorText { Visibility = Visibility.Collapsed };
        var testResult = new TextBlock { Visibility = Visibility.Collapsed, FontSize = 12, TextWrapping = TextWrapping.Wrap };

        void RebuildFields()
        {
            var spec = ChannelTypeCatalog.For(state.Kind);
            string typeLabel = _localizer.GetString(spec.LabelKey, spec.LabelFallback);
            nameInput.Hint = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{0} {1}",
                _localizer.GetString("notifications.channels.namePlaceholderPrefix", "My"), // parity:allow web i18n key name
                typeLabel);
            configHeader.Value = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{0} {1}",
                typeLabel,
                _localizer.GetString("notifications.channels.configLabel", "Configuration"));

            fieldsPanel.Children.Clear();
            state.Readers.Clear();
            foreach (var field in spec.Fields)
            {
                string label = _localizer.GetString(field.LabelKey, field.LabelFallback);
                state.Config.TryGetValue(field.Key, out var initial);
                var (element, read) = BuildFieldControl(field, label, initial);
                fieldsPanel.Children.Add(element);
                state.Readers[field.Key] = read;
            }
        }

        body.Children.Add(BuildTypeSelector(isEdit, state, RebuildFields));
        body.Children.Add(nameInput);
        body.Children.Add(configHeader);
        body.Children.Add(fieldsPanel);
        body.Children.Add(testHint);
        body.Children.Add(enabledToggle);
        body.Children.Add(testResult);
        body.Children.Add(errorText);

        if (isEdit && editing is { } channel)
        {
            body.Children.Add(BuildModalTestButton(channel.Id, testResult));
        }

        RebuildFields();

        var dialog = new TsModal
        {
            Title = isEdit
                ? _localizer.GetString("notifications.channels.editTitle", "Edit Channel")
                : _localizer.GetString("notifications.channels.addTitle", "Add Channel"),
            PrimaryButtonText = isEdit
                ? _localizer.GetString("common.update", "Update")
                : _localizer.GetString("common.create", "Create"),
            CloseButtonText = _localizer.GetString("common.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
            Content = new ScrollViewer
            {
                Content = body,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = 520,
            },
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                string? nameError = NotificationChannelForm.ValidateName(nameInput.Text, _localizer);
                if (nameError is not null)
                {
                    errorText.Value = nameError;
                    errorText.Visibility = Visibility.Visible;
                    args.Cancel = true;
                    return;
                }

                var config = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var (key, read) in state.Readers)
                {
                    config[key] = read();
                }

                var payload = NotificationChannelForm.BuildPayload(
                    state.Kind, nameInput.Text, enabledToggle.IsOn, config, editing?.Id);
                bool saved = await _viewModel.SaveChannelAsync(payload, editing?.Id).ConfigureAwait(true);
                if (!saved)
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

    private StackPanel BuildTypeSelector(bool isEdit, ChannelFormState state, Action rebuildFields)
    {
        if (isEdit)
        {
            return new StackPanel { Visibility = Visibility.Collapsed };
        }

        var label = new Label { Value = _localizer.GetString("notifications.channels.typeLabel", "Channel Type") };
        var select = new TsSelect();
        var types = ChannelTypeCatalog.Ordered;
        for (int i = 0; i < types.Count; i++)
        {
            select.Items.Add(new ComboBoxItem { Content = _localizer.GetString(types[i].LabelKey, types[i].LabelFallback) });
        }

        select.SelectedIndex = IndexOfKind(state.Kind);
        AutomationProperties.SetName(select, _localizer.GetString("notifications.channels.typeLabel", "Channel Type"));
        select.SelectionChanged += (_, _) =>
        {
            if (select.SelectedIndex >= 0 && select.SelectedIndex < types.Count)
            {
                state.Kind = types[select.SelectedIndex].Kind;
                state.Config.Clear();
                rebuildFields();
            }
        };

        var stack = new StackPanel { Spacing = 6 };
        stack.Children.Add(label);
        stack.Children.Add(select);
        return stack;
    }

    private TsButton BuildModalTestButton(long id, TextBlock testResult)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            IconGlyph = TestGlyph,
            Text = _localizer.GetString("notifications.channels.test", "Test Connection"),
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(button, _localizer.GetString("notifications.channels.test", "Test Connection"));
        button.Click += async (_, _) =>
        {
            button.IsLoading = true;
            button.Text = _localizer.GetString("notifications.channels.testing", "Testing\u2026");
            try
            {
                var outcome = await _viewModel.TestChannelAsync(id).ConfigureAwait(true);
                testResult.Text = outcome.Message;
                testResult.Foreground = DisplayTokens.Brush(outcome.Success ? "TsColorSuccessBrush" : "TsColorDangerBrush");
                testResult.Visibility = Visibility.Visible;
            }
            finally
            {
                button.IsLoading = false;
                button.Text = _localizer.GetString("notifications.channels.test", "Test Connection");
            }
        };

        return button;
    }

    private static (FrameworkElement Element, Func<string> Read) BuildFieldControl(
        ChannelFieldSpec field, string label, string? initial)
    {
        if (field.Secret)
        {
            var password = new PasswordBox
            {
                Header = label,
                PlaceholderText = field.Hint, // parity:allow PlaceholderText is the WinUI hint API
                Password = initial ?? string.Empty,
            };
            AutomationProperties.SetName(password, label);
            return (password, () => password.Password);
        }

        var input = new TsInput
        {
            Header = label,
            Hint = field.Hint,
            Text = initial ?? string.Empty,
        };
        AutomationProperties.SetName(input, label);
        return (input, () => input.Text);
    }

    private static int IndexOfKind(NotificationChannelKind kind)
    {
        var types = ChannelTypeCatalog.Ordered;
        for (int i = 0; i < types.Count; i++)
        {
            if (types[i].Kind == kind)
            {
                return i;
            }
        }

        return 0;
    }

    private sealed class ChannelFormState
    {
        public NotificationChannelKind Kind { get; set; }

        public Dictionary<string, string> Config { get; init; } = new(StringComparer.Ordinal);

        public Dictionary<string, Func<string>> Readers { get; } = new(StringComparer.Ordinal);
    }
}

/// <summary>Shared Segoe Fluent glyphs for the NotificationChannels surface (kept beside the view).</summary>
internal static class NotificationChannelsProjectionGlyphs
{
    /// <summary>The bell glyph shown on the empty surface.</summary>
    public const string Bell = "\uEA8F";
}
