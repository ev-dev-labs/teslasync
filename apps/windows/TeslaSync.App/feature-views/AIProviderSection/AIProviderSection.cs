using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 provider-configuration surface — a parity port of
/// web/src/features/settings/components/AIProviderSection.tsx. The web section is a <em>controlled</em> form
/// (its draft + cloud flag arrive as props and edits flow back through <c>onChange</c>), so there is no
/// data-fetch loading / empty / error / stale / offline branch to reproduce; the only network effect it owns is
/// the pre-flight Validate probe (web <c>useValidateAiProvider</c>), whose idle / validating / OK / rejected /
/// faulted states are all rendered. It composes the provider + model row, the Azure surface + api-version row
/// and Azure chat / embedding deployment inputs (behind the <c>flavor !== 'foundry'</c> guard), the local Base
/// URL + Validate row, the Azure resource-endpoint URL, the cloud API key (a masked field) + daily cost cap +
/// Validate row, the local-only privacy explainer and the trailing "validation is optional" helper. User-owned
/// inputs are created once and only their values / labels / visibility refresh on each notification, so the
/// operator's caret is never disturbed. Every string resolves through the i18n facade and every interactive
/// element carries a Narrator name. All validation flows through the shared
/// <see cref="AiProviderSectionViewModel"/>; the view never performs HTTP.
/// </summary>
public sealed partial class AIProviderSection : ContentControl, IDisposable
{
    private readonly AiProviderSectionViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AiProviderSectionDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _section = new();
    private readonly StackPanel _root = new() { Spacing = 12 };

    private readonly Subhead _title = new();

    private readonly TextBlock _providerLabel = FieldLabel();
    private readonly TsSelect _providerSelect = new();
    private readonly TextBlock _modelLabel = FieldLabel();
    private readonly TsInput _modelInput = new();
    private readonly HelperText _modelHint = new();

    private readonly StackPanel _azureGroup = new() { Spacing = 12 };
    private readonly TextBlock _flavorLabel = FieldLabel();
    private readonly TsSelect _flavorSelect = new();
    private readonly TextBlock _apiVersionLabel = FieldLabel();
    private readonly TsInput _apiVersionInput = new();
    private readonly HelperText _apiVersionHint = new();
    private readonly Grid _azureDeploymentRow = TwoColumnGrid();
    private readonly TextBlock _deploymentLabel = FieldLabel();
    private readonly TsInput _deploymentInput = new();
    private readonly HelperText _deploymentHint = new();
    private readonly TextBlock _embeddingLabel = FieldLabel();
    private readonly TsInput _embeddingInput = new();

    private readonly StackPanel _localGroup = new() { Spacing = 6 };
    private readonly TextBlock _localBaseUrlLabel = FieldLabel();
    private readonly TsInput _localBaseUrlInput = new();
    private readonly HelperText _localBaseUrlHint = new();
    private readonly TsButton _localValidateButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TextBlock _localBanner = BannerText();

    private readonly StackPanel _azureBaseUrlGroup = new() { Spacing = 4 };
    private readonly TextBlock _azureBaseUrlLabel = FieldLabel();
    private readonly TsInput _azureBaseUrlInput = new();
    private readonly HelperText _azureBaseUrlHint = new();

    private readonly StackPanel _cloudGroup = new() { Spacing = 12 };
    private readonly TextBlock _apiKeyLabel = FieldLabel();
    private readonly PasswordBox _apiKeyBox = new();
    private readonly HelperText _apiKeyHint = new();
    private readonly TextBlock _costCapLabel = FieldLabel();
    private readonly TsInput _costCapInput = new();
    private readonly HelperText _costCapHint = new();
    private readonly TsButton _cloudValidateButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TextBlock _cloudBanner = BannerText();

    private readonly Caption _localExplainer = new();
    private readonly HelperText _validateHelp = new();

    private string _providerOptionsSignature = string.Empty;
    private string _flavorOptionsSignature = string.Empty;
    private string? _lastLocalBannerText;
    private string? _lastCloudBannerText;

    private bool _started;
    private bool _renderQueued;
    private bool _syncing;
    private bool _disposed;

    /// <summary>Creates the surface over its validation source, localizer and (optional) diagnostics.</summary>
    public AIProviderSection(
        IAiProviderValidationSource source,
        ILocalizer localizer,
        AiProviderSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AiProviderSectionDiagnostics();
        _viewModel = new AiProviderSectionViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _providerSelect.SelectionChanged += OnProviderChanged;
        _flavorSelect.SelectionChanged += OnFlavorChanged;
        _modelInput.TextChanged += OnModelChanged;
        _apiVersionInput.TextChanged += OnApiVersionChanged;
        _deploymentInput.TextChanged += OnDeploymentChanged;
        _embeddingInput.TextChanged += OnEmbeddingChanged;
        _localBaseUrlInput.TextChanged += OnBaseUrlChanged;
        _azureBaseUrlInput.TextChanged += OnBaseUrlChanged;
        _apiKeyBox.PasswordChanged += OnApiKeyChanged;
        _costCapInput.TextChanged += OnCostCapChanged;
        _costCapInput.LostFocus += OnCostCapLostFocus;
        _localValidateButton.Click += OnValidateClick;
        _cloudValidateButton.Click += OnValidateClick;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Content = _section;
        Render();
    }

    /// <summary>The canonical surface id (<c>ai-provider-section</c>).</summary>
    public static string SurfaceId => AiProviderSectionRegistration.Id;

    /// <summary>The diagnostics surface slug (<c>AIProviderSection</c>).</summary>
    public static string Slug => AiProviderSectionRegistration.Slug;

    /// <summary>The backing state holder — the host drives the draft / cloud flag through it.</summary>
    public AiProviderSectionViewModel ViewModel => _viewModel;

    /// <summary>Adopt the host's draft + cloud flag (web controlled-component prop wiring).</summary>
    public void Initialize(AiProviderDraft draft, bool isCloud) => _viewModel.Initialize(draft, isCloud);

    /// <summary>Convenience factory wiring the shared contract client into the validation source.</summary>
    public static AIProviderSection Create(
        IApiClient api,
        ILocalizer localizer,
        AiProviderSectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        return new AIProviderSection(new AiProviderValidationSource(api), localizer, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight probe (idempotent).</summary>
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

    // ── Chrome ─────────────────────────────────────────────────────────────────────────────────────────

    private void BuildChrome()
    {
        _section.BorderBrush = DisplayTokens.Border;
        _section.BorderThickness = new Thickness(1);
        _section.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _section.Padding = new Thickness(16);
        _section.Child = _root;

        _modelInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _apiVersionInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _deploymentInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _embeddingInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _localBaseUrlInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _azureBaseUrlInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _costCapInput.HorizontalAlignment = HorizontalAlignment.Stretch;
        _apiKeyBox.HorizontalAlignment = HorizontalAlignment.Stretch;
        _providerSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _flavorSelect.HorizontalAlignment = HorizontalAlignment.Stretch;

        _root.Children.Add(_title);
        _root.Children.Add(BuildProviderModelRow());
        _root.Children.Add(BuildAzureGroup());
        _root.Children.Add(BuildLocalGroup());
        _root.Children.Add(BuildAzureBaseUrlGroup());
        _root.Children.Add(BuildCloudGroup());
        _root.Children.Add(_localExplainer);
        _root.Children.Add(_validateHelp);
    }

    private Grid BuildProviderModelRow()
    {
        var grid = TwoColumnGrid();
        PlaceLeft(grid, LabeledField(_providerLabel, _providerSelect, hint: null));
        PlaceRight(grid, LabeledField(_modelLabel, _modelInput, _modelHint));
        return grid;
    }

    private StackPanel BuildAzureGroup()
    {
        var topRow = TwoColumnGrid();
        PlaceLeft(topRow, LabeledField(_flavorLabel, _flavorSelect, hint: null));
        PlaceRight(topRow, LabeledField(_apiVersionLabel, _apiVersionInput, _apiVersionHint));

        PlaceLeft(_azureDeploymentRow, LabeledField(_deploymentLabel, _deploymentInput, _deploymentHint));
        PlaceRight(_azureDeploymentRow, LabeledField(_embeddingLabel, _embeddingInput, hint: null));

        _azureGroup.Children.Add(topRow);
        _azureGroup.Children.Add(_azureDeploymentRow);
        return _azureGroup;
    }

    private StackPanel BuildLocalGroup()
    {
        _localGroup.Children.Add(LabeledField(_localBaseUrlLabel, _localBaseUrlInput, _localBaseUrlHint));
        _localGroup.Children.Add(BuildValidateRow(_localValidateButton, _localBanner));
        return _localGroup;
    }

    private StackPanel BuildAzureBaseUrlGroup()
    {
        _azureBaseUrlGroup.Children.Add(
            LabeledField(_azureBaseUrlLabel, _azureBaseUrlInput, _azureBaseUrlHint));
        return _azureBaseUrlGroup;
    }

    private StackPanel BuildCloudGroup()
    {
        _cloudGroup.Children.Add(LabeledField(_apiKeyLabel, _apiKeyBox, _apiKeyHint));
        _cloudGroup.Children.Add(LabeledField(_costCapLabel, _costCapInput, _costCapHint));
        _cloudGroup.Children.Add(BuildValidateRow(_cloudValidateButton, _cloudBanner));
        return _cloudGroup;
    }

    private static StackPanel BuildValidateRow(TsButton button, TextBlock banner)
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        banner.VerticalAlignment = VerticalAlignment.Center;
        LiveRegion.Configure(banner);
        row.Children.Add(button);
        row.Children.Add(banner);
        return row;
    }

    // ── Render (refresh; no input control is ever recreated) ─────────────────────────────────────────────

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
    }

    private void Render()
    {
        _syncing = true;
        try
        {
            _title.Value = _viewModel.SectionTitle;
            AutomationProperties.SetName(_section, _viewModel.SectionTitle);

            // Provider + model.
            _providerLabel.Text = _viewModel.ProviderLabel;
            SyncSelect(_providerSelect, _viewModel.ProviderOptions, _viewModel.ProviderValue, ref _providerOptionsSignature);
            AutomationProperties.SetName(_providerSelect, _viewModel.ProviderLabel);

            _modelLabel.Text = _viewModel.ModelLabel;
            SetText(_modelInput, _viewModel.ModelValue);
            _modelInput.Hint = _viewModel.ModelPrompt;
            AutomationProperties.SetName(_modelInput, _viewModel.ModelLabel);
            SetHint(_modelHint, _viewModel.ModelHint);

            // Azure surface + deployments.
            _azureGroup.Visibility = Show(_viewModel.ShowAzureFields);
            _flavorLabel.Text = _viewModel.AzureFlavorLabel;
            SyncSelect(_flavorSelect, _viewModel.FlavorOptions, _viewModel.FlavorValue, ref _flavorOptionsSignature);
            AutomationProperties.SetName(_flavorSelect, _viewModel.AzureFlavorLabel);

            _apiVersionLabel.Text = _viewModel.AzureApiVersionLabel;
            SetText(_apiVersionInput, _viewModel.ApiVersionValue);
            _apiVersionInput.Hint = _viewModel.AzureApiVersionPrompt;
            AutomationProperties.SetName(_apiVersionInput, _viewModel.AzureApiVersionLabel);
            SetHint(_apiVersionHint, _viewModel.AzureApiVersionHint);

            _azureDeploymentRow.Visibility = Show(_viewModel.ShowAzureDeploymentFields);
            _deploymentLabel.Text = _viewModel.AzureDeploymentLabel;
            SetText(_deploymentInput, _viewModel.DeploymentValue);
            _deploymentInput.Hint = _viewModel.AzureDeploymentPrompt;
            AutomationProperties.SetName(_deploymentInput, _viewModel.AzureDeploymentLabel);
            SetHint(_deploymentHint, _viewModel.AzureDeploymentHint);

            _embeddingLabel.Text = _viewModel.AzureEmbeddingDeploymentLabel;
            SetText(_embeddingInput, _viewModel.EmbeddingDeploymentValue);
            _embeddingInput.Hint = _viewModel.AzureEmbeddingDeploymentPrompt;
            AutomationProperties.SetName(_embeddingInput, _viewModel.AzureEmbeddingDeploymentLabel);

            // Local base URL + validate.
            _localGroup.Visibility = Show(_viewModel.ShowLocalBaseUrl);
            _localBaseUrlLabel.Text = _viewModel.BaseUrlLabel;
            SetText(_localBaseUrlInput, _viewModel.BaseUrlValue);
            _localBaseUrlInput.Hint = _viewModel.BaseUrlPrompt;
            AutomationProperties.SetName(_localBaseUrlInput, _viewModel.BaseUrlLabel);
            SetHint(_localBaseUrlHint, _viewModel.BaseUrlHint);

            // Azure resource endpoint URL.
            _azureBaseUrlGroup.Visibility = Show(_viewModel.ShowAzureBaseUrl);
            _azureBaseUrlLabel.Text = _viewModel.AzureBaseUrlLabel;
            SetText(_azureBaseUrlInput, _viewModel.BaseUrlValue);
            _azureBaseUrlInput.Hint = _viewModel.AzureBaseUrlPrompt;
            AutomationProperties.SetName(_azureBaseUrlInput, _viewModel.AzureBaseUrlLabel);
            SetHint(_azureBaseUrlHint, _viewModel.AzureBaseUrlHint);

            // Cloud API key + cost cap + validate.
            _cloudGroup.Visibility = Show(_viewModel.ShowCloudFields);
            _apiKeyLabel.Text = _viewModel.ApiKeyLabel;
            SetPassword(_apiKeyBox, _viewModel.ApiKeyValue);
            _apiKeyBox.PlaceholderText = _viewModel.ApiKeyPrompt; // parity:allow PlaceholderText is the WinUI prompt API
            AutomationProperties.SetName(_apiKeyBox, _viewModel.ApiKeyLabel);
            SetHint(_apiKeyHint, _viewModel.ApiKeyHint);

            _costCapLabel.Text = _viewModel.CostCapLabel;
            if (_costCapInput.FocusState == FocusState.Unfocused)
            {
                SetText(_costCapInput, _viewModel.CostCapText);
            }

            _costCapInput.Hint = _viewModel.CostCapPrompt;
            AutomationProperties.SetName(_costCapInput, _viewModel.CostCapLabel);
            SetHint(_costCapHint, _viewModel.CostCapHint);

            // Validate buttons (local + cloud share one busy / enabled / banner state).
            ApplyValidateButton(_localValidateButton);
            ApplyValidateButton(_cloudValidateButton);
            ApplyBanner(_localBanner, ref _lastLocalBannerText);
            ApplyBanner(_cloudBanner, ref _lastCloudBannerText);

            // Trailing copy.
            _localExplainer.Value = _viewModel.LocalExplainer;
            _localExplainer.Visibility = Show(_viewModel.ShowLocalExplainer);
            _validateHelp.Value = _viewModel.ValidateOptionalHelp;
        }
        finally
        {
            _syncing = false;
        }
    }

    private void ApplyValidateButton(TsButton button)
    {
        button.Text = _viewModel.ValidateButtonLabel;
        button.IsLoading = _viewModel.IsValidating;
        button.IsEnabled = _viewModel.CanValidate;
        AutomationProperties.SetName(button, _viewModel.ValidateButtonLabel);
    }

    private void ApplyBanner(TextBlock banner, ref string? lastText)
    {
        if (_viewModel.Banner is { } current)
        {
            banner.Text = current.Message;
            banner.Foreground = current.Kind == AiProviderBannerKind.Ok
                ? DisplayTokens.Brush("TsColorSuccessBrush")
                : DisplayTokens.Brush("TsColorDangerBrush");
            banner.Visibility = Visibility.Visible;
            if (!string.Equals(lastText, current.Message, StringComparison.Ordinal))
            {
                LiveRegion.Announce(banner);
            }

            lastText = current.Message;
        }
        else
        {
            banner.Text = string.Empty;
            banner.Visibility = Visibility.Collapsed;
            lastText = null;
        }
    }

    private static void SyncSelect(
        TsSelect select,
        IReadOnlyList<AiProviderOption> options,
        string selectedValue,
        ref string signature)
    {
        var sig = string.Join("|", options.Select(o => o.Value));
        if (!string.Equals(sig, signature, StringComparison.Ordinal))
        {
            select.Items.Clear();
            foreach (var option in options)
            {
                select.Items.Add(new ComboBoxItem { Content = option.Label, Tag = option.Value });
            }

            signature = sig;
        }

        ComboBoxItem? match = null;
        foreach (var item in select.Items.OfType<ComboBoxItem>())
        {
            if (item.Tag is string tag && string.Equals(tag, selectedValue, StringComparison.Ordinal))
            {
                match = item;
                break;
            }
        }

        if (!ReferenceEquals(select.SelectedItem, match))
        {
            select.SelectedItem = match;
        }
    }

    // ── Input event handlers (suppressed while the view writes values back) ───────────────────────────────

    private void OnProviderChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing || _providerSelect.SelectedItem is not ComboBoxItem { Tag: string value })
        {
            return;
        }

        _viewModel.SetProvider(value);
    }

    private void OnFlavorChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing || _flavorSelect.SelectedItem is not ComboBoxItem { Tag: string value })
        {
            return;
        }

        _viewModel.SetFlavor(value);
    }

    private void OnModelChanged(object sender, TextChangedEventArgs e)
    {
        if (!_syncing)
        {
            _viewModel.SetModel(_modelInput.Text);
        }
    }

    private void OnApiVersionChanged(object sender, TextChangedEventArgs e)
    {
        if (!_syncing)
        {
            _viewModel.SetApiVersion(_apiVersionInput.Text);
        }
    }

    private void OnDeploymentChanged(object sender, TextChangedEventArgs e)
    {
        if (!_syncing)
        {
            _viewModel.SetDeployment(_deploymentInput.Text);
        }
    }

    private void OnEmbeddingChanged(object sender, TextChangedEventArgs e)
    {
        if (!_syncing)
        {
            _viewModel.SetEmbeddingDeployment(_embeddingInput.Text);
        }
    }

    private void OnBaseUrlChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing || sender is not TsInput input)
        {
            return;
        }

        _viewModel.SetBaseUrl(input.Text);
    }

    private void OnApiKeyChanged(object sender, RoutedEventArgs e)
    {
        if (!_syncing)
        {
            _viewModel.SetApiKey(_apiKeyBox.Password);
        }
    }

    private void OnCostCapChanged(object sender, TextChangedEventArgs e)
    {
        if (!_syncing)
        {
            _viewModel.SetCostCapFromDollars(_costCapInput.Text);
        }
    }

    private void OnCostCapLostFocus(object sender, RoutedEventArgs e)
    {
        // Re-format the committed cap to two decimals on blur (the native idiom for the web number field).
        _syncing = true;
        _costCapInput.Text = _viewModel.CostCapText;
        _syncing = false;
    }

    private void OnValidateClick(object sender, RoutedEventArgs e) => _ = _viewModel.ValidateAsync();

    private static void SetText(TsInput input, string value)
    {
        if (!string.Equals(input.Text, value, StringComparison.Ordinal))
        {
            input.Text = value;
        }
    }

    private static void SetPassword(PasswordBox box, string value)
    {
        if (!string.Equals(box.Password, value, StringComparison.Ordinal))
        {
            box.Password = value;
        }
    }

    private static void SetHint(HelperText hint, string? value)
    {
        hint.Value = value ?? string.Empty;
        hint.Visibility = string.IsNullOrEmpty(value) ? Visibility.Collapsed : Visibility.Visible;
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    // ── Small builders ───────────────────────────────────────────────────────────────────────────────────

    private static StackPanel LabeledField(TextBlock label, FrameworkElement control, HelperText? hint)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(label);
        stack.Children.Add(control);
        if (hint is not null)
        {
            stack.Children.Add(hint);
        }

        return stack;
    }

    private static TextBlock FieldLabel() => new()
    {
        FontSize = 13,
        FontWeight = FontWeights.Medium,
        Foreground = DisplayTokens.TextSecondary,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock BannerText() => new()
    {
        FontSize = 12,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
    };

    private static Grid TwoColumnGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        return grid;
    }

    private static void PlaceLeft(Grid grid, FrameworkElement element)
    {
        Grid.SetColumn(element, 0);
        grid.Children.Add(element);
    }

    private static void PlaceRight(Grid grid, FrameworkElement element)
    {
        Grid.SetColumn(element, 1);
        grid.Children.Add(element);
    }
}
