#!/usr/bin/env python3
"""
consultas_compras.py — o catalogo completo das consultas do BI COMPRAS.

Cada entrada de CONSULTAS descreve uma consulta do Power BI original:
o SQL no Oracle/WinThor, a tabela de destino no Supabase, as colunas, como
converter uma linha e quantas linhas o Power BI tinha na documentacao
(usado para validar a carga).

Correspondencia com as paginas do Power BI:

    Pagina do BI                 Consulta(s) de origem
    ---------------------------  ---------------------------------------
    COMPRAS                      Consulta1 (ruptura/cobertura)
    SALDO VERBA                  Consulta3
    SALDO VERBA X AVARIA         Consulta3 + Consulta4 (+ Consulta5)
    ESTOQUE x VENDA              Consulta6
    SUGESTAO FORNECEDOR X PROD.  SUGESTAO FORNECEDOR + SUGESTAO PRODUTO
    EXCESSO DE ESTOQUE           Consulta9
    PERFORMANCE COMPRAS          Consulta10
    METRICAS                     Consulta10

A Consulta2 do Power BI era so um carimbo de data/hora (DateTimeZone.LocalNow)
e nao virou tabela: o equivalente aqui e a coluna data_carga de cada tabela e
o log em compras.controle_carga.

Onde o SQL original tinha um bug conhecido, a correcao esta marcada com
"CORRIGIDO:" e o valor original continua disponivel quando faz sentido
comparar (ex.: valor_original em SUGESTAO FORNECEDOR).
"""

from __future__ import annotations

import os
from datetime import date, datetime, timezone

from bi_comum import Consulta, inteiro, num, status_produto, texto

AGORA = lambda: datetime.now(timezone.utc)  # noqa: E731

# Data inicial do fato de faturamento (Consulta10). Pode ser encurtada pelo ENV
# se o banco do Supabase estiver apertado de espaco — sao ~1,6 milhao de linhas
# desde 2021.
_DATA_INICIAL_FATURAMENTO = os.environ.get("FATURAMENTO_DATA_INICIAL", "2021-01-01").strip()


def _data_inicial() -> date:
    try:
        return date.fromisoformat(_DATA_INICIAL_FATURAMENTO)
    except ValueError:
        return date(2021, 1, 1)


# Recortes do faturamento guardados prontos no banco. Sem eles, agregar o fato
# de 1,6 milhao de linhas leva ~6 segundos POR CORTE — o painel web nao teria
# como responder a cada acesso. Sao atualizados aqui, na mesma transacao da
# carga, entao nunca ficam fora de sincronia com o fato.
_VIEWS_FATURAMENTO = (
    "mv_fat_mes", "mv_fat_mes_comprador", "mv_fat_mes_depto", "mv_fat_depto",
    "mv_fat_secao", "mv_fat_estado", "mv_fat_supervisor", "mv_fat_comprador",
    "mv_fat_fornecedor",
)


def _atualizar_views_faturamento(cur) -> None:
    for view in _VIEWS_FATURAMENTO:
        cur.execute(f"REFRESH MATERIALIZED VIEW compras.{view}")


# ===========================================================================
# DIMENSOES (rodam primeiro; carga por upsert, nunca apagam cadastro)
# ===========================================================================

# Matriculas de compradores que nao fazem mais parte da Lube. Ficam de fora
# do cadastro do painel (chips de filtro, "Comprador" nas tabelas, etc.) —
# nao mexe em produto/fornecedor/fato: se algum deles ainda estiver
# associado a um fornecedor no WinThor, o painel mostra esse comprador
# como "—" ate a reatribuicao ser feita na origem.
#   621  BRUNO CELSO IAMONDE TEIXEIRA
#   278  FELIPE MIRANDA FERREIRA
#   376  GILSINEI MANENTI
#   375  NORTON PAULINI
#   277  WESLEY ALVES FRANCA
#   178  RICHARDSON STINGHEL
COMPRADORES_EXCLUIDOS = (621, 278, 376, 375, 277, 178)

SQL_DIM_COMPRADOR = f"""
SELECT DISTINCT C.MATRICULA AS CODCOMPRADOR, C.NOME
  FROM PCPRODUT A, PCFORNEC B, PCEMPR C
 WHERE A.CODFORNEC = B.CODFORNEC
   AND B.CODCOMPRADOR = C.MATRICULA
   AND A.REVENDA = 'S'
   AND C.MATRICULA NOT IN ({", ".join(str(c) for c in COMPRADORES_EXCLUIDOS)})
"""

# Consulta8 do Power BI, acrescida de CODFORNECPRINC (que a original nao trazia
# mas e necessario para ligar com a Consulta3 e a Consulta4).
SQL_DIM_FORNECEDOR = """
SELECT B.CODFORNEC, B.FORNECEDOR, B.CODFORNECPRINC, B.CODCOMPRADOR, C.NOME AS COMPRADOR
  FROM PCPRODUT A, PCFORNEC B, PCEMPR C
 WHERE A.CODFORNEC = B.CODFORNEC
   AND B.CODCOMPRADOR = C.MATRICULA
   AND A.REVENDA = 'S'
 GROUP BY B.CODFORNEC, B.FORNECEDOR, B.CODFORNECPRINC, B.CODCOMPRADOR, C.NOME
"""

# Dimensao de produto: superconjunto de todos os produtos que aparecem nos
# fatos (mesmo criterio da CTE PRODUTO da Consulta6).
SQL_DIM_PRODUTO = """
SELECT PCPRODUT.CODPROD,
       PCPRODUT.DESCRICAO,
       PCPRODUT.QTUNITCX,
       PCPRODUT.CODFORNEC,
       PCFORNEC.CODCOMPRADOR,
       DECODE(PCPRODUT.OBS2,'FL','FORALINHA',' ','ATIVO') AS STATUS
  FROM PCPRODUT, PCFORNEC
 WHERE PCPRODUT.CODFORNEC = PCFORNEC.CODFORNEC
   AND PCPRODUT.DTEXCLUSAO IS NULL
   AND PCPRODUT.REVENDA = 'S'
"""


# ===========================================================================
# Consulta1 -> COMPRAS (ruptura / cobertura)  — ja validada em producao
# ===========================================================================

SQL_RUPTURA_COBERTURA = """
SELECT
  e.matricula            AS codcomprador,
  e.nome                 AS comprador,
  a.codprod,
  a.descricao,
  a.obs2,
  DECODE(a.obs2, ' ', 'ATIVO', 'FL', 'FORALINHA')            AS status,
  a.qtunitcx,
  d.codfornecprinc,
  a.codfornec,
  d.fornecedor,

  (SELECT qtgirodia FROM PCEST
    WHERE codprod = a.codprod AND codfilial = 1)              AS giro_dia_un,

  TRUNC((SELECT qtgirodia / NULLIF(a.qtunitcx,0) FROM PCEST
    WHERE codprod = a.codprod AND codfilial = 1), 4)          AS giro_dia_cx,

  (SELECT qtgirodia * 60 FROM PCEST
    WHERE codprod = a.codprod AND codfilial = 1)              AS giro_60_dias_un,

  (SELECT ((qtgirodia / NULLIF(a.qtunitcx,0)) * 60) FROM PCEST
    WHERE codprod = a.codprod AND codfilial = 1)              AS giro_60_dias_cx,

  (SELECT SUM(qtestger - qtbloqueada - qtreserv) FROM pcest
    WHERE codprod = a.codprod AND codfilial IN (1,2,8))       AS est_disp_un,

  (SELECT SUM((qtestger - qtbloqueada - qtreserv) / NULLIF(qtunitcx,0)) FROM pcest
    WHERE codprod = a.codprod AND codfilial IN (1,2,7,8))     AS est_disp_cx,

  c.pvenda,

  (SELECT (qtvendmes1 + qtvendmes2 + qtvendmes3) FROM PCEST
    WHERE codprod = a.codprod AND codfilial = 1)              AS venda_trimestre,

  (SELECT (qtvendmes1 + qtvendmes2 + qtvendmes3) / NULLIF(3,0) FROM PCEST
    WHERE codprod = a.codprod AND codfilial = 1)              AS media_venda_trimestre,

  ( (SELECT SUM((qtvendmes1 + qtvendmes2 + qtvendmes3) / NULLIF(3,0)) FROM pcest
      WHERE codprod = a.codprod AND codfilial = 1)
    / NULLIF( (SELECT COUNT(data) FROM pcdatas
               WHERE TO_CHAR(data,'MMYYYY') = TO_CHAR(ADD_MONTHS(TRUNC(SYSDATE),0),'MMYYYY')
                 AND diautil = 'S'), 0)
  ) * 7                                                       AS calculo_ruptura,

  CASE WHEN
    ( (SELECT SUM((qtvendmes1 + qtvendmes2 + qtvendmes3) / NULLIF(3,0)) FROM pcest
        WHERE codprod = a.codprod AND codfilial = 1)
      / NULLIF( (SELECT COUNT(data) FROM pcdatas
                 WHERE TO_CHAR(data,'MMYYYY') = TO_CHAR(ADD_MONTHS(TRUNC(SYSDATE),0),'MMYYYY')
                   AND diautil = 'S'), 0)
    ) * 7
    > (SELECT SUM(qtestger - qtbloqueada - qtreserv) FROM pcest
        WHERE codprod = a.codprod AND codfilial IN (1,2,7,8))
  THEN 'SIM' ELSE 'NAO' END                                   AS ruptura,

  (SELECT SUM(DECODE(TIPO,'D',VALOR,0)) - SUM(DECODE(TIPO,'C',VALOR,0))
     FROM PCMOVCRFOR, PCFORNEC
    WHERE PCMOVCRFOR.CODFORNEC = PCFORNEC.CODFORNEC
      AND PCFORNEC.CODFORNECPRINC IN (SELECT CODFORNECPRINC FROM PCFORNEC
                                       WHERE CODFORNEC = d.codfornec)
      AND PCMOVCRFOR.CODFILIAL IN (1))                        AS verba,

  ROUND((SELECT SUM(qtindeniz * valorultent) FROM PCEST
          WHERE codprod = a.codprod AND codfilial IN (1,2,7,8)), 2) AS avaria,

  TRUNC((SELECT (qtgirodia / NULLIF(a.qtunitcx,0)) * 56 FROM PCEST
          WHERE codprod = a.codprod AND codfilial = 1), 4)    AS calculo_cobertura,

  CASE WHEN (SELECT (qtgirodia / NULLIF(a.qtunitcx,0)) * 56 FROM pcest
              WHERE codprod = a.codprod AND codfilial = 1)
          > (SELECT SUM((qtestger - qtbloqueada - qtreserv) / NULLIF(qtunitcx,0)) FROM pcest
              WHERE codprod = a.codprod AND codfilial IN (1,2,7,8))
  THEN 'SIM' ELSE 'NAO' END                                   AS cobertura

FROM pcprodut a, pcest b, pctabpr c, pcfornec d, pcempr e
WHERE a.codprod = b.codprod
  AND a.codprod = c.codprod
  AND a.codfornec = d.codfornec
  AND d.codcomprador = e.matricula
  AND c.numregiao = 1
  AND b.codfilial IN (1,2,7,8)
  AND a.revenda = 'S'
  AND a.dtexclusao IS NULL
GROUP BY a.codprod, a.descricao, a.qtunitcx, c.pvenda, e.matricula, e.nome,
         a.codfornec, d.fornecedor, a.obs2, d.codfornec, d.codfornecprinc
"""


def _mapear_ruptura(r: dict) -> tuple:
    giro_cx = num(r["giro_dia_cx"], 0)
    est_cx = r["est_disp_cx"]
    dias = (est_cx / giro_cx) if (giro_cx and est_cx is not None) else None
    return (
        r["codprod"], r["codfornec"], r["codcomprador"], r["qtunitcx"],
        num(r["giro_dia_un"], 0), giro_cx, r["giro_60_dias_un"], r["giro_60_dias_cx"],
        r["est_disp_un"], est_cx, r["pvenda"], r["venda_trimestre"],
        r["media_venda_trimestre"], r["calculo_ruptura"], r["ruptura"] == "SIM",
        num(r["verba"], 0), num(r["avaria"], 0), num(r["calculo_cobertura"], 0),
        r["cobertura"] == "SIM", dias, (dias is not None and dias <= 7),
        status_produto(r["status"]),
    )


# ===========================================================================
# Consulta3 -> SALDO VERBA
# ===========================================================================

SQL_SALDO_VERBA = """
WITH MOVIMENTACAO AS (
  SELECT
    PCVERBA.NUMVERBA, PCMOVCRFOR.CODFUNC, PCMOVCRFOR.CODCONTA,
    PCMOVCRFOR.CODFORNEC, PCFORNEC.FORNECEDOR, PCMOVCRFOR.DATA,
    PCMOVCRFOR.CODFILIAL,
    FORNECPRINC.CODFORNEC   CODFORNECPRINC,
    FORNECPRINC.FORNECEDOR  FORNECEDORPRINC,
    PCMOVCRFOR.TIPO, PCMOVCRFOR.VALOR, PCVERBA.DTVENC,
    (DECODE(PCMOVCRFOR.TIPO,'C',PCMOVCRFOR.VALOR,0) * -1) VLSAIDA,
     DECODE(PCMOVCRFOR.TIPO,'D',PCMOVCRFOR.VALOR,0)       VLENTRADA
  FROM PCMOVCRFOR, PCVERBA, PCFORNEC, PCFORNEC FORNECPRINC,
       PCEMPR, PCESTCRFOR, PCCONTA
  WHERE PCMOVCRFOR.NUMVERBA  = PCVERBA.NUMVERBA(+)
    AND PCMOVCRFOR.CODFORNEC = PCFORNEC.CODFORNEC
    AND DECODE( NVL(PCMOVCRFOR.CODFORNECPRINC, NVL(PCFORNEC.CODFORNECPRINC,0)), 0,
                PCMOVCRFOR.CODFORNEC,
                NVL(PCMOVCRFOR.CODFORNECPRINC, NVL(PCFORNEC.CODFORNECPRINC,0))
              ) = FORNECPRINC.CODFORNEC
    AND PCMOVCRFOR.CODFUNC   = PCEMPR.MATRICULA(+)
    AND PCMOVCRFOR.CODCONTA  = PCCONTA.CODCONTA(+)
    AND PCMOVCRFOR.CODFORNEC = PCESTCRFOR.CODFORNEC
    AND PCMOVCRFOR.CODFILIAL = PCESTCRFOR.CODFILIAL
    AND PCMOVCRFOR.DATA BETWEEN DATE '2000-01-01' AND DATE '2030-12-31'
)
SELECT
  MOVIMENTACAO.CODFORNECPRINC,
  MOVIMENTACAO.FORNECEDORPRINC,
  SUM(MOVIMENTACAO.VLSAIDA)   VLSAIDA,
  SUM(MOVIMENTACAO.VLENTRADA) VLENTRADA,
  (SUM(MOVIMENTACAO.VLENTRADA) + SUM(MOVIMENTACAO.VLSAIDA)) SALDOMOV,

  NVL((SELECT SUM( DECODE(MOVCRFOR.TIPO,'D',NVL(MOVCRFOR.VALOR,0),0)
                 - DECODE(MOVCRFOR.TIPO,'C',NVL(MOVCRFOR.VALOR,0),0) )
         FROM PCMOVCRFOR MOVCRFOR
        WHERE MOVCRFOR.CODFORNEC IN (SELECT CODFORNEC FROM PCFORNEC
                                      WHERE CODFORNECPRINC = MOVIMENTACAO.CODFORNECPRINC)),0) SALDOFORNEC,

  NVL((SELECT SUM( DECODE(MOVCRFOR.TIPO,'D',NVL(MOVCRFOR.VALOR,0),0)
                 - DECODE(MOVCRFOR.TIPO,'C',NVL(MOVCRFOR.VALOR,0),0) )
         FROM PCMOVCRFOR MOVCRFOR
        WHERE MOVCRFOR.CODFORNEC IN (SELECT CODFORNEC FROM PCFORNEC
                                      WHERE CODFORNECPRINC = MOVIMENTACAO.CODFORNECPRINC)
          AND MOVCRFOR.DATA BETWEEN DATE '2000-01-01' AND DATE '2030-12-31'),0) SALDOPERIODO,

  NVL((SELECT SUM( DECODE(MOVCRFOR.TIPO,'D',NVL(MOVCRFOR.VALOR,0),0)
                 - DECODE(MOVCRFOR.TIPO,'C',NVL(MOVCRFOR.VALOR,0),0) )
         FROM PCMOVCRFOR MOVCRFOR, PCVERBA
        WHERE MOVCRFOR.NUMVERBA = PCVERBA.NUMVERBA
          AND MOVCRFOR.CODFORNEC IN (SELECT CODFORNEC FROM PCFORNEC
                                      WHERE CODFORNECPRINC = MOVIMENTACAO.CODFORNECPRINC)
          AND MOVCRFOR.DATA BETWEEN DATE '2000-01-01' AND DATE '2030-12-31'
          AND PCVERBA.DTVENC < TRUNC(SYSDATE)),0) VLRVENCIDAS,

  NVL((SELECT SUM( DECODE(MOVCRFOR.TIPO,'D',NVL(MOVCRFOR.VALOR,0),0)
                 - DECODE(MOVCRFOR.TIPO,'C',NVL(MOVCRFOR.VALOR,0),0) )
         FROM PCMOVCRFOR MOVCRFOR, PCVERBA
        WHERE MOVCRFOR.NUMVERBA = PCVERBA.NUMVERBA
          AND MOVCRFOR.CODFORNEC IN (SELECT CODFORNEC FROM PCFORNEC
                                      WHERE CODFORNECPRINC = MOVIMENTACAO.CODFORNECPRINC)
          AND MOVCRFOR.DATA BETWEEN DATE '2000-01-01' AND DATE '2030-12-31'
          AND PCVERBA.DTVENC >= TRUNC(SYSDATE)),0) VLRAVENCERFORNECPRINC,

  NVL((SELECT SUM( DECODE(MOVCRFOR.TIPO,'D',NVL(MOVCRFOR.VALOR,0),0)
                 - DECODE(MOVCRFOR.TIPO,'C',NVL(MOVCRFOR.VALOR,0),0) )
         FROM PCMOVCRFOR MOVCRFOR, PCFORNEC FORNEC, PCESTCRFOR ESTCRFOR
        WHERE MOVCRFOR.CODFORNEC = FORNEC.CODFORNEC
          AND MOVCRFOR.CODFORNEC = ESTCRFOR.CODFORNEC
          AND MOVCRFOR.CODFILIAL = ESTCRFOR.CODFILIAL),0) SALDOTOTAL
FROM MOVIMENTACAO
GROUP BY MOVIMENTACAO.CODFORNECPRINC, MOVIMENTACAO.FORNECEDORPRINC
ORDER BY MOVIMENTACAO.CODFORNECPRINC
"""

# Nota: a consulta original tambem trazia SALDOPERIODO filtrando por
# "CODFILIAL IN (as filiais que aparecem na movimentacao daquele fornecedor)".
# Esse filtro e equivalente a nao filtrar por filial na pratica (o conjunto de
# filiais vem da propria movimentacao do fornecedor), entao foi simplificado
# aqui. Se a validacao contra o Power BI mostrar diferenca em SALDOPERIODO,
# essa e a primeira coisa a revisar.


# ===========================================================================
# Consulta4 -> avaria por produto x fornecedor principal
# ===========================================================================

SQL_AVARIA_PROD_FORNEC = """
SELECT A.CODPROD,
       C.CODFORNECPRINC,
       SUM(A.QTINDENIZ * A.VALORULTENT) AS AVARIA
  FROM PCEST A, PCPRODUT B, PCFORNEC C
 WHERE A.CODPROD = B.CODPROD
   AND B.CODFORNEC = C.CODFORNEC
   AND B.REVENDA = 'S'
 GROUP BY C.CODFORNECPRINC, A.CODPROD
"""
# ATENCAO (bug do BI original, mantido de proposito para os numeros baterem):
# no Power BI o filtro "AND A.codfilial IN (1,2,7,8)" esta comentado E escrito
# depois do GROUP BY, ou seja, nunca executa. Resultado: esta tabela soma a
# avaria de TODAS as filiais, enquanto a avaria da Consulta1 considera so
# 1,2,7,8. Diferenca ja medida: 2.613.830,79 aqui vs 2.603.681,79 la.
# Mantido igual ao original para a validacao bater; depois decidimos qual e o
# numero certo para o negocio.


# ===========================================================================
# Consulta5 -> avaria em R$ por produto (fonte oficial do KPI AVARIA)
# ===========================================================================

SQL_AVARIA_PRODUTO = """
SELECT PCPRODUT.CODPROD,
       SUM(ROUND(NVL(PCEST.QTINDENIZ,0) * NVL(PCEST.VALORULTENT,0), 2)) AS VALOR
  FROM PCEST, PCPRODUT
 WHERE PCEST.CODPROD = PCPRODUT.CODPROD
   AND PCEST.CODFILIAL IN (1,2,7,8)
   AND PCEST.QTINDENIZ > 0
 GROUP BY PCPRODUT.CODPROD
"""
# O JOIN com PCFORNEC do original foi removido: ele nao filtrava nada (todo
# produto tem fornecedor) e so deixava a consulta mais pesada.


# ===========================================================================
# Consulta6 -> ESTOQUE x VENDA
# ===========================================================================

def _janela_semanal(indice: int, alias: str) -> str:
    """Monta a CTE de uma das 9 semanas do historico de venda."""
    if indice == 0:
        faixa = "DTMOV >= TRUNC(SYSDATE,'WW') AND DTMOV < TRUNC(SYSDATE,'WW') + 7"
    else:
        ini_txt = f"TRUNC(SYSDATE,'WW') - {abs(7 * indice)}"
        fim_txt = "TRUNC(SYSDATE,'WW')" if indice == 1 else f"TRUNC(SYSDATE,'WW') - {abs(7 * (indice - 1))}"
        faixa = f"DTMOV >= {ini_txt} AND DTMOV < {fim_txt}"
    return f"""{alias} AS (
  SELECT PCMOV.CODPROD, SUM(PCMOV.QT) AS SEMANA_{indice}
    FROM PCMOV
   WHERE PCMOV.CODOPER = 'S' AND PCMOV.CODFILIAL IN ('1','10','7')
     AND {faixa}
   GROUP BY PCMOV.CODPROD
)"""


_CTES_SEMANAS = ",\n".join(_janela_semanal(i, f"VENDAS{i}") for i in range(9))
_SELECT_SEMANAS = ", ".join(f"VEN{i}.SEMANA_{i}" for i in range(9))
_JOIN_SEMANAS = "\n".join(
    f"LEFT JOIN VENDAS{i} VEN{i} ON PROD.CODPROD = VEN{i}.CODPROD" for i in range(9)
)

SQL_ESTOQUE_VENDA = f"""
WITH PRODUTO AS (
  SELECT PCFORNEC.CODCOMPRADOR, PCEMPR.NOME AS COMPRADOR,
         PCFORNEC.CODFORNEC, PCFORNEC.FORNECEDOR,
         PCPRODUT.CODPROD, PCPRODUT.DESCRICAO AS PRODUTO,
         PCPRODUT.CODAUXILIAR, PCPRODUT.CODAUXILIAR2,
         PCPRODUT.UNIDADE       AS COD_UNID_VENDA,  PCUNIDADE.DESCRICAO AS UNIDADE_VENDA,
         PCPRODUT.QTUNIT        AS QTD_VENDA,
         PCPRODUT.UNIDADEMASTER AS COD_UNID_COMPRA, U.DESCRICAO         AS UNIDADE_COMPRA,
         PCPRODUT.QTUNITCX      AS QTD_COMPRA,
         DECODE(PCPRODUT.OBS2,'FL','FORALINHA',' ','ATIVO') AS STATUS
    FROM PCPRODUT, PCFORNEC, PCEMPR, PCUNIDADE, PCUNIDADE U
   WHERE PCPRODUT.CODFORNEC = PCFORNEC.CODFORNEC
     AND PCFORNEC.CODCOMPRADOR = PCEMPR.MATRICULA
     AND PCPRODUT.UNIDADE = PCUNIDADE.UNIDADE
     AND PCPRODUT.UNIDADEMASTER = U.UNIDADE
     AND PCPRODUT.DTEXCLUSAO IS NULL
     AND PCPRODUT.REVENDA = 'S'
),
ESTOQUE AS (
  SELECT PCEST.CODPROD,
         SUM(PCEST.QTESTGER)                                      AS ESTOQUE,
         SUM(PCEST.QTRESERV)                                      AS EST_RESERVADO,
         SUM(PCEST.QTBLOQUEADA)                                   AS EST_BLOQUEADO,
         SUM(PCEST.QTBLOQUEADA - PCEST.QTINDENIZ)                 AS EST_BLOQUEADO_SEMAV,
         SUM(PCEST.QTINDENIZ)                                     AS EST_AVARIA,
         SUM(PCEST.QTESTGER - PCEST.QTRESERV - PCEST.QTBLOQUEADA)  AS EST_DISPONIVEL
    FROM PCEST
   WHERE PCEST.CODFILIAL IN (1,2,8,7,10)
   GROUP BY PCEST.CODPROD
),
PRECOFIXO AS (
  SELECT CODPROD, MIN(PCPRECOPROM.PRECOFIXO) PRECOFIXO
    FROM PCPRECOPROM
   WHERE PCPRECOPROM.NUMREGIAO = 1
     AND PCPRECOPROM.DTFIMVIGENCIA >= SYSDATE - 1
     AND PCPRECOPROM.CODCLI IS NULL
     AND PCPRECOPROM.CODFILIAL IN ('1','10','7')
   GROUP BY CODPROD
),
PRECO AS (
  SELECT PCTABPR.CODPROD, PCTABPR.PVENDA, PCTABPR.VLST AS ST
    FROM PCTABPR WHERE PCTABPR.NUMREGIAO = 1
),
PEDIDO_AGG AS (
  SELECT PCITEM.CODPROD,
         SUM(PCITEM.QTPEDIDA - PCITEM.QTENTREGUE) AS QTD_PENDENTE,
         MAX(PCITEM.NUMPED)                       AS NUMPED
    FROM PCPEDIDO, PCITEM
   WHERE PCPEDIDO.NUMPED = PCITEM.NUMPED
     AND PCPEDIDO.CODFILIAL IN ('1','10','7')
     AND (PCITEM.QTPEDIDA - PCITEM.QTENTREGUE) > 0
   GROUP BY PCITEM.CODPROD
),
{_CTES_SEMANAS},
VENDASTOT AS (
  SELECT PCMOV.CODPROD, SUM(PCMOV.QT) AS SEMANATOT
    FROM PCMOV
   WHERE PCMOV.CODOPER = 'S' AND PCMOV.CODFILIAL IN ('1','10','7')
     AND DTMOV >= TRUNC(SYSDATE,'WW') - 56 AND DTMOV < TRUNC(SYSDATE,'WW') + 7
   GROUP BY PCMOV.CODPROD
)
SELECT
  PROD.CODCOMPRADOR, PROD.COMPRADOR, PROD.CODFORNEC, PROD.FORNECEDOR,
  PROD.CODPROD, PROD.PRODUTO,
  PROD.CODAUXILIAR  AS EAN,
  PROD.CODAUXILIAR2 AS DUN,
  PROD.COD_UNID_VENDA, PROD.UNIDADE_VENDA, PROD.QTD_VENDA,
  PROD.COD_UNID_COMPRA, PROD.UNIDADE_COMPRA, PROD.QTD_COMPRA, PROD.STATUS,
  EST.ESTOQUE, EST.EST_RESERVADO, EST.EST_BLOQUEADO,
  EST.EST_AVARIA, EST.EST_BLOQUEADO_SEMAV, EST.EST_DISPONIVEL,
  CASE WHEN FIXO.PRECOFIXO > 0 THEN FIXO.PRECOFIXO ELSE PRE.PVENDA END AS PRECO_VENDA,
  NVL(PRE.ST,0) AS ST,
  PED.NUMPED, PED.QTD_PENDENTE,
  {_SELECT_SEMANAS},
  VENTOT.SEMANATOT AS VENDA_TOTAL
FROM PRODUTO PROD
LEFT JOIN ESTOQUE EST      ON PROD.CODPROD = EST.CODPROD
LEFT JOIN PRECO PRE        ON PROD.CODPROD = PRE.CODPROD
LEFT JOIN PEDIDO_AGG PED   ON PROD.CODPROD = PED.CODPROD
{_JOIN_SEMANAS}
LEFT JOIN VENDASTOT VENTOT ON PROD.CODPROD = VENTOT.CODPROD
LEFT JOIN PRECOFIXO FIXO   ON PROD.CODPROD = FIXO.CODPROD
ORDER BY PROD.PRODUTO
"""


def _media_aparada(semanas: list, semanatot) -> float | None:
    """MEDIA — media aparada: descarta a melhor e a pior das 9 semanas."""
    if semanatot is None or semanatot <= 1:
        return None
    com_venda = sum(1 for s in semanas if (s or 0) > 0)
    if com_venda - 2 <= 0:
        return None
    maior = max((s or 0) for s in semanas)
    candidatos = [s for s in semanas if s is not None]
    menor = min(candidatos) if candidatos else 0
    return float(semanatot - maior - menor) / (com_venda - 2)


def _mapear_estoque_venda(r: dict) -> tuple:
    if r.get("venda_total") is None:
        r["venda_total"] = 0
    semanas = [r.get(f"semana_{i}") for i in range(9)]
    media = _media_aparada(semanas, r["venda_total"])
    disp = r.get("est_disponivel")
    cob = (float((disp or 0) + (r.get("est_bloqueado_semav") or 0)) / media) if media else None
    sug_bruta = (media * 8 - float(disp or 0)) if media is not None else None
    sug = sug_bruta if (sug_bruta is not None and sug_bruta > 0) else None
    return (
        r["codprod"], r["codfornec"], r["codcomprador"], texto(r["ean"]), texto(r["dun"]),
        texto(r["cod_unid_venda"]), texto(r["unidade_venda"]), r["qtd_venda"],
        texto(r["cod_unid_compra"]), texto(r["unidade_compra"]), r["qtd_compra"],
        status_produto(r["status"]),
        r["estoque"], r["est_reservado"], r["est_bloqueado"], r["est_avaria"],
        r["est_bloqueado_semav"], disp, r["preco_venda"], r["st"],
        inteiro(r["numped"]), r["qtd_pendente"],
        *semanas, r["venda_total"], media, cob, sug,
    )


# ===========================================================================
# Consulta7 -> pares comprador x fornecedor com sugestao positiva
# ===========================================================================

SQL_COMPRADOR_FORNEC_SUGESTAO = """
SELECT DISTINCT F.CODCOMPRADOR, PCEMPR.NOME, F.CODFORNEC
  FROM PCEST P1, PCTABPR, PCPRODUT P, PCFORNEC F, PCEST P2, PCEMPR
 WHERE PCEMPR.MATRICULA = F.CODCOMPRADOR
   AND P1.CODFILIAL IN (1)
   AND P2.CODFILIAL IN (2)
   AND P1.CODPROD = PCTABPR.CODPROD
   AND PCTABPR.NUMREGIAO = 1
   AND P.CODPROD = P1.CODPROD
   AND P.CODFORNEC = F.CODFORNEC
   AND P.CODPROD = PCTABPR.CODPROD
   AND P1.CODPROD = P2.CODPROD
   AND ROUND( ((P1.QTGIRODIA * 30)
        - ( (NVL(P1.QTESTGER,0) - NVL(P1.QTRESERV,0) - NVL(P1.QTBLOQUEADA,0))
          + (NVL(P2.QTESTGER,0) - NVL(P2.QTRESERV,0) - NVL(P2.QTBLOQUEADA,0)) ))
        * NVL(PCTABPR.PTABELA4,0) ) > 0
"""


# ===========================================================================
# Consulta9 -> EXCESSO DE ESTOQUE
# ===========================================================================

_DISP_128 = """( (NVL(P1.QTESTGER,0) - NVL(P1.QTRESERV,0) - NVL(P1.QTBLOQUEADA,0))
       + (NVL(P2.QTESTGER,0) - NVL(P2.QTRESERV,0) - NVL(P2.QTBLOQUEADA,0))
       + (NVL(P8.QTESTGER,0) - NVL(P8.QTRESERV,0) - NVL(P8.QTBLOQUEADA,0)) )"""

SQL_EXCESSO_PRODUTO = f"""
SELECT P1.CODPROD,
       P.DESCRICAO AS PRODUTO,
       P.CODFORNEC,
       P1.QTGIRODIA      AS GIRODIA,
       P1.QTGIRODIA * 60 AS GIRO60,
       {_DISP_128} AS QT_DISP,
       (P1.QTGIRODIA * 60) - {_DISP_128} AS SUGESTAO,
       PCTABPR.PTABELA4 AS TABELA4,
       ROUND( ((P1.QTGIRODIA * 60) - {_DISP_128}) * NVL(PCTABPR.PTABELA4,0) ) AS VALOR
  FROM PCEST P1, PCTABPR, PCPRODUT P, PCFORNEC F, PCEST P2, PCEMPR, PCEST P8
 WHERE PCEMPR.MATRICULA = F.CODCOMPRADOR
   AND P1.CODFILIAL IN (1)
   AND P2.CODFILIAL IN (2)
   AND P8.CODFILIAL = 8
   AND P1.CODPROD = PCTABPR.CODPROD
   AND PCTABPR.NUMREGIAO = 1
   AND P.CODPROD = P1.CODPROD
   AND P.CODPROD = P8.CODPROD
   AND P.CODFORNEC = F.CODFORNEC
   AND P.CODPROD = PCTABPR.CODPROD
   AND P1.CODPROD = P2.CODPROD
   AND ROUND( ((P1.QTGIRODIA * 60) - {_DISP_128}) * NVL(PCTABPR.PTABELA4,0) ) < 0
"""


# ===========================================================================
# Consulta10 -> PERFORMANCE COMPRAS / METRICAS (faturamento)
# ===========================================================================

SQL_FATURAMENTO = """
SELECT a.data,
       d.uf              AS estado,
       l.codsupervisor,  l.nome AS supervisor,
       f.codfornec,      f.fornecedor,
       f.codcomprador,   g.nome AS comprador,
       i.codepto,        i.descricao AS departamento,
       h.codsec,         h.descricao AS secao,
       COUNT(a.NUMPED)            QTPED,
       COUNT(DISTINCT(a.CODCLI))  POSITIVACAO,
       SUM(DECODE(a.CONDVENDA,'1',(b.QT * (b.pvenda - b.st))))              VENDA,
       SUM(COALESCE(b.VLCUSTOFIN - b.ST,0) * COALESCE(b.QT,0))              CMV,
       ( SUM(DECODE(a.CONDVENDA,'1',(b.QT * (b.pvenda - b.st))))
       - SUM(COALESCE(b.VLCUSTOFIN - b.ST,0) * COALESCE(b.QT,0)) )          VALOR_LUCRO,
       CASE WHEN NVL(SUM(DECODE(a.CONDVENDA,'1',(b.QT*(b.pvenda-b.st)))),0) = 0 THEN NULL
            ELSE ( SUM(DECODE(a.CONDVENDA,'1',(b.QT*(b.pvenda-b.st))))
                 - SUM(COALESCE(b.VLCUSTOFIN - b.ST,0) * COALESCE(b.QT,0)) )
                 / SUM(DECODE(a.CONDVENDA,'1',(b.QT*(b.pvenda-b.st)))) * 100
       END                                                                  MARGEM
  FROM pcpedc a, pcpedi b, pcclient c, pccidade d, pcprodut e, pcfornec f,
       pcempr g, pcsecao h, pcdepto i, pcusuari j, pcsuperv l
 WHERE a.numped = b.numped
   AND a.codcli = c.codcli
   AND c.codcidade = d.codcidade
   AND b.codprod = e.codprod
   AND e.codfornec = f.codfornec
   AND f.codcomprador = g.matricula
   AND e.codsec = h.codsec
   AND e.codepto = i.codepto
   AND a.codusur = j.codusur
   AND j.codsupervisor = l.codsupervisor
   AND a.condvenda = 1
   AND a.codfilial IN ('1','10','11','7')
   AND a.posicao IN ('B','L','M','F')
   AND a.data >= :data_inicial
 GROUP BY a.data, d.uf, f.codcomprador, g.nome, i.codepto, i.descricao,
          h.codsec, h.descricao, f.codfornec, f.fornecedor,
          l.codsupervisor, l.nome
"""
# CORRIGIDO: a margem no original era "CASE WHEN VENDA = 100 THEN NULL", que e
# claramente um resquicio de teste (compara com 100 em vez de 0). Aqui virou
# "= 0", que e a protecao contra divisao por zero de verdade.


# ===========================================================================
# SUGESTAO PRODUTO
# ===========================================================================

SQL_SUGESTAO_PRODUTO = """
SELECT A.CODFILIAL, A.CODPROD, B.DESCRICAO,
       NVL(SUM(DECODE(A.CODOPER,'S', A.QT,0)),0)                      AS VOLUME_BRUTO,
       NVL(SUM(DECODE(A.CODOPER,'ED',A.QT,0)),0)                      AS DEVOLUCAO,
       NVL(SUM(DECODE(A.CODOPER,'S', A.QT,0)),0)
     - NVL(SUM(DECODE(A.CODOPER,'ED',A.QT,0)),0)                      AS VOLUME_LIQUIDO,
       B.QTUNITCX,
       (NVL(SUM(DECODE(A.CODOPER,'S',A.QT,0)),0)
      - NVL(SUM(DECODE(A.CODOPER,'ED',A.QT,0)),0)) / 90               AS GIRO_DIA_UND,
       ((NVL(SUM(DECODE(A.CODOPER,'S',A.QT,0)),0)
       - NVL(SUM(DECODE(A.CODOPER,'ED',A.QT,0)),0)) / NULLIF(B.QTUNITCX,0)) / 90 AS GIRO_DIA_CX,
       (NVL(E.QTESTGER,0) - NVL(E.QTRESERV,0) - NVL(E.QTBLOQUEADA,0)) AS QT_DISP,
       NVL(E.QTGIRODIA,0)                                             AS QTGIRODIA,
       ROUND( (NVL(E.QTGIRODIA,0)*30)
            - (NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)), 0) AS SUGESTAO,
       NVL(P.PTABELA4,0)                                              AS PTABELA4,
       ROUND( ( (NVL(E.QTGIRODIA,0)*30)
              - (NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)) )
              * NVL(P.PTABELA4,0), 0)                                 AS VALOR
  FROM PCMOV A
  INNER JOIN PCPRODUT B ON A.CODPROD = B.CODPROD
  LEFT  JOIN PCEST    E ON A.CODPROD = E.CODPROD AND A.CODFILIAL = E.CODFILIAL
  LEFT  JOIN PCTABPR  P ON A.CODPROD = P.CODPROD AND P.NUMREGIAO = 1
 WHERE A.CODFILIAL IN ('1','7','12')
   AND A.DTMOV >= ADD_MONTHS(TRUNC(SYSDATE,'MM'), -3)
   AND A.DTMOV <  TRUNC(SYSDATE,'MM')
   AND A.DTCANCEL IS NULL
   AND B.DTEXCLUSAO IS NULL
   AND B.REVENDA = 'S'
   AND A.CODUSUR NOT IN (1248,1249)
 GROUP BY A.CODFILIAL, A.CODPROD, B.DESCRICAO, B.QTUNITCX,
          E.QTESTGER, E.QTRESERV, E.QTBLOQUEADA, E.QTGIRODIA, P.PTABELA4
HAVING ROUND( (NVL(E.QTGIRODIA,0)*30)
            - (NVL(E.QTESTGER,0)-NVL(E.QTRESERV,0)-NVL(E.QTBLOQUEADA,0)), 0) > 0
"""
# Unica mudanca em relacao ao original: NULLIF(B.QTUNITCX,0) no GIRO_DIA_CX,
# para nao estourar divisao por zero em produto com QTUNITCX zerado.


# ===========================================================================
# SUGESTAO FORNECEDOR
# ===========================================================================

_DISP_1278 = """( (NVL(P1.QTESTGER,0)-NVL(P1.QTRESERV,0)-NVL(P1.QTBLOQUEADA,0))
          + (NVL(P2.QTESTGER,0)-NVL(P2.QTRESERV,0)-NVL(P2.QTBLOQUEADA,0))
          + (NVL(P7.QTESTGER,0)-NVL(P7.QTRESERV,0)-NVL(P7.QTBLOQUEADA,0))
          + (NVL(P8.QTESTGER,0)-NVL(P8.QTRESERV,0)-NVL(P8.QTBLOQUEADA,0)) )"""

SQL_SUGESTAO_FORNECEDOR = f"""
SELECT F.CODFORNEC,
       F.FORNECEDOR,
       F.CODCOMPRADOR,
       PCEMPR.NOME AS COMPRADOR,
       SUM(P1.QTGIRODIA)      AS GIRODIA,
       SUM(P1.QTGIRODIA * 30) AS GIRO30,
       SUM({_DISP_1278})      AS QT_DISP,
       SUM((P1.QTGIRODIA*30) - {_DISP_1278}) AS SUGESTAO,
       ROUND( SUM((P1.QTGIRODIA*30) - {_DISP_1278}) * MAX(NVL(PCTABPR.PTABELA4,0)) ) AS VALOR_ORIGINAL,
       ROUND( SUM( ((P1.QTGIRODIA*30) - {_DISP_1278}) * NVL(PCTABPR.PTABELA4,0) ) )  AS VALOR
  FROM PCEST P1
  JOIN PCTABPR    ON P1.CODPROD = PCTABPR.CODPROD
  JOIN PCPRODUT P ON P.CODPROD = P1.CODPROD
  JOIN PCFORNEC F ON P.CODFORNEC = F.CODFORNEC
  JOIN PCEMPR     ON PCEMPR.MATRICULA = F.CODCOMPRADOR
  JOIN PCEST P2   ON P1.CODPROD = P2.CODPROD
  JOIN PCEST P7   ON P1.CODPROD = P7.CODPROD
  JOIN PCEST P8   ON P1.CODPROD = P8.CODPROD
 WHERE P1.CODFILIAL = 1 AND P2.CODFILIAL = 2
   AND P7.CODFILIAL = 7 AND P8.CODFILIAL = 8
   AND PCTABPR.NUMREGIAO = 1
 GROUP BY F.CODFORNEC, F.FORNECEDOR, F.CODCOMPRADOR, PCEMPR.NOME
HAVING ROUND( SUM((P1.QTGIRODIA*30) - {_DISP_1278}) * MAX(NVL(PCTABPR.PTABELA4,0)) ) > 0
"""
# CORRIGIDO (mantendo o original ao lado para comparar):
#   valor_original = SUM(sugestao) * MAX(preco)  -> como estava no Power BI;
#                    multiplica a sugestao somada de todos os produtos pelo
#                    preco do produto mais caro, o que superestima o valor.
#   valor          = SUM(sugestao_do_produto * preco_do_produto) -> o certo.
# O HAVING continua usando o calculo original, para o numero de linhas (144)
# bater com o Power BI na validacao.


# ===========================================================================
# CATALOGO
# ===========================================================================

CONSULTAS: list[Consulta] = [
    # ---------------- dimensoes ----------------
    Consulta(
        nome="dim_comprador",
        descricao="Compradores (PCEMPR) que respondem por algum produto de revenda",
        pagina="(dimensao compartilhada)",
        sql=SQL_DIM_COMPRADOR,
        destino="core.dim_comprador",
        colunas=("codcomprador", "nome", "updated_at"),
        chave_conflito=("codcomprador",),
        mapear=lambda r: (r["codcomprador"], texto(r["nome"]), AGORA()),
        linhas_esperadas=None,
    ),
    Consulta(
        nome="dim_fornecedor",
        descricao="Consulta8 — dimensao de fornecedor x comprador (+ codfornecprinc)",
        pagina="(dimensao compartilhada)",
        sql=SQL_DIM_FORNECEDOR,
        destino="core.dim_fornecedor",
        colunas=("codfornec", "fornecedor", "codfornecprinc", "codcomprador", "updated_at"),
        chave_conflito=("codfornec",),
        mapear=lambda r: (r["codfornec"], texto(r["fornecedor"]), r["codfornecprinc"],
                          r["codcomprador"], AGORA()),
        linhas_esperadas=1759,
    ),
    Consulta(
        nome="dim_produto",
        descricao="Produtos de revenda ativos no cadastro (PCPRODUT)",
        pagina="(dimensao compartilhada)",
        sql=SQL_DIM_PRODUTO,
        destino="core.dim_produto",
        colunas=("codprod", "descricao", "qtunitcx", "status", "revenda",
                 "codfornec", "codcomprador", "updated_at"),
        chave_conflito=("codprod",),
        mapear=lambda r: (r["codprod"], texto(r["descricao"]), r["qtunitcx"],
                          status_produto(r["status"]), True,
                          r["codfornec"], r["codcomprador"], AGORA()),
        linhas_esperadas=None,
    ),

    # ---------------- fatos ----------------
    Consulta(
        nome="ruptura_cobertura",
        descricao="Consulta1 — ruptura (7 dias) e cobertura (56 dias) por produto",
        pagina="COMPRAS",
        sql=SQL_RUPTURA_COBERTURA,
        destino="compras.fato_ruptura_cobertura",
        colunas=("codprod", "codfornec", "codcomprador", "qtunitcx",
                 "giro_dia_un", "giro_dia_cx", "giro_60_dias_un", "giro_60_dias_cx",
                 "est_disp_un", "est_disp_cx", "pvenda", "venda_trimestre",
                 "media_venda_trimestre", "calculo_ruptura", "ruptura",
                 "verba", "avaria", "calculo_cobertura", "cobertura",
                 "dias_venda", "ruptura_venda", "status"),
        mapear=_mapear_ruptura,
        linhas_esperadas=7166,
    ),
    Consulta(
        nome="saldo_verba",
        descricao="Consulta3 — saldo de verba por fornecedor principal",
        pagina="SALDO VERBA / SALDO VERBA X AVARIA",
        sql=SQL_SALDO_VERBA,
        destino="compras.fato_saldo_verba",
        colunas=("codfornecprinc", "fornecedorprinc", "vlsaida", "vlentrada", "saldomov",
                 "saldofornec", "saldoperiodo", "vlrvencidas", "vlravencerfornecprinc",
                 "saldototal"),
        mapear=lambda r: (r["codfornecprinc"], texto(r["fornecedorprinc"]),
                          r["vlsaida"], r["vlentrada"], r["saldomov"], r["saldofornec"],
                          r["saldoperiodo"], r["vlrvencidas"], r["vlravencerfornecprinc"],
                          r["saldototal"]),
        linhas_esperadas=719,
    ),
    Consulta(
        nome="avaria_prod_fornec",
        descricao="Consulta4 — avaria por produto x fornecedor principal (todas as filiais)",
        pagina="SALDO VERBA X AVARIA",
        sql=SQL_AVARIA_PROD_FORNEC,
        destino="compras.fato_avaria_prod_fornec",
        colunas=("codprod", "codfornecprinc", "avaria"),
        mapear=lambda r: (r["codprod"], r["codfornecprinc"], num(r["avaria"], 0)),
        linhas_esperadas=26830,
    ),
    Consulta(
        nome="avaria_produto",
        descricao="Consulta5 — avaria em R$ por produto (fonte do KPI AVARIA)",
        pagina="SALDO VERBA X AVARIA",
        sql=SQL_AVARIA_PRODUTO,
        destino="compras.fato_avaria_produto",
        colunas=("codprod", "valor"),
        mapear=lambda r: (r["codprod"], num(r["valor"], 0)),
        linhas_esperadas=3954,
    ),
    Consulta(
        nome="estoque_venda",
        descricao="Consulta6 — 9 semanas de venda, media aparada, cobertura e sugestao",
        pagina="ESTOQUE x VENDA",
        sql=SQL_ESTOQUE_VENDA,
        destino="compras.fato_estoque_venda",
        colunas=("codprod", "codfornec", "codcomprador", "ean", "dun",
                 "cod_unid_venda", "unidade_venda", "qtd_venda",
                 "cod_unid_compra", "unidade_compra", "qtd_compra", "status",
                 "estoque", "est_reservado", "est_bloqueado", "est_avaria",
                 "est_bloqueado_semav", "est_disponivel", "preco_venda", "st",
                 "numped", "qtd_pendente",
                 "venda_semana0", "venda_semana1", "venda_semana2", "venda_semana3",
                 "venda_semana4", "venda_semana5", "venda_semana6", "venda_semana7",
                 "venda_semana8", "venda_total", "media", "cob", "sug"),
        mapear=_mapear_estoque_venda,
        linhas_esperadas=7271,
    ),
    Consulta(
        nome="comprador_fornec_sugestao",
        descricao="Consulta7 — pares comprador x fornecedor com sugestao positiva (30 dias)",
        pagina="SUGESTAO FORNECEDOR X PRODUTO",
        sql=SQL_COMPRADOR_FORNEC_SUGESTAO,
        destino="compras.dim_comprador_fornec_sugestao",
        colunas=("codcomprador", "nome", "codfornec"),
        mapear=lambda r: (r["codcomprador"], texto(r["nome"]), r["codfornec"]),
        linhas_esperadas=269,
        # Margem maior: o filtro depende do ESTOQUE DE HOJE, entao o numero de
        # linhas oscila sozinho de um dia para o outro.
        tolerancia_pct=0.15,
    ),
    Consulta(
        nome="excesso_produto",
        descricao="Consulta9 — produtos com sugestao negativa em 60 dias (excesso)",
        pagina="EXCESSO DE ESTOQUE",
        sql=SQL_EXCESSO_PRODUTO,
        destino="compras.fato_excesso_produto",
        colunas=("codprod", "produto", "codfornec", "girodia", "giro60",
                 "qt_disp", "sugestao", "tabela4", "valor"),
        mapear=lambda r: (r["codprod"], texto(r["produto"]), r["codfornec"],
                          r["girodia"], r["giro60"], r["qt_disp"], r["sugestao"],
                          r["tabela4"], r["valor"]),
        linhas_esperadas=2052,
        # Margem maior: o filtro depende do ESTOQUE DE HOJE, entao o numero de
        # linhas oscila sozinho de um dia para o outro.
        tolerancia_pct=0.15,
    ),
    Consulta(
        nome="sugestao_produto",
        descricao="SUGESTAO PRODUTO — sugestao de compra por filial x produto (30 dias)",
        pagina="SUGESTAO FORNECEDOR X PRODUTO",
        sql=SQL_SUGESTAO_PRODUTO,
        destino="compras.fato_sugestao_produto",
        colunas=("codfilial", "codprod", "descricao", "volume_bruto", "devolucao",
                 "volume_liquido", "qtunitcx", "giro_dia_und", "giro_dia_cx",
                 "qt_disp", "qtgirodia", "sugestao", "ptabela4", "valor"),
        mapear=lambda r: (texto(r["codfilial"]), r["codprod"], texto(r["descricao"]),
                          r["volume_bruto"], r["devolucao"], r["volume_liquido"],
                          r["qtunitcx"], r["giro_dia_und"], r["giro_dia_cx"],
                          r["qt_disp"], r["qtgirodia"], r["sugestao"],
                          r["ptabela4"], r["valor"]),
        linhas_esperadas=1883,
        # Margem maior: o filtro depende do ESTOQUE DE HOJE, entao o numero de
        # linhas oscila sozinho de um dia para o outro.
        tolerancia_pct=0.15,
    ),
    Consulta(
        nome="sugestao_fornecedor",
        descricao="SUGESTAO FORNECEDOR — sugestao consolidada por fornecedor (30 dias)",
        pagina="SUGESTAO FORNECEDOR X PRODUTO",
        sql=SQL_SUGESTAO_FORNECEDOR,
        destino="compras.fato_sugestao_fornecedor",
        colunas=("codfornec", "fornecedor", "codcomprador", "comprador",
                 "girodia", "giro30", "qt_disp", "sugestao", "valor_original", "valor"),
        mapear=lambda r: (r["codfornec"], texto(r["fornecedor"]), r["codcomprador"],
                          texto(r["comprador"]), r["girodia"], r["giro30"],
                          r["qt_disp"], r["sugestao"], r["valor_original"], r["valor"]),
        linhas_esperadas=144,
        # Margem maior: o filtro depende do ESTOQUE DE HOJE, entao o numero de
        # linhas oscila sozinho de um dia para o outro.
        tolerancia_pct=0.15,
    ),

    # ---------------- pesada (roda 1x por dia) ----------------
    Consulta(
        nome="faturamento",
        descricao="Consulta10 — sell-out desde 2021 (a maior tabela do BI)",
        pagina="PERFORMANCE COMPRAS / METRICAS",
        sql=SQL_FATURAMENTO,
        destino="compras.fato_faturamento",
        colunas=("data", "estado", "codsupervisor", "supervisor", "codfornec", "fornecedor",
                 "codcomprador", "comprador", "codepto", "departamento", "codsec", "secao",
                 "qtped", "positivacao", "venda", "cmv", "valor_lucro", "margem"),
        mapear=lambda r: (r["data"], texto(r["estado"]), r["codsupervisor"], texto(r["supervisor"]),
                          r["codfornec"], texto(r["fornecedor"]), r["codcomprador"],
                          texto(r["comprador"]), r["codepto"], texto(r["departamento"]),
                          r["codsec"], texto(r["secao"]), inteiro(r["qtped"]),
                          inteiro(r["positivacao"]), r["venda"], r["cmv"],
                          r["valor_lucro"], r["margem"]),
        linhas_esperadas=1615340,
        grupo="pesadas",
        streaming=True,
        binds={"data_inicial": _data_inicial()},
        pos_carga=_atualizar_views_faturamento,
    ),
]


def por_nome(nome: str) -> Consulta | None:
    for c in CONSULTAS:
        if c.nome == nome:
            return c
    return None


def selecionar(grupo: str = "todas", nomes: list[str] | None = None) -> list[Consulta]:
    if nomes:
        escolhidas = [por_nome(n) for n in nomes]
        faltando = [n for n, c in zip(nomes, escolhidas) if c is None]
        if faltando:
            raise SystemExit(f"Consulta(s) desconhecida(s): {', '.join(faltando)}")
        return [c for c in escolhidas if c]
    if grupo == "todas":
        return list(CONSULTAS)
    return [c for c in CONSULTAS if c.grupo == grupo or c.nome.startswith("dim_")]
