import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissao } from '../../hooks/usePermissao';
import { usePlano } from '../../hooks/usePlano';
import { supabase } from '../../lib/supabase';
import type { AppRole, ComissaoRegra, ComissaoTipo, TenantMember } from '../../types/auth';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { CampoNumerico } from '../../components/ui/CampoNumerico';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import {
  UserPlus,
  Copy,
  Check,
  Percent,
  DollarSign,
  History,
  AlertTriangle,
  UserX,
  ShieldCheck,
  Lock,
  Trash2,
} from 'lucide-react';
import { gerarId } from '../../utils/uuid';

export const AbaEquipe: React.FC = () => {
  const { tenant } = useAuth();
  const { podeGerirEquipe } = usePermissao();
  const { limiteDe, nomePlano, planoAtual } = usePlano();

  const [members, setMembers] = useState<TenantMember[]>([]);
  const [comissaoMap, setComissaoMap] = useState<Record<string, ComissaoRegra[]>>({});
  const [loading, setLoading] = useState(true);

  // Modal Convidar
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<AppRole>('operador');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Modal Comissão
  const [selectedMember, setSelectedMember] = useState<TenantMember | null>(null);
  const [comissaoTipo, setComissaoTipo] = useState<ComissaoTipo>('nenhuma');
  const [comissaoValor, setComissaoValor] = useState<number>(0);
  const [comissaoInicio, setComissaoInicio] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [comissaoError, setComissaoError] = useState<string | null>(null);
  const [savingComissao, setSavingComissao] = useState(false);

  // Modal de Confirmação para Remover / Inativar Membro
  const [memberToDelete, setMemberToDelete] = useState<TenantMember | null>(null);
  const [deletingMember, setDeletingMember] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const limUsuarios = limiteDe('usuarios');
  const activeAndInvitedCount = members.filter((m) => m.status !== 'inativo').length;
  const isLimitReached = limUsuarios !== null && activeAndInvitedCount >= limUsuarios;

  const fetchEquipeData = async () => {
    if (!tenant) return;
    setLoading(true);

    try {
      // 1. Busca membros do tenant
      const { data: membersData } = await supabase
        .from('tenant_members')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: true });

      if (membersData) {
        setMembers(membersData as TenantMember[]);

        // 2. Busca histórico de comissões de todos os membros
        const memberIds = membersData.map((m: any) => m.id);
        if (memberIds.length > 0) {
          const { data: comissoesData } = await supabase
            .from('comissao_regras')
            .select('*')
            .in('member_id', memberIds)
            .order('vigencia_inicio', { ascending: false });

          if (comissoesData) {
            const map: Record<string, ComissaoRegra[]> = {};
            comissoesData.forEach((c: any) => {
              if (!map[c.member_id]) map[c.member_id] = [];
              map[c.member_id].push(c as ComissaoRegra);
            });
            setComissaoMap(map);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar equipe:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEquipeData();
  }, [tenant?.id]);

  if (!podeGerirEquipe()) {
    return (
      <div className="p-6 text-center text-vapor-400 font-sans">
        Você não possui permissão para gerenciar a equipe da oficina.
      </div>
    );
  }

  // Convidar Membro
  const handleConvidar = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(null);
    setInviteLink(null);

    if (isLimitReached) {
      setInviteError(`Seu plano permite ${limUsuarios} usuários. Faça upgrade para adicionar mais.`);
      return;
    }

    try {
      const token = gerarId();
      const { error } = await supabase.from('tenant_members').insert({
        tenant_id: tenant?.id,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        status: 'convidado',
        convite_token: token,
      });

      if (error) {
        setInviteError(error.message || 'Erro ao gerar convite.');
      } else {
        const generatedUrl = `${window.location.origin}/convite/${token}`;
        setInviteLink(generatedUrl);
        setInviteEmail('');
        await fetchEquipeData();
      }
    } catch (err: any) {
      setInviteError(err?.message || 'Erro ao criar convite.');
    }
  };

  // Alterar Comissão via RPC Atômica
  const handleSalvarComissao = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMember) return;
    setComissaoError(null);
    setSavingComissao(true);

    try {
      const { error } = await supabase.rpc('nova_regra_comissao', {
        p_member: selectedMember.id,
        p_tipo: comissaoTipo,
        p_valor: comissaoTipo === 'nenhuma' ? 0 : Number(comissaoValor),
        p_inicio: comissaoInicio,
      });

      if (error) {
        setComissaoError(error.message || 'Erro ao definir comissão.');
      } else {
        setSelectedMember(null);
        await fetchEquipeData();
      }
    } catch (err: any) {
      setComissaoError(err?.message || 'Erro inesperado.');
    } finally {
      setSavingComissao(false);
    }
  };

  // Executar Ação no Membro (Excluir ou Inativar)
  const handleConfirmMemberAction = async (action: 'excluir' | 'inativar') => {
    if (!memberToDelete) return;
    setDeletingMember(true);
    setDeleteError(null);

    try {
      if (action === 'excluir') {
        const { error } = await supabase
          .from('tenant_members')
          .delete()
          .eq('id', memberToDelete.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tenant_members')
          .update({ status: 'inativo' })
          .eq('id', memberToDelete.id);

        if (error) throw error;
      }

      setMemberToDelete(null);
      await fetchEquipeData();
    } catch (err: any) {
      console.error('[AbaEquipe Delete/Inactivate Error]:', err);
      setDeleteError(err?.message || 'Erro ao processar ação no membro.');
    } finally {
      setDeletingMember(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];

  return (
    <div className="flex flex-col gap-6">
      {/* Header com indicador de uso do plano */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-graphite-800 border border-graphite-600 rounded-lg">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[18px] text-vapor-100 uppercase tracking-wide">
              Membros da Equipe
            </h3>
            <Badge tone="mint">{nomePlano}</Badge>
          </div>
          <p className="font-sans text-[13px] text-vapor-400">
            Gerencie operadores, gerentes e suas respectivas regras de comissão
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-[13px] text-vapor-400">
            Usuários:{' '}
            <strong className="text-amber-500 font-semibold">{activeAndInvitedCount}</strong>
            {limUsuarios !== null ? ` / ${limUsuarios}` : ' (ilimitado)'}
          </span>

          <Button
            type="button"
            variant="primary"
            disabled={isLimitReached}
            onClick={() => {
              setInviteLink(null);
              setInviteError(null);
              setShowInviteModal(true);
            }}
            className="min-h-[44px] px-4"
          >
            <UserPlus size={18} />
            Convidar Membro
          </Button>
        </div>
      </div>

      {isLimitReached && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-amber-500 text-[13px] flex items-center gap-2">
          <Lock size={16} className="shrink-0" />
          <span>
            Seu plano <strong>{nomePlano}</strong> permite no máximo {limUsuarios} usuário(s). Faça upgrade para adicionar mais pessoas.
          </span>
        </div>
      )}

      {/* Lista de Membros */}
      {loading ? (
        <p className="font-sans text-[14px] text-vapor-400 py-6 text-center">Carregando membros...</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {members.map((m) => {
            const regras = comissaoMap[m.id] || [];
            const regraVigente = regras.find((r) => !r.vigencia_fim || r.vigencia_fim > todayStr);
            const isDonoNoFree = planoAtual === 'free' && m.role === 'dono';

            return (
              <Card key={m.id} className="p-5 bg-graphite-800 border-graphite-600 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-sans text-[15px] font-bold text-vapor-100">
                      {m.email}
                    </span>
                    <Badge tone={m.role === 'dono' ? 'amber' : m.role === 'gerente' ? 'glass' : 'vapor'}>
                      {m.role.toUpperCase()}
                    </Badge>
                    <Badge tone={m.status === 'ativo' ? 'mint' : m.status === 'convidado' ? 'amber' : 'flare'}>
                      {m.status.toUpperCase()}
                    </Badge>
                  </div>

                  {/* Comissão Vigente ou Mensagem Plano Free */}
                  {isDonoNoFree ? (
                    <p className="font-sans text-[13px] text-vapor-400 italic mt-1">
                      Comissão faz sentido quando você tem equipe. Disponível no plano Pro.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 mt-1 text-[13px] font-mono text-vapor-400">
                      <span className="text-vapor-400">Comissão atual:</span>
                      {!regraVigente || regraVigente.tipo === 'nenhuma' ? (
                        <span className="text-vapor-400 italic">Sem comissão — apenas salário ou pró-labore</span>
                      ) : regraVigente.tipo === 'percentual' ? (
                        <span className="text-amber-500 font-semibold flex items-center gap-1">
                          <Percent size={14} /> {regraVigente.valor}% (vigente desde {regraVigente.vigencia_inicio})
                        </span>
                      ) : (
                        <span className="text-amber-500 font-semibold flex items-center gap-1">
                          <DollarSign size={14} /> R$ {Number(regraVigente.valor).toFixed(2)} por serviço (desde {regraVigente.vigencia_inicio})
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Ações do Membro */}
                {!isDonoNoFree && (
                  <div className="flex items-center gap-2 self-end md:self-center">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setSelectedMember(m);
                        setComissaoTipo(regraVigente?.tipo || 'nenhuma');
                        setComissaoValor(regraVigente?.valor || 0);
                        setComissaoInicio(todayStr);
                        setComissaoError(null);
                      }}
                      className="min-h-[40px] px-3 text-[13px]"
                    >
                      <ShieldCheck size={16} />
                      Gerenciar Comissão
                    </Button>

                    {m.role !== 'dono' && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setMemberToDelete(m);
                          setDeleteError(null);
                        }}
                        className="min-h-[40px] px-3 text-flare-400 hover:bg-flare-400/10 hover:text-flare-400"
                        title="Remover ou Inativar Membro"
                      >
                        <UserX size={16} />
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* MODAL CUSTOMIZADO: REMOVER OU INATIVAR MEMBRO */}
      <Modal
        isOpen={!!memberToDelete}
        onClose={() => setMemberToDelete(null)}
        title="Remover da Equipe"
        icon={<AlertTriangle size={20} className="text-flare-400" />}
        maxWidth="lg"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMemberToDelete(null)}
              disabled={deletingMember}
              className="min-h-[44px]"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleConfirmMemberAction('inativar')}
              disabled={deletingMember}
              className="min-h-[44px]"
            >
              Inativar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleConfirmMemberAction('excluir')}
              disabled={deletingMember}
              className="bg-flare-500 hover:bg-flare-600 text-vapor-100 border-none min-h-[44px] font-semibold flex items-center gap-1.5"
            >
              <Trash2 size={16} />
              {deletingMember ? 'Processando...' : 'Excluir Definitivamente'}
            </Button>
          </>
        }
      >
        {memberToDelete && (
          <div className="flex flex-col gap-3">
            <p className="font-sans text-[14px] text-vapor-300">
              Escolha a ação desejada para o membro:
            </p>
            <div className="font-mono text-[14px] font-bold text-vapor-100 bg-graphite-900 px-3.5 py-2.5 rounded border border-graphite-700 break-all flex items-center justify-between">
              <span>{memberToDelete.email}</span>
              <Badge tone={memberToDelete.role === 'dono' ? 'amber' : memberToDelete.role === 'gerente' ? 'glass' : 'vapor'}>
                {memberToDelete.role.toUpperCase()}
              </Badge>
            </div>
            <p className="font-sans text-[13px] text-vapor-400 mt-1 leading-relaxed">
              <strong className="text-flare-400 font-semibold">Excluir Definitivamente:</strong> remove completamente o registro do membro da equipe.<br />
              <strong className="text-amber-500 font-semibold">Inativar:</strong> mantém o histórico de comissões, mas bloqueia o acesso à oficina.
            </p>

            {deleteError && (
              <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* MODAL CONVIDAR */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setInviteLink(null);
        }}
        title="Convidar Membro"
        icon={<UserPlus size={20} className="text-amber-500" />}
        maxWidth="md"
      >
        {inviteError && (
          <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>{inviteError}</span>
          </div>
        )}

        {!inviteLink ? (
          <form onSubmit={handleConvidar} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">E-mail do Convidado</label>
              <Input
                type="email"
                placeholder="operador@oficina.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="min-h-[44px]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-sans text-[13px] text-vapor-400 font-medium">Papel / Nível de Acesso</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as AppRole)}
                className="min-h-[44px] px-3 bg-graphite-900 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px]"
              >
                <option value="operador">Operador (Executa serviços, sem valores financeiro)</option>
                <option value="gerente">Gerente (Gestão de estoque, orçamentos e financeiro)</option>
                <option value="dono">Dono (Acesso total + gestão de equipe)</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-graphite-700">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowInviteModal(false)}
                className="min-h-[44px]"
              >
                Cancelar
              </Button>
              <Button type="submit" variant="primary" className="min-h-[44px]">
                Gerar Convite
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="font-sans text-[14px] text-vapor-300">
              Convite criado com sucesso! Envie o link abaixo para o usuário:
            </p>

            <div className="flex gap-2">
              <Input type="text" readOnly value={inviteLink} className="min-h-[44px] font-mono text-[12px]" />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="min-h-[44px] px-4"
              >
                {copied ? <Check size={18} className="text-mint-400" /> : <Copy size={18} />}
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setInviteLink(null);
                setShowInviteModal(false);
              }}
              className="mt-2"
            >
              Concluir
            </Button>
          </div>
        )}
      </Modal>

      {/* MODAL COMISSÃO VIGENTE */}
      <Modal
        isOpen={!!selectedMember}
        onClose={() => setSelectedMember(null)}
        title={selectedMember ? `Gerenciar Comissão — ${selectedMember.email}` : 'Gerenciar Comissão'}
        icon={<ShieldCheck size={20} className="text-amber-500" />}
        maxWidth="lg"
      >
        {selectedMember && (
          <>
            {/* Aviso fixo obrigatório */}
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-amber-500 text-[13px] mb-4">
              <strong>Aviso:</strong> Vale a partir da data escolhida. Serviços anteriores mantêm a comissão que estava em vigor.
            </div>

            {comissaoError && (
              <div className="p-3 bg-flare-400/10 border border-flare-400/30 rounded text-flare-400 text-[13px] flex items-center gap-2 mb-4">
                <AlertTriangle size={16} />
                <span>{comissaoError}</span>
              </div>
            )}

            <form onSubmit={handleSalvarComissao} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Tipo de Comissão</label>
                <select
                  value={comissaoTipo}
                  onChange={(e) => setComissaoTipo(e.target.value as ComissaoTipo)}
                  className="min-h-[44px] px-3 bg-graphite-900 border border-graphite-600 rounded text-vapor-100 font-sans text-[14px]"
                >
                  <option value="nenhuma">Sem comissão — apenas salário ou pró-labore</option>
                  <option value="percentual">Percentual sobre o valor do serviço</option>
                  <option value="valor_fixo">Valor fixo por serviço</option>
                </select>

                <p className="font-sans text-[12px] text-vapor-400 mt-1 leading-normal">
                  Salário fixo não é configurado aqui — ele entra como despesa fixa no Financeiro. Quem recebe salário mais comissão deve escolher &apos;Percentual&apos; ou &apos;Valor fixo&apos; com o valor da comissão.
                </p>
              </div>

              {comissaoTipo !== 'nenhuma' && (
                <div className="flex flex-col gap-1">
                  <label className="font-sans text-[13px] text-vapor-400 font-medium">
                    {comissaoTipo === 'percentual' ? 'Porcentagem (%)' : 'Valor por serviço (R$)'}
                  </label>
                  <CampoNumerico
                    prefix={comissaoTipo === 'valor_fixo' ? 'R$' : undefined}
                    suffix={comissaoTipo === 'percentual' ? '%' : undefined}
                    value={comissaoValor}
                    onChange={(val) => setComissaoValor(val || 0)}
                    placeholder="0"
                    wrapperClassName="min-h-[44px]"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="font-sans text-[13px] text-vapor-400 font-medium">Nova regra a partir de (Vigência)</label>
                <Input
                  type="date"
                  min={todayStr}
                  value={comissaoInicio}
                  onChange={(e) => setComissaoInicio(e.target.value)}
                  required
                  className="min-h-[44px]"
                />
              </div>

              <div className="flex justify-end gap-2 mt-2 pt-3 border-t border-graphite-700">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedMember(null)}
                  className="min-h-[44px]"
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" disabled={savingComissao} className="min-h-[44px]">
                  {savingComissao ? 'Salvando...' : 'Aplicar Nova Regra'}
                </Button>
              </div>
            </form>

            {/* Histórico de Regras */}
            <div className="mt-4 pt-4 border-t border-graphite-600 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-vapor-100 font-display text-[14px] uppercase">
                <History size={16} />
                <span>Histórico de Vigências</span>
              </div>

              {(comissaoMap[selectedMember.id] || []).length === 0 ? (
                <p className="font-sans text-[12px] text-vapor-400 italic">Nenhum histórico gravado.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {(comissaoMap[selectedMember.id] || []).map((r) => (
                    <div
                      key={r.id}
                      className="p-2.5 bg-graphite-900/60 border border-graphite-600 rounded text-[12px] flex justify-between items-center"
                    >
                      <span className="font-mono text-amber-500">
                        {r.tipo === 'nenhuma'
                          ? 'Sem comissão — apenas salário ou pró-labore'
                          : r.tipo === 'percentual'
                          ? `${r.valor}%`
                          : `R$ ${Number(r.valor).toFixed(2)}`}
                      </span>
                      <span className="font-sans text-vapor-400">
                        {r.vigencia_inicio} até {r.vigencia_fim || 'atualidade'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};
