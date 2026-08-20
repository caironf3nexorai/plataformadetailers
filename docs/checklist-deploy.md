# 🚀 Checklist de Deploy para Produção - Plataforma Detailers

Este documento contém todos os passos necessários para preparar, validar, publicar e manter a **Plataforma Detailers** em ambiente de produção (Vercel / Netlify / Cloudflare Pages + Supabase).

---

## 1. 🗄️ Banco de Dados & Migrações (Supabase Production)

- [ ] **Criar Projeto de Produção no Supabase**:
  - Criar uma nova organização e projeto no [Supabase Console](https://supabase.com/dashboard).
  - Anotar a `URL` do projeto e a chave `anon` (`SUPABASE_ANON_KEY`).
  - Definir uma senha forte para o banco PostgreSQL.

- [ ] **Executar as Migrações SQL na Ordem Correta**:
  - Garantir que **todas as 56 migrations** (da `0001_fundacao.sql` até a `0056_fix_taxas_cartao_lote.sql`) sejam executadas na ordem numérica sequencial no projeto de produção.
  - *Comando Supabase CLI* (se estiver usando CLI):
    ```bash
    npx supabase db push
    ```
  - *Ou via SQL Editor do Supabase*: Executar sequencialmente os arquivos localizados na pasta `supabase/migrations/`.

- [ ] **Verificar Triggers e RPCs Críticas**:
  - [ ] `finalizar_execucao_com_pagamentos` (RPC transacional de baixa financeira).
  - [ ] `salvar_taxas_cartao_lote` (RPC de vigência de taxas de maquininha).
  - [ ] `horarios_disponiveis` (RPC do agendamento online público).
  - [ ] `trg_validar_taxa_cartao_sobreposta` e `trg_taxas_cartao_imutavel`.

---

## 2. 🔒 RLS (Row Level Security) & Permissões

- [ ] **Confirmar RLS Ativado em Todas as Tabelas**:
  - Verificar se todas as tabelas possuem `ALTER TABLE <tabela> ENABLE ROW LEVEL SECURITY;`.
  - Garantir que não existam tabelas com RLS desativado.

- [ ] **Políticas Multi-Tenant**:
  - Validar se as políticas utilizam o filtro `tenant_id IN (SELECT public.meus_tenants())`.

- [ ] **Controle de Acesso Super Admin**:
  - Cadastrar o e-mail do Administrador da Plataforma na tabela `public.super_admins` para liberar o acesso ao painel `/admin`.

---

## 3. 📦 Configuração dos Storage Buckets (Supabase Storage)

No menu **Storage** do Supabase Console, criar os seguintes buckets:

- [ ] **Bucket `logos`**:
  - **Público**: `SIM` (Public Bucket).
  - **Tamanho Máximo de Arquivo**: 5 MB.
  - **MIME Types Permitidos**: `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`.

- [ ] **Bucket `checkin`**:
  - **Público**: `SIM` (ou Acesso por URL Pública/Assinada).
  - **Uso**: Fotos de avarias, avaria em 360°, assinaturas de vistoria e aceite remoto.
  - **MIME Types Permitidos**: `image/png`, `image/jpeg`, `image/webp`.

- [ ] **Bucket `execucao`**:
  - **Público**: `SIM`.
  - **Uso**: Evidências fotográficas das etapas de execução dos serviços.

- [ ] **Políticas de Leitura e Escrita dos Buckets**:
  - Adicionar políticas em `storage.objects` permitindo upload para usuários autenticados pertencentes ao tenant e leitura pública para exibição dos comprovantes e orçamentos remotos.

---

## 4. 🌐 Variáveis de Ambiente (Environment Variables)

No painel do provedor de hospedagem (Vercel, Netlify, etc.), configurar as seguintes variáveis de ambiente:

| Variável | Descrição | Exemplo |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | URL do projeto Supabase Produção | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Chave Pública Anon do Supabase | `eyJhbGciOiJKV1Qi...` |

> ⚠️ **ATENÇÃO DE SEGURANÇA**: NUNCA insira a `service_role` key nas variáveis de ambiente do frontend (`VITE_`).

---

## 5. ⚙️ Configuração do Hosting & Build (Vercel / Netlify)

- [ ] **Comando de Build**: `npm run build`
- [ ] **Diretório de Saída (Output Directory)**: `dist`
- [ ] **Versão do Node.js**: `18.x` ou `20.x LTS`.

- [ ] **Configurar Regras de Roteamento SPA (Single Page Application)**:
  - Para a **Vercel**, garantir a existência do arquivo `vercel.json` na raiz:
    ```json
    {
      "rewrites": [
        { "source": "/(.*)", "destination": "/index.html" }
      ]
    }
    ```
  - Para o **Netlify**, criar o arquivo `public/_redirects`:
    ```text
    /*    /index.html   200
    ```

---

## 6. 🧪 Testes de Aceitação Manual em Produção

Após realizar o deploy da URL final, executar o fluxo ponta a ponta:

1. [ ] **Cadastro & Login**:
   - Cadastrar uma nova conta/oficina e realizar login.
2. [ ] **Formas & Taxas**:
   - Cadastrar uma maquininha (ex: Stone) e preencher a tabela de taxas (Débito e Crédito 1x a 12x).
   - Testar o botão `Repetir ↓` e salvar a vigência. Confirmar que as taxas persistem sem erro.
3. [ ] **Agendamento & Vistoria (Check-in)**:
   - Criar um agendamento.
   - Realizar o Check-in com marcadores de avaria no veículo, fotos e captura de assinatura do cliente.
4. [ ] **Execução & Cronômetro**:
   - Iniciar a execução do serviço, marcar itens do checklist e testar a pausa/conclusão do cronômetro.
5. [ ] **Finalização do Atendimento (Caixa)**:
   - Finalizar o atendimento concedendo um desconto em R$ ou %.
   - Selecionar pagamentos em Pix/Dinheiro e Cartão. Confirmar baixa no módulo Contas a Receber.
6. [ ] **Painel Administrativo (`/admin`)**:
   - Acessar com a conta Super Admin e verificar a listagem de oficinas e gestão de planos.

---

## 7. 🧹 Manutenção Automatizada & Expurgos (Post-Deploy)

- [ ] **Configurar Expurgos Automáticos**:
  - Garantir a ativação da retenção fotográfica (conforme `0052_retencao_expurgo_execucao_fotos.sql`) para expurgar automaticamente fotos antigas de execução conforme a política de armazenamento do plano contratado.
