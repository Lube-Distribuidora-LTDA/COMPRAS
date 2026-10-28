-- 2026-10-28 — Produtos novos sem foto (migração compras_produtos_novos)
--
-- Pedido do Júlio: uma aba "Produtos novos" com os produtos cadastrados no WinThor nos últimos
-- 30 dias; quando a foto do produto entra na pasta FOTOS_ION, ele sai da lista.
--
--   compras.fato_produto_novo   carga do ETL (consulta produto_novo, grupo rápidas, 4x ao dia):
--                               PCPRODUT com DTCADASTRO nos últimos 30 dias, de revenda, não excluído.
--   foto                        NÃO é lida aqui: quem lista a pasta FOTOS_ION é a carga do Trade
--                               (trade.produto_imagem, 5x ao dia). painel_dados() só cruza na leitura
--                               (permitido pelo padrão do DATA WAREHOUSE: cruzar schemas na consulta,
--                               nunca na carga). Foto nova na pasta → próxima carga do Trade → sai da lista.

CREATE TABLE IF NOT EXISTS compras.fato_produto_novo (
  codprod         integer PRIMARY KEY,
  descricao       text,
  embalagem       text,
  unidade         text,
  codfornec       integer,
  codcomprador    integer,
  dtcadastro      date,
  dtultalter      timestamp,
  codfunccadastro integer,
  cadastrado_por  text,
  status          text
);
ALTER TABLE compras.fato_produto_novo ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE compras.fato_produto_novo IS
  'Produtos cadastrados no WinThor nos últimos 30 dias (PCPRODUT.DTCADASTRO). A foto vem de trade.produto_imagem, cruzada em compras.painel_dados().';

CREATE OR REPLACE FUNCTION compras.painel_dados()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
SELECT json_build_object(
  'geradoEm', (SELECT to_char(min(ultima) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
                         FROM (SELECT max(executado_em) AS ultima
                                 FROM compras.controle_carga
                                WHERE status = 'OK'
                                  AND executado_em > now() - interval '7 days'
                                GROUP BY consulta) u),

  'cargas', (SELECT json_object_agg(g, q) FROM (
      SELECT CASE WHEN consulta = 'faturamento' THEN 'faturamento' ELSE 'estoque' END AS g,
             to_char(min(ultima) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS q
        FROM (SELECT consulta, max(executado_em) AS ultima
                FROM compras.controle_carga
               WHERE status = 'OK' AND executado_em > now() - interval '7 days'
               GROUP BY consulta) u
       GROUP BY 1) t),

  'compradores', (SELECT json_object_agg(codcomprador, nome) FROM core.dim_comprador),

  'fornecedores', (SELECT json_object_agg(codfornec,
      json_build_array(coalesce(fornecedor,'—'), codfornecprinc, codcomprador))
    FROM core.dim_fornecedor),

  'produtos', (SELECT coalesce(json_agg(json_build_array(
      codprod, coalesce(descricao,'—'), codcomprador, codfornec,
      CASE WHEN status = 'FORALINHA' THEN 'F' ELSE 'A' END) ORDER BY codprod), '[]'::json)
    FROM core.dim_produto),

  'ruptura', (SELECT coalesce(json_agg(json_build_array(
      codprod, round(coalesce(est_disp_cx,0),1), round(coalesce(giro_dia_cx,0),3),
      round(dias_venda,1), coalesce(ruptura,false), coalesce(cobertura,false),
      round(coalesce(avaria,0),2)) ORDER BY codprod), '[]'::json)
    FROM compras.fato_ruptura_cobertura),

  'ev', (SELECT coalesce(json_agg(json_build_array(
      codprod, round(coalesce(est_disponivel,0)), round(coalesce(est_avaria,0)),
      round(coalesce(preco_venda,0),2), round(coalesce(qtd_pendente,0)),
      round(coalesce(venda_semana0,0)), round(coalesce(venda_semana1,0)),
      round(coalesce(venda_semana2,0)), round(coalesce(venda_semana3,0)),
      round(coalesce(venda_semana4,0)), round(coalesce(venda_semana5,0)),
      round(coalesce(venda_semana6,0)), round(coalesce(venda_semana7,0)),
      round(coalesce(venda_semana8,0)), round(coalesce(venda_total,0)),
      round(media,2), round(cob,1), round(sug)) ORDER BY codprod), '[]'::json)
    FROM compras.fato_estoque_venda),

  'verba', (SELECT coalesce(json_agg(json_build_array(
      v.codfornecprinc, coalesce(v.fornecedorprinc,'—'),
      round(coalesce(v.saldomov,0),2), round(coalesce(v.vlentrada,0),2),
      round(coalesce(v.vlsaida,0),2), round(coalesce(v.vlrvencidas,0),2),
      round(coalesce(v.vlravencerfornecprinc,0),2), round(coalesce(a.avaria,0),2),
      coalesce(a.itens,0), c.codcomprador) ORDER BY v.codfornecprinc), '[]'::json)
    FROM compras.fato_saldo_verba v
    LEFT JOIN (SELECT codfornecprinc, sum(avaria) avaria, count(*) itens
                 FROM compras.fato_avaria_prod_fornec GROUP BY codfornecprinc) a
           ON a.codfornecprinc = v.codfornecprinc
    LEFT JOIN (SELECT codfornecprinc, min(codcomprador) codcomprador
                 FROM core.dim_fornecedor WHERE codfornecprinc IS NOT NULL
                GROUP BY codfornecprinc) c
           ON c.codfornecprinc = v.codfornecprinc),

  'sugfornec', (SELECT coalesce(json_agg(json_build_array(
      codfornec, coalesce(fornecedor,'—'), codcomprador, round(coalesce(girodia,0),3),
      round(coalesce(qt_disp,0)), round(coalesce(sugestao,0)),
      round(coalesce(valor,0)), round(coalesce(valor_original,0)))
      ORDER BY valor DESC NULLS LAST), '[]'::json)
    FROM compras.fato_sugestao_fornecedor),

  'excesso', (SELECT coalesce(json_agg(json_build_array(
      e.codprod, coalesce(e.produto,'—'), e.codfornec, p.codcomprador,
      round(coalesce(e.girodia,0),3), round(coalesce(e.qt_disp,0)),
      round(coalesce(e.sugestao,0)), round(coalesce(e.tabela4,0),2),
      round(coalesce(e.valor,0))) ORDER BY e.valor ASC NULLS LAST), '[]'::json)
    FROM compras.fato_excesso_produto e
    LEFT JOIN core.dim_produto p ON p.codprod = e.codprod),

  'avariaprod', (SELECT coalesce(json_agg(json_build_array(
      a.codprod, coalesce(p.descricao,'—'), p.codcomprador, p.codfornec,
      round(coalesce(a.valor,0),2)) ORDER BY a.valor DESC NULLS LAST), '[]'::json)
    FROM compras.fato_avaria_produto a
    LEFT JOIN core.dim_produto p ON p.codprod = a.codprod),

  'sugprod', (SELECT coalesce(json_agg(json_build_array(
      s.codfilial::int, s.codprod, coalesce(s.descricao,'—'), p.codcomprador, p.codfornec,
      round(coalesce(s.volume_liquido,0)), round(coalesce(s.qtgirodia,0),3),
      round(coalesce(s.qt_disp,0)), round(coalesce(s.sugestao,0)),
      round(coalesce(s.ptabela4,0),2), round(coalesce(s.valor,0)))
      ORDER BY s.valor DESC NULLS LAST), '[]'::json)
    FROM compras.fato_sugestao_produto s
    LEFT JOIN core.dim_produto p ON p.codprod = s.codprod),

  -- produtos cadastrados nos últimos 30 dias + se a foto já está na pasta FOTOS_ION (lista do Trade)
  'novos', (SELECT coalesce(json_agg(json_build_array(
      n.codprod, coalesce(n.descricao,'—'), n.embalagem, n.codfornec, n.codcomprador,
      to_char(n.dtcadastro, 'YYYY-MM-DD'), to_char(n.dtultalter, 'YYYY-MM-DD"T"HH24:MI:SS'),
      n.cadastrado_por, CASE WHEN n.status = 'FORALINHA' THEN 'F' ELSE 'A' END,
      CASE WHEN i.codprod IS NULL THEN 0 ELSE 1 END,
      to_char(i.modificado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'))
      ORDER BY n.dtcadastro DESC, n.codprod), '[]'::json)
    FROM compras.fato_produto_novo n
    LEFT JOIN trade.produto_imagem i ON i.codprod = n.codprod),
  'fotosEm', (SELECT to_char(max(executado_em) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
                FROM trade.controle_carga WHERE status = 'OK'),

  'fat', json_build_object(
    'mes', (SELECT coalesce(json_agg(json_build_array(mes, round(venda,2), round(cmv,2),
        round(lucro,2), pedidos, positivacao) ORDER BY mes), '[]'::json) FROM compras.mv_fat_mes),
    'mescomp', (SELECT coalesce(json_agg(json_build_array(mes, codcomprador, round(venda,2),
        round(lucro,2)) ORDER BY mes, codcomprador), '[]'::json) FROM compras.mv_fat_mes_comprador),
    'mesdepto', (SELECT coalesce(json_agg(json_build_array(mes, codepto, round(venda,2),
        round(lucro,2)) ORDER BY mes, codepto), '[]'::json) FROM compras.mv_fat_mes_depto),
    'depto', (SELECT coalesce(json_agg(json_build_array(codepto, coalesce(departamento,'—'),
        round(venda,2), round(lucro,2), round(v12,2)) ORDER BY venda DESC), '[]'::json)
      FROM compras.mv_fat_depto),
    'secao', (SELECT coalesce(json_agg(json_build_array(codsec, coalesce(secao,'—'),
        round(venda,2), round(lucro,2)) ORDER BY venda DESC), '[]'::json)
      FROM (SELECT * FROM compras.mv_fat_secao ORDER BY venda DESC LIMIT 60) t),
    'estado', (SELECT coalesce(json_agg(json_build_array(estado, round(venda,2),
        round(lucro,2)) ORDER BY venda DESC), '[]'::json) FROM compras.mv_fat_estado),
    'superv', (SELECT coalesce(json_agg(json_build_array(codsupervisor, coalesce(supervisor,'—'),
        round(venda,2), round(lucro,2), round(v12,2)) ORDER BY venda DESC), '[]'::json)
      FROM compras.mv_fat_supervisor),
    'comprador', (SELECT coalesce(json_agg(json_build_array(codcomprador, round(venda,2),
        round(lucro,2), pedidos, positivacao, round(v12,2), round(l12,2))
        ORDER BY venda DESC), '[]'::json) FROM compras.mv_fat_comprador),
    'fornec', (SELECT coalesce(json_agg(json_build_array(codfornec, round(venda,2),
        round(lucro,2), round(v12,2)) ORDER BY venda DESC), '[]'::json)
      FROM (SELECT * FROM compras.mv_fat_fornecedor ORDER BY venda DESC LIMIT 400) t)
  )
);
$function$;
