import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function RespondentForm() {
  const { instrumentId } = useParams();
  const [instrument, setInstrument] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
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
  if (done) return <div className="respondentScreen gridBg"><div className="respondentCard"><h1 className="pageTitle">Thank you</h1><p>Your response has been recorded.</p></div></div>;

  const allAnswered = questions.filter((q) => q.type === 'likert').every((q) => answers[q.id] != null);

  return (
    <div className="respondentScreen gridBg">
      <div className="respondentCard">
        <h1 className="pageTitle" style={{ fontSize: 24 }}>{instrument.title}</h1>
        <div className="qList">
          {questions.map((q, i) => (
            <div className="qRow" key={q.id}>
              <div className="qText">{String(i + 1).padStart(2, '0')}&nbsp;&nbsp;{q.text}</div>
              {q.type === 'likert' ? (
                <div className="scaleBtns">
                  {Array.from({ length: q.scale_max - q.scale_min + 1 }).map((_, idx) => {
                    const v = q.scale_min + idx;
                    return (
                      <button key={v} type="button" className={`scaleBtn ${answers[q.id] === v ? 'selected' : ''}`} onClick={() => setAnswers((a) => ({ ...a, [q.id]: v }))}>{v}</button>
                    );
                  })}
                </div>
              ) : (
                <input className="respInput" value={answers[q.id] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
              )}
            </div>
          ))}
        </div>
        {errorMsg && <div className="errorText">{errorMsg}</div>}
        <button className="btnPrimary wide" disabled={!allAnswered} onClick={submit} style={{ marginTop: 16 }}>Submit response</button>
      </div>
    </div>
  );
}
