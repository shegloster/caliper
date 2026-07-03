import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { Eye, EyeOff } from 'lucide-react';

function passwordChecks(pw) {
  return { length: pw.length >= 8, upper: /[A-Z]/.test(pw), number: /[0-9]/.test(pw) };
}

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Clicking the emailed link lands here with a recovery session already
    // established by Supabase via the URL hash. onAuthStateChange fires
    // PASSWORD_RECOVERY once that session is in place.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    // In case the event already fired before this listener attached
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const checks = passwordChecks(password);
    if (!checks.length || !checks.upper || !checks.number) {
      setError('Password needs at least 8 characters, one capital letter, and one number.');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate('/dashboard'), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <div className="authScreen">
        <div className="authFormPane" style={{ width: '100%' }}>
          <div className="authCard">
            <div className="sideCardTitle">Checking your reset link…</div>
            <p className="sideCardText">If this doesn't update in a few seconds, the link may have expired. Request a new one from the login page.</p>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="authScreen">
        <div className="authFormPane" style={{ width: '100%' }}>
          <div className="authCard">
            <div className="sideCardTitle">Password updated</div>
            <p className="sideCardText">Taking you to your dashboard…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="authScreen">
      <div className="authFormPane" style={{ width: '100%' }}>
        <div className="authCard">
          <div className="sideCardTitle" style={{ marginBottom: 4 }}>Set a new password</div>
          <p className="sideCardText" style={{ marginBottom: 18 }}>Choose a new password for your account.</p>
          <form className="authForm" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <label>New password</label>
              <div className="pwField">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="pwToggle" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <ul className="pwChecklist">
              {(() => {
                const c = passwordChecks(password);
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
              <label>Re-enter new password</label>
              <input type={showPw ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            {error && <div className="errorText">{error}</div>}
            <button type="submit" className="btnPrimary wide" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
