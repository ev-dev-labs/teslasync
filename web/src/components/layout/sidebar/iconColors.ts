const routeColors: Readonly<Record<string, string>> = {
  'text-amber-400': 'text-amber-700 dark:text-amber-300',
  'text-blue-400': 'text-blue-700 dark:text-blue-300',
  'text-cyan-400': 'text-cyan-700 dark:text-cyan-300',
  'text-emerald-400': 'text-emerald-700 dark:text-emerald-300',
  'text-fuchsia-400': 'text-fuchsia-700 dark:text-fuchsia-300',
  'text-green-400': 'text-green-700 dark:text-green-300',
  'text-indigo-400': 'text-indigo-700 dark:text-indigo-300',
  'text-lime-400': 'text-lime-700 dark:text-lime-300',
  'text-neon-cyan': 'text-cyan-700 dark:text-cyan-300',
  'text-orange-400': 'text-orange-700 dark:text-orange-300',
  'text-pink-400': 'text-pink-700 dark:text-pink-300',
  'text-purple-400': 'text-purple-700 dark:text-purple-300',
  'text-red-400': 'text-red-700 dark:text-red-300',
  'text-rose-400': 'text-rose-700 dark:text-rose-300',
  'text-sky-400': 'text-sky-700 dark:text-sky-300',
  'text-slate-400': 'text-slate-700 dark:text-slate-300',
  'text-teal-400': 'text-teal-700 dark:text-teal-300',
  'text-violet-400': 'text-violet-700 dark:text-violet-300',
  'text-yellow-400': 'text-yellow-700 dark:text-yellow-300',
}

export function routeIconColor(color?: string) {
  return color ? routeColors[color] ?? 'text-[var(--theme-primary)]' : 'text-[var(--theme-primary)]'
}
