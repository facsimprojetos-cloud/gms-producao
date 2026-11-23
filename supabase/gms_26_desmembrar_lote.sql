-- Desmembrar lote: variações (ou parte delas) que ainda não foram enviadas viram um lote novo (próximo número do mês),
-- com observação "Lote desmembrado do X". Cada lote continua com uma facção e um romaneio.
create or replace function gms.desmembrar_lote(p_corte_id uuid, p_itens jsonb, p_faccao_id bigint default null, p_obs text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare c record; n record; v_id uuid; it jsonb; s record; q int; k int := 0; v_tot int := 0;
begin
  perform gms.exigir_perfil('corte');
  select * into c from gms.cortes where id = p_corte_id and status = 'Cortado' for update;
  if not found then raise exception 'Lote não encontrado ou ainda não cortado.'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Selecione as variações que vão para o lote novo.'; end if;
  if p_faccao_id is not null and not exists (select 1 from gms.faccoes where id = p_faccao_id and ativo) then raise exception 'Facção inexistente ou inativa.'; end if;
  select * into n from gms._proximo_lote(now());
  insert into gms.cortes(numero, mes, lote, data, produto_id, destino, faccao_id, status, cortado_em, cortado_por, obs)
  values (n.numero, n.mes, n.lote, now(), c.produto_id, 'PRODUÇÃO', p_faccao_id, 'Cortado', now(), auth.uid(),
          concat_ws(' | ', 'Lote desmembrado do ' || c.lote, nullif(btrim(coalesce(p_obs, '')), '')))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into s from gms.sublotes where id = (it->>'sublote_id')::uuid and corte_id = p_corte_id for update;
    if not found then raise exception 'Variação não pertence a este lote.'; end if;
    q := (it->>'qtd')::int;
    if q is null or q <= 0 or q > s.qtd_saldo then raise exception 'Quantidade inválida para % (disponível: %).', s.codigo, s.qtd_saldo; end if;
    k := k + 1; v_tot := v_tot + q;
    insert into gms.sublotes(codigo, lote, corte_id, produto_id, cor_id, tamanho_id, pedido_id, qtd_cortada, qtd_saldo)
    values (n.lote || '.' || k, n.lote, v_id, s.produto_id, s.cor_id, s.tamanho_id, s.pedido_id, q, q);
    if q = s.qtd_cortada and q = s.qtd_saldo and not exists (select 1 from gms.envios where sublote_id = s.id)
       and not exists (select 1 from gms.etapas where sublote_id = s.id) then
      delete from gms.sublotes where id = s.id;
    else
      update gms.sublotes set qtd_cortada = qtd_cortada - q, qtd_saldo = qtd_saldo - q where id = s.id;
    end if;
    delete from gms.corte_volumes where corte_id = p_corte_id and tamanho_id = s.tamanho_id;
  end loop;
  update gms.cortes set obs = concat_ws(' | ', nullif(obs, ''), v_tot || ' peças desmembradas para o lote ' || n.lote) where id = p_corte_id;
  perform gms._audit('desmembrar_lote', 'cortes', v_id::text, jsonb_build_object('origem', c.lote, 'novo', n.lote, 'pecas', v_tot, 'faccao', p_faccao_id));
  return jsonb_build_object('id', v_id, 'lote', n.lote, 'origem', c.lote, 'pecas', v_tot);
end $$;
grant execute on function gms.desmembrar_lote(uuid, jsonb, bigint, text) to authenticated;
revoke execute on function gms.desmembrar_lote(uuid, jsonb, bigint, text) from public, anon;
