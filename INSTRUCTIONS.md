# Diretrizes Permanentes do Projeto — Plataforma Detailers

## 📱 REGRA PERMANENTE DO PROJETO — MOBILE-FIRST

Toda alteração de interface, em qualquer módulo, **deve funcionar em 375px de largura antes de ser considerada pronta**. Isso vale para correções pequenas, não só para telas novas.

---

### 📋 Checklist Obrigatório em Cada Mudança de UI:

1. **Sem Transbordo Horizontal**: Nenhum elemento pode transbordar horizontalmente. Nada de scroll lateral na página (`overflow-x-hidden`, `max-w-full`).
2. **Quebra de Texto Legível**: Textos quebram em duas linhas (`line-clamp-2`, `break-words`, `leading-snug`) em vez de truncar bruscamente com `...`.
3. **Alvos de Toque Adequados**: Alvos de toque de no mínimo 48px (56px nas telas operacionais: vistoria, execução, checklist).
4. **Layout Adaptável**: Tabelas viram listas empilhadas no mobile; colunas lado a lado viram abas selecionáveis ou empilhamento vertical.
5. **Painéis Fixos e Respiro**: Painéis fixos respeitam `safe-area-inset-bottom` e a barra de navegação (`bottom-[64px] lg:bottom-0`), com `pb-40` ou mais no container de conteúdo para nunca cobrir o último item da lista.
6. **Modais Seguros**: Modais com `max-height` e rolagem interna (`overflow-y-auto`), impedindo que conteúdo seja cortado em telas pequenas.
7. **Estilização de Selects**: Nenhum select nativo sem `appearance-none` e cores do design system (previne o fundo branco padrão do iOS Safari).
8. **Campos Numéricos Unificados (`CampoNumerico`)**: Todo campo numérico, financeiro, de taxa, quantidade ou capacidade DEVE obrigatoriamente usar `<CampoNumerico />` (`src/components/ui/CampoNumerico.tsx`), garantindo seleção completa ao focar, marca-d'água de zero em cinza, formato PT-BR com vírgula e imunidade ao scroll do mouse.
9. **Descoberta sem Hover**: Nenhuma ação ou informação crítica depende de *hover* para ser descoberta (compatível com telas de toque).

---

### ⚙️ Regras Arquiteturais e de Negócio

1. **Roteamento Centralizado de Atendimentos**:
   - Toda navegação para a ficha do atendimento **DEVE** utilizar o helper `navegarParaAtendimento(navigate, execucaoId, agendamentoId)`. Nunca montar URLs manuais para evitar o bug de rota `/atendimento/undefined`.

2. **Matriz de Preços e Categorias de Veículos**:
   - As consultas de catálogo e orçamento lêem prioritariamente a tabela `servico_precos` por `categoria_id`, com fallback em `matriz_precos` e `servicos.preco_base`.
   - Se a categoria do veículo não possuir preço cadastrado, exibir obrigatoriamente a mensagem **`"Preço não cadastrado para esta categoria"`** em `amber-500` (nunca mostrar `R$ 0,00`, que sugere serviço gratuito).

3. **Orçamento em 3 Níveis (Escada de Valor)**:
   - A seleção segue a regra de herança automática (*upsell*):
     - **Essencial**: Inclui o serviço básico e replica para **Recomendado** e **Completo**.
     - **Recomendado**: Inclui itens intermediários e replica para **Completo**.
     - **Completo**: Pacote premium completo.

4. **Verificação de Compilação e Testes**:
   - Antes de considerar qualquer tarefa pronta, executar:
     - `npm run build`
     - `npx vitest run`

---

### 🔍 Relatório de Verificação Obrigatório

Antes de concluir qualquer tarefa de UI, testar e reportar explicitamente os 3 breakpoints:
- [x] **375px** (Mobile)
- [x] **768px** (Tablet)
- [x] **1440px** (Desktop)
