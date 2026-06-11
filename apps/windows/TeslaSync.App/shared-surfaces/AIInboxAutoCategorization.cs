using System.Net.Http;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Auth;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 inbox auto-categorization card — a parity port of the web
/// <c>AIInboxAutoCategorization</c> (web/src/components/ai/AIInboxAutoCategorization.tsx) composed with its
/// shared <c>AIFeatureCard</c> scaffold and the <c>withAiFeature</c> gate. Inside a tokenized glass card it
/// renders a header (title + "Helix" badge + description), the universal "Ask Helix" action button placed on its
/// own right-aligned row beneath the header (the web <c>buttonPlacement="below"</c>), the reviewed category
/// proposal (an "Apply categories as filter" primary button plus a wrap of category·count chips, shown only once
/// a <c>draft_alert_categories</c> tool result has been captured), and the streamed-output panel that renders the
/// thinking indicator before the first token, the accumulating narration as it arrives, a friendly empty caption
/// when a run proposes nothing, and a connectivity-aware error surface on failure. The whole surface renders
/// nothing when the feature flag is off (the native analogue of <c>withAiFeature</c> returning
/// <see langword="null"/>). All data flows through the shared <see cref="AIInboxAutoCategorizationViewModel"/>;
/// the view never performs HTTP and never persists state — applying the proposal raises
/// <see cref="AIInboxAutoCategorizationViewModel.CategoriesApplied"/> for the host to merge into the canonical
/// inbox filter. Every string resolves through the i18n facade, the card carries a Narrator name, the action
/// button carries the "Ask Helix · Suggest categories" accessible name and the apply button + each chip carry
/// their own Narrator names.
/// </summary>
public sealed partial class AIInboxAutoCategorization : ContentControl, IDisposable
{
    private const double CardPadding = 20;        // web p-5
    private const double SectionSpacing = 16;     // web space-y-4
    private const double TitleRowSpacing = 8;     // web gap-2
    private const double TextColumnSpacing = 4;   // web space-y-1
    private const double ProposalSpacing = 12;    // web space-y-3 between apply row + preview
    private const double PreviewSpacing = 8;      // web mt-2 between label + chips
    private const double ChipGap = 8;             // web gap-2
    private const double ChipInnerSpacing = 6;    // web gap-1.5 inside a chip
    private const double OutputPadding = 16;      // web p-4
    private const double BodyFontSize = 14;       // web text-sm
    private const double ChipFontSize = 12;       // web text-xs
    private const string HelixButtonGlyph = "\uE99A"; // Segoe Fluent "Robot" — the Helix action mark.
    private const string ApplyGlyph = "\uE71C";       // Segoe Fluent "Filter" — apply-as-filter.
    private const string ErrorGlyph = "\uEA39";       // Segoe Fluent "ErrorBadge".
    private const string EmptyGlyph = "\uE946";       // Segoe Fluent "Info".

    private readonly AIInboxAutoCategorizationViewModel _viewModel;
    private readonly AIInboxAutoCategorizationDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _card = new();
    private readonly StackPanel _root = new() { Spacing = SectionSpacing };
    private readonly StackPanel _header = new() { Spacing = TextColumnSpacing };
    private readonly PanelTitle _title = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsBadge _badge = new() { Status = StatusKind.Info, Dot = true, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _description = new()
    {
        FontSize = BodyFontSize,
        TextWrapping = TextWrapping.Wrap,
    };

    private readonly TsButton _action = new()
    {
        Variant = ButtonVariant.Outline,
        Size = ControlSize.Small,
        IconGlyph = HelixButtonGlyph,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly StackPanel _proposalHost = new() { Spacing = ProposalSpacing };

    private readonly TsButton _apply = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        IconGlyph = ApplyGlyph,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly Border _previewPanel = new()
    {
        Padding = new Thickness(12),
        CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        BorderThickness = new Thickness(1),
    };

    private readonly StackPanel _previewColumn = new() { Spacing = PreviewSpacing };
    private readonly TeslaSync.App.Components.UI.Text _previewLabel = new();
    private readonly ChipWrapPanel _chips = new() { HorizontalSpacing = ChipGap, VerticalSpacing = ChipGap };

    private readonly Border _outputHost = new()
    {
        Padding = new Thickness(OutputPadding),
        CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8),
        BorderThickness = new Thickness(1),
    };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its streaming transport, feature gate, localizer, optional apply callback, scope and diagnostics.</summary>
    /// <param name="transport">The cache-free SSE categorization transport (P1/S8 state-holder seam).</param>
    /// <param name="gate">The AI feature gate (web <c>useAiEnabled</c>); off collapses the whole surface.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="onApplyCategories">The apply-as-filter callback (web <c>onApplyCategories</c> prop); the host merges the rule ids into the inbox filter.</param>
    /// <param name="vehicleId">Optional vehicle scope forwarded as <c>vehicle_id</c>.</param>
    /// <param name="windowDays">Optional inbox window forwarded as <c>window_days</c>.</param>
    /// <param name="severities">Optional severity filter forwarded as <c>severities</c>.</param>
    /// <param name="ruleIds">Optional rule filter forwarded as <c>rule_ids</c>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AIInboxAutoCategorization(
        IAiInboxCategorizationStreamTransport transport,
        IAiFeatureGate gate,
        ILocalizer localizer,
        Action<IReadOnlyList<long>>? onApplyCategories = null,
        long? vehicleId = null,
        int? windowDays = null,
        IReadOnlyList<string>? severities = null,
        IReadOnlyList<long>? ruleIds = null,
        AIInboxAutoCategorizationDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(transport);
        ArgumentNullException.ThrowIfNull(gate);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new AIInboxAutoCategorizationDiagnostics();
        _viewModel = new AIInboxAutoCategorizationViewModel(
            transport, gate, localizer, onApplyCategories, vehicleId, windowDays, severities, ruleIds);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;

        BuildChrome();
        _action.Click += OnActionClick;
        _apply.Click += OnApplyClick;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Content = _card;
        Render();
    }

    /// <summary>The canonical surface slug (<c>AIInboxAutoCategorization</c>).</summary>
    public static string Slug => AIInboxAutoCategorizationRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public AIInboxAutoCategorizationViewModel ViewModel => _viewModel;

    /// <summary>The optional vehicle scope; reassigning cancels the in-flight stream and clears the proposal.</summary>
    public long? VehicleId
    {
        get => _viewModel.VehicleId;
        set => _viewModel.VehicleId = value;
    }

    /// <summary>The optional inbox window in days; reassigning cancels the in-flight stream and clears the proposal.</summary>
    public int? WindowDays
    {
        get => _viewModel.WindowDays;
        set => _viewModel.WindowDays = value;
    }

    /// <summary>The optional severity filter; reassigning cancels the in-flight stream and clears the proposal.</summary>
    public IReadOnlyList<string> Severities
    {
        get => _viewModel.Severities;
        set => _viewModel.Severities = value;
    }

    /// <summary>The optional rule filter; reassigning cancels the in-flight stream and clears the proposal.</summary>
    public IReadOnlyList<long> RuleIds
    {
        get => _viewModel.RuleIds;
        set => _viewModel.RuleIds = value;
    }

    /// <summary>
    /// Raised when the user applies the proposed categories (web <c>onApplyCategories</c>); the host merges the
    /// deduplicated ascending rule-id set into the canonical inbox filter.
    /// </summary>
    public event EventHandler<InboxCategoriesAppliedEventArgs>? CategoriesApplied
    {
        add => _viewModel.CategoriesApplied += value;
        remove => _viewModel.CategoriesApplied -= value;
    }

    /// <summary>
    /// Convenience factory that wires the production <see cref="HttpAiInboxCategorizationStreamTransport"/> from
    /// the shared networking dependencies (the host's P2-core seam) — the native analogue of the web component
    /// constructing its <c>useAiStream</c> over <c>fetch</c>.
    /// </summary>
    public static AIInboxAutoCategorization Create(
        HttpClient http,
        ApiClientOptions options,
        ITokenProvider tokenProvider,
        IAiFeatureGate gate,
        ILocalizer localizer,
        Action<IReadOnlyList<long>>? onApplyCategories = null,
        long? vehicleId = null,
        int? windowDays = null,
        IReadOnlyList<string>? severities = null,
        IReadOnlyList<long>? ruleIds = null,
        AIInboxAutoCategorizationDiagnostics? diagnostics = null)
    {
        var transport = new HttpAiInboxCategorizationStreamTransport(http, options, tokenProvider);
        return new AIInboxAutoCategorization(
            transport, gate, localizer, onApplyCategories, vehicleId, windowDays, severities, ruleIds, diagnostics);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _action.Click -= OnActionClick;
        _apply.Click -= OnApplyClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() =>
        new CategorizationAutomationPeer(this);

    private void BuildChrome()
    {
        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };
        _badge.Content = new TextBlock { Text = string.Empty };
        titleRow.Children.Add(_title);
        titleRow.Children.Add(_badge);

        _description.Foreground = DisplayTokens.TextSecondary;
        _header.Children.Add(titleRow);
        _header.Children.Add(_description);

        var actionRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actionRow.Children.Add(_action);

        BuildProposalHost();

        _outputHost.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _outputHost.BorderBrush = DisplayTokens.Border;
        LiveRegion.Configure(_outputHost);

        _root.Children.Add(_header);
        _root.Children.Add(actionRow);
        _root.Children.Add(_proposalHost);
        _root.Children.Add(_outputHost);

        _card.Padding = new Thickness(CardPadding);
        _card.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 8);
        _card.BorderBrush = DisplayTokens.Border;
        _card.BorderThickness = new Thickness(1);
        _card.Background = DisplayTokens.Surface;
        _card.Child = _root;
    }

    private void BuildProposalHost()
    {
        var applyRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        applyRow.Children.Add(_apply);

        var accent = DisplayTokens.Brush("TsColorSuccessBrush");
        _previewPanel.Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush");
        _previewPanel.BorderBrush = accent;
        _previewLabel.Foreground = accent;
        LiveRegion.Configure(_previewPanel);

        _previewColumn.Children.Add(_previewLabel);
        _previewColumn.Children.Add(_chips);
        _previewPanel.Child = _previewColumn;

        _proposalHost.Children.Add(applyRow);
        _proposalHost.Children.Add(_previewPanel);
    }

    private void OnActionClick(object sender, RoutedEventArgs e) => _viewModel.StartCategorize();

    private void OnApplyClick(object sender, RoutedEventArgs e) => _viewModel.ApplyCategories();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        // withAiFeature gate: when the feature is off the surface contributes nothing visible and carries no
        // automation id (the web HOC renders null, so the off-mode invariant test finds no root element).
        if (!_viewModel.IsGateOpen)
        {
            Visibility = Visibility.Collapsed;
            AutomationProperties.SetAutomationId(this, string.Empty);
            return;
        }

        Visibility = Visibility.Visible;
        AutomationProperties.SetAutomationId(this, AIInboxAutoCategorizationRegistration.RootAutomationId);

        _title.Value = _viewModel.Title;
        AutomationProperties.SetName(this, _viewModel.Title);
        SetBadgeText(_viewModel.BadgeLabel);
        _description.Text = _viewModel.Description;

        UpdateActionButton();
        UpdateProposal();
        UpdateOutput();
    }

    private void UpdateActionButton()
    {
        _action.Text = _viewModel.ActionLabel;
        AutomationProperties.SetName(_action, _viewModel.ActionAutomationName);
        AutomationProperties.SetAutomationId(_action, AIInboxAutoCategorizationRegistration.SuggestButtonAutomationId);
        ToolTipService.SetToolTip(_action, _viewModel.SuggestButtonLabel);

        // IsLoading swaps the icon for a ring and forces the button disabled while streaming; once the stream
        // closes it restores interactivity, after which the computed enabled state (canStart) is applied.
        _action.IsLoading = _viewModel.IsStreaming;
        if (!_viewModel.IsStreaming)
        {
            _action.IsEnabled = _viewModel.IsActionEnabled;
        }
    }

    private void UpdateProposal()
    {
        bool show = _viewModel.HasProposal;
        _proposalHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
        {
            _chips.Children.Clear();
            return;
        }

        _apply.Text = _viewModel.ApplyLabel;
        _apply.IsEnabled = _viewModel.ApplyEnabled;
        AutomationProperties.SetName(_apply, _viewModel.ApplyLabel);
        AutomationProperties.SetAutomationId(_apply, AIInboxAutoCategorizationRegistration.ApplyButtonAutomationId);
        ToolTipService.SetToolTip(_apply, _viewModel.ApplyLabel);

        _previewLabel.Value = _viewModel.PreviewLabel;
        RebuildChips();
        LiveRegion.Announce(_previewPanel);
    }

    private void RebuildChips()
    {
        _chips.Children.Clear();
        var muted = DisplayTokens.TextMuted;
        foreach (var bucket in _viewModel.Proposal)
        {
            _chips.Children.Add(BuildChip(bucket, muted));
        }
    }

    private static TsBadge BuildChip(CategoryBucket bucket, Brush muted)
    {
        var countText = bucket.Count.ToString(System.Globalization.CultureInfo.CurrentCulture);
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = ChipInnerSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TextBlock { Text = bucket.Category, FontSize = ChipFontSize });
        row.Children.Add(new TextBlock { Text = "\u00b7", FontSize = ChipFontSize, Foreground = muted });
        row.Children.Add(new TextBlock { Text = countText, FontSize = ChipFontSize });

        var chip = new TsBadge
        {
            Status = StatusKind.Success,
            Dot = false,
            Content = row,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(
            chip,
            string.Create(System.Globalization.CultureInfo.CurrentCulture, $"{bucket.Category}: {countText}"));
        return chip;
    }

    private void UpdateOutput()
    {
        bool show = _viewModel.ShowOutputPanel;
        _outputHost.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (show)
        {
            _outputHost.Child = BuildOutputContent();
            LiveRegion.Announce(_outputHost);
        }
        else
        {
            _outputHost.Child = null;
        }
    }

    private UIElement BuildOutputContent()
    {
        if (_viewModel.IsError)
        {
            return BuildErrorContent();
        }

        if (_viewModel.IsThinking)
        {
            return new TsSpinner
            {
                Size = ControlSize.Small,
                Label = _viewModel.ThinkingLabel,
                HorizontalAlignment = HorizontalAlignment.Left,
            };
        }

        if (_viewModel.ShowEmptyState)
        {
            return BuildEmptyContent();
        }

        return new TextBlock
        {
            Text = _viewModel.OutputText,
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            Foreground = DisplayTokens.TextPrimary,
            IsTextSelectionEnabled = true,
            LineHeight = 22,
        };
    }

    private StackPanel BuildEmptyContent()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };
        row.Children.Add(new FontIcon
        {
            Glyph = EmptyGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.TextMuted,
            VerticalAlignment = VerticalAlignment.Top,
        });
        row.Children.Add(new TextBlock
        {
            Text = _viewModel.EmptyStateText,
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            Foreground = DisplayTokens.TextMuted,
        });
        return row;
    }

    private StackPanel BuildErrorContent()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleRowSpacing,
        };

        var danger = DisplayTokens.Brush("TsColorDangerBrush");
        row.Children.Add(new FontIcon
        {
            Glyph = ErrorGlyph,
            FontSize = 16,
            Foreground = danger,
            VerticalAlignment = VerticalAlignment.Top,
        });
        row.Children.Add(new TextBlock
        {
            Text = _viewModel.DisplayErrorText,
            TextWrapping = TextWrapping.Wrap,
            FontSize = BodyFontSize,
            Foreground = danger,
        });
        return row;
    }

    private void SetBadgeText(string text)
    {
        if (_badge.Content is TextBlock block)
        {
            block.Text = text;
        }
        else
        {
            _badge.Content = new TextBlock { Text = text };
        }

        AutomationProperties.SetName(_badge, text);
    }

    private sealed class CategorizationAutomationPeer : FrameworkElementAutomationPeer
    {
        public CategorizationAutomationPeer(AIInboxAutoCategorization owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((AIInboxAutoCategorization)Owner).ViewModel.Title
                : name;
        }
    }

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child would
    /// overflow the available width — the native equivalent of the web preview ul's <c>flex flex-wrap gap-2</c>.
    /// Base WinUI ships no wrap panel, so the surface carries its own (the same pattern the dashboard chip
    /// clusters and the suggested-prompts row use).
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between chips on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }
}
