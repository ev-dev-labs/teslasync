import { Alert } from 'react-native';

type ToastVars = Record<string, unknown>;

export const nativeMutationToastCapabilities = {
  feedbackPrimitive: 'Alert.alert',
  queuedToastAvailable: false,
  translationProviderAvailable: false,
} as const;

function interpolationValue(value: unknown): string {
  if (value == null) {
    return '';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  return String(value);
}

function translateToastMessage(
  _key: string,
  fallback: string,
  vars?: ToastVars,
): string {
  if (vars == null) {
    return fallback;
  }

  return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return interpolationValue(vars[name]);
    }

    return match;
  });
}

function errorDetail(err: unknown): string | undefined {
  return err instanceof Error
    ? err.message
    : err == null
      ? undefined
      : String(err);
}

/**
 * useMutationToast — native-safe bridge between TanStack Query mutations and
 * user-visible feedback.
 *
 * The web implementation uses react-i18next and the in-house Toast queue. The
 * native parity layer does not have those providers yet, so it preserves the
 * public helper contract with React Native Alert feedback and fallback-string
 * interpolation for `{{count}}`-style placeholders.
 */
export function useMutationToast() {
  return {
    success(key: string, fallback: string, vars?: ToastVars) {
      Alert.alert(translateToastMessage(key, fallback, vars));
    },
    error(
      err: unknown,
      key = 'toast.common.error',
      fallback = 'Something went wrong',
    ) {
      Alert.alert(translateToastMessage(key, fallback), errorDetail(err));
    },
  };
}
