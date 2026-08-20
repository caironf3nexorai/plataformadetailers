# Referência do Schema de Banco de Dados — Plataforma Detailers

> **Documento Oficial de Referência de Tabelas, Colunas, Restrições e Regras do Schema `public`**
> Toda nova função, RPC ou query no frontend/backend deve ser estritamente conferida contra este inventário real extraído do banco de dados Supabase.

---

## 1. Tabelas e Colunas por Área Funcional

### 1.1. Núcleo de Tenancy, Usuários e Planos

#### `public.profiles`
- `id` (uuid, primary key, references auth.users(id) on delete cascade)
- `nome` (text, not null default '')
- `telefone` (text, nullable)
- `created_at` (timestamptz, not null default now())

#### `public.tenants`
- `id` (uuid, primary key default gen_random_uuid())
- `nome` (text, not null)
- `slug` (text, unique, not null)
- `plano` (plan_code, not null default 'free')
- `telefone` (text, nullable)
- `cidade` (text, nullable)
- `uf` (text, nullable)
- `razao_social` (text, nullable)
- `documento` (text, nullable) -- CPF ou CNPJ limpo
- `documento_tipo` (text, nullable) -- 'cpf' ou 'cnpj'
- `logo_path` (text, nullable) -- Caminho do bucket 'catalogo'
- `capa_path` (text, nullable) -- Caminho da imagem de capa
- `grade_minutos` (smallint, default 60)
- `antecedencia_minima_horas` (integer, default 2)
- `agendamento_online_ativo` (boolean, default true)
- `agendamento_exige_confirmacao` (boolean, default false)
- `orcamento_agendamento_cliente` (boolean, default true)
- `orcamento_validade_dias` (integer, default 7)
- `politica_cancelamento` (text, nullable)
- `sinal_ativo` (boolean, default false)
- `sinal_tipo` (text, default 'percentual') -- 'percentual' ou 'fixo'
- `sinal_valor` (numeric(10,2), default 25.00)
- `sinal_obrigatorio` (boolean, default false)
- `pix_chave` (text, nullable)
- `pix_tipo` (text, nullable)
- `pix_nome_beneficiario` (text, nullable)
- `pix_cidade` (text, nullable)
- `criado_por` (uuid, not null, references auth.users(id))
- `created_at` (timestamptz, not null default now())
- `updated_at` (timestamptz, not null default now())

#### `public.tenant_members`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `user_id` (uuid, nullable, references auth.users(id) on delete set null)
- `email` (text, not null)
- `role` (app_role, not null default 'operador') -- 'dono', 'gerente', 'operador'
- `status` (member_status, not null default 'convidado') -- 'ativo', 'convidado', 'inativo'
- `convite_token` (uuid, default gen_random_uuid())
- `created_at` (timestamptz, not null default now())

#### `public.comissao_regras`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `member_id` (uuid, not null, references public.tenant_members(id) on delete cascade)
- `tipo` (comissao_tipo, not null default 'nenhuma') -- 'nenhuma', 'percentual', 'valor_fixo'
- `valor` (numeric(10,2), not null default 0)
- `vigencia_inicio` (date, not null)
- `vigencia_fim` (date, nullable)
- `criado_por` (uuid, not null, references auth.users(id))
- `created_at` (timestamptz, not null default now())

#### `public.plans`
- `codigo` (plan_code, primary key) -- 'free', 'pro', 'studio'
- `nome` (text, not null)
- `preco_centavos` (integer, not null default 0)
- `ativo` (boolean, not null default true)

#### `public.plan_limits`
- `plano` (plan_code, not null, references public.plans(codigo) on delete cascade)
- `recurso` (text, not null)
- `limite` (integer, nullable) -- null = ilimitado

#### `public.tenant_contadores`
- `tenant_id` (uuid, primary key, references public.tenants(id) on delete cascade)
- `proxima_os` (integer, not null default 1)
- `ultimo_marco_exibido` (integer, not null default 0)

#### `public.tenant_horarios_semana`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `dia_semana` (smallint, not null) -- 0 (Dom) a 6 (Sáb)
- `ativo` (boolean, not null default true)
- `abertura` (time, not null default '08:00')
- `fechamento` (time, not null default '18:00')
- `intervalo_inicio` (time, nullable)
- `intervalo_fim` (time, nullable)

#### `public.tenant_excecoes_horario`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `data` (date, not null)
- `fechado` (boolean, not null default false)
- `abertura` (time, nullable)
- `fechamento` (time, nullable)
- `motivo` (text, nullable)

---

### 1.2. Clientes e Veículos

#### `public.categorias_veiculo`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `nome` (text, not null) -- Ex: Hatch, Sedan, SUV, Picape
- `icone` (text, nullable)
- `ordem` (smallint, default 0)
- `ativo` (boolean, not null default true)
- `created_at` (timestamptz, not null default now())

#### `public.clientes`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `nome` (text, not null)
- `telefone` (text, nullable)
- `documento` (text, nullable) -- CPF ou CNPJ
- `documento_tipo` (text, nullable) -- 'cpf' ou 'cnpj'
- `email` (text, nullable)
- `endereco` (text, nullable)
- `bairro` (text, nullable)
- `cidade` (text, nullable)
- `uf` (text, nullable)
- `observacoes` (text, nullable)
- `origem` (text, not null default 'interno') -- CHECK ('interno', 'online')
- `created_at` (timestamptz, not null default now())

#### `public.veiculos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `cliente_id` (uuid, not null, references public.clientes(id) on delete cascade)
- `categoria_id` (uuid, nullable, references public.categorias_veiculo(id))
- `placa` (text, not null) -- UNIQUE (tenant_id, placa)
- `modelo` (text, not null)
- `marca` (text, nullable)
- `ano` (integer, nullable)
- `cor` (text, nullable)
- `observacoes` (text, nullable)
- `created_at` (timestamptz, not null default now())

---

### 1.3. Catálogo de Serviços e Combos

#### `public.servicos_modelo` (Modelos Padrão da Plataforma)
- `id` (uuid, primary key default gen_random_uuid())
- `nome` (text, not null)
- `grupo` (text, not null)
- `descricao_publica` (text, nullable)
- `codigo` (text, unique, not null)
- `modo_ocupacao` (text, not null default 'slot')
- `duracao_sugerida` (integer, not null default 60)
- `ordem` (integer, not null default 0)

#### `public.servicos` (Serviços da Oficina)
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `nome` (text, not null)
- `codigo` (text, nullable)
- `descricao` (text, nullable)
- `modo_ocupacao` (text, not null default 'slot') -- CHECK em ('slot', 'dias', 'hibrido', 'transborda')
- `dias_ocupacao` (integer, not null default 1)
- `imagem_path` (text, nullable)
- `exibir_catalogo` (boolean, not null default true)
- `tom` (text, nullable)
- `ativo` (boolean, not null default true)
- `created_at` (timestamptz, not null default now())

#### `public.servico_precos` (Guarda Preço e Duração por Categoria)
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `servico_id` (uuid, not null, references public.servicos(id) on delete cascade)
- `categoria_id` (uuid, not null, references public.categorias_veiculo(id) on delete cascade)
- `preco_base` (numeric(10,2), not null default 0)
- `duracao_minutos` (integer, not null default 60)
- `created_at` (timestamptz, not null default now())

#### `public.combos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `nome` (text, not null)
- `descricao` (text, nullable)
- `ativo` (boolean, not null default true)
- `created_at` (timestamptz, not null default now())

#### `public.combo_itens`
- `id` (uuid, primary key default gen_random_uuid())
- `combo_id` (uuid, not null, references public.combos(id) on delete cascade)
- `servico_id` (uuid, not null, references public.servicos(id) on delete cascade)

---

### 1.4. Agendamentos, Atendimento e Execução

#### `public.agendamentos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `cliente_id` (uuid, not null, references public.clientes(id))
- `veiculo_id` (uuid, not null, references public.veiculos(id))
- `numero_os` (integer, nullable)
- `inicio` (timestamptz, not null)
- `fim` (timestamptz, nullable)
- `previsao_entrega` (timestamptz, nullable)
- `modo_ocupacao` (text, nullable) -- Sem CHECK constraint
- `modo_ocupacao_efetivo` (text, nullable) -- Sem CHECK constraint
- `dias_ocupados` (integer, default 1)
- `duracao_total` (integer, nullable)
- `duracao_minutos` (integer, nullable)
- `status` (text, not null default 'agendado') -- CHECK ('agendado', 'aguardando_confirmacao', 'em_atendimento', 'concluido', 'cancelado')
- `origem` (text, not null default 'interno') -- CHECK ('interno', 'online', 'balcao', 'orcamento')
- `preco_estimado_total` (numeric(10,2), nullable)
- `sinal_pago` (numeric(10,2), default 0)
- `sinal_pendente` (boolean, default false)
- `sinal_txid` (text, nullable)
- `sinal_pix_payload` (text, nullable)
- `observacoes` (text, nullable)
- `consentimento_transbordo` (boolean, default false)
- `created_at` (timestamptz, not null default now())

#### `public.agendamento_itens`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `agendamento_id` (uuid, not null, references public.agendamentos(id) on delete cascade)
- `servico_id` (uuid, not null, references public.servicos(id))
- `combo_id` (uuid, nullable, references public.combos(id))
- `duracao_minutos` (integer, not null default 60)
- `preco_estimado` (numeric(10,2), not null default 0) -- Nota: NÃO existe 'preco_aplicado'
- `modo_ocupacao` (text, nullable)
- `dias_ocupados` (integer, default 1)
- `ordem` (smallint, default 0)

#### `public.execucoes`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `agendamento_id` (uuid, unique, not null, references public.agendamentos(id) on delete cascade)
- `status` (text, not null default 'em_andamento') -- CHECK ('em_andamento', 'pausado', 'finalizado', 'cancelado')
- `iniciado_em` (timestamptz, not null default now())
- `finalizado_em` (timestamptz, nullable)
- `duracao_segundos` (integer, not null default 0)
- `observacoes` (text, nullable)
- `created_at` (timestamptz, not null default now())

#### `public.execucao_itens`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `execucao_id` (uuid, not null, references public.execucoes(id) on delete cascade)
- `servico_id` (uuid, not null, references public.servicos(id))
- `combo_id` (uuid, nullable, references public.combos(id))
- `origem` (text, default 'agendamento') -- 'agendamento' ou 'avulso'
- `preco_estimado` (numeric(10,2), not null default 0)
- `duracao_minutos` (integer, not null default 60)
- `concluido` (boolean, not null default false)
- `concluido_em` (timestamptz, nullable)
- `created_at` (timestamptz, not null default now())

#### `public.execucao_valores`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `execucao_id` (uuid, unique, not null, references public.execucoes(id) on delete cascade)
- `valor_total_final` (numeric(10,2), not null default 0)
- `desconto` (numeric(10,2), default 0)
- `forma_pagamento` (text, nullable)
- `observacoes` (text, nullable)
- `registrado_em` (timestamptz, not null default now())

#### `public.execucao_executores`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `execucao_id` (uuid, not null, references public.execucoes(id) on delete cascade)
- `member_id` (uuid, not null, references public.tenant_members(id) on delete cascade)
- `created_at` (timestamptz, not null default now())

#### `public.execucao_fotos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `execucao_id` (uuid, not null, references public.execucoes(id) on delete cascade)
- `servico_id` (uuid, nullable, references public.servicos(id))
- `foto_path` (text, not null)
- `etapa` (text, not null default 'durante') -- CHECK ('antes', 'durante', 'depois')
- `created_at` (timestamptz, not null default now())

#### `public.checkins`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `agendamento_id` (uuid, not null, references public.agendamentos(id) on delete cascade)
- `km_entrada` (integer, nullable)
- `nivel_combustivel` (smallint, nullable) -- CHECK numérico de 0 a 8
- `observacoes_avarias` (text, nullable)
- `assinado_por` (text, nullable)
- `assinatura_path` (text, nullable)
- `finalizado` (boolean, not null default false)
- `created_at` (timestamptz, not null default now())

---

### 1.5. Estoque, Produtos e Despesas Fixas

#### `public.produtos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `nome` (text, not null)
- `categoria` (text, nullable)
- `marca` (text, nullable)
- `unidade_uso` (text, not null default 'ml') -- 'ml', 'g', 'un'
- `tamanho_compra` (numeric(10,2), not null default 1000)
- `preco_compra` (numeric(10,2), not null default 0)
- `estoque_minimo` (numeric(10,2), default 0)
- `quantidade_atual` (numeric(10,2), default 0)
- `custo_unitario_ml_g` (numeric(10,4), default 0)
- `created_at` (timestamptz, not null default now())

#### `public.execucao_consumos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `execucao_id` (uuid, not null, references public.execucoes(id) on delete cascade)
- `produto_id` (uuid, not null, references public.produtos(id))
- `quantidade_usada` (numeric(10,2), not null)
- `custo_calculado` (numeric(10,2), not null default 0)
- `created_at` (timestamptz, not null default now())

#### `public.estoque_movimentos`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `produto_id` (uuid, not null, references public.produtos(id) on delete cascade)
- `tipo` (text, not null) -- 'entrada', 'saida_manual', 'consumo_execucao', 'ajuste'
- `quantidade` (numeric(10,2), not null)
- `custo_unitario` (numeric(10,4), nullable)
- `observacao` (text, nullable)
- `created_at` (timestamptz, not null default now())

#### `public.despesas_fixas`
- `id` (uuid, primary key default gen_random_uuid())
- `tenant_id` (uuid, not null, references public.tenants(id) on delete cascade)
- `nome` (text, not null)
- `categoria` (text, not null default 'Geral') -- CHECK em ('Instalacao', 'Pessoal', 'Servicos', 'Impostos', 'Outros', 'Geral')
- `tipo` (text, not null default 'recorrente') -- CHECK em ('recorrente', 'parcelada', 'variavel')
- `valor_mensal` (numeric(10,2), not null default 0)
- `vigencia_inicio` (date, not null)
- `vigencia_fim` (date, nullable)
- `parcelas_total` (integer, nullable)
- `parcela_atual` (integer, nullable)
- `criado_por` (uuid, not null, references auth.users(id))
- `created_at` (timestamptz, not null default now())

---

## 2. Valores Permitidos (CHECK Constraints)

| Tabela | Coluna | Lista Literal de Valores Aceitos | Observação de Capitalização |
| :--- | :--- | :--- | :--- |
| `platform_admins` | `nivel` | `'admin'`, `'suporte'` | Tudo minúsculo |
| `clientes` | `origem` | `'interno'`, `'online'` | Tudo minúsculo |
| `servicos` | `modo_ocupacao` | `'slot'`, `'dias'`, `'hibrido'`, `'transborda'` | Tudo minúsculo |
| `agendamentos` | `status` | `'agendado'`, `'aguardando_confirmacao'`, `'em_atendimento'`, `'concluido'`, `'cancelado'` | Tudo minúsculo |
| `agendamentos` | `origem` | `'interno'`, `'online'`, `'balcao'`, `'orcamento'` | Tudo minúsculo |
| `execucoes` | `status` | `'em_andamento'`, `'pausado'`, `'finalizado'`, `'cancelado'` | Tudo minúsculo |
| `execucao_fotos` | `etapa` | `'antes'`, `'durante'`, `'depois'` | Tudo minúsculo |
| `checkins` | `nivel_combustivel` | `0, 1, 2, 3, 4, 5, 6, 7, 8` | Numérico de 0 a 8 |
| `despesas_fixas` | `categoria` | `'Instalacao'`, `'Pessoal'`, `'Servicos'`, `'Impostos'`, `'Outros'`, `'Geral'` | **Iniciais Maiúsculas OBRIGATÓRIAS** |
| `despesas_fixas` | `tipo` | `'recorrente'`, `'parcelada'`, `'variavel'` | Tudo minúsculo |

---

## 3. Chaves Únicas (UNIQUE Constraints)

| Tabela | Conjunto Único de Colunas | Efeito Prático de Negócio |
| :--- | :--- | :--- |
| `platform_admins` | `user_id` | Cada usuário `auth.users` só pode possuir um registro de admin de plataforma. |
| `tenants` | `slug` | O identificador da URL pública da oficina é único em toda a plataforma. |
| `veiculos` | `(tenant_id, placa)` | Impede cadastrar duas vezes a mesma placa dentro do mesmo tenant. |
| `servico_precos` | `(servico_id, categoria_id)` | Cada combinação de serviço e categoria de veículo possui exatamente 1 preço e 1 duração. |
| `agendamentos` | `(tenant_id, numero_os)` | Garante sequência única de Ordem de Serviço por oficina. |
| `agendamento_itens`| `(agendamento_id, servico_id)` | O mesmo serviço não pode ser repetido como item do mesmo agendamento. |
| `execucoes` | `agendamento_id` | Relação estritamente 1:1 entre Agendamento e Execução. |
| `execucao_valores` | `execucao_id` | Relação 1:1 para fechamento financeiro do atendimento. |
| `combo_itens` | `(combo_id, servico_id)` | Impede duplicação do mesmo serviço dentro de um combo. |
| `plan_features` | `(plano, feature)` | Cada feature é habilitada/desabilitada uma única vez por plano. |
| `storage_uso_snapshot` | `(tenant_id, bucket, calculado_em)` | Registra no máximo um snapshot por bucket/horário. |

---

## 4. Vocabulário Divergente

*   **Conclusão de Atendimento**:
    *   No Agendamento: `agendamentos.status = 'concluido'`.
    *   Na Execução: `execucoes.status = 'finalizado'`.
*   **Desconto Percentual**:
    *   Em Orçamentos: `orcamentos.desconto_tipo = 'porcentagem'`.
    *   Em Sinal / Tenancy: `tenants.sinal_tipo = 'percentual'`.
*   **Origem Balcão**:
    *   Em `clientes.origem`: aceita exclusivamente `'interno'` e `'online'`.
    *   Em `agendamentos.origem`: aceita `'interno'`, `'online'`, `'balcao'` e `'orcamento'`.

---

## 5. Armadilhas Conhecidas

1. **Placa de Veículos sem Normalização**: `veiculos` utiliza `UNIQUE (tenant_id, placa)` em texto cru. Se a placa for enviada como `"abc-1234"` e `"ABC1234"`, a restrição não atuará. A escrita deve sempre sanitizar e passar para caixa alta.
2. **Telefone de Clientes sem Restrição Única**: `clientes` não possui UNIQUE em `telefone`. A deduplicação no cadastro online exige obrigatoriamente consulta prévia por telefone/documento.
3. **Sem CHECK Constraint em Ocupação de Agendamentos**: `agendamentos.modo_ocupacao`, `modo_ocupacao_efetivo` e `agendamento_itens.modo_ocupacao` não possuem restrição CHECK no banco. Qualquer valor string inválido entra sem erro se não for sanitizado na RPC.
4. **Substituição Inválida de Nomes de Coluna**:
   * Utilizar `preco_aplicado` em vez de `preco_estimado` em `agendamento_itens` (provoca erro de coluna inexistente).
   * Procurar por `duracao_minutos` em `servicos` em vez de `servico_precos`.

---

## 6. Ritual de Conferência de Schema

Antes de criar qualquer SQL ou RPC, execute no SQL Editor do Supabase:

```sql
-- 1. Colunas, tipos, nulidade e defaults
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 2. CHECKs e chaves únicas
select conrelid::regclass as tabela, conname, pg_get_constraintdef(oid) as definicao
from pg_constraint
where connamespace = 'public'::regnamespace and contype in ('c', 'u')
order by 1, 2;

-- 3. Funções existentes
select p.oid::regprocedure as assinatura, p.prosecdef as security_definer,
       pg_get_function_result(p.oid) as retorno
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by 1;
```

> [!IMPORTANT]
> **Nota de Auditoria**: A Query 1 (`information_schema.columns`) **NÃO REVELA** restrições CHECK nem UNIQUE. Depender apenas da Query 1 foi o que causou a falha histórica no default e CHECK de `clientes.origem`. As três queries devem ser executadas em conjunto.

---

## 7. Pendências e Suspeitas de Inconsistência

1. `agendamentos.modo_ocupacao` e `agendamento_itens.modo_ocupacao`: Ausência de CHECK constraint no banco. (Recomenda-se adicionar constraint em futura passada).
2. `clientes.origem`: O default de banco original era `'modelo'`/`'balcao'`, incompatível com a CHECK constraint `'interno'/'online'`. (Corrigido na Migração `0049` para default `'interno'`).
