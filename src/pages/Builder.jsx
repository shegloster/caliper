import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Ruler from '../components/Ruler';
import { SCALE_PRESET_LIST, SCALE_PRESETS } from '../lib/scalePresets';
import { FileText, ListTree, Ruler as RulerIcon, Layers, Sparkles } from 'lucide-react';

const PARSE_STAGES = [
  { text: 'Reading your document…', icon: FileText },
  { text: 'Identifying sections…', icon: ListTree },
  { text: 'Extracting questions…', icon: Layers },
  { text: 'Choosing scale types…', icon: RulerIcon },
  { text: 'Grouping constructs…', icon: Sparkles },
  { text: 'Almost done…', icon: Sparkles },
];

function ParsingOverlay() {
  const [stageIndex, setStageIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, PARSE_STAGES.length - 1));
    }, 2200);
    return () => clearInterval(interval);
  }, []);
  const stage = PARSE_STAGES[stageIndex];
  const Icon = stage.icon;
  return (
    <div className="parseOverlay">
      <div className="parseIconRing">
        <Icon size={22} className="parseIcon" />
      </div>
      <div className="parseStageText" key={stageIndex}>{stage.text}</div>
      <div className="parseProgressTrack"><div className="parseProgressFill" /></div>
      <div className="parseStageList">
        {PARSE_STAGES.map((s, i) => (
          <span key={i} className={`parseDot ${i <= stageIndex ? 'done' : ''}`} />
        ))}
      </div>
    </div>
  );
}

function groupBySection(qs) {
  const groups = [];
  let current = null;
  qs.forEach((q) => {
    const sec = q.section || null;
    if (!current || current.section !== sec) {
      current = { section: sec, items: [] };
      groups.push(current);
    }
    current.items.push(q);
  });
  return groups;
}

const defaultDraft = {
  text: '', type: 'likert', scale_type: 'agreement5', scale_min: 1, scale_max: 5,
  construct_id: '', weight: 1, reverse_coded: false, section: '',
};

export default function Builder() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [instrument, setInstrument] = useState(null);
  const [constructs, setConstructs] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showFrontMatter, setShowFrontMatter] = useState(false);
  const [frontMatter, setFrontMatter] = useState({ introduction: '', consent_text: '', closing_note: '' });
  const [code, setCode] = useState('');
  const [codeMsg, setCodeMsg] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState('');
  const fileInputRef = useRef(null);
  const [draft, setDraft] = useState(defaultDraft);

  const needsUnlock = searchParams.get('needsUnlock') === '1';
  const pendingFile = searchParams.get('pendingFile');

  useEffect(() => { load(); }, [id]);

  async function load() {
    const { data: inst } = await supabase.from('instruments').select('*').eq('id', id).single();
    setInstrument(inst);
    if (inst) setFrontMatter({ introduction: inst.introduction || '', consent_text: inst.consent_text || '', closing_note: inst.closing_note || '' });
    const { data: cons } = await supabase.from('constructs').select('*').eq('instrument_id', id);
    setConstructs(cons ?? []);
    if (cons?.length && !draft.construct_id) setDraft((d) => ({ ...d, construct_id: cons[0].id }));
    const { data: qs } = await supabase.from('questions').select('*').eq('instrument_id', id).order('order_index');
    setQuestions(qs ?? []);
  }

  async function saveFrontMatter() {
    await supabase.from('instruments').update(frontMatter).eq('id', id);
    setInstrument((i) => ({ ...i, ...frontMatter }));
    setShowFrontMatter(false);
  }

  async function runParse(path) {
    setParsing(true);
    setParseMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ instrument_id: id, file_path: path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Parsing failed');
      setParseMsg(`Parsed ${data.questionCount} questions across ${data.constructCount} new construct(s). Review each below.`);
      await load();
    } catch (err) {
      setParseMsg(err.message);
    } finally {
      setParsing(false);
      setSearchParams({});
    }
  }

  useEffect(() => {
    if (instrument?.unlocked && pendingFile) runParse(pendingFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument?.unlocked, pendingFile]);

  function triggerReupload() {
    if (!instrument.unlocked) return;
    fileInputRef.current?.click();
  }

  async function onInputChange(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const { data: { user } } = await supabase.auth.getUser();
    const path = `${user.id}/${id}_${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('drafts').upload(path, file);
    if (error) { setParseMsg('Upload failed: ' + error.message); return; }
    runParse(path);
  }

  async function ensureDefaultConstructs() {
    if (constructs.length) return constructs;
    const seed = [
      { instrument_id: id, name: 'Construct A', color: '#3E6B8C' },
      { instrument_id: id, name: 'Construct B', color: '#B8722A' },
    ];
    const { data } = await supabase.from('constructs').insert(seed).select();
    setConstructs(data ?? []);
    return data ?? [];
  }

  async function addQuestion() {
    if (!draft.text.trim()) return;
    const cons = await ensureDefaultConstructs();
    const constructId = draft.construct_id || cons[0]?.id || null;
    const preset = SCALE_PRESETS[draft.scale_type];
    const row = {
      text: draft.text,
      type: draft.type,
      section: draft.section || null,
      construct_id: draft.type === 'likert' ? constructId : null,
      weight: draft.type === 'likert' ? draft.weight : null,
      reverse_coded: draft.type === 'likert' ? draft.reverse_coded : false,
      scale_type: draft.type === 'likert' ? draft.scale_type : null,
      scale_min: draft.type === 'likert' ? (draft.scale_type === 'custom' ? draft.scale_min : preset.min) : null,
      scale_max: draft.type === 'likert' ? (draft.scale_type === 'custom' ? draft.scale_max : preset.max) : null,
      scale_labels: draft.type === 'likert' ? preset.labels : null,
      instrument_id: id,
      order_index: questions.length,
    };
    const { data, error } = await supabase.from('questions').insert(row).select().single();
    if (!error) {
      setQuestions((qs) => [...qs, data]);
      setDraft({ ...defaultDraft, construct_id: constructId });
      setShowForm(false);
    }
  }

  async function removeQuestion(qid) {
    await supabase.from('questions').delete().eq('id', qid);
    setQuestions((qs) => qs.filter((q) => q.id !== qid));
  }

  async function confirmQuestion(qid) {
    await supabase.from('questions').update({ needs_review: false }).eq('id', qid);
    setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, needs_review: false } : q)));
  }

  async function setConstructRole(cid, role) {
    await supabase.from('constructs').update({ role }).eq('id', cid);
    setConstructs((cs) => cs.map((c) => (c.id === cid ? { ...c, role } : c)));
  }

  async function publish() {
    await supabase.from('instruments').update({ status: 'Live' }).eq('id', id);
    load();
  }

  async function renameTitle(title) {
    setInstrument((i) => ({ ...i, title }));
    await supabase.from('instruments').update({ title }).eq('id', id);
  }

  async function redeemCode() {
    setCodeMsg('');
    const { data, error } = await supabase.rpc('redeem_access_code', { p_code: code.trim().toUpperCase(), p_instrument_id: id });
    if (error) { setCodeMsg(error.message); return; }
    if (data === 'success') { setCodeMsg('Unlocked!'); load(); } else { setCodeMsg(data); }
  }

  if (!instrument) return <div className="loadingScreen">Loading…</div>;

  const pendingReview = questions.filter((q) => q.needs_review).length;
  const groups = groupBySection(questions);

  return (
    <div>
      <div className="pageHead">
        <div style={{ flex: 1 }}>
          <div className="topline">Instrument · {instrument.status} · {instrument.unlocked ? 'Unlocked' : 'Free tier'}</div>
          <input className="pageTitleInput" value={instrument.title} onChange={(e) => renameTitle(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btnGhost" onClick={publish} disabled={instrument.status === 'Live'}>{instrument.status === 'Live' ? 'Live' : 'Publish'}</button>
          {instrument.status === 'Live' && (
            <Link className="btnGhost" to={`/instrument/${id}/responses`}>View responses</Link>
          )}
        </div>
      </div>

      <div className="builderLayout">
        <div>
          <div className="formCard" style={{ borderColor: 'var(--line)', marginBottom: 16, marginTop: 0 }}>
            <button type="button" className="linkBtn" style={{ textAlign: 'left' }} onClick={() => setShowFrontMatter((s) => !s)}>
              {showFrontMatter ? 'Hide' : 'Edit'} introduction, consent &amp; closing note
            </button>
            {showFrontMatter && (
              <>
                <div className="field"><label>Introduction / purpose</label>
                  <textarea rows={3} value={frontMatter.introduction} onChange={(e) => setFrontMatter({ ...frontMatter, introduction: e.target.value })}
                    placeholder="Shown before the questions. Explain what the study is about and roughly how long it takes." style={{ fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 10 }} />
                </div>
                <div className="field"><label>Consent statement</label>
                  <textarea rows={3} value={frontMatter.consent_text} onChange={(e) => setFrontMatter({ ...frontMatter, consent_text: e.target.value })}
                    placeholder="If set, respondents must check a box agreeing to this before they can answer any questions." style={{ fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 10 }} />
                </div>
                <div className="field"><label>Closing note</label>
                  <textarea rows={2} value={frontMatter.closing_note} onChange={(e) => setFrontMatter({ ...frontMatter, closing_note: e.target.value })}
                    placeholder="Shown after they submit. Thank them, mention contact info if relevant." style={{ fontFamily: 'inherit', fontSize: 14, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 10 }} />
                </div>
                <div className="formActions">
                  <button className="btnPrimary" onClick={saveFrontMatter}>Save</button>
                </div>
              </>
            )}
          </div>

          {parsing && <ParsingOverlay />}

          {!parsing && pendingReview > 0 && (
            <div className="parsedBanner">{pendingReview} parsed question(s) still need review. Tap "needs review" on any question below to confirm it.</div>
          )}

          {!parsing && groups.map((group, gi) => (
            <div key={gi} style={{ marginBottom: 18 }}>
              {group.section && <div className="sectionLabel" style={{ marginTop: 0 }}>{group.section}</div>}
              <div className="qList">
                {group.items.map((q) => {
                  const globalIndex = questions.findIndex((qq) => qq.id === q.id);
                  const construct = constructs.find((c) => c.id === q.construct_id);
                  return (
                    <div className="qRow" key={q.id} style={q.needs_review ? { borderColor: 'var(--accent)' } : undefined}>
                      <div className="qTop">
                        <div className="qText">{String(globalIndex + 1).padStart(2, '0')}&nbsp;&nbsp;{q.text}</div>
                        <button className="qDelete" onClick={() => removeQuestion(q.id)}>✕</button>
                      </div>
                      <div className="qMeta">
                        <span className="qBadge">{q.type}</span>
                        {construct && <span className="qBadge" style={{ color: construct.color, borderColor: construct.color }}>{construct.name}</span>}
                        {construct?.role && <span className="qBadge">{construct.role === 'independent' ? 'IV' : 'DV'}</span>}
                        {q.reverse_coded && <span className="qBadge">reverse-coded</span>}
                        {q.weight != null && <span className="qBadge">weight {q.weight}</span>}
                        {q.needs_review && (
                          <button className="qBadge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }} onClick={() => confirmQuestion(q.id)}>
                            needs review, tap to confirm
                          </button>
                        )}
                      </div>
                      {q.type === 'likert' && <Ruler min={q.scale_min} max={q.scale_max} color={construct ? construct.color : undefined} labels={q.scale_labels} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!parsing && questions.length === 0 && <div className="emptyState">No questions yet. Add one below, or upload a draft to auto-parse a full set.</div>}

          {!parsing && (!showForm ? (
            <button className="addBtn" onClick={() => setShowForm(true)} style={{ marginTop: 16 }}>+ Add question</button>
          ) : (
            <div className="formCard">
              <div className="field"><label>Question text</label><input value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></div>
              <div className="formRow">
                <div className="field"><label>Section (optional)</label><input value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} placeholder="e.g. Demographics" /></div>
                <div className="field"><label>Type</label>
                  <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                    <option value="likert">Likert scale</option>
                    <option value="open">Open text</option>
                    <option value="demographic">Demographic</option>
                  </select>
                </div>
              </div>
              {draft.type === 'likert' && (
                <div className="formRow">
                  <div className="field"><label>Scale</label>
                    <select value={draft.scale_type} onChange={(e) => setDraft({ ...draft, scale_type: e.target.value })}>
                      {SCALE_PRESET_LIST.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                    </select>
                  </div>
                  {draft.scale_type === 'custom' && (
                    <>
                      <div className="field"><label>Min</label><input type="number" value={draft.scale_min} onChange={(e) => setDraft({ ...draft, scale_min: Number(e.target.value) })} /></div>
                      <div className="field"><label>Max</label><input type="number" value={draft.scale_max} onChange={(e) => setDraft({ ...draft, scale_max: Number(e.target.value) })} /></div>
                    </>
                  )}
                  <div className="field"><label>Construct</label>
                    <select value={draft.construct_id} onChange={(e) => setDraft({ ...draft, construct_id: e.target.value })}>
                      {constructs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Weight</label><input type="number" step="0.1" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: Number(e.target.value) })} /></div>
                </div>
              )}
              {draft.type === 'likert' && draft.scale_type !== 'custom' && (
                <Ruler min={SCALE_PRESETS[draft.scale_type].min} max={SCALE_PRESETS[draft.scale_type].max} color="var(--accent)" labels={SCALE_PRESETS[draft.scale_type].labels} />
              )}
              {draft.type === 'likert' && (
                <label className="checkRow"><input type="checkbox" checked={draft.reverse_coded} onChange={(e) => setDraft({ ...draft, reverse_coded: e.target.checked })} /> Reverse-coded</label>
              )}
              <div className="formActions">
                <button className="btnGhost" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btnPrimary" onClick={addQuestion}>Save question</button>
              </div>
            </div>
          ))}
        </div>

        <aside className="builderSide">
          <div className="sideCard">
            {!instrument.unlocked ? (
              <div className="sideSection">
                <div className="sideCardTitle">Unlock this instrument</div>
                <p className="sideCardText">Enter an access code to enable draft upload, scoring, and export.</p>
                {needsUnlock && <p className="sideCardText" style={{ color: 'var(--accent)' }}>Redeem a code to parse your uploaded draft.</p>}
                <input placeholder="Access code" value={code} onChange={(e) => setCode(e.target.value)} style={{ marginBottom: 8, width: '100%' }} />
                <button className="btnGhost wide" onClick={redeemCode}>Redeem</button>
                {codeMsg && <div className="qMeta" style={{ marginTop: 8 }}>{codeMsg}</div>}
              </div>
            ) : (
              <div className="sideSection">
                <div className="sideCardTitle">Draft upload</div>
                <p className="sideCardText">Re-parse a new draft into this instrument.</p>
                <button className="btnGhost wide" onClick={triggerReupload} disabled={parsing}>
                  {parsing ? 'Parsing…' : 'Upload / re-parse draft'}
                </button>
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={onInputChange} />
                {parseMsg && <div className="qMeta" style={{ marginTop: 10 }}>{parseMsg}</div>}
              </div>
            )}

            {instrument.status === 'Live' && (
              <div className="sideSection">
                <div className="sideCardTitle">Public form link</div>
                <p className="sideCardText">Share this with respondents.</p>
                <code className="linkChip">{window.location.origin}/form/{id}</code>
              </div>
            )}

            <div className="sideSection">
              <div className="sideCardTitle">Constructs</div>
              {constructs.length === 0 && <p className="sideCardText">Added automatically once you save your first Likert question.</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {constructs.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                    <div className="constructChip"><span className="swatch" style={{ background: c.color }} />{c.name}</div>
                    <select value={c.role || ''} onChange={(e) => setConstructRole(c.id, e.target.value || null)} style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 6 }}>
                      <option value="">role</option>
                      <option value="independent">Independent</option>
                      <option value="dependent">Dependent</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
