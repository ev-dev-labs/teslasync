using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The native WinUI 3 <c>IncidentTimelinePage</c> — a parity port of the web page
/// <c>web/src/features/system/pages/IncidentTimelinePage.tsx</c> (route <c>/system-status/incidents/:id</c>, nav
/// name <c>IncidentTimeline</c>). It binds a <see cref="IncidentTimelinePageViewModel"/> and renders every web
/// region with Fluent components and design tokens: the shared <see cref="PageContainer"/> chrome (title +
/// subtitle + a back action, with the container spinner driven by the loading state), and inside it the four web
/// <c>GlassPanel</c>s — the not-found panel (the web <c>error || !incident</c> branch, GlassPanel1), the incident
/// header (severity glyph, status badge, severity, source, open/resolved-duration badge, description, affected
/// components, started/resolved meta and the Resolve button — GlassPanel2), the newest-first update timeline
/// (GlassPanel3) and the append-update form (textarea + status dropdown + Add button — GlassPanel4, hidden once
/// resolved). The resolve action is gated behind a <see cref="TsConfirmDialog"/> and both writes raise an
/// <see cref="InfoBar"/> toast, exactly like the web <c>ConfirmDialog</c> + <c>useToast</c> paths. The view is a
/// thin renderer: all branch selection, formatting and i18n happen in the view-model's
/// <see cref="IncidentTimelineDisplay"/> projection; state changes are coalesced onto the UI thread.
/// </summary>
public sealed partial class IncidentTimelinePage : UserControl, IDisposable
{
    private const double SectionSpacing = 20;
    private const double PanelPadding = 16;

    private readonly IncidentTimelinePageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue? _dispatcher;

    private readonly PageContainer _container;
    private readonly TsButton _backButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = IncidentTimelineRegistration.BackGlyph,
    };

    private readonly StackPanel _bodyHost = new() { Spacing = SectionSpacing };
    private readonly InfoBar _toast = new() { IsOpen = false, IsClosable = true };

    // GlassPanel1 — not-found / error surface (web error || !incident branch).
    private readonly TsGlassPanel _notFoundPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly Text _notFoundText = new();
    private readonly TsButton _backLink = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = IncidentTimelineRegistration.BackGlyph,
        HorizontalAlignment = HorizontalAlignment.Left,
    };

    private readonly StackPanel _successStack = new() { Spacing = SectionSpacing };

    // GlassPanel2 — incident header.
    private readonly TsGlassPanel _headerPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly FontIcon _severityIcon = new() { FontSize = 20, VerticalAlignment = VerticalAlignment.Top };
    private readonly TsBadge _statusBadge = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _statusBadgeText = new() { FontSize = 12 };
    private readonly TextBlock _severityLabel = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _sourceText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _durationBadge = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _durationBadgeText = new() { FontSize = 12 };
    private readonly Text _description = new();
    private readonly Caption _affects = new();
    private readonly FontIcon _clockIcon = new()
    {
        Glyph = IncidentTimelineRegistration.ClockGlyph,
        FontSize = 12,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Caption _meta = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _resolveButton = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        IconGlyph = IncidentTimelineRegistration.ResolveGlyph,
        VerticalAlignment = VerticalAlignment.Top,
    };

    // GlassPanel3 — timeline.
    private readonly TsGlassPanel _timelinePanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly FontIcon _timelineIcon = new()
    {
        Glyph = IncidentTimelineRegistration.TimelineGlyph,
        FontSize = 16,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly PanelTitle _timelineTitle = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Caption _entriesText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _timelineList = new() { Spacing = 12 };

    // GlassPanel4 — append-update form.
    private readonly TsGlassPanel _formPanel = new() { Padding = new Thickness(PanelPadding) };
    private readonly PanelTitle _formTitle = new();
    private readonly TsTextarea _messageInput = new() { MinHeight = 84, MaxLength = IncidentTimelineRegistration.MessageMaxLength };
    private readonly TsSelect _statusSelect = new();
    private readonly TsButton _addButton = new() { Variant = ButtonVariant.Primary };
    private readonly List<IncidentStatus?> _statusValues = new();

    private TsConfirmDialog? _confirmDialog;
    private bool _disposed;
    private bool _started;
    private bool _renderQueued;

    /// <summary>Creates the page over the default empty source and the shell localizer for a route-supplied id.</summary>
    /// <param name="incidentId">The incident id from the <c>/system-status/incidents/:id</c> route param.</param>
    public IncidentTimelinePage(long incidentId)
        : this(EmptyIncidentTimelineSource.Instance, ShellLocalizer.Instance, incidentId)
    {
    }

    /// <summary>Creates the page over an explicit source, localizer and incident id (used by tests / DI hosts).</summary>
    /// <param name="source">The three-hook incident data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="incidentId">The incident id from the route.</param>
    public IncidentTimelinePage(IIncidentTimelineSource source, ILocalizer localizer, long incidentId)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new IncidentTimelinePageViewModel(source, localizer, incidentId);
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _container = new PageContainer(localizer, _viewModel.Display.Title);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildStatusOptions();
        BuildBody();
        Content = BuildLayout();

        _backButton.Click += OnBackClick;
        _backLink.Click += OnBackClick;
        _resolveButton.Click += OnResolveClick;
        _addButton.Click += OnAddClick;
        _messageInput.TextChanged += OnMessageChanged;
        _statusSelect.SelectionChanged += OnStatusSelectionChanged;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ToastRequested += OnToastRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when the back affordance is invoked (web back link / button to <c>/system-status</c>).</summary>
    public event EventHandler? BackRequested;

    /// <summary>The diagnostics surface slug (<c>IncidentTimelinePage</c>).</summary>
    public static string Slug => IncidentTimelineRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public IncidentTimelinePageViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory wiring the generated-client-backed <see cref="IncidentTimelineClientSource"/> (ADR-004).</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="localizer">The i18n facade.</param>
    /// <param name="incidentId">The incident id from the route.</param>
    public static IncidentTimelinePage Create(IApiClient api, ILocalizer localizer, long incidentId)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(localizer);
        return new IncidentTimelinePage(new IncidentTimelineClientSource(api), localizer, incidentId);
    }

    private void BuildStatusOptions()
    {
        foreach (var option in _viewModel.Display.StatusOptions)
        {
            _statusValues.Add(option.Value);
            _statusSelect.Items.Add(new ComboBoxItem { Content = option.Label });
        }

        _statusSelect.SelectedIndex = 0;
        AutomationProperties.SetName(_statusSelect, _viewModel.Display.AddUpdateTitle);
    }

    private void BuildBody()
    {
        AutomationProperties.SetAutomationId(_toast, "incident-timeline-toast");

        var notFoundContent = new StackPanel { Spacing = 12 };
        notFoundContent.Children.Add(_notFoundText);
        notFoundContent.Children.Add(_backLink);
        _notFoundPanel.Content = notFoundContent;
        AutomationProperties.SetAutomationId(_notFoundPanel, "incident-timeline-not-found");

        _successStack.Children.Add(BuildHeaderPanel());
        _successStack.Children.Add(BuildTimelinePanel());
        _successStack.Children.Add(BuildFormPanel());

        _bodyHost.Children.Add(_toast);
        _bodyHost.Children.Add(_notFoundPanel);
        _bodyHost.Children.Add(_successStack);
    }

    private TsGlassPanel BuildHeaderPanel()
    {
        _statusBadge.Content = _statusBadgeText;
        _durationBadge.Content = _durationBadgeText;

        var badges = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        badges.Children.Add(_statusBadge);
        badges.Children.Add(_severityLabel);
        badges.Children.Add(_sourceText);
        badges.Children.Add(_durationBadge);

        var metaRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        metaRow.Children.Add(_clockIcon);
        metaRow.Children.Add(_meta);

        var info = new StackPanel { Spacing = 8 };
        info.Children.Add(badges);
        info.Children.Add(_description);
        info.Children.Add(_affects);
        info.Children.Add(metaRow);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_severityIcon, 0);
        Grid.SetColumn(info, 1);
        Grid.SetColumn(_resolveButton, 2);
        grid.Children.Add(_severityIcon);
        grid.Children.Add(info);
        grid.Children.Add(_resolveButton);

        _headerPanel.Content = grid;
        AutomationProperties.SetAutomationId(_headerPanel, "incident-timeline-header");
        return _headerPanel;
    }

    private TsGlassPanel BuildTimelinePanel()
    {
        var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        heading.Children.Add(_timelineIcon);
        heading.Children.Add(_timelineTitle);
        heading.Children.Add(_entriesText);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(heading);
        column.Children.Add(_timelineList);

        _timelinePanel.Content = column;
        AutomationProperties.SetAutomationId(_timelinePanel, "incident-timeline-updates");
        return _timelinePanel;
    }

    private TsGlassPanel BuildFormPanel()
    {
        AutomationProperties.SetName(_messageInput, _viewModel.Display.AddUpdateTitle);
        AutomationProperties.SetAutomationId(_messageInput, "incident-timeline-message");

        var controls = new Grid { ColumnSpacing = 12 };
        controls.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        controls.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _statusSelect.VerticalAlignment = VerticalAlignment.Center;
        _addButton.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_statusSelect, 0);
        Grid.SetColumn(_addButton, 1);
        controls.Children.Add(_statusSelect);
        controls.Children.Add(_addButton);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(_formTitle);
        column.Children.Add(_messageInput);
        column.Children.Add(controls);

        _formPanel.Content = column;
        AutomationProperties.SetAutomationId(_formPanel, "incident-timeline-form");
        return _formPanel;
    }

    private PageContainer BuildLayout()
    {
        _container.CopyLink = false;
        _container.Actions = _backButton;
        _container.PageContent = _bodyHost;
        return _container;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_started)
        {
            _started = true;
            _viewModel.NotifyOpened();
        }

        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnBackClick(object sender, RoutedEventArgs e) => BackRequested?.Invoke(this, EventArgs.Empty);

    private async void OnResolveClick(object sender, RoutedEventArgs e) => await ShowResolveConfirmAsync().ConfigureAwait(true);

    private async void OnAddClick(object sender, RoutedEventArgs e) =>
        await _viewModel.AppendUpdateAsync().ConfigureAwait(true);

    private void OnMessageChanged(object sender, TextChangedEventArgs e) => _viewModel.Message = _messageInput.Text;

    private void OnStatusSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        int index = _statusSelect.SelectedIndex;
        if (index >= 0 && index < _statusValues.Count)
        {
            _viewModel.NextStatus = _statusValues[index];
        }
    }

    private async Task ShowResolveConfirmAsync()
    {
        if (_disposed || XamlRoot is not { } xamlRoot)
        {
            return;
        }

        var display = _viewModel.Display;
        var dialog = new TsConfirmDialog
        {
            Title = display.ConfirmTitle,
            PrimaryButtonText = display.ConfirmLabel,
            CloseButtonText = display.CancelLabel,
            IsDestructive = false,
            XamlRoot = xamlRoot,
            Content = new TextBlock { Text = display.ConfirmMessage, TextWrapping = TextWrapping.Wrap },
        };
        AutomationProperties.SetName(dialog, display.ConfirmTitle);
        dialog.PrimaryButtonClick += OnConfirmResolve;
        _confirmDialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
        }
        finally
        {
            dialog.PrimaryButtonClick -= OnConfirmResolve;
            _confirmDialog = null;
        }
    }

    private async void OnConfirmResolve(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            bool resolved = await _viewModel.ResolveAsync().ConfigureAwait(true);
            if (!resolved)
            {
                args.Cancel = true;
            }
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void OnToastRequested(object? sender, IncidentTimelineToast toast) =>
        Marshal(() =>
        {
            _toast.Title = toast.Message;
            _toast.Message = string.Empty;
            _toast.Severity = toast.IsError ? InfoBarSeverity.Error : InfoBarSeverity.Success;
            _toast.IsOpen = !string.IsNullOrEmpty(toast.Message);
        });

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        Marshal(RenderCoalesced);
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        var display = _viewModel.Display;

        _container.Title = display.Title;
        _container.Subtitle = display.Subtitle;
        _container.IsLoading = display.IsLoading;
        AutomationProperties.SetName(this, display.AutomationName);
        AutomationProperties.SetName(_backButton, display.BackLabel);
        ToolTipService.SetToolTip(_backButton, display.BackLabel);

        bool ready = display.State == IncidentTimelineState.Ready;
        bool notFound = display.State == IncidentTimelineState.NotFound;

        _notFoundPanel.Visibility = notFound ? Visibility.Visible : Visibility.Collapsed;
        _successStack.Visibility = ready ? Visibility.Visible : Visibility.Collapsed;

        if (notFound)
        {
            _notFoundText.Value = display.NotFoundText;
            _backLink.Text = display.BackToStatusLabel;
            AutomationProperties.SetName(_backLink, display.BackToStatusLabel);
        }

        if (ready)
        {
            RenderHeader(display);
            RenderTimeline(display);
            RenderForm(display);
        }
    }

    private void RenderHeader(IncidentTimelineDisplay display)
    {
        _severityIcon.Glyph = display.SeverityGlyph;
        _severityIcon.Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(display.SeverityTone));

        _statusBadge.Status = display.StatusTone;
        _statusBadgeText.Text = display.StatusText;

        _severityLabel.Text = display.SeverityLabel;
        _severityLabel.Foreground = DisplayTokens.Brush(StatusResources.AccentBrushKey(display.SeverityTone));

        _sourceText.Value = display.SourceText;
        _sourceText.Visibility = display.HasSource ? Visibility.Visible : Visibility.Collapsed;

        _durationBadge.Status = display.DurationBadgeTone;
        _durationBadgeText.Text = display.DurationBadgeText;

        _description.Value = display.Description;
        _description.Visibility = display.HasDescription ? Visibility.Visible : Visibility.Collapsed;

        _affects.Value = display.AffectsText;
        _affects.Visibility = display.HasAffects ? Visibility.Visible : Visibility.Collapsed;

        _meta.Value = display.MetaText;

        _resolveButton.Text = display.ResolveLabel;
        _resolveButton.IsLoading = _viewModel.IsResolving;
        _resolveButton.Visibility = display.IsResolved ? Visibility.Collapsed : Visibility.Visible;
        AutomationProperties.SetName(_resolveButton, display.ResolveLabel);
    }

    private void RenderTimeline(IncidentTimelineDisplay display)
    {
        _timelineTitle.Value = display.TimelineTitle;
        _entriesText.Value = display.EntriesText;

        _timelineList.Children.Clear();
        foreach (var row in display.Rows)
        {
            _timelineList.Children.Add(BuildTimelineRow(row));
        }
    }

    private void RenderForm(IncidentTimelineDisplay display)
    {
        _formPanel.Visibility = display.IsResolved ? Visibility.Collapsed : Visibility.Visible;
        _formTitle.Value = display.AddUpdateTitle;
        _messageInput.Hint = display.MessageHint;
        _addButton.Text = _viewModel.IsAppending ? display.AddingLabel : display.AddLabel;
        _addButton.IsLoading = _viewModel.IsAppending;
        AutomationProperties.SetName(_addButton, display.AddLabel);

        if (display.StatusOptions.Count > 0 && _statusSelect.Items.Count > 0
            && _statusSelect.Items[0] is ComboBoxItem keep)
        {
            keep.Content = display.StatusOptions[0].Label;
        }

        SyncMessage();
        SyncStatusSelection();
    }

    private void SyncMessage()
    {
        if (_messageInput.Text != _viewModel.Message)
        {
            _messageInput.Text = _viewModel.Message;
        }
    }

    private void SyncStatusSelection()
    {
        int desired = _statusValues.IndexOf(_viewModel.NextStatus);
        if (desired < 0)
        {
            desired = 0;
        }

        if (_statusSelect.SelectedIndex != desired)
        {
            _statusSelect.SelectedIndex = desired;
        }
    }

    private static Border BuildTimelineRow(IncidentTimelineRow row)
    {
        var statusBadge = new TsBadge { Status = row.StatusTone, VerticalAlignment = VerticalAlignment.Center };
        statusBadge.Content = new TextBlock { Text = row.StatusText, FontSize = 12 };

        var badges = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        badges.Children.Add(statusBadge);
        badges.Children.Add(new Caption { Value = row.TimestampText, VerticalAlignment = VerticalAlignment.Center });
        if (row.HasAuthor)
        {
            badges.Children.Add(new Caption { Value = row.AuthorText, VerticalAlignment = VerticalAlignment.Center });
        }

        var message = new TextBlock
        {
            Text = row.Message,
            FontSize = 14,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextPrimary,
        };

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(badges);
        column.Children.Add(message);

        var rail = new Border
        {
            BorderThickness = new Thickness(2, 0, 0, 0),
            BorderBrush = DisplayTokens.Border,
            Padding = new Thickness(12, 0, 0, 0),
            Child = column,
        };
        AutomationProperties.SetName(rail, row.AutomationName);
        return rail;
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

    /// <summary>Unsubscribe from and dispose the view-model and hosted chrome (CA1001; mirrors sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _backButton.Click -= OnBackClick;
        _backLink.Click -= OnBackClick;
        _resolveButton.Click -= OnResolveClick;
        _addButton.Click -= OnAddClick;
        _messageInput.TextChanged -= OnMessageChanged;
        _statusSelect.SelectionChanged -= OnStatusSelectionChanged;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ToastRequested -= OnToastRequested;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _confirmDialog?.Hide();
        _confirmDialog = null;
        _container.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new IncidentTimelinePageAutomationPeer(this);

    private sealed class IncidentTimelinePageAutomationPeer(IncidentTimelinePage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}
