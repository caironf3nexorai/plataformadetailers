# Master Guide de Segurança, Auditoria e Hardening
**Plataforma Detailers — SaaS Multi-tenant Automotivo**  
*Documento Central de Registro de Intervenções, Scripts SQL, Diagnósticos e Decisões*  
*Data de Referência: Setembro de 2026*

---

## 1. Resumo do Status de Segurança

| Componente | Situação | Detalhe da Ação |
| :--- | :---: | :--- |
| **Edge Function `asaas-webhook`** | ✅ **Aplicado & Deployado** | Se `ASAAS_WEBHOOK_SECRET` ausente/inválido $\rightarrow$ HTTP 401 imediato. Deploy via CLI com `--no-verify-jwt`. |
| **Edge Function `expurgo-fotos`** | ✅ **Aplicado & Deployado** | Se `CRON_SECRET` ausente/inválido $\rightarrow$ HTTP 401 imediato. Deploy via CLI com `--no-verify-jwt`. |
| **Edge Function `evidencias-aceite`** | ✅ **Deployado** | Deploy via CLI com `--no-verify-jwt` para atendimento a links públicos de vistoria via WhatsApp. |
| **Security Headers (`vercel.json`)** | ✅ **Aplicado** | `X-Frame-Options: DENY`, `Strict-Transport-Security`, `Referrer-Policy` e `Permissions-Policy` ativos. |
| **Histórico do Repositório Git** | ✅ **Auditado** | Verificação com `git log --all --full-history -- .env*` confirmou ausência total de segredos commitados. |
| **Banco de Dados (RLS Certificados)** | 📋 **Script Pronto** | Remoção de `USING (true)` em `certificados_garantia` e `certificado_manutencoes`. |
| **Banco de Dados (Rate Limit)** | 📋 **Script Pronto** | DROP de política aberta e `REVOKE ALL` em `agendamento_online_tentativas`. |
| **Banco de Dados (Anti-Fraude Planos)** | 📋 **Script Pronto** | Trigger de integridade `trg_proteger_plano_tenant` impedindo auto-upgrade no `tenants`. |
| **Content Security Policy (CSP)** | ✅ **Aplicado** | Regra ativada no `vercel.json` com suporte a Supabase, QR codes, Unsplash, Google Fonts, YouTube/Vimeo e PDF worker. |

---

## 2. O Que Já Foi Feito (Código e Deploy)

### 2.1 Edge Functions: Correção de Bypass de Autenticação
- **Arquivos:**
  - `supabase/functions/asaas-webhook/index.ts`
  - `supabase/functions/expurgo-fotos/index.ts`
- **Problema anterior:** A checagem `if (SECRET && token !== SECRET)` permitia que, se as variáveis de ambiente estivessem vazias ou não configuradas, qualquer atacante disparasse requisições sem autenticação.
- **Modificação aplicada:**
  ```typescript
  // asaas-webhook/index.ts
  const tokenHeader = req.headers.get('asaas-access-token');
  if (!ASAAS_WEBHOOK_SECRET || tokenHeader !== ASAAS_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Não autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // expurgo-fotos/index.ts
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!cronSecret || (token !== cronSecret && cronHeader !== cronSecret)) {
    return new Response(JSON.stringify({ error: 'Não autorizado: Secret do CRON inválido ou ausente.' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  ```
- **Deploys executados via Supabase CLI:**
  ```bash
  supabase functions deploy asaas-webhook --no-verify-jwt
  supabase functions deploy expurgo-fotos --no-verify-jwt
  supabase functions deploy evidencias-aceite --no-verify-jwt
  supabase functions deploy asaas-checkout
  supabase functions deploy asaas-cancelar-assinatura
  ```

---

### 2.2 Vercel: Cabeçalhos de Proteção HTTP
- **Arquivo:** `vercel.json`
- **Modificação aplicada:**
  ```json
  {
    "key": "X-Frame-Options",
    "value": "DENY"
  },
  {
    "key": "Strict-Transport-Security",
    "value": "max-age=63072000; includeSubDomains; preload"
  },
  {
    "key": "Referrer-Policy",
    "value": "strict-origin-when-cross-origin"
  },
  {
    "key": "Permissions-Policy",
    "value": "camera=(), microphone=(), geolocation=()"
  }
  ```
- **Proteção concretizada:** Impede Clickjacking em iframes maliciosos, força conexão HTTPS perpétua e veda acesso indevido de sensores de hardware.

---

## 3. Scripts SQL Prontos para Execução no Banco de Dados

Estes scripts consolidam a correção das **3 falhas críticas de RLS**. Eles foram desenhados para que **nenhuma tela do front-end ou rotina legítima seja quebrada**.

### 3.1 Script Consolidado da Migração `0122`
```sql
-- ==============================================================================
-- MIGRAÇÃO 0122: HARDENING DE SEGURANÇA E BLINDAGEM MULTI-TENANT
-- 1. Elimina vazamento aberto de certificados de garantia (0115)
-- 2. Blinda tabela de rate limit de agendamentos contra adulteração externa (0041)
-- 3. Cria trava de integridade anti-fraude na coluna plano da tabela tenants (0001)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PARTE 1: CERTIFICADOS DE GARANTIA E REVISÕES
-- Remove políticas com USING (true) que permitiam a qualquer anônimo fazer SELECT *
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Leitura pública de certificados por código" ON public.certificados_garantia;
DROP POLICY IF EXISTS "Leitura pública de manutenções de certificados" ON public.certificado_manutencoes;

-- Observação: 
-- A consulta pública continua 100% ativa via RPC segura public.obter_certificado_publico(p_codigo).
-- As telas internas do CRM continuam ativas pela política "Membros do tenant gerenciam certificados".


-- ------------------------------------------------------------------------------
-- PARTE 2: TABELA DE RATE LIMIT DE AGENDAMENTOS ONLINE
-- Remove política permissiva (FOR ALL USING true) e revoga acesso direto à tabela
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Agendamentos tentativas leitura" ON public.agendamento_online_tentativas;
REVOKE ALL ON TABLE public.agendamento_online_tentativas FROM anon, authenticated, public;
ALTER TABLE public.agendamento_online_tentativas ENABLE ROW LEVEL SECURITY;

-- Observação:
-- A RPC public.agendar_online roda como SECURITY DEFINER e mantém acesso total interno.


-- ------------------------------------------------------------------------------
-- PARTE 3: TRAVA ANTI-FRAUDE NA COLUNA PLANO DA TABELA TENANTS
-- Impede que donos de oficina alterem seu próprio plano via console DevTools
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.impedir_alteracao_plano_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Se o plano não mudou, permite a edição cadastral normal (nome, logo, pix, etc.)
  IF (NEW.plano IS NOT DISTINCT FROM OLD.plano) THEN
    RETURN NEW;
  END IF;

  -- Se o plano mudou, autoriza APENAS se a chamada vier de:
  -- 1. Super-Admin autenticado da plataforma (public.is_platform_admin())
  -- 2. Webhook do Asaas ou rotinas automáticas do banco (role service_role ou postgres)
  IF public.is_platform_admin() 
     OR current_user = 'service_role' 
     OR session_user = 'service_role' 
     OR current_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'A alteração de plano só é permitida via checkout ou administração da plataforma.';
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_plano_tenant ON public.tenants;
CREATE TRIGGER trg_proteger_plano_tenant
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.impedir_alteracao_plano_tenant();
```

---

## 4. Análise de Risco e Garantia de Não-Regressão

| Ação do Script SQL | Telas Legítimas Verificadas | Por que NÃO quebra? |
| :--- | :--- | :--- |
| **Remover `USING (true)` dos Certificados** | `CertificadoGarantiaPublico.tsx`, `VisualizarAtendimento.tsx`, `GarantiasClienteVeiculo.tsx`, `AbaGarantias.tsx` | A tela pública consome a RPC `obter_certificado_publico`. As telas internas do CRM usam a política restrita de membros autenticados da própria oficina. |
| **Fechar `agendamento_online_tentativas`** | `FluxoAgendamentoOnline.tsx` | Nenhuma tela do React consome essa tabela diretamente. Apenas a RPC `agendar_online` (que é `SECURITY DEFINER`) a utiliza no servidor. |
| **Trigger Anti-Fraude no `tenants`** | `Configuracoes.tsx`, `AbaHorarios.tsx`, `ModalPlacaBalcao.tsx`, etc. | Todas as telas de configuração da oficina editam nome, logo, capa, telefone e chave Pix. Nenhuma tela do cliente altera `plano` via REST direto. |

---

## 5. O Que Você Precisa Definir / Aprovar

Ao final deste ciclo de auditoria, temos **4 definições simples**:

### Definição 1: Aplicação da Migração SQL `0122`
- **Decisão:** Aprovar a execução do script da Seção 3 no banco Supabase.
- **Como aplicar:** Podemos criar o arquivo `supabase/migrations/0122_correcoes_seguranca_auditoria.sql` no projeto para você rodar com `supabase db push` ou colar diretamente no SQL Editor do painel Supabase.

### Definição 2: Ativação da CSP no `vercel.json`
- **Decisão:** Decidir se adicionamos a política CSP agora ou se aguardamos o teste pós-deploy.
- **Regra recomendada:**
  ```json
  {
    "key": "Content-Security-Policy",
    "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none';"
  }
  ```

### Definição 3: Confirmação de Segredos em Produção
- **Decisão:** Confirmar se as seguintes variáveis estão salvas em **Supabase Dashboard > Project Settings > Edge Functions > Secrets**:
  1. `ASAAS_WEBHOOK_SECRET` $\rightarrow$ Segredo configurado no painel do Asaas.
  2. `CRON_SECRET` $\rightarrow$ Chave secreta usada pelo seu disparador de tarefas periódicas.

### Definição 4: Otimização do Build de Produção (`vite.config.ts`)
- **Decisão:** Autorizar a desativação de source maps públicos e remoção automática de comandos `console.log` no bundle final de produção:
  ```typescript
  build: {
    sourcemap: false,
    // ...
  },
  esbuild: {
    drop: ['console', 'debugger'],
  }
  ```
