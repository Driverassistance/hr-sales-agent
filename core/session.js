const sessions = new Map();

export function getSession(tgId) {
  if (!sessions.has(tgId)) {
    sessions.set(tgId, {
      stage: "start",
      lastTopic: null,
      invalidCount: 0
    });
  }
  return sessions.get(tgId);
}

export function resetInvalid(session) {
  session.invalidCount = 0;
}

export function incInvalid(session) {
  session.invalidCount += 1;
  return session.invalidCount;
}
