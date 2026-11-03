import type { ProcessosPool } from "./pgClient.ts";

/**
 * Andamento no tribunal pela API pública do DataJud (CNJ). Um índice por tribunal (api_publica_trt<N>, N = o TR do
 * número CNJ); cada grau (G1 vara, G2 TRT) vem como um registro com as movimentações codificadas pela TPU do CNJ.
 * A situação é o marco mais recente (audiência, decisão, fase). O DataJud chega com algumas semanas de atraso.
 */

/** Chave pública que o CNJ publica para todos (datajud-wiki.cnj.jus.br/api-publica/acesso); o CNJ pode trocá-la. */
export const CHAVE_PUBLICA_DATAJUD = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

export type MovimentoDataJud = { data: string; codigo: number; nome: string; complementos: string[] };
export type RegistroDataJud = { grau: string; orgao: string | null; movimentos: MovimentoDataJud[] };

export type Andamento = {
  encontrado: boolean;
  situacao: string | null;
  /** AAAA-MM-DD */
  situacaoEm: string | null;
  ultimaMovimentacao: string | null;
  orgao: string | null;
};

const AUDIENCIA: Record<number, string> = {
  12740: "de conciliação",
  12749: "de instrução",
  12747: "inicial",
  12741: "de julgamento",
  12750: "una",
  970: "",
};
const SITUACAO_AUDIENCIA = ["designada", "realizada", "cancelada", "redesignada", "não-realizada", "convertida em diligência", "antecipada"];

// Códigos da TPU conferidos nos e-mails do DP (liminar 332/785/889) e nas movimentações da carga inicial.
const MARCO: Record<number, string> = {
  26: "Distribuído",
  36: "Redistribuído",
  219: "Sentença: procedente",
  220: "Sentença: improcedente",
  221: "Sentença: procedente em parte",
  454: "Petição inicial indeferida",
  459: "Extinto sem julgamento de mérito",
  473: "Arquivado por ausência do reclamante",
  463: "Desistência homologada",
  466: "Acordo homologado",
  14099: "Acordo homologado na execução",
  371: "Declarada incompetência",
  332: "Liminar concedida",
  785: "Liminar negada",
  889: "Liminar concedida em parte",
  792: "Liminar",
  848: "Trânsito em julgado",
  11384: "Liquidação iniciada",
  11385: "Execução iniciada",
  196: "Execução extinta",
  246: "Arquivado definitivamente",
  245: "Arquivado provisoriamente",
  893: "Desarquivado",
  12614: "Enviado ao CEJUSC (conciliação)",
  237: "Acórdão: recurso provido",
  238: "Acórdão: recurso provido em parte",
  239: "Acórdão: recurso não provido",
  235: "Acórdão: recurso não conhecido",
  434: "Recurso de revista (TST)",
  14975: "Suspenso (repercussão geral)",
};

/** Data em Brasília (AAAA-MM-DD) de um dataHora do DataJud. */
const dia = (dataHora: string): string => {
  const d = new Date(dataHora);
  return Number.isNaN(d.getTime())
    ? dataHora.slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
};

/** Situação = marco mais recente entre todos os graus (no empate, o que veio depois). Sem marco, o último movimento. */
export const andamentoDosRegistros = (registros: RegistroDataJud[]): Andamento => {
  const todos = registros.flatMap((r) => r.movimentos.map((m) => ({ ...m, r })));
  if (todos.length === 0) return { encontrado: registros.length > 0, situacao: null, situacaoEm: null, ultimaMovimentacao: null, orgao: registros[0]?.orgao ?? null };
  todos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  const ultimo = todos[todos.length - 1]!;

  let marco: { data: string; texto: string } | null = null;
  for (const m of todos) {
    const g2 = m.r.grau === "G2";
    let texto: string | null = null;
    if (m.codigo in AUDIENCIA) {
      const sit = SITUACAO_AUDIENCIA.find((s) => m.complementos.includes(s));
      if (sit) texto = `Audiência ${AUDIENCIA[m.codigo]} ${sit}`.replace(/\s+/g, " ");
    } else if (g2 && (m.codigo === 26 || m.codigo === 132)) {
      texto = "Recurso no TRT"; // chegada do recurso: distribuição ou recebimento no 2º grau
    } else if (m.codigo in MARCO && !(g2 && m.codigo === 36)) {
      texto = MARCO[m.codigo]!;
    }
    if (texto) marco = { data: m.data, texto };
  }
  return {
    encontrado: true,
    situacao: marco?.texto ?? ultimo.nome,
    situacaoEm: dia((marco ?? ultimo).data),
    ultimaMovimentacao: dia(ultimo.data),
    orgao: ultimo.r.orgao,
  };
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Os registros (um por grau) do processo no DataJud; [] = não está lá. Lança erro de rede/HTTP. */
export const consultarDataJud = async (
  numero: string,
  opcoes: { fetch?: Fetch; chave?: string; timeoutMs?: number } = {},
): Promise<RegistroDataJud[]> => {
  const digitos = numero.replace(/\D/g, "");
  const tr = Number(digitos.slice(14, 16));
  if (digitos.length !== 20 || digitos[13] !== "5" || !tr) throw new Error(`${numero} não é da Justiça do Trabalho`);
  const r = await (opcoes.fetch ?? fetch)(`https://api-publica.datajud.cnj.jus.br/api_publica_trt${tr}/_search`, {
    method: "POST",
    headers: { authorization: `APIKey ${opcoes.chave ?? CHAVE_PUBLICA_DATAJUD}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { match: { numeroProcesso: digitos } }, size: 10 }),
    signal: AbortSignal.timeout(opcoes.timeoutMs ?? 90_000),
  });
  if (!r.ok) throw new Error(`DataJud respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as {
    timed_out?: boolean;
    _shards?: { failed?: number };
    hits?: { hits?: Array<{ _source: Record<string, any> }> };
  };
  // sobrecarregado, o DataJud responde 200 com parte dos shards falhando e sem resultado: não é "não encontrado"
  if (j.timed_out || (j._shards?.failed ?? 0) > 0) throw new Error("DataJud respondeu incompleto (sobrecarregado)");
  return (j.hits?.hits ?? []).map(({ _source: s }) => ({
    grau: String(s.grau ?? ""),
    orgao: s.orgaoJulgador?.nome ?? null,
    movimentos: (s.movimentos ?? []).map((m: Record<string, any>) => ({
      data: String(m.dataHora ?? ""),
      codigo: Number(m.codigo),
      nome: String(m.nome ?? ""),
      complementos: (m.complementosTabelados ?? []).map((c: Record<string, any>) => String(c.nome ?? "")),
    })),
  }));
};

export type ResultadoAtualizacao = { consultados: number; encontrados: number; erros: number };

/**
 * Consulta de novo os processos com número da Justiça do Trabalho cujo andamento tem mais de 7 dias (ou que
 * falharam há mais de 6 horas, ou nunca foram consultados) e grava o resultado. Pode rodar de hora em hora:
 * na prática cada processo é consultado uma vez por semana, e um processo novo entra na hora seguinte.
 */
export const atualizarAndamentos = async (
  pool: ProcessosPool,
  opcoes: { fetch?: Fetch; chave?: string; limite?: number; concorrencia?: number; tentativas?: number; esperaMs?: number } = {},
): Promise<ResultadoAtualizacao> => {
  const { rows } = await pool.query(
    `SELECT p.id, p.numero
       FROM dp_processos_trabalhistas.processo p
       LEFT JOIN dp_processos_trabalhistas.andamento_tribunal a ON a.processo_id = p.id
      WHERE p.descartado_em IS NULL AND split_part(p.numero, '.', 3) = '5'
        AND (a.processo_id IS NULL OR a.tentado_em < now() - CASE WHEN a.erro IS NULL THEN interval '7 days' ELSE interval '6 hours' END)
      ORDER BY a.tentado_em NULLS FIRST, p.id
      LIMIT $1`,
    [opcoes.limite ?? 500],
  );
  const fila = rows.map((r) => ({ id: Number(r.id), numero: r.numero as string }));
  const res: ResultadoAtualizacao = { consultados: 0, encontrados: 0, erros: 0 };

  const um = async ({ id, numero }: { id: number; numero: string }) => {
    let ultimoErro: unknown;
    for (let t = 0; t < (opcoes.tentativas ?? 3); t++) {
      if (t > 0) await Bun.sleep((opcoes.esperaMs ?? 10_000) * t); // DataJud sobrecarregado: dá um tempo antes de repetir
      try {
        const a = andamentoDosRegistros(await consultarDataJud(numero, opcoes));
        await pool.query(
          `INSERT INTO dp_processos_trabalhistas.andamento_tribunal
             (processo_id, consultado_em, encontrado, situacao, situacao_em, ultima_movimentacao, orgao, tentado_em, erro)
           VALUES ($1, now(), $2, $3, $4, $5, $6, now(), NULL)
           ON CONFLICT (processo_id) DO UPDATE SET consultado_em = now(), encontrado = $2, situacao = $3, situacao_em = $4,
             ultima_movimentacao = $5, orgao = $6, tentado_em = now(), erro = NULL`,
          [id, a.encontrado, a.situacao, a.situacaoEm, a.ultimaMovimentacao, a.orgao],
        );
        res.consultados++;
        if (a.encontrado) res.encontrados++;
        return;
      } catch (e) {
        ultimoErro = e;
      }
    }
    res.erros++;
    await pool.query(
      `INSERT INTO dp_processos_trabalhistas.andamento_tribunal (processo_id, tentado_em, erro) VALUES ($1, now(), $2)
       ON CONFLICT (processo_id) DO UPDATE SET tentado_em = now(), erro = $2`,
      [id, String(ultimoErro instanceof Error ? ultimoErro.message : ultimoErro).slice(0, 500)],
    );
  };

  // o DataJud demora 5–15 s por consulta: algumas ao mesmo tempo, sem exagero
  await Promise.all(
    Array.from({ length: Math.min(opcoes.concorrencia ?? 4, fila.length) }, async () => {
      for (let p = fila.shift(); p; p = fila.shift()) await um(p);
    }),
  );
  return res;
};
