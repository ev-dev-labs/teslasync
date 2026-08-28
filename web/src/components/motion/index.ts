export { CarAnimation } from './CarAnimation';
export { FadeIn } from './FadeIn';
export type { FadeInProps } from './FadeIn';
export { RouteTransition } from './RouteTransition';
export type { RouteTransitionProps } from './RouteTransition';
export { StaggerContainer } from './StaggerContainer';
export { StaggerItem } from './StaggerItem';
export {
  ambientFrames,
  ambientLoop,
  prefersReducedMotion,
} from './ambient';

// Re-export framer-motion primitives for advanced use cases (story slides, custom transitions)
export { AnimatePresence, motion } from 'framer-motion';