using System.Text.Json;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using Windows.Storage;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 <c>PrivacySection</c> feature surface — a parity port of
/// web/src/features/settings/components/PrivacySection.tsx. Inside a tokenized <see cref="TsGlassPanel"/> it
/// reproduces the web component's shield-headed "Privacy" header and its two always-rendered control panels:
/// the recent-pages clearer (a stored-entries counter and a destructive <see cref="TsConfirmDialog"/>-gated
/// "Clear recent pages" action with the web's "Don't ask again" silence opt-in) and the cookie / analytics
/// consent manager (the current decision label, a consent-aware body copy, and grant / withdraw / reset
/// actions). The consent body follows the deployment-wide <c>require_cookie_consent</c> flag read through the
/// shared <see cref="PrivacySectionViewModel"/> (the web <c>useVersionInfo</c> query); that read's
/// loading / live / stale / offline / error states surface as a freshness chip and a retry affordance without
/// ever hiding a panel. Each successful action announces an inline status line (the web <c>useToast</c>
/// success, mapped to this codebase's inline-announce convention). The view never performs HTTP or reads a
/// client store directly. Every string resolves through the i18n facade, every interactive element carries a
/// Narrator name, and the surface adds no bespoke motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class PrivacySection : ContentControl, IDisposable
{
    private const string ConsentTokenSettingKey = "teslasync.cookie_consent";
    private const string SilenceSettingKey = "teslasync.confirm_silence";

    private const double PanelPadding = 20;       // web p-5
    private const double InnerPanelPadding = 16;  // web p-4
    private const double IconBoxSize = 40;        // web h-10 w-10

    private readonly PrivacySectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly PrivacySectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new();
    private readonly StackPanel _root = new() { Spacing = 16 };

    private TsConfirmDialog? _confirmDialog;
    private TsCheckbox? _silenceCheckbox;
    private string? _announcedStatus;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its requirement source, localizer and (optional) client stores.</summary>
    /// <param name="requirementSource">The cache-then-network <c>require_cookie_consent</c> read.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="recentPages">The shared recent-pages store (defaults to the process-wide store).</param>
    /// <param name="consent">The cookie-consent decision store (defaults to an in-memory store).</param>
    /// <param name="silence">The clear-confirmation silence allowlist (defaults to an in-memory store).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public PrivacySection(
        IConsentRequirementSource requirementSource,
        ILocalizer localizer,
        RecentlyViewedSource? recentPages = null,
        IConsentSource? consent = null,
        IConfirmSilenceStore? silence = null,
        PrivacySectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(requirementSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new PrivacySectionDiagnostics();
        _viewModel = new PrivacySectionViewModel(
            recentPages ?? RecentlyViewedSource.Shared,
            consent ?? new ConsentSource(),
            silence ?? new ConfirmSilenceStore(),
            requirementSource,
            localizer,
            _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "privacy-section");
        AutomationProperties.SetName(this, _viewModel.Title);

        _panel.Padding = new Thickness(PanelPadding);
        _panel.Content = _root;
        Content = _panel;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface slug (<c>PrivacySection</c>).</summary>
    public static string SurfaceId => PrivacySectionRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public PrivacySectionViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the repository-backed <see cref="ConsentRequirementSource"/> from the shared
    /// data layer, the process-wide recent-pages store, and <c>ApplicationData.LocalSettings</c>-backed consent
    /// and silence stores so both survive a restart exactly as the web localStorage stores survive a reload.
    /// </summary>
    public static PrivacySection Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        PrivacySectionDiagnostics? diagnostics = null)
    {
        var requirement = new ConsentRequirementSource(api, engine, options);
        var consent = new ConsentSource(ReadConsentToken, WriteConsentToken);
        var silence = new ConfirmSilenceStore(ReadSilenceSet, WriteSilenceSet);
        return new PrivacySection(requirement, localizer, RecentlyViewedSource.Shared, consent, silence, diagnostics);
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
        AutomationProperties.SetName(this, _viewModel.Title);

        _root.Children.Clear();
        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildRecentPanel());
        _root.Children.Add(BuildConsentPanel());

        var status = BuildStatusLine();
        if (status is not null)
        {
            _root.Children.Add(status);
        }
    }

    // ── Header (web IconBox + ShieldCheck + title + subtitle) ────────────────────────────────────────────

    private StackPanel BuildHeader()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };

        var iconBox = new Border
        {
            Width = IconBoxSize,
            Height = IconBoxSize,
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            BorderBrush = DisplayTokens.Brush("TsColorInfoBrush"),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
            Child = new FontIcon
            {
                Glyph = PrivacySectionRegistration.HeaderGlyph,
                FontSize = 20,
                Foreground = DisplayTokens.Brush("TsColorInfoBrush"),
            },
        };
        AutomationProperties.SetAccessibilityView(iconBox, AccessibilityView.Raw);

        var titleText = new PanelTitle { Value = _viewModel.Title, Foreground = DisplayTokens.TextPrimary };
        AutomationProperties.SetHeadingLevel(titleText, AutomationHeadingLevel.Level2);

        var titleColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        titleColumn.Children.Add(titleText);
        titleColumn.Children.Add(new Caption { Value = _viewModel.Subtitle });

        row.Children.Add(iconBox);
        row.Children.Add(titleColumn);
        return row;
    }

    // ── Recent pages panel (web recentPages.*) ───────────────────────────────────────────────────────────

    private Border BuildRecentPanel()
    {
        var grid = new Grid { ColumnSpacing = 16, RowSpacing = 4 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var text = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Top };
        var title = new TextBlock
        {
            Text = _viewModel.RecentClearTitle,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };
        text.Children.Add(title);
        text.Children.Add(new Caption { Value = _viewModel.RecentClearBody });

        var count = new Caption { Value = _viewModel.RecentCountLabel };
        AutomationProperties.SetAutomationId(count, "privacy-recent-count");
        AutomationProperties.SetName(count, _viewModel.RecentCountLabel);
        text.Children.Add(count);
        Grid.SetColumn(text, 0);

        var clearButton = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Text = _viewModel.RecentClearButton,
            IconGlyph = PrivacySectionRegistration.ClearGlyph,
            IsEnabled = _viewModel.CanClearRecentPages,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetName(clearButton, _viewModel.RecentClearButton);
        AutomationProperties.SetAutomationId(clearButton, "privacy-clear-recent-pages");
        clearButton.Click += OnClearClick;
        Grid.SetColumn(clearButton, 1);

        grid.Children.Add(text);
        grid.Children.Add(clearButton);
        return InnerPanel(grid, automationId: null);
    }

    private void OnClearClick(object sender, RoutedEventArgs e) => _viewModel.BeginClearRecentPages();

    // ── Consent panel (web consent.*) ────────────────────────────────────────────────────────────────────

    private Border BuildConsentPanel()
    {
        var column = new StackPanel { Spacing = 8 };

        // Header row: title + freshness chrome (loading caption / freshness chip).
        var header = new Grid { ColumnSpacing = 12 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock
        {
            Text = _viewModel.ConsentSectionTitle,
            FontSize = 14,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level3);
        Grid.SetColumn(title, 0);

        var freshness = BuildRequirementChrome();
        Grid.SetColumn(freshness, 1);

        header.Children.Add(title);
        header.Children.Add(freshness);
        column.Children.Add(header);

        // Body copy (web requireConsent ? bodyOn : bodyOff).
        column.Children.Add(new Caption { Value = _viewModel.ConsentBody });

        // Current decision label (web consentLabel).
        var stateLabel = new Caption { Value = _viewModel.ConsentStateLabel };
        AutomationProperties.SetAutomationId(stateLabel, "privacy-consent-state");
        AutomationProperties.SetName(stateLabel, _viewModel.ConsentStateLabel);
        column.Children.Add(stateLabel);

        // Hard-failure inline error + retry (the panel itself is never hidden).
        if (_viewModel.RequirementState == PrivacyRequirementState.Error
            && _viewModel.RequirementErrorMessage is { } errorMessage)
        {
            column.Children.Add(BuildRequirementError(errorMessage));
        }

        // Actions: grant / withdraw / reset (web consent.action.*).
        column.Children.Add(BuildConsentActions());

        return InnerPanel(column, automationId: "privacy-consent-section");
    }

    private FrameworkElement BuildRequirementChrome()
    {
        if (_viewModel.RequirementState == PrivacyRequirementState.Loading)
        {
            var loadingRow = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                VerticalAlignment = VerticalAlignment.Center,
            };
            loadingRow.Children.Add(new TsSpinner { Size = ControlSize.Small, VerticalAlignment = VerticalAlignment.Center });
            string loadingLabel = PrivacySectionRegistration.RequirementLoadingLabel(_localizer);
            loadingRow.Children.Add(new Caption { Value = loadingLabel, VerticalAlignment = VerticalAlignment.Center });
            AutomationProperties.SetName(loadingRow, loadingLabel);
            LiveRegion.Configure(loadingRow);
            return loadingRow;
        }

        return new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Center,
        };
    }

    private StackPanel BuildRequirementError(string message)
    {
        var column = new StackPanel { Spacing = 6 };

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new FontIcon
        {
            Glyph = "\uE783", // Segoe Fluent — Error / cloud-off
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Text
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
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(retry, _viewModel.RetryLabel);
        retry.Click += OnRetryClick;

        column.Children.Add(row);
        column.Children.Add(retry);
        AutomationProperties.SetName(column, message);
        LiveRegion.Configure(column, assertive: true);
        LiveRegion.Announce(column);
        return column;
    }

    private void OnRetryClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private StackPanel BuildConsentActions()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };

        var accept = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Text = _viewModel.ConsentAcceptLabel,
            IsEnabled = _viewModel.CanAcceptConsent,
        };
        AutomationProperties.SetName(accept, _viewModel.ConsentAcceptLabel);
        AutomationProperties.SetAutomationId(accept, "privacy-consent-accept");
        accept.Click += OnAcceptClick;

        var decline = new TsButton
        {
            Variant = ButtonVariant.Secondary,
            Text = _viewModel.ConsentDeclineLabel,
            IsEnabled = _viewModel.CanDeclineConsent,
        };
        AutomationProperties.SetName(decline, _viewModel.ConsentDeclineLabel);
        AutomationProperties.SetAutomationId(decline, "privacy-consent-decline");
        decline.Click += OnDeclineClick;

        var reset = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Text = _viewModel.ConsentResetLabel,
            IsEnabled = _viewModel.CanResetConsent,
        };
        AutomationProperties.SetName(reset, _viewModel.ConsentResetLabel);
        AutomationProperties.SetAutomationId(reset, "privacy-consent-reset");
        reset.Click += OnResetClick;

        row.Children.Add(accept);
        row.Children.Add(decline);
        row.Children.Add(reset);
        return row;
    }

    private void OnAcceptClick(object sender, RoutedEventArgs e) => _viewModel.AcceptConsent();

    private void OnDeclineClick(object sender, RoutedEventArgs e) => _viewModel.DeclineConsent();

    private void OnResetClick(object sender, RoutedEventArgs e) => _viewModel.ResetConsent();

    // ── Inline status line (web toast.success) ───────────────────────────────────────────────────────────

    private StackPanel? BuildStatusLine()
    {
        if (_viewModel.StatusMessage is not { Length: > 0 } message)
        {
            _announcedStatus = null;
            return null;
        }

        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = PrivacySectionRegistration.SuccessGlyph,
            FontSize = 14,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });
        row.Children.Add(new Text
        {
            Value = message,
            Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, message);
        LiveRegion.Configure(row);
        if (!string.Equals(_announcedStatus, message, StringComparison.Ordinal))
        {
            _announcedStatus = message;
            LiveRegion.Announce(row);
        }

        return row;
    }

    // ── Clear confirmation dialog (web ConfirmDialog) ────────────────────────────────────────────────────

    private void SyncConfirmDialog()
    {
        if (_disposed)
        {
            return;
        }

        if (_viewModel.IsClearConfirmOpen)
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

        var content = new StackPanel { Spacing = 12 };

        var messageRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        messageRow.Children.Add(new FontIcon
        {
            Glyph = PrivacySectionRegistration.WarningGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            VerticalAlignment = VerticalAlignment.Top,
        });
        messageRow.Children.Add(new TextBlock
        {
            Text = _viewModel.ClearConfirmBody,
            TextWrapping = TextWrapping.Wrap,
            Foreground = DisplayTokens.TextPrimary,
            MaxWidth = 360,
        });
        content.Children.Add(messageRow);

        // Web "Don't ask again" silence opt-in (honoured for the warning variant).
        _silenceCheckbox = new TsCheckbox
        {
            IsChecked = false,
            Content = new Caption { Value = _viewModel.SilenceCheckboxLabel },
        };
        AutomationProperties.SetName(_silenceCheckbox, _viewModel.SilenceCheckboxLabel);
        content.Children.Add(_silenceCheckbox);

        var dialog = new TsConfirmDialog
        {
            Title = _viewModel.ClearConfirmTitle,
            Content = content,
            PrimaryButtonText = _viewModel.ClearConfirmCta,
            CloseButtonText = _viewModel.CancelLabel,
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
        _silenceCheckbox = null;
        dialog.PrimaryButtonClick -= OnConfirmPrimary;
        dialog.CloseButtonClick -= OnConfirmClose;
        dialog.Hide();
    }

    private void OnConfirmPrimary(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        bool dontAskAgain = _silenceCheckbox?.IsChecked == true;
        _confirmDialog = null;
        _silenceCheckbox = null;
        sender.PrimaryButtonClick -= OnConfirmPrimary;
        sender.CloseButtonClick -= OnConfirmClose;
        _viewModel.ConfirmClearRecentPages(dontAskAgain);
    }

    private void OnConfirmClose(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _confirmDialog = null;
        _silenceCheckbox = null;
        sender.PrimaryButtonClick -= OnConfirmPrimary;
        sender.CloseButtonClick -= OnConfirmClose;
        _viewModel.CancelClearRecentPages();
    }

    // ── Shared chrome helpers ────────────────────────────────────────────────────────────────────────────

    private static Border InnerPanel(UIElement child, string? automationId)
    {
        var border = new Border
        {
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = DisplayTokens.Radius("TsRadiusLg", 12),
            Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
            Padding = new Thickness(InnerPanelPadding),
            Child = child,
        };

        if (automationId is not null)
        {
            AutomationProperties.SetAutomationId(border, automationId);
        }

        return border;
    }

    // ── LocalSettings persistence (web localStorage parity; best-effort) ─────────────────────────────────

    private static string? ReadConsentToken()
    {
        try
        {
            return ApplicationData.Current.LocalSettings.Values.TryGetValue(ConsentTokenSettingKey, out var value)
                ? value as string
                : null;
        }
        catch (Exception)
        {
            // No package identity (unpackaged dev run) — fall back to "not decided".
            return null;
        }
    }

    private static void WriteConsentToken(string? token)
    {
        try
        {
            var values = ApplicationData.Current.LocalSettings.Values;
            if (token is null)
            {
                values.Remove(ConsentTokenSettingKey);
            }
            else
            {
                values[ConsentTokenSettingKey] = token;
            }
        }
        catch (Exception)
        {
            // Best-effort persistence; a failed write simply re-prompts on the next launch (the safe default).
        }
    }

    private static string[] ReadSilenceSet()
    {
        try
        {
            if (ApplicationData.Current.LocalSettings.Values.TryGetValue(SilenceSettingKey, out var value)
                && value is string raw
                && !string.IsNullOrEmpty(raw))
            {
                return JsonSerializer.Deserialize<string[]>(raw) ?? Array.Empty<string>();
            }
        }
        catch (Exception)
        {
            // No identity or a malformed payload — start from an empty allowlist (the dialog re-prompts).
        }

        return Array.Empty<string>();
    }

    private static void WriteSilenceSet(IReadOnlyCollection<string> keys)
    {
        try
        {
            ApplicationData.Current.LocalSettings.Values[SilenceSettingKey] = JsonSerializer.Serialize(keys);
        }
        catch (Exception)
        {
            // Best-effort persistence; a failed write simply re-prompts next time (the safe default).
        }
    }
}
