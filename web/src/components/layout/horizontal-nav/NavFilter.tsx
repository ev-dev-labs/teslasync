import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/Input'
import { Icons } from '@/lib/icons'

export function NavFilter({ label, query, setQuery, onDown }: {
  label: string
  query: string
  setQuery: (value: string) => void
  onDown?: () => void
}) {
  const { t } = useTranslation()
  return <Input type="search" value={query} onChange={event => setQuery(event.target.value)}
    aria-label={t('nav.sidenav.filterLabel', { section: label, defaultValue: 'Filter {{section}} pages' })}
    placeholder={t('nav.sidenav.filter', { section: label, defaultValue: 'Filter {{section}}…' })}
    icon={<Icons.filter className="size-4" aria-hidden />}
    className="horizontal-nav-filter"
    onKeyDown={event => {
      if (event.key === 'ArrowDown' && onDown) {
        event.preventDefault()
        onDown()
      }
    }} />
}
