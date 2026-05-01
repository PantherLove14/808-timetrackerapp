import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase, logAudit } from '../lib/supabase';

const STORAGE_KEY = '808_active_timer';
const MAX_SECONDS = 8 * 3600; // 8-hour auto-stop

const TimerContext = createContext(null);

// Shape persisted to localStorage:
// { startedAt: ISO string, businessId, businessName, taskId, description, userId, role }
//
// Read on mount, restore the timer if present and not yet expired.

export function TimerProvider({ profile, role, children }) {
  const [active, setActive] = useState(null); // null | { startedAt, businessId, businessName, taskId, description }
  const [elapsed, setElapsed] = useState(0);
  const [tickCount, setTickCount] = useState(0); // forces re-render every second
  const tickRef = useRef(null);
  const autoStopFiredRef = useRef(false);
  const savingRef = useRef(false);

  // Load from storage on mount and whenever profile changes
  useEffect(() => {
    if (!profile?.id) { setActive(null); return; }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Only restore if it belongs to this same user (defense against shared computer)
      if (parsed?.userId === profile.id && parsed?.startedAt) {
        const startMs = new Date(parsed.startedAt).getTime();
        const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
        if (elapsedSec > MAX_SECONDS + 60) {
          // Was running for more than 8h+1min while user was away; auto-finalize at the cap
          finalizeTimer(parsed, MAX_SECONDS, true);
        } else {
          setActive(parsed);
        }
      }
    } catch (e) {
      console.warn('Could not restore timer:', e);
    }
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick every second to keep the visual updated. Real elapsed time is computed
  // from active.startedAt so tab throttling can't drift it.
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    function tick() {
      const e = Math.floor((Date.now() - new Date(active.startedAt).getTime()) / 1000);
      setElapsed(e);
      setTickCount(c => c + 1);
      // Auto-stop at 8 hours, exactly once
      if (e >= MAX_SECONDS && !autoStopFiredRef.current) {
        autoStopFiredRef.current = true;
        stopTimer({ autoStop: true });
      }
    }
    tick(); // immediate
    tickRef.current = setInterval(tick, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [active?.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  function persist(state) {
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (e) { console.warn(e); }
  }

  // Start a new timer
  const startTimer = useCallback(({ businessId, businessName, taskId, description }) => {
    if (active) return { error: 'Timer already running' };
    if (!businessId) return { error: 'Pick a business first' };
    if (!profile?.id) return { error: 'Not signed in' };
    autoStopFiredRef.current = false;
    const next = {
      userId: profile.id,
      startedAt: new Date().toISOString(),
      businessId,
      businessName: businessName || null,
      taskId: taskId || null,
      description: description || ''
    };
    setActive(next);
    persist(next);
    return { ok: true };
  }, [active, profile?.id]);

  // Update description / task on the running timer (so OTM can fill it later)
  const updateTimer = useCallback((patch) => {
    setActive(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  // Internal: write the time entry to DB and clear local state
  async function finalizeTimer(state, durationSec, autoStop = false) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from('time_entries').insert({
        user_id: user.id,
        business_id: state.businessId,
        task_id: state.taskId || null,
        description: (state.description || '').trim() || (autoStop ? '(8-hour auto-stop)' : '(no description)'),
        duration: Math.max(1, Math.min(durationSec, MAX_SECONDS)),
        date: new Date(state.startedAt).toISOString(),
        type: 'timer'
      });
      if (error) {
        console.error('Failed to save time entry:', error);
        // Keep timer state so user can retry
        savingRef.current = false;
        return { error: error.message };
      }
      await logAudit('time_entry.create', 'time_entry', null, {
        duration: durationSec,
        type: 'timer',
        auto_stop: autoStop,
        role
      });
    } finally {
      savingRef.current = false;
    }
  }

  // Stop the running timer, save the entry, clear state
  const stopTimer = useCallback(async (opts = {}) => {
    const state = active;
    if (!state) return { error: 'No active timer' };
    const startMs = new Date(state.startedAt).getTime();
    const dur = Math.floor((Date.now() - startMs) / 1000);
    const result = await finalizeTimer(state, dur, !!opts.autoStop);
    if (result?.error) return result;
    setActive(null);
    persist(null);
    setElapsed(0);
    return { ok: true, duration: Math.min(dur, MAX_SECONDS), autoStop: !!opts.autoStop };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Discard the running timer without saving (admin override / mistake)
  const cancelTimer = useCallback(() => {
    setActive(null);
    persist(null);
    setElapsed(0);
  }, []);

  const value = {
    active,
    elapsed,
    tickCount,
    maxSeconds: MAX_SECONDS,
    startTimer,
    stopTimer,
    cancelTimer,
    updateTimer
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
  return useContext(TimerContext) || {
    active: null, elapsed: 0, tickCount: 0, maxSeconds: MAX_SECONDS,
    startTimer: () => ({ error: 'Timer context unavailable' }),
    stopTimer: async () => ({ error: 'Timer context unavailable' }),
    cancelTimer: () => {},
    updateTimer: () => {}
  };
}

// Helper for displaying mm:ss / hh:mm:ss
export function formatElapsed(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
