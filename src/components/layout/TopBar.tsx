import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Menu, Package, Building2, X, FlaskConical, FileText, ShieldCheck, DollarSign, GraduationCap, FolderArchive, Gift } from 'lucide-react';
import { supabase } from '../../lib/supabase';

const routeNames: Record<string, string> = {
  '/': 'Agenda',
  '/hoje': 'Agenda',
  '/agenda': 'Agenda',
  '/clientes': 'Clientes',
  '/orcamentos': 'Orçamentos',
  '/servicos': 'Serviços',
  '/servicos/precificacao': 'Precificação',
  '/estoque': 'Estoque',
  '/financeiro': 'Financeiro',
  '/financeiro/contas-a-receber': 'Contas a Receber',
  '/financeiro/taxas': 'Formas & Taxas',
  '/treinamentos': 'Academia Detailer',
  '/treinamento': 'Academia Detailer',
  '/arquivos-digitais': 'Arquivos Digitais',
  '/indique': 'Indique e Ganhe',
  '/configuracoes': 'Minha Oficina',
  '/minha-oficina': 'Minha Oficina',
  '/ajustes/arquivos-digitais': 'Arquivos Digitais',
  '/configuracoes/arquivos-digitais': 'Arquivos Digitais',
  '/diluicao': 'Diluição',
};

export const TopBar: React.FC = () => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  
  useEffect(() => {
    async function checkAdmin() {
      try {
        const { data } = await supabase.rpc('is_platform_admin');
        if (data) setIsAdmin(true);
      } catch (err) {}
    }
    checkAdmin();
  }, []);

  const title = routeNames[location.pathname] || 'Plataforma';

  return (
    <>
      <header className="lg:hidden fixed top-0 left-0 right-0 h-[64px] bg-graphite-900 border-b border-graphite-600 flex items-center justify-between px-4 z-40">
        <h1 className="font-display text-[16px] text-vapor-100 tracking-widest">
          {title}
        </h1>
        <div className="flex items-center gap-1">
          <Link
            to="/diluicao"
            title="Calculadora de Diluição"
            className="p-2 text-vapor-100 hover:text-amber-500 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
          >
            <FlaskConical size={22} className={location.pathname === '/diluicao' ? 'text-amber-500' : 'text-vapor-100'} />
          </Link>
          <button 
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 -mr-2 text-vapor-100 hover:text-amber-500 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center focus-visible:ring-offset-graphite-900"
          >
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Dropdown */}
      {menuOpen && (
        <div className="lg:hidden fixed top-[64px] right-0 left-0 bg-graphite-800 border-b border-graphite-600 z-30 shadow-lg shadow-black/50">
          <nav className="flex flex-col py-2 max-h-[calc(100vh-80px)] overflow-y-auto">
            <Link 
              to="/orcamentos" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <FileText size={18} className="text-vapor-400" />
              Orçamentos
            </Link>
            <Link 
              to="/servicos" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <Package size={18} className="text-vapor-400" />
              Serviços
            </Link>
            <Link 
              to="/servicos/precificacao" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <DollarSign size={18} className="text-vapor-400" />
              Precificação Inteligente
            </Link>
            <Link 
              to="/estoque" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <Package size={18} className="text-vapor-400" />
              Estoque
            </Link>
            <div className="h-[1px] bg-graphite-600/60 mx-6 my-1" />
            <Link 
              to="/treinamentos" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <GraduationCap size={18} className="text-amber-500" />
              Academia Detailer
            </Link>
            <Link 
              to="/arquivos-digitais" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <FolderArchive size={18} className="text-vapor-400" />
              Arquivos Digitais
            </Link>
            <Link 
              to="/diluicao" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <FlaskConical size={18} className="text-vapor-400" />
              Calculadora de Diluição
            </Link>
            <Link 
              to="/indique" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3 min-h-[44px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <Gift size={18} className="text-vapor-400" />
              Indique e Ganhe
            </Link>
            <div className="h-[1px] bg-graphite-600/60 mx-6 my-1" />
            <Link 
              to="/configuracoes" 
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-6 py-3.5 min-h-[48px] text-vapor-100 font-sans font-medium hover:bg-graphite-700/50"
            >
              <Building2 size={18} className="text-amber-500" />
              Minha Oficina
            </Link>

            {isAdmin && (
              <>
                <div className="h-[1px] bg-graphite-600 mx-6 my-1" />
                <Link 
                  to="/admin" 
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-6 py-4 min-h-[48px] text-amber-400 font-sans font-bold bg-amber-500/10"
                >
                  <ShieldCheck size={20} className="text-amber-400" />
                  PAINEL ADMIN PLATAFORMA
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </>
  );
};
