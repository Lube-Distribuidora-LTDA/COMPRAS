# BI COMPRAS — Lube Distribuidora

Reconstrução do Power BI "COMPRAS" em pipeline próprio: extrai do Oracle/WinThor,
grava no Supabase (projeto **DATA WAREHOUSE**) e alimenta o painel web.

> **Este repositório deve permanecer privado.** Ele não contém senhas — o arquivo
> `ENV` está no `.gitignore` e o `ENV.example` traz apenas espaços reservados —
> mas descreve a estrutura interna do banco e as regras de negócio da operação.

---

## Estrutura

```
etl/     pipeline Python que roda na VM dentro da rede do WinThor
web/     painel publicado na Vercel
web/db/  documentação dos objetos de banco que o painel usa
```

```
Oracle/WinThor  ──etl/──►  Supabase (DATA WAREHOUSE)  ──/api/dados──►  painel
   rede interna              16 tabelas + 9 views             Vercel
                             materializadas
```

---

## web/ — o painel

Site estático mais uma função serverless, sem framework. A Vercel serve o
`index.html` e transforma `api/dados.js` em endpoint.

| Caminho | O que é |
|---|---|
| `index.html` | O painel inteiro: 8 páginas, CSS e JS num arquivo só. |
| `api/dados.js` | Função serverless que consulta o Supabase e devolve o JSON. |
| `db/README.md` | Os objetos de banco que o painel usa e por que existem. |
| `vercel.json` | Memória e duração da função, mais cabeçalhos de segurança. |

O navegador **nunca** fala com o banco: ele chama `/api/dados`, e é a função,
rodando no servidor da Vercel, que consulta o Supabase com credencial guardada
em variável de ambiente. A resposta fica no CDN por 10 minutos, então só o
primeiro acesso de cada janela toca o banco.

### Configuração na Vercel

Em **Settings › Environment Variables**, para Production, Preview e Development:

| Variável | Valor |
|---|---|
| `SUPABASE_DB_HOST` | `aws-0-sa-east-1.pooler.supabase.com` |
| `SUPABASE_DB_PORT` | `6543` — *transaction pooler*, o indicado para serverless |
| `SUPABASE_DB_NAME` | `postgres` |
| `SUPABASE_DB_USER` | `postgres.<id-do-projeto>` |
| `SUPABASE_DB_PASSWORD` | a senha do projeto DATA WAREHOUSE |

São os mesmos valores do `ENV` do pipeline, **trocando a porta 5432 pela 6543**:
o *session pooler* mantém conexão aberta, o que não combina com função
serverless; o *transaction pooler* foi feito para esse caso.

O acesso ao site é restrito pela proteção de deployment da Vercel — só abre para
quem está autenticado na conta da Lube Distribuidora.

---

## etl/ — o pipeline

Roda numa máquina dentro da rede do WinThor (hoje: `P:\INTEGRAÇÃO BI\COMPRAS`).

| Arquivo | Função |
|---|---|
| `bi_comum.py` | Infraestrutura: conexões, carga, log. Não roda sozinho. |
| `consultas_compras.py` | Catálogo: o SQL de cada consulta, destino e colunas. |
| `sync_bi_compras.py` | Orquestrador — é ele que carrega de verdade. |
| `diagnostico_bi_compras.py` | Testa todas as consultas **sem gravar nada**. |
| `agendar_bi_compras.ps1` | Cria as duas tarefas agendadas do Windows. |
| `ENV.example` | Modelo do arquivo de credenciais. |

### Instalação

```bash
pip install -r etl/requirements.txt
cp etl/ENV.example etl/ENV     # preencha com as credenciais reais
```

A senha do Supabase deve ficar **entre aspas duplas** no `ENV`: senhas com `#`
são truncadas silenciosamente sem elas.

### Uso

```bash
python diagnostico_bi_compras.py           # testa tudo, não grava nada
python sync_bi_compras.py --grupo rapidas   # tudo, menos faturamento
python sync_bi_compras.py --grupo pesadas   # só o faturamento
python sync_bi_compras.py --listar          # mostra o catálogo
```

Cada consulta roda isolada: se uma falhar, as outras seguem, e o resultado de
cada execução fica em `compras.controle_carga` no Supabase.

### Agendamento

`agendar_bi_compras.ps1` (PowerShell como administrador) cria duas tarefas:
consultas rápidas às 08:00, 12:00, 18:00 e 00:00; faturamento às 03:00.

---

## As consultas

| Página do Power BI | Consulta | Tabela no Supabase | Linhas (ref.) |
|---|---|---|---|
| COMPRAS | Consulta1 | `compras.fato_ruptura_cobertura` | 7.166 |
| SALDO VERBA · VERBA X AVARIA | Consulta3 | `compras.fato_saldo_verba` | 719 |
| SALDO VERBA X AVARIA | Consulta4 | `compras.fato_avaria_prod_fornec` | 26.830 |
| SALDO VERBA X AVARIA | Consulta5 | `compras.fato_avaria_produto` | 3.954 |
| ESTOQUE x VENDA | Consulta6 | `compras.fato_estoque_venda` | 7.271 |
| SUGESTÃO FORNEC. x PRODUTO | Consulta7 | `compras.dim_comprador_fornec_sugestao` | 269 |
| EXCESSO DE ESTOQUE | Consulta9 | `compras.fato_excesso_produto` | 2.052 |
| PERFORMANCE · MÉTRICAS | Consulta10 | `compras.fato_faturamento` | 1.615.340 |
| SUGESTÃO FORNEC. x PRODUTO | SUGESTÃO PRODUTO | `compras.fato_sugestao_produto` | 1.883 |
| SUGESTÃO FORNEC. x PRODUTO | SUGESTÃO FORNECEDOR | `compras.fato_sugestao_fornecedor` | 144 |
| (dimensão) | Consulta8 | `core.dim_fornecedor` | 1.759 |

A Consulta2 do Power BI era só um carimbo de data/hora; virou a coluna
`data_carga` de cada tabela e o log em `compras.controle_carga`.

---

## Diferenças conscientes em relação ao Power BI original

- **Margem do faturamento — corrigido.** O original protegia a divisão comparando
  a venda com `100` em vez de `0`, resquício de teste.
- **Sugestão por fornecedor — corrigido, com o original ao lado.** O Power BI
  multiplica a soma da sugestão de todos os produtos pelo preço do produto mais
  caro. A tabela traz `valor_original` (igual ao BI) e `valor` (correto). A
  diferença medida foi de R$ 29,1 mi contra R$ 1,89 mi.
- **Avaria por produto × fornecedor — mantido como está.** O filtro de filial da
  consulta original está comentado *e* escrito depois do `GROUP BY`, então nunca
  executa: ela soma todas as filiais. Mantido de propósito para os números
  baterem com o BI atual.
- **Estoque × venda — grão corrigido.** No original, produto com mais de um
  pedido de compra em aberto aparecia repetido. Os pedidos pendentes passaram a
  ser somados antes do join, entregando 1 linha por produto, como a própria
  documentação do BI dizia que deveria ser.
- **Verba.** O cartão de verba usa `Consulta3/SALDOMOV`, a fonte oficial. Somar a
  coluna de verba da Consulta1 duplica o valor, porque ela é por fornecedor
  principal e não por fornecedor.
- **Status ATIVO/FORALINHA.** O `DECODE` de `OBS2` no WinThor não tem `ELSE`:
  produto cujo `OBS2` não seja exatamente `' '` ou `'FL'` volta nulo. Até
  corrigir na origem, quem não é explicitamente `FORALINHA` entra como ativo.

---

## Segurança

As tabelas do Supabase estão com **Row Level Security habilitado e sem políticas**:
as chaves públicas (`anon`) não leem nem escrevem nada. O ETL não é afetado porque
conecta como dono das tabelas.

Qualquer acesso do painel aos dados precisa passar por uma credencial de servidor
(variável de ambiente na Vercel), nunca pela chave pública no navegador.
