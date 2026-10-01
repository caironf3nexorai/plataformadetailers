# 🏎️ NUVEMWASH — BÍBLIA MESTRE DE PRODUTO, DESIGN SYSTEM & GUIA OPERACIONAL DEFINITIVO

> **Documento Oficial de Engenharia, Identidade de Marca, Manual de Operação e Feedstock para Inteligência Artificial**  
> **Destinatários:** Sócios-Fundadores, Equipe de Produto, Treinadores, Designers de UI/UX e **Motores de IA Generativa (Midjourney v6, Flux, Stable Diffusion, Claude 3.7 Sonnet, ChatGPT/GPT-4o, Figma AI, Galileo AI, v0)**  
> **Versão:** 5.0 Definitiva Master  
> **Finalidade Dupla:**  
> 1. Servir de **Guia Operacional Completo** para que os sócios dominem cada clique, saibam como operar a plataforma do zero, como configurar a oficina e como treinar os clientes.  
> 2. Servir de **Prompt Mestre de Design & Arquitetura** para alimentar IAs com tokens, regras visuais, vocabulário do nicho e fluxos de telas sem deixar nenhuma ponta solta.

---

## 🧭 SUMÁRIO GERAL

1. [Manifesto de Produto & O Arquétipo da Marca NuvemWash](#1-manifesto-de-produto--o-arquétipo-da-marca-nuvemwash)
2. [Design System & Tokens Visuais Oficiais (Para Alimentação de IAs)](#2-design-system--tokens-visuais-oficiais-para-alimentação-de-ias)
3. [Dicionário Semântico & Universo Técnico do Detailer Automotivo](#3-dicionário-semântico--universo-técnico-do-detailer-automotivo)
4. [Anatomia Detalhada de Cada Tela da Plataforma (Especificação UI/UX)](#4-anatomia-detalhada-de-cada-tela-da-plataforma-especificação-uiux)
   - 4.1. Landing Page Institucional & Hero de Alta Conversão (`/`)
   - 4.2. Fluxo de Autenticação, Onboarding & Degustação de 15 Dias (`/login`, `/cadastro`)
   - 4.3. Dashboard Principal Cockpit (`/`)
   - 4.4. Agenda Inteligente & Gestão de Pátio "Hoje" (`/agenda`, `/hoje`)
   - 4.5. Check-in 360º com Vistoria Vetorial e Assinatura Touch (`/checkin`)
   - 4.6. Motor de Orçamentos de Elite em 3 Níveis & Minuta Jurídica do Advogado (`/orcamento/novo`)
   - 4.7. Portal Público de Aprovação do Cliente (`/orcamento/:token`)
   - 4.8. Chão de Oficina: Cronômetro de Telemetria & Calculadora de Diluição (`/ordem-servico/:id`)
   - 4.9. Painel Financeiro: DRE em Tempo Real & Radar de Cobrança WhatsApp (`/financeiro`)
   - 4.10. Motor Fiscal Integrado & Emissão de NFS-e Focus NFe (`/financeiro/fiscal`)
   - 4.11. "Minha Oficina": Configurações, Matriz de Preços 2D & Equipe (`/configuracoes`)
   - 4.12. Cockpit Master Admin SaaS (`/admin`)
5. [Guia Operacional Passo a Passo: Como Fazer Cada Ação na Prática (Clique a Clique)](#5-guia-operacional-passo-a-passo-como-fazer-cada-ação-na-prática-clique-a-clique)
   - 5.1. Primeiro Acesso: Setup da Oficina, Logo e Horários (`/configuracoes`)
   - 5.2. Como Cadastrar a Matriz de Preços 2D por Porte de Veículo
   - 5.3. Como Cadastrar a Equipe e Bloquear Acesso ao Financeiro
   - 5.4. Como Fazer uma Vistoria & Check-in 360º na Chegada do Carro (`/checkin`)
   - 5.5. Como Criar e Disparar Orçamentos em 3 Níveis com a Minuta do CDC (`/orcamento/novo`)
   - 5.6. A Experiência do Cliente Final: Como ele Aprova, Assina e Paga o Sinal
   - 5.7. Como Operar o Chão de Oficina: Cronômetro e Calculadora de Diluição
   - 5.8. Como Finalizar a OS, Emitir a NFS-e e Visualizar o DRE Real
   - 5.9. Como Usar o Radar de Cobrança WhatsApp para Eliminar Fiados
   - 5.10. Como os Sócios Operam o Painel Master Admin SaaS (`/admin`)
6. [Matriz Oficial de Planos, Limites e Gatilhos de Monetização](#6-matriz-oficial-de-planos-limites-e-gatilhos-de-monetização)
7. [Biblioteca de Prompts Prontos para Motores de IA Generativa](#7-biblioteca-de-prompts-prontos-para-motores-de-ia-generativa)
8. [Diretrizes Rigorosas de Ergonomia Mobile vs Desktop](#8-diretrizes-rigorosas-de-ergonomia-mobile-vs-desktop)
9. [Anti-Patterns & Negative Prompts (O Que a IA NUNCA Deve Fazer)](#9-anti-patterns--negative-prompts-o-que-a-ia-nunca-deve-fazer)
10. [Conclusão & Como Alimentar a IA com Este Documento](#10-conclusão--como-alimentar-a-ia-com-este-documento)

---

## 1. MANIFESTO DE PRODUTO & O ARQUÉTIPO DA MARCA NUVEMWASH

### 1.1. O que é o NuvemWash?
O **NuvemWash** é a plataforma SaaS de gestão, vendas e blindagem jurídica líder para o mercado de **Estética Automotiva de Alto Padrão (Detailing)**, **Estúdios de Vitrificação Cerâmica**, **Instaladores Especializados de PPF (Paint Protection Film)**, **Martelinho de Ouro** e **Boutiques Automotivas**.

Ele **NÃO É** um software genérico de lava-rápido de posto de gasolina, nem um ERP contábil cinza e antiquado. O NuvemWash foi concebido como um **cockpit de alta precisão** que transforma oficinas mecânicas e detailers artesanais em empresários altamente lucrativos e juridicamente blindados.

### 1.2. O Cliente-Alvo (Persona: "O Detailer Profissional")
* **Quem é ele:** Um profissional apaixonado por carros de alta performance (Porsche, BMW M, AMG, Audi RS, superesportivos e clássicos). Trabalha com uniformes pretos impecáveis, iluminação de LED hexagonal no teto e equipamentos de ponta.
* **Sua Maior Dor:** 
  1. *Prejuízos injustos causados por clientes mal-intencionados* que acusam a oficina de ter riscado o carro ou quebrado peças plásticas que já estavam trincadas ou ressecadas antes da entrada.
  2. *Vender pacotes baratos por timidez ou falta de apresentação visual profissional*, deixando de faturar serviços de R$ 2.000 a R$ 15.000.
  3. *Inadimplência de amigos e clientes* ("o famoso fiado"), sentindo vergonha de cobrar no WhatsApp.
  4. *Falta de clareza sobre o lucro real*: confunde faturamento bruto com sobra de caixa, esquecendo taxas de cartão Asaas/Stone, comissão de funcionários e custo de produtos químicos caros.

### 1.3. O Arquétipo Visual: "Cockpit Tecnológico de Pista"
A identidade visual e a experiência do usuário do NuvemWash seguem a estética de um **supercarro moderno (Porsche 911 GT3 RS / McLaren 720S)** mesclado a um **centro de controle aeroespacial**:
* **Tema Escuro Profundo (Darkroom Dominante):** Remete às cabines escuras com iluminação técnica controlada onde o detailer faz inspeção de holografia e polimento de verniz.
* **Acentos em Âmbar Dourado Solar (`#FF8A3D` / `#F59E0B`):** Inspirado nas pinças de freio de carbono-cerâmica e nas luzes de telemetria esportiva.
* **Ciano Elétrico (`#5EC8FF`):** Usado para dados de telemetria, cronômetros de tempo de trabalho e links públicos de clientes.
* **Verde Esmeralda (`#3ED598`):** Representa lucro líquido real, status aprovados e gatilhos de WhatsApp.
* **Vermelho Freio (`#FF5A5A`):** Pins de avarias graves na vistoria e alertas críticos.
* **Sensação Geral:** Sofisticação, autoridade técnica, precisão milimétrica, robustez e exclusividade.

---

## 2. DESIGN SYSTEM & TOKENS VISUAIS OFICIAIS (PARA ALIMENTAÇÃO DE IAS)

> **Instrução Primária para a IA de Design:** Ao renderizar interfaces, mockups de telas, ilustrações ou componentes, utilize EXATAMENTE os valores de cor, tipografia, raios de curvatura e elevações listados abaixo.

### 2.1. Tokens de Cores (Paleta HEX, RGB e Semântica)

```
┌─────────────────┬───────────┬─────────────────────┬────────────────────────────────────────────────────────┐
│ NOME DO TOKEN   │ HEX       │ RGB                 │ PAPEL NA INTERFACE (SEMÂNTICA)                         │
├─────────────────┼───────────┼─────────────────────┼────────────────────────────────────────────────────────┤
│ graphite-950    │ #090B0E   │ rgb(9, 11, 14)      │ Fundo absoluto da aplicação, tela cheia, canvas dark   │
│ graphite-900    │ #0F1216   │ rgb(15, 18, 22)     │ Fundo padrão de páginas, modais e containers           │
│ graphite-800    │ #171B21   │ rgb(23, 27, 33)     │ Superfície de Cards, Sidebar, painéis e inputs         │
│ graphite-700    │ #1F242C   │ rgb(31, 36, 44)     │ Bordas de separação sutis, divisores, inputs inativos  │
│ graphite-600    │ #2B323C   │ rgb(43, 50, 60)     │ Bordas em hover, scrollbars customizadas               │
│ amber-500       │ #FF8A3D   │ rgb(255, 138, 61)   │ Cor Primária de Ação (CTA), botões de impacto, glow    │
│ amber-600       │ #E5761F   │ rgb(229, 118, 31)   │ Estado Hover/Active de botões primários                │
│ amber-400       │ #FFB070   │ rgb(255, 176, 112)  │ Badges douradas, textos de ênfase primária             │
│ glass-400       │ #5EC8FF   │ rgb(94, 200, 255)   │ Ciano elétrico: telemetria, cronômetros, links web     │
│ mint-400        │ #3ED598   │ rgb(62, 213, 152)   │ Verde lucro, status "Aprovado", botão de WhatsApp      │
│ flare-400       │ #FF5A5A   │ rgb(255, 90, 90)    │ Vermelho crítico, avarias na lataria, exclusões        │
│ vapor-100       │ #EDF0F3   │ rgb(237, 240, 243)  │ Texto primário de alto contraste (Títulos e Números)   │
│ vapor-400       │ #98A2B0   │ rgb(152, 162, 176)  │ Texto secundário, rótulos, legendas e descrições       │
│ vapor-600       │ #5D6773   │ rgb(93, 103, 115)   │ Textos desabilitados, placeholders de formulário       │
└─────────────────┴───────────┴─────────────────────┴────────────────────────────────────────────────────────┘
```

### 2.2. Tipografia e Escala de Fontes

O sistema utiliza três famílias tipográficas com propósitos estritamente separados:

1. **Display & Títulos de Impacto — `Archivo` (Sans-Serif Condensada, Pesos 700 e 900):**
   * Estilo: Sempre em **CAIXA ALTA (UPPERCASE)** com `letter-spacing: 0.05em` a `0.1em` (`tracking-wider`).
   * Aplicação: Títulos de seções, nomes de planos (`PLANO PRO`), cabeçalhos de orçamentos, chamada principal da Landing Page.
   * Transmite: Força, pedigree de corrida, imponência técnica.

2. **Interface, Leitura e Formulários — `IBM Plex Sans` (Sans-Serif Neutra, Pesos 400, 500 e 600):**
   * Estilo: Sentence case, legibilidade técnica extrema tanto em smartphones quanto em telas grandes.
   * Aplicação: Rótulos de inputs, textos de ajuda, cláusulas da Minuta do Advogado, tabelas de clientes.

3. **Telemetria, Valores e Códigos — `IBM Plex Mono` (Monoespaçada com Dígitos Tabulares, Pesos 500 e 700):**
   * Estilo: Numerais monoespaçados perfeitamente alinhados verticalmente.
   * Aplicação: Moeda (`R$ 4.850,00`), Placas Mercosul (`BRA2E19`), Cronômetro (`02:45:18`), Proporções de diluição (`1:20`), coordenadas de avarias.

### 2.3. Superfícies, Vidro e Efeitos Gráficos
* **Bordas Metálicas Sutis:** `1px solid rgba(255, 255, 255, 0.08)` ou `border-graphite-700`. No foco ou hover, transiciona para `rgba(255, 138, 61, 0.4)` (glow âmbar).
* **Glassmorphism Escuro:** `background: rgba(23, 27, 33, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.06);`.
* **Glows de Destaque:** 
  * Glow Âmbar: `box-shadow: 0 0 25px rgba(255, 138, 61, 0.18)` (usado no card Recomendado do Orçamento).
  * Glow Ciano: `box-shadow: 0 0 20px rgba(94, 200, 255, 0.15)` (usado em timers e cronômetros).
* **Raios de Curvatura (Border Radius):**
  * `rounded-md` (6px): Botões de ação, inputs de formulário, badges.
  * `rounded-lg` (8px a 10px): Cards de conteúdo, modais, painéis de vistoria.
  * `rounded-full` (9999px): Indicadores de status, avatares, pílulas de filtros rápidos.

---

## 3. DICIONÁRIO SEMÂNTICO & UNIVERSO TÉCNICO DO DETAILER AUTOMOTIVO

> **Nota para o motor de IA:** Profissionais de estética automotiva odeiam termos amadores como "lavagem de carro" ou "cera líquida". Usar o vocabulário correto garante que os textos, telas e criativos gerados tenham legitimidade imediata frente ao mercado de elite.

* **PPF (Paint Protection Film):** Película termoplástica transparente de uretano com tecnologia *self-healing* (auto-regeneração por calor). Protege contra pedradas e riscos na lataria. Ticket: R$ 8.000 a R$ 25.000.
* **Vitrificação Cerâmica / Nano-Coating 9H:** Revestimento líquido à base de sílica que reage com a pintura, criando uma camada de vidro com dureza 9H na escala mineral, hiper-hidrorrepelência e proteção contra raios UV por 1 a 5 anos.
* **Correção de Pintura (Polimento Técnico em 3 Etapas):**
  1. *Corte (Compounding):* Desbaste do verniz com boina de lã/microfibra para remover riscos profundos (*swirls* e teias de aranha).
  2. *Refino (Polishing):* Eliminação de micro-riscos e hologramas da etapa de corte com boina de espuma média.
  3. *Lustro (Finishing):* Realce extremo de profundidade de cor e brilho espelhado com boina de espuma macia e composto lustrador.
* **Micrômetro de Verniz (Paint Depth Gauge):** Equipamento digital que mede a espessura total da pintura em micras (µm). Vernizes originais medem entre 100 e 140 micras. Vernizes abaixo de 80 micras estão na "zona de perigo" de rompimento do verniz (queima), exigindo assinatura do termo de responsabilidade do CDC.
* **Snow Foam:** Espuma densa aplicada com canhão de ar/água (foam gun) para emulsificar a sujeira pesada na pré-lavagem sem encostar no veículo, prevenindo atrito.
* **Descontaminação Ferrosa:** Produto reagente que fica roxo escuro ao dissolver partículas microscópicas de pó de pastilha de freio incrustadas nas rodas e na lataria.
* **Higienização com Extratora & Tornador:** Limpeza técnica de bancos e forrações com injeção e sucção imediata de bactericidas em alta pressão pneumática.
* **Código de Defesa do Consumidor (CDC) na Oficina:** Arts. 6º, 8º, 14, 40 e 54 — Legislação brasileira que exige orçamento prévio aprovado, ciência inequívoca sobre riscos em peças ressecadas/repintadas e termos de garantia formalmente discriminados.

---

## 4. ANATOMIA DETALHADA DE CADA TELA DA PLATAFORMA (ESPECIFICAÇÃO UI/UX)

### 4.1. Landing Page Institucional & Hero de Alta Conversão (`/`)
* **Objetivo:** Capturar o detailer em 5 segundos, comunicar autoridade absoluta e fazê-lo clicar em `COMEÇAR 15 DIAS GRÁTIS SEM CARTÃO`.
* **Componentes:** Header Flutuante Glassmorphism, Hero com headline em Archivo, subheadline sobre blindagem jurídica e multiplicação de ticket, dupla de CTAs, carrossel de provas sociais, mockups 3D com iluminação hexagonal e tabela comparativa dos 3 planos.

### 4.2. Fluxo de Autenticação, Onboarding & Degustação (`/login`, `/cadastro`)
* **Objetivo:** Entrada sem fricção em menos de 60 segundos.
* **Componentes:** Tela dividida (foto cinematográfica à esquerda e formulário à direita), campos com máscara automática de telefone/CNPJ, badge destacando os 15 dias de degustação PRO sem cartão e assistente de boas-vindas para upload da logo e horários.

### 4.3. Dashboard Principal Cockpit (`/`)
* **Objetivo:** Visão panorâmica imediata da saúde da empresa.
* **Componentes:** 4 KPIs mestres (Faturamento Bruto vs Líquido Real, Carros no Pátio, Ticket Médio, Conversão de Propostas), painel de Carros no Pátio Agora e atalhos rápidos âmbar para Novo Check-in, Novo Orçamento e Calculadora de Diluição.

### 4.4. Agenda Inteligente & Gestão de Pátio "Hoje" (`/agenda`, `/hoje`)
* **Objetivo:** Controle de boxes, fluxos de trabalho e serviços que duram vários dias.
* **Componentes:** Seletor de visualizações (Hoje, Semana, Mês), colunas dedicadas por Box de trabalho, placa Mercosul com bandeira do Brasil, botão de WhatsApp com 1 toque e badge ciano para serviços com pernoite.

### 4.5. Check-in 360º com Vistoria Vetorial e Assinatura Touch (`/checkin`)
* **Objetivo:** O escudo protetor contra processos e prejuízos injustos.
* **Componentes:** Placa Mercosul com busca rápida, hodômetro, marcador gráfico de tanque de combustível, diagrama interativo de silhueta 360º com pins de avarias por toque, fotos com carimbo d'água automático de data/hora imutável, termos de risco do CDC e canvas escuro para assinatura digital do cliente com o dedo.

### 4.6. Motor de Orçamentos de Elite em 3 Níveis & Minuta Jurídica (`/orcamento/novo`)
* **Objetivo:** Ferramenta comercial que eleva o ticket médio em até 40% usando ancoragem psicológica.
* **Componentes:** Visualização dos 3 Níveis (Essencial, Recomendado com borda dourada e badge "Mais Escolhido", e Premium com proteção 9H), botão de aplicação da Minuta Oficial do Advogado (CDC) e opção de gerar folha anexa exclusiva para assinatura no PDF.

### 4.7. Portal Público de Aprovação do Cliente (`/orcamento/:token`)
* **Objetivo:** O link web elegante que o cliente abre no WhatsApp para aprovar a proposta.
* **Componentes:** Comparador deslizante dos 3 pacotes, modal de aprovação com assinatura touch pelo próprio cliente, seletor de agendamento de data e geração imediata de Pix Copia e Cola / QR Code para pagamento de sinal.

### 4.8. Chão de Oficina: Cronômetro de Telemetria & Diluição (`/ordem-servico/:id`)
* **Objetivo:** A interface usada na execução diária pelos detailers dentro do box.
* **Componentes:** Cronômetro ciano de telemetria por etapa, comparador Antes vs Depois para Stories do Instagram e calculadora interativa de diluição química com gráfico de proveta graduada (1:1 a 1:100).

### 4.9. Painel Financeiro: DRE em Tempo Real & Radar de Cobrança (`/financeiro`)
* **Objetivo:** Entregar clareza financeira absoluta sem complicação contábil.
* **Componentes:** DRE Sintético (Bruto ➔ (-) Taxas de Cartão ➔ (-) Comissões ➔ (-) Custo de Insumos ➔ (=) Lucro Líquido Real) + Radar Financeiro com lista de vencimentos do dia e botão de cobrança educada com chave Pix em 1 toque no WhatsApp.

### 4.10. Motor Fiscal Integrado & Emissão de NFS-e (`/financeiro/fiscal`)
* **Objetivo:** Emissão automatizada de Notas Fiscais de Serviços sem abrir o site da prefeitura.
* **Componentes:** Indicador de Certificado Digital A1, emissão em 1 clique na entrega do carro, download instantâneo de DANFSe (PDF) e arquivo XML.

### 4.11. "Minha Oficina": Configurações, Matriz 2D & Equipe (`/configuracoes`)
* **Objetivo:** Centro nevrálgico de personalização do estúdio.
* **Componentes:** Abas deslizantes com Logo, Horários e Boxes, Gestão de Equipe com travas de acesso, Matriz de Preços 2D por porte de veículo (Pequeno, Médio, Grande, SUV/Picape) e editor de termos de garantia.

### 4.12. Cockpit Master Admin SaaS (`/admin`)
* **Objetivo:** O painel de bordo exclusivo dos sócios-fundadores para gerenciar todo o ecossistema.
* **Componentes:** Gestão de Oficinas (`/admin/oficinas`), Matriz de Planos (`/admin/planos`), Switch mestre de 15 dias de degustação grátis no cadastro (`/admin/campanhas`) e monitor de consumo do Supabase Storage (`/admin/storage`).

---

## 5. GUIA OPERACIONAL PASSO A PASSO: COMO FAZER CADA AÇÃO NA PRÁTICA (CLIQUE A CLIQUE)

> **Instrução aos Sócios e Instrutores:** Esta seção ensina exatamente como mexer na plataforma, onde clicar, qual é o caminho na interface e qual o fluxo ideal para deixar a oficina 100% pronta e operando com excelência.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               FLUXO OPERACIONAL COMPLETO DA OFICINA                                   │
│                                                                                                        │
│   [1. SETUP INICIAL] ──► [2. RECEPÇÃO & CHECK-IN] ──► [3. ORÇAMENTO 3 NÍVEIS & MINUTA DO ADVOGADO]    │
│   (/configuracoes)        (/checkin - Vistoria 360)    (/orcamento/novo - Link WhatsApp do Cliente)    │
│                                                                      │                                 │
│                                                                      ▼                                 │
│   [6. DRE & RADAR ZAP] ◄── [5. CONCLUSÃO & NFS-e] ◄── [4. CHÃO DE OFICINA, CRONÔMETRO & DILUIÇÃO]      │
│   (/financeiro - Lucro)    (/ordem-servico - Baixa)    (/ordem-servico - Telemetria & Químicos)        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### 5.1. Primeiro Acesso: Setup da Oficina, Logo e Horários (`/configuracoes`)
* **Onde ir:** No menu lateral esquerdo (ou menu inferior no mobile), clique em **`Minha Oficina`** (ou acesse a URL `/configuracoes`).
* **Passo a Passo de Configuração:**
  1. **Aba "Oficina":**
     * Preencha a *Razão Social*, o *Nome Fantasia* e o *CNPJ / CPF*.
     * Digite o *WhatsApp de Atendimento* com DDD (ex: `11999998888`). Este número será usado em todas as mensagens automáticas e comprovantes.
     * Insira o *Endereço Completo* (ele sairá no rodapé dos orçamentos e do agendamento online).
     * Faça o upload da **Logomarca da Oficina**: prefira imagem em formato PNG com fundo transparente e resolução mínima de 500x500px. Essa logo aparecerá no cabeçalho das propostas do cliente e nos laudos periciais em PDF.
     * Clique no botão **`Salvar Informações da Oficina`** no canto inferior direito.
  2. **Aba "Horários & Pátio":**
     * Defina o horário de abertura (ex: `08:00`) e de fechamento (ex: `18:30`).
     * Configure o intervalo de almoço para que a agenda inteligente não marque entregas nesse período.
     * Defina o **Número Máximo de Veículos Simultâneos**: se a oficina tem 3 boxes físicos, coloque `3`. Isso impede que o agendamento online crie fila desordenada no pátio.
     * Clique em **`Salvar Horários`**.

---

### 5.2. Como Cadastrar a Matriz de Preços 2D por Porte de Veículo
* **Onde ir:** Em `/configuracoes`, clique na aba **`Serviços & Matriz de Preços`**.
* **Como funciona a Matriz 2D:** Detailers não cobram o mesmo valor para polir um Fiat 500 (Hatch Pequeno) e uma Toyota Hilux ou Porsche Cayenne (SUV Grande). A Matriz 2D resolve isso:
* **Passo a Passo:**
  1. Clique no botão **`+ Adicionar Novo Serviço`**.
  2. Digite o nome do serviço (ex: `Polimento Técnico Comercial`).
  3. Preencha a tabela que se abre com as 4 colunas de portes:
     * *Porte Pequeno (Hatch):* Preço: `R$ 600,00` | Tempo estimado: `240 min` (4h).
     * *Porte Médio (Sedan):* Preço: `R$ 750,00` | Tempo estimado: `300 min` (5h).
     * *Porte Grande (SUV/SW):* Preço: `R$ 950,00` | Tempo estimado: `360 min` (6h).
     * *Porte Extra Grande (Picape/Blindado):* Preço: `R$ 1.200,00` | Tempo estimado: `420 min` (7h).
  4. Marque a comissão padrão da equipe para esse serviço (ex: `30%`).
  5. Clique em **`Salvar Serviço na Matriz`**.
  *Repita o processo para os principais serviços da oficina: Lavagem Técnica Detalhada, Vitrificação Cerâmica 9H, Higienização Interna e Aplicação de PPF.*

---

### 5.3. Como Cadastrar a Equipe e Bloquear Acesso ao Financeiro
* **Onde ir:** Em `/configuracoes`, clique na aba **`Equipe & Permissões`**.
* **Passo a Passo:**
  1. Clique em **`+ Adicionar Colaborador`**.
  2. Preencha o Nome Completo, WhatsApp e E-mail do funcionário.
  3. Selecione a **Função Operacional**:
     * *Operador / Polidor:* Tem acesso apenas ao Check-in, Agenda do Pátio e Chão de Oficina (cronômetro e diluição). **Não tem permissão para visualizar o DRE, faturamento, despesas ou extrato bancário.**
     * *Gerente / Recepcionista:* Pode criar orçamentos, agendar e atender clientes, com permissão financeira restrita.
     * *Administrador / Sócio:* Acesso irrestrito a todos os módulos, relatórios fiscais e configurações da oficina.
  4. Defina o percentual de comissão individual do colaborador.
  5. Clique em **`Salvar Membro da Equipe`**.

---

### 5.4. Como Fazer uma Vistoria & Check-in 360º na Chegada do Carro (`/checkin`)
* **Onde ir:** No Dashboard, clique no botão âmbar de destaque **`+ Iniciar Check-in 360º`** ou acesse `/checkin`.
* **Passo a Passo da Vistoria Blindada (Recepção do Cliente):**
  1. **Identificação do Carro:**
     * Digite a **Placa do Veículo** (padrão Mercosul `BRA2E19` ou antigo `ABC1234`).
     * O sistema busca o veículo se já cadastrado, ou você insere o Modelo (ex: `BMW M3 2023`), a Cor e o Nome do Cliente com WhatsApp.
     * Digite a **Quilometragem (KM)** que consta no painel.
     * Clique no botão do **Nível de Combustível** (ex: `1/2 Tanque`).
     * Marque os checkboxes de *Pertences Pessoais Deixados no Veículo* (ex: óculos, ferramentas, moedas).
  2. **Mapeamento de Avarias na Silhueta 360º (A Chave da Blindagem Jurídica):**
     * Na tela, aparece o desenho técnico blueprint do carro (frente, laterais, teto, traseira).
     * Dê a volta física no carro junto com o cliente.
     * Encontrou um risco ou ralado na porta do passageiro? **Toque exatamente com o dedo na porta do desenho na tela**.
     * Abre-se o pop-up:
       * Selecione a classificação: `Risco Profundo`, `Amassado`, `Repintura Grosseira` ou `Roda Ralada`.
       * Selecione a severidade: `Leve (Amarelo)` ou `Crítica (Vermelho)`.
       * Clique no botão de câmera e **tire a foto do defeito em close-up** pelo celular.
     * O sistema finca um pin luminoso pulsante naquele ponto exato do desenho.
  3. **Fotos Obrigatórias de Ângulos Gerais:**
     * O sistema exibe os 6 slots principais: Frente, Traseira, Lateral Esquerda, Lateral Direita, Interior e Motor.
     * Toque em cada slot e bata a foto. O NuvemWash estampa na hora a tarja preta inferior com placa, data e horário oficial.
  4. **Termo de Responsabilidade Técnica (CDC):**
     * Se o carro tiver peça repintada ou verniz com espessura crítica abaixo de 80 micras, marque a caixa: `[x] Cliente declara ciência de repintura prévia com risco de desplacamento`.
  5. **Coleta da Assinatura Digital Touch:**
     * Role até o final da tela. O cliente assina diretamente na caixa preta com o próprio dedo.
  6. **Finalização:**
     * Clique em **`Finalizar Check-in e Enviar Laudo`**.
     * O sistema gera o PDF pericial blindado e abre o WhatsApp com a mensagem pronta: *"Olá [Cliente], seu veículo deu entrada na [Oficina]. Segue o Laudo Pericial de Entrada com fotos e vistoria 360: [Link do Laudo]"*.

---

### 5.5. Como Criar e Disparar Orçamentos em 3 Níveis com a Minuta do CDC (`/orcamento/novo`)
* **Onde ir:** No Dashboard, clique em **`+ Criar Orçamento`** (ou vá em `/orcamentos` ➔ `Novo`).
* **Passo a Passo de Venda de Alto Ticket:**
  1. Selecione o Cliente e o Veículo previamente cadastrados.
  2. No topo, selecione a chave seletora **`Orçamento em 3 Níveis (Estratégia Recomendada)`**.
  3. **Montando os 3 Pacotes:**
     * **Nível 1 (Essencial):** Selecione os serviços básicos solicitados pelo cliente (ex: *Lavagem Técnica Detalhada + Descontaminação Ferrosa*). Total: `R$ 380,00`.
     * **Nível 2 (Recomendado — O Campeão de Vendas):** O sistema aplica automaticamente uma borda dourada com badge `⭐ MAIS ESCOLHIDO`. Adicione: *Lavagem Técnica + Polimento Técnico Comercial + Vitrificação de Plásticos e Faróis + Higienização dos Bancos*. Total: `R$ 980,00`.
     * **Nível 3 (Premium / Master Detail):** Pacote com proteção máxima. Adicione: *Correção Total de Pintura (3 Etapas) + Coating Cerâmico 9H (Garantia de 3 Anos) + Vitrificação de Vidros + Proteção de Couro*. Total: `R$ 2.450,00`.
  4. **Blindagem Jurídica com a Minuta do Advogado:**
     * Clique no botão dourado **`⚖️ Aplicar Minuta Oficial do Advogado (CDC)`**.
     * O sistema preenche instantaneamente o campo de termos contratuais com o texto oficial aprovado por juristas citando os artigos 6º, 8º, 14, 40 e 54 do CDC.
     * Se desejar imprimir para assinatura em papel, marque: `[x] Imprimir Minuta Jurídica em Folha Separada no PDF`.
  5. **Disparo da Proposta:**
     * Clique em **`Salvar e Gerar Link do WhatsApp`**.
     * O sistema copia o link exclusivo da proposta (`/orcamento/:token`) e abre o WhatsApp do cliente com uma mensagem convidativa: *"Olá [Cliente], preparamos 3 opções personalizadas de cuidados para seu [Modelo do Carro]. Toque no link abaixo para comparar os pacotes e aprovar online: [Link]"*.

---

### 5.6. A Experiência do Cliente Final: Como ele Aprova, Assina e Paga o Sinal
* **O que acontece quando o cliente clica no link do WhatsApp:**
  1. O cliente abre no próprio smartphone uma página limpa, bonita e com a marca da sua oficina.
  2. Ele desliza o dedo horizontalmente entre os 3 cards. Vê o que está incluído em cada um, os benefícios de proteção e o valor parcelado.
  3. O cliente decide pelo pacote **Recomendado** e clica no botão verde **`APROVAR ESTE PACOTE`**.
  4. Abre-se o modal de assinatura:
     * O cliente confere os dados e digita o CPF.
     * **Ele assina com o dedo na tela do próprio celular**, validando o contrato e as cláusulas do CDC.
  5. **Escolha da Data de Entrada:** O cliente escolhe na agenda o melhor dia e horário para levar o carro.
  6. **Pagamento do Sinal via Pix:** O portal exibe o botão `Copiar Código Pix` e o QR Code com o valor da entrada (ex: 20% do orçamento).
  7. **O que muda na oficina:** O dono da oficina recebe um alerta no Dashboard e o orçamento é transformado automaticamente em uma **Ordem de Serviço (OS) Aprovada** na Agenda!

---

### 5.7. Como Operar o Chão de Oficina: Cronômetro e Calculadora de Diluição
* **Onde ir:** Na tela **`Hoje`** (`/hoje`) ou dentro da Ordem de Serviço em andamento (`/ordem-servico/:id`).
* **Como usar o Cronômetro de Telemetria:**
  * O operador que vai iniciar o polimento clica no botão **`Iniciar Etapa: Polimento Técnico`**.
  * O display ciano em `IBM Plex Mono` começa a contar o tempo de trabalho em segundos e minutos.
  * Se o operador for almoçar ou interromper o serviço, clica em **`Pausar`**. Ao retornar, clica em **`Retomar`**.
  * Ao concluir, clica em **`Concluir Etapa`**. O sistema armazena a duração exata para calcular o custo real da hora de mão de obra.
* **Como usar a Calculadora de Diluição de Químicos:**
  * No box de lavagem, o operador clica no botão **`🧪 Calculadora de Diluição`**.
  * Passo 1: Selecione o frasco que está na mão (ex: *Pulverizador Manual 1 Litro*).
  * Passo 2: Selecione a proporção recomendada no rótulo do produto (ex: `1:10` para desengraxante pesado ou `1:50` para shampoo neutro).
  * Passo 3: O desenho de uma proveta de laboratório mostra graficamente na tela:
    * *"Coloque 90ml de Produto Concentrado"*.
    * *"Complete com 910ml de Água Limpa"*.
  * O estúdio economiza milhares de reais por ano evitando que operadores coloquem produto "no olho".
* **Como registrar o Antes e Depois:**
  * Na aba de fotos da OS, tire a foto do capô com a fita crepe dividindo a metade com microrriscos e a metade espelhada.
  * O sistema gera automaticamente um card pronto para compartilhar nos Stories do Instagram com a logomarca da oficina.

---

### 5.8. Como Finalizar a OS, Emitir a NFS-e e Visualizar o DRE Real
* **Onde ir:** Na Ordem de Serviço concluída (`/ordem-servico/:id`) e no menu **`Financeiro`** (`/financeiro`).
* **Passo a Passo de Encerramento e Entrega:**
  1. Com o carro pronto e polido, clique no botão **`Finalizar e Entregar Veículo`**.
     * *(Importante: É neste exato clique que o sistema consome 1 atendimento da cota mensal do seu plano).*
  2. Selecione a forma de pagamento utilizada pelo cliente (ex: *Pix*, *Cartão de Crédito 3x*, *Dinheiro*).
  3. **Emissão Instantânea da Nota Fiscal (NFS-e):**
     * Clique no botão **`⚡ Emitir Nota Fiscal Agora`**.
     * O sistema dispara a requisição para a prefeitura via Focus NFe.
     * Em segundos, o status muda para `Autorizada` e aparecem os botões `Baixar DANFSe (PDF)` e `Baixar XML`.
  4. **Conferência do DRE Real no Financeiro:**
     * Acesse `/financeiro`.
     * No bloco do **DRE Sintético**, veja a separação matemática:
       * `(+) Faturamento Bruto:` R$ 980,00
       * `(-) Taxa da Maquininha/Gateway (3.2%):` - R$ 31,36
       * `(-) Comissão do Polidor (30% sobre mão de obra):` - R$ 250,00
       * `(-) Custo Estimado de Químicos e Boina:` - R$ 45,00
       * `(=) LUCRO OPERACIONAL LÍQUIDO REAL:` **R$ 653,64 (66.7% de Margem)**.

---

### 5.9. Como Usar o Radar de Cobrança WhatsApp para Eliminar Fiados
* **Onde ir:** Acesse o menu **`Financeiro`** ➔ seção **`Radar de Cobrança`**.
* **Passo a Passo para Receber Clientes em Atraso:**
  1. Todos os dias, o Radar de Cobrança compila automaticamente a lista de clientes que têm parcelas vencendo no dia ou que estão atrasadas.
  2. Na linha de cada cliente devedor, o sistema mostra o nome, modelo do veículo, valor pendente e dias de atraso em um badge vermelho.
  3. Ao lado do valor, há um **botão verde com o ícone do WhatsApp**.
  4. **Dê 1 clique no botão verde:**
     * O sistema abre o WhatsApp Web ou aplicativo de celular com a conversa daquele cliente e uma mensagem pronta, educada e elegante já digitada:
       *"Olá [Nome do Cliente], tudo bem? Esperamos que esteja aproveitando o brilho do seu [Modelo do Carro]! Passando apenas para lembrar que a parcela do seu serviço no valor de R$ [Valor] venceu em [Data]. Segue a nossa Chave Pix para facilidade de pagamento: [Chave Pix da Oficina]. Caso já tenha realizado o pagamento, por favor desconsidere!"*
  5. Você não precisa redigir nada nem passar vergonha cobrando; basta apertar o botão de enviar no WhatsApp.

---

### 5.10. Como os Sócios Operam o Painel Master Admin SaaS (`/admin`)
* **Onde ir:** Faça login com uma conta de sócio/administrador da NuvemWash e acesse a URL `/admin`.
* **Os 5 Comandos Principais dos Sócios:**
  1. **Monitorar Estúdios Cadastrados (`/admin/oficinas`):**
     * Veja a lista de todas as oficinas clientes no Brasil.
     * Filtre por plano (Free, Pro, Studio) e veja quem está em dia com a assinatura no Asaas.
     * Há um botão direto para abrir o WhatsApp do dono da oficina caso ele precise de suporte ou consultoria.
  2. **Controlar a Campanha de Degustação (`/admin/campanhas`):**
     * Na tela de campanhas, há o interruptor mestre: **`Degustação de 15 Dias Grátis no Cadastro`**.
     * Quer fazer uma campanha agressiva de captação de clientes? **Deixe o switch LIGADO**. Todo novo estúdio que se cadastrar ganha 15 dias de degustação PRO automática sem precisar de cartão.
     * Quer fechar a torneira e exigir pagamento imediato? **Desligue o switch**. O cadastro passa a exigir assinatura imediata ou libera apenas o plano Free limitado.
  3. **Editar Limites e Valores dos Planos (`/admin/planos`):**
     * Você pode reajustar o preço da mensalidade (ex: de R$ 79 para R$ 97) ou alterar as cotas de atendimentos mensais diretamente pela interface, sem precisar chamar um programador para alterar código.
  4. **Controlar os Custos de Servidor (`/admin/storage`):**
     * Monitore o gráfico de megabytes e gigabytes consumidos pelas fotos dos laudos no Supabase Storage para garantir que a margem de lucro do SaaS continue acima de 80%.
  5. **Atualizar a Minuta Jurídica Central (`/admin/modelos-termos`):**
     * Se o advogado do NuvemWash atualizar alguma cláusula do Código de Defesa do Consumidor, os fundadores colam o novo texto aqui e ele é propagado instantaneamente para todas as oficinas da plataforma.

---

## 6. MATRIZ OFICIAL DE PLANOS, LIMITES E GATILHOS DE MONETIZAÇÃO

> **Regra de Engenharia Sagrada:** A cota de atendimentos do plano só é consumida quando um veículo tem seu status alterado para **"Finalizado" / "Entregue"**. Orçamentos em negociação e agendamentos futuros não descontam da cota do cliente.

```
┌───────────────────────────────────┬───────────────────┬──────────────────────┬──────────────────────┐
│ CARACTERÍSTICA / RECURSO          │ PLANO FREE        │ PLANO PRO            │ PLANO STUDIO         │
├───────────────────────────────────┼───────────────────┼──────────────────────┼──────────────────────┤
│ Posicionamento Comercial          │ Isca de Entrada   │ O Core do Negócio    │ Para Grandes Centros │
│ Valor Sugerido da Mensalidade     │ R$ 0 / mês        │ R$ 79 a R$ 97 / mês  │ R$ 149 a R$ 197 / mês│
│ Atendimentos Finalizados no Mês   │ Até 15 carros     │ Até 150 carros       │ Até 500 carros       │
│ Base de Clientes Cadastrados      │ Até 20 clientes   │ Até 350 clientes     │ Ilimitado            │
│ Usuários da Equipe Simultâneos    │ 1 (Apenas o Dono) │ 3 operadores         │ 10 operadores        │
│ Orçamento Interativo em 3 Níveis  │ Bloqueado (Simples│ Ativo Completo       │ Ativo Completo       │
│ Minuta Oficial do Advogado (CDC)  │ Minuta Básica     │ Biblioteca Ilimitada │ Biblioteca Ilimitada │
│ Check-in 360º com Fotos e Avarias │ 4 fotos por carro │ 12 fotos por carro   │ 30 fotos por carro   │
│ Painel Financeiro & DRE Líquido   │ Bloqueado         │ Ativo                │ Ativo Avançado       │
│ Radar de Cobrança WhatsApp        │ Bloqueado         │ Ativo                │ Ativo                │
│ Cobrança de Sinal via Pix no Link │ Bloqueado         │ Ativo                │ Ativo                │
│ Emissão de Notas Fiscais (NFS-e)  │ 0 notas           │ 15 notas / mês       │ 60 notas / mês       │
│ Telemetria & Diluição de Químicos │ Bloqueado         │ Ativo                │ Ativo                │
│ Suporte & Treinamento             │ FAQ da Comunidade │ WhatsApp Prioritário │ Gerente de Conta VIP │
└───────────────────────────────────┴───────────────────┴──────────────────────┴──────────────────────┘
```

---

## 7. BIBLIOTECA DE PROMPTS PRONTOS PARA MOTORES DE IA GENERATIVA

> **Instrução para os Sócios & Designers:** Os prompts abaixo foram meticulosamente lapidados em inglês para Midjourney v6, Flux Schnell/Dev, Ideogram e geradores de UI como Figma AI e v0. Copie o bloco correspondente e cole na ferramenta desejada.

---

### Prompt 1: Mockup Mobile do Check-in 360º no iPhone 16 Pro
```text
Photorealistic 3D product mockup of an iPhone 16 Pro floating in a high-end dark automotive detailing studio at a 30-degree dynamic perspective angle. The background is softly blurred, showing a polished black Porsche 911 GT3 RS reflecting brilliant white hexagonal honeycomb LED ceiling lights. On the iPhone screen, the "NuvemWash" mobile app is displayed in stunning ultra-dark mode: a technical blueprint 3D wireframe silhouette of the Porsche with glowing amber and red interactive damage marker pins plotted over the fender and door panels. Below the car silhouette, a sleek touch signature canvas with a crisp gold handwritten digital signature and an amber CTA button reading "FINALIZAR VISTORIA 360". Color palette: Carbon Graphite #0F1216, Racing Amber #FF8A3D, Pure Vapor White text in Archivo typography. Hyper-realistic reflections, glassmorphism UI card layers, 8k resolution, cinematic commercial product shoot. --ar 16:9 --v 6.0 --q 2 --style raw
```

---

### Prompt 2: Dashboard Cockpit Web em Monitor Ultrawide Curvo
```text
An ultra-modern, luxury automotive detailing studio manager's desk. On the desk sits a sleek 34-inch curved ultrawide monitor displaying the "NuvemWash" software web dashboard. The UI is a dark luxury theme reminiscent of Formula 1 telemetry and Porsche Design: dark slate cards (#171B21) with thin metallic borders, glowing green KPI indicators showing "Faturamento Líquido Real: R$ 48.950,00" with line chart trends, glowing amber conversion rate badge "78%", and a live garage list displaying exotic supercars (McLaren, Ferrari, BMW M4) with status tags like "Vitrificação Cerâmica 9H" and "Correção de Verniz". Clean monospace tabular figures in IBM Plex Mono. In the background, an immaculate glass-walled detailing bay with cars under precision spot lighting. Octane render, photorealistic, sharp focus, ray tracing, studio lighting. --ar 16:9 --v 6.0
```

---

### Prompt 3: Portal do Cliente no Smartphone (Orçamento em 3 Níveis)
```text
First-person perspective shot of a customer's hand holding a sleek smartphone inside a pristine car studio lounge with dark leather armchairs. The smartphone screen shows the NuvemWash public proposal web page: three luxury tier cards displayed side-by-side: "ESSENCIAL", "RECOMENDADO (MAIS ESCOLHIDO)", and "PREMIUM FULL COATING". The middle card radiates with a rich dual golden-amber border glow, a star badge, and detailed breakdown bullet points for multi-stage paint correction, 9H ceramic coating, and interior leather care. At the bottom of the screen, a prominent vibrant emerald-green button reads "Aprovar Orçamento e Assinar". Cinematic shallow depth of field, bright crisp screen details, commercial UI advertising photography. --ar 9:16 --v 6.0 --q 2
```

---

### Prompt 4: Chão de Oficina com Operador Usando Tablet na Cabine de Luz
```text
Professional automotive detailer wearing a branded black crew-neck shirt and black nitrile gloves, standing next to a mirror-finish deep metallic blue sports car inside a high-tech detailing booth with bright white hexagonal ceiling LED lights. The detailer holds a rugged black iPad tablet displaying the NuvemWash technician interface: a massive electric cyan digital stopwatch counter reading "01:45:22" in monospace digits, a split photo widget showing a 50/50 comparison of swirled paint vs polished paint, and a graduated chemical dilution flask graphic showing a 1:20 ratio. Moody contrast, cinematic atmosphere, authentic professional detailing craftsmanship, hyper-detailed textures. --ar 16:9 --v 6.0
```

---

### Prompt 5: Prancha de Papelaria Corporativa com Minuta Jurídica e Certificado 9H
```text
Top-down commercial flat lay photograph on a matte carbon-fiber desk surface. On the desk is an official A4 printed proposal document generated by NuvemWash: high-resolution vehicle blueprint diagram with damage pins, formal CDC legal warranty clauses printed in crisp typography, digital signature stamp with verification QR code. Beside the document sits a luxury dark charcoal and metallic gold foiled "Certificado de Garantia e Manutenção de Vitrificação Cerâmica 9H". A high-end carbon-fiber pen and a high-precision digital paint depth micrômetro lie neatly next to the papers. Elegant luxury corporate stationery mock-up, studio lighting, subtle soft shadows, 8k. --ar 16:9 --v 6.0
```

---

### Prompt 6: Banner Principal da Landing Page (Hero Header)
```text
Sleek dark futuristic banner for a SaaS landing page header. In the center, a stunning front-angle view of a wet, mirror-finish midnight black Porsche 911 GT3 RS with water droplets beading off ceramic coating. Floating translucent glassmorphism UI widgets surround the car: a floating card showing an interactive damage scanner with amber pins, a floating card displaying a 3-tier price comparison with gold accents, and a card displaying "+R$ 38.450 / mês". Dark aesthetic with deep charcoal #0F1216 background, subtle glowing amber racing stripes in the background, neon hexagonal light reflections. Clean space for bold headline typography on the left. High-end Dribbble showcase, award-winning UI concept, 8k. --ar 16:9 --v 6.0
```

---

### Prompt 7: Radar Financeiro de Cobrança WhatsApp (UI Close-Up)
```text
Close-up product UI screenshot of a dark-mode financial dashboard modal titled "Radar de Cobrança do Dia". Dark slate background #171B21, neat table of overdue accounts with customer names, vehicle models, days overdue in red badges, and an unmistakable glowing green button on each row with the official WhatsApp icon and text "Cobrar com 1 Clique". Floating next to it is a preview bubble of the friendly WhatsApp message template with Pix key and invoice link. Minimalist, modern SaaS fintech aesthetics, high contrast, crisp vector icons. --ar 16:9 --v 6.0
```

---

## 8. DIRETRIZES RIGOROSAS DE ERGONOMIA MOBILE VS DESKTOP

Para garantir que qualquer mockup ou código desenhado pela IA mantenha perfeição prática de uso:

1. **Paridade Funcional Total:**
   * **Nenhum recurso pode ser exclusivo de Desktop.** Tudo o que o estúdio faz no computador (aplicar a Minuta do Advogado, ver o DRE, assinar orçamentos, configurar a matriz de preços) DEVE ser 100% acessível e funcional no smartphone.

2. **Área de Toque do Polegar (Thumb-Zone Ergonomics):**
   * No celular, os botões primários de ação (`Iniciar Check-in`, `Aprovar Orçamento`, `Salvar`, `Enviar WhatsApp`) devem ter altura mínima de **`48px`** com padding confortável (`py-3.5 px-4`) e ficar na metade inferior da tela.

3. **Prevenção de Quebras de Layout em Telas Compactas (iPhone SE a iPhone 16 Pro Max):**
   * Grupos de botões devem sempre usar `flex-wrap gap-2` ou `grid grid-cols-1 sm:grid-cols-2`.
   * Textos nunca devem ser truncados de forma feia com `...` em títulos fundamentais; usar tipografia responsiva (`text-sm sm:text-base`).
   * No celular, os 3 Níveis de Orçamento se transformam em um **carrossel deslizante suave com snap horizontal** ou cards empilhados verticalmente.

4. **Formulários e Inputs Móveis:**
   * O tamanho da fonte de qualquer `<input>` deve ser de no mínimo **`16px`** (`text-base`) para impedir o zoom involuntário do navegador Safari no iOS.
   * O teclado numérico nativo (`inputMode="numeric"` ou `inputMode="decimal"`) deve ser disparado em campos de valores, placas e quilometragem.

---

## 9. ANTI-PATTERNS & NEGATIVE PROMPTS (O QUE A IA NUNCA DEVE FAZER)

> **Instrução Rígida para IAs de Geração Visual:** Inclua os termos abaixo como **Negative Prompts** para evitar que a IA produza designs desastrosos que descaracterizem a marca NuvemWash.

### O Que é Expressamente Proibido:
* ❌ **Cores Clichês de Lava-Jato:** Nunca usar fundos azuis-bebê, gradientes arco-íris, tons pastéis infantis ou verde limão radioativo.
* ❌ **Ícones Amadores e Infantis:** Proibido usar ícones de balde de água, esponja de sabão, bolhas flutuantes, mangueira de jardim ou carros de desenho animado.
* ❌ **Interfaces Brancas Ofuscantes (Light Mode Genérico):** O NuvemWash é um cockpit escuro de alta performance. Interfaces brancas com cinza claro destroem a autoridade e a atmosfera de estúdio de detalhamento.
* ❌ **Tabelas Estilo Excel dos Anos 90:** Nada de grades cinzas chapadas e sem respiro visual. Toda lista de dados deve usar cards flutuantes com padding generoso e tipografia hierarquizada.
* ❌ **Textos Longos Sem Destaque:** Cláusulas contratuais e vistorias devem ser estruturadas com badges, tópicos com marcadores dourados e caixas com destaque visual.

---

## 10. CONCLUSÃO & COMO ALIMENTAR A IA COM ESTE DOCUMENTO

Ao orientar qualquer inteligência artificial (Midjourney, ChatGPT, Claude, Figma AI ou desenvolvedores) para criar peças da NuvemWash, instrua da seguinte forma:

> *"Atue como o Head de Design de Produto da NuvemWash. Utilize as diretrizes oficiais de cores (#0F1216, #FF8A3D, #5EC8FF, #3ED598), as fontes (Archivo, IBM Plex Sans, IBM Plex Mono) e o arquétipo de Cockpit Tecnológico de Pista especificados na Bíblia Mestre de Produto para gerar a tela / mockup / criativo solicitado, respeitando a blindagem jurídica e a linguagem profissional de estética automotiva."*

Este documento representa o ativo central de engenharia, vendas, operação e produto da NuvemWash. Ele atende tanto ao operador e sócio que precisam entender o clique a clique quanto ao designer de inteligência artificial que gerará a identidade visual do software.
