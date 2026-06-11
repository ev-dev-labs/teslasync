using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>ShareDriveDialog</c> surface — a parity port of
/// web/src/features/driving/components/ShareDriveDialog.tsx. It presents a <see cref="TsModal"/> ("Share Drive")
/// whose body reproduces the web component: a create form (an optional title field, the include-speed and
/// include-telemetry consent toggles, an expiry dropdown — 7 / 30 / 90 days or Never — and a Generate action) that,
/// on success, swaps to a result view (the public link in a read-only field with copy + open-in-browser actions and
/// a "Create another link" reset), over an always-present "Active Share Links" section that lists the existing
/// links (title, view count, expiry) each with a copy + revoke affordance. The active-links read is driven through
/// the shared cache-then-network layer and renders every state — loading / empty / error (with retry) / stale /
/// offline — so the section is never a blank box. The view never performs HTTP or holds business logic — it binds
/// the shared <see cref="ShareDriveDialogViewModel"/>. Every string resolves through the i18n facade, every
/// interactive element carries a Narrator name, the state surfaces are live regions, and the surface adds no
/// bespoke motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class ShareDriveDialog : ContentControl, IDisposable
{
    private const double BodyMinWidth = 400;
    private const double BodyMaxHeight = 620;
    private const double SectionSpacing = 24;
    private const double FieldSpacing = 16;
    private const double GroupSpacing = 4;
    private const double RowSpacing = 8;

    private readonly ShareDriveDialogViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _body = new() { Spacing = SectionSpacing, MinWidth = BodyMinWidth };
    private readonly InfoBar _toast = new() { IsOpen = false, IsClosable = true };

    private readonly StackPanel _createSection = new() { Spacing = FieldSpacing };
    private readonly Text _description = new();
    private readonly TsInput _titleInput = new();
    private readonly TsToggle _includeSpeedToggle = new();
    private readonly TsToggle _includeTelemetryToggle = new();
    private readonly TsSelect _expirySelect = new();
    private readonly TsButton _generateButton = new() { Variant = ButtonVariant.Primary, IconGlyph = ShareDriveDialogRegistration.LinkGlyph };

    private readonly StackPanel _resultSection = new() { Spacing = 12, Visibility = Visibility.Collapsed };
    private readonly Text _createdText = new();
    private readonly TsInput _urlInput = new() { IsReadOnly = true };
    private readonly TsCopyButton _copyButton = new() { Variant = ButtonVariant.Primary };
    private readonly TsButton _externalButton = new() { Variant = ButtonVariant.Outline, IconGlyph = ShareDriveDialogRegistration.ExternalLinkGlyph };
    private readonly TsButton _createAnotherButton = new() { Variant = ButtonVariant.Subtle };

    private readonly StackPanel _existingSection = new() { Spacing = RowSpacing };
    private readonly Border _existingHeaderHost = new() { BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 12, 0, 0) };
    private readonly SectionTitle _existingHeader = new();
    private readonly TsSpinner _spinner = new() { Size = ControlSize.Small, Visibility = Visibility.Collapsed };
    private readonly TsEmptyState _emptyState = new() { Visibility = Visibility.Collapsed };
    private readonly TsQueryError _queryError = new() { Visibility = Visibility.Collapsed };
    private readonly Caption _statusChip = new() { Visibility = Visibility.Collapsed };
    private readonly StackPanel _linkList = new() { Spacing = RowSpacing, Visibility = Visibility.Collapsed };
    private readonly Dictionary<string, TsButton> _revokeButtons = new(StringComparer.Ordinal);

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over its read + command sources, identity, origin, localizer and diagnostics.</summary>
    /// <param name="source">The active-links read port.</param>
    /// <param name="commands">The create / revoke command port.</param>
    /// <param name="driveId">The drive being shared.</param>
    /// <param name="originBase">The public origin the share URL is built from.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public ShareDriveDialog(
        IShareLinksSource source,
        IShareLinksCommands commands,
        long driveId,
        string originBase,
        ILocalizer localizer,
        ShareDriveDialogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new ShareDriveDialogViewModel(source, commands, driveId, originBase, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "share-drive-dialog");
        AutomationProperties.SetName(this, _viewModel.ModalTitle);

        BuildBody();
        Content = _body;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        RenderState();
    }

    /// <summary>Raised once the modal has closed (web <c>onClose</c>), for any dismiss path.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>ShareDriveDialog</c>).</summary>
    public static string SurfaceId => ShareDriveDialogRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public ShareDriveDialogViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the contract-client-backed sources. The share origin is derived from the API
    /// base address (scheme + authority), mirroring the web <c>window.location.origin</c>.
    /// </summary>
    /// <param name="api">The shared generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (base address + JSON settings).</param>
    /// <param name="driveId">The drive being shared.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public static ShareDriveDialog Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long driveId,
        ILocalizer localizer,
        ShareDriveDialogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        return new ShareDriveDialog(
            new ShareLinksSource(api, engine, options),
            new ShareLinksCommands(api),
            driveId,
            OriginFrom(options),
            localizer,
            diagnostics);
    }

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>) and begin the active-links
    /// load. Idempotent: a second call while showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        Start();
        var dialog = new TsModal
        {
            Title = _viewModel.ModalTitle,
            CloseButtonText = _viewModel.CloseLabel,
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _body,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
                MaxHeight = BodyMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "share-drive-dialog-surface");
        AutomationProperties.SetName(dialog, _viewModel.ModalTitle);
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            _shown = false;
            _dialog = null;
        }
    }

    /// <summary>Detach from the view-model, dismiss the dialog and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ToastRequested -= OnToastRequested;
        _dialog?.Hide();
        _viewModel.Dispose();
    }

    private static string OriginFrom(ApiClientOptions options) =>
        $"{options.BaseAddress.Scheme}://{options.BaseAddress.Authority}";

    private void BuildBody()
    {
        _toast.IsOpen = false;
        AutomationProperties.SetAutomationId(_toast, "share-drive-dialog-toast");

        BuildCreateSection();
        BuildResultSection();
        BuildExistingSection();

        _body.Children.Add(_toast);
        _body.Children.Add(_createSection);
        _body.Children.Add(_resultSection);
        _body.Children.Add(_existingSection);
    }

    private void BuildCreateSection()
    {
        _description.Value = _viewModel.Description;
        _description.Foreground = DisplayTokens.TextSecondary;

        _titleInput.Hint = _viewModel.TitleHint;
        AutomationProperties.SetName(_titleInput, _viewModel.TitleHint);
        AutomationProperties.SetAutomationId(_titleInput, "share-drive-dialog-title");
        _titleInput.TextChanged += OnTitleChanged;

        ConfigureToggle(_includeSpeedToggle, _viewModel.IncludeSpeedLabel, _viewModel.IncludeSpeed,
            "share-drive-dialog-include-speed", OnIncludeSpeedToggled);
        ConfigureToggle(_includeTelemetryToggle, _viewModel.IncludeTelemetryLabel, _viewModel.IncludeTelemetry,
            "share-drive-dialog-include-telemetry", OnIncludeTelemetryToggled);

        foreach (ShareExpiryOption option in _viewModel.ExpiryOptions)
        {
            _expirySelect.Items.Add(new ComboBoxItem { Content = option.Label });
        }

        _expirySelect.SelectedIndex = IndexOfExpiry(_viewModel.ExpiryDays);
        AutomationProperties.SetName(_expirySelect, _viewModel.ExpiryHeading);
        AutomationProperties.SetAutomationId(_expirySelect, "share-drive-dialog-expiry");
        _expirySelect.SelectionChanged += OnExpiryChanged;

        _generateButton.Text = _viewModel.GenerateLabel;
        AutomationProperties.SetName(_generateButton, _viewModel.GenerateLabel);
        AutomationProperties.SetAutomationId(_generateButton, "share-drive-dialog-generate");
        _generateButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        _generateButton.Click += OnGenerateClick;

        _createSection.Children.Add(_description);
        _createSection.Children.Add(BuildLabeledControl(_viewModel.TitleHint, _titleInput, "share-drive-dialog-title-label"));
        _createSection.Children.Add(_includeSpeedToggle);
        _createSection.Children.Add(_includeTelemetryToggle);
        _createSection.Children.Add(BuildLabeledControl(_viewModel.ExpiryHeading, _expirySelect, "share-drive-dialog-expiry-label"));
        _createSection.Children.Add(_generateButton);
    }

    private void BuildResultSection()
    {
        _createdText.Value = _viewModel.CreatedLabel;
        ApplySuccessTint(_createdText);
        AutomationProperties.SetAutomationId(_createdText, "share-drive-dialog-created");

        AutomationProperties.SetName(_urlInput, _viewModel.CreatedLabel);
        AutomationProperties.SetAutomationId(_urlInput, "share-drive-dialog-url");

        _copyButton.CopyLabel = _viewModel.CopyLabel;
        _copyButton.CopiedLabel = _viewModel.CopiedLabel;
        _copyButton.Text = _viewModel.CopyLabel;
        AutomationProperties.SetName(_copyButton, _viewModel.CopyLabel);
        AutomationProperties.SetAutomationId(_copyButton, "share-drive-dialog-copy");

        AutomationProperties.SetName(_externalButton, _viewModel.OpenLinkLabel);
        ToolTipService.SetToolTip(_externalButton, _viewModel.OpenLinkLabel);
        AutomationProperties.SetAutomationId(_externalButton, "share-drive-dialog-open");
        _externalButton.Click += OnExternalClick;

        _createAnotherButton.Text = _viewModel.CreateAnotherLabel;
        _createAnotherButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(_createAnotherButton, _viewModel.CreateAnotherLabel);
        AutomationProperties.SetAutomationId(_createAnotherButton, "share-drive-dialog-create-another");
        _createAnotherButton.Click += OnCreateAnotherClick;

        var actions = new Grid { ColumnSpacing = RowSpacing };
        actions.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        actions.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _copyButton.HorizontalAlignment = HorizontalAlignment.Stretch;
        Grid.SetColumn(_copyButton, 0);
        Grid.SetColumn(_externalButton, 1);
        actions.Children.Add(_copyButton);
        actions.Children.Add(_externalButton);

        _resultSection.Children.Add(_createdText);
        _resultSection.Children.Add(_urlInput);
        _resultSection.Children.Add(actions);
        _resultSection.Children.Add(_createAnotherButton);
    }

    private void BuildExistingSection()
    {
        _existingHeader.Value = _viewModel.ExistingLabel;
        _existingHeaderHost.BorderBrush = DisplayTokens.Border;
        _existingHeaderHost.Child = _existingHeader;

        _emptyState.Title = _viewModel.ExistingLabel;
        _emptyState.Message = _viewModel.EmptyMessage;
        AutomationProperties.SetAutomationId(_emptyState, "share-drive-dialog-empty");

        _queryError.Title = _viewModel.ErrorTitle;
        _queryError.ActionText = _viewModel.RetryLabel;
        _queryError.ActionInvoked += OnRetryInvoked;
        AutomationProperties.SetAutomationId(_queryError, "share-drive-dialog-error");

        _spinner.Label = _viewModel.LoadingLabel;

        _statusChip.Foreground = DisplayTokens.TextMuted;
        LiveRegion.Configure(_statusChip);
        AutomationProperties.SetAutomationId(_linkList, "share-drive-dialog-links");

        _existingSection.Children.Add(_existingHeaderHost);
        _existingSection.Children.Add(_spinner);
        _existingSection.Children.Add(_statusChip);
        _existingSection.Children.Add(_linkList);
        _existingSection.Children.Add(_emptyState);
        _existingSection.Children.Add(_queryError);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Start();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void Start()
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnTitleChanged(object sender, TextChangedEventArgs e) => _viewModel.Title = _titleInput.Text;

    private void OnIncludeSpeedToggled(object? sender, EventArgs e) => _viewModel.IncludeSpeed = _includeSpeedToggle.IsOn;

    private void OnIncludeTelemetryToggled(object? sender, EventArgs e) =>
        _viewModel.IncludeTelemetry = _includeTelemetryToggle.IsOn;

    private void OnExpiryChanged(object sender, SelectionChangedEventArgs e)
    {
        int index = _expirySelect.SelectedIndex;
        if (index >= 0 && index < _viewModel.ExpiryOptions.Count)
        {
            _viewModel.ExpiryDays = _viewModel.ExpiryOptions[index].Value;
        }
    }

    private void OnGenerateClick(object sender, RoutedEventArgs e) => _ = _viewModel.GenerateAsync();

    private void OnCreateAnotherClick(object sender, RoutedEventArgs e) => _viewModel.CreateAnother();

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private async void OnExternalClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.ShareUrl is { } url && Uri.TryCreate(url, UriKind.Absolute, out Uri? uri))
        {
            await Windows.System.Launcher.LaunchUriAsync(uri);
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) => _viewModel.Reset();

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnToastRequested(object? sender, ShareDriveToast toast) =>
        Marshal(() =>
        {
            _toast.Severity = toast.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
            _toast.Title = toast.Message;
            _toast.Message = string.Empty;
            _toast.IsOpen = !string.IsNullOrEmpty(toast.Message);
            if (toast.IsError)
            {
                LiveRegion.Announce(_toast);
            }
        });

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() =>
        {
            if (e.PropertyName == nameof(ShareDriveDialogViewModel.Display))
            {
                RebuildLinkList(_viewModel.Display);
            }

            RenderState();
        });

    private void RenderState()
    {
        _createSection.Visibility = _viewModel.IsCreateMode ? Visibility.Visible : Visibility.Collapsed;
        _resultSection.Visibility = _viewModel.HasShareUrl ? Visibility.Visible : Visibility.Collapsed;

        _generateButton.IsLoading = _viewModel.CreatePending;

        if (_viewModel.ShareUrl is { } url)
        {
            _urlInput.Text = url;
            _copyButton.ValueToCopy = url;
        }

        ShareDriveState state = _viewModel.State;
        _spinner.Visibility = state == ShareDriveState.Loading ? Visibility.Visible : Visibility.Collapsed;
        _emptyState.Visibility = state == ShareDriveState.Empty ? Visibility.Visible : Visibility.Collapsed;
        _queryError.Visibility = state == ShareDriveState.Error ? Visibility.Visible : Visibility.Collapsed;

        bool hasList = state is ShareDriveState.Loaded or ShareDriveState.Stale or ShareDriveState.Offline;
        _linkList.Visibility = hasList ? Visibility.Visible : Visibility.Collapsed;

        if (state == ShareDriveState.Error)
        {
            _queryError.Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle;
            _queryError.AttemptCount = _viewModel.Attempts;
        }

        switch (state)
        {
            case ShareDriveState.Stale:
                _statusChip.Value = _viewModel.StaleLabel;
                _statusChip.Visibility = Visibility.Visible;
                break;
            case ShareDriveState.Offline:
                _statusChip.Value = _viewModel.ErrorMessage ?? _viewModel.OfflineLabel;
                _statusChip.Visibility = Visibility.Visible;
                break;
            default:
                _statusChip.Visibility = Visibility.Collapsed;
                break;
        }

        foreach (TsButton revoke in _revokeButtons.Values)
        {
            revoke.IsEnabled = !_viewModel.RevokePending;
        }
    }

    private void RebuildLinkList(ShareLinksDisplay display)
    {
        _linkList.Children.Clear();
        _revokeButtons.Clear();

        foreach (ShareLinkRow row in display.Rows)
        {
            _linkList.Children.Add(BuildShareRow(row));
        }
    }

    private TsGlassPanel BuildShareRow(ShareLinkRow row)
    {
        var layout = new Grid { ColumnSpacing = RowSpacing };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var info = new StackPanel { Spacing = GroupSpacing, VerticalAlignment = VerticalAlignment.Center };
        var title = new Text { Value = row.TitleDisplay };
        title.HorizontalAlignment = HorizontalAlignment.Left;

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        var views = new StackPanel { Orientation = Orientation.Horizontal, Spacing = GroupSpacing };
        views.Children.Add(new FontIcon
        {
            Glyph = ShareDriveDialogRegistration.EyeGlyph,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Center,
        });
        views.Children.Add(new Caption { Value = row.ViewsLabel });
        meta.Children.Add(views);
        meta.Children.Add(new Caption { Value = row.ExpiryLabel });

        info.Children.Add(title);
        info.Children.Add(meta);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = GroupSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var copy = new TsCopyButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            ValueToCopy = row.ShareUrl,
        };
        AutomationProperties.SetName(copy, row.CopyAutomationName);
        ToolTipService.SetToolTip(copy, _viewModel.CopyLabel);

        var revoke = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = ShareDriveDialogRegistration.TrashGlyph,
            IsEnabled = !_viewModel.RevokePending,
        };
        AutomationProperties.SetName(revoke, row.RevokeAutomationName);
        ToolTipService.SetToolTip(revoke, _viewModel.RevokeLabel);
        revoke.Click += (_, _) => _ = _viewModel.RevokeAsync(row.Token);
        _revokeButtons[row.Token] = revoke;

        actions.Children.Add(copy);
        actions.Children.Add(revoke);

        Grid.SetColumn(info, 0);
        Grid.SetColumn(actions, 1);
        layout.Children.Add(info);
        layout.Children.Add(actions);

        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = layout };
        AutomationProperties.SetName(panel, row.AutomationName);
        return panel;
    }

    private static void ConfigureToggle(
        TsToggle toggle,
        string label,
        bool isOn,
        string automationId,
        EventHandler handler)
    {
        toggle.Header = label;
        toggle.IsOn = isOn;
        AutomationProperties.SetName(toggle, label);
        AutomationProperties.SetAutomationId(toggle, automationId);
        toggle.Toggled += handler;
    }

    private static StackPanel BuildLabeledControl(string label, FrameworkElement control, string automationId)
    {
        var group = new StackPanel { Spacing = GroupSpacing };
        var labelText = new Label { Value = label };
        AutomationProperties.SetAutomationId(labelText, automationId);
        group.Children.Add(labelText);
        group.Children.Add(control);
        return group;
    }

    private static void ApplySuccessTint(TsTypography text)
    {
        Brush tint = DisplayTokens.Brush("TsColorSuccessBrush");
        if (tint is SolidColorBrush { Color.A: > 0 })
        {
            text.Foreground = tint;
        }
    }

    private int IndexOfExpiry(string value)
    {
        for (int i = 0; i < _viewModel.ExpiryOptions.Count; i++)
        {
            if (string.Equals(_viewModel.ExpiryOptions[i].Value, value, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return 0;
    }

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

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
}
