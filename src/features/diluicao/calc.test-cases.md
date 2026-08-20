# Matriz de Casos de Teste - Calculadora de Diluição (`calc.ts`)

Esta tabela documenta as entradas de teste esperadas e os resultados calculados pelas funções puras em `calc.ts`.

| Modo | Entrada | Convenção | Calibração | Esperado | Status / Observação |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Manual** | Volume: 1 L (1000 mL)<br>Diluição: 1:10 | Partes de água | N/A | `90,9 mL` produto<br>`909,1 mL` água | **Válido** (`1000 / 11 = 90.909...`) |
| **Manual** | Volume: 1 L (1000 mL)<br>Diluição: 1:10 | Partes totais | N/A | `100,0 mL` produto<br>`900,0 mL` água | **Válido** (`1000 / 10 = 100.0`) |
| **Lavadora** | Vazão: 7 L/min<br>Pote: 1 L (1000 mL)<br>Alvo: 1:10 | Partes de água | Não (Estimado)<br>Reg. Fechado | `produto >= 980 mL` | **Aviso Diluição Inatingível** (`flare-400`). Sucção ≈ 9,1%, produto calculado ≈ 1000 mL >= 98% do pote |
| **Lavadora** | Vazão: 7 L/min<br>Pote: 1 L (1000 mL)<br>Alvo: 1:100 | Partes de água | Não (Estimado)<br>Reg. Fechado | `108,9 mL` produto<br>`891,1 mL` água | **Válido** (`potRatio` ≈ 1:8,1) |
| **Lavadora** | Vazão: 420 L/h (7 L/min)<br>Pote: 1 L (1000 mL)<br>Alvo: 1:100 | Partes de água | Sim<br>Sumiu: 480 mL<br>Saiu: 5400 mL | `sucção 8,9%` no rodapé | **Válido** (`480 / 5400 = 8.888...% ≈ 8,9%`) |
| **Lavadora** | Vazão: 7 L/min<br>Reg. Parcialmente Aberto | Partes de água | Não | Mensagem de aviso | **Bloqueado** (`status: 'uncalibrated_open'`). Exige calibração. |
| **Lavadora** | Vazão: 7 L/min<br>Sumiu: 3000 mL<br>Saiu: 5000 mL | Partes de água | Sim | Mensagem de erro | **Bloqueado** (`status: 'calibracao_invalida'`). `f = 0.6 >= 0.5` (campos trocados). |
