/**
 * /api/agente — o assistente da Central Compras.
 *
 * Por que existe uma função no meio: a chave da API não pode chegar ao
 * navegador. O painel manda a conversa para cá, esta função acrescenta a chave
 * (variável de ambiente da Vercel) e fala com a Anthropic.
 *
 * Por que o modelo NÃO recebe os dados no prompt: a carga do painel tem mais de
 * 7 mil produtos. Mandar tudo não cabe no contexto, e mandar um pedaço truncado
 * faria o assistente responder com confiança sobre uma amostra — pior que não
 * responder. Em vez disso ele recebe FERRAMENTAS: pede o recorte que precisa
 * ("os 20 piores em ruptura do comprador X"), e quem executa é o próprio
 * navegador, em cima do JSON que o painel já carregou. Resultado: resposta
 * exata, nenhuma consulta extra no banco e nada de dado trafegando à toa.
 *
 * Variável de ambiente necessária (Settings › Environment Variables):
 *   ANTHROPIC_API_KEY
 */

const MODELO = "claude-sonnet-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const LIMITE_SEGUNDOS = 25;

/* ---------------------------------------------------------------------------
 * As ferramentas que o assistente pode usar. Quem executa é o navegador.
 * ------------------------------------------------------------------------ */
const CONJUNTOS = [
  "ruptura", "estoque_venda", "verba", "sugestao_fornecedor", "excesso",
  "avaria_produto", "sugestao_produto", "faturamento_mes", "faturamento_comprador",
  "faturamento_fornecedor", "faturamento_departamento", "faturamento_secao",
  "faturamento_estado", "faturamento_supervisor"
];

const FILTRO = {
  type: "array",
  description: "Condições combinadas com E. Vazio ou ausente = sem filtro.",
  items: {
    type: "object",
    properties: {
      campo: { type: "string" },
      operador: {
        type: "string",
        enum: ["=", "!=", ">", ">=", "<", "<=", "contem", "vazio", "preenchido"],
        description: "'contem' compara texto sem diferenciar maiúscula/acento."
      },
      valor: { description: "Número, texto ou booleano." }
    },
    required: ["campo", "operador"]
  }
};

const FERRAMENTAS = [
  {
    name: "consultar",
    description:
      "Lista linhas de um conjunto de dados do painel, com filtro e ordenação. " +
      "Devolve também o total de linhas que atenderam ao filtro, mesmo quando o " +
      "limite corta a lista — use esse total para contar, nunca conte as linhas devolvidas. " +
      "Para somas e médias prefira a ferramenta agregar.",
    input_schema: {
      type: "object",
      properties: {
        conjunto: { type: "string", enum: CONJUNTOS },
        filtros: FILTRO,
        ordenar_por: { type: "string" },
        ordem: { type: "string", enum: ["asc", "desc"] },
        limite: { type: "integer", description: "Padrão 20, máximo 200." },
        campos: {
          type: "array", items: { type: "string" },
          description: "Só estas colunas. Use para encurtar a resposta."
        }
      },
      required: ["conjunto"]
    }
  },
  {
    name: "agregar",
    description:
      "Soma, conta ou tira média de um conjunto, opcionalmente agrupando. " +
      "É a ferramenta certa para 'quanto total', 'quantos itens', 'qual comprador tem mais'.",
    input_schema: {
      type: "object",
      properties: {
        conjunto: { type: "string", enum: CONJUNTOS },
        agrupar_por: {
          type: "string",
          description: "Campo do agrupamento (ex.: comprador, fornecedor, mes). Sem ele, agrega tudo num número só."
        },
        metricas: {
          type: "array",
          description: "O que calcular. 'contagem' não precisa de campo.",
          items: {
            type: "object",
            properties: {
              funcao: { type: "string", enum: ["soma", "media", "contagem", "minimo", "maximo"] },
              campo: { type: "string" },
              apelido: { type: "string" }
            },
            required: ["funcao"]
          }
        },
        filtros: FILTRO,
        ordenar_por: { type: "string", description: "Apelido de uma das métricas, ou o campo do agrupamento." },
        ordem: { type: "string", enum: ["asc", "desc"] },
        limite: { type: "integer", description: "Padrão 30, máximo 200." }
      },
      required: ["conjunto", "metricas"]
    }
  },
  {
    name: "gerar_planilha",
    description:
      "Monta e baixa uma planilha .xlsx formatada com a identidade da Lube: faixa de " +
      "título, os filtros aplicados escritos por extenso, cabeçalho congelado, filtro " +
      "automático, moeda/percentual/data em formato nativo do Excel e linha de total. " +
      "Use quando pedirem relatório, planilha, exportação ou Excel. Escolha colunas " +
      "úteis para quem vai ler, com títulos em português por extenso — não os nomes " +
      "técnicos dos campos.",
    input_schema: {
      type: "object",
      properties: {
        arquivo: { type: "string", description: "Nome do arquivo, terminando em .xlsx" },
        titulo: { type: "string", description: "Título do relatório, aparece na faixa." },
        conjunto: { type: "string", enum: CONJUNTOS },
        filtros: FILTRO,
        descricao_filtros: {
          type: "array",
          description:
            "Os filtros em português, para quem recebe entender que é um recorte. " +
            "Ex.: [[\"Comprador\",\"Julio Cesar\"],[\"Situação\",\"Somente em ruptura\"]]",
          items: { type: "array", items: { type: "string" } }
        },
        ordenar_por: { type: "string" },
        ordem: { type: "string", enum: ["asc", "desc"] },
        limite: { type: "integer", description: "Padrão 5000." },
        colunas: {
          type: "array",
          description: "Colunas da planilha, na ordem.",
          items: {
            type: "object",
            properties: {
              titulo: { type: "string", description: "Cabeçalho em português por extenso." },
              campo: { type: "string" },
              tipo: { type: "string", enum: ["texto", "moeda", "percentual", "inteiro", "data"] }
            },
            required: ["titulo", "campo", "tipo"]
          }
        }
      },
      required: ["arquivo", "titulo", "conjunto", "colunas"]
    }
  }
];

/* ---------------------------------------------------------------------------
 * Instruções
 * ------------------------------------------------------------------------ */
const INSTRUCOES = `Você é o assistente da Central Compras, o painel de BI de compras da Lube Distribuidora. Fala com compradores e com a diretoria, em português do Brasil, de forma direta e sem jargão técnico.

## De onde vem o dado
WinThor (Oracle) → ETL em Python → DATA WAREHOUSE (Supabase) → este painel. A carga das consultas rápidas roda 4x ao dia (08h, 12h, 18h e 00h); o faturamento, 1x por dia de madrugada.

## Conjuntos de dados disponíveis

**ruptura** — uma linha por produto (~7.200). Base das páginas de ruptura e cobertura.
- codprod, desc (descrição), comprador, fornecedor, ativo (false = fora de linha)
- estCx: estoque disponível em caixas · giroCx: giro por dia em caixas · dias: dias de venda em estoque
- ruptura: true quando há menos de 7 dias de venda em estoque
- cobertura: true = dentro da meta, **false = excesso** (estoque acima de 56 dias)
- avaria: R$ de estoque indenizado (filiais 1, 2, 7 e 8)

**estoque_venda** — uma linha por produto (~7.200). Histórico de 9 semanas.
- codprod, desc, comprador, fornecedor, disp (estoque disponível em unidades), preco, pendente (qtd. em pedido de compra)
- vendaTot: unidades vendidas nas 9 semanas · media: média aparada semanal (descarta a melhor e a pior semana)
- cob: cobertura em SEMANAS (a meta de compra é 8) · sug: sugestão de compra em unidades · valorSug: R$ dessa sugestão
- Produto sem venda suficiente fica sem media, sem cob e sem sug (nulos).

**verba** — uma linha por fornecedor principal (721).
- cod, nome, comprador, verba (saldo de movimentação de crédito), entrada, saida, vencidas, avencer
- avaria: avaria do fornecedor · itens: qtd. de itens com avaria · saldo: verba menos avaria (negativo = avaria já comeu a verba)

**sugestao_fornecedor** — sugestão de compra de 30 dias consolidada por fornecedor (~130). Filiais 1, 2, 7 e 8.
- cod, nome, comprador, giro, disp, sug (unidades), valor (R$, cada item ao seu próprio preço)

**excesso** — produtos com estoque acima da necessidade de 60 dias (~2.000). Filiais 1, 2 e 8.
- codprod, desc, comprador, fornecedor, giro, disp, sug (excedente), preco, valor (capital parado em R$)

**avaria_produto** — avaria em R$ por produto (~3.900): codprod, desc, comprador, fornecedor, valor

**sugestao_produto** — sugestão de 30 dias por produto e filial (~1.800). Filiais 1, 7 e 12.
- filial, codprod, desc, comprador, fornecedor, volume, giro, disp, sug, preco, valor

**faturamento_mes** — um registro por mês desde 2021: mes ("2026-09"), venda, cmv, lucro, pedidos, posit (positivação), margem (0 a 1)
**faturamento_comprador** — comprador, venda, lucro, pedidos, posit, v12 e l12 (venda e lucro dos últimos 12 meses), margem, margem12
**faturamento_fornecedor** — fornecedor, venda, lucro, v12
**faturamento_departamento** / **faturamento_secao** — nome, venda, lucro (departamento tem v12)
**faturamento_estado** — uf, venda, lucro
**faturamento_supervisor** — nome, venda, lucro, v12

## Como trabalhar
- Sempre consulte antes de responder. Nunca estime, nunca invente número e nunca responda de memória.
- Para "quanto", "quantos", "qual o maior" use **agregar** — ela conta a base inteira. A ferramenta **consultar** devolve uma lista limitada; o campo "total" dela diz quantas linhas atenderam ao filtro.
- Pode usar várias ferramentas antes de responder, inclusive em sequência.
- Nome de comprador e de fornecedor: filtre com o operador "contem" e só o primeiro nome ou um pedaço (ex.: "julio"), porque o cadastro guarda o nome completo.
- Quando pedirem relatório, planilha ou Excel, use **gerar_planilha** e confirme numa frase o que foi baixado. Não despeje a tabela inteira no chat.

## Como responder
- Vá direto ao número. Comece pela resposta, depois o contexto se ajudar.
- Formate em padrão brasileiro: R$ 1.234,56 · R$ 14,4 mil · R$ 1,25 mi · 12,5% · 1.234.
- Respostas curtas. Use **negrito** no número que importa e lista com "-" quando forem vários itens. Nada de tabela em markdown — o chat é estreito.
- Se o dado não responder à pergunta, diga isso e explique o que existe. Melhor do que uma resposta torta.
- Avisos que valem repetir quando forem relevantes: a avaria da página Compras (filiais 1, 2, 7 e 8) é diferente da avaria por fornecedor; páginas diferentes usam conjuntos de filiais diferentes; produto que o WinThor ainda não reatribuiu aparece com comprador vazio.`;

/* ------------------------------------------------------------------------ */

function responderErro(res, status, mensagem, detalhe) {
  res.status(status).json({ erro: true, mensagem: mensagem, detalhe: detalhe || null });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return responderErro(res, 405, "Método não permitido.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return responderErro(res, 500,
      "A chave da API não está cadastrada no projeto da Vercel (ANTHROPIC_API_KEY). " +
      "Cadastre em Settings › Environment Variables e publique de novo.");
  }

  const corpo = req.body && typeof req.body === "object" ? req.body : {};
  const mensagens = Array.isArray(corpo.mensagens) ? corpo.mensagens : null;
  if (!mensagens || !mensagens.length) {
    return responderErro(res, 400, "Nenhuma mensagem recebida.");
  }
  /* Teto de segurança: conversa longa demais vira custo e lentidão sem ganho. */
  if (mensagens.length > 60) {
    return responderErro(res, 400, "Conversa longa demais. Comece uma nova.");
  }

  const controle = new AbortController();
  const expirar = setTimeout(() => controle.abort(), LIMITE_SEGUNDOS * 1000);

  try {
    const resposta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 1500,
        system: INSTRUCOES,
        tools: FERRAMENTAS,
        messages: mensagens
      }),
      signal: controle.signal
    });

    const dados = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      const motivo = dados && dados.error && dados.error.message ? dados.error.message : "HTTP " + resposta.status;
      console.error("Anthropic respondeu com erro:", resposta.status, motivo);
      /* 401/403 é configuração; o resto costuma ser passageiro (sobrecarga, limite). */
      const passageiro = resposta.status === 429 || resposta.status >= 500;
      return responderErro(res, passageiro ? 503 : 502,
        passageiro
          ? "O serviço de IA está ocupado agora. Tente de novo em alguns segundos."
          : "A chamada à API falhou. Confira a chave cadastrada na Vercel.",
        motivo);
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      conteudo: dados.content || [],
      motivo_parada: dados.stop_reason || null
    });
  } catch (e) {
    const abortou = e && e.name === "AbortError";
    console.error("Falha ao falar com a Anthropic:", e);
    responderErro(res, abortou ? 504 : 502,
      abortou
        ? "A resposta demorou mais que " + LIMITE_SEGUNDOS + " segundos. Tente perguntar de forma mais específica."
        : "Não consegui falar com o serviço de IA.",
      e && e.message ? e.message : String(e));
  } finally {
    clearTimeout(expirar);
  }
};
