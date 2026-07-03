import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function Dashboard() {
  const [instruments, setInstruments] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    setProfile(profileData);

    const { data: instrumentData } = await supabase
      .from('instruments')
      .select('*, questions(count), respondents(count)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });
    setInstruments(instrumentData ?? []);
    setLoading(false);
  }

  async function createBlank() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('instruments')
      .insert({ owner_id: user.id, title: 'Untitled instrument', status: 'Draft' })
      .select()
      .single();
    if (!error) navigate(`/instrument/${data.id}/builder`);
  }

  function triggerUpload() {
    if (!uploading) fileInputRef.current?.click();
  }

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Create the instrument row first — upload needs an instrument_id to attach to.
      const title = file.name.replace(/\.[^/.]+$/, '');
      const { data: instrument, error: instErr } = await supabase
        .from('instruments')
        .insert({ owner_id: user.id, title, status: 'Draft' })
        .select()
        .single();
      if (instErr) throw instErr;

      // 2. Upload the file into the user's own folder in the 'drafts' bucket.
      const path = `${user.id}/${instrument.id}_${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('drafts').upload(path, file);
      if (uploadErr) throw uploadErr;

      // 3. Ask the parse-draft function to extract questions. Requires the
      //    instrument to be unlocked first — send them to redeem a code if not.
      if (!instrument.unlocked) {
        navigate(`/instrument/${instrument.id}/builder?needsUnlock=1&pendingFile=${encodeURIComponent(path)}`);
        return;
      }

      await runParse(instrument.id, path);
      navigate(`/instrument/${instrument.id}/builder`);
    } catch (err) {
      console.error(err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  async function runParse(instrumentId, path) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ instrument_id: instrumentId, file_path: path }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Parsing failed');
    }
    return res.json();
  }

  function onInputChange(e) { handleFile(e.target.files[0]); e.target.value = ''; }

  async function logout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  if (loading) return <div className="loadingScreen">Loading…</div>;

  return (
    <div className="page gridBg">
      <div className="topline">Dashboard</div>
      <h1 className="pageTitle">Welcome back, {profile?.full_name?.split(' ')[0] || 'Researcher'}</h1>

      <button className="uploadCard" onClick={triggerUpload} style={{ width: '100%', marginBottom: 12 }}>
        <div className="uploadTitle">{uploading ? 'Uploading…' : '⬆ Upload your draft questionnaire'}</div>
        <div className="uploadSub">.docx or .pdf. Parses into structured questions — paid feature, needs an access code.</div>
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={onInputChange} />
      </button>
      <button className="uploadCard" onClick={createBlank} style={{ width: '100%', marginBottom: 24, borderColor: 'var(--line)' }}>
        <div className="uploadTitle">+ Start a blank instrument</div>
        <div className="uploadSub">Build questions manually. Free.</div>
      </button>

      <div className="sectionLabel">Your instruments</div>
      <div className="instrumentGrid">
        {instruments.map((inst) => (
          <button key={inst.id} className="instrumentCard" onClick={() => navigate(`/instrument/${inst.id}/builder`)}>
            <div className="instTitle">{inst.title}</div>
            <div className="instMeta">
              <span>{inst.respondents?.[0]?.count ?? 0} respondents</span>
              <span className={`statusPill ${inst.status === 'Live' ? 'live' : 'draft'}`}>{inst.status}</span>
            </div>
          </button>
        ))}
        {instruments.length === 0 && <div className="qMeta">No instruments yet — create one above.</div>}
      </div>

      <button className="logoutBtn" onClick={logout} style={{ marginTop: 32 }}>Log out</button>
    </div>
  );
}
