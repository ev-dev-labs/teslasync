using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SignalSelector"/> view — the native port of the web
/// component's data flow (web/src/features/telemetry/components/SignalSelector.tsx). The web component is a
/// <b>controlled</b> wrapper over the shared <c>ComboboxMulti</c>: the parent supplies the available
/// <c>options</c> and the committed <c>value</c>, and every add / remove flows back out through <c>onChange</c>.
/// This holder owns that controlled selection for one field at a time — projecting the raw signal names into
/// combobox options (<see cref="SignalSelectorProjection.ToOptions"/>), enforcing the chip cap
/// (web <c>maxItems</c> → <see cref="SignalSelectorProjection.Cap"/>), hiding already-selected rows from the
/// dropdown, and composing the <c>Signals (N / max)</c> label — so the view is a thin renderer. The search is
/// synchronous and there is no network read, so the surface resolves to exactly
/// <see cref="SignalSelectorState.Empty"/> (no signals supplied) or <see cref="SignalSelectorState.Ready"/>;
/// there is deliberately no loading / error / stale / offline branch. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class SignalSelectorViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly List<string> _selected = new();

    private IReadOnlyList<ComboOption> _options = Array.Empty<ComboOption>();
    private int? _max = SignalSelectorRegistration.DefaultMax;
    private bool _showLayerHelp = true;
    private string? _labelOverride;

    /// <summary>Creates the holder over the i18n facade every string resolves through.</summary>
    public SignalSelectorViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the committed selection changes (web <c>onChange</c>), carrying the new set.</summary>
    public event EventHandler<IReadOnlyList<string>>? SelectionChanged;

    // ── Inputs (parent-owned, web props) ─────────────────────────────────────────────────────────────────

    /// <summary>The hard chip cap (web <c>max</c>, default 5); <c>null</c> means uncapped (web <c>max={null}</c>).</summary>
    public int? Max => _max;

    /// <summary>Whether the layer-help tooltip shows next to the label (web <c>showLayerHelp</c>, default true).</summary>
    public bool ShowLayerHelp => _showLayerHelp;

    /// <summary>An explicit label that overrides the computed <c>Signals (N / max)</c> text (web <c>labelOverride</c>).</summary>
    public string? LabelOverride => _labelOverride;

    // ── Derived state ────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The full projected option set (web <c>options</c> mapped through <c>getOptionLabel</c>).</summary>
    public IReadOnlyList<ComboOption> Options => _options;

    /// <summary>The options offered in the dropdown — <see cref="Options"/> minus the already-selected ones.</summary>
    public IReadOnlyList<ComboOption> AvailableOptions =>
        SignalSelectorProjection.Available(_options, _selected);

    /// <summary>The committed selection in pick order (web <c>value</c>); never null.</summary>
    public IReadOnlyList<string> SelectedValues => _selected;

    /// <summary>The number of committed selections (web <c>value.length</c>).</summary>
    public int SelectedCount => _selected.Count;

    /// <summary>True when any signals are available to pick (web <c>options.length &gt; 0</c>).</summary>
    public bool HasOptions => _options.Count > 0;

    /// <summary>The surface state: <see cref="SignalSelectorState.Empty"/> when no signals were supplied.</summary>
    public SignalSelectorState State =>
        _options.Count == 0 ? SignalSelectorState.Empty : SignalSelectorState.Ready;

    /// <summary>True once the selection has reached the cap (web <c>atMax</c>); always false when uncapped.</summary>
    public bool IsAtMax => SignalSelectorProjection.IsAtMax(_selected.Count, _max);

    /// <summary>The visible field label (web <c>labelOverride ?? `Signals (N / max)`</c>).</summary>
    public string Label =>
        SignalSelectorProjection.ComposeLabel(_labelOverride, SignalsWord, _selected.Count, _max);

    // ── Localized copy (web t(...) keys) ─────────────────────────────────────────────────────────────────

    /// <summary>The "Signals" label word (web <c>t('Signals')</c>).</summary>
    public string SignalsWord => SignalSelectorRegistration.Signals(_localizer);

    /// <summary>The empty-field prompt (web <c>t('Search signals…')</c>).</summary>
    public string SearchPrompt => SignalSelectorRegistration.SearchPrompt(_localizer);

    /// <summary>The layer-help tooltip body (web <c>help.signal.layers</c>).</summary>
    public string LayerHelpHint => SignalSelectorRegistration.LayerHelp(_localizer);

    /// <summary>The layer-help accessible name (web <c>help.signal.layers.aria</c>).</summary>
    public string LayerHelpAria => SignalSelectorRegistration.LayerHelpAria(_localizer);

    /// <summary>The empty-dropdown note (web <c>combobox.noResults</c>).</summary>
    public string NoResultsText => SignalSelectorRegistration.NoResults(_localizer);

    /// <summary>The cap-reached note (web <c>combobox.maxReached</c>).</summary>
    public string MaxReachedText => SignalSelectorRegistration.MaxReached(_localizer);

    /// <summary>
    /// A polite Narrator announcement for the resting surface condition: the "no results" note when no signals
    /// are available, the "maximum reached" note when the cap is hit, else null. Per-action count changes are
    /// announced separately by the view via <see cref="Label"/>.
    /// </summary>
    public string? StatusAnnouncement =>
        State == SignalSelectorState.Empty ? NoResultsText
        : IsAtMax ? MaxReachedText
        : null;

    /// <summary>The remove-button accessible name for a chip (web <c>t('combobox.removeChip', …)</c>).</summary>
    public string RemoveChipLabel(string signal) =>
        SignalSelectorRegistration.RemoveChipLabel(_localizer, signal);

    // ── Commands (controlled-component mutations) ─────────────────────────────────────────────────────────

    /// <summary>Replace the available signals (web <c>options</c>); selections that are no longer offered remain
    /// committed (the web keeps <c>value</c> independent of <c>options</c>).</summary>
    public void SetOptions(IReadOnlyList<string>? options)
    {
        _options = SignalSelectorProjection.ToOptions(options);
        RaiseOptionDependents();
    }

    /// <summary>Replace the committed selection (web <c>value</c>), enforcing the cap (web <c>onChange</c> slice);
    /// raises <see cref="SelectionChanged"/> only when the effective set actually changes.</summary>
    public void SetSelected(IReadOnlyList<string>? values)
    {
        IReadOnlyList<string> capped = SignalSelectorProjection.Cap(values, _max);
        if (SameSelection(capped))
        {
            return;
        }

        _selected.Clear();
        _selected.AddRange(capped);
        RaiseSelectionChanged();
    }

    /// <summary>
    /// Add a signal to the selection (web <c>addOption</c>): ignored when the cap is reached, when the value is
    /// already selected, or when it is not one of the available options. Returns true when the selection grew.
    /// </summary>
    public bool Add(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || IsAtMax || _selected.Contains(value))
        {
            return false;
        }

        bool known = false;
        foreach (ComboOption option in _options)
        {
            if (string.Equals(option.Value, value, StringComparison.Ordinal))
            {
                known = true;
                break;
            }
        }

        if (!known)
        {
            return false;
        }

        _selected.Add(value);
        RaiseSelectionChanged();
        return true;
    }

    /// <summary>Remove a signal from the selection (web chip remove). Returns true when something was removed.</summary>
    public bool Remove(string value)
    {
        if (string.IsNullOrEmpty(value) || !_selected.Remove(value))
        {
            return false;
        }

        RaiseSelectionChanged();
        return true;
    }

    /// <summary>Remove the trailing chip (web Backspace-at-empty-input). Returns the removed value, or null.</summary>
    public string? RemoveLast()
    {
        if (_selected.Count == 0)
        {
            return null;
        }

        string removed = _selected[^1];
        _selected.RemoveAt(_selected.Count - 1);
        RaiseSelectionChanged();
        return removed;
    }

    /// <summary>Set the chip cap (web <c>max</c>); a negative value is treated as uncapped. Re-caps the selection.</summary>
    public void SetMax(int? max)
    {
        int? next = max is < 0 ? null : max;
        if (_max == next)
        {
            return;
        }

        _max = next;
        IReadOnlyList<string> capped = SignalSelectorProjection.Cap(_selected, _max);
        bool selectionChanged = !SameSelection(capped);
        if (selectionChanged)
        {
            _selected.Clear();
            _selected.AddRange(capped);
        }

        Raise(nameof(Max));
        Raise(nameof(IsAtMax));
        Raise(nameof(Label));
        Raise(nameof(StatusAnnouncement));
        if (selectionChanged)
        {
            RaiseSelectionChanged();
        }
    }

    /// <summary>Show or hide the layer-help tooltip (web <c>showLayerHelp</c>).</summary>
    public void SetShowLayerHelp(bool show)
    {
        if (_showLayerHelp == show)
        {
            return;
        }

        _showLayerHelp = show;
        Raise(nameof(ShowLayerHelp));
    }

    /// <summary>Override the computed label (web <c>labelOverride</c>); pass null to restore the count label.</summary>
    public void SetLabelOverride(string? labelOverride)
    {
        if (string.Equals(_labelOverride, labelOverride, StringComparison.Ordinal))
        {
            return;
        }

        _labelOverride = labelOverride;
        Raise(nameof(LabelOverride));
        Raise(nameof(Label));
    }

    /// <summary>Clear the whole selection (web parent resetting <c>value</c> to <c>[]</c>).</summary>
    public void Clear()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected.Clear();
        RaiseSelectionChanged();
    }

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────

    private bool SameSelection(IReadOnlyList<string> candidate)
    {
        if (candidate.Count != _selected.Count)
        {
            return false;
        }

        for (int i = 0; i < candidate.Count; i++)
        {
            if (!string.Equals(candidate[i], _selected[i], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private void RaiseOptionDependents()
    {
        Raise(nameof(Options));
        Raise(nameof(AvailableOptions));
        Raise(nameof(HasOptions));
        Raise(nameof(State));
        Raise(nameof(StatusAnnouncement));
    }

    private void RaiseSelectionChanged()
    {
        Raise(nameof(SelectedValues));
        Raise(nameof(SelectedCount));
        Raise(nameof(AvailableOptions));
        Raise(nameof(IsAtMax));
        Raise(nameof(Label));
        Raise(nameof(StatusAnnouncement));
        SelectionChanged?.Invoke(this, _selected.ToArray());
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
