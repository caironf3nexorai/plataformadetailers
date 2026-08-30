# Contrato de RPCs Públicas — Plataforma Detailers

> **Documento Oficial de Contrato de Interface de RPCs do Schema `public`**
> Toda chamada `supabase.rpc()` realizada no frontend deve aderir estritamente às assinaturas, nomes de parâmetros, tipos de dados e permissões documentados neste contrato.

---

## ⚠️ REGRA MANDATÓRIA: PROIBIÇÃO ABSOLUTA DE SOBRECARGA DE FUNÇÕES (OVERLOAD) NA API POSTGREST

1. **Incompatibilidade Arquitetural do PostgREST (PGRST203)**:
   - O PostgREST resolve chamadas RPC inspecionando os **NOMES dos parâmetros** fornecidos na requisição HTTP/JSON, e não a tipagem estrita do PostgreSQL.
   - Ter duas ou mais funções com o mesmo nome e parâmetros coincidentes ou com valores padrão (*default values*) resulta no erro fatal:
     `PGRST203: Could not choose the best candidate function`.
2. **Regra de Ouro do Projeto**:
   - **UMA ÚNICA ASSINATURA VISÍVEL NA API POR NOME DE FUNÇÃO**.
   - É expressamente proibido criar "versões sobrecarregadas" ou "wrappers alternativos" com o mesmo nome para atender diferentes telas.
3. **Mudança de Assinatura**:
   - Qualquer necessidade de alteração em parâmetros exige a **modificação direta da função canônica existente** e o **ajuste simultâneo do frontend na mesma entrega/migração**.
   - Nunca crie uma segunda versão.
4. **Validação Obrigatória em Toda Entrega**:
   A consulta abaixo DEVE retornar rigorosamente **0 linhas** (vazia) antes de qualquer deploy:
   ```sql
   select p.proname, count(*) as versoes,
          array_agg(p.oid::regprocedure::text) as assinaturas
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and has_function_privilege('authenticated', p.oid, 'execute')
   group by 1 having count(*) > 1
   order by 2 desc;
   ```

---

## Inventário Canônico Geral de Funções RPC

| Nome da Função | Parâmetros | Tipo de Retorno | Grants |
| :--- | :--- | :--- | :--- |
| `aceitar_vistoria_remoto` | `p_token uuid, p_nome text, p_tipo text, p_user_agent text, p_ip text default null` | `jsonb` | `anon`, `authenticated` |
| `adicionar_executor` | `p_execucao uuid, p_member uuid` | `void` | `authenticated` |
| `adicionar_item_agendamento` | `p_agendamento uuid, p_servico uuid, p_combo uuid default null` | `void` | `authenticated` |
| `adicionar_item_execucao` | `p_execucao uuid, p_item_nome text, p_obrigatorio boolean default false` | `uuid` | `authenticated` |
| `agendar_cliente_online` | `p_slug text, p_cliente_nome text, p_cliente_telefone text, p_veiculo_placa text, p_veiculo_modelo text, p_categoria uuid, p_itens jsonb, p_inicio timestamptz, p_observacoes text default null, p_transbordo_aceito boolean default false, p_user_agent text default null, p_ip text default null` | `jsonb` | `anon`, `authenticated` |
| `agendar_online` | `p_slug text, p_nome text, p_telefone text, p_placa text, p_modelo text, p_categoria uuid, p_itens jsonb, p_inicio timestamptz, p_observacoes text default null, p_transbordo_aceito boolean default false, p_user_agent text default null, p_ip text default null` | `jsonb` | `anon`, `authenticated` |
| `agendar_orcamento_publico` | `p_token uuid, p_inicio timestamptz, p_transbordo_aceito boolean default false, p_user_agent text default null, p_ip text default null` | `jsonb` | `anon`, `authenticated` |
| `ajustar_estoque` | `p_tenant uuid, p_produto uuid, p_nova_qtd numeric, p_motivo text` | `void` | `authenticated` |
| `aplicar_desconto_orcamento` | `p_orcamento uuid, p_tipo text, p_valor numeric, p_motivo text default null, p_cupom_codigo text default null` | `void` | `authenticated` |
| `atendimentos_periodo` | `p_tenant uuid, p_inicio date, p_fim date` | `table(...)` | `authenticated` |
| `atualizar_servicos_em_massa` | `p_tenant uuid, p_servicos jsonb` | `void` | `authenticated` |
| `atualizar_slug` | `p_tenant_id uuid, p_novo_slug text` | `void` | `authenticated` |
| `auditar_inconsistencias_banco` | *(nenhum)* | `table(...)` | `authenticated` |
| `cadastro_rapido` | `p_tenant uuid, p_cliente_nome text, p_cliente_telefone text, p_veiculo_placa text, p_veiculo_modelo text, p_categoria_id uuid` | `jsonb` | `authenticated` |
| `cancelar_agendamento` | `p_agendamento uuid, p_motivo text default null` | `void` | `authenticated` |
| `catalogo_agendamento` | `p_slug text` | `jsonb` | `anon`, `authenticated` |
| `comissoes_a_pagar` | `p_tenant uuid, p_inicio date, p_fim date` | `table(...)` | `authenticated` |
| `confirmar_agendamento_online` | `p_agendamento uuid` | `void` | `authenticated` |
| `confirmar_alteracao_orcamento` | `p_token uuid, p_novo_titulo text, p_motivo text` | `jsonb` | `anon`, `authenticated` |
| `confirmar_despesas_variaveis_lote` | `p_tenant uuid, p_mes date, p_despesas jsonb` | `void` | `authenticated` |
| `converter_orcamento_em_agendamento` | `p_orcamento uuid, p_inicio timestamptz` | `uuid` | `authenticated` |
| `criar_agendamento` | `p_cliente uuid, p_veiculo uuid, p_itens jsonb, p_categoria uuid, p_inicio timestamptz, p_observacoes text default null, p_forcado boolean default false` | `uuid` | `authenticated` |
| `criar_oficina` | `p_nome text, p_cidade text, p_uf text, p_telefone text, p_codigo_indicacao text default null, p_codigo_parceiro text default null, p_documento text default null` | `uuid` | `authenticated` |
| `criar_orcamento` | `p_tenant uuid, p_cliente uuid, p_veiculo uuid, p_categoria uuid, p_titulo text, p_observacoes text default null` | `uuid` | `authenticated` |
| `custo_hora_operacao` | `p_tenant uuid, p_mes date` | `numeric` | `authenticated` |
| `entrada_avulsa` | `p_cliente uuid, p_veiculo uuid, p_itens jsonb, p_categoria uuid, p_observacoes text default null` | `uuid` | `authenticated` |
| `enviar_orcamento` | `p_orcamento uuid` | `uuid` | `authenticated` |
| `expirar_orcamentos` | `p_tenant uuid` | `void` | `authenticated` |
| `expirar_sinais_pendentes` | `p_tenant uuid` | `void` | `authenticated` |
| `finalizar_execucao` | `p_execucao uuid, p_valor_total numeric, p_itens_cobrados jsonb default null` | `void` | `authenticated` |
| `finalizar_execucao_com_pagamentos` | `p_execucao uuid, p_pagamentos jsonb default '[]'::jsonb, p_valores jsonb default '[]'::jsonb, p_consumos jsonb default '[]'::jsonb, p_observacoes text default null, p_desconto_tipo text default null, p_desconto_valor numeric default 0, p_desconto_motivo text default null` | `void` | `authenticated` |
| `gerar_payload_pix` | `p_tenant uuid, p_valor numeric, p_txid text` | `jsonb` | `anon`, `authenticated` |
| `historico_consumo_veiculo` | `p_veiculo uuid` | `table(...)` | `authenticated` |
| `horarios_disponiveis` | `p_tenant uuid, p_data date, p_itens jsonb default null, p_categoria uuid default null, p_ignorar_agendamento uuid default null` | `table(horario time, disponivel boolean, motivo text, termino_previsto timestamptz)` | `anon`, `authenticated` |
| `horas_disponiveis_mes` | `p_tenant uuid, p_mes date` | `numeric` | `authenticated` |
| `iniciar_execucao` | `p_agendamento uuid` | `uuid` (ou `jsonb`) | `authenticated` |
| `limpar_fotos_expiradas` | *(nenhum)* | `integer` | `authenticated` |
| `marcar_item` | `p_item uuid, p_concluido boolean` | `void` | `authenticated` |
| `marcar_nao_compareceu` | `p_agendamento uuid` | `void` | `authenticated` |
| `meus_tenants` | *(nenhum)* | `setof uuid` | `authenticated` |
| `normalizar_placa` | `p_placa text` | `text` | `anon`, `authenticated` |
| `normalizar_telefone` | `p_telefone text` | `text` | `anon`, `authenticated` |
| `nova_regra_comissao` | `p_tenant uuid, p_member uuid, p_tipo text, p_valor numeric, p_inicio date` | `uuid` | `authenticated` |
| `obter_ou_gerar_despesas_mes` | `p_tenant uuid, p_mes date` | `table(...)` | `authenticated` |
| `orcamento_publico` | `p_token uuid` | `jsonb` | `anon`, `authenticated` |
| `pausar_execucao` | `p_execucao uuid` | `void` | `authenticated` |
| `proximo_numero_orcamento` | `p_tenant uuid` | `integer` | `authenticated` |
| `proximo_numero_os` | `p_tenant uuid` | `integer` | `authenticated` |
| `reagendar` | `p_agendamento uuid, p_novo_inicio timestamptz` | `void` | `authenticated` |
| `recalcular_agendamento_totais` | `p_agendamento_id uuid` | `void` | `authenticated` |
| `recusar_agendamento_online` | `p_agendamento uuid, p_motivo text default null` | `void` | `authenticated` |
| `registrar_cliente_veiculo_publico` | `p_tenant_id uuid, p_nome text, p_telefone text, p_categoria_id uuid default null, p_placa text default null, p_modelo text default null, p_marca text default null, p_ano integer default null, p_cor text default null` | `table(cliente_id uuid, veiculo_id uuid, cliente_novo boolean, veiculo_novo boolean, aviso text)` | `anon`, `authenticated` |
| `registrar_entrada_estoque` | `p_tenant uuid, p_produto uuid, p_qtd numeric, p_preco_custo numeric` | `void` | `authenticated` |
| `registrar_sinal_pago` | `p_agendamento uuid` | `void` | `authenticated` |
| `remover_desconto_orcamento` | `p_orcamento uuid` | `void` | `authenticated` |
| `remover_executor` | `p_execucao uuid, p_member uuid` | `void` | `authenticated` |
| `remover_item_agendamento` | `p_agendamento uuid, p_servico uuid default null, p_item uuid default null` | `void` | `authenticated` |
| `remover_item_execucao` | `p_item uuid` | `void` | `authenticated` |
| `rentabilidade_por_servico` | `p_tenant uuid, p_inicio date, p_fim date` | `table(...)` | `authenticated` |
| `responder_orcamento` | `p_token uuid, p_nivel text, p_aprovado boolean` | `jsonb` | `anon`, `authenticated` |
| `resumo_financeiro` | `p_tenant uuid, p_inicio date, p_fim date` | `jsonb` | `authenticated` |
| `retomar_execucao` | `p_execucao uuid` | `void` | `authenticated` |
| `salvar_matriz_precos` | `p_servico uuid, p_linhas jsonb` | `void` | `authenticated` |
| `salvar_nivel_orcamento` | `p_orcamento uuid, p_nivel text, p_titulo text, p_servicos jsonb` | `void` | `authenticated` |
| `semear_servicos` | `p_tenant_id uuid` | `void` | `authenticated` |
| `solicitar_reassinatura_orcamento` | `p_orcamento uuid` | `void` | `authenticated` |
| `tem_papel` | `p_tenant uuid, p_roles app_role[]` | `boolean` | `authenticated` |
| `transferir_veiculo` | `p_veiculo uuid, p_novo_cliente uuid` | `void` | `authenticated` |
| `uso_storage_plataforma` | *(nenhum)* | `jsonb` | `authenticated` |
| `vistoria_publica` | `p_token uuid` | `jsonb` | `anon`, `authenticated` |

---
