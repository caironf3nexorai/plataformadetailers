-- Migration 0085: Termos de Garantia Personalizados e Extensões do Módulo de Orçamentos

-- 1. TABELA DE TERMOS DE GARANTIA CATEGORIZADOS
CREATE TABLE IF NOT EXISTS public.termos_garantia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tipo text NOT NULL, -- ex: 'lavagem_motor', 'polimento', 'vitrificacao', 'microreparo', 'higienizacao', 'insulfilm', 'geral'
  titulo text NOT NULL,
  conteudo text NOT NULL,
  padrao boolean DEFAULT false,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS para termos_garantia
ALTER TABLE public.termos_garantia ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'termos_garantia' AND policyname = 'Membros podem ver termos de garantia da oficina'
  ) THEN
    CREATE POLICY "Membros podem ver termos de garantia da oficina"
      ON public.termos_garantia FOR SELECT
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'termos_garantia' AND policyname = 'Membros podem inserir termos de garantia da oficina'
  ) THEN
    CREATE POLICY "Membros podem inserir termos de garantia da oficina"
      ON public.termos_garantia FOR INSERT
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'termos_garantia' AND policyname = 'Membros podem atualizar termos de garantia da oficina'
  ) THEN
    CREATE POLICY "Membros podem atualizar termos de garantia da oficina"
      ON public.termos_garantia FOR UPDATE
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'termos_garantia' AND policyname = 'Membros podem deletar termos de garantia da oficina'
  ) THEN
    CREATE POLICY "Membros podem deletar termos de garantia da oficina"
      ON public.termos_garantia FOR DELETE
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
  END IF;
END $$;

-- 2. TABELA DE FOTOS DE AVALIAÇÃO DO ORÇAMENTO
CREATE TABLE IF NOT EXISTS public.orcamento_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  path text NOT NULL,
  descricao text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.orcamento_fotos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orcamento_fotos' AND policyname = 'Membros podem ver fotos do orcamento'
  ) THEN
    CREATE POLICY "Membros podem ver fotos do orcamento"
      ON public.orcamento_fotos FOR ALL
      USING (tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid()));
  END IF;
END $$;

-- 3. EXTENSÕES DA TABELA ORCAMENTOS
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS incluir_fotos boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS incluir_termos boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS termo_garantia_id uuid REFERENCES public.termos_garantia(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS aceite_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS assinatura_usuario_path text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assinatura_usuario_nome text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS assinado_usuario_em timestamptz DEFAULT NULL;
