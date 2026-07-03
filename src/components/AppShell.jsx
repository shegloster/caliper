import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { LayoutGrid, SlidersHorizontal, BarChart3, LogOut } from 'lucide-react';

export default function AppShell() {
  const [profile, setProfile] = useState(null);
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(data);
    })();
  }, [location.pathname]);

  async function logout() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  const inInstrument = !!id;
  const isActive = (fragment) => location.pathname.includes(fragment);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/dashboard" className="brand"><span className="brandDot" />CALIPER</Link>
        <nav className="navList">
          <Link className={`navItem ${location.pathname === '/dashboard' ? 'active' : ''}`} to="/dashboard">
            <LayoutGrid size={16} /> Dashboard
          </Link>
          {inInstrument && (
            <>
              <div className="navDivider" />
              <div className="navSection">Current instrument</div>
              <Link className={`navItem ${isActive('/builder') ? 'active' : ''}`} to={`/instrument/${id}/builder`}>
                <SlidersHorizontal size={16} /> Builder
              </Link>
              <Link className={`navItem ${isActive('/responses') ? 'active' : ''}`} to={`/instrument/${id}/responses`}>
                <BarChart3 size={16} /> Responses
              </Link>
            </>
          )}
        </nav>
        <div className="sidebarFoot">
          <div className="who">{profile?.full_name || 'Researcher'}</div>
          <div className="whoSub">{profile?.institution || ''}</div>
          <div style={{ marginTop: 8 }}>
            <span className={`planPill ${profile?.plan_tier === 'subscription' ? 'live' : 'draft'}`}>
              {profile?.plan_tier === 'subscription' ? 'Semester pass' : 'Free plan'}
            </span>
          </div>
          <button className="logoutBtn" onClick={logout}><LogOut size={13} /> Log out</button>
        </div>
      </aside>

      <main className="shellMain gridBg">
        <div className="shellInner">
          <Outlet />
        </div>
      </main>

      <nav className="tabbar">
        <Link className={`tabbarItem ${location.pathname === '/dashboard' ? 'active' : ''}`} to="/dashboard">
          <LayoutGrid size={18} /> Dashboard
        </Link>
        {inInstrument && (
          <>
            <Link className={`tabbarItem ${isActive('/builder') ? 'active' : ''}`} to={`/instrument/${id}/builder`}>
              <SlidersHorizontal size={18} /> Builder
            </Link>
            <Link className={`tabbarItem ${isActive('/responses') ? 'active' : ''}`} to={`/instrument/${id}/responses`}>
              <BarChart3 size={18} /> Responses
            </Link>
          </>
        )}
      </nav>
    </div>
  );
}
