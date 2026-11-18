import { createContext } from 'react'
import type { ApplicationDesign } from './designs'

export const ActiveAppNavigation = createContext<ApplicationDesign['navigation'] | null>(null)
