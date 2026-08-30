import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom';
import { 
  Clock, CheckCircle2, AlertCircle, 
  Copy, Check, ChevronLeft, ChevronRight, ArrowRight, MessageSquare, Info, Sparkles
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../contexts/ToastContext';
import { formatValorMoeda, formatDuracao } from '../utils/precos';
import { formatarData, formatarDataHora, formatarDataIsoSP, montarTimestampLocal } from '../utils/datas';
import { formatarInformacaoTransbordo } from '../utils/transbordoUtils';
import { gerarQrCodeUrl } from '../utils/qrCodeSvg';
import { SeletorHorarioPublico, type SlotHorarioPublico } from '../components/publico/SeletorHorarioPublico';

interface TenantInfo {
  id: string;
  nome: string;
  slug: string;
  logo_path?: string;
  telefone?: string;
  cidade?: string;
  uf?: string;
  agendamento_online_ativo: boolean;
  agendamento_exige_confirmacao: boolean;
  antecedencia_minima_horas: number;
  sinal_ativo: boolean;
  sinal_tipo: 'percentual' | 'valor_fixo';
  sinal_valor: number;
  sinal_obrigatorio: boolean;
  politica_cancelamento?: string;
  pix_chave?: string;
  pix_tipo?: string;
  pix_nome_beneficiario?: string;
  pix_cidade?: string;
}

interface Categoria {
  id: string;
  nome: string;
  descricao?: string;
  ordem: number;
}

interface ServicoPreco {
  categoria_id: string;
  preco_base: number;
  duracao_minutos: number;
}

interface Servico {
  id: string;
  nome: string;
  grupo?: string;
  descricao_publica?: string;
  modo_ocupacao: string;
  dias_ocupados: number;
  precos: ServicoPreco[];
}

export function FluxoAgendamentoOnline() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [passo, setPasso] = useState<number>(1);
  const [carregando, setCarregando] = useState<boolean>(true);
  const [erro, setErro] = useState<string | null>(null);

  // Dados do Catálogo
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [mostrarTodosServicos, setMostrarTodosServicos] = useState<boolean>(false);

  // Seleções do Usuário
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [itensSelecionados, setItensSelecionados] = useState<{ servico_id: string; combo_id?: string }[]>([]);
  const [placa, setPlaca] = useState<string>('');
  const [modelo, setModelo] = useState<string>('');

  // Data e Horário
  const [dataSelecionada, setDataSelecionada] = useState<string>(
    searchParams.get('data') || formatarDataIsoSP(new Date())
  );
  const [horarioSelecionado, setHorarioSelecionado] = useState<string>(
    searchParams.get('horario') || ''
  );
  const [slotSelecionadoObj, setSlotSelecionadoObj] = useState<SlotHorarioPublico | null>(null);
  const [transbordoAceito, setTransbordoAceito] = useState<boolean>(false);
  const [consentimentoPrivacidade, setConsentimentoPrivacidade] = useState<boolean>(false);

  // Reseta aceite do pernoite ao mudar data ou horario
  useEffect(() => {
    setTransbordoAceito(false);
  }, [dataSelecionada, horarioSelecionado]);

  // Dados Pessoais
  const [nome, setNome] = useState<string>('');
  const [telefone, setTelefone] = useState<string>('');

  // Envio e Resultado
  const [enviando, setEnviando] = useState<boolean>(false);
  const [resultado, setResultado] = useState<any | null>(null);
  const [copiado, setCopiado] = useState<boolean>(false);

  // Carrega Catálogo Inicial e Lê Parâmetros da URL
  useEffect(() => {
    async function carregarCatalogo() {
      if (!slug) return;
      setCarregando(true);
      setErro(null);

      try {
        const { data, error } = await supabase.rpc('catalogo_agendamento', { p_slug: slug });
        if (error) throw error;
        if (data?.erro) {
          setErro(data.erro);
          return;
        }

        setTenant(data.oficina);
        const cats = data.categorias || [];
        const servs = data.servicos || [];
        setCategorias(cats);
        setServicos(servs);

        // 1. Ler Parâmetros de Categoria da URL
        const urlCat = searchParams.get('categoria') || searchParams.get('categoria_id');
        if (urlCat && cats.some((c: any) => c.id === urlCat)) {
          setCategoriaId(urlCat);
        } else if (cats.length > 0) {
          setCategoriaId(cats[0].id);
        }

        // 2. Ler Parâmetros de Serviço da URL
        const urlServico = searchParams.get('servico') || searchParams.get('servico_id');
        const urlModelo = searchParams.get('modelo');
        const urlPlaca = searchParams.get('placa');
        const urlData = searchParams.get('data');
        const urlHorario = searchParams.get('horario');

        console.log('[FluxoAgendamentoOnline] Params lidos da URL:', {
          urlServico,
          urlCategoria: urlCat,
          urlModelo,
          urlPlaca,
          urlData,
          urlHorario
        });

        if (urlServico && servs.some((s: any) => s.id === urlServico)) {
          setItensSelecionados([{ servico_id: urlServico }]);
        } else if (servs.length > 0) {
          // Pre-seleciona o primeiro serviço se nenhum foi informado
          setItensSelecionados([{ servico_id: servs[0].id }]);
        }

        if (urlModelo) setModelo(urlModelo);
        if (urlPlaca) setPlaca(urlPlaca);

        if (!data.oficina.agendamento_online_ativo) {
          setErro('O agendamento online está temporariamente desativado para esta oficina.');
        }
      } catch (err: any) {
        setErro('Falha ao carregar informações da oficina: ' + err.message);
      } finally {
        setCarregando(false);
      }
    }

    carregarCatalogo();
  }, [slug, searchParams]);

  // Máscaras de Entrada
  const aplicarMascaraTelefone = (valor: string) => {
    const limpo = valor.replace(/\D/g, '').slice(0, 11);
    if (limpo.length <= 10) {
      return limpo.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
    }
    return limpo.replace(/^(\d{2})(\d{5})(\d{0,4})$/, '($1) $2-$3');
  };

  const aplicarMascaraPlaca = (valor: string) => {
    return valor.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  };

  // Cálculos de Totais
  const calcularResumoServicos = () => {
    let duracaoTotal = 0;
    let valorTotal = 0;

    itensSelecionados.forEach((item: { servico_id: string }) => {
      const s = servicos.find((srv: Servico) => srv.id === item.servico_id);
      if (s && s.precos) {
        const p = s.precos.find((pr: ServicoPreco) => pr.categoria_id === categoriaId) || s.precos?.[0];
        if (p) {
          duracaoTotal += p.duracao_minutos || 60;
          valorTotal += Number(p.preco_base) || 0;
        }
      }
    });

    return { duracaoTotal, valorTotal };
  };

  const { duracaoTotal, valorTotal } = calcularResumoServicos();

  // Serviço principal e sugestões de upgrade
  const servicoPrincipalId = itensSelecionados[0]?.servico_id;
  const servicoPrincipal = servicos.find((s) => s.id === servicoPrincipalId) || servicos[0];
  const precoPrincipalObj = servicoPrincipal?.precos?.find((p) => p.categoria_id === categoriaId) || servicoPrincipal?.precos?.[0];
  const sugestoesUpgrade = servicoPrincipal ? servicos.filter((s) => s.id !== servicoPrincipal.id).slice(0, 4) : [];

  const timestampInicioCalc = dataSelecionada && horarioSelecionado ? montarTimestampLocal(dataSelecionada, horarioSelecionado) : '';
  const infoTransbordoSelecionado = slotSelecionadoObj?.termino_previsto
    ? formatarInformacaoTransbordo(timestampInicioCalc, slotSelecionadoObj.termino_previsto)
    : null;
  const isTransbordoSlot = !!infoTransbordoSelecionado;

  // Submissão Final do Agendamento
  const handleFinalizarAgendamento = async () => {
    if (!tenant || !slug) return;

    if (nome.trim().length < 2) {
      showToast('Por favor, informe seu nome completo (pelo menos 2 caracteres).', 'error');
      setPasso(4);
      return;
    }

    const telLimpo = telefone.replace(/\D/g, '');
    if (telLimpo.length < 10 || telLimpo.length > 11) {
      showToast('Telefone inválido. Informe o DDD e o número completo (10 ou 11 dígitos).', 'error');
      setPasso(4);
      return;
    }

    if (!dataSelecionada || !horarioSelecionado) {
      showToast('Por favor, escolha uma data e horário válidos.', 'error');
      setPasso(3);
      return;
    }

    if (isTransbordoSlot && !transbordoAceito) {
      showToast('Você precisa aceitar os termos de permanência do veículo na oficina para continuar.', 'error');
      setPasso(3);
      return;
    }

    setEnviando(true);

    try {
      const timestampInicio = montarTimestampLocal(dataSelecionada, horarioSelecionado);

      const { data, error } = await supabase.rpc('agendar_online', {
        p_slug: slug,
        p_nome: nome.trim(),
        p_telefone: telLimpo,
        p_placa: placa.trim() ? placa.trim() : null,
        p_modelo: modelo.trim() ? modelo.trim() : 'Veículo',
        p_categoria: categoriaId,
        p_itens: itensSelecionados,
        p_inicio: timestampInicio,
        p_observacoes: `Agendado via Catálogo Online Público`,
        p_transbordo_aceito: isTransbordoSlot ? transbordoAceito : false,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        p_ip: null
      });

      if (error) throw error;

      setResultado(data);
      setPasso(5); // Passo de Confirmação
      showToast('Agendamento solicitado com sucesso!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Falha ao processar agendamento.', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const handleCopiarPix = () => {
    if (resultado?.sinal?.pix_payload) {
      navigator.clipboard.writeText(resultado.sinal.pix_payload);
      setCopiado(true);
      showToast('Código Pix copiado!', 'success');
      setTimeout(() => setCopiado(false), 3000);
    }
  };

  if (carregando) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-100">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 font-medium text-sm">Carregando formulário de agendamento...</p>
      </div>
    );
  }

  if (erro || !tenant) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-100">
        <div className="max-w-md w-full glass-card p-6 rounded-2xl text-center border border-red-500/20">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold mb-2 text-white">Agendamento Indisponível</h2>
          <p className="text-slate-400 mb-6 text-sm">{erro || 'Não foi possível carregar as informações desta oficina.'}</p>
          <button
            onClick={() => navigate(`/agendar/${slug}`)}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium text-sm transition"
          >
            <ChevronLeft className="w-4 h-4" /> Voltar ao Catálogo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-16">
      {/* Cabeçalho Fixo */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <Link to={`/agendar/${slug}`} className="p-2 text-slate-400 hover:text-white rounded-lg transition">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div className="text-center">
            <h1 className="text-base font-bold text-white leading-tight">{tenant.nome}</h1>
            <p className="text-xs text-emerald-400">Agendamento Online Direct</p>
          </div>
          <div className="w-8" />
        </div>
      </header>

      {/* Indicador de Passos */}
      {passo < 5 && (
        <div className="bg-slate-900/50 border-b border-slate-800/80 py-3 px-4 mb-6">
          <div className="max-w-xl mx-auto flex items-center justify-between text-xs font-semibold text-slate-400">
            <span className={passo >= 1 ? 'text-emerald-400' : ''}>1. Serviços</span>
            <span className={passo >= 2 ? 'text-emerald-400' : ''}>2. Veículo</span>
            <span className={passo >= 3 ? 'text-emerald-400' : ''}>3. Data/Hora</span>
            <span className={passo >= 4 ? 'text-emerald-400' : ''}>4. Dados</span>
          </div>
        </div>
      )}

      <main className={`max-w-xl mx-auto px-4 ${passo === 1 ? 'pb-32' : 'pb-12'}`}>
        {/* PASSO 1: SELEÇÃO E UPGRADE DE SERVIÇOS */}
        {passo === 1 && (
          <div className="space-y-6">
            
            {/* Seletor de Categoria */}
            {categorias.length > 0 && (
              <div className="space-y-1.5 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-slate-300">Categoria do Seu Veículo</span>
                <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {categorias.map((cat: Categoria) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoriaId(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition border ${
                        categoriaId === cat.id
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {cat.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* BLOCO 1 — "Seu serviço" */}
            {servicoPrincipal && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> Seu Serviço Escolhido
                  </h3>
                  <button
                    type="button"
                    onClick={() => setMostrarTodosServicos(!mostrarTodosServicos)}
                    className="text-xs font-semibold text-slate-400 hover:text-emerald-400 transition"
                  >
                    Trocar serviço
                  </button>
                </div>

                <div className="p-4 bg-gradient-to-br from-emerald-500/10 via-slate-900 to-slate-900 border border-emerald-500/40 rounded-2xl space-y-3 shadow-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-base font-bold text-white">{servicoPrincipal.nome}</h4>
                      {servicoPrincipal.descricao_publica && (
                        <p className="text-xs text-slate-300 mt-1 line-clamp-2">{servicoPrincipal.descricao_publica}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 pl-3">
                      <span className="text-base font-extrabold text-emerald-400">
                        {precoPrincipalObj?.preco_base ? `R$ ${formatValorMoeda(Number(precoPrincipalObj.preco_base))}` : 'Sob consulta'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400 pt-2 border-t border-slate-800/80">
                    <span className="flex items-center gap-1 text-emerald-300 font-medium">
                      <Clock className="w-3.5 h-3.5 text-emerald-400" />
                      {formatDuracao(precoPrincipalObj?.duracao_minutos || 60)}
                    </span>
                    {servicoPrincipal.grupo && (
                      <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] text-slate-300">
                        {servicoPrincipal.grupo}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* BLOCO 2 — "Aproveite e adicione" (Upgrades) */}
            {sugestoesUpgrade.length > 0 && (
              <div className="space-y-3 pt-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Aproveite e Adicione (Upgrades)</h3>
                  <p className="text-xs text-slate-400">Turbine seu atendimento com estes serviços complementares:</p>
                </div>

                <div className="space-y-2">
                  {sugestoesUpgrade.map((servico: Servico) => {
                    const selecionado = itensSelecionados.some((i) => i.servico_id === servico.id);
                    const precoObj = servico.precos?.find((p) => p.categoria_id === categoriaId) || servico.precos?.[0];
                    
                    let beneficioFrase = 'Excelente opção complementar';
                    const g = servico.grupo?.toLowerCase() || '';
                    if (g.includes('higieniz') || g.includes('protec')) {
                      beneficioFrase = 'Proteção extra e interior higienizado';
                    } else if (g.includes('vitrif') || g.includes('poliment')) {
                      beneficioFrase = 'Brilho intenso e proteção duradoura';
                    } else if (g.includes('vidro') || g.includes('farol')) {
                      beneficioFrase = 'Maior visibilidade e segurança';
                    }

                    return (
                      <div
                        key={servico.id}
                        onClick={() => {
                          if (selecionado) {
                            setItensSelecionados(itensSelecionados.filter((i) => i.servico_id !== servico.id));
                          } else {
                            setItensSelecionados([...itensSelecionados, { servico_id: servico.id }]);
                          }
                        }}
                        className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                          selecionado
                            ? 'bg-emerald-500/10 border-emerald-500 text-white'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selecionado}
                            onChange={() => {}}
                            className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950 shrink-0 pointer-events-none"
                          />
                          <div className="space-y-0.5">
                            <h4 className="font-semibold text-xs text-white">{servico.nome}</h4>
                            <p className="text-[11px] text-emerald-400/90 font-medium">{beneficioFrase}</p>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-xs font-bold text-emerald-400">
                            {precoObj?.preco_base ? `+ R$ ${formatValorMoeda(Number(precoObj.preco_base))}` : 'Sob consulta'}
                          </span>
                          <p className="text-[10px] text-slate-400">+{formatDuracao(precoObj?.duracao_minutos || 60)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* BLOCO 3 — "Ver todos os serviços" (Catálogo Completo) */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setMostrarTodosServicos(!mostrarTodosServicos)}
                className="w-full py-3 px-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-bold text-slate-300 flex items-center justify-between transition"
              >
                <span>Ver Todos os Serviços ({servicos.length})</span>
                <ChevronRight className={`w-4 h-4 transition-transform ${mostrarTodosServicos ? 'rotate-90 text-emerald-400' : ''}`} />
              </button>

              {mostrarTodosServicos && (
                <div className="space-y-4 pt-4 border-t border-slate-800/80 mt-3">
                  {Object.entries(
                    servicos.reduce<Record<string, Servico[]>>((acc, s) => {
                      const g = s.grupo || 'Outros Serviços';
                      if (!acc[g]) acc[g] = [];
                      acc[g].push(s);
                      return acc;
                    }, {})
                  ).map(([grupoNome, servicosDoGrupo]) => (
                    <div key={grupoNome} className="space-y-2">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{grupoNome}</h4>
                      <div className="space-y-2">
                        {servicosDoGrupo.map((servico: Servico) => {
                          const selecionado = itensSelecionados.some((i) => i.servico_id === servico.id);
                          const precoObj = servico.precos?.find((p) => p.categoria_id === categoriaId) || servico.precos?.[0];

                          return (
                            <div
                              key={servico.id}
                              onClick={() => {
                                if (selecionado) {
                                  setItensSelecionados(itensSelecionados.filter((i) => i.servico_id !== servico.id));
                                } else {
                                  setItensSelecionados([...itensSelecionados, { servico_id: servico.id }]);
                                }
                              }}
                              className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                                selecionado
                                  ? 'bg-emerald-500/10 border-emerald-500 text-white'
                                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 text-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={selecionado}
                                  onChange={() => {}}
                                  className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-950 pointer-events-none"
                                />
                                <div>
                                  <h5 className="font-semibold text-xs text-white">{servico.nome}</h5>
                                  {servico.descricao_publica && (
                                    <p className="text-[11px] text-slate-400 line-clamp-1">{servico.descricao_publica}</p>
                                  )}
                                </div>
                              </div>

                              <div className="text-right shrink-0 pl-2">
                                <span className="text-xs font-bold text-emerald-400">
                                  {precoObj?.preco_base ? `R$ ${formatValorMoeda(Number(precoObj.preco_base))}` : 'Sob consulta'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* PASSO 2: VEÍCULO E CATEGORIA */}
        {passo === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Categoria e Detalhes do Veículo</h2>
              <p className="text-xs text-slate-400">A categoria define o valor base da tabela de preços da oficina.</p>
            </div>

            {/* Seleção de Categoria */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Categoria do Veículo *</label>
              <div className="grid grid-cols-2 gap-2">
                {categorias.map((cat: Categoria) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoriaId(cat.id)}
                    className={`p-3 rounded-xl border text-left text-xs font-medium transition ${
                      categoriaId === cat.id
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 font-bold'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {cat.nome}
                  </button>
                ))}
              </div>
              <div className="flex items-start gap-2 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs text-slate-400">
                <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p>Se não souber exatamente a categoria, escolha a mais próxima. Confirmaremos a avaliação na sua chegada.</p>
              </div>
            </div>

            {/* Placa e Modelo */}
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-xs font-semibold text-slate-300">Modelo do Veículo</label>
                <input
                  type="text"
                  placeholder="Ex: Civic 2.0, Gol 1.6, Compass"
                  value={modelo}
                  onChange={(e) => setModelo(e.target.value)}
                  className="w-full mt-1 p-3 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Placa (Opcional)</label>
                <input
                  type="text"
                  placeholder="ABC1D23"
                  value={placa}
                  onChange={(e) => setPlaca(aplicarMascaraPlaca(e.target.value))}
                  className="w-full mt-1 p-3 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none uppercase tracking-wider"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setPasso(1)}
                className="w-1/3 py-3 bg-slate-900 border border-slate-800 text-slate-300 font-medium rounded-xl hover:bg-slate-800 transition"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => setPasso(3)}
                className="w-2/3 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition"
              >
                Escolher Data e Hora <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* PASSO 3: DATA E HORÁRIO */}
        {passo === 3 && tenant && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Escolha a Data e Horário</h2>
              <p className="text-xs text-slate-400">Horários disponíveis em tempo real com base nos serviços selecionados.</p>
            </div>

            <SeletorHorarioPublico
              tenantId={tenant.id}
              categoriaId={categoriaId}
              itens={itensSelecionados.map((i: { servico_id: string }) => ({ servico_id: i.servico_id, combo_id: null }))}
              dataSelecionada={dataSelecionada}
              setDataSelecionada={setDataSelecionada}
              horarioSelecionado={horarioSelecionado}
              setHorarioSelecionado={setHorarioSelecionado}
              onSlotSelecionadoObj={setSlotSelecionadoObj}
              politicaCancelamento={tenant.politica_cancelamento}
              aceiteCheck={transbordoAceito}
              onAceiteChange={setTransbordoAceito}
              theme="emerald"
            />

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setPasso(2)}
                className="w-1/3 py-3 bg-slate-900 border border-slate-800 text-slate-300 font-medium rounded-xl hover:bg-slate-800 transition"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={!horarioSelecionado || (isTransbordoSlot && !transbordoAceito)}
                onClick={() => setPasso(4)}
                className={`w-2/3 py-3 font-bold rounded-xl flex items-center justify-center gap-2 transition ${
                  horarioSelecionado && (!isTransbordoSlot || transbordoAceito)
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                Seus Dados <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* PASSO 4: SEUS DADOS */}
        {passo === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white">Seus Dados de Contato</h2>
              <p className="text-xs text-slate-400">Informe quem estará responsável pelo agendamento.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Seu Nome Completo *</label>
                <input
                  type="text"
                  placeholder="Nome e Sobrenome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full mt-1 p-3 min-h-[56px] bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Telefone / WhatsApp com DDD *</label>
                <input
                  type="text"
                  placeholder="(11) 99999-9999"
                  value={telefone}
                  onChange={(e) => setTelefone(aplicarMascaraTelefone(e.target.value))}
                  className="w-full mt-1 p-3 min-h-[56px] bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:border-emerald-500 outline-none font-mono"
                />
              </div>
            </div>

            {/* Resumo Pré-Confirmacao */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Data e Hora:</span>
                <span className="text-white font-medium">{formatarData(dataSelecionada)} às {horarioSelecionado}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Serviços:</span>
                <span className="text-white font-medium">{itensSelecionados.length} selecionado(s)</span>
              </div>
              <div className="flex justify-between text-sm font-bold border-t border-slate-800 pt-2">
                <span className="text-white">Total Estimado:</span>
                <span className="text-emerald-400">R$ {formatValorMoeda(valorTotal)}</span>
              </div>
            </div>

            {/* Consentimento Legal LGPD */}
            <label className="flex items-start gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer select-none text-xs text-slate-300 hover:border-slate-700 transition">
              <input
                type="checkbox"
                checked={consentimentoPrivacidade}
                onChange={(e) => setConsentimentoPrivacidade(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-emerald-500 cursor-pointer shrink-0"
              />
              <span className="leading-relaxed">
                Autorizo a oficina a guardar meus dados e as fotos do meu veículo para registro do atendimento.{' '}
                <a
                  href="/politica-de-privacidade"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 underline font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  Política de Privacidade
                </a>
              </span>
            </label>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setPasso(3)}
                className="w-1/3 min-h-[56px] bg-slate-900 border border-slate-800 text-slate-300 font-medium rounded-xl hover:bg-slate-800 transition"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={enviando || nome.trim().length < 2 || telefone.replace(/\D/g, '').length < 10 || !consentimentoPrivacidade}
                onClick={handleFinalizarAgendamento}
                className={`w-2/3 min-h-[56px] font-bold rounded-xl flex items-center justify-center gap-2 transition ${
                  enviando || nome.trim().length < 2 || telefone.replace(/\D/g, '').length < 10 || !consentimentoPrivacidade
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20'
                }`}
              >
                {enviando ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    Confirmar Agendamento <CheckCircle2 className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* PASSO 5: CONFIRMAÇÃO E PIX */}
        {passo === 5 && resultado && (
          <div className="space-y-6 text-center py-4">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white">Agendamento Realizado!</h2>
              <p className="text-xs text-slate-400 mt-1">
                OS <span className="text-emerald-400 font-bold">#{resultado.numero_os}</span> · {tenant.nome}
              </p>
            </div>

            {/* Card de Mensagem Conforme Configuração */}
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-left space-y-3">
              <div className="text-xs text-slate-300 space-y-1">
                <p><strong>Início:</strong> {formatarDataHora(resultado.inicio)}</p>
                {resultado.previsao_entrega && (
                  <p><strong>Retirada Permitida a partir de:</strong> <span className="text-emerald-400 font-bold font-mono">{formatarDataHora(resultado.previsao_entrega)}</span></p>
                )}
                <p><strong>Duração Prevista:</strong> {formatDuracao(resultado.duracao_total)}</p>
                <p><strong>Valor Total Estimado:</strong> R$ {formatValorMoeda(resultado.preco_estimado_total)}</p>
              </div>

              {resultado.sinal?.ativo && resultado.sinal?.valor > 0 ? (
                <div className="border-t border-slate-800 pt-3 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-400 font-semibold">Sinal Solicitado:</span>
                    <span className="text-base font-bold text-amber-400">R$ {formatValorMoeda(resultado.sinal.valor)}</span>
                  </div>

                  {resultado.sinal.pix_payload ? (
                    <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-center">
                      <p className="text-xs text-slate-300 font-medium">Escaneie o QR Code ou Copie a Chave Pix:</p>
                      
                      <img 
                        src={gerarQrCodeUrl(resultado.sinal.pix_payload)} 
                        alt="QR Code Pix" 
                        className="w-44 h-44 mx-auto rounded-lg bg-white p-2 border border-slate-700" 
                      />

                      <button
                        onClick={handleCopiarPix}
                        className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold text-xs rounded-xl border border-emerald-500/30 flex items-center justify-center gap-2 transition"
                      >
                        {copiado ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        {copiado ? 'Código Pix Copiado!' : 'Copiar Código Pix (Copia e Cola)'}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-950 rounded-xl border border-amber-500/20 text-center text-xs text-amber-300">
                      Envie o comprovante ou solicite a chave Pix diretamente pelo WhatsApp da oficina abaixo para validar seu agendamento.
                    </div>
                  )}
                  
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Instrução: Envie o comprovante de pagamento pelo WhatsApp da oficina para confirmar seu horário.
                  </p>
                </div>
              ) : (
                <div className="border-t border-slate-800 pt-3">
                  <p className="text-xs text-emerald-400 font-medium">
                    {resultado.status === 'aguardando_confirmacao'
                      ? 'Recebemos seu pedido de agendamento. A oficina irá confirmar em breve.'
                      : 'Seu horário está reservado e confirmado!'}
                  </p>
                </div>
              )}

              {tenant.politica_cancelamento && (
                <div className="border-t border-slate-800/80 pt-2 text-[11px] text-slate-500">
                  <strong>Política de Cancelamento:</strong> {tenant.politica_cancelamento}
                </div>
              )}
            </div>

            {/* Botão para Falar com a Oficina via WhatsApp */}
            <a
              href={`https://wa.me/${tenant.telefone?.replace(/\D/g, '')}?text=${encodeURIComponent(
                `Olá! Fiz um agendamento online (OS #${resultado.numero_os}) para ${formatarData(dataSelecionada)} às ${horarioSelecionado}.`
              )}`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-500/20"
            >
              <MessageSquare className="w-5 h-5" /> Enviar Comprovante / WhatsApp
            </a>
          </div>
        )}
      </main>

      {/* Rodapé Legal Público */}
      <footer className="py-6 px-4 text-center text-xs text-slate-500 border-t border-slate-900 mt-8">
        <div className="max-w-xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>{tenant?.nome || 'Oficina'} • NuvemWash</span>
          <div className="flex items-center gap-4">
            <Link to="/termos-de-uso" target="_blank" className="hover:text-slate-300 transition-colors">
              Termos de Uso
            </Link>
            <span>•</span>
            <Link to="/politica-de-privacidade" target="_blank" className="hover:text-slate-300 transition-colors">
              Política de Privacidade
            </Link>
          </div>
        </div>
      </footer>

      {/* Painel Fixo no Rodapé para o Passo 1 */}
      {passo === 1 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-4 shadow-2xl">
          <div className="max-w-xl mx-auto flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Total Estimado</div>
              <div className="text-lg font-extrabold text-emerald-400 leading-tight">
                {valorTotal > 0 ? `R$ ${formatValorMoeda(valorTotal)}` : 'Sob consulta'}
              </div>
              <div className="text-[11px] text-slate-400">
                {itensSelecionados.length} {itensSelecionados.length === 1 ? 'serviço' : 'serviços'} · {formatDuracao(duracaoTotal)}
              </div>
            </div>

            <button
              type="button"
              disabled={itensSelecionados.length === 0}
              onClick={() => setPasso(2)}
              className={`px-5 py-3 font-bold text-xs rounded-xl flex items-center gap-2 transition ${
                itensSelecionados.length > 0
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              Escolher Veículo <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
