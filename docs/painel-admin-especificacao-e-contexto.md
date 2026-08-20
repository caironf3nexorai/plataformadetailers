# Especificação Técnica e Documentação de Contexto — Painel Admin da Plataforma

Este documento descreve detalhadamente a arquitetura, estrutura de dados, modelo de segurança, RPCs, componentes React e fluxos operacionais do **Painel Admin da Plataforma Detailers** (`/admin`). Este material foi estruturado para ser lido e processado por assistentes de IA (como o Claude) e desenvolvedores.

---

## 1. Visão Geral e Arquitetura de Segurança

O Painel Admin da Plataforma é um módulo **multi-tenant desacoplado e isolado** projetado para gestão administrativa e operacional da aplicação SaaS.

### Diretrizes de Segurança Fundamentais:
1. **Zero Vazamento de Dados Pessoais de Clientes Finais**: Nenhuma RPC ou tela do Painel Admin expõe dados sensíveis de clientes de oficinas (`clientes`, `veiculos`, `agendamentos`). O acesso traz apenas agregados numéricos, métricas operacionais e a lista de membros/equipe da oficina.
2. **Funções `SECURITY DEFINER` Protegidas**: Todas as consultas e operações do módulo admin utilizam RPCs dedicadas no PostgreSQL com a tag `SECURITY DEFINER`. O acesso direto via RLS às tabelas normais é bloqueado para usuários comuns.
3. **Dois Níveis de Privilégio Administrativo**:
   - `admin`: Leitura e escrita completa (preços, limites, permissões de plano, criação de planos, recalculo de storage e promoção de administradores).
   - `suporte`: Acesso estrito **somente leitura**.
4. **Super Admin Imutável**: O criador da plataforma é sinalizado com `super_admin = true`. Essa conta é imutável: o banco de dados proíbe qualquer operação de revogação ou rebaixamento dessa credencial, mesmo que chamada por outro administrador.
5. **Trilha de Auditoria Imutável**: Todas as ações administrativas (`plano_atualizado`, `limite_atualizado`, `feature_alterada`, `admin_promovido`, `admin_revogado`) são registradas na tabela `public.admin_auditoria` (somente `INSERT` e `SELECT` para admins).

---

## 2. Estrutura do Banco de Dados (Migrações 0049 e 0050)

### 2.1. Tabela `public.platform_admins`
Armazena a identidade dos usuários que possuem permissões administrativas na plataforma.
- `id` (UUID, PK)
- `user_id` (UUID, UNIQUE, FK -> `auth.users`)
- `email` (TEXT, NOT NULL)
- `nivel` (TEXT, NOT NULL, CHECK: `'admin'`, `'suporte'`)
- `ativo` (BOOLEAN, DEFAULT `true`)
- `super_admin` (BOOLEAN, DEFAULT `false` — **Imutável**)
- `observacao` (TEXT, NULL)
- `criado_por` (UUID, FK -> `auth.users`)
- `created_at` (TIMESTAMPTZ)
- `revogado_em` (TIMESTAMPTZ, NULL)

### 2.2. Tabela `public.admin_auditoria`
Trilha de auditoria para rastreabilidade de todas as alterações administrativas.
- `id` (UUID, PK)
- `admin_user_id` (UUID, FK -> `auth.users`)
- `acao` (TEXT, NOT NULL)
- `entidade` (TEXT, NOT NULL)
- `entidade_id` (TEXT, NULL)
- `valor_anterior` (JSONB, NULL)
- `valor_novo` (JSONB, NULL)
- `created_at` (TIMESTAMPTZ)

### 2.3. Tabela `public.feature_catalogo`
Catálogo de funcionalidades gerenciáveis da plataforma.
- `chave` (TEXT, PK) — ex: `'calculadora_diluicao'`, `'agendamento_online'`, `'sinal_pix'`, `'vistoria_aceite_remoto'`
- `nome` (TEXT, NOT NULL)
- `descricao` (TEXT, NULL)
- `categoria` (TEXT, NOT NULL) — ex: `'operacional'`, `'financeiro'`, `'vistoria'`, `'agendamento'`

### 2.4. Tabela `public.plan_features`
Matriz N:N que define quais funcionalidades estão habilitadas para cada plano de assinatura.
- `id` (UUID, PK)
- `plano` (`plan_code`, FK -> `plans.codigo`)
- `feature` (TEXT, FK -> `feature_catalogo.chave`)
- `habilitado` (BOOLEAN, DEFAULT `true`)
- UNIQUE (`plano`, `feature`)

### 2.5. Tabela `public.storage_uso_snapshot`
Snapshot de armazenamento de mídia por oficina em bytes.
- `id` (UUID, PK)
- `tenant_id` (UUID, UNIQUE, FK -> `tenants.id`)
- `total_bytes` (BIGINT, DEFAULT 0)
- `total_arquivos` (INTEGER, DEFAULT 0)
- `atualizado_em` (TIMESTAMPTZ)

---

## 3. Catálogo de RPCs `SECURITY DEFINER`

### 3.1. RPCs de Segurança e Autenticação
- **`public.is_platform_admin()`**: Retorna `BOOLEAN`. Valida se `auth.uid()` existe em `platform_admins` com `ativo = true` e `revogado_em IS NULL`.
- **`public.is_platform_admin_editor()`**: Retorna `BOOLEAN`. Valida se `is_platform_admin()` é verdadeiro E se `nivel = 'admin'`.

### 3.2. RPCs Operacionais do Painel Admin
- **`public.admin_listar_tenants(p_busca text, p_plano text, p_limite integer, p_offset integer)`**: Retorna lista de oficinas com métricas agregadas (total de membros, contagem de agendamentos e execuções no mês atual, churn/inatividade > 30 dias).
- **`public.admin_detalhe_tenant(p_tenant_id uuid)`**: Retorna detalhes completos da oficina, lista da equipe/membros (Dono, Gerente, Operador, e-mails, status e último acesso) e histórico dos últimos 12 meses.
- **`public.admin_listar_planos()`**: Retorna lista dos planos ordenados deterministicamente (`free` -> 1, `pro` -> 2, `studio` -> 3), preços em centavos e limites de recursos.
- **`public.admin_atualizar_plano(p_codigo text, p_nome text, p_preco_centavos integer, p_ativo boolean)`**: Atualiza dados cadastrais do plano e insere registro na auditoria.
- **`public.admin_definir_limite(p_plano text, p_recurso text, p_limite integer)`**: Atualiza limites na tabela `plan_limits` (`null` representa ilimitado).
- **`public.admin_criar_novo_plano(p_codigo text, p_nome text, p_preco_centavos integer)`**: **Automação de Novos Planos**. Adiciona dinamicamente o código ao `ENUM plan_code`, insere o plano, popula os limites padrão e semeia o catálogo de features.
- **`public.admin_salvar_plan_features(p_plano text, p_features jsonb)`**: Atualiza em lote a matriz de permissões/funcionalidades de um plano e audita a alteração.
- **`public.tenant_tem_feature(p_tenant_id uuid, p_feature text)`**: Função consultada pelo frontend e backend do tenant para verificar se a oficina atual tem acesso a uma funcionalidade.
- **`public.admin_recalcular_storage()`**: Varre os buckets do `storage.objects` filtrando pelo primeiro segmento do caminho (`split_part(name, '/', 1) = tenant_id`), recalcula total em bytes e atualiza `storage_uso_snapshot`.
- **`public.admin_listar_administradores()`**: Retorna lista dos administradores da plataforma.
- **`public.admin_promover_administrador(p_email text, p_nivel text, p_observacao text, p_super_admin boolean)`**: Promove um usuário cadastrado a administrador/suporte.
- **`public.admin_revogar_administrador(p_admin_id uuid)`**: Revoga acesso de um administrador, impedindo revogação se for Super Admin (`super_admin = true`).

---

## 4. Estrutura do Frontend React (`/admin`)

### 4.1. Roteamento e Lazy Loading (`src/App.tsx`)
Todas as rotas do módulo admin são carregadas tardiamente via `React.lazy` e envoltas em `<AdminErrorBoundary>` e `<AdminGuard>`:
- `/admin/oficinas` -> `AdminOficinas.tsx`
- `/admin/planos` -> `AdminPlanos.tsx`
- `/admin/planos/permissoes` -> `AdminPermissoes.tsx`
- `/admin/storage` -> `AdminStorage.tsx`
- `/admin/administradores` -> `AdminAdmins.tsx`

### 4.2. Componentes Principais
1. **`AdminGuard.tsx`**:
   - Valida acesso do usuário usando `is_platform_admin()`.
   - Se o usuário não estiver cadastrado em `platform_admins`, exibe um painel interativo de diagnóstico com o e-mail logado, ID do usuário e botão de **Copiar SQL** formatado para liberação do acesso.
   - Disponibiliza o contexto `useAdminAuth()` contendo `isPlatformAdmin`, `adminLevel` e `adminEmail`.

2. **`AdminLayout.tsx`**:
   - Layout responsivo industrial com barra fixa superior "PAINEL DA PLATAFORMA".
   - Navegação por abas com prop `end={true}` para garantir destaque ativo exclusivo de cada rota.
   - Exibe banner de **Modo Suporte (Somente Leitura)** quando `adminLevel === 'suporte'`.

3. **`AdminOficinas.tsx`**:
   - Listagem com busca por nome/CNPJ/e-mail, filtro por plano e paginação.
   - Indicadores visuais de oficinas em risco de churn (sem atividade há mais de 30 dias).
   - Gaveta lateral (*Drawer*) com detalhes completos da oficina, incluindo a **lista da equipe/membros da oficina** (Dono, Gerente, Operadores) e métricas dos últimos 12 meses.

4. **`AdminPlanos.tsx`**:
   - Cards de gerenciamento de preços em Reais (convertidos para centavos no banco) e limites por recurso.
   - Alternadores "Ilimitado" para gravar `null` nos limites.
   - **Botão `+ Criar Novo Plano`**: Modal integrado que chama `admin_criar_novo_plano` e cria planos com ordenação determinística garantida (`Free` -> 1, `Pro` -> 2, `Studio` -> 3).

5. **`AdminPermissoes.tsx`**:
   - Matriz de funcionalidades por plano agrupada por categorias (Operacional, Financeiro, Vistoria, Agendamento).
   - Salvamento em lote e efeito em tempo real via `tenant_tem_feature`.
   - Alerta visual de alteração global informando que o impacto afeta todas as oficinas do plano imediatamente.

6. **`AdminStorage.tsx`**:
   - Dashboard de consumo de armazenamento de mídia por oficina.
   - KPIs de total armazenado no sistema, média por oficina e botão de **Recalcular Storage** sob demanda.

7. **`AdminAdmins.tsx`**:
   - Gestão de administradores da plataforma.
   - Promoção de novos usuários pelo e-mail com seleção de nível (`admin` ou `suporte`).
   - Distintivo 👑 **SUPER ADMIN (PROTEGIDO)** para o criador da plataforma com bloqueio de revogação/edição.

---

## 5. Mapeamento de Features no Tenant para `tenant_tem_feature`

Para a próxima etapa de bloqueios granulares por plano nas telas do tenant, as seguintes chamadas a `tenant_tem_feature(tenant_id, feature_key)` foram configuradas no catálogo:

| Tela / Módulo do Tenant | Chave da Feature no Catálogo |
| :--- | :--- |
| `DiluicaoInterna.tsx` | `'calculadora_diluicao'` |
| `Clientes.tsx` & `DetalheCliente.tsx` | `'clientes_veiculos'` |
| `Servicos.tsx` & `FormularioServico.tsx` | `'servicos_catalogo'` |
| `Agenda.tsx` | `'agenda'` |
| `FormularioCheckin.tsx` | `'vistoria_entrada'` |
| `VisualizarCheckin.tsx` | `'vistoria_aceite_remoto'` |
| `GerenciadorCombos.tsx` | `'combos'` |
| `Execucao.tsx` | `'execucao_checklist'`, `'execucao_fotos'`, `'execucao_multiplos_executores'` |
| `Estoque.tsx` | `'estoque'` |
| `Financeiro.tsx` | `'financeiro_custo_hora'`, `'financeiro_comissoes'` |
| `Orcamentos.tsx` | `'orcamentos_tres_niveis'` |
| `AbaAgendamentoOnline.tsx` | `'agendamento_online'`, `'sinal_pix'` |

---

## 6. Procedimento de Bootstrap do Primeiro Administrador

Para ativar a primeira conta de Administrador da Plataforma após a execução da migração, execute uma única vez no Supabase SQL Editor:

```sql
INSERT INTO public.platform_admins (user_id, email, nivel, super_admin, criado_por)
SELECT id, email, 'admin', true, id 
FROM auth.users 
WHERE email = 'seu_email@dominio.com'
ON CONFLICT (user_id) DO UPDATE 
SET super_admin = true, nivel = 'admin', ativo = true, revogado_em = NULL;
```
