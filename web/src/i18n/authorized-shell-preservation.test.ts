import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acceptedShellDeltas, restoreAcceptedShellSource } from './authorized-shell-preservation'

const currentSource = (file: string) =>
  readFileSync(resolve(process.cwd(), '..', ...file.split('/')), 'utf8')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

describe('exact accepted shell inverse, independent of recovery test registration', () => {
  it('reconstructs the actual Layout canonical predecessor without changing shipping source', () => {
    const file = 'web/src/components/layout/Layout.tsx'
    const current = currentSource(file)
    expect(hash(current)).toBe('d5f3c5cffd86f567050cbb461fdbe10c7930c5c695ea2870897954e05a1ef8a1')
    expect(hash(restoreAcceptedShellSource(file, current)))
      .toBe('cef29f502361ecafacf8bd0a3c11e0f538587cec5a2dfc5fc9e3ebf423254deb')
    expect(currentSource(file)).toBe(current)
  })

  it('reconstructs the palette predecessor before the separately pinned canonical translator inverse', () => {
    const file = 'web/src/components/ui/CommandPalette.tsx'
    const current = currentSource(file)
    expect(hash(current)).toBe('02ddb99ff8e9b3f31988790acfc4e342a487d09a8cf466535ab9e6d5fad080be')
    const canonical = restoreAcceptedShellSource(file, current)
    expect(hash(canonical)).toBe('5341afdc44459ff67b8798d5835e895dd39135685420a4be375d47228fe830f0')
    const actual = "t('palette.clearScope', 'Clear {{scope}} filter', { scope: getScopeMeta(activeScope).label })"
    const original = "t('palette.clearScope', { scope: getScopeMeta(activeScope).label, defaultValue: `Clear ${getScopeMeta(activeScope).label} filter` })"
    expect(canonical.split(actual)).toHaveLength(2)
    expect(canonical).not.toContain(original)
    expect(hash(canonical.replace(actual, original)))
      .toBe('ce372874ba3b2f0c538c97f6f8e99434db584cd41b0d98280265e3ed0cb8c7f5')
    expect(currentSource(file)).toBe(current)
  })

  it('reconstructs the actual theme popover canonical predecessor without changing shipping source', () => {
    const file = 'web/src/components/layout/ThemeQuickSwitcherPopover.tsx'
    const current = currentSource(file)
    expect(hash(current)).toBe('415fb2970c2a21085cf8aaf8f0bab7f348521f96b4b1dd2d816704a230a66871')
    expect(hash(restoreAcceptedShellSource(file, current)))
      .toBe('c1d44325aed1ecac84db36586a79b7410825bc38d9bc8076940c089407c4731b')
    expect(currentSource(file)).toBe(current)
  })

  for (const delta of acceptedShellDeltas) {
    describe(delta.path, () => {
      for (const [index, fragment] of delta.fragments.entries()) {
        it(`rejects missing accepted fragment ${index}`, () => {
          const source = currentSource(delta.path)
          expect(() => restoreAcceptedShellSource(delta.path, source.replace(fragment.current, '')))
            .toThrow(/Accepted shell/)
        })

        it(`rejects modified accepted fragment ${index}`, () => {
          const source = currentSource(delta.path)
          expect(() => restoreAcceptedShellSource(delta.path,
            source.replace(fragment.current, `${fragment.current.slice(0, -1)}!`)))
            .toThrow(/Accepted shell/)
        })

        it(`rejects duplicated accepted fragment ${index}`, () => {
          expect(() => restoreAcceptedShellSource(delta.path, currentSource(delta.path) + fragment.current))
            .toThrow(/Accepted shell/)
        })

        it(`rejects a mixed predecessor fragment ${index}`, () => {
          expect(() => restoreAcceptedShellSource(delta.path, currentSource(delta.path) + fragment.predecessor))
            .toThrow(/Accepted shell/)
        })
      }

      it('rejects unrelated appended bytes after every accepted fragment has matched', () => {
        expect(() => restoreAcceptedShellSource(delta.path, currentSource(delta.path) + '\n// unrelated edit\n'))
          .toThrow(/predecessor fingerprint mismatch/)
      })

      it('rejects changed state logic outside the accepted delta', () => {
        const source = currentSource(delta.path)
        const original = delta.path === 'web/src/components/layout/ThemeQuickSwitcherPopover.tsx'
          ? 'return { default: module.ThemePicker }'
          : delta.path === 'web/src/components/layout/Layout.tsx'
          ? 'const { preferences: productPreferences } = useProductPreferences()'
          : 'const [open, setOpen] = useState(initialOpen)'
        expect(source.split(original)).toHaveLength(2)
        for (const fragment of delta.fragments) {
          expect(fragment.current).not.toContain(original)
          expect(fragment.predecessor).not.toContain(original)
        }
        const edited = source.replace(original, `${original}; false`)
        expect(edited).not.toBe(source)
        expect(() => restoreAcceptedShellSource(delta.path, edited)).toThrow(/predecessor fingerprint mismatch/)
      })
    })
  }

  it.each([
    ["web/src/components/layout/Layout.tsx", "t('a11y.primaryHeader', 'Site header')", "t('a11y.changedHeader', 'Site header')"],
    ["web/src/components/layout/Layout.tsx", "t('a11y.primaryHeader', 'Site header')", "t('a11y.primaryHeader', 'Changed header')"],
    ["web/src/components/ui/CommandPalette.tsx", "t('palette.clearScope', 'Clear {{scope}} filter'", "t('palette.changedScope', 'Clear {{scope}} filter'"],
    ["web/src/components/ui/CommandPalette.tsx", "t('palette.clearScope', 'Clear {{scope}} filter'", "t('palette.clearScope', 'Changed {{scope}} filter'"],
    ["web/src/components/layout/ThemeQuickSwitcherPopover.tsx", "t('theme.openPicker', 'Open theme picker')", "t('theme.changedPicker', 'Open theme picker')"],
    ["web/src/components/layout/ThemeQuickSwitcherPopover.tsx", "t('theme.openPicker', 'Open theme picker')", "t('theme.openPicker', 'Changed theme picker')"],
  ])('keeps literal translator key/default mutations visible in %s: %s', (file, original, edited) => {
    const source = currentSource(file)
    expect(source.split(original)).toHaveLength(2)
    expect(() => restoreAcceptedShellSource(file, source.replace(original, edited))).toThrow(/Accepted shell/)
  })

  it.each([
    'web/src/components/layout/LayoutOther.tsx',
    'web/src/components/ui/CommandPaletteOther.tsx',
    'web/src/components/layout/ThemeQuickSwitcherPopoverOther.tsx',
    'web/src/features/settings/components/GeneralSettings.tsx',
  ])('passes unrelated exact path %s through byte-for-byte', file => {
    const text = "\uFEFF\r\n t('literal', 'Default')\u0000 false 0\r\n"
    expect(restoreAcceptedShellSource(file, text)).toBe(text)
  })
})
