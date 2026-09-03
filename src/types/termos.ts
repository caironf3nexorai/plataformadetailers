export type TipoTermoGarantia =
  | 'lavagem_motor'
  | 'polimento'
  | 'vitrificacao'
  | 'microreparo'
  | 'higienizacao'
  | 'insulfilm'
  | 'geral';

export interface TermoGarantia {
  id: string;
  tenant_id: string;
  tipo: TipoTermoGarantia;
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
    tipo: 'lavagem_motor',
    label: 'Lavagem Técnica de Motor',
    descricao: 'Higienização de cofre de motor e componentes',
    placeholder:
      'Ex: A lavagem técnica de motor é executada com isolamento prévio dos conectores, módulos e alternador. O cliente declara estar ciente de chicotes ressecados ou falhas elétricas preexistentes indicadas no check-in.',
  },
  {
    tipo: 'microreparo',
    label: 'Microreparo / Martelinho',
    descricao: 'Remoção de amassados e repintura localizada',
    placeholder:
      'Ex: O serviço de microreparo e martelinho visa devolver o alinhamento original da chapa sem repintura. Caso a área possua repintura antiga ou verniz fragilizado, a garantia limita-se à integridade estrutural trabalhada.',
  },
  {
    tipo: 'vitrificacao',
    label: 'Vitrificação / Proteção Cerâmica',
    descricao: 'Coating cerâmico com garantia de hidro-repelência',
    placeholder:
      'Ex: O revestimento cerâmico possui cobertura contra perda de brilho e desgaste precoce por até [X meses], condicionada à realização de manutenções com shampoo neutro e respeitando o tempo de cura inicial de 7 dias.',
  },
  {
    tipo: 'higienizacao',
    label: 'Higienização Interna',
    descricao: 'Limpeza profunda de estofados, couro e teto',
    placeholder:
      'Ex: A higienização profunda elimina manchas orgânicas, ácaros e odores presentes na entrega do veículo. Não cobre novos derramamentos de substâncias após a retirada.',
  },
  {
    tipo: 'insulfilm',
    label: 'Películas de Controle Solar (Insulfilm)',
    placeholder:
      'Ex: A garantia cobre descolamento, bolhas e desbotamento de cor por até [X anos]. Recomenda-se não acionar os vidros nas primeiras 72 horas após a aplicação.',
    descricao: 'Instalação de películas térmicas e de privacidade',
  },
  {
    tipo: 'geral',
    label: 'Termo Geral da Oficina',
    descricao: 'Condições gerais válidas para todos os serviços',
    placeholder:
      'Ex: Todos os serviços executados em nossa oficina seguem os mais altos padrões de detalhamento automotivo, com garantia de satisfação e conformidade legal prevista no CDC.',
  },
];
