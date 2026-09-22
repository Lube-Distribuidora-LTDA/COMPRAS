#!/usr/bin/env python3
"""
sync_bi_compras.py — orquestrador do BI COMPRAS inteiro.

Roda, numa tacada so, todas as consultas do Power BI "COMPRAS" do Oracle/WinThor
para o Supabase (projeto DATA WAREHOUSE). Substitui o antigo sync_compras.py,
que cuidava so da Consulta1.

Cada consulta roda de forma independente: se uma falhar, as outras continuam, e
o resultado de cada uma fica registrado em compras.controle_carga.

Como usar
---------
    python sync_bi_compras.py                       # tudo (inclusive faturamento)
    python sync_bi_compras.py --grupo rapidas       # tudo, menos o faturamento
    python sync_bi_compras.py --grupo pesadas       # so o faturamento
    python sync_bi_compras.py --consulta estoque_venda saldo_verba
    python sync_bi_compras.py --listar              # mostra o catalogo e sai

Sugestao de agendamento (ver agendar_bi_compras.ps1):
    - "rapidas" 4x ao dia (08:00, 12:00, 18:00, 00:00)
    - "pesadas" 1x ao dia de madrugada (o faturamento tem ~1,6 milhao de linhas
      e nao muda de hora em hora)

Antes de agendar, rode o diagnostico_bi_compras.py — ele testa todas as
consultas SEM gravar nada e diz quais precisam de ajuste.
"""

from __future__ import annotations

import argparse
import sys

import bi_comum as bi
from consultas_compras import CONSULTAS, selecionar

log = bi.configurar_log("sync_bi_compras.log")


def _argumentos() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sincroniza o BI COMPRAS (Oracle/WinThor -> Supabase).")
    p.add_argument("--grupo", choices=("todas", "rapidas", "pesadas"), default="todas",
                   help="Quais consultas rodar. 'rapidas' exclui o faturamento.")
    p.add_argument("--consulta", nargs="+", metavar="NOME",
                   help="Roda apenas as consultas indicadas (pelo nome do catalogo).")
    p.add_argument("--listar", action="store_true", help="Mostra o catalogo de consultas e sai.")
    return p.parse_args()


def _listar() -> int:
    print()
    print(f"{'CONSULTA':28s} {'GRUPO':9s} {'PAGINA DO BI':32s} {'LINHAS (Power BI)':>18s}")
    print("-" * 92)
    for c in CONSULTAS:
        esperado = f"{c.linhas_esperadas:,}".replace(",", ".") if c.linhas_esperadas else "-"
        print(f"{c.nome:28s} {c.grupo:9s} {c.pagina:32s} {esperado:>18s}")
    print()
    return 0


def _formatar(n: int | None) -> str:
    return "-" if n is None else f"{n:,}".replace(",", ".")


def main() -> int:
    args = _argumentos()
    if args.listar:
        return _listar()

    bi.carregar_env()

    try:
        cfg_ora = bi.OracleConfig.from_env()
        cfg_pg = bi.SupabaseConfig.from_env()
    except SystemExit as exc:
        log.error("Configuracao invalida: %s", exc)
        return 1

    log.info("Senha do Supabase carregada do ENV (comprimento: %d caracteres).", len(cfg_pg.password))

    consultas = selecionar(args.grupo, args.consulta)
    log.info("Vou rodar %d consulta(s): %s", len(consultas), ", ".join(c.nome for c in consultas))

    resultados: list[tuple[str, str, int | None, int | None, float]] = []

    try:
        with bi.conectar_oracle(cfg_ora) as conn_ora, bi.conectar_supabase(cfg_pg) as conn_pg:
            for consulta in consultas:
                relogio = bi.cronometro()
                log.info("=" * 70)
                log.info("[%s] %s", consulta.nome, consulta.descricao)
                try:
                    if consulta.streaming:
                        linhas = bi.carregar_em_lotes(conn_ora, conn_pg, consulta)
                    else:
                        brutas = bi.extrair(conn_ora, consulta)
                        log.info("  Oracle devolveu %s linhas.", _formatar(len(brutas)))
                        linhas = bi.carregar(conn_pg, consulta, brutas)
                    conn_pg.commit()
                    segundos = relogio()

                    aviso = bi.avaliar_contagem(consulta, linhas) or ""
                    log.info("  OK — %s linhas em %.1fs -> %s", _formatar(linhas), segundos, consulta.destino)
                    if aviso:
                        log.warning(aviso)
                    resultados.append((consulta.nome, "OK", linhas, consulta.linhas_esperadas, segundos))
                    bi.registrar_execucao(conn_pg, consulta, "OK", linhas, segundos, aviso or None)

                except Exception as exc:  # noqa: BLE001 — uma falha nao pode derrubar as outras
                    conn_pg.rollback()
                    segundos = relogio()
                    log.exception("  FALHOU: %s", consulta.nome)
                    resultados.append((consulta.nome, "ERRO", None, consulta.linhas_esperadas, segundos))
                    bi.registrar_execucao(conn_pg, consulta, "ERRO", None, segundos, f"{type(exc).__name__}: {exc}")

            _resumo(resultados)

    except Exception:
        log.exception("Nao consegui nem abrir as conexoes — nada foi carregado.")
        return 1

    falhas = [r for r in resultados if r[1] != "OK"]
    if falhas:
        log.error("%d consulta(s) falharam: %s", len(falhas), ", ".join(r[0] for r in falhas))
        return 1
    log.info("Todas as consultas foram carregadas com sucesso.")
    return 0


def _resumo(resultados) -> None:
    log.info("=" * 70)
    log.info("RESUMO DA CARGA")
    log.info("%-28s %-6s %12s %12s %9s", "CONSULTA", "STATUS", "LINHAS", "ESPERADO", "TEMPO")
    for nome, status, linhas, esperado, segundos in resultados:
        log.info("%-28s %-6s %12s %12s %8.1fs", nome, status, _formatar(linhas), _formatar(esperado), segundos)
    log.info("=" * 70)


if __name__ == "__main__":
    try:
        codigo = main()
    except Exception:
        log.exception("Erro inesperado — veja o traceback acima / no sync_bi_compras.log.")
        codigo = 1
    sys.exit(codigo)
