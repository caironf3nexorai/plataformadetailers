# Arquitetura e Regras de Navegação — Plataforma Detailers

Este documento estabelece as diretrizes arquiteturais, de ergonomia e de segurança para toda a navegação (Desktop e Mobile) da Plataforma Detailers.

---

## 1. As 4 Categorias Fixas

Toda e qualquer funcionalidade interna da plataforma pertence obrigatoriamente a uma das **quatro categorias fundamentais**:

1. **OPERAÇÃO**  
   Rotinas do dia a dia da oficina (atendimentos, pátio e serviços imediatos).  
   *Módulos atuais:* Dashboard (Painel), Agenda, Clientes, Orçamentos, Serviços, Estoque.

2. **FINANCEIRO & ESTRATÉGIA**  
   Gestão de caixa, precificação, custos e inteligência comercial.  
   *Módulos atuais:* Financeiro (DRE/Fluxo/Contas), Precificação Inteligente.

3. **RECURSOS & CONTEÚDO**  
   Ferramentas auxiliares, capacitação e materiais digitais para a oficina.  
   *Módulos atuais:* Academia Detailer (Treinamentos), Arquivos Digitais, Calculadora de Diluição, Indique e Ganhe.

4. **GESTÃO & SISTEMA**  
   Configurações da oficina, dados cadastrais, equipe, horários e integração.  
   *Módulos atuais:* Minha Oficina (Configurações Gerais).

> **Regra de Novos Módulos:** Nenhum novo módulo deve ser criado solto ou criar uma 5ª categoria principal sem aprovação arquitetural. Todo novo recurso deve ser inserido em uma das 4 categorias existentes.

> **Regra de Divisão de Categoria:** Se qualquer uma das 4 categorias ultrapassar **6 itens ativos**, a categoria deve ser dividida em subseções temáticas para manter a legibilidade e evitar sobrecarga cognitiva.

---

## 2. Barra Inferior Mobile (`BottomNav`)

A barra de navegação inferior mobile segue princípios estritos de ergonomia (*thumb zone*) e adequação ao papel do usuário:

* **Limite Máximo Congelado:** A barra inferior suporta **no máximo 5 itens**.
* **Variação Estrita por Papel:**
  * **Dono e Gerente (5 itens):**
    1. `Painel` (Dashboard)
    2. `Agenda`
    3. `Clientes`
    4. `Financeiro`
    5. `Menu` (Abre o Drawer completo)
  * **Operador (3 itens):**
    1. `Agenda`
    2. `Clientes`
    3. `Menu` (Abre o Drawer completo)
* **Regra de Inexistência de Botões Proibidos:** Se o papel do usuário não possui permissão para acessar uma tela (ex: Operador tentando ver Dashboard ou Financeiro), o botão **NÃO** deve existir na barra inferior (evitando botões desabilitados ou que gerem erro ao toque).

---

## 3. Drawer Mobile (Menu Deslizante) & Ergonomia

* **Sentido de Abertura:** O Drawer mobile abre obrigatoriamente pela **direita** (`slide-in from right`) ou por baixo (*bottom-sheet*), nunca pela esquerda. Isso garante que o usuário consiga alcançar o menu, rolar itens e fechá-lo utilizando apenas uma mão (*one-handed operation*).
* **Paridade Total com Desktop:** O Drawer mobile exibe:
  * Seletor de oficinas/tenants (para contas multi-oficina).
  * Badges de Plano (*Plano Pro*, etc.) e Cargo (*Dono*, *Gerente*, *Operador*).
  * Atalho exclusivo para o Painel Admin da Plataforma (com badge de notificações para administradores).
  * As 4 categorias com controle de permissão em tempo real.
  * Rodapé com dados da conta (Nome, E-mail) e botão de Logout.
* **Safe Area (iOS / Android):** O Drawer, a barra inferior e o botão flutuante respeitam as variáveis `env(safe-area-inset-bottom)` e `env(safe-area-inset-top)` para prevenir sobreposição com a barra de navegação/gestos do iPhone e entalhes de tela.

---

## 4. Camadas de Segurança e Guards de Rota

A ocultação visual no menu é apenas auxílio de interface; a segurança de acesso é garantida em múltiplas camadas:

1. **Guards de Rota (`RotaProtegida` / `AdminGuard`):**  
   Toda rota restrita é envolvida por um guard declarativo com `allowedRoles`. Exemplo: rotas `/financeiro`, `/orcamentos`, `/estoque`, `/servicos` exigem `['dono', 'gerente']`.
2. **Tentativa de Acesso Direto via URL:**  
   Se um usuário com papel de `operador` digitar manualmente `/financeiro` ou `/orcamentos` na barra de endereço do navegador, o roteador intercepta a requisição e renderiza o componente `<AcessoNegado />`.
3. **Redirecionamento do Dashboard:**  
   Se um operador acessar a rota raiz `/` ou `/dashboard`, ele é imediatamente redirecionado para a `/agenda` (sua tela principal de trabalho).
4. **Row Level Security (RLS) no Supabase:**  
   Todas as tabelas e funções RPC executam verificação de `tenant_id` e permissão no PostgreSQL, garantindo que mesmo com requisições forçadas de API, nenhum dado não autorizado seja exposto.
