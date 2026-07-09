import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delayMs` of no
 * further changes. Used to keep large-closet filtering smooth while typing.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = 250): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default useDebouncedValue;
