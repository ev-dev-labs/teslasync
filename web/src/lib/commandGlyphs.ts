import { createLucideIcon } from 'lucide-react';

export const frunk = createLucideIcon('Frunk', [
  ['path', { d: 'M2 15v-2l5-2 4-4h5l3 5 3 1v3h-2M7 16h7M3 6l5 4 2-1', key: 'body' }],
  ['circle', { cx: '5.5', cy: '16.5', r: '2.2', key: 'front' }],
  ['circle', { cx: '17.5', cy: '16.5', r: '2.2', key: 'rear' }],
]);
export const trunk = createLucideIcon('Trunk', [
  ['path', { d: 'M2 15v-2l5-2 4-4h5l3 5 2 1v3h-2M7 16h7M16 7l5-3 1 1', key: 'body' }],
  ['circle', { cx: '5.5', cy: '16.5', r: '2.2', key: 'front' }],
  ['circle', { cx: '17.5', cy: '16.5', r: '2.2', key: 'rear' }],
]);
export const windowVent = createLucideIcon('WindowVent', [
  ['path', { d: 'M3 19V9l5-5h12v15ZM12 7v7m-3-3 3 3 3-3', key: 'window' }],
]);
export const windowClose = createLucideIcon('WindowClose', [
  ['path', { d: 'M3 19V9l5-5h12v15ZM12 15V8m-3 3 3-3 3 3', key: 'window' }],
]);
export const roofVent = createLucideIcon('RoofVent', [
  ['path', { d: 'm2 16 5-5h10l5 5v2H2ZM8 8l8-4m0 0-1 3', key: 'roof' }],
]);
export const roofClose = createLucideIcon('RoofClose', [
  ['path', { d: 'm2 16 5-5h10l5 5v2H2ZM12 2v6m-3-3 3 3 3-3', key: 'roof' }],
]);
export const seatHeat = createLucideIcon('SeatHeat', [
  ['path', { d: 'm3 6 2-.6L9 14h10a2 2 0 0 1 0 4H7L3 6ZM7 21h12m-6-10c3-4-2-4 1-8m3 8c3-4-2-4 1-8', key: 'seat' }],
]);
export const seatCool = createLucideIcon('SeatCool', [
  ['path', { d: 'm3 6 2-.6L9 14h10a2 2 0 0 1 0 4H7L3 6ZM7 21h12m-5-19v9m-4-7 8 5m-8 0 8-5', key: 'seat' }],
]);
export const steeringWheel = createLucideIcon('SteeringWheel', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'wheel' }],
  ['path', { d: 'M3.3 10c4.4-1.7 13-1.7 17.4 0m-17 2 5 3 2 6m9.6-9L15 15l-2 6', key: 'spokes' }],
]);
export const playback = createLucideIcon('Playback', [
  ['path', { d: 'm3 5 10 7-10 7ZM17 5v14M22 5v14', key: 'play-pause' }],
]);
