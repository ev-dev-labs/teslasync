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
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 WebhookChannels Settings section — a parity port of
/// web/src/features/settings/components/WebhookChannelsSection.tsx. It composes the web component's header
/// (icon + title + subtitle + "Add webhook"), the kind=webhook channel list (each row carrying a status pill, an
/// HTTP-method chip, the receiver URL, the enable toggle and the Test / Edit / Delete actions with an inline
/// structured test result), the add/edit modal (name, URL, HTTP method, the signing-secret field with a
/// show/hide affordance and a debounced live X-TeslaSync-Signature preview, and the enabled toggle), the delete
/// confirmation, and the "Available payload variables" documentation box. The list flows through the
/// cache-then-network <see cref="WebhookChannelsViewModel"/>, so the surface renders every state the P2 contract
/// requires — row skeletons while loading, a retry surface on a hard failure, a friendly empty surface when no
/// webhooks exist, and a freshness chip (stale / offline) otherwise. The view never performs HTTP; every string
/// resolves through the i18n facade and every interactive element carries a Narrator name.
/// </summary>
public sealed partial class WebhookChannelsSection : ContentControl, IDisposable
{
    private const string WebhookGlyph = "\uE71B"; // Segoe Fluent — webhook / link
    private const string AddGlyph = "\uE710";     // Add
    private const string RefreshGlyph = "\uE72C"; // Refresh
    private const string TestGlyph = "\uE724";    // Send
    private const string EditGlyph = "\uE70F";    // Edit
    private const string DeleteGlyph = "\uE74D";  // Delete
    private const string ShowSecretGlyph = "\uE7B3"; // RedEye
    private const string HideSecretGlyph = "\uED1A"; // Hide
    private const double PanelPadding = 20;

    private readonly WebhookChannelsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly WebhookChannelsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Dictionary<long, WebhookTestDisplay> _testResults = new();

    private readonly StackPanel _root = new() { Spacing = 16 };

    private readonly InfoBar _toast = new()
    {
        IsOpen = false,
        IsClosable = true,
        Severity = InfoBarSeverity.Success,
        Margin = new Thickness(0, 0, 0, 4),
    };

    private readonly FontIcon _headerIcon = new() { Glyph = WebhookGlyph, FontSize = 20 };
    private readonly SectionTitle _title = new();
    private readonly Text _subtitle = new() { Foreground = DisplayTokens.TextSecondary };

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

    private readonly TsButton _addButton = new() { Variant = ButtonVariant.Primary, IconGlyph = AddGlyph };

    private readonly StackPanel _loading = new() { Spacing = 12 };
    private readonly TsQueryError _errorSurface = new();
    private readonly StackPanel _listArea = new() { Spacing = 12 };
    private readonly StackPanel _webhookList = new() { Spacing = 12 };
    private readonly TsEmptyState _emptyState = new();
    private readonly Border _docsPanel = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the webhook source, the i18n facade and optional diagnostics.</summary>
    /// <param name="source">The cache-then-network webhook source plus the mutations and utilities.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public WebhookChannelsSection(
        IWebhookChannelsSource source,
        ILocalizer localizer,
        WebhookChannelsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new WebhookChannelsDiagnostics();
        _viewModel = new WebhookChannelsViewModel(source, localizer);
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

    /// <summary>The diagnostics surface slug this view registers under (<c>WebhookChannelsSection</c>).</summary>
    public static string Slug => WebhookChannelsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public WebhookChannelsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="WebhookChannelsSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The cache-then-network engine.</param>
    /// <param name="options">The API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public static WebhookChannelsSection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        WebhookChannelsDiagnostics? diagnostics = null)
    {
        var source = new WebhookChannelsSource(api, engine, options);
        return new WebhookChannelsSection(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;
        _freshnessChip.VerticalAlignment = VerticalAlignment.Center;
        _refreshButton.Click += OnRefreshClick;
        _addButton.Click += OnAddClick;

        _root.Children.Add(_toast);
        _root.Children.Add(BuildHeaderBar());

        for (int i = 0; i < 2; i++)
        {
            _loading.Children.Add(BuildSkeletonRow());
        }

        LiveRegion.Configure(_loading);
        _errorSurface.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        _emptyState.IconGlyph = WebhookGlyph;
        _emptyState.ActionInvoked += (_, _) => _ = OpenFormAsync(null);
        _listArea.Children.Add(_webhookList);
        _listArea.Children.Add(_emptyState);

        BuildDocsPanel();

        _root.Children.Add(_loading);
        _root.Children.Add(_errorSurface);
        _root.Children.Add(_listArea);
        _root.Children.Add(_docsPanel);

        Content = new ScrollViewer
        {
            Content = new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = _root },
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };
    }

    private Grid BuildHeaderBar()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var identity = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        identity.Children.Add(BuildIconBox(_headerIcon));
        var titleStack = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(_title);
        titleStack.Children.Add(_subtitle);
        identity.Children.Add(titleStack);
        Grid.SetColumn(identity, 0);
        grid.Children.Add(identity);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(_freshnessChip);
        actions.Children.Add(_freshness);
        actions.Children.Add(_refreshButton);
        actions.Children.Add(_addButton);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);

        return grid;
    }

    private void BuildDocsPanel()
    {
        var content = new StackPanel { Spacing = 6 };
        content.Children.Add(new PanelTitle
        {
            Value = _localizer.GetString("webhookChannels.docs.title", "Available payload variables"),
        });
        content.Children.Add(new Text
        {
            Value = _localizer.GetString(
                "webhookChannels.docs.intro", "Webhook receivers get a JSON envelope with these fields:"),
            Foreground = DisplayTokens.TextSecondary,
        });

        foreach (var variable in WebhookChannelsProjection.DocsVariables(_localizer))
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            row.Children.Add(new Code { Value = variable.Name, VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(new Caption
            {
                Value = string.Format(CultureInfo.CurrentCulture, "\u2014 {0}", variable.Description),
                VerticalAlignment = VerticalAlignment.Center,
            });
            content.Children.Add(row);
        }

        _docsPanel.CornerRadius = new CornerRadius(8);
        _docsPanel.Background = DisplayTokens.Surface;
        _docsPanel.BorderBrush = DisplayTokens.Border;
        _docsPanel.BorderThickness = new Thickness(1);
        _docsPanel.Padding = new Thickness(12);
        _docsPanel.Child = content;
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

    private void OnToastRequested(object? sender, WebhookChannelsToast toast) =>
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
        AutomationProperties.SetName(_headerIcon, display.Title);
        _addButton.Text = display.AddLabel;
        AutomationProperties.SetName(_addButton, display.AddLabel);
        AutomationProperties.SetName(_refreshButton, _localizer.GetString("webhookChannels.refresh", "Refresh webhooks"));

        bool loading = state == WebhookChannelsState.Loading;
        bool error = state == WebhookChannelsState.Error;
        bool hasContent = !loading && !error;

        _loading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _errorSurface.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _listArea.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;

        RenderHeader(state);

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

    private void RenderError()
    {
        _errorSurface.Title = _localizer.GetString("webhookChannels.error.title", "Couldn't load webhook channels");
        _errorSurface.Message = _viewModel.ErrorMessage
            ?? _localizer.GetString(
                "webhookChannels.loadError", "Failed to load webhook channels: {{error}}")
                .Replace("{{error}}", string.Empty, StringComparison.Ordinal);
        _errorSurface.ActionText = _localizer.GetString("common.retry", "Retry");
        _errorSurface.AttemptCount = _viewModel.Attempts;
    }

    private void RenderHeader(WebhookChannelsState state)
    {
        bool stale = state == WebhookChannelsState.Stale;
        bool offline = state == WebhookChannelsState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString("webhookChannels.offlineChip", "Offline")
                : _localizer.GetString("webhookChannels.staleChip", "Stale");
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
    }

    private void RenderList(WebhookChannelsDisplay display)
    {
        _webhookList.Children.Clear();
        foreach (var row in display.Rows)
        {
            _webhookList.Children.Add(BuildRow(row));
        }

        bool hasRows = display.Rows.Count > 0;
        _webhookList.Visibility = hasRows ? Visibility.Visible : Visibility.Collapsed;

        _emptyState.Title = display.EmptyTitle;
        _emptyState.Message = display.EmptyMessage;
        _emptyState.ActionText = display.EmptyActionLabel;
        _emptyState.Visibility = hasRows ? Visibility.Collapsed : Visibility.Visible;
    }

    private TsGlassPanel BuildRow(WebhookRowDisplay row)
    {
        var content = new StackPanel { Spacing = 12 };

        var headerGrid = new Grid();
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var identity = new StackPanel { Spacing = 4 };
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new PanelTitle { Value = row.Name, VerticalAlignment = VerticalAlignment.Center });

        var statusBadge = new TsBadge { Status = row.StatusKind, VerticalAlignment = VerticalAlignment.Center };
        statusBadge.Content = new TextBlock { Text = row.StatusLabel, FontSize = 12 };
        AutomationProperties.SetName(statusBadge, row.StatusLabel);
        titleRow.Children.Add(statusBadge);

        var methodBadge = new TsBadge { Status = StatusKind.Info, VerticalAlignment = VerticalAlignment.Center };
        methodBadge.Content = new TextBlock { Text = row.MethodLabel, FontSize = 12 };
        AutomationProperties.SetName(methodBadge, row.MethodLabel);
        titleRow.Children.Add(methodBadge);

        identity.Children.Add(titleRow);
        identity.Children.Add(new Caption { Value = row.Url });
        Grid.SetColumn(identity, 0);
        headerGrid.Children.Add(identity);

        var toggle = new TsToggle { IsOn = row.Enabled, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(toggle, row.ToggleAutomationName);
        toggle.Toggled += (_, _) => OnRowToggled(row.Id);
        Grid.SetColumn(toggle, 1);
        headerGrid.Children.Add(toggle);
        content.Children.Add(headerGrid);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };

        var testButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = TestGlyph,
            Text = _localizer.GetString("webhookChannels.row.testShort", "Test"),
        };
        AutomationProperties.SetName(testButton, row.TestAutomationName);
        testButton.Click += (_, _) => _ = RunRowTestAsync(row.Id, testButton);
        actions.Children.Add(testButton);

        var editButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = EditGlyph,
            Text = _localizer.GetString("webhookChannels.row.editShort", "Edit"),
        };
        AutomationProperties.SetName(editButton, row.EditAutomationName);
        editButton.Click += (_, _) => OnRowEdit(row.Id);
        actions.Children.Add(editButton);

        var deleteButton = new TsButton
        {
            Variant = ButtonVariant.Destructive,
            Size = ControlSize.Small,
            IconGlyph = DeleteGlyph,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(8, 0, 0, 0),
        };
        AutomationProperties.SetName(deleteButton, row.DeleteAutomationName);
        deleteButton.Click += (_, _) => _ = ConfirmDeleteAsync(row);
        actions.Children.Add(deleteButton);

        content.Children.Add(actions);

        if (_testResults.TryGetValue(row.Id, out var testResult))
        {
            content.Children.Add(BuildTestResultBox(testResult));
        }

        return new TsGlassPanel { Padding = new Thickness(16), Content = content };
    }

    private static Border BuildTestResultBox(WebhookTestDisplay test)
    {
        var content = new StackPanel { Spacing = 6 };

        var summary = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var resultBadge = new TsBadge { Status = test.StatusKind, VerticalAlignment = VerticalAlignment.Center };
        resultBadge.Content = new TextBlock { Text = test.ResultLabel, FontSize = 12 };
        AutomationProperties.SetName(resultBadge, test.ResultLabel);
        summary.Children.Add(resultBadge);
        summary.Children.Add(new Caption { Value = test.StatusText, VerticalAlignment = VerticalAlignment.Center });
        summary.Children.Add(new Caption { Value = test.LatencyText, VerticalAlignment = VerticalAlignment.Center });
        content.Children.Add(summary);

        if (test.HasSignature)
        {
            var signatureRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            signatureRow.Children.Add(new Caption
            {
                Value = test.SignatureLabel,
                VerticalAlignment = VerticalAlignment.Center,
            });
            signatureRow.Children.Add(new Code
            {
                Value = test.Signature,
                VerticalAlignment = VerticalAlignment.Center,
            });
            content.Children.Add(signatureRow);
        }

        if (test.HasBody)
        {
            content.Children.Add(new Caption { Value = test.BodyLabel });
            content.Children.Add(new Code { Value = test.BodyText });
        }

        if (test.HasError)
        {
            content.Children.Add(new ErrorText { Value = test.Error });
        }

        return new Border
        {
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12),
            Child = content,
        };
    }

    private void OnRowToggled(long id)
    {
        if (_viewModel.FindWebhook(id) is { } channel)
        {
            _ = _viewModel.ToggleWebhookAsync(channel);
        }
    }

    private void OnRowEdit(long id)
    {
        if (_viewModel.FindWebhook(id) is { } channel)
        {
            _ = OpenFormAsync(channel);
        }
    }

    private async Task RunRowTestAsync(long id, TsButton button)
    {
        button.IsLoading = true;
        try
        {
            var display = await _viewModel.TestWebhookAsync(id).ConfigureAwait(true);
            _testResults[id] = display;
            ScheduleRender();
        }
        finally
        {
            button.IsLoading = false;
        }
    }

    private async Task ConfirmDeleteAsync(WebhookRowDisplay row)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var dialog = new TsModal
        {
            Title = _localizer.GetString("webhookChannels.delete.title", "Delete webhook?"),
            Content = new Text
            {
                Value = _localizer.GetString(
                    "webhookChannels.delete.message",
                    "This will permanently remove the webhook. TeslaSync will stop sending notifications to it immediately."),
            },
            PrimaryButtonText = _localizer.GetString("webhookChannels.delete.confirm", "Delete webhook"),
            CloseButtonText = _localizer.GetString("webhookChannels.delete.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                _testResults.Remove(row.Id);
                await _viewModel.DeleteWebhookAsync(row.Id).ConfigureAwait(true);
            }
            finally
            {
                deferral.Complete();
            }
        };

        await dialog.ShowAsync();
    }

    private async Task OpenFormAsync(WebhookChannel? editing)
    {
        if (XamlRoot is null)
        {
            return;
        }

        bool isEdit = editing is not null;

        var body = new StackPanel { Spacing = 16, MinWidth = 380 };

        var nameInput = new TsInput
        {
            Header = _localizer.GetString("webhookChannels.form.name", "Name"),
            Hint = _localizer.GetString("webhookChannels.form.nameHint", "Discord #alerts"),
            Text = editing?.Name ?? string.Empty,
        };
        AutomationProperties.SetName(nameInput, _localizer.GetString("webhookChannels.form.name", "Name"));

        var urlInput = new TsInput
        {
            Header = _localizer.GetString("webhookChannels.form.url", "URL"),
            Hint = _localizer.GetString("webhookChannels.form.urlHint", "https://discord.com/api/webhooks/..."),
            Text = editing?.Url ?? string.Empty,
        };
        AutomationProperties.SetName(urlInput, _localizer.GetString("webhookChannels.form.url", "URL"));
        var urlHelp = new HelperText
        {
            Value = _localizer.GetString(
                "webhookChannels.form.urlHelp",
                "Compatible with Discord, Slack, n8n, Home Assistant, and any HTTP receiver."),
        };

        var methodSelect = BuildMethodSelect(editing?.Method);

        var (secretField, readSecret, secretBox) = BuildSecretField(isEdit, editing);

        var signaturePanel = new StackPanel { Spacing = 4 };
        var signatureBox = new Border
        {
            CornerRadius = new CornerRadius(8),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Padding = new Thickness(12),
            Child = signaturePanel,
        };
        RenderSignatureOutcome(
            signaturePanel,
            new WebhookSignatureOutcome(
                WebhookSignatureStatus.Empty,
                string.Empty,
                _localizer.GetString(
                    "webhookChannels.signature.empty",
                    "Add a signing secret to preview the X-TeslaSync-Signature header.")));

        CancellationTokenSource? signatureCts = null;
        secretBox.PasswordChanged += (_, _) =>
        {
            signatureCts?.Cancel();
            signatureCts?.Dispose();
            signatureCts = new CancellationTokenSource();
            _ = UpdateSignaturePreviewAsync(secretBox.Password, signaturePanel, signatureCts.Token);
        };

        var enabledToggle = new TsToggle { IsOn = editing?.Enabled ?? true };
        void SyncToggleHeader() => enabledToggle.Header = _localizer.GetString("webhookChannels.form.enabled", "Enabled");
        SyncToggleHeader();
        AutomationProperties.SetName(enabledToggle, _localizer.GetString("webhookChannels.form.enabled", "Enabled"));

        var errorText = new ErrorText { Visibility = Visibility.Collapsed };

        body.Children.Add(nameInput);
        body.Children.Add(urlInput);
        body.Children.Add(urlHelp);
        body.Children.Add(methodSelect);
        body.Children.Add(secretField);
        body.Children.Add(signatureBox);
        body.Children.Add(enabledToggle);
        body.Children.Add(errorText);

        var dialog = new TsModal
        {
            Title = isEdit
                ? _localizer.GetString("webhookChannels.form.editTitle", "Edit webhook")
                : _localizer.GetString("webhookChannels.form.addTitle", "Add webhook"),
            PrimaryButtonText = isEdit
                ? _localizer.GetString("webhookChannels.form.saveEdit", "Save changes")
                : _localizer.GetString("webhookChannels.form.save", "Add webhook"),
            CloseButtonText = _localizer.GetString("webhookChannels.form.cancel", "Cancel"),
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
            Content = new ScrollViewer
            {
                Content = body,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = 560,
            },
        };

        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            try
            {
                string? nameError = WebhookChannelForm.ValidateName(nameInput.Text, _localizer);
                if (nameError is not null)
                {
                    errorText.Value = nameError;
                    errorText.Visibility = Visibility.Visible;
                    args.Cancel = true;
                    return;
                }

                string? urlError = WebhookChannelForm.ValidateUrl(urlInput.Text, _localizer);
                if (urlError is not null)
                {
                    errorText.Value = urlError;
                    errorText.Visibility = Visibility.Visible;
                    args.Cancel = true;
                    return;
                }

                var input = new WebhookFormInput(
                    editing?.Id,
                    nameInput.Text,
                    urlInput.Text,
                    SelectedMethod(methodSelect),
                    readSecret(),
                    enabledToggle.IsOn);

                bool saved = await _viewModel.SaveWebhookAsync(WebhookChannelForm.BuildPayload(input), editing?.Id)
                    .ConfigureAwait(true);
                if (!saved)
                {
                    errorText.Value = _localizer.GetString("webhookChannels.toast.saveError", "Failed to save webhook");
                    errorText.Visibility = Visibility.Visible;
                    args.Cancel = true;
                }
            }
            finally
            {
                deferral.Complete();
            }
        };

        try
        {
            await dialog.ShowAsync();
        }
        finally
        {
            signatureCts?.Cancel();
            signatureCts?.Dispose();
        }
    }

    private StackPanel BuildMethodSelect(string? current)
    {
        var stack = new StackPanel { Spacing = 6 };
        stack.Children.Add(new Label { Value = _localizer.GetString("webhookChannels.form.method", "HTTP method") });

        var select = new TsSelect();
        var methods = WebhookChannelForm.Methods;
        foreach (var method in methods)
        {
            select.Items.Add(new ComboBoxItem { Content = method });
        }

        string normalized = WebhookChannelForm.NormalizeDisplayMethod(current);
        int index = 0;
        for (int i = 0; i < methods.Count; i++)
        {
            if (string.Equals(methods[i], normalized, StringComparison.Ordinal))
            {
                index = i;
                break;
            }
        }

        select.SelectedIndex = index;
        AutomationProperties.SetName(select, _localizer.GetString("webhookChannels.form.method", "HTTP method"));
        stack.Children.Add(select);
        return stack;
    }

    private static string SelectedMethod(StackPanel methodSelect)
    {
        foreach (var child in methodSelect.Children)
        {
            if (child is TsSelect select &&
                select.SelectedIndex >= 0 &&
                select.SelectedIndex < WebhookChannelForm.Methods.Count)
            {
                return WebhookChannelForm.Methods[select.SelectedIndex];
            }
        }

        return "POST";
    }

    private (StackPanel Element, Func<string> Read, PasswordBox Box) BuildSecretField(bool isEdit, WebhookChannel? editing)
    {
        var stack = new StackPanel { Spacing = 6 };
        stack.Children.Add(new Label { Value = _localizer.GetString("webhookChannels.form.secret", "Signing secret") });

        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var box = new PasswordBox
        {
            PasswordRevealMode = PasswordRevealMode.Hidden,
            PlaceholderText = isEdit // parity:allow WinUI PasswordBox hint API mirrors the web placeholder
                ? _localizer.GetString("webhookChannels.form.secretHintEdit", "Leave blank to keep existing")
                : _localizer.GetString("webhookChannels.form.secretHint", "Optional \u2014 used for HMAC signing"),
        };
        // Editing never echoes the stored secret (web parity); leave the field blank to keep it.
        _ = editing;
        AutomationProperties.SetName(box, _localizer.GetString("webhookChannels.form.secret", "Signing secret"));
        Grid.SetColumn(box, 0);
        row.Children.Add(box);

        var revealButton = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = ShowSecretGlyph,
            VerticalAlignment = VerticalAlignment.Bottom,
        };
        AutomationProperties.SetName(revealButton, _localizer.GetString("webhookChannels.form.showSecret", "Show secret"));
        revealButton.Click += (_, _) =>
        {
            bool reveal = box.PasswordRevealMode != PasswordRevealMode.Visible;
            box.PasswordRevealMode = reveal ? PasswordRevealMode.Visible : PasswordRevealMode.Hidden;
            revealButton.IconGlyph = reveal ? HideSecretGlyph : ShowSecretGlyph;
            AutomationProperties.SetName(
                revealButton,
                reveal
                    ? _localizer.GetString("webhookChannels.form.hideSecret", "Hide secret")
                    : _localizer.GetString("webhookChannels.form.showSecret", "Show secret"));
        };
        Grid.SetColumn(revealButton, 1);
        row.Children.Add(revealButton);

        stack.Children.Add(row);
        stack.Children.Add(new HelperText
        {
            Value = _localizer.GetString(
                "webhookChannels.form.secretHelp",
                "When set, every request includes X-TeslaSync-Signature: sha256=<hmac> so the receiver can verify authenticity."),
        });

        return (stack, () => box.Password, box);
    }

    private async Task UpdateSignaturePreviewAsync(string secret, StackPanel panel, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(secret))
        {
            RenderSignatureOutcome(
                panel,
                new WebhookSignatureOutcome(
                    WebhookSignatureStatus.Empty,
                    string.Empty,
                    _localizer.GetString(
                        "webhookChannels.signature.empty",
                        "Add a signing secret to preview the X-TeslaSync-Signature header.")));
            return;
        }

        RenderSignatureComputing(panel);

        try
        {
            await Task.Delay(300, token).ConfigureAwait(true);
            var outcome = await _viewModel.PreviewSignatureAsync(secret, token).ConfigureAwait(true);
            if (!token.IsCancellationRequested)
            {
                RenderSignatureOutcome(panel, outcome);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer keystroke — drop this preview.
        }
    }

    private void RenderSignatureComputing(StackPanel panel)
    {
        panel.Children.Clear();
        panel.Children.Add(new Label { Value = _localizer.GetString("webhookChannels.signature.label", "Signature preview") });
        panel.Children.Add(new TsSpinner
        {
            Size = ControlSize.Small,
            Label = _localizer.GetString("webhookChannels.signature.loading", "Computing signature\u2026"),
            HorizontalAlignment = HorizontalAlignment.Left,
        });
    }

    private void RenderSignatureOutcome(StackPanel panel, WebhookSignatureOutcome outcome)
    {
        panel.Children.Clear();

        if (outcome.Status == WebhookSignatureStatus.Empty)
        {
            panel.Children.Add(new HelperText { Value = outcome.Message });
            return;
        }

        panel.Children.Add(new Label { Value = _localizer.GetString("webhookChannels.signature.label", "Signature preview") });

        if (outcome.Status == WebhookSignatureStatus.Failed)
        {
            panel.Children.Add(new ErrorText { Value = outcome.Message });
            return;
        }

        var signatureRow = new Grid { ColumnSpacing = 8 };
        signatureRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        signatureRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var code = new Code { Value = outcome.Signature, VerticalAlignment = VerticalAlignment.Center };
        Grid.SetColumn(code, 0);
        signatureRow.Children.Add(code);

        var copyButton = new TsCopyButton
        {
            Size = ControlSize.Small,
            ValueToCopy = outcome.Signature,
            CopyLabel = _localizer.GetString("common.copy", "Copy"),
            CopiedLabel = _localizer.GetString("common.copied", "Copied"),
        };
        AutomationProperties.SetName(copyButton, _localizer.GetString("common.copy", "Copy"));
        Grid.SetColumn(copyButton, 1);
        signatureRow.Children.Add(copyButton);
        panel.Children.Add(signatureRow);

        panel.Children.Add(new HelperText { Value = outcome.Message });
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

    private static TsGlassPanel BuildSkeletonRow()
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 220 });
        content.Children.Add(new TsSkeleton { BlockHeight = 48 });
        return new TsGlassPanel { Padding = new Thickness(16), Content = content };
    }
}
