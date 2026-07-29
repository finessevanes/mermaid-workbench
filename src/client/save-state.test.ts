import { describe, expect, it } from 'vitest';
import { saveStateReducer, type SaveState } from './save-state';

describe('saveStateReducer', () => {
  it('moves an edited saved record into the dirty state', () => {
    expect(saveStateReducer({ status: 'saved' }, { type: 'EDITED' })).toEqual({
      status: 'dirty',
    });
  });

  it('reports the complete successful save lifecycle', () => {
    const dirty: SaveState = { status: 'dirty' };
    const saving = saveStateReducer(dirty, { type: 'SAVE_STARTED' });
    expect(saving).toEqual({ status: 'saving' });
    expect(saveStateReducer(saving, { type: 'SAVE_SUCCEEDED' })).toEqual({
      status: 'saved',
    });
  });

  it('retains a useful failure message and supports retry', () => {
    const failed = saveStateReducer(
      { status: 'saving' },
      { type: 'SAVE_FAILED', message: 'The local server is unavailable.' },
    );
    expect(failed).toEqual({
      status: 'failed',
      message: 'The local server is unavailable.',
    });
    expect(saveStateReducer(failed, { type: 'SAVE_STARTED' })).toEqual({
      status: 'saving',
    });
  });

  it('keeps a failed save dirty when more edits arrive', () => {
    expect(
      saveStateReducer(
        { status: 'failed', message: 'Disk full.' },
        { type: 'EDITED' },
      ),
    ).toEqual({ status: 'dirty' });
  });
});
