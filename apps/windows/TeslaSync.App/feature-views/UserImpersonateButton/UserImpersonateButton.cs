using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
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
/// The native WinUI 3 impersonate-button surface — a parity port of
/// web/src/features/admin/components/UserImpersonateButton.tsx. It composes the web's fragment: a low-emphasis
/// ("ghost") action button labelled "Impersonate" (or the busy "Starting…") that, on click, opens a warning
/// <see cref="TsConfirmDialog"/>; confirming fires the sudo-gated start mutation
/// (<c>POST /admin/impersonate/</c>). Beyond the web fragment — which delegates its surrounding states to the
/// parent and a toast — this standalone surface renders every state from the shared cache-then-network status
/// read: a loading chip, a live/stale/offline freshness chip, a friendly "unavailable in open-access mode"
/// empty surface, and an inline error with a retry affordance. All data flows through the shared
/// <see cref="UserImpersonateButtonViewModel"/>; the view never performs HTTP. Every string resolves through
/// the i18n facade and every interactive element carries a Narrator name. The surface adds no bespoke motion,
/// so reduced-motion preferences are honoured by construction.
/// </summary>
public sealed partial class UserImpersonateButton : ContentControl, IDisposable
{
    private const string ActionGlyph = "\uE7EF";   // Segoe Fluent — Admin (impersonate)
    private const string WarningGlyph = "\uE7BA";  // Segoe Fluent — Warning
    private const string ErrorGlyph = "\uE783";    // Segoe Fluent — Error / cloud-off

    /// <summary>The opaque proxy-issued subject identifier to impersonate (web <c>subject</c> prop).</summary>
    public static readonly DependencyProperty SubjectProperty = DependencyProperty.Register(
        nameof(Subject), typeof(string), typeof(UserImpersonateButton),
        new PropertyMetadata(string.Empty, OnSubjectChanged));

    /// <summary>The parent-owned disabled flag (web <c>disabled</c> prop).</summary>
    public static readonly DependencyProperty DisabledProperty = DependencyProperty.Register(
        nameof(Disabled), typeof(bool), typeof(UserImpersonateButton),
        new PropertyMetadata(false, OnDisabledChanged));

    private readonly UserImpersonateButtonViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly UserImpersonateButtonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 8 };

    private TsConfirmDialog? _confirmDialog;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public UserImpersonateButton(
        IImpersonationSource source,
        ILocalizer localizer,
        UserImpersonateButtonDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new UserImpersonateButtonDiagnostics();
        _viewModel = new UserImpersonateButtonViewModel(source, localizer, _diagnostics, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetName(this, UserImpersonateButtonRegistration.StartLabel(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>user-impersonate-button</c>).</summary>
    public static string SurfaceId => UserImpersonateButtonRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public UserImpersonateButtonViewModel ViewModel => _viewModel;

    /// <summary>The subject to impersonate.</summary>
    public string Subject
    {
        get => (string)GetValue(SubjectProperty);
        set => SetValue(SubjectProperty, value);
    }

    /// <summary>Whether the action is disabled by the parent.</summary>
    public bool Disabled
    {
        get => (bool)GetValue(DisabledProperty);
        set => SetValue(DisabledProperty, value);
    }

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="ImpersonationSource"/> from the shared
    /// data layer (the host's P2-core dependencies).
    /// </summary>
    public static UserImpersonateButton Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        UserImpersonateButtonDiagnostics? diagnostics = null)
    {
        var source = new ImpersonationSource(api, engine, options);
        return new UserImpersonateButton(source, localizer, diagnostics);
    }

    private static void OnSubjectChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((UserImpersonateButton)d)._viewModel.Subject = (string)e.NewValue;

    private static void OnDisabledChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((UserImpersonateButton)d)._viewModel.Disabled = (bool)e.NewValue;

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

    /// <summary>Detach from the view-model, dismiss any dialog and cancel in-flight work (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        DismissConfirmDialog();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        SyncConfirmDialog();
    }

    private void Render()
    {
        _root.Children.Clear();
        _root.Children.Add(BuildActionRow());

        var secondary = BuildSecondary();
        if (secondary is not null)
        {
            _root.Children.Add(secondary);
        }
    }

    // ── Action row (always visible) ────────────────────────────────────────────────────────────────────

    private StackPanel BuildActionRow()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(BuildButton());

        if (_viewModel.State is ImpersonateSurfaceState.Ready
            or ImpersonateSurfaceState.Stale
            or ImpersonateSurfaceState.Offline
            or ImpersonateSurfaceState.Starting)
        {
            row.Children.Add(new TsDataFreshness
            {
                UpdatedAt = _viewModel.UpdatedAt,
                IsFetching = _viewModel.IsFetching,
                IsError = _viewModel.IsError,
                VerticalAlignment = VerticalAlignment.Center,
            });
        }

        return row;
    }

    private TsButton BuildButton()
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.ButtonLabel,
            IconGlyph = ActionGlyph,
            IsLoading = _viewModel.IsStarting,
            IsEnabled = _viewModel.IsButtonEnabled,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(button, _viewModel.ButtonAriaLabel);
        AutomationProperties.SetAutomationId(button, $"user-impersonate-button-{_viewModel.Subject}");
        button.Click += OnButtonClick;
        return button;
    }

    private void OnButtonClick(object sender, RoutedEventArgs e) => _viewModel.BeginConfirm();

    // ── Secondary line (state chrome) ──────────────────────────────────────────────────────────────────

    private FrameworkElement? BuildSecondary() => _viewModel.State switch
    {
        ImpersonateSurfaceState.Loading => BuildLoading(),
        ImpersonateSurfaceState.Error => BuildError(),
        ImpersonateSurfaceState.Empty => BuildHint(UserImpersonateButtonRegistration.UnavailableLabel(_localizer)),
        ImpersonateSurfaceState.Offline => BuildHint(UserImpersonateButtonRegistration.OfflineLabel(_localizer)),
        ImpersonateSurfaceState.Stale => BuildHint(UserImpersonateButtonRegistration.StaleLabel(_localizer)),
        _ => _viewModel.IsStarted ? BuildSuccess() : null,
    };

    private StackPanel BuildLoading()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TsSpinner { Size = ControlSize.Small, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Caption
        {
            Value = _viewModel.LoadingLabel,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, _viewModel.LoadingLabel);
        LiveRegion.Configure(row);
        LiveRegion.Announce(row);
        return row;
    }

    private static Caption BuildHint(string message)
    {
        var caption = new Caption
        {
            Value = message,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(caption, message);
        return caption;
    }

    private StackPanel BuildSuccess()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = "\uE73E", // Segoe Fluent — CheckMark
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Text
        {
            Value = _viewModel.StartedLabel,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, _viewModel.StartedLabel);
        LiveRegion.Configure(row);
        LiveRegion.Announce(row);
        return row;
    }

    private StackPanel BuildError()
    {
        var message = _viewModel.ErrorMessage ?? UserImpersonateButtonRegistration.StatusErrorLabel(_localizer);

        var textRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        textRow.Children.Add(new FontIcon
        {
            Glyph = ErrorGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        textRow.Children.Add(new Text
        {
            Value = message,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var retry = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.RetryLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(retry, _viewModel.RetryLabel);
        retry.Click += OnRetryClick;

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(textRow);
        column.Children.Add(retry);

        AutomationProperties.SetName(column, message);
        LiveRegion.Configure(column, assertive: true);
        LiveRegion.Announce(column);
        return column;
    }

    private void OnRetryClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    // ── Confirmation dialog ────────────────────────────────────────────────────────────────────────────

    private void SyncConfirmDialog()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.IsConfirmOpen)
        {
            ShowConfirmDialog();
        }
        else
        {
            DismissConfirmDialog();
        }
    }

    private void ShowConfirmDialog()
    {
        if (_confirmDialog is not null || XamlRoot is null)
        {
            return;
        }

        var iconRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        iconRow.Children.Add(new FontIcon
        {
            Glyph = WarningGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });
        iconRow.Children.Add(new TextBlock
        {
            Text = _viewModel.ConfirmMessage,
            TextWrapping = TextWrapping.Wrap,
            FontWeight = FontWeights.Normal,
            Foreground = DisplayTokens.TextPrimary,
            MaxWidth = 360,
        });

        var dialog = new TsConfirmDialog
        {
            Title = _viewModel.ConfirmTitle,
            Content = iconRow,
            PrimaryButtonText = _viewModel.ConfirmConfirmLabel,
            CloseButtonText = _viewModel.ConfirmCancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };
        dialog.PrimaryButtonClick += OnConfirmPrimary;
        dialog.CloseButtonClick += OnConfirmClose;

        _confirmDialog = dialog;
        _ = dialog.ShowAsync();
    }

    private void DismissConfirmDialog()
    {
        if (_confirmDialog is not { } dialog)
        {
            return;
        }

        _confirmDialog = null;
        dialog.PrimaryButtonClick -= OnConfirmPrimary;
        dialog.CloseButtonClick -= OnConfirmClose;
        dialog.Hide();
    }

    private void OnConfirmPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _confirmDialog = null;
        sender.PrimaryButtonClick -= OnConfirmPrimary;
        sender.CloseButtonClick -= OnConfirmClose;
        _ = _viewModel.ConfirmStartAsync();
    }

    private void OnConfirmClose(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _confirmDialog = null;
        sender.PrimaryButtonClick -= OnConfirmPrimary;
        sender.CloseButtonClick -= OnConfirmClose;
        _viewModel.CancelStart();
    }
}
