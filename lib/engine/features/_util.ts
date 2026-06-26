export const last = <T,>(a: T[]) => a[a.length - 1];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const clampUnit = (x: number) => Math.max(-1, Math.min(1, x));
