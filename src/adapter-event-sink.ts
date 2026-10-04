import type { AsyncEventQueue } from "./event-queue";
import type { AdapterEvent } from "./types";

/** Adapter callbacks may run in timers, outside runTurn's Promise rejection path. */
export function createAdapterEventSink(
  queue: AsyncEventQueue<AdapterEvent>,
  abort: AbortController,
  observe?: (event: AdapterEvent) => void,
) {
  let failed = false;
  const fail = (error: unknown): void => {
    if (failed) return;
    failed = true;
    const terminal: AdapterEvent = {
      type: "error",
      message: (error instanceof Error ? error.message : String(error)).slice(0, 4096),
    };
    // Deliver failure even when there is no remaining backlog capacity. The terminal
    // budget is bounded separately by its fixed shape and 4096-character message.
    try { queue.push(terminal); } catch { queue.fail(terminal); }
    queue.close();
    try { observe?.(terminal); } catch { /* Diagnostics must not mask shutdown. */ }
    abort.abort();
  };
  return {
    emit(event: AdapterEvent): void {
      if (failed || abort.signal.aborted) return;
      try {
        observe?.(event);
        queue.push(event);
      } catch (error) {
        fail(error);
      }
    },
    fail,
  };
}

/** Fast retained-payload estimate for hot streaming events; not a process RSS limit. */
export function estimateAdapterEventBytes(event: AdapterEvent): number {
  switch (event.type) {
    case "heartbeat": case "tool_call_end": case "assistant_boundary": return 128;
    case "text_delta": return 192 + event.text.length * 2;
    case "thinking_delta": return 192 + event.thinking.length * 2;
    case "thinking_signature": return 192 + event.signature.length * 2;
    case "redacted_thinking": return 192 + event.data.length * 2;
    case "reasoning_raw_delta": return 192 + event.text.length * 2;
    case "tool_call_delta": return 192 + event.arguments.length * 2;
    case "tool_call_start": return 192 + (event.id.length + event.name.length) * 2;
    // Terminal events may contain nested provider continuation state. These are rare.
    default: return 128 + JSON.stringify(event).length * 2;
  }
}
