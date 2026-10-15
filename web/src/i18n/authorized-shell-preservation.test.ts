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
    expect(hash(current)).toBe('2164103032c3971be0485f8ef0cf43b07e266ef283e80abb319601da554a46e1')
    expect(hash(restoreAcceptedShellSource(file, current)))
      .toBe('3afab237f538c2e32c1df4f1c45ae0fc166f227c6a26918e18b55cec15dae150')
    expect(currentSource(file)).toBe(current)
  })

  it('reconstructs the palette predecessor before the separately pinned canonical translator inverse', () => {
    const file = 'web/src/components/ui/CommandPalette.tsx'
    const current = currentSource(file)
    expect(hash(current)).toBe('62821e61be0a22b7b416b93f9c437c4c28a4b8e9339274333d3c71ce690e8456')
    const canonical = restoreAcceptedShellSource(file, current)
    expect(hash(canonical)).toBe('c157f19b1fa2693b6e7fe1ec3844c090a913c41a66311d1850e3726fa4981522')
    const actual = "t('palette.clearScope', 'Clear {{scope}} filter', { scope: getScopeMeta(activeScope).label })"
    const original = "t('palette.clearScope', { scope: getScopeMeta(activeScope).label, defaultValue: `Clear ${getScopeMeta(activeScope).label} filter` })"
    expect(canonical.split(actual)).toHaveLength(2)
    expect(canonical).not.toContain(original)
    expect(hash(canonical.replace(actual, original)))
      .toBe('482f84bdca352ccb17c408886d42f87997b316908890e74ce432dffdeec30444')
    expect(currentSource(file)).toBe(current)
  })

  it('reconstructs the actual theme popover canonical predecessor without changing shipping source', () => {
    const file = 'web/src/components/layout/ThemeQuickSwitcherPopover.tsx'
    const current = currentSource(file)
    expect(hash(current)).toBe('7c315259f3c962675faad01f7f572571652201f48676755e701231c7b8ae1a73')
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
