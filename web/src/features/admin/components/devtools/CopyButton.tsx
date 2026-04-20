import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Copy } from 'lucide-react'
import { Button } from '@/components/ui'

interface CopyButtonProps {
  text: string
}

export function CopyButton({ text }: CopyButtonProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      icon={copied ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    >
      {copied ? t('Copied') : t('Copy')}
    </Button>
  )
}
