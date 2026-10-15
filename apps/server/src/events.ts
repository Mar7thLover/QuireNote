/** 进程内事件总线：job / source / artifact 变更，经 GET /api/events 以 SSE 推送给前端。 */
export type EventName = "job" | "source" | "artifact";

export interface BusEvent {
  event: EventName;
  data: unknown;
}

type Listener = (e: BusEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  emit(event: EventName, data: unknown): void {
    for (const l of this.listeners) {
      try {
        l({ event, data });
      } catch {
        /* 单个订阅者出错不影响其他订阅者 */
      }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get size(): number {
    return this.listeners.size;
  }
}
