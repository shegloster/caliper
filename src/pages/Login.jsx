import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import Gauge from '../components/Gauge';
import { Eye, EyeOff } from 'lucide-react';

function passwordChecks(pw) {
  return { length: pw.length >= 8, upper: /[A-Z]/.test(pw), number: /[0-9]/.test(pw) };
}

export default function Login() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', institution: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      const checks = passwordChecks(form.password);
      if (!checks.length || !checks.upper || !checks.number) {
        setError('Password needs at least 8 characters, one capital letter, and one number.');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError("Passwords don't match.");
        return;
      }
    }

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
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Log in</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Register</button>
          </div>

          <button type="button" className="btnGhost wide" onClick={handleGoogle} style={{ marginBottom: 16 }}>
            Continue with Google
          </button>
          <div className="dividerRow"><span>or</span></div>

          <form className="authForm" onSubmit={handleSubmit} noValidate>
            {mode === 'register' && (
              <>
                <div className="field"><label>Full name</label><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="field"><label>Institution</label><input type="text" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} /></div>
              </>
            )}
            <div className="field"><label>Email</label><input type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>

            <div className="field">
              <label>Password</label>
              <div className="pwField">
                <input type={showPw ? 'text' : 'password'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="pwToggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <>
                <ul className="pwChecklist">
                  {(() => {
                    const c = passwordChecks(form.password);
                    return (
                      <>
                        <li className={c.length ? 'met' : ''}><span className="pwDot" /> At least 8 characters</li>
                        <li className={c.upper ? 'met' : ''}><span className="pwDot" /> One capital letter</li>
                        <li className={c.number ? 'met' : ''}><span className="pwDot" /> One number</li>
                      </>
                    );
                  })()}
                </ul>
                <div className="field">
                  <label>Re-enter password</label>
                  <div className="pwField">
                    <input type={showConfirmPw ? 'text' : 'password'} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
                    <button type="button" className="pwToggle" onClick={() => setShowConfirmPw((s) => !s)} aria-label={showConfirmPw ? 'Hide password' : 'Show password'}>
                      {showConfirmPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </>
            )}

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
