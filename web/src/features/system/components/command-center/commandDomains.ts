import {
  BatteryCharging,
  CarFront,
  ShieldCheck,
  ThermometerSun,
  type LucideIcon,
} from 'lucide-react';
import type { CommandCategory } from '../../commands';

export type CommandDomainId = 'access' | 'comfort' | 'charging' | 'vehicle';

export interface CommandDomain {
  id: CommandDomainId;
  labelKey: string;
  labelFallback: string;
  descriptionKey: string;
  descriptionFallback: string;
  icon: LucideIcon;
  categories: readonly CommandCategory[];
}

/**
 * The command catalogue has intentionally granular Tesla-facing categories.
 * The operator workspace groups those categories into four scan-friendly
 * domains without removing or renaming any command.
 */
export const COMMAND_DOMAINS: readonly CommandDomain[] = [
  {
    id: 'access',
    labelKey: 'commands.domain.access.title',
    labelFallback: 'Access & Security',
    descriptionKey: 'commands.domain.access.description',
    descriptionFallback: 'Locks, security modes, openings, and drive authorization.',
    icon: ShieldCheck,
    categories: ['security', 'doors', 'drive', 'windows', 'sunroof'],
  },
  {
    id: 'comfort',
    labelKey: 'commands.domain.comfort.title',
    labelFallback: 'Climate & Comfort',
    descriptionKey: 'commands.domain.comfort.description',
    descriptionFallback: 'Cabin temperature, seats, steering heat, and protection modes.',
    icon: ThermometerSun,
    categories: ['climate', 'climate_protection'],
  },
  {
    id: 'charging',
    labelKey: 'commands.domain.charging.title',
    labelFallback: 'Charging & Schedules',
    descriptionKey: 'commands.domain.charging.description',
    descriptionFallback: 'Charge controls, limits, and recurring vehicle schedules.',
    icon: BatteryCharging,
    categories: ['charging', 'schedules'],
  },
  {
    id: 'vehicle',
    labelKey: 'commands.domain.vehicle.title',
    labelFallback: 'Vehicle Controls',
    descriptionKey: 'commands.domain.vehicle.description',
    descriptionFallback: 'Location, navigation, software, identity, and media controls.',
    icon: CarFront,
    categories: ['alerts', 'navigation', 'software', 'vehicle', 'media'],
  },
] as const;

export const COMMAND_STATE_REFRESH_MS = 15_000;
