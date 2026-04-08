import { EventEmitter } from 'node:events';
import type { AppState } from '../shared/ipc-types.js';

export type StateEvent =
  | { type: 'TOGGLE' }
  | { type: 'SETUP_START' }
  | { type: 'SETUP_DONE' }
  | { type: 'WAKE_WORD' }
  | { type: 'STOP_LISTENING' }
  | { type: 'UTTERANCE'; text: string }
  | { type: 'INJECT_DONE' }
  | { type: 'ERROR'; message: string }
  | { type: 'ERROR_CLEAR' };

type Transitions = Partial<Record<StateEvent['type'], AppState>>;

const GRAPH: Record<AppState, Transitions> = {
  inactive:   { TOGGLE: 'scanning', SETUP_START: 'setup' },
  setup:      { SETUP_DONE: 'inactive', ERROR: 'error' },
  scanning:   { TOGGLE: 'inactive', WAKE_WORD: 'listening', ERROR: 'error' },
  listening:  { TOGGLE: 'inactive', STOP_LISTENING: 'scanning', UTTERANCE: 'processing', ERROR: 'scanning' },
  processing: { INJECT_DONE: 'scanning', STOP_LISTENING: 'scanning', ERROR: 'scanning' },
  error:      { TOGGLE: 'scanning', ERROR_CLEAR: 'inactive' },
};

export class StateMachine extends EventEmitter {
  private _state: AppState = 'inactive';
  private _allCapsActive = false;

  get state(): AppState { return this._state; }
  get allCapsActive(): boolean { return this._allCapsActive; }
  set allCapsActive(v: boolean) { this._allCapsActive = v; }

  dispatch(event: StateEvent): boolean {
    const next = GRAPH[this._state]?.[event.type];
    if (next == null) return false;
    const prev = this._state;
    this._state = next;
    this.emit('transition', next, prev, event);
    return true;
  }
}
