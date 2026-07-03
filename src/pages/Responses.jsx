import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { scoreConstruct, meanSD, cronbachAlpha, skewness, itemTotalCorrelations, constructCorrelationMatrix, slug } from '../lib/scoring';
import Gauge from '../components/Gauge';

export default function Responses() {
  const { id } = useParams();
  const [instrument, setInstrument] = useState(null);
  const [constructs, setConstructs] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [respondents, setRespondents] = useState([]);
  const [responsesByRespondent, setResponsesByRespondent] = useState({});
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { load(); }, [id]);

  async function load() {
    const { data: inst } = await supabase.from('instruments').select('*').eq('id', id).single();
    setInstrument(inst);
    const { data: cons } = await supabase.from('constructs').select('*').eq('instrument_id', id);
    setConstructs(cons ?? []);
    const { data: qs } = await supabase.from('questions').select('*').eq('instrument_id', id);
    setQuestions(qs ?? []);
    const { data: resps } = await supabase.from('respondents').select('*').eq('instrument_id', id).order('submitted_at', { ascending: false });
    setRespondents(resps ?? []);

    if (resps?.length) {
      const { data: answers } = await supabase.from('responses').select('*').in('respondent_id', resps.map((r) => r.id));
      const grouped = {};
      resps.forEach((r) => { grouped[r.id] = {}; });
      (answers ?? []).forEach((a) => { grouped[a.respondent_id][a.question_id] = a.raw_value; });
      setResponsesByRespondent(grouped);
    }
  }

  function rawFor(respondentId) { return responsesByRespondent[respondentId] || {}; }

  function exportCSV() {
    const headers = ['respondent_id', 'submitted_at', ...questions.map((q) => q.id), ...constructs.map((c) => `score_${slug(c.name)}`)];
    const rows = respondents.map((r) => {
      const raw = rawFor(r.id);
      const qVals = questions.map((q) => raw[q.id] ?? '');
      const scores = constructs.map((c) => { const s = scoreConstruct(c.id, questions, raw); return s == null ? '' : s.toFixed(1); });
      return [r.id, r.submitted_at, ...qVals, ...scores];
    });
    const csv = [headers.join(','), ...rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${slug(instrument.title)}_scored.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (!instrument) return <div className="loadingScreen">Loading…</div>;

  const rawResponses = respondents.map((r) => rawFor(r.id));

  const constructStats = constructs.map((c) => {
    const scores = respondents.map((r) => scoreConstruct(c.id, questions, rawFor(r.id))).filter((v) => v != null);
    const { mean, sd } = meanSD(scores);
    const responsesByQuestion = {};
    questions.filter((q) => q.construct_id === c.id).forEach((q) => {
      responsesByQuestion[q.id] = respondents.map((r) => rawFor(r.id)[q.id]).filter((v) => v != null);
    });
    const alpha = cronbachAlpha(questions.filter((q) => q.construct_id === c.id && q.type === 'likert'), responsesByQuestion);
    const skew = skewness(scores);
    return { ...c, mean, sd, alpha, skew };
  });

  const itemAnalysis = constructs.map((c) => ({
    construct: c,
    items: itemTotalCorrelations(c.id, questions, rawResponses),
  }));

  const corrMatrix = constructs.length > 1 ? constructCorrelationMatrix(constructs, questions, rawResponses, scoreConstruct) : null;

  return (
    <div>
      <div className="pageHead">
        <div style={{ flex: 1 }}>
          <div className="topline">Instrument</div>
          <h1 className="pageTitle" style={{ margin: 0 }}>{instrument.title}</h1>
        </div>
        {instrument.unlocked ? (
          <button className="downloadBtn" onClick={exportCSV}>Export scored CSV</button>
        ) : (
          <span className="qMeta">Unlock in Builder to enable scoring &amp; export</span>
        )}
      </div>

      <div className="capBarWrap">
        <div className="qMeta" style={{ marginBottom: 6 }}>{respondents.length}/{instrument.unlocked ? '∞' : 30} responses</div>
        {!instrument.unlocked && (
          <div className="capBar"><div className="capFill" style={{ width: `${Math.min(100, (respondents.length / 30) * 100)}%` }} /></div>
        )}
      </div>

      {instrument.unlocked && (
        <>
          <div className="gaugeRow">
            {constructStats.map((c) => (
              <Gauge key={c.id} value={c.mean} label={c.name} color={c.color} />
            ))}
          </div>
          <div className="statsPanel">
            <div className="sideSection" style={{ paddingTop: 0, borderTop: 'none' }}>
              <div className="sectionLabel">Descriptive statistics</div>
              <div className="statsGrid5">
                <span></span><span>Mean</span><span>SD</span><span>α</span><span>Skew</span>
                {constructStats.map((c) => (
                  <React.Fragment key={c.id}>
                    <span style={{ color: c.color, fontWeight: 600 }}>{c.name}</span>
                    <span>{c.mean == null ? 'N/A' : c.mean.toFixed(1)}</span>
                    <span>{c.sd == null ? 'N/A' : c.sd.toFixed(1)}</span>
                    <span>{c.alpha == null ? 'N/A' : c.alpha.toFixed(2)}</span>
                    <span>{c.skew == null ? 'N/A' : c.skew.toFixed(2)}</span>
                  </React.Fragment>
                ))}
              </div>
              <p className="sideCardText" style={{ marginTop: 12 }}>
                α above 0.7 indicates acceptable internal consistency. Skew near 0 suggests a roughly normal distribution.
              </p>
            </div>

            <div className="sideSection">
              <div className="sectionLabel">Item analysis</div>
              {itemAnalysis.map(({ construct, items }) => (
                items.length > 0 && (
                  <div key={construct.id} style={{ marginBottom: 14 }}>
                    <div style={{ color: construct.color, fontWeight: 600, fontSize: 12.5, marginBottom: 6 }}>{construct.name}</div>
                    <div className="itemCorrGrid">
                      {items.map(({ question, r }) => (
                        <React.Fragment key={question.id}>
                          <span className="qMeta" style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12.5, color: 'var(--ink)' }}>{question.text}</span>
                          <span style={{ color: r != null && r < 0.3 ? 'var(--accent)' : 'var(--ink)' }}>{r == null ? 'N/A' : r.toFixed(2)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )
              ))}
              <p className="sideCardText" style={{ marginTop: 4 }}>
                Corrected item-total correlation. Below 0.3 suggests an item may not belong with the rest of its construct.
              </p>
            </div>

            {corrMatrix && (
              <div className="sideSection">
                <div className="sectionLabel">Construct correlations</div>
                <table className="corrTable">
                  <thead>
                    <tr>
                      <th></th>
                      {constructs.map((c) => <th key={c.id} style={{ color: c.color }}>{c.name.slice(0, 3).toUpperCase()}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {constructs.map((c1, i) => (
                      <tr key={c1.id}>
                        <td style={{ color: c1.color, fontWeight: 600 }}>{c1.name}</td>
                        {constructs.map((c2, j) => (
                          <td key={c2.id}>{i === j ? '1.00' : corrMatrix[i][j] == null ? 'N/A' : corrMatrix[i][j].toFixed(2)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="sideCardText" style={{ marginTop: 12 }}>
                  Correlations above 0.85 between constructs meant to measure distinct things can indicate a discriminant validity concern.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      <div className="sectionLabel" style={{ marginTop: 20 }}>Respondents</div>
      <div className="respTable">
        {respondents.map((r) => (
          <div className="respRow" key={r.id}>
            <div className="respHead" onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
              <span className="respId">{r.id.slice(0, 8)}</span>
              <span className="respDate">{new Date(r.submitted_at).toLocaleDateString()}</span>
            </div>
            {expanded === r.id && (
              <div className="respDetail">
                {instrument.unlocked ? constructs.map((c) => (
                  <Gauge key={c.id} value={scoreConstruct(c.id, questions, rawFor(r.id))} label={c.name} color={c.color} size={68} />
                )) : <div className="qMeta">Unlock to see this respondent's scores.</div>}
              </div>
            )}
          </div>
        ))}
        {respondents.length === 0 && <div className="qMeta">No responses yet. Share the public form link from the Builder page.</div>}
      </div>
    </div>
  );
}
