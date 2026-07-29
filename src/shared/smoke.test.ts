import { describe, expect, it } from 'vitest';
import { APP_NAME } from './constants';

describe('workspace', () => {
  it('identifies the application used by user-visible metadata', () => {
    expect(APP_NAME).toBe('Mermaid Workbench');
  });
});
