-- Execute no Supabase SQL Editor após revisão, antes de habilitar a confirmação.
-- Sem DROP, sem alteração de tabelas e sem mudança de RLS.
CREATE OR REPLACE FUNCTION public.import_trutest_batch(
  p_farm_id uuid,
  p_rows jsonb,
  p_gender text,
  p_breed text,
  p_category text,
  p_pasture text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_item jsonb;
  v_ide text;
  v_idv text;
  v_weight numeric;
  v_date timestamptz;
  v_date_text text;
  v_time_text text;
  v_animal_id uuid;
  v_existing public.cattle%ROWTYPE;
  v_count_new integer := 0;
  v_count_existing integer := 0;
  v_count_skipped integer := 0;
  v_seen text[] := ARRAY[]::text[];
  v_existing_idv uuid;
  v_pasture text := NULLIF(btrim(p_pasture), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.farms WHERE id = p_farm_id AND owner_id = v_user) THEN
    RAISE EXCEPTION 'Fazenda não autorizada';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Envie de 1 a 1000 pesagens';
  END IF;
  IF p_gender NOT IN ('Male', 'Female') OR NULLIF(btrim(p_breed),'') IS NULL
     OR NULLIF(btrim(p_category),'') IS NULL OR v_pasture IS NULL THEN
    RAISE EXCEPTION 'Informe sexo, raça, categoria e pasto';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pastures WHERE farm_id = p_farm_id AND name = v_pasture) THEN
    RAISE EXCEPTION 'Pasto não cadastrado nesta fazenda';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_ide := regexp_replace(coalesce(v_item->>'electronic_id',''), '[[:space:]]', '', 'g');
    v_idv := NULLIF(btrim(coalesce(v_item->>'tag_number','')), '');
    v_date_text := v_item->>'weighing_date';
    v_time_text := v_item->>'weighing_time';
    IF v_ide !~ '^[0-9]+$' OR v_ide = ANY(v_seen) THEN
      RAISE EXCEPTION 'IDE inválido ou repetido: %', v_ide;
    END IF;
    v_seen := array_append(v_seen, v_ide);
    IF coalesce(v_item->>'weight_kg','') !~ '^[0-9]+([.][0-9]+)?$' THEN
      RAISE EXCEPTION 'Peso inválido para IDE %', v_ide;
    END IF;
    v_weight := (v_item->>'weight_kg')::numeric;
    IF v_weight <= 0 OR v_weight > 3000 THEN RAISE EXCEPTION 'Peso fora do limite: %', v_ide; END IF;
    IF coalesce(v_date_text,'') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR coalesce(v_time_text,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
      RAISE EXCEPTION 'Data/hora inválida para IDE %', v_ide;
    END IF;
    BEGIN
      v_date := ((v_date_text || ' ' || v_time_text)::timestamp AT TIME ZONE 'America/Sao_Paulo');
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Data/hora inexistente para IDE %', v_ide;
    END;
    IF to_char(v_date AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') <> v_date_text THEN
      RAISE EXCEPTION 'Data inválida para IDE %', v_ide;
    END IF;

    -- A RLS restringe a consulta ao rebanho autorizado. A unicidade global do IDE
    -- impede também o cadastro de um IDE pertencente a outra fazenda.
    SELECT * INTO v_existing FROM public.cattle WHERE electronic_id = v_ide FOR UPDATE;
    IF FOUND THEN
      IF v_existing.farm_id <> p_farm_id OR v_existing.owner_id <> v_user THEN
        RAISE EXCEPTION 'IDE % pertence a outra fazenda ou proprietário', v_ide;
      END IF;
      v_animal_id := v_existing.id;
      v_count_existing := v_count_existing + 1;
    ELSE
      IF EXISTS (SELECT 1 FROM public.cattle
        WHERE farm_id = p_farm_id AND tag_number = coalesce(v_idv, v_ide)) THEN
        RAISE EXCEPTION 'IDV duplicado no lote: %', coalesce(v_idv, v_ide);
      END IF;
      INSERT INTO public.cattle
        (farm_id,owner_id,tag_number,electronic_id,name,gender,breed,category,pasture,weight_kg,status)
      VALUES
        (p_farm_id,v_user,coalesce(v_idv,v_ide),v_ide,coalesce(v_idv,v_ide),
         p_gender,btrim(p_breed),btrim(p_category),v_pasture,v_weight,'Active')
      RETURNING id INTO v_animal_id;
      v_count_new := v_count_new + 1;
    END IF;

    -- Uma sessão idêntica não cria uma segunda pesagem.
    -- IMPORTANTE: a comparação é por animal, data/hora e peso, não apenas por dia.
    IF EXISTS (
      SELECT 1 FROM public.weighings
      WHERE cattle_id = v_animal_id AND farm_id = p_farm_id
        AND weighing_date = v_date
    ) THEN
      IF EXISTS (
        SELECT 1 FROM public.weighings
        WHERE cattle_id = v_animal_id AND farm_id = p_farm_id
          AND weighing_date = v_date AND weight_kg = v_weight
      ) THEN
        v_count_skipped := v_count_skipped + 1;
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Pesagem já existe com outro peso no mesmo horário para IDE %', v_ide;
    END IF;

    INSERT INTO public.weighings
      (cattle_id,farm_id,weight_kg,weighing_date,classification,gmd,gpv,notes)
    VALUES (
      v_animal_id,p_farm_id,v_weight,v_date,
      NULLIF(v_item->>'classification',''),
      CASE WHEN coalesce(v_item->>'gmd','') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (v_item->>'gmd')::numeric ELSE NULL END,
      CASE WHEN coalesce(v_item->>'gpv','') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (v_item->>'gpv')::numeric ELSE NULL END,
      'Importação Tru-Test'
    );
  END LOOP;
  RETURN jsonb_build_object('new_animals',v_count_new,'existing_animals',v_count_existing,'skipped_weighings',v_count_skipped,'total',jsonb_array_length(p_rows));
END;
$$;
REVOKE ALL ON FUNCTION public.import_trutest_batch(uuid,jsonb,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_trutest_batch(uuid,jsonb,text,text,text,text) TO authenticated;
