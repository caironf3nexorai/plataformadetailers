# Design System & Diretrizes de UI/UX - Plataforma Detailers

## 1. Regra Permanente: Isolamento de Termos Técnicos

> [!IMPORTANT]
> **Nenhum identificador interno, nome de tabela, nome de coluna, valor de enum cru ou rota deve aparecer em texto voltado ao usuário final.**
> 
> Toda exibição de status, tipo, modo de ocupação ou rota de tela DEVE obrigatoriamente passar pelos dicionários e formatadores centrais:
> - `src/utils/rotulos.ts` (`formatarRotulo` / `formatarTermoTecnico`)
> - `src/utils/nomesDeTela.ts` (`obterNomeDaTela`)
> - `src/utils/erros.ts` (`traduzirErro`)

### Recomendações Práticas
1. **Valores de Enum**:
   - ❌ NUNCA renderizar strings crus como `'em_andamento'`, `'nao_aplicavel'`, `'valor_fixo'`.
   - ✅ SEMPRE utilizar `formatarRotulo(status)` para garantir rótulos padronizados em português ("Em andamento", "Não se aplica", "Valor fixo").

2. **Substituição da palavra "Tenant"**:
   - Na interface do usuário final, a palavra `tenant` NUNCA deve ser exibida. Utilize **"Oficina"** ou **"Estabelecimento"**.

3. **Nomes de Tabela e Coluna**:
   - ❌ NUNCA exibir `clientes`, `veiculos`, `execucoes`, `agendamento_itens`, `user_id`.
   - ✅ Utilize rótulos compreensíveis para o dono da oficina ("Clientes", "Veículos", "Ficha de Atendimento").

4. **Identificadores Longos (UUIDs)**:
   - ❌ NUNCA exibir UUIDs crus (`7eab290d-a525-4a55-bb8b-c4f4227da698`) em listagens ou modais do usuário.
   - ✅ Exiba o Nome do Cliente, a Placa do Veículo ou o Número da OS. Se um ID for estritamente necessário para suporte, exiba apenas a referência curta (ex: `Ref: ERR-7K3F`).

5. **Nomes de Tela em Feedbacks e Navegação**:
   - ❌ NUNCA exibir a URL crua `/clientes/7eab290d-a525-4a55-bb8b-c4f4227da698` na interface visual.
   - ✅ Utilize a função `obterNomeDaTela(pathname)` para exibir "Ficha do cliente". O backend continua gravando a URL completa para fins de depuração do suporte.

---

## 2. Paleta de Cores e Identidade Visual (Cabine de Inspeção)

- **Fundo / Base**: Dark Mode industrial (`#0B0E14`, `#121721`, `#19202D`)
- **Destaque Primário**: Amber Accent (`#F59E0B` / `amber-500`)
- **Sucesso / Lucro**: Mint Green (`#10B981` / `mint-400`)
- **Erros / Alertas**: Flare Red (`#EF4444` / `flare-400`)
- **Tipografia**: Outfit / Inter para títulos e corpo; JetBrains Mono apenas para valores financeiros e códigos numéricos formatados.
