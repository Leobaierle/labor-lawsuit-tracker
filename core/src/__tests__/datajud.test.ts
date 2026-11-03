import { describe, expect, it } from "bun:test";
import { andamentoDosRegistros, consultarDataJud, type MovimentoDataJud, type RegistroDataJud } from "../index.ts";

const mov = (data: string, codigo: number, nome: string, complementos: string[] = []): MovimentoDataJud => ({
  data: `${data}T15:00:00.000Z`,
  codigo,
  nome,
  complementos,
});
const g1 = (...movimentos: MovimentoDataJud[]): RegistroDataJud => ({ grau: "G1", orgao: "1ª VARA DO TRABALHO DE EXEMPLO", movimentos });
const g2 = (...movimentos: MovimentoDataJud[]): RegistroDataJud => ({ grau: "G2", orgao: "4ª TURMA", movimentos });

describe("andamento pelas movimentações do DataJud", () => {
  it("não encontrado = sem registros", () => {
    expect(andamentoDosRegistros([])).toEqual({ encontrado: false, situacao: null, situacaoEm: null, ultimaMovimentacao: null, orgao: null });
  });

  it("audiência com a situação do complemento; movimentos sem marco não mudam a situação", () => {
    const a = andamentoDosRegistros([
      g1(
        mov("2026-07-14", 26, "Distribuição"),
        mov("2026-08-03", 12749, "Audiência", ["designada", "instrução"]),
        mov("2026-09-25", 85, "Petição"),
      ),
    ]);
    expect(a).toEqual({
      encontrado: true,
      situacao: "Audiência de instrução designada",
      situacaoEm: "2026-08-03",
      ultimaMovimentacao: "2026-09-25",
      orgao: "1ª VARA DO TRABALHO DE EXEMPLO",
    });
  });

  it("liminares pelos códigos conferidos nos e-mails (332, 785, 889)", () => {
    expect(andamentoDosRegistros([g1(mov("2026-08-24", 332, "Concessão"))]).situacao).toBe("Liminar concedida");
    expect(andamentoDosRegistros([g1(mov("2026-08-01", 785, "Não Concessão"))]).situacao).toBe("Liminar negada");
    expect(andamentoDosRegistros([g1(mov("2026-09-01", 889, "Concessão em parte"))]).situacao).toBe("Liminar concedida em parte");
  });

  it("mais recente entre os graus; distribuição no 2º grau é recurso; no mesmo instante vale o que veio depois", () => {
    const a = andamentoDosRegistros([
      g1(mov("2026-06-02", 219, "Procedência"), mov("2026-09-10", 123, "Remessa")),
      g2(mov("2026-07-23", 26, "Distribuição"), mov("2026-08-29", 85, "Petição")),
    ]);
    expect(a).toMatchObject({ situacao: "Recurso no TRT", situacaoEm: "2026-07-23", ultimaMovimentacao: "2026-09-10" });
    expect(a.orgao).toBe("1ª VARA DO TRABALHO DE EXEMPLO");

    const mesmoDia = andamentoDosRegistros([g1(mov("2026-08-17", 12740, "Audiência", ["realizada"]), mov("2026-08-17", 466, "Homologação"))]);
    expect(mesmoDia.situacao).toBe("Acordo homologado");
  });

  it("sem nenhum marco, o último movimento; data no fuso de Brasília", () => {
    const a = andamentoDosRegistros([{ grau: "G1", orgao: null, movimentos: [{ data: "2026-09-02T01:30:00.000Z", codigo: 51, nome: "Conclusão", complementos: [] }] }]);
    expect(a).toMatchObject({ situacao: "Conclusão", situacaoEm: "2026-09-01", ultimaMovimentacao: "2026-09-01" });
  });
});

describe("consulta ao DataJud", () => {
  it("índice do TRT pelo número, chave pública e resposta normalizada", async () => {
    let pedido: { url: string; init: RequestInit } | null = null;
    const registros = await consultarDataJud("0007777-86.2026.5.04.0099", {
      fetch: async (url, init) => {
        pedido = { url, init };
        return Response.json({
          hits: {
            hits: [
              {
                _source: {
                  grau: "G1",
                  orgaoJulgador: { nome: "VARA X" },
                  movimentos: [{ dataHora: "2026-08-31T14:29:11.000Z", codigo: 12740, nome: "Audiência", complementosTabelados: [{ nome: "realizada" }] }],
                },
              },
            ],
          },
        });
      },
    });
    expect(pedido!.url).toBe("https://api-publica.datajud.cnj.jus.br/api_publica_trt4/_search");
    expect((pedido!.init.headers as Record<string, string>).authorization).toStartWith("APIKey ");
    expect(JSON.parse(String(pedido!.init.body))).toEqual({ query: { match: { numeroProcesso: "00077778620265040099" } }, size: 10 });
    expect(registros).toEqual([
      { grau: "G1", orgao: "VARA X", movimentos: [{ data: "2026-08-31T14:29:11.000Z", codigo: 12740, nome: "Audiência", complementos: ["realizada"] }] },
    ]);
  });

  it("resposta com shard falhando ou estourando o tempo é erro, não \"não encontrado\"", async () => {
    const vazio = (extra: Record<string, unknown>) => async () => Response.json({ ...extra, hits: { hits: [] } });
    await expect(consultarDataJud("0007777-86.2026.5.04.0099", { fetch: vazio({ _shards: { total: 5, failed: 2 } }) })).rejects.toThrow("incompleto");
    await expect(consultarDataJud("0007777-86.2026.5.04.0099", { fetch: vazio({ timed_out: true }) })).rejects.toThrow("incompleto");
    expect(await consultarDataJud("0007777-86.2026.5.04.0099", { fetch: vazio({ timed_out: false, _shards: { total: 5, failed: 0 } }) })).toEqual([]);
  });

  it("recusa número de outra justiça e repassa erro HTTP", async () => {
    await expect(consultarDataJud("0001234-56.2026.8.21.0001")).rejects.toThrow("Justiça do Trabalho");
    await expect(consultarDataJud("0007777-86.2026.5.04.0099", { fetch: async () => new Response("fora", { status: 503 }) })).rejects.toThrow(
      "DataJud respondeu 503",
    );
  });
});
