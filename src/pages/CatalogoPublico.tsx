import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ServiceChip } from '../components/ui/ServiceChip';
import { Badge } from '../components/ui/Badge';
import { 
  MapPin, 
  MessageCircle, 
  AlertTriangle, 
  Home, 
  Sparkles,
  Car,
  ChevronRight
} from 'lucide-react';
import { 
  getFotoPublicUrl, 
  fotoDoServico
} from '../utils/imagens';
import { formatFaixaPreco, formatValorMoeda } from '../utils/precos';
import { montarLinkWhatsapp } from '../utils/whatsapp';

interface CategoriaPublica {
  id: string;
  nome: string;
  descricao?: string;
}

interface PrecoPublico {
  categoria_id: string;
  preco_base: number | string | null;
}

interface ServicoPublico {
  id: string;
  nome: string;
  grupo: string;
  codigo?: string | null;
  tom?: any;
  descricao_publica?: string | null;
  sob_consulta?: boolean;
  foto_path?: string | null;
  precos: PrecoPublico[];
}

interface OficinaPublica {
  nome: string;
  cidade?: string | null;
  uf?: string | null;
  telefone?: string | null;
  capa_path?: string | null;
}

interface CatalogoPayload {
  oficina: OficinaPublica;
  categorias: CategoriaPublica[];
  servicos: ServicoPublico[];
  grupo_fotos: Record<string, string>;
}

export const CatalogoPublico: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [catalogo, setCatalogo] = useState<CatalogoPayload | null>(null);
  const [selectedCategoriaId, setSelectedCategoriaId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCatalogo() {
      const slugLimpo = (slug ?? '').trim();
      if (!slugLimpo) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        console.log('slug:', JSON.stringify(slugLimpo), 'tipo:', typeof slugLimpo);
        const { data, error } = await supabase.rpc('catalogo_publico', {
          p_slug: slugLimpo
        });

        if (error) throw error;
        setCatalogo(data as CatalogoPayload);
      } catch (err) {
        console.error('[CatalogoPublico RPC Error]:', err);
        setCatalogo(null);
      } finally {
        setLoading(false);
      }
    }

    fetchCatalogo();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="font-display text-[13px] text-vapor-400 uppercase tracking-widest">
            Carregando catálogo...
          </span>
        </div>
      </div>
    );
  }

  // Caso 1: Slug Inexistente ou Erro
  if (!catalogo || !catalogo.oficina) {
    return (
      <div className="min-h-screen bg-graphite-950 text-vapor-100 flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-6 bg-graphite-900 border-graphite-700 flex flex-col items-center text-center gap-4 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-flare-500/10 border border-flare-500/30 flex items-center justify-center text-flare-400">
            <AlertTriangle size={28} />
          </div>
          
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-[18px] text-vapor-100 font-bold uppercase tracking-wider">
              Oficina não encontrada
            </h1>
            <p className="font-sans text-[13px] text-vapor-400 leading-relaxed">
              O endereço fornecido (<span className="font-mono text-amber-400">/agendar/{slug}</span>) não corresponde a nenhuma oficina ativa em nossa plataforma.
            </p>
          </div>

          <Link to="/" className="w-full mt-2">
            <Button variant="secondary" className="w-full flex items-center justify-center gap-2">
              <Home size={16} />
              <span>Ir para a Página Inicial</span>
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const { oficina, categorias, servicos, grupo_fotos } = catalogo;
  const capaUrl = getFotoPublicUrl(oficina.capa_path);

  // Agrupa serviços por grupo
  const gruposServicos = servicos.reduce<Record<string, ServicoPublico[]>>((acc, s) => {
    const key = s.grupo || 'Geral';
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-graphite-950 text-vapor-100 font-sans pb-16">
      {/* Header com Capa da Oficina */}
      <header className="relative bg-graphite-900 border-b border-graphite-800">
        {capaUrl ? (
          <div className="relative h-44 sm:h-56 w-full overflow-hidden">
            <img 
              src={capaUrl} 
              alt={oficina.nome} 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-graphite-950 via-graphite-950/60 to-transparent" />
          </div>
        ) : (
          <div className="h-28 w-full bg-gradient-to-r from-graphite-900 to-graphite-800 border-b border-graphite-700/50" />
        )}

        <div className="max-w-3xl mx-auto px-4 sm:px-6 relative -mt-12 pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="w-fit mb-1">
              <Badge tone="amber">Catálogo de Serviços</Badge>
            </div>
            <h1 className="font-display text-[22px] sm:text-[26px] font-bold text-vapor-100 uppercase tracking-wide">
              {oficina.nome}
            </h1>
            
            {(oficina.cidade || oficina.uf) && (
              <div className="flex items-center gap-1.5 text-vapor-400 font-sans text-[13px]">
                <MapPin size={14} className="text-amber-500 shrink-0" />
                <span>
                  {[oficina.cidade, oficina.uf].filter(Boolean).join(' - ')}
                </span>
              </div>
            )}
          </div>

          {oficina.telefone && (
            <a
              href={montarLinkWhatsapp(oficina.telefone, `Olá! Encontrei a ${oficina.nome} pelo catálogo online.`) || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2.5 rounded-lg bg-mint-500 hover:bg-mint-600 text-graphite-950 font-sans font-semibold text-[13px] flex items-center justify-center gap-2 shadow-lg transition-colors shrink-0"
            >
              <MessageCircle size={16} />
              <span>Falar no WhatsApp</span>
            </a>
          )}
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-6 flex flex-col gap-8">
        
        {/* Caso 2: Sem Serviços Públicos */}
        {servicos.length === 0 ? (
          <Card className="p-8 bg-graphite-900 border-graphite-800 flex flex-col items-center text-center gap-4 my-8">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sparkles size={24} />
            </div>
            <div className="flex flex-col gap-1 max-w-sm">
              <h2 className="font-display text-[16px] text-vapor-200 font-semibold uppercase tracking-wider">
                Catálogo em Preparação
              </h2>
              <p className="font-sans text-[13px] text-vapor-400">
                Esta oficina ainda não publicou seus serviços no catálogo online.
              </p>
            </div>

            {oficina.telefone && (
              <a
                href={montarLinkWhatsapp(oficina.telefone, `Olá! Gostaria de consultar os serviços disponíveis na ${oficina.nome}.`) || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 px-5 py-2.5 rounded-lg bg-mint-500 hover:bg-mint-600 text-graphite-950 font-sans font-semibold text-[13px] flex items-center gap-2 shadow-md transition-colors"
              >
                <MessageCircle size={16} />
                <span>Consultar Serviços via WhatsApp</span>
              </a>
            )}
          </Card>
        ) : (
          <>
            {/* Seletor de Categoria de Veículo */}
            {categorias.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-display text-[11px] text-vapor-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Car size={14} className="text-amber-500" />
                    Selecione o seu tipo de veículo:
                  </span>
                  {selectedCategoriaId && (
                    <button
                      onClick={() => setSelectedCategoriaId(null)}
                      className="font-sans text-[11px] text-amber-400 hover:underline"
                    >
                      Limpar seleção
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {categorias.map((cat) => {
                    const isSelected = cat.id === selectedCategoriaId;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategoriaId(isSelected ? null : cat.id)}
                        className={`px-3.5 py-2 rounded-lg font-sans text-[12px] font-medium whitespace-nowrap transition-all border ${
                          isSelected
                            ? 'bg-amber-500 border-amber-400 text-graphite-950 shadow-md font-semibold'
                            : 'bg-graphite-900 hover:bg-graphite-800 border-graphite-700 text-vapor-300'
                        }`}
                      >
                        {cat.nome}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Listagem de Serviços Agrupados */}
            <div className="flex flex-col gap-8">
              {Object.entries(gruposServicos).map(([grupoNome, servicosDoGrupo]) => (
                <section key={grupoNome} className="flex flex-col gap-4">
                  <h2 className="font-display text-[14px] text-vapor-300 uppercase tracking-widest border-b border-graphite-800 pb-2 flex items-center justify-between">
                    <span>{grupoNome}</span>
                    <span className="text-[11px] text-vapor-500 font-sans font-normal">
                      {servicosDoGrupo.length} {servicosDoGrupo.length === 1 ? 'serviço' : 'serviços'}
                    </span>
                  </h2>

                  <div className="grid grid-cols-1 gap-4">
                    {servicosDoGrupo.map((servico) => {
                      // Resolve foto em cascata
                      const fotoResolvedUrl = fotoDoServico(
                        { grupo: servico.grupo, foto_path: servico.foto_path },
                        grupo_fotos,
                        oficina.capa_path
                      );

                      // Calcula Preço
                      let precoDisplay = '';
                      if (servico.sob_consulta) {
                        precoDisplay = 'Sob avaliação';
                      } else if (selectedCategoriaId) {
                        const matchPreco = servico.precos.find((p) => p.categoria_id === selectedCategoriaId);
                        if (matchPreco && matchPreco.preco_base !== null && matchPreco.preco_base !== undefined) {
                          precoDisplay = formatValorMoeda(Number(matchPreco.preco_base));
                        } else {
                          precoDisplay = 'Sob consulta';
                        }
                      } else {
                        precoDisplay = formatFaixaPreco(servico.precos as any);
                      }

                      return (
                        <Card 
                          key={servico.id}
                          className="p-4 bg-graphite-900 border-graphite-800 hover:border-graphite-700 transition-colors flex flex-col sm:flex-row gap-4"
                        >
                          <img
                            src={fotoResolvedUrl}
                            alt={servico.nome}
                            className="w-full sm:w-36 h-36 object-cover rounded-lg shrink-0 border border-graphite-800/80"
                          />

                          <div className="flex-1 flex flex-col justify-between gap-3">
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <ServiceChip code={servico.codigo || 'SV'} label={servico.nome} tone={servico.tom || 'vapor'} />
                              </div>

                              {servico.descricao_publica && (
                                <p className="font-sans text-[13px] text-vapor-400 leading-relaxed line-clamp-2">
                                  {servico.descricao_publica}
                                </p>
                              )}
                            </div>

                            <div className="pt-2 border-t border-graphite-800/80 flex items-center justify-between gap-2 mt-auto">
                              <div className="flex flex-col">
                                <span className="font-sans text-[10px] text-vapor-500 uppercase tracking-wider">Valor</span>
                                <span className="font-sans text-[14px] font-bold text-vapor-100">
                                  {precoDisplay}
                                </span>
                              </div>

                              <Link
                                to={`/agendar/${slug}/agendamento?servico=${servico.id}${selectedCategoriaId ? `&categoria=${selectedCategoriaId}` : ''}`}
                                className="px-3.5 py-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-sans text-[12px] font-semibold flex items-center gap-1.5 transition-colors"
                              >
                                <span>Solicitar Agendamento</span>
                                <ChevronRight size={14} />
                              </Link>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-3xl mx-auto px-4 sm:px-6 mt-12 pt-6 border-t border-graphite-800 text-center flex flex-col items-center gap-1">
        <span className="font-display text-[11px] text-vapor-500 uppercase tracking-widest">
          {oficina.nome}
        </span>
        <span className="font-sans text-[11px] text-vapor-600">
          Powered by NuvemWash
        </span>
      </footer>
    </div>
  );
};
