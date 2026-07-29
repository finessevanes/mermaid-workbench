import { describe, expect, it } from 'vitest';
import {
  diagramDeletionMessage,
  projectDeletionMessage,
} from './confirmations';

describe('destructive confirmation copy', () => {
  it('names an empty project without implying diagram loss', () => {
    expect(projectDeletionMessage('Launch maps', 0)).toBe(
      'Delete empty project “Launch maps”? This cannot be undone.',
    );
  });

  it('states the exact number of diagrams removed with a project', () => {
    expect(projectDeletionMessage('Launch maps', 3)).toBe(
      'Delete “Launch maps” and its 3 diagrams? This cannot be undone.',
    );
    expect(projectDeletionMessage('Launch maps', 1)).toBe(
      'Delete “Launch maps” and its 1 diagram? This cannot be undone.',
    );
  });

  it('names a diagram before deleting it', () => {
    expect(diagramDeletionMessage('Release path')).toBe(
      'Delete diagram “Release path”? This cannot be undone.',
    );
  });
});
