using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The data seam the <see cref="DatePresetChipsViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the props the web <c>DatePresetChips</c> receives from its parent
/// (web/src/components/forms/DatePresetChips.tsx L21-L34: <c>presetIds</c>, <c>activeId</c>, <c>size</c>,
/// <c>ariaLabel</c>). The web component is presentational and never fetches; likewise this seam simply holds the
/// resolved inputs and exposes the local calendar <see cref="Today"/> (the native analogue of the web
/// <c>p.resolve()</c>'s <c>new Date()</c>) so a clicked preset resolves to a deterministic range. It raises
/// <see cref="Changed"/> whenever an input is reassigned — the analogue of the parent re-rendering with new
/// props. The view never touches this seam or HTTP directly; it observes the view-model.
/// </summary>
public interface IDatePresetChipsSource
{
    /// <summary>The preset ids to render, in display order (web <c>presetIds</c>); never null.</summary>
    IReadOnlyList<string> PresetIds { get; }

    /// <summary>The id of the active preset to highlight, or null (web <c>activeId</c>).</summary>
    string? ActiveId { get; }

    /// <summary>The chip size (web <c>size</c>).</summary>
    DatePresetChipSize Size { get; }

    /// <summary>An explicit override for the group's accessible name, or null to use the default (web <c>ariaLabel</c>).</summary>
    string? AriaLabel { get; }

    /// <summary>The local calendar day a clicked preset resolves against (the web <c>new Date()</c>'s local day).</summary>
    DateOnly Today { get; }

    /// <summary>Raised whenever any input changes.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The in-memory <see cref="IDatePresetChipsSource"/> — the canonical holder a page (or a test) pushes the chip
/// inputs into. It mirrors a parent passing fresh props to the web <c>DatePresetChips</c>:
/// <see cref="SetPresetIds"/> replaces the rendered id set, <see cref="SetActiveId"/> moves the highlight,
/// <see cref="SetSize"/> changes the chip scale and <see cref="SetAriaLabel"/> overrides the group name, each
/// raising <see cref="Changed"/> so the bound view-model re-projects. A <see langword="null"/> id set falls back
/// to <see cref="DatePresets.DefaultIds"/> (the web <c>presetIds = DEFAULT_PRESET_IDS</c> default), while an
/// explicitly empty set is preserved so the surface can render its friendly empty state (the web empty group).
/// The <see cref="Today"/> clock defaults to the live local day but can be pinned for deterministic tests.
/// </summary>
public sealed class DatePresetChipsSource : IDatePresetChipsSource
{
    private readonly Func<DateOnly> _clock;
    private IReadOnlyList<string> _presetIds;
    private string? _activeId;
    private DatePresetChipSize _size;
    private string? _ariaLabel;

    /// <summary>
    /// Creates the holder seeded with the initial inputs. A <see langword="null"/> <paramref name="presetIds"/>
    /// falls back to <see cref="DatePresets.DefaultIds"/> (the web default); an explicit empty list is kept so
    /// the empty state is reachable. A <see langword="null"/> <paramref name="clock"/> uses the live local day.
    /// </summary>
    public DatePresetChipsSource(
        IReadOnlyList<string>? presetIds = null,
        string? activeId = null,
        DatePresetChipSize size = DatePresetChipSize.Sm,
        string? ariaLabel = null,
        Func<DateOnly>? clock = null)
    {
        _presetIds = presetIds ?? DatePresets.DefaultIds;
        _activeId = activeId;
        _size = size;
        _ariaLabel = ariaLabel;
        _clock = clock ?? (static () => DateOnly.FromDateTime(DateTime.Now));
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public IReadOnlyList<string> PresetIds => _presetIds;

    /// <inheritdoc />
    public string? ActiveId => _activeId;

    /// <inheritdoc />
    public DatePresetChipSize Size => _size;

    /// <inheritdoc />
    public string? AriaLabel => _ariaLabel;

    /// <inheritdoc />
    public DateOnly Today => _clock();

    /// <summary>Replace the rendered id set (a null falls back to the default ids) and notify.</summary>
    public void SetPresetIds(IReadOnlyList<string>? presetIds)
    {
        _presetIds = presetIds ?? DatePresets.DefaultIds;
        RaiseChanged();
    }

    /// <summary>Move the highlight to a different preset (a null clears it), notifying only on a real change.</summary>
    public void SetActiveId(string? activeId)
    {
        if (string.Equals(_activeId, activeId, StringComparison.Ordinal))
        {
            return;
        }

        _activeId = activeId;
        RaiseChanged();
    }

    /// <summary>Change the chip size, notifying only on a real change.</summary>
    public void SetSize(DatePresetChipSize size)
    {
        if (_size == size)
        {
            return;
        }

        _size = size;
        RaiseChanged();
    }

    /// <summary>Override the group's accessible name (a null restores the localized default) and notify.</summary>
    public void SetAriaLabel(string? ariaLabel)
    {
        if (string.Equals(_ariaLabel, ariaLabel, StringComparison.Ordinal))
        {
            return;
        }

        _ariaLabel = ariaLabel;
        RaiseChanged();
    }

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
