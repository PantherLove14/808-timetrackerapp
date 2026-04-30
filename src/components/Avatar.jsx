import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// Display avatar (with initials fallback) and optionally allow upload
export function Avatar({ url, name = '?', size = 36, className = '', onClick }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const initial = (name || '?').charAt(0).toUpperCase();

  useEffect(() => {
    let active = true;
    if (!url) { setSignedUrl(null); return; }
    if (url.startsWith('http')) { setSignedUrl(url); return; }
    // Treat as storage path - get signed URL from "avatars" bucket
    supabase.storage.from('avatars').createSignedUrl(url, 3600).then(({ data }) => {
      if (active && data) setSignedUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [url]);

  const style = {
    width: size, height: size,
    borderRadius: '50%',
    background: signedUrl ? 'transparent' : 'var(--ink)',
    color: 'var(--cream)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Bebas Neue, Impact, sans-serif',
    fontSize: Math.max(12, size * 0.4),
    overflow: 'hidden',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default'
  };

  return (
    <div style={style} className={className} onClick={onClick}>
      {signedUrl ? (
        <img src={signedUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initial
      )}
    </div>
  );
}

// Avatar uploader (admin uses for OTMs, anyone can use for own profile)
export function AvatarUploader({ avatarUrl, ownerType, ownerId, name, onChange }) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  async function pickFile() {
    fileRef.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setErr('Please upload a PNG, JPG, WEBP, or GIF.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr('Image too large. Max 5 MB.');
      return;
    }
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${ownerType}/${ownerId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
      cacheControl: '3600',
      upsert: false
    });
    if (upErr) {
      setUploading(false);
      setErr('Upload failed: ' + upErr.message);
      return;
    }
    // Update database
    const tableName = ownerType === 'client' ? 'clients' : 'users';
    const { error: dbErr } = await supabase.from(tableName).update({ avatar_url: path }).eq('id', ownerId);
    setUploading(false);
    if (dbErr) {
      setErr('Saved upload but profile update failed: ' + dbErr.message);
      return;
    }
    if (onChange) onChange(path);
  }

  async function removeAvatar() {
    if (!avatarUrl) return;
    if (!confirm('Remove photo?')) return;
    setUploading(true);
    if (!avatarUrl.startsWith('http')) {
      await supabase.storage.from('avatars').remove([avatarUrl]);
    }
    const tableName = ownerType === 'client' ? 'clients' : 'users';
    await supabase.from(tableName).update({ avatar_url: null }).eq('id', ownerId);
    setUploading(false);
    if (onChange) onChange(null);
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar url={avatarUrl} name={name} size={64} />
      <div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ display: 'none' }} onChange={handleFile} />
        <div className="flex gap-2">
          <button type="button" className="btn-sm" onClick={pickFile} disabled={uploading}>
            {uploading ? 'UPLOADING…' : (avatarUrl ? 'Change photo' : 'Upload photo')}
          </button>
          {avatarUrl && <button type="button" className="btn-sm danger" onClick={removeAvatar} disabled={uploading}>Remove</button>}
        </div>
        <div className="text-xs text-muted mt-1">PNG, JPG, WEBP, or GIF. Max 5 MB.</div>
        {err && <div className="text-xs text-crimson mt-1">{err}</div>}
      </div>
    </div>
  );
}
