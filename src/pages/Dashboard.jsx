import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UploadCloud, Lock, Unlock, Loader2 } from 'lucide-react';
import RingGauge from '../components/RingGauge';

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
      const title = file.name.replace(/\.[^/.]+$/, '');
      const { data: instrument, error: instErr } = await supabase
        .from('instruments')
        .insert({ owner_id: user.id, title, status: 'Draft' })
        .select()
        .single();
      if (instErr) throw instErr;

      const path = `${user.id}/${instrument.id}_${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage.from('drafts').upload(path, file);
      if (uploadErr) throw uploadErr;

      navigate(`/instrument/${instrument.id}/builder?pendingFile=${encodeURIComponent(path)}${instrument.unlocked ? '' : '&needsUnlock=1'}`);
    } catch (err) {
      console.error(err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  }

  function onInputChange(e) { handleFile(e.target.files[0]); e.target.value = ''; }

  if (loading) return <div className="loadingScreen"><Loader2 className="spin" size={20} /></div>;

  const totalRespondents = instruments.reduce((s, i) => s + (i.respondents?.[0]?.count ?? 0), 0);
  const liveCount = instruments.filter((i) => i.status === 'Live').length;
  const unlockedCount = instruments.filter((i) => i.unlocked).length;

  return (
    <div>
      <div className="pageHead">
        <div>
          <div className="topline">Dashboard</div>
          <h1 className="pageTitle">Welcome back, {profile?.full_name?.split(' ')[0] || 'Researcher'}</h1>
        </div>
      </div>

      <div className="statBand">
        <div className="statCard">
          <RingGauge value={100} color="var(--accent)" />
          <div className="statCardInfo"><div className="statCardNum">{instruments.length}</div><div className="statCardLabel">Instruments</div></div>
        </div>
        <div className="statCard">
          <RingGauge value={instruments.length ? (liveCount / instruments.length) * 100 : 0} color="var(--blue)" />
          <div className="statCardInfo"><div className="statCardNum">{liveCount}</div><div className="statCardLabel">Live</div></div>
        </div>
        <div className="statCard">
          <RingGauge value={Math.min(100, totalRespondents)} color="var(--graphite)" />
          <div className="statCardInfo"><div className="statCardNum">{totalRespondents}</div><div className="statCardLabel">Respondents</div></div>
        </div>
        <div className="statCard">
          <RingGauge value={instruments.length ? (unlockedCount / instruments.length) * 100 : 0} color="var(--ochre)" />
          <div className="statCardInfo"><div className="statCardNum">{unlockedCount}</div><div className="statCardLabel">Unlocked</div></div>
        </div>
      </div>

      <div className="dashGrid">
        <button className="uploadCard" onClick={triggerUpload}>
          <UploadCloud size={22} color="var(--accent)" />
          <div className="uploadTitle">{uploading ? 'Uploading…' : 'Upload your draft questionnaire'}</div>
          <div className="uploadSub">.docx or .pdf. Parses into structured questions. Paid feature, needs an access code.</div>
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={onInputChange} />
        </button>
        <button className="uploadCard secondary" onClick={createBlank}>
          <div className="uploadTitle">+ Start a blank instrument</div>
          <div className="uploadSub">Build questions manually. Free, no cap on question count.</div>
        </button>
      </div>

      <div className="sectionLabel" style={{ marginTop: 8 }}>Your instruments</div>
      <div className="instrumentGrid">
        {instruments.map((inst, i) => {
          const count = inst.respondents?.[0]?.count ?? 0;
          return (
            <button key={inst.id} className="instrumentCard" style={{ animationDelay: `${i * 40}ms` }} onClick={() => navigate(`/instrument/${inst.id}/builder`)}>
              <div className="instCardBody">
                <div className="instTitle">{inst.title}</div>
                <div className="instMeta">
                  <span>{count} respondents · {inst.questions?.[0]?.count ?? 0} questions</span>
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {inst.unlocked ? <Unlock size={12} color="var(--blue)" /> : <Lock size={12} color="var(--muted)" />}
                    <span className={`statusPill ${inst.status === 'Live' ? 'live' : 'draft'}`}>{inst.status}</span>
                  </span>
                </div>
              </div>
              <RingGauge value={Math.min(100, (count / 30) * 100)} color={inst.status === 'Live' ? 'var(--accent)' : 'var(--muted)'} size={40} stroke={4} />
            </button>
          );
        })}
        {instruments.length === 0 && <div className="emptyState">No instruments yet. Create one above.</div>}
      </div>
    </div>
  );
}
