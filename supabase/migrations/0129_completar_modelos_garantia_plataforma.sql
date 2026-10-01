-- ==============================================================================
-- MIGRAÇÃO 0129: Completar Modelos de Termos de Garantia e Responsabilidade
-- Popula a biblioteca da plataforma com modelos para todas as categorias de serviços:
-- Higienização, Microreparo, Insulfilm, Geral, Couro, Vidros, etc.
-- ==============================================================================

INSERT INTO public.plataforma_modelos_termos (
  titulo, categoria, tipo_servico, descricao, conteudo_texto, destaque, ativo
) VALUES
(
  'Garantia Técnica para Higienização Interna & Estofados',
  'garantia',
  'higienizacao',
  'Termo de garantia para limpeza profunda de bancos, carpetes e estofados, delimitando limites sobre manchas antigas fixadas e cuidados pós-entrega.',
  'Garantimos a higienização profunda, desinfecção e eliminação de ácaros e odores orgânicos presentes no momento da execução dos serviços. O cliente declara ciência de que manchas de sangue, ferrugem, tintas de caneta ou fluidos que tenham sofrido reações químicas anteriores com a fibra do tecido podem ser irreversíveis sem danificar o substrato original. A garantia não cobre novos derramamentos de líquidos, alimentos, urina de animais de estimação ou proliferação de fungos decorrentes de janelas fechadas com o veículo exposto à umidade após a retirada da oficina.',
  true,
  true
),
(
  'Garantia Técnica para Microreparo / Martelinho de Ouro (PDR)',
  'garantia',
  'microreparo',
  'Garantia de alinhamento e retorno estrutural de chapas metálicas, com ressalvas expressas sobre repinturas anteriores e massa plástica.',
  'A garantia cobre a estabilidade do alinhamento estrutural da chapa desamassada pela técnica de Martelinho de Ouro (PDR), assegurando que o ponto trabalhado não retorne ao amassado espontaneamente. A garantia não cobre microtrincas ou desplacamento de tinta em peças que já possuíam repintura anterior com massa plástica, verniz sem aderência original ou repuxamento em áreas onde o vinco sofreu estiramento excessivo prévio do metal.',
  true,
  true
),
(
  'Garantia para Películas de Controle Solar e Proteção (Insulfilm/PPF)',
  'garantia',
  'insulfilm',
  'Garantia para aplicação de insulfilm e películas térmicas, cobrindo descolamento, bolhas e desbotamento de tonalidade.',
  'Garantimos a película aplicada contra descolamento espontâneo, formação de bolhas de ar e desbotamento precoce da tonalidade pelo prazo acordado. Condições essenciais de garantia: 1) É estritamente proibido abrir ou abaixar os vidros nas primeiras 72 (setenta e duas) horas após a aplicação para permitir a cura da ancoragem adesiva; 2) Não utilizar produtos limpa-vidros à base de amoníaco ou esponjas abrasivas; 3) A garantia não cobre riscos físicos causados por anéis, relógios, cintos de segurança ou guarnições internas com sujeira incrustada preexistente.',
  true,
  true
),
(
  'Termo Geral de Garantia da Oficina (CDC Art. 26)',
  'garantia',
  'geral',
  'Modelo geral de garantia em conformidade com o Artigo 26 do Código de Defesa do Consumidor (CDC) para serviços de estética automotiva.',
  'A oficina assegura garantia legal de 90 (noventa) dias sobre todos os serviços de estética e detalhamento automotivo executados, nos estritos termos do Art. 26, II do Código de Defesa do Consumidor (Lei nº 8.078/90). EXCLUSÕES EXPRESSAS DE GARANTIA: Danos decorrentes de colisões, impactos de pedras, desgaste natural por uso rodoviário contínuo, lavagens posteriores inadequadas com produtos decapantes/ácidos/alcalinos não homologados, intervenção de terceiros ou falhas derivadas de defeitos preexistentes e ressalvados expressamente na vistoria inicial.',
  true,
  true
),
(
  'Garantia Técnica para Tratamento e Hidratação de Couro',
  'garantia',
  'geral',
  'Garantia técnica para higienização e hidratação de revestimentos em couro natural e sintético com proteção UV.',
  'Garantimos a limpeza profunda com desobstrução dos poros e a correta aplicação de condicionador térmico com proteção anti-UV. Não há cobertura para descascamentos ou perda de pigmentação em peças de couro sintético ou repinturas anteriores que já se encontravam ressecadas, trincadas ou com a camada de acabamento (topcoat) degradada pelo atrito e radiação solar anterior à entrada na oficina.',
  false,
  true
),
(
  'Garantia para Remoção de Chuva Ácida e Cristalização de Vidros',
  'garantia',
  'geral',
  'Garantia para desoxidação química e proteção hidro-repelente do para-brisa e vidros laterais.',
  'Garantimos a remoção dos depósitos minerais incrustados (chuva ácida) e a eficácia da repelência da cristalização aplicada. O cliente declara ciência de que a desoxidação química pode evidenciar riscos prévios causados por palhetas desgastadas ou atrito mecânico de poeira, os quais estavam encobertos pela película de calcificação. A manutenção da garantia condiciona-se ao uso de palhetas em bom estado e fluído neutro no reservatório do limpador.',
  false,
  true
),
(
  'Termo de Responsabilidade para Pátio, Pertences e Teste de Rodagem',
  'responsabilidade',
  NULL,
  'Modelo focado em segurança patrimonial de pátio, desresponsabilização sobre objetos deixados no interior e autorização de manobras e rodagem técnica.',
  'Declaro que entreguei o veículo discriminado para a realização dos serviços contratados, tendo procedido à retirada prévia de todo e qualquer objeto de valor, moeda, eletrônico ou documento pessoal, isentando a oficina de qualquer responsabilidade por itens não expressamente catalogados na vistoria de entrada. Autorizo a realização de testes de rodagem técnica e deslocamento em pátio estritamente necessários para validação e diagnóstico dos serviços. Declaro ciência de que o veículo deverá ser retirado em até 48 horas após a notificação de conclusão dos serviços, sujeitando-se após esse prazo à cobrança de taxa de pátio e guarda.',
  false,
  true
),
(
  'Termo de Responsabilidade para Veículos Antigos ou Customizados',
  'responsabilidade',
  NULL,
  'Proteção reforçada para veículos com mais de 10 anos, chicotes ressecados, peças descontinuadas e pinturas antigas sem verniz PU.',
  'Declaro estar ciente de que o veículo possui características de desgaste decorrentes da idade de fabricação e/ou customizações anteriores. Reconheço e autorizo a execução dos serviços tendo sido expressamente advertido(a) de que chicotes elétricos, guarnições de borracha, presilhas plásticas ressecadas pelo calor, emblemas originais e vernizes antigos podem sofrer avarias decorrentes da simples manipulação técnica, não cabendo responsabilização da oficina por desgastes ou quebras decorrentes exclusivamente da fadiga preexistente dos materiais (Art. 14, §3º, I e II do CDC).',
  true,
  true
)
ON CONFLICT DO NOTHING;
