import { describe, expect, it } from 'vitest';
import { directionLabel, directionTone, populationStatusLabel, populationStatusTone } from './variance-report-labels';

describe('populationStatusLabel', () => {
  it('labels every population status', () => {
    expect(populationStatusLabel('NEW')).toBe('New');
    expect(populationStatusLabel('DEPARTED')).toBe('Departed');
    expect(populationStatusLabel('CONTINUED')).toBe('Continued');
  });
});

describe('populationStatusTone', () => {
  it('assigns a distinct, non-danger/warning tone to NEW and DEPARTED (a population change is never itself good or bad)', () => {
    expect(populationStatusTone('NEW')).not.toBe('red');
    expect(populationStatusTone('NEW')).not.toBe('amber');
    expect(populationStatusTone('DEPARTED')).not.toBe('red');
    expect(populationStatusTone('DEPARTED')).not.toBe('amber');
  });

  it('every status has its own tone', () => {
    const tones = new Set([populationStatusTone('NEW'), populationStatusTone('DEPARTED'), populationStatusTone('CONTINUED')]);
    expect(tones.size).toBe(3);
  });
});

describe('directionLabel', () => {
  it('labels every direction', () => {
    expect(directionLabel('INCREASED')).toBe('Increased');
    expect(directionLabel('DECREASED')).toBe('Decreased');
    expect(directionLabel('UNCHANGED')).toBe('Unchanged');
  });
});

describe('directionTone', () => {
  it('increased is a positive tone, decreased is a negative tone, unchanged is neutral', () => {
    expect(directionTone('INCREASED')).toBe('green');
    expect(directionTone('DECREASED')).toBe('red');
    expect(directionTone('UNCHANGED')).toBe('gray');
  });
});
