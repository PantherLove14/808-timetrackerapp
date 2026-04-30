import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Live in-browser voice recorder. Returns a File when recording stops.
export function VoiceRecorder({ onRecorded, disabled }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState('');
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startedAtRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function start() {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        if (onRecorded) onRecorded(file);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        setRecording(false);
        setElapsed(0);
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      };
      mr.start();
      mediaRef.current = mr;
      startedAtRef.current = Date.now();
      tickRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      setRecording(true);
    } catch (e) {
      setErr(e.name === 'NotAllowedError'
        ? 'Microphone permission denied. Allow access in your browser to record.'
        : 'Could not start recording: ' + e.message);
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop();
    }
  }

  if (recording) {
    const m = Math.floor(elapsed / 60);
    const s = String(elapsed % 60).padStart(2, '0');
    return (
      <button type="button" onClick={stop} disabled={disabled}
        className="btn-sm flex items-center gap-2"
        style={{ background: 'var(--crimson)', color: 'var(--cream)', borderColor: 'var(--crimson)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff6ea', display: 'inline-block', animation: 'pulse 1s infinite' }} />
        STOP RECORDING ({m}:{s})
      </button>
    );
  }

  return (
    <>
      <button type="button" onClick={start} disabled={disabled} className="btn-sm">
        🎤 RECORD VOICE
      </button>
      {err && <div className="text-xs text-crimson mt-2">{err}</div>}
    </>
  );
}

// Upload a list of files to a Supabase storage bucket. Returns paths after upload.
export async function uploadFilesToStorage(bucket, files, prefix) {
  const results = [];
  for (const file of files) {
    const ext = file.name.split('.').pop();
    const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: false
    });
    if (error) {
      results.push({ file, error: error.message });
    } else {
      results.push({ file, path });
    }
  }
  return results;
}

// File-attachment chooser that supports multi-select and shows pending files
export function FileAttachPicker({ files, onChange, disabled, accept }) {
  const fileRef = useRef();

  function handlePick(e) {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;
    onChange([...files, ...picked]);
    e.target.value = ''; // allow same file to be re-selected
  }

  function remove(i) {
    onChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <div className="flex gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={accept || 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv'}
          style={{ display: 'none' }}
          onChange={handlePick}
        />
        <button type="button" className="btn-sm" onClick={() => fileRef.current?.click()} disabled={disabled}>
          📎 ATTACH FILES
        </button>
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="bg-cream-deep border border-line rounded px-2 py-1 text-xs flex items-center gap-2">
              <span className="truncate max-w-[160px]">{fileIcon(f)} {f.name}</span>
              <span className="text-muted">{(f.size / 1024).toFixed(0)} KB</span>
              <button type="button" onClick={() => remove(i)} className="text-crimson">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fileIcon(f) {
  const t = f.type || '';
  if (t.startsWith('image/')) return '🖼️';
  if (t.startsWith('video/')) return '🎥';
  if (t.startsWith('audio/')) return '🎵';
  if (t === 'application/pdf') return '📄';
  return '📎';
}
