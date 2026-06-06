namespace TeslaSync.App.Core;

/// <summary>A single invokable entry in the <c>TsCommandPalette</c>.</summary>
/// <param name="Id">Stable identifier.</param>
/// <param name="Title">Primary, user-facing label (already localized).</param>
/// <param name="Subtitle">Optional secondary line / context.</param>
/// <param name="Keywords">Extra search terms not shown in the title.</param>
public sealed record CommandItem(
    string Id,
    string Title,
    string? Subtitle = null,
    IReadOnlyList<string>? Keywords = null);

/// <summary>
/// UI-free ranking/filter for the command palette. Implements the substring +
/// subsequence ("fuzzy") match used by the web palette so the WinUI control
/// only renders results.
/// </summary>
public static class CommandPaletteFilter
{
    /// <summary>Returns the items matching <paramref name="query"/>, best match
    /// first. An empty query returns the input order unchanged.</summary>
    public static IReadOnlyList<CommandItem> Filter(IReadOnlyList<CommandItem> items, string? query)
    {
        ArgumentNullException.ThrowIfNull(items);

        if (string.IsNullOrWhiteSpace(query))
        {
            return items;
        }

        var trimmed = query.Trim();
        var scored = new List<(CommandItem Item, int Score, int Index)>();
        for (var i = 0; i < items.Count; i++)
        {
            var score = Score(items[i], trimmed);
            if (score > 0)
            {
                scored.Add((items[i], score, i));
            }
        }

        return scored
            .OrderByDescending(s => s.Score)
            .ThenBy(s => s.Index)
            .Select(s => s.Item)
            .ToList();
    }

    /// <summary>Relevance score for one item; 0 means no match.</summary>
    public static int Score(CommandItem item, string query)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (string.IsNullOrWhiteSpace(query))
        {
            return 1;
        }

        var q = query.Trim();
        var title = item.Title ?? string.Empty;

        if (title.Equals(q, StringComparison.OrdinalIgnoreCase))
        {
            return 1000;
        }

        if (title.StartsWith(q, StringComparison.OrdinalIgnoreCase))
        {
            return 800;
        }

        if (title.Contains(q, StringComparison.OrdinalIgnoreCase))
        {
            return 600;
        }

        if (!string.IsNullOrEmpty(item.Subtitle) &&
            item.Subtitle.Contains(q, StringComparison.OrdinalIgnoreCase))
        {
            return 400;
        }

        if (item.Keywords is not null &&
            item.Keywords.Any(k => k.Contains(q, StringComparison.OrdinalIgnoreCase)))
        {
            return 300;
        }

        return IsSubsequence(title, q) ? 100 : 0;
    }

    /// <summary>True when every character of <paramref name="query"/> appears in
    /// <paramref name="text"/> in order (case-insensitive).</summary>
    public static bool IsSubsequence(string text, string query)
    {
        ArgumentNullException.ThrowIfNull(text);
        ArgumentNullException.ThrowIfNull(query);
        if (query.Length == 0)
        {
            return true;
        }

        var qi = 0;
        foreach (var ch in text)
        {
            if (char.ToUpperInvariant(ch) == char.ToUpperInvariant(query[qi]) && ++qi == query.Length)
            {
                return true;
            }
        }

        return false;
    }
}
