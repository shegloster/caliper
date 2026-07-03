import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Builder from './pages/Builder.jsx';
import Responses from './pages/Responses.jsx';
import RespondentForm from './pages/RespondentForm.jsx';

function useSession() {
  const [session, setSession] = useState(undefined); // undefined = loading
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => sub.subscription.unsubscribe();
  }, []);
  return session;
}

function Protected({ children }) {
  const session = useSession();
  if (session === undefined) return <div className="loadingScreen">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public — respondents fill this out, no login required */}
        <Route path="/form/:instrumentId" element={<RespondentForm />} />

        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/instrument/:id/builder" element={<Protected><Builder /></Protected>} />
        <Route path="/instrument/:id/responses" element={<Protected><Responses /></Protected>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
