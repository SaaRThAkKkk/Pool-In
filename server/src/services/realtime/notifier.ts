// How the server tells a signed-in user something happened (e.g. a match appeared for their running search).
// Kept as an interface so the matching code does not depend on Socket.IO, and tests can listen in.
export interface SearchNotifier {
  notifyUser(userId: string, event: string, payload: unknown): void;
}

export class NoopNotifier implements SearchNotifier {
  notifyUser(): void {}
}

// The HTTP app is created before the Socket.IO server (which needs the HTTP server), so the real notifier
// is attached afterwards. Until then, notifications are dropped; clients also poll, so nothing is lost.
export class DeferredNotifier implements SearchNotifier {
  private target: SearchNotifier = new NoopNotifier();

  attach(target: SearchNotifier): void {
    this.target = target;
  }

  notifyUser(userId: string, event: string, payload: unknown): void {
    this.target.notifyUser(userId, event, payload);
  }
}
