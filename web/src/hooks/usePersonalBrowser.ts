import { useCallback, useEffect, useState } from 'react'
import {
  clearPersonalBrowser,
  getPersonalSubscription,
  personalPushSupported,
  subscribePersonalBrowser,
} from '@/lib/personalPush'

type BrowserStatus = 'checking' | 'ready' | 'unsupported' | 'error'

export function usePersonalBrowser() {
  const [status, setStatus] = useState<BrowserStatus>('checking')
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let active = true
    if (!personalPushSupported()) {
      setStatus('unsupported')
      return () => { active = false }
    }
    setStatus('checking')
    void getPersonalSubscription().then((value) => {
      if (active) {
        setSubscription(value)
        setGeneration((current) => current + 1)
        setStatus('ready')
      }
    }).catch(() => {
      if (active) setStatus('error')
    })
    return () => { active = false }
  }, [attempt])

  const subscribe = useCallback(async (publicKey: string) => {
    const value = await subscribePersonalBrowser(publicKey)
    setSubscription(value)
    setGeneration((current) => current + 1)
    setStatus('ready')
    return value
  }, [])
  const clear = useCallback(async () => {
    await clearPersonalBrowser()
    setSubscription(null)
    setGeneration((current) => current + 1)
    setStatus('ready')
  }, [])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return { status, subscription, generation, subscribe, clear, retry }
}
