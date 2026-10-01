# 🚀 Manual Operacional e Guia de Domínio da Plataforma NuvemWash
> **Documento Estratégico e Operacional para Sócios, Diretores e Gestores**  
> *Versão:* 2.0 (Atualizada com Módulo Fiscal, Radar Financeiro, Termos de Risco e Limites de Planos)

---

## 🎯 1. Visão Geral e Proposta de Valor

O **NuvemWash** é um ecossistema completo de gestão (ERP + CRM) verticalizado exclusivamente para o segmento de **Estética Automotiva, Lava-Rápidos Premium e Detailers**.

### Por que o mercado precisa do NuvemWash?
1. **Fim do "Caderninho" e WhatsApp Desorganizado:** Centraliza agendamento, clientes, histórico de veículos e orçamentos em um só lugar.
2. **Blindagem Jurídica:** Vistoria de entrada (Check-in) com fotos de avarias pré-existentes, assinatura digital na tela e Termos de Responsabilidade/Risco que evitam processos e prejuízos com clientes de má-fé.
3. **Aumento de Ticket Médio:** Orçamentos profissionais interativos em 3 níveis (Essencial, Recomendado, Premium) com taxa média de conversão 40% maior.
4. **Visão Financeira Real:** Diferencia faturamento bruto de lucro líquido, descontando automaticamente as taxas de cartão de crédito/débito e comissões dos operadores.

---

## 👥 2. Os Níveis de Acesso na Plataforma

O sistema foi desenhado para proteger os dados mais sensíveis da empresa através de papéis bem definidos:

1. **Dono (`dono`):**
   - Acesso total e irrestrito.
   - Gerencia faturamento, DRE, retiradas, configurações fiscais (NFS-e), precificação, comissões e assinaturas.
2. **Operador (`operador`):**
   - Focado na execução física da oficina.
   - Acessa apenas a **Agenda**, o painel de **Hoje**, **Check-in**, **Execução de Serviços**, **Calculadora de Diluição** e **Biblioteca de Treinamentos**.
   - **Restrições estritas:** Não visualiza o módulo Financeiro, relatórios de lucro, Radar de Fiados, configurações bancárias ou faturamento da loja.
3. **Administrador da Plataforma (`super_admin` / `admin`):**
   - Vocês (fundadores). Acesso via rota `/admin` para monitorar todas as oficinas, assinaturas Asaas, uso de storage, limites e catálogo de features.

---

## 🔄 3. O Fluxo Operacional de Ponta a Ponta (O Ciclo do Carro)

Para ensinar clientes ou treinar equipes, você deve ter na ponta da língua as 5 etapas que um veículo percorre no sistema:

```
[ 1. Captação ] ──▶ [ 2. Recepção ] ──▶ [ 3. Execução ] ──▶ [ 4. Entrega ] ──▶ [ 5. Pós-Venda ]
  Agendamento         Check-in 360º       Cronômetro          Baixa no Caixa      Garantia Digital
  Online / Bio       Fotos Avarias       Uso de Produtos     Emissão NFS-e       Radar de Fiados
  ou WhatsApp         Assinatura          Fotos Processo      PDF de Saída        Cobrança Zap
```

### Etapa 1: Captação e Agendamento
- **Origem:** O cliente pode agendar sozinho pelo **Link Público de Agendamento** (colocado na bio do Instagram da oficina) ou o dono/recepção agenda manualmente pelo menu **Agenda**.
- **Regras:** 
  - O sistema impede agendamentos em horários já ocupados respeitando o tempo de execução do serviço.
  - No plano Pro/Studio, a oficina pode cobrar um **Sinal antecipado por Pix** para segurar a vaga e zerar o "no-show" (clientes que faltam).

### Etapa 2: Recepção (Check-in e Vistoria com Blindagem Jurídica)
- **Menu:** `Hoje` ou `Agenda` ➔ Botão **Iniciar Check-in**.
- **Ações:**
  1. Identificação do veículo (Placa, Modelo, Categoria) e quilometragem/combustível.
  2. Diagrama interativo de avarias: marcação de riscos, amassados, trincas de vidro, rodas raladas.
  3. Fotos comprobatórias com expurgo automático planejado.
  4. Seleção de **Termos de Risco** se aplicável (ex: repintura antiga com verniz descascando, motor lavado por conta e risco do cliente).
  5. **Assinatura Digital:** O cliente assina na tela do celular/tablet com o próprio dedo.
  6. Envio instantâneo do comprovante em PDF com link no WhatsApp do cliente.

### Etapa 3: Execução e Controle de Chão de Oficina
- **Menu:** `Execução`.
- **Ações:**
  - O operador inicia o cronômetro do serviço para medir tempo real de trabalho.
  - Pode abrir a **Calculadora de Diluição** para saber quantos ml de produto e água colocar no borrifador ou Snow Foam (evita desperdício de químicos caros).
  - Tira fotos do "Durante" e "Depois" para o relatório de entrega e portfólio.

### Etapa 4: Entrega do Veículo e Cobrança
- **Menu:** `Execução` ➔ Botão **Finalizar Atendimento**.
- **Ações:**
  - A cota mensal de atendimentos da oficina **só é consumida aqui** (atendimentos finalizados).
  - Lançamento do pagamento: Dinheiro, Pix, Débito, Crédito (com taxa calculada) ou **Fiado** (gera conta a receber).
  - **Emissão Fiscal (NFS-e Focus):** Se a oficina tiver Pro/Studio e certificado configurado, emite a nota fiscal de serviço em 3 segundos com 1 clique, gerando o PDF e XML oficial da prefeitura.

### Etapa 5: Pós-Venda, Garantia e Cobrança de Fiados
- **Radar Financeiro do Dia (`/financeiro`):** Lista todos os clientes com pagamentos em atraso ou que venceram hoje. Com 1 clique no botão de WhatsApp, o sistema abre uma mensagem personalizada amigável de cobrança com a chave Pix da oficina.
- **Certificado de Garantia:** Emissão de certificado digital para vitrificações, polimentos e proteções de pintura com prazo e cuidados de manutenção.

---

## 📊 4. Entendendo a Lógica dos Planos (Free, Pro e Studio)

Para responder dúvidas comerciais e guiar o cliente na escolha certa, use esta tabela mental:

| Plano | Preço Sugerido | Teto Atendimentos/Mês | Carteira Clientes | Notas Fiscais | Diferencial Decisivo de Venda |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Free** | R$ 0 | **15 finalizados** | **20 clientes** | Zero | **Isca de Entrada:** Ganha o link de agendamento online e o check-in com assinatura. Bate no teto em 2 semanas se a oficina for ativa. |
| **Pro** | R$ 79 a R$ 97 | **150 finalizados** | **350 clientes** | **15 notas/mês** | **O Plano Essencial:** Destrava o Financeiro com DRE, Radar de Fiados no Zap, Sinal Pix, Estoque e 3 usuários de equipe. |
| **Studio** | R$ 147 a R$ 197 | **500 finalizados** | **Ilimitado** | **60 notas/mês** | **Para Grandes Centros:** Múltiplos executores dividindo a mesma OS, Robô de Lembretes WhatsApp e 10 operadores. |

---

## 🛠️ 5. Painel Master Admin (`/admin`) – Como Operar

Como sócio, você tem acesso ao painel de controle global da plataforma:

1. **Gestão de Oficinas (`/admin/oficinas`):**
   - Ver todas as estéticas cadastradas, plano ativo, status da assinatura no Asaas e volume de atendimentos realizados.
   - Possibilidade de mudar o plano manualmente para testes ou suporte VIP.
2. **Gestão de Planos e Limites Dinâmicos (`/admin/planos`):**
   - Alterar preços em reais, habilitar/desabilitar features e mudar números de tetos (atendimentos, clientes, fotos) sem precisar programar nada.
3. **Gestão de Cupons e Campanhas (`/admin/cupons`):**
   - Criar cupons promocionais de lançamento (ex: `PRIMEIROMES50` para 50% de desconto ou dias de trial estendidos).
4. **Monitoramento de Storage (`/admin/storage`):**
   - Acompanha o peso total das fotos no bucket do Supabase para garantir que o consumo continue dentro dos limites saudáveis.

---

## 💡 6. Dicas para Demonstrações Comerciais (Como Fazer o Dono se Apaixonar)

Quando você for apresentar a plataforma para um cliente potencial, **não mostre telas estáticas**. Siga este roteiro de 5 minutos:

1. **Minuto 1:** Abra a tela de **Check-in** no seu próprio celular. Mostre o carro na tela, marque 1 risco na porta, assine com o dedo e mostre o PDF saindo na hora. O detailer pira nessa hora porque isso evita que ele pague R$ 1.500 de pintura por um risco que o cliente já trouxe.
2. **Minuto 2:** Mostre o **Orçamento em 3 Níveis** com link público. Explique como isso faz o cliente dele sair da lavagem de R$ 80 e comprar o polimento de R$ 600.
3. **Minuto 3:** Mostre o **Radar de Fiados**. Fale: *"Sabe aquele cliente que te deve R$ 300 há 1 mês? Aqui você clica em um botão e ele já recebe a cobrança educada com sua chave Pix no WhatsApp"*.
4. **Minuto 4:** Mostre a **Calculadora de Diluição**. Nenhum outro software tem isso nativo. É a linguagem do detailer.
5. **Minuto 5:** Fechamento: *"Você testa no Free agora ou já entra no Pro para liberar o financeiro e o sinal por Pix?"*.
