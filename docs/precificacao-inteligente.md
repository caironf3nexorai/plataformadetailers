# Módulo de Precificação Inteligente & Margem Real

O **Módulo de Precificação Inteligente** da Plataforma Detailers permite que oficinas de estética automotiva calculem o preço ideal de seus serviços com base em custos reais de produção (hora da oficina, insumos e comissões) e comparem seus preços com faixas de referência de mercado praticadas por porte de cidade e região.

---

## 1. Fronteira entre cálculo e IA no módulo de precificação

> [!IMPORTANT]
> **Princípio da Determinabilidade Financeira:**
> 1. **Determinismo Total dos Preços:** O valor do preço sugerido ou alvo (`preco_alvo`) é **sempre calculado de forma determinística** a partir do custo real do tenant (`custo_hora_atual`, tempo de execução, insumos/produtos e comissão) e da margem alvo configurada (`margem_alvo_percentual`).
> 2. **Papel Restrito da IA:** A IA **nunca produz ou inventa o número do preço**. O papel da IA é exclusivamente explicar a composição dos custos, contextualizar o posicionamento de mercado e aconselhar o gestor sobre um número que já foi calculado matematicamente.
> 3. **Curadoria de Mercado Assíncrona:** A pesquisa de mercado é uma **rotina mensal do lado do administrador da plataforma**, com revisão humana antes de publicar na tabela `servico_modelo_referencia`. Ela **nunca** é uma busca externa ou chamada de API executada pelo usuário final em tempo de execução.

---

## 2. Arquitetura de Dados

### 2.1 Configurações do Tenant (`tenants`)
- `porte_cidade`: Define o porte do município da oficina (`interior`, `capital`, `metropolitana`, `nacional`).
- `margem_alvo_percentual`: Margem de lucro operacional almejada pelo tenant (padrão: 40%).
- `custo_hora_calculado`: Custo real por hora produtiva calculado a partir das despesas fixas e capacidade produtiva da oficina.

### 2.2 Serviços Modelo e Mapeamento (`servicos_modelo` e `servicos`)
- `servico_modelo_codigo`: Identificador padrão global (ex: `LV-01` para Lavagem Simples, `PL-01` para Polimento Comercial).
- `servico_modelo_referencia`: Tabela com faixas de mercado (P25 - P75) curadas e agregadas:
  - `servico_modelo_codigo`: Código do serviço modelo.
  - `categoria_nome`: Categoria padrão (Hatch, Sedan, SUV, Caminhonete, Moto).
  - `porte_cidade`: Porte da cidade para regionalização do benchmark.
  - `preco_min`: Limite inferior da faixa praticada (P25).
  - `preco_max`: Limite superior da faixa praticada (P75).
  - `fonte`: Indica a origem dos dados (`plataforma` para curadoria manual ou `comunidade` para agregação anonimizada).
  - `amostra`: Quantidade de oficinas amostradas.

---

## 3. Lógica Determinística de Cálculo

Para cada combinação de serviço e categoria de veículo, a RPC `obter_matriz_precificacao_tenant` calcula:

$$\text{Custo de Estrutura} = \left(\frac{\text{Duração em Minutos}}{60}\right) \times \text{Custo da Hora do Tenant}$$

$$\text{Custo Total} = \text{Custo de Estrutura} + \text{Custo de Insumos/Produtos} + \text{Custo de Comissão}$$

$$\text{Preço Alvo Sugerido} = \frac{\text{Custo Total}}{1 - \left(\frac{\text{Margem Alvo \%}}{100}\right)}$$

$$\text{Margem Real Atual \%} = \left(\frac{\text{Preço Atual} - \text{Custo Total}}{\text{Preço Atual}}\right) \times 100$$

### Categorização dos Diagnósticos de Precificação:
1. `prejuizo`: Preço Atual < Custo Total. (Venda com perda operacional direta).
2. `abaixo_alvo`: Preço Atual $\ge$ Custo Total, porém Margem Actual < Margem Alvo.
3. `custo_alto`: Custo de Estrutura representa mais de 70% do Custo Total.
4. `premium`: Preço Atual > Limite Superior de Mercado (`preco_max`).
5. `sem_referencia`: Servicio cadastrado sem vínculo a um `servico_modelo_codigo` ou sem faixa de mercado para a categoria/porte.
6. `ok`: Preço dentro da margem alvo e alinhado ao mercado.

---

## 4. Curadoria de Referências de Mercado (Painel Admin)

A curadoria é gerenciada em `/admin/referencias-preco` pela equipe da plataforma:
1. **Revisão Manual / Plataforma:** Admins podem inserir ou alterar faixas diretas por serviço modelo, categoria e porte de cidade.
2. **Agregação da Comunidade (Background Job):** A RPC `atualizar_referencias_comunidade` roda mensalmente via `pg_cron`, calculando o P25 e P75 dos preços reais praticados pelas oficinas ativas na plataforma (com mínimo de 5 amostras por combinação).

---

## 5. Reajuste Rápido e Atualização em Lote

As alterações de preço pela oficina são efetuadas pela RPC `aplicar_precos_sugeridos`:
- Aceita um vetor de pares `{ servico_preco_id, novo_preco }`.
- Atualiza atomicamente a tabela `servico_precos`.
- Opcionalmente aceita aplicação em massa dos preços sugeridos de todos os serviços com diagnóstico `prejuizo` ou `abaixo_alvo`.
