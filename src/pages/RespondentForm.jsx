import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

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

export default function RespondentForm() {
  const { instrumentId } = useParams();
  const [instrument, setInstrument] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [consented, setConsented] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => { load(); }, [instrumentId]);

  async function load() {
    const { data: inst } = await supabase.from('instruments').select('*').eq('id', instrumentId).eq('status', 'Live').single();
    setInstrument(inst);
    if (inst) {
      const { data: qs } = await supabase.from('questions').select('*').eq('instrument_id', instrumentId).order('order_index');
      setQuestions(qs ?? []);
    }
  }

  async function submit() {
    setErrorMsg('');
    const { data: respondent, error: respErr } = await supabase
      .from('respondents')
      .insert({ instrument_id: instrumentId })
      .select()
      .single();

    if (respErr) { setErrorMsg('This instrument has reached its free response limit.'); return; }

    const rows = questions.map((q) => ({ respondent_id: respondent.id, question_id: q.id, raw_value: answers[q.id] ?? null }));
    await supabase.from('responses').insert(rows);
    setDone(true);
  }

  if (!instrument) return <div className="loadingScreen">This form isn't available.</div>;

  if (done) {
    return (
      <div className="respondentScreen gridBg">
        <div className="respondentCard">
          <h1 className="pageTitle">Thank you</h1>
          <p>{instrument.closing_note || 'Your response has been recorded.'}</p>
        </div>
      </div>
    );
  }

  // Intro / consent gate, shown before any question if either is set
  if (!started && (instrument.introduction || instrument.consent_text)) {
    return (
      <div className="respondentScreen gridBg">
        <div className="respondentCard">
          <h1 className="pageTitle" style={{ fontSize: 24 }}>{instrument.title}</h1>
          {instrument.introduction && <p style={{ lineHeight: 1.6, marginTop: 12 }}>{instrument.introduction}</p>}
          {instrument.consent_text && (
            <div className="sideCard" style={{ marginTop: 20, padding: 18 }}>
              <p style={{ lineHeight: 1.6, marginBottom: 12 }}>{instrument.consent_text}</p>
              <label className="checkRow">
                <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
                I have read the above and consent to take part in this study.
              </label>
            </div>
          )}
          <button
            className="btnPrimary wide"
            style={{ marginTop: 20 }}
            disabled={instrument.consent_text ? !consented : false}
            onClick={() => setStarted(true)}
          >
            Begin
          </button>
        </div>
      </div>
    );
  }

  const groups = groupBySection(questions);
  const allAnswered = questions.filter((q) => q.type === 'likert').every((q) => answers[q.id] != null);

  return (
    <div className="respondentScreen gridBg">
      <div className="respondentCard">
        <h1 className="pageTitle" style={{ fontSize: 24 }}>{instrument.title}</h1>
        {groups.map((group, gi) => (
          <div key={gi} style={{ marginTop: gi === 0 ? 20 : 28 }}>
            {group.section && <div className="sectionLabel" style={{ marginTop: 0 }}>{group.section}</div>}
            <div className="qList">
              {group.items.map((q) => {
                const globalIndex = questions.findIndex((qq) => qq.id === q.id);
                return (
                  <div className="qRow" key={q.id}>
                    <div className="qText">{String(globalIndex + 1).padStart(2, '0')}&nbsp;&nbsp;{q.text}</div>
                    {q.type === 'likert' ? (
                      <div className="scaleBtns" style={{ flexWrap: 'wrap' }}>
                        {Array.from({ length: q.scale_max - q.scale_min + 1 }).map((_, idx) => {
                          const v = q.scale_min + idx;
                          const label = q.scale_labels?.[idx];
                          return (
                            <button
                              key={v} type="button"
                              className={`scaleBtn ${answers[q.id] === v ? 'selected' : ''}`}
                              onClick={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                              title={label || undefined}
                              style={label ? { width: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, height: 'auto' } : undefined}
                            >
                              <span>{v}</span>
                              {label && <span style={{ fontSize: 9.5, fontFamily: "'Archivo', sans-serif", fontWeight: 500, lineHeight: 1.15, maxWidth: 64, textAlign: 'center' }}>{label}</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <input className="respInput" value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {errorMsg && <div className="errorText" style={{ marginTop: 16 }}>{errorMsg}</div>}
        <button className="btnPrimary wide" disabled={!allAnswered} onClick={submit} style={{ marginTop: 20 }}>Submit response</button>
      </div>
    </div>
  );
}
