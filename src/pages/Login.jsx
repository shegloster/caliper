import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Gauge from '../components/Gauge';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', institution: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.name, institution: form.institution } },
        });
        if (error) throw error;
      }
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
  }

  return (
    <div className="authScreen">
      <div className="authBrandPane">
        <div className="brandBlock">
          <div className="brand large"><span className="brandDot" />CALIPER</div>
          <div className="brandSubtitle">Research instruments, calibrated</div>
        </div>
        <p className="authTagline">Upload your draft questionnaire, deploy it in minutes, and every response arrives already scored.</p>
        <div className="illustrationBlock">
          <div className="illustrationLabel">Live construct scoring</div>
          <div className="authIllustration">
            <Gauge value={78} label="Health Literacy" color="#3E6B8C" size={78} />
            <Gauge value={41} label="Perceived Barriers" color="#B8722A" size={78} />
            <Gauge value={63} label="Social Support" color="#4B6B54" size={78} />
          </div>
        </div>
      </div>
      <div className="authFormPane">
        <div className="authCard">
          <div className="authToggle">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
          </div>

          <button type="button" className="btnGhost wide" onClick={handleGoogle} style={{ marginBottom: 16 }}>
            Continue with Google
          </button>
          <div className="dividerRow"><span>or</span></div>

          <form className="authForm" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <>
                <div className="field"><label>Full name</label><input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label>Institution</label><input type="text" required value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></div>
              </>
            )}
            <div className="field"><label>Email</label><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="field"><label>Password</label><input type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            {error && <div className="errorText">{error}</div>}
            <button type="submit" className="btnPrimary wide" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
