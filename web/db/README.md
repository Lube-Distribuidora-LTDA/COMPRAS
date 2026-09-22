# Objetos de banco

O painel não consulta as tabelas direto: ele chama **`compras.painel_dados()`**,
uma função que monta todo o conteúdo numa resposta só. A função serverless em
`api/dados.js` é apenas encanamento.

## Views materializadas do faturamento

Os recortes do faturamento vêm de views materializadas, atualizadas pelo ETL
logo depois da carga da Consulta10, dentro da mesma transação:

```
compras.mv_fat_mes            venda, CMV, lucro, pedidos e positivação por mês
compras.mv_fat_mes_comprador  o mesmo, aberto por comprador
compras.mv_fat_mes_depto      o mesmo, aberto por departamento
compras.mv_fat_comprador      acumulado e últimos 12 meses por comprador
compras.mv_fat_fornecedor     acumulado e últimos 12 meses por fornecedor
compras.mv_fat_depto          acumulado e últimos 12 meses por departamento
compras.mv_fat_supervisor     acumulado e últimos 12 meses por supervisor
compras.mv_fat_secao          acumulado por seção de produto
compras.mv_fat_estado         acumulado por UF
```

Por que elas existem: agregar direto no fato de 1,6 milhão de linhas custa
**cerca de 6 segundos por recorte** (varredura completa). Lendo das views, a
mesma informação sai em **menos de 1 ms**. Sem isso o painel não teria como
responder a cada acesso.

Quem atualiza é o ETL — ver `_atualizar_views_faturamento` em
`etl/consultas_compras.py`. Como o `REFRESH` acontece na mesma transação da
carga, as views nunca ficam dessincronizadas do fato.

## Onde mora a definição

Estes objetos foram criados por **migração** no projeto Supabase
**DATA WAREHOUSE**, que é a fonte de verdade e guarda o histórico de alterações.

Para exportar o DDL atual (por exemplo, para revisar numa PR):

```sql
SELECT string_agg('CREATE MATERIALIZED VIEW ' || schemaname || '.' || matviewname
                  || ' AS' || E'\n' || definition, E'\n\n' ORDER BY matviewname)
  FROM pg_matviews WHERE schemaname = 'compras';

SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'compras' AND p.proname = 'painel_dados';
```

Preferimos apontar o comando a manter uma cópia colada aqui: cópia colada
envelhece em silêncio quando alguém altera o banco, e aí o arquivo passa a
mentir sobre o que está rodando.

## Segurança

Todas as tabelas estão com **Row Level Security habilitado e sem políticas**:
as chaves públicas (`anon`) do Supabase não leem nem escrevem nada. O acesso
acontece só por credencial de servidor — o ETL, que roda na rede interna, e a
função `/api/dados`, que usa variáveis de ambiente da Vercel.
