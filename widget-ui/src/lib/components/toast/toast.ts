import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error';
export type ToastAction = {
  /** Button label, e.g. "Ongedaan maken". */
  label: string;
  /** Called when the user clicks the action. The toast is dismissed afterwards. */
  onClick: () => void;
};
export type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
};

let seq = 0;

function push(
  message: string,
  type: ToastType,
  ttl: number,
  action?: ToastAction,
) {
  const id = ++seq;
  toast.messages.update((m) => [...m, { id, message, type, action }]);
  setTimeout(() => toast.remove(id), ttl);
}

export const toast = {
  messages: writable<ToastItem[]>([]),

  /**
   * `toast.success("Saved")` — fire-and-forget.
   * `toast.success("Archived", { action: { label: "Undo", onClick } })` — show an
   * action chip on the right of the toast. The action button dismisses the toast
   * once clicked (whether or not the onClick succeeds).
   */
  success(msg: string, opts?: { action?: ToastAction }) {
    console.log('Toast success:', msg);
    // Actionable toasts live a little longer so the user has time to click "undo".
    push(msg, 'success', opts?.action ? 6000 : 3000, opts?.action);
  },

  error(msg: string, opts?: { action?: ToastAction }) {
    console.error('Toast error:', msg);
    push(msg, 'error', opts?.action ? 6000 : 4000, opts?.action);
  },

  remove(id: number) {
    this.messages.update((m) => m.filter((t) => t.id !== id));
  },
};
