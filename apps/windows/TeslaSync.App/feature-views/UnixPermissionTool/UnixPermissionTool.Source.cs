namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The pure octal → symbolic projection engine — the native "data adapter" the
/// <see cref="UnixPermissionToolViewModel"/> projects through (P1/S8: the view binds the projection, it
/// never computes inline). It is a 1:1 port of the web component's <c>useMemo</c>
/// (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx): reject any value that is not
/// exactly three octal digits (the web <c>octal.length !== 3 || !/^[0-7]{3}$/.test(octal)</c> guard) by
/// returning <c>null</c> (the empty branch); otherwise map each digit through <see cref="PermissionMap"/>
/// and concatenate the three triads into the nine-character symbolic string, split into owner / group /
/// other (the web <c>PERMS[octal[0]] + PERMS[octal[1]] + PERMS[octal[2]]</c> and the
/// <c>slice(0,3)/slice(3,6)/slice(6)</c> render). Kept UI-free and deterministic so it is fully
/// unit-testable without a XAML host.
/// </summary>
public static class UnixPermissionProjection
{
    /// <summary>The exact number of octal digits a valid mode has (web <c>octal.length !== 3</c>).</summary>
    public const int OctalLength = 3;

    /// <summary>
    /// Project <paramref name="octal"/> into the owner / group / other breakdown, or <c>null</c> when it is
    /// not exactly three octal digits (the web <c>symbolic === null</c> branch).
    /// </summary>
    public static PermissionBreakdown? Project(string? octal)
    {
        if (octal is null || octal.Length != OctalLength)
        {
            return null;
        }

        foreach (char digit in octal)
        {
            if (digit is < '0' or > '7')
            {
                return null;
            }
        }

        string owner = PermissionMap.Triad(octal[0]);
        string group = PermissionMap.Triad(octal[1]);
        string other = PermissionMap.Triad(octal[2]);
        return new PermissionBreakdown(owner + group + other, owner, group, other);
    }
}
