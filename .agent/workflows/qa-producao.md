---
description: Protocolo obrigatório de Agente de Verificação (QA de Produção) antes de qualquer entrega, commit ou deploy
---

# 🛡️ Protocolo Obrigatório de QA de Produção

Nenhuma entrega de funcionalidade, refatoração, migration ou hotfix pode ser considerada concluída apenas com `vite build`. Antes de declarar conclusão ou realizar deploy em produção (ambiente com usuários reais e tráfego pago ativo), o agente **DEVE** executar todos os 4 blocos de verificação abaixo e apresentar o **Relatório de Evidências de QA** ao usuário.

---

## 1. Verificação Estática, Lint, Testes e Build
Execute e confirme saída com `exit code 0`:
1. **Typecheck estrito:**
   ```bash
   npx tsc --noEmit
   ```
   - Zero erros de TypeScript.
2. **Linter nos arquivos tocados:**
   ```bash
   npx oxlint <arquivos_modificados_ou_criados>
   ```
   - Zero erros, zero imports órfãos e zero variáveis não utilizadas no código alterado.
3. **Testes automatizados (Vitest):**
   ```bash
   npm test -- --run
   ```
   - 100% dos testes passando; adicionar novos testes unitários sempre que criar ou alterar regras de negócio puras (cálculos financeiros, datas, permissões, validações).
4. **Build de produção completo:**
   ```bash
   npm run build
   ```
   - Zero erros em `tsc -b && vite build`.

---

## 2. Auditoria de Banco de Dados, Anti-PGRST203 e Contrato SQL ↔ TypeScript
*(Obrigatório sempre que houver migration SQL, RPC, view, trigger ou alteração de schema)*

1. **Zero Sobrecarga de RPC (Proteção Anti-PGRST203):**
   - Ao alterar a assinatura de qualquer função SQL existente, faça `DROP FUNCTION IF EXISTS` explícito de todas as assinaturas anteriores dentro da **mesma transação `BEGIN; ... COMMIT;`** antes do `CREATE OR REPLACE FUNCTION`, ou preserve exatamente a mesma assinatura lendo novos campos via JSONB.
   - Inclua no final da migration um bloco `DO $$ ... $$` auditando `pg_proc` que aborte a transação caso alguma função alterada tenha `count(*) > 1`:
     ```sql
     SELECT p.proname, count(*) AS assinaturas
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (<funcoes_alteradas>)
     GROUP BY p.proname
     HAVING count(*) > 1;
     ```
2. **Alinhamento 1:1 de Contrato SQL ↔ TypeScript:**
   - Compare linha a linha cada chave retornada no JSONB/Table da RPC com as interfaces TypeScript e chamadas `supabase.rpc(...)` no Front-end.
   - Confira nomes exatos de parâmetros (`p_*`) e colunas reais nas tabelas (nunca assumir nomes de colunas sem conferir o schema nas migrations).
3. **Blindagem de Datas e Timezone:**
   - Cálculos de vencimento mensal a partir de dia (1–31) devem sempre usar `LEAST(dia, ultimo_dia_mes)` para evitar erro `date out of range` em fevereiro e meses de 30 dias.
   - Usar fuso horário do tenant (`obter_fuso_tenant`) no banco e data local (não UTC) no front-end para chaves diárias e filtros de "hoje".

---

## 3. Auditoria de Matriz de Permissões, RLS e Navegação
1. **Consistência em 3 Camadas (Rota → Componente UI → RLS/RPC no Postgres):**
   - Valide a matriz completa para cada perfil envolvido:
     - **`dono`:** acesso integral.
     - **`gerente` com flag granular ativa** (ex.: `pode_gerenciar_despesas = true`): acesso liberado em UI, RLS e RPCs.
     - **`gerente` sem flag / legado (`false`):** bloqueado silenciosamente na UI (elementos ocultos/tela amigável) **e** bloqueado no Postgres (RLS + RPCs não retornam/vazam dados sensíveis).
     - **`operador`:** bloqueado nas rotas gerenciais (`RotaProtegida`) e no banco.
   - Verifique proteção contra escalação de privilégios em tabelas de vínculo (`tenant_members`).
2. **Correspondência Exata de Rotas:**
   - Confirme que todo `navigate(...)` e `<Link to="...">` adicionado ou alterado possui rota correspondente exata em `src/App.tsx` e rótulo mapeado em `TopBar.tsx` quando aplicável.

---

## 4. Teste de Regressão e "Null Safety" (Dados Legados em Produção)
- Simule o comportamento com registros que **já existem em produção** antes da mudança (ex.: `dia_vencimento = NULL`, `forma_tipo = NULL`, `valor_liquido = NULL`, `maquininha_id = NULL`, `pode_gerenciar_despesas = false/undefined`, ausência de registro em tabelas filhas).
- Garanta uso defensivo de Optional Chaining (`?.`), Nullish Coalescing (`??`) e fallbacks para que **nenhum dado legado cause tela branca** (`Cannot read properties of undefined`).

---

## 5. Formato Obrigatório do Relatório de Evidências
Ao concluir a tarefa, entregue ao usuário uma seção **Relatório de Evidências de QA** contendo:
1. Tabela com resultados dos 4 comandos da Seção 1 (`tsc`, `oxlint`, `vitest`, `build`).
2. Confirmação de Anti-PGRST203 e alinhamento 1:1 de contratos RPC (se aplicável).
3. Confirmação da Matriz de Permissões/RLS e rotas verificadas.
4. Confirmação de Null Safety para registros legados.
5. Lista exata de arquivos modificados/criados prontos para commit e deploy.
