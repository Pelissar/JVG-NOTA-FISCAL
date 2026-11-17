-- Publish the existing subscription intervals as "Sob consulta" offers.
-- No prices are invented; the commercial team can set them from /admin.
update public.jvg_subscription_plans
set is_public = true,
    description = case
      when nullif(btrim(description), '') is null
        then 'Módulos e valores definidos com a equipe comercial conforme o segmento da empresa.'
      else description
    end,
    sort_order = case code
      when 'mensal' then 10
      when 'trimestral' then 20
      when 'semestral' then 30
      when 'anual' then 40
      else sort_order
    end,
    updated_at = now()
where active = true
  and code in ('mensal', 'trimestral', 'semestral', 'anual');
