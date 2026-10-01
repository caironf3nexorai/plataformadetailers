-- ==============================================================================
-- MIGRAÇÃO 0132: Reestruturação e Desduplicação dos Modelos de Termos da Plataforma
-- 1. Separação categórica entre TERMOS DE GARANTIA (pós-serviço/cobertura) e
--    TERMOS DE RESPONSABILIDADE & RISCOS TÉCNICOS (pré-serviço/vícios ocultos CDC).
-- 2. Separação de Insulfilm (vidros) e PPF (pintura/lataria).
-- 3. Adição de Termo para Plásticos e Borrachas (Revitalização/Vitrificação).
-- 4. Eliminação de duplicidades em Martelinho de Ouro e Estofados/Couro.
-- ==============================================================================

-- Limpa modelos antigos com inconsistências ou duplicações para recriá-los de forma limpa e categorizada
DELETE FROM public.plataforma_modelos_termos 
WHERE titulo IN (
  'Garantia para Películas de Controle Solar e Proteção (Insulfilm/PPF)',
  'Garantia Técnica para Microreparo / Martelinho de Ouro (PDR)',
  'Termo de Garantia e Cuidados para Lavagem Técnica de Motor'
);

-- Atualiza títulos e categorias dos existentes se necessário
UPDATE public.plataforma_modelos_termos
SET categoria = 'garantia'
WHERE titulo = 'Termo Oficial de Garantia Técnica (Minuta Oficial do Advogado)';

-- Insere ou atualiza o catálogo padronizado e desduplicado da plataforma
INSERT INTO public.plataforma_modelos_termos (
  titulo, categoria, tipo_servico, descricao, conteudo_texto, destaque, ativo
) VALUES
-- -----------------------------------------------------------------------------
-- 1. TERMOS DE GARANTIA (Cobertura do serviço executado e prazos legais)
-- -----------------------------------------------------------------------------
(
  'Termo Oficial de Garantia Técnica (Minuta Oficial do Advogado)',
  'garantia',
  'geral',
  'Minuta padrão com exclusões legais (acidentes, desgaste natural, produtos químicos e intervenção de terceiros). Ideal para uso geral em Orçamentos e OS.',
  'A [NOME DA EMPRESA] garante os serviços executados pelo prazo de [PRAZO DE GARANTIA] informado na OS, exclusivamente contra falhas decorrentes da execução do serviço.

EXCLUSÕES DE GARANTIA: acidentes, impactos, desgaste natural, falta de manutenção, uso inadequado, produtos químicos ou corrosivos, seivas, dejetos de aves, agentes ambientais, lavagem incorreta, intervenção de terceiros, defeitos preexistentes ou problemas sem relação com o serviço realizado.

O cliente declara estar ciente das condições e orientações de conservação.',
  true,
  true
),
(
  'Garantia Técnica para Vitrificação / Revestimento Cerâmico',
  'garantia',
  'vitrificacao',
  'Garantia de durabilidade de brilho, hidro-repelência e proteção química de coatings cerâmicos, condicionada a manutenções periódicas e cura inicial.',
  'A presente garantia cobre as propriedades hidrofóbicas, brilho e proteção química do revestimento cerâmico aplicado sobre a pintura do veículo, condicionada aos seguintes cuidados: 1) Respeitar o tempo de cura total inicial de 7 (sete) dias sem lavagens com produtos químicos; 2) Utilizar exclusivamente shampoos de pH neutro específicos para estética automotiva em lavagens posteriores; 3) Realizar as revisões periódicas na oficina a cada 6 (seis) meses; 4) A garantia não cobre danos decorrentes de chuva ácida prolongada não lavada, dejetos de aves ou seiva de árvores não removidos imediatamente, atritos físicos, lavagens em postos com rolos automáticos ou produtos alcalinos/ácidos pesados.',
  true,
  true
),
(
  'Garantia para Películas de Controle Solar (Insulfilm)',
  'garantia',
  'insulfilm',
  'Garantia técnica para insulfilm e películas térmicas em vidros, cobrindo descolamento, bolhas e desbotamento de tonalidade.',
  'Garantimos a película de controle solar aplicada contra descolamento espontâneo, formação de bolhas de ar e desbotamento precoce de tonalidade pelo prazo acordado. Condições essenciais de garantia: 1) É estritamente proibido abrir ou abaixar os vidros nas primeiras 72 (setenta e duas) horas após a aplicação para permitir a cura da ancoragem adesiva; 2) Não utilizar produtos limpa-vidros à base de amoníaco ou esponjas abrasivas; 3) A garantia não cobre riscos físicos causados por anéis, relógios, cintos de segurança ou guarnições internas com sujeira incrustada preexistente.',
  true,
  true
),
(
  'Garantia para Paint Protection Film (PPF)',
  'garantia',
  'ppf',
  'Garantia para películas de proteção de pintura em poliuretano termoplástico (TPU) contra amarelamento, delaminação e perda de autorregeneração.',
  'Garantimos a película protetora PPF (Paint Protection Film) aplicada contra amarelamento, delaminação, rachaduras espontâneas e perda de propriedades autorregenerativas (self-healing) pelo prazo acordado. Exclusões expressas: 1) Impactos severos que ultrapassem a capacidade mecânica do filme e atinjam a chapa; 2) Uso de jatos de alta pressão a menos de 40 cm de distância direta das bordas do filme; 3) Aplicação de solventes ou produtos abrasivos sobre as quinas da película.',
  true,
  true
),
(
  'Garantia Técnica para Revitalização e Proteção de Plásticos',
  'garantia',
  'plasticos',
  'Garantia para restauração, revitalização e vitrificação de plásticos e para-choques externos contra esbranquiçamento precoce.',
  'Garantimos a ancoragem do revestimento protetor e a uniformidade da restauração da pigmentação de plásticos e borrachas externos pelo prazo acordado. A garantia assegura proteção UV e hidro-repelência. Exclusões: 1) Lavagem com produtos químicos desengraxantes pesados (solupan/atativ) que removem o revestimento molecular; 2) Plásticos que já se encontravam ressecados a ponto de esfarelamento ou trincas estruturais decorrentes de exposição solar anterior à aplicação.',
  true,
  true
),
(
  'Garantia Técnica para Higienização Interna & Estofados',
  'garantia',
  'higienizacao',
  'Termo de garantia de desinfecção, eliminação de ácaros e neutralização de odores orgânicos na entrega.',
  'Garantimos a higienização profunda, desinfecção e eliminação de ácaros e odores orgânicos presentes no momento da execução dos serviços. O cliente declara ciência de que manchas antigas de sangue, ferrugem, tintas de caneta ou fluidos que tenham sofrido reações químicas anteriores com a fibra do tecido podem ser irreversíveis sem danificar o substrato original. A garantia não cobre novos derramamentos de líquidos, alimentos, urina de animais de estimação ou proliferação de fungos decorrentes de janelas fechadas com o veículo exposto à umidade após a retirada da oficina.',
  true,
  true
),
(
  'Garantia Técnica para Microreparo e Martelinho de Ouro (PDR)',
  'garantia',
  'microreparo',
  'Garantia de alinhamento e retorno estrutural de chapas metálicas desamassadas pela técnica PDR.',
  'A garantia cobre a estabilidade do alinhamento estrutural da chapa desamassada pela técnica de Martelinho de Ouro (PDR), assegurando que o ponto trabalhado não retorne ao amassado espontaneamente. A garantia não cobre microtrincas ou desplacamento de tinta em peças que já possuíam repintura anterior com massa plástica, verniz sem aderência original ou repuxamento em áreas onde o vinco sofreu estiramento excessivo prévio do metal.',
  true,
  true
),
-- -----------------------------------------------------------------------------
-- 2. TERMOS DE RESPONSABILIDADE & RISCOS TÉCNICOS OCULTOS (Pré-serviço CDC)
-- -----------------------------------------------------------------------------
(
  'Termo de Ciência e Risco Técnico para Plásticos e Guarnições',
  'responsabilidade',
  'plasticos',
  'Cláusula de proteção para plásticos ressecados, travas frágeis e para-choques esbranquiçados pelo sol.',
  'Declaro estar ciente de que plásticos e guarnições de borracha do veículo sofrem degradação contínua e ressecamento decorrentes da radiação solar e intempéries. Autorizo os procedimentos técnicos de limpeza e restauração ciente de que presilhas, travas e superfícies plásticas fragilizadas pelo tempo possuem risco inerente de quebra ou absorção irregular decorrente do estado de conservação preexistente (Art. 14, §3º, I do CDC).',
  false,
  true
),
(
  'Termo de Ciência e Risco para Remoção de Insulfilm e Vidros',
  'responsabilidade',
  'insulfilm',
  'Cláusula preventiva contra quebra de filamentos do desembaçador traseiro fundidos à cola antiga.',
  'Declaro ciência de que películas de insulfilm envelhecidas ou aplicadas há longo período fundem sua camada adesiva aos vidros e aos filamentos do desembaçador térmico traseiro. Autorizo a remoção da película e raspagem da cola ciente do risco físico inevitável de rompimento de filamentos elétricos já fragilizados pelo calor térmico preexistente, isentando a oficina de danos decorrentes do desgaste natural do componente (Art. 14, §3º, I do CDC).',
  false,
  true
)
ON CONFLICT DO NOTHING;
