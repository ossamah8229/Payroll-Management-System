import { describe, expect, it } from 'vitest';
import { resolveOrientation } from './print-types';

describe('resolveOrientation', () => {
  it('resolves "auto" to the page-supplied recommendation', () => {
    expect(resolveOrientation('auto', 'landscape')).toBe('landscape');
    expect(resolveOrientation('auto', 'portrait')).toBe('portrait');
  });

  it('an explicit choice always wins over the recommendation', () => {
    expect(resolveOrientation('portrait', 'landscape')).toBe('portrait');
    expect(resolveOrientation('landscape', 'portrait')).toBe('landscape');
  });
});
