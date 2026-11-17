import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabase';
import { esRolAdmin } from './lib/roles';
import Layout from './components/Layout';
import Login from './components/Login';
import ForcePasswordChange from './components/ForcePasswordChange';
import Inicio from './components/Inicio';
import DashboardAnalitico from './components/DashboardAnalitico';
import AdminUsuarios from './components/AdminUsuarios';
import RegistroBeneficiario from './components/RegistroBeneficiario';
import EntregaRegalo from './components/EntregaRegalo';

export default function App() {
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) {
        setPerfil(null);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const cargarPerfil = useCallback(async (uid) => {
    const { data, error } = await supabase.from('perfiles').select('*').eq('id', uid).single();
    if (error || !data || !data.activo) {
      setAviso(
        !error && data
          ? 'Tu cuenta está desactivada. Contacta a la Municipalidad.'
          : 'Tu cuenta no tiene un perfil asignado.'
      );
      await supabase.auth.signOut();
      return;
    }

    const { data: rol } = await supabase.from('roles').select('nombre').eq('id', data.rol_id).single();
    if (!rol?.nombre) {
      setAviso('Tu perfil no tiene un rol válido asignado. Contacta a la Municipalidad.');
      await supabase.auth.signOut();
      return;
    }

    setAviso(null);
    setPerfil({ ...data, rol: rol.nombre });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session?.user?.id) cargarPerfil(session.user.id);
  }, [session?.user?.id, cargarPerfil]);

  if (loading || (session && !perfil)) {
    return <div className="d-flex vh-100 align-items-center justify-content-center">Verificando seguridad...</div>;
  }

  const esAdmin = esRolAdmin(perfil?.rol);

  // CR-02: mientras requiere_cambio_clave sea true, ninguna ruta operativa es accesible.
  const protegida = (elemento, { soloAdmin = false, soloOperativo = false } = {}) => {
    if (!session) return <Navigate to="/login" replace />;
    if (perfil.requiere_cambio_clave) return <Navigate to="/force-password" replace />;
    if ((soloAdmin && !esAdmin) || (soloOperativo && esAdmin)) return <Navigate to="/" replace />;
    return <Layout perfil={perfil}>{elemento}</Layout>;
  };

  return (
    <Routes>
      <Route path="/login" element={!session ? <Login aviso={aviso} /> : <Navigate to="/" replace />} />

      <Route
        path="/force-password"
        element={
          session && perfil?.requiere_cambio_clave ? (
            <ForcePasswordChange perfil={perfil} onDone={() => cargarPerfil(perfil.id)} />
          ) : (
            <Navigate to={session ? '/' : '/login'} replace />
          )
        }
      />

      <Route path="/" element={protegida(esAdmin ? <DashboardAnalitico /> : <Inicio perfil={perfil} />)} />
      <Route path="/registro" element={protegida(<RegistroBeneficiario perfil={perfil} />, { soloOperativo: true })} />
      <Route path="/entrega" element={protegida(<EntregaRegalo perfil={perfil} />, { soloOperativo: true })} />
      <Route path="/usuarios" element={protegida(<AdminUsuarios perfil={perfil} />, { soloAdmin: true })} />

      <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
    </Routes>
  );
}