# Política de Privacidade — Plataforma Detailers
**Versão:** v1.0  
**Data de Vigência:** 29 de Agosto de 2026  

---

A sua privacidade e a proteção dos dados da sua oficina e dos seus clientes são compromissos centrais da **Plataforma Detailers**. Esta Política de Privacidade explica, de maneira transparente e em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018), como coletamos, tratamos, armazenamos e protegemos seus dados.

---

## 1. Quem é Quem na LGPD: Papéis e Responsabilidades

Para entender como a lei se aplica, dividimos as pessoas em dois grupos distintos:

### Grupo A: Você, sua Equipe e sua Oficina (Assinantes)
* **Quem são:** Os proprietários, gerentes e funcionários que utilizam a Plataforma Detailers para gerenciar a oficina.
* **Papel da Plataforma:** Somos a **Controladora** dos seus dados cadastrais, de login e de faturamento. Decidimos como esses dados são tratados para prestar o serviço contratado.

### Grupo B: Seus Clientes Finais (Proprietários dos Veículos)
* **Quem são:** As pessoas que contratam a sua oficina, realizam agendamentos online, aprovam orçamentos e assinam vistorias.
* **Papel da sua Oficina:** A sua oficina é a **Controladora** desses dados. É você quem decide quais dados coletar e mantém a relação direta com o cliente.
* **Papel da Plataforma:** Somos estritamente a **Operadora**. Apenas processamos, armazenamos e organizamos os dados dos seus clientes em seu nome, seguindo suas instruções e protegendo as informações no sistema.

---

## 2. Quais Dados Coletamos e Por Quê (Bases Legais)

### A. Dados dos Assinantes e Usuários da Oficina
* **Dados coletados:** Nome completo, e-mail, telefone/WhatsApp, senha criptografada, nome da oficina, CNPJ/CPF, endereço e histórico de pagamentos da assinatura.
* **Finalidades:** Autenticação no sistema, emissão de cobranças, suporte ao cliente, avisos operacionais e liberação de recursos do plano.
* **Base Legal (LGPD):** Execução de contrato (Art. 7º, V) e cumprimento de obrigação legal ou regulatória (Art. 7º, II).

### B. Dados dos Clientes Finais da Oficina
* **Dados coletados:** Nome, telefone/WhatsApp, modelo do veículo, placa, categoria, fotos de vistoria (check-in/check-out), fotos de execução, observações de avarias e assinaturas digitais.
* **Finalidades:** Registro do agendamento, emissão de ordem de serviço (OS), envio de orçamento por WhatsApp, comprovação do estado do veículo na entrega e cálculo de garantia.
* **Base Legal (LGPD):** Consentimento do titular (Art. 7º, I) e legítimo interesse da oficina para comprovação e execução dos serviços contratados (Art. 7º, IX).

---

## 3. Com Quem Compartilhamos os Dados

A Plataforma Detailers **não vende e não comercializa dados pessoais**. Compartilhamos apenas o estritamente necessário com os seguintes fornecedores de infraestrutura e serviços essenciais:

1. **Supabase Inc.**: Provedor de infraestrutura de banco de dados em nuvem (PostgreSQL), autenticação segura e armazenamento de arquivos e fotos.
2. **Asaas Gestão Financeira S.A.**: Instituição de pagamentos parceira responsável pelo processamento de faturas, cartões de crédito, boletos e chaves PIX para liquidação das assinaturas.
3. **Vercel Inc.**: Provedor de hospedagem de alta disponibilidade da aplicação web e distribuição de conteúdo com proteção SSL/TLS.

---

## 4. Onde os Dados Ficam Armazenados (Transferência Internacional)

* Os dados são armazenados em servidores de nuvem de alta segurança mantidos pela Supabase na região **[REGIÃO DO PROJETO SUPABASE: ex. sa-east-1 (São Paulo, Brasil) ou us-east-1 (Virgínia, Estados Unidos)]**.
* Sempre que houver armazenamento ou processamento em servidores localizados fora do território brasileiro, a Plataforma Detailers assegura que os provedores adotam padrões internacionais rigorosos de segurança e criptografia, em conformidade com o Artigo 33 da LGPD.

---

## 5. Prazos de Retenção e Expurgo de Dados

* **Dados Cadastrais da Oficina:** Mantidos enquanto a conta da oficina estiver ativa ou pelo prazo necessário para cumprimento de obrigações fiscais e legais (mínimo de 5 anos para notas e transações financeiras).
* **Fotos de Vistoria de Entrada e Saída (Check-in/Check-out):** Mantidas por tempo indeterminado como registro probatório de integridade do veículo e proteção jurídica mútua contra contestações de avarias.
* **Fotos de Execução dos Serviços:** Retidas conforme o limite temporal do plano contratado pela oficina (**30 dias** no plano Free, **90 dias** no Pro e **365 dias** no Studio) e eliminadas automaticamente após o período.
* **Consentimentos Registrados:** Armazenados de forma imutável com data, IP e versão do documento para fins de auditoria de conformidade com a LGPD.

---

## 6. Direitos do Titular de Dados

Conforme o artigo 18 da LGPD, qualquer titular (seja o dono da oficina ou o cliente final) tem direito de solicitar:
1. Confirmação da existência de tratamento de dados;
2. Acesso aos dados existentes;
3. Correção de dados incompletos, inexatos ou desatualizados;
4. Eliminação ou anonimização de dados desnecessários ou tratados em desconformidade com a lei;
5. Portabilidade dos dados;
6. Informação sobre entidades públicas e privadas com as quais os dados foram compartilhados;
7. Revogação do consentimento.

* **Canal de Atendimento:** As solicitações devem ser encaminhadas para o e-mail `[privacidade@plataformadetailers.com.br]`. Responderemos no prazo legal de até **15 (quinze) dias úteis**.
* *Nota para Clientes Finais:* Caso você seja cliente de uma oficina que usa nosso software, você também pode solicitar a retificação ou exclusão diretamente na oficina que coletou seus dados.

---

## 7. Medidas de Segurança da Informação

Adotamos salvaguardas técnicas e administrativas para proteger as informações contra acessos não autorizados, perda ou destruição:
* **Isolamento entre Oficinas (Multi-Tenant RLS):** Políticas estritas a nível de banco de dados (*Row Level Security*) garantem que uma oficina jamais visualize dados, clientes ou fotos de outra.
* **Criptografia em Trânsito:** Toda a navegação e comunicação com nossos servidores ocorrem exclusivamente sob protocolo seguro HTTPS com certificado SSL/TLS 1.3.
* **Armazenamento Privado de Fotos:** As evidências e assinaturas de vistoria são guardadas em repositórios privados com links temporários assinados e expiração automática.
* **Controle por Papéis (RBAC):** Permissões diferenciadas para Dono, Gerente e Operador dentro de cada oficina.
* **Criptografia de Senhas:** Senhas são gravadas com funções de hash criptográfico irreversível.

---

## 8. Uso do Armazenamento Local no Navegador

Utilizamos o armazenamento local do navegador (*localStorage*) e cookies de sessão estritamente necessários para manter seu login ativo, salvar preferências de tema e garantir a segurança das requisições autenticadas. Não utilizamos cookies de terceiros para rastreamento de navegação externa ou publicidade invasiva.

---

## 9. Encarregado pelo Tratamento de Dados (DPO)

Para esclarecer dúvidas sobre esta Política de Privacidade ou exercer seus direitos de privacidade, entre em contato com nosso Encarregado:

* **Encarregado (DPO):** [NOME DO ENCARREGADO / DPO]
* **E-mail de Contato:** [dpo@plataformadetailers.com.br] ou [privacidade@plataformadetailers.com.br]
