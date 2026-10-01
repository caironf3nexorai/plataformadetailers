# 🏎️ NUVEMWASH — BÍBLIA MESTRE DE PRODUTO, DESIGN SYSTEM & ARQUITETURA VISUAL

> **Documento Oficial de Especificação de Engenharia, Identidade de Marca e Feedstock para Inteligência Artificial**  
> **Destinatários:** Sócios-Fundadores, Equipe de Produto, Designers de UI/UX, Diretores de Arte e **Motores de IA Generativa de Design (Midjourney v6, Flux, Stable Diffusion, Claude 3.7 Sonnet, ChatGPT/GPT-4o, Figma AI, Galileo AI, v0)**  
> **Versão:** 4.0 Definitiva Master  
> **Objetivo:** Fornecer um panorama 100% completo, cirúrgico e detalhado da plataforma NuvemWash, servindo de prompt mestre e base de conhecimento para que qualquer IA gere designs, mockups, telas, peças publicitárias e interfaces com fidelidade técnica e estética absoluta.

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
5. [Matriz Oficial de Planos, Limites e Gatilhos de Monetização](#5-matriz-oficial-de-planos-limites-e-gatilhos-de-monetização)
6. [Biblioteca de Prompts Prontos para Motores de IA Generativa](#6-biblioteca-de-prompts-prontos-para-motores-de-ia-generativa)
7. [Diretrizes Rigorosas de Ergonomia Mobile vs Desktop](#7-diretrizes-rigorosas-de-ergonomia-mobile-vs-desktop)
8. [Anti-Patterns & Negative Prompts (O Que a IA NUNCA Deve Fazer)](#8-anti-patterns--negative-prompts-o-que-a-ia-nunca-deve-fazer)

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

---

### 4.1. Landing Page Institucional & Hero de Alta Conversão (`/`)

* **Objetivo:** Capturar o detailer em 5 segundos, comunicar autoridade absoluta e fazê-lo clicar em `COMEÇAR 15 DIAS GRÁTIS SEM CARTÃO`.
* **Estrutura Visual:**
  * **Header Flutuante Glassmorphism:** Logotipo NuvemWash (ícone de nuvem com linhas de velocidade e tipografia Archivo), links de navegação (`Funcionalidades`, `Blindagem Jurídica`, `Orçamentos 3 Níveis`, `Planos`, `Depoimentos`), botão `Entrar` e botão de destaque `Criar Conta Grátis` com glow âmbar.
  * **Hero Section Impactante:**
    * Badge de topo: `⚡ O SISTEMA OPERACIONAL DA ESTÉTICA AUTOMOTIVA DE ELITE`.
    * Título Display Archivo Gigante: `TRANSFORME SEU ESTÚDIO EM UMA MÁQUINA DE LUCRO E BLINDAGEM JURÍDICA`.
    * Subtítulo explicativo: *"Abandone o papel, pare de tomar prejuízo por riscos que não fez e venda orçamentos até 40% mais caros com propostas interativas no WhatsApp."*
    * Dupla de CTAs: Botão primário `EXPERIMENTAR 15 DIAS GRÁTIS` + Botão secundário `VER DEMONSTRAÇÃO EM VÍDEO (2 min)`.
    * Prova Social Imediata: `+450 Estúdios Ativos no Brasil` • `+12.000 Vistorias Realizadas` • `Nota 4.9/5 ⭐`.
  * **Mockup 3D Flutuante:** Render de um laptop e smartphone exibindo o Check-in 360º e o Orçamento em 3 Níveis com reflexos neon no fundo escuro.
  * **Grid de 4 Pilares de Poder:**
    1. *Blindagem Jurídica CDC:* Vistoria 360º com fotos com data/hora e minuta aprovada por advogados.
    2. *Orçamento 3 Níveis:* Apresentação visual que induz o cliente a escolher o pacote intermediário mais lucrativo.
    3. *Chão de Oficina & Diluição:* Cronômetro por etapa e calculadora que impede desperdício de produtos caros.
    4. *Radar de Cobrança:* 1 clique no WhatsApp para receber valores pendentes sem constrangimento.
  * **Tabela de Preços & Planos (Free vs Pro vs Studio):** Cards detalhados com switch Anual (com desconto) / Mensal.
  * **Footer Técnico:** Links institucionais, selo de segurança SSL, menção a servidores de alta performance e conformidade com a LGPD e CDC.

---

### 4.2. Fluxo de Autenticação, Onboarding & Degustação (`/login`, `/cadastro`)

* **Objetivo:** Entrada sem fricção em menos de 60 segundos.
* **Componentes:**
  * **Tela Dividida (Split Screen):**
    * *Lado Esquerdo (Desktop):* Painel cinematográfico escuro com imagem de um supercarro sendo inspecionado sob luzes hexagonais e depoimento de um detailer renomado.
    * *Lado Direito:* Formulário limpo com fundo `graphite-900`.
  * **Formulário de Cadastro:**
    * Nome Completo, E-mail profissional, Senha com medidor de força.
    * Nome Fantasia da Oficina e WhatsApp com máscara automática `(99) 99999-9999`.
    * Seletor de Tipo de Estúdio: `Estética Automotiva Geral`, `Especialista em PPF/Envelopamento`, `Vitrificação & Polimento`, `Martelinho de Ouro / Pintura Express`.
    * Badge de Boas-Vindas: `🎁 15 DIAS DE ACESSO PRO LIBERADOS SEM NECESSIDADE DE CARTÃO`.
  * **Wizard de Boas-Vindas (Passo a Passo Pós-Cadastro):**
    * Passo 1: Upload do logotipo da oficina (PNG com fundo transparente).
    * Passo 2: Configuração de 3 serviços principais e seus preços médios.
    * Passo 3: Horário de funcionamento e quantidade de boxes de trabalho.
    * Conclusão: Redirecionamento instantâneo para o Cockpit Dashboard com confetes digitais discretos.

---

### 4.3. Dashboard Principal Cockpit (`/`)

* **Objetivo:** O painel de comando diário do proprietário. Visão holística da saúde financeira e da esteira de produção.
* **Estrutura Visual:**
  * **Faixa Superior de Boas-Vindas:**
    * Saudação personalizada: *"Bom dia, [Nome do Dono] • [Nome da Oficina]"*.
    * Data do dia e indicador do clima/tempo local (útil para detailers, pois dias chuvosos afetam lavagens rápidas).
    * Badge do Plano: `PLANO PRO ATIVO` com barra de progresso de uso (`42 / 150 Atendimentos no Mês`).
  * **Grid de 4 Cards KPIs Mestres (Números em IBM Plex Mono):**
    1. **Faturamento no Mês:** `R$ 38.450,00` (Bruto) | `R$ 29.810,00` (Líquido Real) com tag verde `+18.4% vs mês anterior`.
    2. **Carros no Pátio Hoje:** `8 Veículos` (3 em lavagem, 3 em polimento, 2 aguardando liberação).
    3. **Ticket Médio:** `R$ 640,00` por veículo.
    4. **Taxa de Conversão de Propostas:** `72%` de orçamentos aprovados na semana.
  * **Seção "Carros no Pátio Agora" (Kanban / Tabela Viva):**
    * Linhas escuras com foto do carro, placa Mercosul em badge retangular, modelo do veículo, serviço em andamento, operador responsável e barra de progresso de tempo.
    * Botões de ação rápida por carro: `Abrir OS`, `Ver Vistoria`, `Notificar Cliente WhatsApp`.
  * **Painel Lateral de Ações Rápidas (Botões de Alta Visibilidade):**
    * `+ Iniciar Check-in 360º` (Botão grande âmbar com ícone de scanner).
    * `+ Criar Orçamento de 3 Níveis` (Botão grafite com borda dourada).
    * `+ Novo Agendamento` (Botão com ícone de calendário).
    * `🧪 Calculadora de Diluição de Químicos` (Acesso rápido de chão de oficina).

---

### 4.4. Agenda Inteligente & Gestão de Pátio "Hoje" (`/agenda`, `/hoje`)

* **Objetivo:** Organizar os horários dos boxes, impedir sobrecarga de trabalho e gerenciar serviços que duram vários dias.
* **Componentes:**
  * **Seletor de Visualização:** `Hoje (Pátio)`, `Semana (Boxes)`, `Mês (Geral)`, `Lista de Espera`.
  * **Visão Diária por Boxes de Trabalho:**
    * Colunas dedicadas aos boxes: *Box 1 (Lavação/Descontaminação)*, *Box 2 (Polimento Técnico)*, *Box 3 (Cabine de PPF/Vitrificação)*.
    * Cada agendamento é um card escuro com:
      * Horário de início e término previsto.
      * Placa Mercosul com bandeira do Brasil.
      * Modelo do carro (ex: `BMW M3 Competition - Preto Safira`).
      * Nome do cliente com ícone verde para chamar no WhatsApp com 1 toque.
      * Badge de Status: `Confirmado`, `Aguardando Chegada`, `No Pátio`, `Pronto para Entrega`.
      * **Badge de Pernoite / Continuidade:** Para serviços de 2 a 4 dias (como vitrificação e PPF), o sistema exibe `🌙 SERVIÇO EM CONTINUIDADE (DIA 2/3)`.
  * **Mecanismo Anti-Furo (Lembrete Automático):**
    * Botão `Enviar Lembrete de Agendamento`: dispara no WhatsApp do cliente a confirmação com endereço via Google Maps e aviso para retirar pertences pessoais de valor do interior do veículo.

---

### 4.5. Check-in 360º com Vistoria Vetorial e Assinatura Touch (`/checkin`)

* **Objetivo:** A ferramenta mais poderosa de **blindagem jurídica** da oficina, eliminando litígios e processos com clientes.
* **Estrutura Visual:**
  * **Passo 1: Identificação do Veículo e Entrada:**
    * Campo de Placa Mercosul com busca automática de modelo e cor (via API ou preenchimento rápido).
    * Hodômetro (quilometragem digitada em fonte mono).
    * Marcador Visual de Combustível: Seletor gráfico de tanque (`Reserva`, `1/4`, `1/2`, `3/4`, `Cheio`).
    * Pertences no Interior: Checkboxes para itens declarados (*Óculos de sol, dinheiro, ferramentas, cadeirinha infantil*).
  * **Passo 2: O Diagrama Blueprint Interativo (Silhouette 360º):**
    * Ilustração técnica vetorial em aramado (estilo CAD automotivo) com 4 ângulos: *Vista Superior (Teto e Capô)*, *Vista Frontal*, *Vista Traseira*, *Laterais Direita e Esquerda*.
    * **Mecânica de Toque na Tela:** O operador toca exatamente na peça do carro onde encontrou um problema (ex: para-lama dianteiro esquerdo).
    * Pop-up instantâneo:
      * Tipo de Avaria: *Risco Profundo*, *Risco Superficial*, *Amassado/Ondulação*, *Repintura Mal Feita*, *Roda Ralada*, *Picado de Pedra*, *Trinca de Vidro*, *Borracha Ressecada*.
      * Severidade: *Leve (Amarelo)* ou *Crítica (Vermelho)*.
      * Foto do Detalhe: Botão para abrir a câmera do celular e fotografar a avaria no mesmo instante.
    * Um pin luminoso pulsante fica fixado na coordenada exata da silhueta do carro.
  * **Passo 3: Galeria de Fotos com Marca D'Água Imutável (Timestamp):**
    * Grid com slots padronizados: *Frente, Traseira, Lateral Motorista, Lateral Passageiro, Teto, Rodas, Painel de Instrumentos, Bancos, Motor*.
    * Cada foto tirada recebe automaticamente uma tarja inferior preta translúcida gravando: `PLACA: BRA2E19 | DATA: 01/10/2026 14:32:05 | LAT/LONG REGISTRADA`. Prova jurídica incontestável.
  * **Passo 4: Termo de Responsabilidade Técnica & Alertas CDC:**
    * Caixas de ciência prévia:
      * `[x] Cliente ciente de que pintura repintada previamente pode soltar verniz.`
      * `[x] Cliente ciente de que verniz aferido com micrômetro está abaixo de 80 micras em áreas específicas.`
      * `[x] Lavagem de motor solicitada sob responsabilidade do cliente quanto a chicotes ressecados.`
  * **Passo 5: Canvas de Assinatura Digital Touch:**
    * Retângulo escuro com superfície suave onde o cliente assina diretamente com o próprio dedo na tela do celular do atendente.
    * Botões: `Limpar` e `Confirmar Assinatura`.
  * **Despacho Automático:**
    * Ao clicar em `Finalizar Check-in`, o NuvemWash gera um PDF completo com a vistoria, os pins e as fotos, e já abre o WhatsApp com a mensagem pronta para enviar o comprovante ao cliente.

---

### 4.6. Motor de Orçamentos de Elite em 3 Níveis & Minuta Jurídica (`/orcamento/novo`)

* **Objetivo:** Apresentar propostas comerciais irresistíveis que aumentam o ticket médio em até 40% através do efeito psicológico de ancoragem.
* **Componentes:**
  * **Alternador de Estrutura:** `Orçamento em 3 Níveis (Recomendado)` vs `Orçamento Simples (Nível Único)`.
  * **Os 3 Níveis de Apresentação:**
    1. **Nível 1 — "Essencial" (A Âncora Básica):**
       * Moldura grafite limpa com borda discreta.
       * Serviços básicos solicitados pelo cliente (ex: Lavagem Detalhada + Descontaminação + Cera de Carnaúba).
       * Valor total e tempo estimado (ex: R$ 350,00 | 4 horas).
    2. **Nível 2 — "Recomendado" (O Campeão de Vendas / Mais Escolhido):**
       * Moldura de destaque com **borda dupla âmbar dourada e glow suave**.
       * Badge no topo em Archivo caixa alta: `⭐ MAIS ESCOLHIDO / MELHOR CUSTO-BENEFÍCIO`.
       * Agrega os serviços fundamentais + proteção intermediária (ex: Lavagem Técnica + Polimento Comercial + Vitrificação de Plásticos e Faróis + Higienização de Couro).
       * Valor de destaque e parcelamento sugerido (ex: R$ 890,00 ou 3x de R$ 315,00).
    3. **Nível 3 — "Premium / Master Detail" (A Experiência Máxima):**
       * Moldura sofisticada índigo/platina com badge `👑 PROTEÇÃO SUPREMA 9H`.
       * O pacote completo com garantia estendida (ex: Correção de Pintura em 3 Etapas + Coating Cerâmico 9H com 3 anos de garantia + Vitrificação de Vidros e Rodas + PPF Frontal).
       * Valor de alto ticket (ex: R$ 2.450,00 ou 6x de R$ 440,00).
  * **Modal de Minuta Oficial do Advogado (CDC):**
    * Botão de grande visibilidade: **`⚖️ Aplicar Minuta Oficial do Advogado (CDC)`**.
    * Ao clicar, insere instantaneamente o texto jurídico homologado por assessoria jurídica especializada em direito do consumidor, respaldado nos **Arts. 6º, III; 8º; 14, §3º; 40; 46 e 54 do CDC**.
    * Abrange: condições do verniz prévio, autorização para testes de rodagem técnica pelo estúdio, prazo de garantia formal, tolerâncias de repintura e responsabilidades de guarda.
    * Checkbox opcional: `Imprimir Minuta Jurídica em Folha Separada no PDF do Contrato`.

---

### 4.7. Portal Público de Aprovação do Cliente (`/orcamento/:token`)

* **Objetivo:** O link web elegante que o cliente final abre no celular dele pelo WhatsApp. Não requer senha nem download de app.
* **Experiência do Consumidor Final:**
  * Design ultra-refinado e limpo, adaptado para telas mobile de qualquer tamanho.
  * Cabeçalho com o logotipo da oficina, nome do cliente e dados do veículo (com foto do modelo).
  * **Carrossel de Comparação dos 3 Níveis:** O cliente desliza os cards e compara facilmente a diferença de benefícios entre o *Essencial*, o *Recomendado* e o *Premium*.
  * **Gatilho de Conversão:**
    * Ao tocar em `APROVAR ESTA OPÇÃO` no pacote desejado, abre um modal interativo:
      * Confirmação dos dados (Nome e CPF para nota/garantia).
      * **Assinatura do Cliente com o Dedo na Tela**.
      * Aceite dos termos de garantia e minuta do CDC.
  * **Agendamento da Data:** O portal permite ao cliente escolher o dia de entrada do veículo na oficina conforme a disponibilidade da agenda.
  * **Cobrança de Sinal Automática (Pix):**
    * Se a oficina configurou sinal (ex: 20% para reserva de vaga), o portal gera imediatamente o **Pix Copia e Cola** e o **QR Code Dinâmico**.
    * A oficina recebe notificação imediata: *"Orçamento Aprovado por [Cliente] com Sinal Pago!"*.

---

### 4.8. Chão de Oficina: Cronômetro de Telemetria & Diluição (`/ordem-servico/:id`)

* **Objetivo:** A tela utilizada pelos operadores e detailers dentro do box durante a execução do serviço.
* **Componentes:**
  * **Cronômetro Digital de Telemetria:**
    * Mostrador gigante em fonte `IBM Plex Mono` com dígitos em ciano elétrico (`#5EC8FF`).
    * Botões rápidos: `Iniciar Etapa`, `Pausar (Almoço/Intervalo)`, `Concluir Etapa`.
    * Mede o tempo gasto em cada fase (Corte, Refino, Vitrificação) para calcular o custo da hora técnica real da oficina.
  * **Módulo "Antes e Depois" com Foto Comparativa:**
    * Divisor visual com foto do estado inicial (verniz opaco com riscos) e foto do estado final (verniz espelhado).
    * Ferramenta de marketing automático: gera card com layout pronto para postar nos Stories do Instagram com a logo da oficina.
  * **Calculadora de Diluição de Químicos (Gráfico de Proveta Graduada):**
    * Seletor de Recipientes: *Frasco Borrifador 500ml*, *Frasco 1 Litro*, *Pulverizador Manual 1.5L*, *Canhão Snow Foam 1L*, *Galão 5 Litros*.
    * Seletor de Proporção Técnica: `1:1`, `1:5`, `1:10`, `1:20`, `1:30`, `1:50`, `1:100`.
    * Ilustração de proveta de laboratório preenchida com líquido: mostra com precisão milimétrica a quantidade de produto concentrado em ml e a quantidade de água limpa a adicionar. Evita desperdício de produtos caros (como desengraxantes, vitrificadores e shampoos de pH ácido/básico).

---

### 4.9. Painel Financeiro: DRE em Tempo Real & Radar de Cobrança (`/financeiro`)

* **Objetivo:** Entregar a clareza de um CFO para o dono da oficina em 1 único olhar.
* **Componentes:**
  * **Demonstrativo de Resultado (DRE Sintético Visual):**
    * `(+) Faturamento Bruto` (Total cobrado dos clientes).
    * `(-) Taxas de Meios de Pagamento` (Desconto automático de taxas Asaas / maquininhas Stone/Cielo).
    * `(-) Comissões da Equipe` (Percentuais configurados por operador por serviço).
    * `(-) Custo de Insumos & Produtos` (Estimativa por carro).
    * `(=) LUCRO OPERACIONAL LÍQUIDO REAL` (Destaque em verde esmeralda `mint-400` com percentual de margem real).
  * **Gráfico de Formas de Pagamento:**
    * Distribuição percentual em pizza/rosca: Pix, Cartão de Crédito (1x a 12x), Cartão de Débito, Dinheiro, Boleto.
  * **O Radar Financeiro do Dia (Cobrança Ativa no WhatsApp):**
    * Pop-up ou seção de destaque que abre automaticamente todos os dias às 09:00:
    * Lista de clientes com parcelas vencendo hoje ou já em atraso.
    * Dados: Nome do Cliente, Carro, Valor Pendente, Dias de Atraso.
    * **Botão Verde WhatsApp (1 Toque):** Abre a conversa no WhatsApp do cliente com uma mensagem educada, elegante e personalizada já digitada, contendo o resumo do débito, a chave Pix da oficina e o link do comprovante. Transforma uma tarefa desconfortável em um processo amigável e pontual.

---

### 4.10. Motor Fiscal Integrado & Emissão de NFS-e (`/financeiro/fiscal`)

* **Objetivo:** Emitir Notas Fiscais de Serviços Eletrônicas (NFS-e) para prefeituras brasileiras via Focus NFe sem burocracia.
* **Componentes:**
  * Status da Empresa: Indicador de Certificado Digital A1 ativo (com aviso de vencimento), CNPJ, Regime Tributário (MEI ou Simples Nacional) e Alíquota de ISS configurada.
  * Emissão em 1 Clique: Na entrega do veículo, botão `⚡ Emitir Nota Fiscal Agora`. O sistema puxa os dados do cliente, os serviços realizados e comunica diretamente com a prefeitura em segundo plano.
  * Tabela Fiscal com Badges: `Autorizada` (verde), `Processando` (amarelo), `Rejeitada` (vermelho com motivo claro da prefeitura).
  * Ações: `Baixar DANFSe (PDF)` e `Baixar XML`.

---

### 4.11. "Minha Oficina": Configurações, Matriz 2D & Equipe (`/configuracoes`)

* **Objetivo:** Personalização completa da operação do estúdio.
* **Componentes (Abas Superiores Deslizantes com Navegação Rápida):**
  * **Aba 1 — Dados da Oficina:** Razão social, nome fantasia, CNPJ, upload de logotipo oficial, endereço físico, WhatsApp de contato e link do perfil no Instagram.
  * **Aba 2 — Horários & Capacidade de Pátio:** Dias de atendimento, horários de abertura e fechamento, intervalo de almoço e teto de vagas simultâneas por box de serviço.
  * **Aba 3 — Equipe & Permissões:** Cadastro de detailers, polidores e recepcionistas. Controle de quem pode ver o financeiro e quem só tem acesso ao chão de oficina e check-in.
  * **Aba 4 — Matriz de Preços 2D por Porte de Veículo:**
    * Tabela bidimensional onde as colunas são as categorias de veículos: *Pequeno (Hatch)*, *Médio (Sedan)*, *Grande (SUV/SW)*, *Extra Grande (Picape/Blindado)*.
    * As linhas são os serviços (ex: Polimento Técnico, Vitrificação 9H, Higienização).
    * Cada célula permite definir o preço em reais e o tempo estimado em minutos separadamente por porte.
  * **Aba 5 — Termos de Garantia & Minuta Jurídica:** Gestor de modelos contratuais, permitindo ao dono customizar cláusulas de acordo com os produtos que ele utiliza (Gyeon, CarPro, Vonixx, Nasiol, Ceramic Pro).

---

### 4.12. Cockpit Master Admin SaaS (`/admin`)

* **Objetivo:** O painel exclusivo dos fundadores do NuvemWash para controlar o negócio SaaS.
* **Módulos:**
  * `/admin/oficinas`: Visão multi-tenant com todas as estéticas cadastradas no país, plano ativo, status de pagamento da assinatura no Asaas, data de cadastro e atalho para suporte via WhatsApp.
  * `/admin/planos`: Editor em tempo real dos limites dos planos (teto de atendimentos finalizados, número de clientes, usuários da equipe e preços mensais).
  * `/admin/campanhas`: **Interruptor mestre de degustação (15 Dias Grátis no Cadastro)**, permitindo aos fundadores ativar ou desativar campanhas com 1 clique sem alterar código.
  * `/admin/storage`: Gráfico de consumo de armazenamento de imagens e vistorias no Supabase Storage para controle de margem de lucro operacional da infraestrutura em nuvem.
  * `/admin/modelos-termos`: Biblioteca central de minutas jurídicas elaboradas pelo advogado para distribuição imediata para a base de usuários.

---

## 5. MATRIZ OFICIAL DE PLANOS, LIMITES E GATILHOS DE MONETIZAÇÃO

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

## 6. BIBLIOTECA DE PROMPTS PRONTOS PARA MOTORES DE IA GENERATIVA

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

## 7. DIRETRIZES RIGOROSAS DE ERGONOMIA MOBILE VS DESKTOP

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

## 8. ANTI-PATTERNS & NEGATIVE PROMPTS (O QUE A IA NUNCA DEVE FAZER)

> **Instrução Rígida para IAs de Geração Visual:** Inclua os termos abaixo como **Negative Prompts** para evitar que a IA produza designs desastrosos que descaracterizem a marca NuvemWash.

### O Que é Expressamente Proibido:
* ❌ **Cores Clichês de Lava-Jato:** Nunca usar fundos azuis-bebê, gradientes arco-íris, tons pastéis infantis ou verde limão radioativo.
* ❌ **Ícones Amadores e Infantis:** Proibido usar ícones de balde de água, esponja de sabão, bolhas flutuantes, mangueira de jardim ou carros de desenho animado.
* ❌ **Interfaces Brancas Ofuscantes (Light Mode Genérico):** O NuvemWash é um cockpit escuro de alta performance. Interfaces brancas com cinza claro destroem a autoridade e a atmosfera de estúdio de detalhamento.
* ❌ **Tabelas Estilo Excel dos Anos 90:** Nada de grades cinzas chapadas e sem respiro visual. Toda lista de dados deve usar cards flutuantes com padding generoso e tipografia hierarquizada.
* ❌ **Textos Longos Sem Destaque:** Cláusulas contratuais e vistorias devem ser estruturadas com badges, tópicos com marcadores dourados e caixas com destaque visual.

---

## 9. CONCLUSÃO & COMO ALIMENTAR A IA COM ESTE DOCUMENTO

Ao orientar qualquer inteligência artificial (Midjourney, ChatGPT, Claude, Figma AI ou desenvolvedores) para criar peças da NuvemWash, instrua da seguinte forma:

> *"Atue como o Head de Design de Produto da NuvemWash. Utilize as diretrizes oficiais de cores (#0F1216, #FF8A3D, #5EC8FF, #3ED598), as fontes (Archivo, IBM Plex Sans, IBM Plex Mono) e o arquétipo de Cockpit Tecnológico de Pista especificados na Bíblia Mestre de Produto para gerar a tela / mockup / criativo solicitado, respeitando a blindagem jurídica e a linguagem profissional de estética automotiva."*

Este documento representa o ativo central de engenharia, vendas e produto da NuvemWash. Qualquer material gerado com base nele terá coerência visual e comercial imbatível.
