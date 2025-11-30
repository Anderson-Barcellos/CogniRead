import { SessionResult } from '../types';

const STORAGE_KEY = 'cogniread_sessions';

export const saveSession = (session: SessionResult) => {
  try {
    const existing = getSessions();
    const updated = [session, ...existing]; // Prepend new session
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Failed to save session", e);
  }
};

export const getSessions = (): SessionResult[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse history", e);
    return [];
  }
};

export const clearSessions = () => {
  localStorage.removeItem(STORAGE_KEY);
};

export const getLatestSession = (): SessionResult | undefined => {
  const sessions = getSessions();
  return sessions.length > 0 ? sessions[0] : undefined;
};