export type SaveState =
  | { status: 'saved' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'failed'; message: string };

export type SaveStateAction =
  | { type: 'EDITED' }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVE_SUCCEEDED' }
  | { type: 'SAVE_FAILED'; message: string }
  | { type: 'RESET' };

export function saveStateReducer(
  state: SaveState,
  action: SaveStateAction,
): SaveState {
  switch (action.type) {
    case 'EDITED':
      return { status: 'dirty' };
    case 'SAVE_STARTED':
      return { status: 'saving' };
    case 'SAVE_SUCCEEDED':
    case 'RESET':
      return { status: 'saved' };
    case 'SAVE_FAILED':
      return { status: 'failed', message: action.message };
    default:
      return state;
  }
}

export function saveStateLabel(state: SaveState): string {
  switch (state.status) {
    case 'saved':
      return 'Saved';
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'failed':
      return 'Save failed';
  }
}
