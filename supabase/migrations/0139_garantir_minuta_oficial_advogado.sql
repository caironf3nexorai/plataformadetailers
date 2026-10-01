-- ==============================================================================
-- MIGRAÇÃO 0139: Inserção Garantida da Minuta Oficial do Advogado (CDC)
-- Garante que o Termo de Ciência e Autorização com Risco Específico (Minuta CDC)
-- e o Termo Oficial de Garantia Técnica estejam gravados no banco de dados.
-- ==============================================================================

-- 1. Insere o Termo de Ciência e Autorização com Risco Específico (Minuta Oficial do Advogado - CDC)
INSERT INTO public.plataforma_modelos_termos (
  titulo, categoria, tipo_servico, descricao, conteudo_texto, destaque, ativo, permitir_download
) 
SELECT
  'Termo de Ciência e Autorização com Risco Específico (Minuta Oficial do Advogado - CDC)',
  'responsabilidade',
  NULL,
  'Minuta oficial enviada e validada pelo advogado da sua empresa, amparada nos Arts. 6º, III; 8º; 14, §3º; 40; 46 e 54, §4º do CDC. Cobre vícios ocultos, defeitos preexistentes, peças ressecadas e falta de manutenção.',
  'Pelo presente instrumento, eu, CLIENTE devidamente identificado(a) na Ordem de Serviço / Orçamento em referência, DECLARO ter sido prévia, clara e adequadamente informado(a) (Art. 6º, III e Art. 8º do CDC) pela OFICINA CONTRATADA sobre a natureza dos serviços a serem realizados, bem como sobre os RISCOS ESPECÍFICOS e inerentes à execução dos trabalhos técnicos solicitados.

1. DA ANÁLISE PRÉVIA E VÍCIOS PREEXISTENTES (Art. 14, §3º, I do CDC):
Declaro ciência inequívoca de que o veículo entregue possui desgastes naturais de uso, histórico de manutenções anteriores, intempéries e/ou eventuais intervenções de terceiros. Estou ciente de que vernizes finos ou com repintura anterior (< 80 micras), trincas camufladas por sujidade pesada, peças plásticas e borrachas ressecadas pelo tempo/calor térmico, forros de teto fragilizados e componentes elétricos/eletrônicos sensíveis podem manifestar quebras, descolamentos ou avarias decorrentes exclusivamente do estado preexistente de fadiga estrutural do material durante a manipulação técnica indispensável para a realização do serviço.

2. DA EXCLUSÃO DE RESPONSABILIDADE (Art. 14, §3º, II do CDC):
Reconheço que a oficina executará os procedimentos com a melhor técnica e insumos profissionais disponíveis no mercado. Isento a oficina de qualquer indenização ou reparação por avarias ou falhas elétricas, mecânicas ou estéticas decorrentes exclusivamente de: a) Peças ou presilhas ressecadas e quebradiças prévias; b) Rompimento inevitável de filamentos térmicos em remoção de insulfilm envelhecido; c) Desplacamento de repinturas sem aderência mecânica original; d) Falhas elétricas em conectores ou módulos com oxidação oculta prévia.

3. DA AUTORIZAÇÃO EXPRESSA E ACEITE CONTRATUAL (Art. 40 e 54 do CDC):
Tendo pleno conhecimento de tais condições técnicas e riscos apresentados, AUTORIZO EXPRESSAMENTE a realização dos serviços constantes na proposta comercial.',
  true,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.plataforma_modelos_termos 
  WHERE titulo ILIKE '%Minuta Oficial do Advogado - CDC%'
);

-- 2. Garante o Termo Oficial de Garantia Técnica (Minuta Oficial do Advogado)
INSERT INTO public.plataforma_modelos_termos (
  titulo, categoria, tipo_servico, descricao, conteudo_texto, destaque, ativo, permitir_download
)
SELECT
  'Termo Oficial de Garantia Técnica (Minuta Oficial do Advogado)',
  'garantia',
  'geral',
  'Minuta oficial do advogado cobrindo a garantia do serviço com exclusões legais (acidentes, desgaste natural, produtos químicos, agentes ambientais e intervenção de terceiros).',
  'A [NOME DA EMPRESA] garante os serviços executados pelo prazo de [PRAZO DE GARANTIA] informado na OS, exclusivamente contra falhas decorrentes da execução do serviço.

EXCLUSÕES DE GARANTIA: acidentes, impactos, desgaste natural, falta de manutenção, uso inadequado, produtos químicos ou corrosivos, seivas, dejetos de aves, agentes ambientais, lavagem incorreta, intervenção de terceiros, defeitos preexistentes ou problemas sem relação com o serviço realizado.

O cliente declara estar ciente das condições e orientações de conservação.',
  true,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.plataforma_modelos_termos 
  WHERE titulo ILIKE '%Termo Oficial de Garantia Técnica (Minuta Oficial do Advogado)%'
);
