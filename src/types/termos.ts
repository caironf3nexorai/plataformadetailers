export type TipoTermoGarantia =
  | 'lavagem_motor'
  | 'polimento'
  | 'vitrificacao'
  | 'microreparo'
  | 'higienizacao'
  | 'insulfilm'
  | 'ppf'
  | 'plasticos'
  | 'geral';

export interface TermoGarantia {
  id: string;
  tenant_id: string;
  tipo: TipoTermoGarantia | string;
  categoria?: 'garantia' | 'responsabilidade';
  titulo: string;
  conteudo: string;
  padrao?: boolean;
  ativo?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface OpcaoTipoTermo {
  tipo: TipoTermoGarantia;
  label: string;
  descricao: string;
  placeholder: string;
}

export const TIPOS_TERMOS_GARANTIA: OpcaoTipoTermo[] = [
  {
    tipo: 'polimento',
    label: 'Polimento Técnico',
    descricao: 'Correção de verniz, corte, refino e lustro',
    placeholder:
      'Ex: A garantia do polimento cobre a remoção de micro-riscos (swirls) e manchas de oxidação conforme acordado na avaliação. Não cobre marcas ocasionadas por lavagens inadequadas posteriores, produtos ácidos/alcalinos agressivos ou excrementos de pássaros não removidos imediatamente.',
  },
  {
    tipo: 'vitrificacao',
    label: 'Vitrificação / Proteção Cerâmica',
    descricao: 'Coating cerâmico com garantia de hidro-repelência',
    placeholder:
      'Ex: O revestimento cerâmico possui cobertura contra perda de brilho e desgaste precoce por até [X meses], condicionada à realização de manutenções com shampoo neutro e respeitando o tempo de cura inicial de 7 dias.',
  },
  {
    tipo: 'plasticos',
    label: 'Plásticos e Borrachas',
    descricao: 'Revitalização e vitrificação de plásticos e para-choques',
    placeholder:
      'Ex: A garantia assegura a fixação do revestimento e a repelência contra esbranquiçamento precoce. Não cobre lavagens agressivas com desengraxantes pesados (solupan/atativ) ou plásticos já esfarelados por radiação solar anterior.',
  },
  {
    tipo: 'insulfilm',
    label: 'Películas de Controle Solar (Insulfilm)',
    placeholder:
      'Ex: A garantia cobre descolamento, bolhas e desbotamento de cor por até [X anos]. Recomenda-se não acionar os vidros nas primeiras 72 horas após a aplicação.',
    descricao: 'Instalação de películas térmicas em vidros',
  },
  {
    tipo: 'ppf',
    label: 'Paint Protection Film (PPF)',
    descricao: 'Película transparente de poliuretano para lataria e pintura',
    placeholder:
      'Ex: Garantia contra amarelamento, delaminação e perda de autorregeneração (self-healing) por até [X anos]. Exclui jatos de alta pressão diretos sobre as bordas da película.',
  },
  {
    tipo: 'higienizacao',
    label: 'Higienização Interna',
    descricao: 'Limpeza profunda de estofados, couro e teto',
    placeholder:
      'Ex: A higienização profunda elimina manchas orgânicas, ácaros e odores presentes na entrega do veículo. Não cobre novos derramamentos de substâncias após a retirada.',
  },
  {
    tipo: 'microreparo',
    label: 'Microreparo / Martelinho (PDR)',
    descricao: 'Remoção de amassados sem repintura',
    placeholder:
      'Ex: O serviço de microreparo e martelinho visa devolver o alinhamento original da chapa sem repintura. Caso a área possua repintura antiga ou verniz fragilizado, a garantia limita-se à integridade estrutural trabalhada.',
  },
  {
    tipo: 'lavagem_motor',
    label: 'Lavagem Técnica de Motor',
    descricao: 'Higienização de cofre de motor e componentes',
    placeholder:
      'Ex: A lavagem técnica de motor é executada com isolamento prévio dos conectores, módulos e alternador. O cliente declara estar ciente de chicotes ressecados ou falhas elétricas preexistentes indicadas no check-in.',
  },
  {
    tipo: 'geral',
    label: 'Termo Geral da Oficina',
    descricao: 'Condições gerais válidas para todos os serviços',
    placeholder:
      'Ex: Todos os serviços executados em nossa oficina seguem os mais altos padrões de detalhamento automotivo, com garantia de satisfação e conformidade legal prevista no CDC.',
  },
];

export const TERMO_RESPONSABILIDADE_PADRAO = 
  'Declaro estar ciente de que o veículo discriminado será submetido aos procedimentos e serviços especializados contratados. Declaro que procedi com a retirada de todos os objetos de valor e pertences pessoais do interior do veículo, isentando a oficina de qualquer responsabilidade sobre itens não expressamente relacionados na vistoria de entrada. Estou ciente de que avarias preexistentes, repinturas anteriores fragilizadas, verniz com espessura reduzida, ressecamento de componentes plásticos/borrachas/chicotes elétricos e microrriscos camuflados por sujidade pesada podem se tornar evidentes durante ou após a execução dos trabalhos técnicos. Autorizo a realização de testes de rodagem estritamente necessários para validação e controle de qualidade dos serviços executados, bem como declaro ciência dos prazos estipulados para retirada do veículo após notificação de conclusão, sob pena de incidência de taxas diárias de permanência em pátio.';

export const TERMO_GARANTIA_PADRAO_ADVOGADO = 
  'A [NOME DA EMPRESA] garante os serviços executados pelo prazo de [PRAZO DE GARANTIA] informado na OS, exclusivamente contra falhas decorrentes da execução do serviço.\n\nEXCLUSÕES DE GARANTIA: acidentes, impactos, desgaste natural, falta de manutenção, uso inadequado, produtos químicos ou corrosivos, seivas, dejetos de aves, agentes ambientais, lavagem incorreta, intervenção de terceiros, defeitos preexistentes ou problemas sem relação com o serviço realizado.\n\nO cliente declara estar ciente das condições e orientações de conservação.';

export const TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO = 
  `TERMO DE CIÊNCIA E AUTORIZAÇÃO DE SERVIÇO COM RISCO ESPECÍFICO

Serviço: [SERVIÇO CONTRATADO]

Declaro estar ciente de que o serviço acima possui riscos inerentes à sua execução, especialmente em razão do estado de conservação, manutenção e condições preexistentes do veículo.

Autorizo expressamente a [NOME DA EMPRESA] a realizar o serviço, reconhecendo que a empresa não poderá ser responsabilizada por falhas ou danos decorrentes exclusivamente de defeitos preexistentes ou ocultos, falta de manutenção, desgaste natural, reparos anteriores, adaptações, peças, vedações, chicotes, conectores, módulos ou componentes já danificados, vencidos ou deteriorados e não identificáveis em inspeção visual comum.

A empresa compromete-se a executar o serviço com técnica, cautela e procedimentos adequados, permanecendo responsável pelos danos que forem comprovadamente decorrentes de defeito na própria prestação do serviço.

Declaro ter recebido previamente informações sobre os riscos e autorizo a execução nos termos dos arts. 6º, III; 8º; 14, §3º; 40; 46 e 54, §4º, do Código de Defesa do Consumidor – Lei nº 8.078/90.

Riscos específicos informados: [RISCOS/OBSERVAÇÕES]

Cliente: [NOME]  |  CPF: [CPF]
Veículo/Placa: [VEÍCULO/PLACA]
Data: [DATA]

Li, compreendi os riscos informados e autorizo a execução do serviço.`;

export interface PlataformaModeloTermo {
  id: string;
  titulo: string;
  categoria: 'responsabilidade' | 'garantia';
  tipo_servico: TipoTermoGarantia | null;
  descricao: string | null;
  conteudo_texto: string;
  arquivo_url: string | null;
  arquivo_nome: string | null;
  arquivo_tipo: string | null;
  arquivo_tamanho_bytes: number | null;
  destaque: boolean;
  ativo?: boolean;
  permitir_download?: boolean;
  downloads_count: number;
  aplicacoes_count: number;
  created_at: string;
}

export const MODELOS_TERMOS_PLATAFORMA_PADRAO: PlataformaModeloTermo[] = [
  // 1. TERMOS DE RESPONSABILIDADE & FALHAS OCULTAS
  {
    id: 'padrao_resp_advogado_cdc',
    titulo: 'Termo de Ciência e Autorização com Risco Específico (Minuta Oficial do Advogado - CDC)',
    categoria: 'responsabilidade',
    tipo_servico: null,
    descricao: 'Minuta oficial enviada e validada pelo advogado da sua empresa, amparada nos Arts. 6º, III; 8º; 14, §3º; 40; 46 e 54, §4º do CDC. Cobre vícios ocultos, defeitos preexistentes, peças ressecadas e falta de manutenção.',
    conteudo_texto: TERMO_CIENCIA_RISCO_PADRAO_ADVOGADO,
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 72,
    aplicacoes_count: 94,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_resp_geral',
    titulo: 'Termo Geral de Responsabilidade & Isenção de Falhas Ocultas',
    categoria: 'responsabilidade',
    tipo_servico: null,
    descricao: 'Modelo padrão para propostas comerciais que protege a oficina contra alegações de falhas preexistentes, danos em repinturas frágeis, itens deixados no interior e autoriza testes de rodagem.',
    conteudo_texto: TERMO_RESPONSABILIDADE_PADRAO,
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 38,
    aplicacoes_count: 52,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_resp_antigos',
    titulo: 'Termo de Responsabilidade para Veículos Antigos ou Customizados',
    categoria: 'responsabilidade',
    tipo_servico: null,
    descricao: 'Proteção reforçada para veículos com mais de 10 anos, chicotes ressecados, peças descontinuadas e vernizes antigos sem verniz PU.',
    conteudo_texto: 'Declaro estar ciente de que o veículo possui características de desgaste decorrentes da idade de fabricação e/ou customizações anteriores. Reconheço e autorizo a execução dos serviços tendo sido expressamente advertido(a) de que chicotes elétricos, guarnições de borracha, presilhas plásticas ressecadas pelo calor, emblemas originais e vernizes antigos podem sofrer avarias decorrentes da simples manipulação técnica, não cabendo responsabilização da oficina por desgastes ou quebras decorrentes exclusivamente da fadiga preexistente dos materiais (Art. 14, §3º, I e II do CDC).',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 22,
    aplicacoes_count: 31,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_resp_patio',
    titulo: 'Termo de Responsabilidade para Pátio, Pertences e Teste de Rodagem',
    categoria: 'responsabilidade',
    tipo_servico: null,
    descricao: 'Modelo focado em segurança patrimonial de pátio, desresponsabilização sobre objetos deixados no interior e autorização de manobras e rodagem técnica.',
    conteudo_texto: 'Declaro que entreguei o veículo discriminado para a realização dos serviços contratados, tendo procedido à retirada prévia de todo e qualquer objeto de valor, moeda, eletrônico ou documento pessoal, isentando a oficina de qualquer responsabilidade por itens não expressamente catalogados na vistoria de entrada. Autorizo a realização de testes de rodagem técnica e deslocamento em pátio estritamente necessários para validação e diagnóstico dos serviços. Declaro ciência de que o veículo deverá ser retirado em até 48 horas após a notificação de conclusão dos serviços, sujeitando-se após esse prazo à cobrança de taxa de pátio e guarda.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: false,
    ativo: true,
    downloads_count: 15,
    aplicacoes_count: 19,
    created_at: '2026-01-01T00:00:00Z',
  },

  // 2. TERMOS DE GARANTIA POR SERVIÇO
  {
    id: 'padrao_garantia_vitrificacao',
    titulo: 'Garantia Técnica para Vitrificação / Proteção Cerâmica',
    categoria: 'garantia',
    tipo_servico: 'vitrificacao',
    descricao: 'Cláusula de garantia para revestimentos cerâmicos (vitrificadores), cobrindo propriedades hidrofóbicas e brilho, e especificando cuidados essenciais com lavagens e manutenção periódica.',
    conteudo_texto: 'A presente garantia cobre as propriedades hidrofóbicas, brilho e proteção química do revestimento cerâmico aplicado sobre a pintura original do veículo, condicionada ao cumprimento rigoroso dos seguintes cuidados: 1) Respeitar o tempo de cura total inicial de 7 (sete) dias sem lavagens mecânicas ou uso de produtos químicos; 2) Utilizar exclusivamente shampoos de pH neutro específicos para estética automotiva em lavagens posteriores; 3) Realizar as revisões e manutenções periódicas na oficina a cada 6 (seis) meses; 4) A garantia não cobre danos decorrentes de chuva ácida prolongada não lavada, dejetos de pássaros e seiva de árvores não removidos imediatamente, atritos físicos, lavagens em postos com rolos automáticos ou produtos alcalinos/ácidos abrasivos.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 45,
    aplicacoes_count: 67,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_polimento',
    titulo: 'Garantia Técnica para Polimento Técnico e Correção de Pintura',
    categoria: 'garantia',
    tipo_servico: 'polimento',
    descricao: 'Cláusula de garantia para polimento e remoção de marcas e hologramas, resguardando a oficina quanto à espessura residual do verniz e manutenção pós-entrega.',
    conteudo_texto: 'Garantimos a entrega do veículo livre de marcas de boina, hologramas ou manchas decorrentes do processo de correção da pintura executado. O cliente reconhece que riscos profundos que atingiram a camada base (tinta) ou vernizes repintados anteriormente que apresentem espessura crítica (< 80µm) não podem ser totalmente nivelados por razões de preservação da integridade estrutural da peça. A garantia não cobre novos microrriscos (swirls) causados por lavagens incorretas, panos ásperos, secagens inadequadas ou atrito físico ocorridos após a entrega técnica do veículo.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 39,
    aplicacoes_count: 58,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_motor',
    titulo: 'Termo de Garantia e Cuidados para Lavagem Técnica de Motor',
    categoria: 'garantia',
    tipo_servico: 'lavagem_motor',
    descricao: 'Termo especializado para limpeza detalhada de cofre de motor, delimitando responsabilidades sobre módulos elétricos e peças ressecadas.',
    conteudo_texto: 'A limpeza técnica do compartimento do motor é realizada através de processo detalhado com isolamento prévio dos componentes eletrônicos sensíveis (módulos, centrais, chicotes e bobinas). A garantia assegura a correta aplicação de verniz de proteção térmica e limpeza técnica. A oficina não se responsabiliza por anomalias elétricas preexistentes, conectores ressecados por tempo e caloria natural do veículo, sensores com infiltração prévia ou falhas de ignição derivadas de desgaste natural das peças antes da execução dos serviços.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: false,
    ativo: true,
    downloads_count: 28,
    aplicacoes_count: 36,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_higienizacao',
    titulo: 'Garantia Técnica para Higienização Interna & Estofados',
    categoria: 'garantia',
    tipo_servico: 'higienizacao',
    descricao: 'Termo de garantia para limpeza profunda de bancos, carpetes e estofados, delimitando limites sobre manchas antigas fixadas e cuidados de secagem.',
    conteudo_texto: 'Garantimos a higienização profunda, desinfecção e eliminação de ácaros e odores orgânicos presentes no momento da execução dos serviços. O cliente declara ciência de que manchas de sangue, ferrugem, tintas de caneta ou fluidos que tenham sofrido reações químicas anteriores com a fibra do tecido podem ser irreversíveis sem danificar o substrato. A garantia não cobre novos derramamentos de líquidos, alimentos, urina de animais de estimação ou proliferação de fungos decorrentes de janelas fechadas com o veículo exposto à umidade após a retirada da oficina.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 33,
    aplicacoes_count: 49,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_microreparo',
    titulo: 'Garantia Técnica para Microreparo / Martelinho de Ouro (PDR)',
    categoria: 'garantia',
    tipo_servico: 'microreparo',
    descricao: 'Garantia de alinhamento e retorno estrutural de chapas metálicas, com ressalvas expressas sobre repinturas anteriores e massa plástica.',
    conteudo_texto: 'A garantia cobre a estabilidade do alinhamento estrutural da chapa desamassada pela técnica de Martelinho de Ouro (PDR), assegurando que o ponto trabalhado não retorne ao amassado espontaneamente. A garantia não cobre microtrincas ou desplacamento de tinta em peças que já possuíam repintura anterior com massa plástica, verniz sem aderência original ou repuxamento em áreas onde o vinco sofreu estiramento excessivo prévio do metal.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 24,
    aplicacoes_count: 32,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_insulfilm',
    titulo: 'Garantia para Películas de Controle Solar (Insulfilm)',
    categoria: 'garantia',
    tipo_servico: 'insulfilm',
    descricao: 'Garantia para aplicação de insulfilm e películas térmicas em vidros, cobrindo descolamento, bolhas e desbotamento de tonalidade.',
    conteudo_texto: 'Garantimos a película de controle solar aplicada contra descolamento espontâneo, formação de bolhas de ar e desbotamento precoce da tonalidade pelo prazo acordado. Condições essenciais de garantia: 1) É estritamente proibido abrir ou abaixar os vidros nas primeiras 72 (setenta e duas) horas após a aplicação para permitir a cura da ancoragem adesiva; 2) Não utilizar produtos limpa-vidros à base de amoníaco ou esponjas abrasivas; 3) A garantia não cobre riscos físicos causados por anéis, relógios, cintos de segurança ou guarnições internas com sujeira incrustada preexistente.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 29,
    aplicacoes_count: 41,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_ppf',
    titulo: 'Garantia para Paint Protection Film (PPF)',
    categoria: 'garantia',
    tipo_servico: 'ppf',
    descricao: 'Garantia para películas de proteção de pintura em TPU contra amarelamento, delaminação e perda de autorregeneração.',
    conteudo_texto: 'Garantimos a película protetora PPF (Paint Protection Film) aplicada contra amarelamento, delaminação, rachaduras espontâneas e perda de propriedades autorregenerativas (self-healing) pelo prazo acordado. Exclusões expressas: 1) Impactos severos que ultrapassem a capacidade mecânica do filme e atinjam a chapa; 2) Uso de jatos de alta pressão a menos de 40 cm de distância direta das bordas do filme; 3) Aplicação de solventes ou produtos abrasivos sobre as quinas da película.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 26,
    aplicacoes_count: 38,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_plasticos',
    titulo: 'Garantia Técnica para Revitalização e Proteção de Plásticos',
    categoria: 'garantia',
    tipo_servico: 'plasticos',
    descricao: 'Garantia para restauração, revitalização e vitrificação de plásticos e para-choques externos contra esbranquiçamento precoce.',
    conteudo_texto: 'Garantimos a ancoragem do revestimento protetor e a uniformidade da restauração da pigmentação de plásticos e borrachas externos pelo prazo acordado. A garantia assegura proteção UV e hidro-repelência. Exclusões: 1) Lavagem com produtos químicos desengraxantes pesados (solupan/atativ) que removem o revestimento molecular; 2) Plásticos que já se encontravam ressecados a ponto de esfarelamento ou trincas estruturais decorrentes de exposição solar anterior à aplicação.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 31,
    aplicacoes_count: 45,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_geral',
    titulo: 'Termo Geral de Garantia da Oficina (CDC Art. 26)',
    categoria: 'garantia',
    tipo_servico: 'geral',
    descricao: 'Modelo geral de garantia em conformidade com o Artigo 26 do Código de Defesa do Consumidor (CDC) para serviços de estética automotiva.',
    conteudo_texto: 'A oficina assegura garantia legal de 90 (noventa) dias sobre todos os serviços de estética e detalhamento automotivo executados, nos estritos termos do Art. 26, II do Código de Defesa do Consumidor (Lei nº 8.078/90). EXCLUSÕES EXPRESSAS DE GARANTIA: Danos decorrentes de colisões, impactos de pedras, desgaste natural por uso rodoviário contínuo, lavagens posteriores inadequadas com produtos decapantes/ácidos/alcalinos não homologados, intervenção de terceiros ou falhas derivadas de defeitos preexistentes e ressalvados expressamente na vistoria inicial.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 51,
    aplicacoes_count: 73,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_couro',
    titulo: 'Garantia Técnica para Tratamento e Hidratação de Couro',
    categoria: 'garantia',
    tipo_servico: 'geral',
    descricao: 'Garantia técnica para higienização e hidratação de revestimentos em couro natural e sintético com proteção UV.',
    conteudo_texto: 'Garantimos a limpeza profunda com desobstrução dos poros e a correta aplicação de condicionador térmico com proteção anti-UV. Não há cobertura para descascamentos ou perda de pigmentação em peças de couro sintético ou repinturas anteriores que já se encontravam ressecadas, trincadas ou com a camada de acabamento (topcoat) degradada pelo atrito e radiação solar anterior à entrada na oficina.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: false,
    ativo: true,
    downloads_count: 18,
    aplicacoes_count: 27,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_vidros',
    titulo: 'Garantia para Remoção de Chuva Ácida e Cristalização de Vidros',
    categoria: 'garantia',
    tipo_servico: 'geral',
    descricao: 'Garantia para desoxidação química e proteção hidro-repelente do para-brisa e vidros laterais.',
    conteudo_texto: 'Garantimos a remoção dos depósitos minerais incrustados (chuva ácida) e a eficácia da repelência da cristalização aplicada. O cliente declara ciência de que a desoxidação química pode evidenciar riscos prévios causados por palhetas desgastadas ou atrito mecânico de poeira, os quais estavam encobertos pela película de calcificação. A manutenção da garantia condiciona-se ao uso de palhetas em bom estado e fluído neutro no reservatório do limpador.',
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: false,
    ativo: true,
    downloads_count: 21,
    aplicacoes_count: 30,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'padrao_garantia_advogado',
    titulo: 'Termo Oficial de Garantia Técnica (Minuta Oficial do Advogado)',
    categoria: 'garantia',
    tipo_servico: 'geral',
    descricao: 'Minuta oficial do advogado cobrindo a garantia do serviço com exclusões legais (acidentes, desgaste natural, produtos químicos, agentes ambientais e intervenção de terceiros).',
    conteudo_texto: TERMO_GARANTIA_PADRAO_ADVOGADO,
    arquivo_url: null,
    arquivo_nome: null,
    arquivo_tipo: null,
    arquivo_tamanho_bytes: null,
    destaque: true,
    ativo: true,
    downloads_count: 61,
    aplicacoes_count: 85,
    created_at: '2026-01-01T00:00:00Z',
  },
];

export interface DadosPreenchimentoTermo {
  nomeEmpresa?: string;
  prazoGarantia?: string;
  servicoContratado?: string;
  riscosObservacoes?: string;
  clienteNome?: string;
  clienteCpf?: string;
  veiculoPlaca?: string;
  data?: string;
}

export function preencherVariaveisTermo(texto: string, dados: DadosPreenchimentoTermo): string {
  if (!texto) return '';
  let res = texto;

  const replacements: Record<string, string> = {
    '[NOME DA EMPRESA]': dados.nomeEmpresa || 'Oficina',
    '{oficina_nome}': dados.nomeEmpresa || 'Oficina',
    '[PRAZO DE GARANTIA]': dados.prazoGarantia || '3 meses',
    '{prazo_garantia}': dados.prazoGarantia || '3 meses',
    '[SERVIÇO CONTRATADO]': dados.servicoContratado || 'Serviços Especializados',
    '{servico_nome}': dados.servicoContratado || 'Serviços Especializados',
    '[RISCOS/OBSERVAÇÕES]': dados.riscosObservacoes || 'Condições e riscos informados na vistoria inicial.',
    '{riscos_informados}': dados.riscosObservacoes || 'Condições e riscos informados na vistoria inicial.',
    '[NOME]': dados.clienteNome || 'Cliente',
    '{cliente_nome}': dados.clienteNome || 'Cliente',
    '[CPF]': dados.clienteCpf || 'Não informado',
    '{cliente_documento}': dados.clienteCpf || 'Não informado',
    '[VEÍCULO/PLACA]': dados.veiculoPlaca || 'Veículo do Cliente',
    '{veiculo_placa}': dados.veiculoPlaca || 'Veículo do Cliente',
    '[DATA]': dados.data || new Date().toLocaleDateString('pt-BR'),
    '{data_atual}': dados.data || new Date().toLocaleDateString('pt-BR'),
  };

  for (const [tag, val] of Object.entries(replacements)) {
    res = res.split(tag).join(val);
  }

  return res;
}

export interface ServicoParaTermo {
  nome: string;
  grupo?: string | null;
  riscos_especificos_padrao?: string | null;
}

export interface ItemBibliotecaRisco {
  id: string;
  categoria: 'lavagem' | 'vidros' | 'polimento' | 'protecao' | 'interior' | 'reparo' | 'especial';
  titulo: string;
  badgeLabel: string;
  palavrasChave: string[];
  riscoPadraoCurto: string;
  clausulaJuridica: string;
}

export const BIBLIOTECA_RISCOS_SERVICOS: ItemBibliotecaRisco[] = [
  // 1. LAVAGENS TÉCNICAS & DESCONTAMINAÇÃO EXTERNA
  {
    id: 'lavagem_detalhada',
    categoria: 'lavagem',
    titulo: 'Lavagem Detalhada e Limpeza Técnica Automotiva',
    badgeLabel: 'Lavagem Detalhada',
    palavrasChave: ['lavagem detalhada', 'lavagem técnica', 'lavagem tecnica', 'lavagem premium', 'ducha técnica', 'lavagem automotiva', 'snow foam', 'lavagem externa', 'lavagem simples', 'lavacao', 'lavação'],
    riscoPadraoCurto: 'Remoção de sujidade pesada pode evidenciar microrriscos, swirls e lascas de pedrisco preexistentes.',
    clausulaJuridica: '• LAVAGEM DETALHADA E LIMPEZA TÉCNICA: A remoção de camadas densas de fuligem, terra, minerais e contaminações pesadas pode desmascarar e tornar evidentes microrriscos (swirls), marcas de pedriscos de estrada, repinturas sem verniz original e lascas preexistentes que estavam camufladas pela sujeira acumulada.',
  },
  {
    id: 'lavagem_motor',
    categoria: 'lavagem',
    titulo: 'Lavagem Técnica de Motor e Cofre',
    badgeLabel: 'Motor / Elétrica',
    palavrasChave: ['motor', 'cofre', 'bobina', 'alternador', 'chicote', 'lavagem de motor', 'limpeza de motor', 'dielétrico', 'dieletrico', 'vapor motor'],
    riscoPadraoCurto: 'Fadiga térmica e ressecamento preexistente de chicotes, bobinas, módulos e conectores de sensores.',
    clausulaJuridica: '• LAVAGEM TÉCNICA DE MOTOR E COFRE: O cliente declara ciência de que chicotes elétricos, alternador, bobinas de ignição, módulos eletrônicos e conectores de sensores sofrem fadiga térmica e ressecamento natural pela caloria do motor e tempo de uso, isentando a oficina de anomalias elétricas decorrentes de desgaste preexistente (Art. 14, §3º, I do CDC).',
  },
  {
    id: 'lavagem_chassi',
    categoria: 'lavagem',
    titulo: 'Lavagem de Chassi, Suspensão e Caixas de Roda',
    badgeLabel: 'Chassi / Suspensão',
    palavrasChave: ['chassi', 'chassis', 'suspensao', 'suspensão', 'caixa de roda', 'caixas de roda', 'assoalho', 'inferior', 'lavagem por baixo', 'lavagem inferior', 'de baixo'],
    riscoPadraoCurto: 'Pressão inferior sobre buchas ressecadas, coifas fragilizadas, chicotes de sensores ABS e linhas antigas.',
    clausulaJuridica: '• LAVAGEM DE CHASSI E SUSPENSÃO: Procedimento realizado sob alta pressão na parte inferior do veículo. Buchas de suspensão ressecadas, coifas, cabos de sensores ABS e tubulações antigas fragilizadas por intempéries possuem risco inerente de desagregação de resíduos que já camuflavam desgaste preexistente.',
  },
  {
    id: 'descontaminacao_rodas',
    categoria: 'lavagem',
    titulo: 'Descontaminação de Rodas, Freios e Pinças',
    badgeLabel: 'Rodas / Pinças',
    palavrasChave: ['roda', 'rodas', 'pinça', 'pinca', 'ferroso', 'ferrugem', 'fuligem de freio', 'descontaminante ferroso'],
    riscoPadraoCurto: 'Verniz de roda esbranquiçado, corrosão sob pintura diamantada ou repintura caseira de pinças.',
    clausulaJuridica: '• DESCONTAMINAÇÃO DE RODAS E PINÇAS: O uso de descontaminante químico sobre rodas diamantadas ou com repintura anterior pode revelar corrosão galvânica preexistente e perda de acabamento em pinças repintadas sem primer com resistência térmica.',
  },
  {
    id: 'remocao_piche_cola',
    categoria: 'lavagem',
    titulo: 'Remoção de Piche, Asfalto, Cola e Chuva de Tinta',
    badgeLabel: 'Piche / Cola / Asfalto',
    palavrasChave: ['piche', 'asfalto', 'cola', 'adesivo', 'resíduo', 'residuo', 'pulverização', 'pulverizacao', 'chuva de tinta', 'tinta de rua'],
    riscoPadraoCurto: 'Atrito localizado de solventes sobre vernizes finos ou repinturas sem resistência a solventes.',
    clausulaJuridica: '• REMOÇÃO DE PICHE, COLA E PULVERIZAÇÃO: A descontaminação química e mecânica atua dissolvendo resíduos incrustados. Peças repintadas anteriormente sem cura completa ou sem verniz de qualidade automotiva podem apresentar perda de brilho pontual no local de impregnação do contaminante.',
  },
  {
    id: 'capotas_conversivel',
    categoria: 'lavagem',
    titulo: 'Limpeza e Tratamento de Capotas (Tecido/Vinil)',
    badgeLabel: 'Capotas / Lonas',
    palavrasChave: ['capota', 'conversível', 'conversivel', 'marítima', 'maritima', 'lona', 'impermeabilização de capota', 'capota de tecido'],
    riscoPadraoCurto: 'Fibras e costuras fragilizadas por radiação solar contínua e ressecamento de vinil.',
    clausulaJuridica: '• LIMPEZA E TRATAMENTO DE CAPOTAS: Capotas de lona, tecido ou vinil expostas ao sol sofrem degradação natural de costuras e fibras. A limpeza técnica desobstrui a sujidade, podendo evidenciar fragilidade mecânica e microdesfiamentos preexistentes ao serviço.',
  },

  // 2. VIDROS & PELÍCULAS
  {
    id: 'desoxidacao_vidros',
    categoria: 'vidros',
    titulo: 'Remoção de Chuva Ácida e Desoxidação de Vidros',
    badgeLabel: 'Chuva Ácida / Vidros',
    palavrasChave: ['chuva ácida', 'chuva acida', 'desoxidação', 'desoxidacao', 'mancha no vidro', 'cristalização de vidro', 'cristalizacao vidro', 'marcas d\'água vidro'],
    riscoPadraoCurto: 'Evidenciação de riscos prévios de palhetas encobertos pela camada de calcificação.',
    clausulaJuridica: '• DESOXIDAÇÃO DE VIDROS / CHUVA ÁCIDA: A desoxidação atua sobre minerais incrustados. Vidros que possuam riscos prévios de palheta ou marcas de abrasão encobertas pela calcificação mineral podem se tornar visíveis após a remoção da camada opaca.',
  },
  {
    id: 'polimento_vidros',
    categoria: 'vidros',
    titulo: 'Polimento Técnico de Vidros e Remoção de Riscos',
    badgeLabel: 'Polimento de Vidros',
    palavrasChave: ['polimento de vidro', 'polimento em vidro', 'risco de palheta', 'risco no para-brisa', 'riscos parabrisa', 'polimento parabrisa'],
    riscoPadraoCurto: 'Limitação física de nivelamento; risco de distorção ótica ("grau") em arranhões excessivamente fundos.',
    clausulaJuridica: '• POLIMENTO TÉCNICO DE VIDROS: Procedimento que atua nivelando micrômetros da lâmina externa do vidro. O cliente declara ciência de que riscos profundos não serão removidos integralmente a fim de evitar distorções óticas ("grau") ou estresse térmico no vidro laminado.',
  },
  {
    id: 'insulfilm_pelicula',
    categoria: 'vidros',
    titulo: 'Instalação de Películas de Controle Solar (Insulfilm)',
    badgeLabel: 'Insulfilm / Películas',
    palavrasChave: ['insulfilm', 'película', 'pelicula', 'insulfilme', 'fumê', 'fume', 'nano cerâmica', 'nanoceramica', 'pelicula termica', 'película térmica', 'tint'],
    riscoPadraoCurto: 'Cura obrigatória de 72h sem abaixar os vidros; risco em filamentos térmicos ressecados.',
    clausulaJuridica: '• INSTALAÇÃO DE PELÍCULAS: É estritamente obrigatório não acionar nem abaixar os vidros nas primeiras 72 horas após a instalação para permitir a ancoragem da cola. O cliente declara ciência de possíveis filamentos térmicos do desembaçador traseiro já fragilizados por desgaste de tempo.',
  },
  {
    id: 'remocao_insulfilm',
    categoria: 'vidros',
    titulo: 'Remoção de Películas Antigas e Cola Cristalizada',
    badgeLabel: 'Remoção de Película',
    palavrasChave: ['remoção de insulfilm', 'remocao de insulfilm', 'tirar insulfilm', 'remover pelicula', 'remover película', 'remoção de película', 'cola de vidro'],
    riscoPadraoCurto: 'Desprendimento de filamentos do desembaçador traseiro fundidos à cola cristalizada pelo sol.',
    clausulaJuridica: '• REMOÇÃO DE PELÍCULA ANTIGA: Películas ressecadas ou aplicadas há mais de 3 anos fundem a cola quimicamente aos vidros pelo calor solar. A remoção envolve risco inerente de rompimento de filamentos do desembaçador traseiro decorrente da cola cristalizada preexistente.',
  },

  // 3. POLIMENTO & CORREÇÃO DE PINTURA
  {
    id: 'polimento_correcao',
    categoria: 'polimento',
    titulo: 'Polimento Técnico e Correção de Verniz',
    badgeLabel: 'Polimento / Verniz',
    palavrasChave: ['polimento', 'corte', 'refino', 'lustro', 'correção', 'correcao', 'esmeril', 'holograma', 'swirl', 'microrriscos', 'polimento comercial', 'polimento técnico'],
    riscoPadraoCurto: 'Desbaste de 2 a 5µm de verniz; risco em repinturas sem aderência ou verniz fino (< 80µm).',
    clausulaJuridica: '• POLIMENTO TÉCNICO / CORREÇÃO DE PINTURA: O nivelamento atua desgastando micrômetros do verniz superficial. Riscos profundos que atingiram a camada de tinta ou peças que apresentem verniz com espessura crítica (< 80µm), craquelado ou queimado por sol não serão removidos para preservar a integridade estrutural da peça.',
  },
  {
    id: 'lixamento_espelhamento',
    categoria: 'polimento',
    titulo: 'Lixamento Técnico e Espelhamento de Pintura',
    badgeLabel: 'Lixamento / Espelhamento',
    palavrasChave: ['lixamento', 'espelhamento', 'lixa d\'água', 'casca de laranja', 'nivelamento de verniz', 'lixamento técnico'],
    riscoPadraoCurto: 'Desbaste agressivo de casca de laranja; preservação conservadora de quinas e vincos da peça.',
    clausulaJuridica: '• LIXAMENTO TÉCNICO / ESPELHAMENTO: Procedimento de nivelamento de casca de laranja que atua no limite de espessura do verniz. Quinas, bordas e vincos recebem intervenção conservadora a fim de evitar o rompimento do verniz (Art. 14, §3º CDC).',
  },
  {
    id: 'revitalizacao_farois',
    categoria: 'polimento',
    titulo: 'Polimento e Revitalização de Faróis',
    badgeLabel: 'Faróis / Lanternas',
    palavrasChave: ['farol', 'farois', 'faróis', 'lanterna', 'amarelado farol', 'polímero a vapor', 'polimero vapor', 'verniz de farol', 'revitalização de farol'],
    riscoPadraoCurto: 'Microfissuras internas no policarbonato causadas por radiação UV e caloria da lâmpada.',
    clausulaJuridica: '• REVITALIZAÇÃO DE FARÓIS E LANTERNAS: A restauração elimina o amarelamento e oxidação externa da lente. O cliente declara ciência de que microfissuras internas ("craquelado") causadas pelo calor da lâmpada e radiação solar estão na estrutura do policarbonato e não são removíveis.',
  },

  // 4. REPAROS & LATARIA
  {
    id: 'microreparo_pdr',
    categoria: 'reparo',
    titulo: 'Microreparo e Martelinho de Ouro (PDR)',
    badgeLabel: 'Martelinho / PDR',
    palavrasChave: ['martelinho', 'microreparo', 'pdr', 'amassado', 'amassadinho', 'desamassar', 'reparo de amassado'],
    riscoPadraoCurto: 'Tensão na chapa; risco de trinca na tinta em peças com repintura antiga ou massa plástica.',
    clausulaJuridica: '• MICROREPARO / MARTELINHO DE OURO (PDR): A técnica atua na tensão elástica da chapa metálica. Repinturas anteriores com massa plástica, tinta sem elasticidade ou verniz fragilizado podem sofrer trincas decorrentes da tração do desamassamento.',
  },
  {
    id: 'micropintura_retoque',
    categoria: 'reparo',
    titulo: 'Micropintura e Retoque Pontual de Lascas',
    badgeLabel: 'Micropintura / Retoque',
    palavrasChave: ['retoque', 'micropintura', 'lasca', 'tira risco', 'tira-risco', 'pontual', 'pedrada', 'retoque de pintura'],
    riscoPadraoCurto: 'Serviço pontual de proteção anticorrosiva; não substitui repintura integral em estufa.',
    clausulaJuridica: '• MICROPINTURA E RETOQUE PONTUAL: Procedimento artesanal de preenchimento de lascas causadas por pedras e atritos para contenção de ferrugem. O cliente declara ciência de que o retoque não proporciona nivelamento 100% invisível sem a repintura total da peça.',
  },

  // 5. REVESTIMENTOS CERÂMICOS & PROTEÇÃO
  {
    id: 'vitrificacao_coating',
    categoria: 'protecao',
    titulo: 'Vitrificação e Coating Cerâmico',
    badgeLabel: 'Vitrificação / Coating',
    palavrasChave: [
      'vitrificacao', 'vitrificação', 'vitrificador', 'vitrificadores', 'vitrificar', 'vitrificado', 'vitrificada', 'vitrificacoes', 'vitrificações',
      'coating', 'coating ceramico', 'coating cerâmico', 'nano coating',
      'protecao ceramica', 'proteção cerâmica', 'revestimento ceramico', 'revestimento cerâmico'
    ],
    riscoPadraoCurto: 'Cura inicial obrigatória de 7 dias; lavagem periódica com shampoo neutro e manutenção semestral.',
    clausulaJuridica: '• VITRIFICAÇÃO / COATING: O revestimento molecular exige cura de 7 dias sem produtos químicos pesados. A manutenção da garantia condiciona-se a lavagens com shampoo neutro e revisões periódicas, não cobrindo danos por dejetos de aves ou seivas ácidas não lavados imediatamente.',
  },
  {
    id: 'ppf_protecao',
    categoria: 'protecao',
    titulo: 'Paint Protection Film (PPF) e Película Protetora',
    badgeLabel: 'Película PPF',
    palavrasChave: ['ppf', 'paint protection', 'pelicula transparente', 'película transparente', 'filme de protecao', 'filme de proteção', 'envelopamento transparente'],
    riscoPadraoCurto: 'Aderência extrema em peças repintadas sem primer original com risco na remoção futura.',
    clausulaJuridica: '• PAINT PROTECTION FILM (PPF): A película de poliuretano adere por pressão molecular. O cliente declara ciência de que peças com histórico de repintura sem verniz ou primer original de fábrica podem apresentar desplacamento de tinta em futura remoção do filme.',
  },
  {
    id: 'pintura_fosca_envelopado',
    categoria: 'protecao',
    titulo: 'Pintura Fosca, Acetinada e Envelopamento Vinílico',
    badgeLabel: 'Pintura Fosca / Vinil',
    palavrasChave: ['fosco', 'fosca', 'mate', 'matte', 'satin', 'envelopado', 'envelopamento', 'vinil', 'adesivado', 'plotado'],
    riscoPadraoCurto: 'Impossibilidade de corte mecânico; manchas ácidas profundas preexistentes podem ser irreversíveis.',
    clausulaJuridica: '• PINTURA FOSCA / ENVELOPAMENTO VINÍLICO: Superfícies foscas e películas vinílicas não admitem polimento mecânico ou compostos abrasivos. Manchas de seiva ou calcificação que penetraram na textura porosa do verniz fosco/filme são consideradas irreversíveis.',
  },
  {
    id: 'plasticos_externos',
    categoria: 'protecao',
    titulo: 'Revitalização e Proteção de Plásticos e Borrachas',
    badgeLabel: 'Plásticos / Borrachas',
    palavrasChave: ['plastico', 'plástico', 'plasticos', 'plásticos', 'borracha', 'borrachas', 'guarnicao', 'guarnição', 'guarnicoes', 'guarnições', 'friso', 'frisos', 'parachoque plastico', 'coating de plastico'],
    riscoPadraoCurto: 'Ressecamento solar preexistente em guarnições, canaletas e frisos plásticos ressecados.',
    clausulaJuridica: '• PLÁSTICOS E ACABAMENTOS EXTERNOS: Guarnições de borracha, frisos e plásticos ressecados pelo tempo ou agentes solares possuem fragilidade preexistente na manipulação e desobstrução de contaminantes.',
  },

  // 6. INTERIOR & HIGIENIZAÇÃO
  {
    id: 'higienizacao_teto',
    categoria: 'interior',
    titulo: 'Higienização de Teto e Colunas',
    badgeLabel: 'Teto / Forro',
    palavrasChave: ['teto', 'forro', 'coluna a', 'coluna b', 'coluna c', 'quebra-sol', 'forro do teto', 'higienizacao de teto', 'higienização de teto'],
    riscoPadraoCurto: 'Descolamento por degradação e hidrólise da espuma interna de colagem causada pelo calor da capota.',
    clausulaJuridica: '• HIGIENIZAÇÃO DE TETO E COLUNAS: A espuma de colagem de forros de teto sofre hidrólise e ressecamento natural pela caloria solar acumulada na capota. A umectação e sucção técnica podem evidenciar descolamentos caso a camada interna de espuma já tenha perdido a adesão original.',
  },
  {
    id: 'bancos_couro',
    categoria: 'interior',
    titulo: 'Limpeza, Hidratação e Tratamento de Couro',
    badgeLabel: 'Bancos / Couro',
    palavrasChave: [
      'couro', 'alcantara', 'alcântara', 'banco em couro', 'bancos em couro', 'hidratacao', 'hidratação',
      'hidratacao de couro', 'hidratação de couro', 'limpeza de couro', 'vitrificacao de couro', 'vitrificação de couro',
      'protecao de couro', 'proteção de couro'
    ],
    riscoPadraoCurto: 'Descascamento de repintura anterior ou desprendimento de película em couro sintético ressecado.',
    clausulaJuridica: '• LIMPEZA E TRATAMENTO DE COURO: Revestimentos em couro natural ou sintético com histórico de repintura anterior, verniz de couro desgastado ou trincas ressecadas podem apresentar desplacamento pontual decorrente do atrito mecânico da limpeza e desobstrução dos poros.',
  },
  {
    id: 'higienizacao_geral',
    categoria: 'interior',
    titulo: 'Higienização Interna Completa e Estofados',
    badgeLabel: 'Higienização / Tecidos',
    palavrasChave: [
      'higienizacao', 'higienização', 'higienizar', 'higienizado', 'higienizada', 'higienizacoes', 'higienizações',
      'estofado', 'estofados', 'banco', 'bancos', 'carpete', 'carpetes', 'porta-malas',
      'limpeza interna', 'lavagem interna', 'higienizacao completa', 'higienização completa',
      'higienizacao detalhada', 'higienização detalhada'
    ],
    riscoPadraoCurto: 'Manchas químicas e biológicas antigas já fixadas na fibra; fragilidade em costuras ressecadas.',
    clausulaJuridica: '• HIGIENIZAÇÃO INTERNA: O cliente declara ciência de que manchas antigas (sangue, caneta, ferrugem, fluidos orgânicos) que reagiram quimicamente com a fibra do tecido podem ser irreversíveis sem danificar o substrato original.',
  },
  {
    id: 'oxisanitizacao_ozonio',
    categoria: 'interior',
    titulo: 'Oxi-sanitização e Desodorização com Ozônio',
    badgeLabel: 'Ozônio / Odores',
    palavrasChave: ['ozonio', 'ozônio', 'oxisanitizacao', 'oxisanitização', 'oxi-sanitizacao', 'oxi-sanitização', 'odor', 'odores', 'cheiro', 'mofo', 'ar condicionado', 'desodorizacao', 'desodorização'],
    riscoPadraoCurto: 'Necessidade de troca de filtro de cabine e eliminação prévia de infiltrações de umidade.',
    clausulaJuridica: '• OXI-SANITIZAÇÃO POR OZÔNIO: O processo elimina bactérias, ácaros e fungos no habitáculo. A eliminação definitiva de maus odores exige a substituição periódica do filtro de ar-condicionado e a ausência de infiltrações ativas de água no assoalho.',
  },
  {
    id: 'alagamento_secagem',
    categoria: 'interior',
    titulo: 'Secagem de Assoalho e Recuperação de Alagamento',
    badgeLabel: 'Alagamento / Enchente',
    palavrasChave: ['alagado', 'alagamento', 'enchente', 'agua no assoalho', 'água no assoalho', 'secagem de carpete', 'desmontagem de carpete'],
    riscoPadraoCurto: 'Oxidação e corrosão eletrônica preexistente causada pelo contato prolongado com água suja.',
    clausulaJuridica: '• SECAGEM DE VEÍCULO ALAGADO: A intervenção técnica limita-se à desmontagem, lavagem, secagem e desinfecção de carpetes e feltros. A oficina não se responsabiliza por anomalias em módulos elétricos, sensores de airbag e conectores decorrentes do contato prévio com água contaminada (Art. 14, §3º CDC).',
  },

  // 7. MOTOCICLETAS & ESPECIAIS
  {
    id: 'motocicletas_detalhe',
    categoria: 'especial',
    titulo: 'Detalhamento e Estética de Motocicletas',
    badgeLabel: 'Motos / Duas Rodas',
    palavrasChave: ['moto', 'motos', 'motocicleta', 'motocicletas', 'ciclomotor', 'custom', 'escapamento cromo', 'harley', 'naked', 'duas rodas'],
    riscoPadraoCurto: 'Chicotes e relés expostos, componentes cromados quentes e anodizações fragilizadas.',
    clausulaJuridica: '• DETALHAMENTO DE MOTOCICLETAS: Veículos de duas rodas possuem chicotes, relés, painéis e componentes elétricos expostos. O cliente declara ciência de que componentes cromados com oxidação prévia ou parafusos com fadiga de aperto podem evidenciar desgastes inerentes à limpeza especializada.',
  },
];

/**
 * Remove acentos e diacríticos de uma string para permitir comparações neutras.
 */
export function removerAcentos(str: string): string {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Informações estruturadas de uma cláusula técnica detectada a partir dos serviços selecionados.
 */
export interface ClausulaDetectadaInfo {
  id: string;
  badgeLabel: string;
  titulo: string;
  clausulaJuridica: string;
}

/**
 * Varre a biblioteca de riscos e os serviços para extrair as cláusulas ativas correspondentes aos procedimentos contratados.
 */
export function obterClausulasDetectadas(servicos: ServicoParaTermo[]): ClausulaDetectadaInfo[] {
  const detectadas: ClausulaDetectadaInfo[] = [];
  const nomesLower = servicos.map((s) => `${s.nome} ${s.grupo || ''}`).join(' ');

  BIBLIOTECA_RISCOS_SERVICOS.forEach((item) => {
    const match = item.palavrasChave.some((kw) => contemPalavraChave(nomesLower, kw));
    if (match) {
      detectadas.push({
        id: item.id,
        badgeLabel: item.badgeLabel,
        titulo: item.titulo,
        clausulaJuridica: item.clausulaJuridica,
      });
    }
  });

  // Riscos customizados específicos cadastrados no serviço pelo detailer
  servicos.forEach((s) => {
    if (s.riscos_especificos_padrao && s.riscos_especificos_padrao.trim()) {
      const jaExiste = detectadas.some((d) =>
        removerAcentos(d.clausulaJuridica).includes(removerAcentos(s.riscos_especificos_padrao!.slice(0, 25)))
      );
      if (!jaExiste) {
        detectadas.push({
          id: `custom_${s.nome}`,
          badgeLabel: `Risco: ${s.nome}`,
          titulo: s.nome,
          clausulaJuridica: `• ${s.nome.toUpperCase()}: ${s.riscos_especificos_padrao.trim()}`,
        });
      }
    }
  });

  return detectadas;
}

/**
 * Permite anexar as cláusulas técnicas dos serviços a qualquer texto-base (como a Minuta do Advogado ou termo de antigos),
 * sem duplicar cláusulas que já estejam contempladas.
 */
export function mesclarClausulasComTextoExistente(
  textoBase: string,
  servicos: ServicoParaTermo[]
): string {
  const clausulas = obterClausulasDetectadas(servicos);
  if (clausulas.length === 0) return textoBase;

  const textoBaseNorm = removerAcentos(textoBase);
  const clausulasFaltantes = clausulas.filter((c) => {
    const trecho = removerAcentos(c.clausulaJuridica.slice(0, 28));
    return !textoBaseNorm.includes(trecho);
  });

  if (clausulasFaltantes.length === 0) return textoBase;

  const blocoClausulas = `\n\nCONDIÇÕES TÉCNICAS E RISCOS ESPECÍFICOS DOS SERVIÇOS CONTRATADOS:\n${clausulasFaltantes.map((c) => c.clausulaJuridica).join('\n')}`;

  return `${textoBase.trim()}${blocoClausulas}`;
}

/**
 * Verifica se um texto contém uma palavra-chave com correspondência precisa de limites de palavra,
 * ignorando acentuação e evitando falsos positivos como 'moto' dentro de 'motor', 'cola' dentro de 'decolagem', etc.
 */
export function contemPalavraChave(texto: string, kw: string): boolean {
  if (!texto || !kw) return false;
  const textoNorm = removerAcentos(texto);
  const kwNorm = removerAcentos(kw).trim();
  if (!kwNorm) return false;

  // Escapa caracteres especiais de regex
  const escaped = kwNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Limite de palavra considerando caracteres alfanuméricos ASCII (já que os acentos foram decompostos):
  // Exige que antes e depois da palavra-chave não haja nenhum caractere alfanumérico a-z0-9.
  // Isso garante que 'moto' NÃO dê match em 'motor', mas dê match exato em 'moto', 'motos', etc.
  const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return regex.test(textoNorm);
}

export function gerarTermoDinamicoServicos(
  servicos: ServicoParaTermo[],
  dados: DadosPreenchimentoTermo
): string {
  const nomeEmpresa = dados.nomeEmpresa || 'Oficina';
  const veicPlaca = dados.veiculoPlaca || 'Veículo';
  const clienteIdentificacao = dados.clienteNome
    ? ` pelo(a) cliente ${dados.clienteNome}${dados.clienteCpf ? ` (CPF/CNPJ: ${dados.clienteCpf})` : ''}`
    : '';

  const cabecalho = `Declaro que o veículo (${veicPlaca}) foi entregue à ${nomeEmpresa}${clienteIdentificacao} para execução dos procedimentos e serviços especializados contratados. Declaro que procedi com a retirada de todos os pertences pessoais e objetos de valor do interior do veículo, isentando a oficina de qualquer responsabilidade sobre itens não discriminados expressamente na vistoria de entrada. Autorizo a realização de testes técnicos de rodagem e deslocamento em pátio estritamente necessários para validação e controle de qualidade.`;

  const clausulas = obterClausulasDetectadas(servicos);

  const rodape =
    'O cliente declara ter recebido previamente todas as informações e orientações técnicas sobre os procedimentos contratados, estando ciente dos riscos inerentes ao estado preexistente do veículo, nos termos dos arts. 6º, III; 8º; 14, §3º; 26, II; 40 e 54, §4º, do Código de Defesa do Consumidor – Lei nº 8.078/90.';

  if (clausulas.length > 0) {
    const textoClausulas = clausulas.map((c) => c.clausulaJuridica).join('\n');
    return `${cabecalho}\n\nCONDIÇÕES TÉCNICAS E RISCOS ESPECÍFICOS DOS SERVIÇOS CONTRATADOS:\n${textoClausulas}\n\n${rodape}`;
  }

  return `${cabecalho}\n\nEstou ciente de que avarias preexistentes, repinturas anteriores fragilizadas, verniz com espessura reduzida, ressecamento de componentes plásticos/borrachas/chicotes elétricos e microrriscos camuflados por sujidade pesada podem se tornar evidentes durante ou após a execução dos trabalhos técnicos.\n\n${rodape}`;
}



