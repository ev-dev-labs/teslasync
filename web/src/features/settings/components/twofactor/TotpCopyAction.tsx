import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, HelperText } from '@/components/ui'

interface TotpCopyActionProps {
  text: string
}

export function TotpCopyAction({ text }: TotpCopyActionProps) {
  const { t } = useTranslation('settings')
  const [copyFailed, setCopyFailed] = useState(false)

  useEffect(() => {
    setCopyFailed(false)
  }, [text])

  return (
    <div className="min-w-0 max-w-full space-y-1">
      <CopyButton
        text={text}
        onCopy={() => setCopyFailed(false)}
        onCopyError={() => setCopyFailed(true)}
      />
      {copyFailed && (
        <HelperText role="status" className="max-w-prose break-words">
          {t(
            'totp.copy.manualHint',
            'Clipboard unavailable. Select the displayed text and copy it manually.',
          )}
        </HelperText>
      )}
    </div>
  )
}
