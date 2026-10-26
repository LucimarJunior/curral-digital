-- TESTE SEGURO: só execute APÓS instalar a migração import_trutest_batch.
-- A transação inteira será desfeita, mesmo após chamadas bem-sucedidas.
-- Usa um IDE fictício reservado apenas para este teste.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '048fda38-e5c8-4240-abda-273ad5f9ff34',
  true
);
DO $$
DECLARE
  v_farm uuid := '9be8f614-ac48-4176-b1cc-3f00686f4481';
  v_pasture text;
  v_ide text := '999999999999991';
  v_payload jsonb;
  v_first jsonb;
  v_second jsonb;
  v_count integer;
BEGIN
  SELECT name INTO v_pasture FROM public.pastures
    WHERE farm_id = v_farm ORDER BY name LIMIT 1;
  IF v_pasture IS NULL THEN
    -- Cria apenas um pasto temporário dentro desta transação de teste.
    -- O ROLLBACK ao final remove esse pasto e todos os demais registros fictícios.
    v_pasture := 'TESTE-TRUTEST-ROLLBACK';
    INSERT INTO public.pastures (farm_id, name)
    VALUES (v_farm, v_pasture);
  END IF;
  IF EXISTS (SELECT 1 FROM public.cattle WHERE electronic_id = v_ide) THEN
    RAISE EXCEPTION 'Teste cancelado: IDE fictício já está em uso';
  END IF;
  v_payload := jsonb_build_array(jsonb_build_object(
    'electronic_id', v_ide,
    'tag_number', 'TESTE-TRUTEST-ROLLBACK',
    'weight_kg', 257.5,
    'weighing_date', '2026-09-26',
    'weighing_time', '10:31:24',
    'gmd', 0.47,
    'gpv', 19,
    'classification', '-4 (Pesado)'
  ));
  v_first := public.import_trutest_batch(v_farm,v_payload,'Male','Nelore','Bezerro',v_pasture);
  IF (v_first->>'new_animals')::integer <> 1 THEN
    RAISE EXCEPTION 'Falha ao cadastrar novo animal: %',v_first;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.weighings w JOIN public.cattle c ON c.id = w.cattle_id
  WHERE c.electronic_id = v_ide AND w.weight_kg = 257.5
    AND w.weighing_date = ('2026-09-26 10:31:24'::timestamp AT TIME ZONE 'America/Sao_Paulo');
  IF v_count <> 1 THEN RAISE EXCEPTION 'Falha no registro da pesagem: %',v_count; END IF;
  v_second := public.import_trutest_batch(v_farm,v_payload,'Male','Nelore','Bezerro',v_pasture);
  IF (v_second->>'existing_animals')::integer <> 1
     OR (v_second->>'skipped_weighings')::integer <> 1 THEN
    RAISE EXCEPTION 'Falha na prevenção de duplicidade: %',v_second;
  END IF;
  RAISE NOTICE 'TESTE APROVADO (será revertido): primeiro=%, repetido=%',v_first,v_second;
END $$;
ROLLBACK;
