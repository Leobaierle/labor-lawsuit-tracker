import { describe, expect, it } from "bun:test";
import { digitoCnj, leitorGraph, numerosTrabalhistas, resumoDoCorpo } from "../index.ts";

const numero = (n: string, j = "5") => `${n}-${digitoCnj(n, "2026", j, "01", "0265")}.2026.${j}.01.0265`;

describe("o que o robô tira do e-mail", () => {
  it("só números CNJ válidos da Justiça do Trabalho, com ou sem pontuação, sem repetir", () => {
    const a = numero("0100413");
    const b = numero("0101637");
    const civel = numero("0001234", "8");
    const errado = a.replace(/-\d{2}\./, "-00.");
    const texto = `Inclusão ${b} Tlmc 22 x Sidney\nRef. ao processo nº ${a.replace(/\D/g, "")}, e de novo ${a}. Cível ${civel}. Errado ${errado}`;
    expect(numerosTrabalhistas(texto)).toEqual([b, a]);
    expect(numerosTrabalhistas("sem processo nenhum")).toEqual([]);
  });

  it("resumo sem imagens embutidas nem linhas em branco, cortado", () => {
    expect(resumoDoCorpo("Dr. Silva,\r\n\r\n\r\nInformo   a inclusão.\n[cid:ABC123]\nAtt.")).toBe("Dr. Silva,\nInformo a inclusão.\nAtt.");
    expect(resumoDoCorpo("x".repeat(700))).toHaveLength(600);
    expect(resumoDoCorpo("x".repeat(700)).endsWith("…")).toBe(true);
  });
});

describe("leitor pelo Microsoft Graph", () => {
  const respostas: Record<string, unknown> = {
    "/me/mailFolders/inbox?$select=id": { id: "INBOX" },
    "/me/mailFolders/INBOX/childFolders?$select=id,displayName&$top=100": {
      value: [{ id: "P1", displayName: "Processos" }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/INBOX/childFolders?pagina=2",
    },
    "/me/mailFolders/INBOX/childFolders?pagina=2": { value: [{ id: "P2", displayName: "Outros" }] },
    "/me/mailFolders/P1/childFolders?$select=id,displayName&$top=100": { value: [{ id: "P11", displayName: "2026" }] },
    "/me/mailFolders/P11/childFolders?$select=id,displayName&$top=100": { value: [] },
    "/me/mailFolders/P2/childFolders?$select=id,displayName&$top=100": { value: [] },
    "/me/messages/M1/attachments?$select=name,isInline": { value: [{ name: "relatorio.pdf", isInline: false }, { name: "image001.png", isInline: true }] },
  };
  const pedidos: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    pedidos.push({ url, headers: init.headers as Record<string, string> });
    const caminho = url.replace("https://graph.microsoft.com/v1.0", "");
    if (caminho.includes("/messages?")) {
      return Response.json({
        value: [
          {
            id: "M1",
            internetMessageId: "<abc@x>",
            subject: "Inclusão",
            from: { emailAddress: { name: "Advogado", address: "Advogado@Escritorio.example" } },
            receivedDateTime: "2026-10-26T14:20:18Z",
            hasAttachments: true,
            body: { content: "corpo" },
            webLink: "https://outlook.office365.com/owa/?ItemID=M1",
          },
        ],
      });
    }
    const r = respostas[caminho];
    return r ? Response.json(r) : Response.json({ error: { code: "ErrorItemNotFound", message: caminho } }, { status: 404 });
  };

  it("pastas com caminho e paginação; mensagens em texto; anexos sem as imagens do corpo", async () => {
    const l = leitorGraph("TOKEN", "carla@example.com", { fetch });
    expect(await l.pastas()).toEqual([
      { id: "INBOX", nome: "Caixa de Entrada" },
      { id: "P1", nome: "Caixa de Entrada/Processos" },
      { id: "P11", nome: "Caixa de Entrada/Processos/2026" },
      { id: "P2", nome: "Caixa de Entrada/Outros" },
    ]);
    const msgs = [];
    for await (const m of l.mensagens("P1", new Date("2026-10-23T00:00:00Z"))) msgs.push(m);
    expect(msgs).toEqual([
      {
        id: "M1",
        messageId: "<abc@x>",
        assunto: "Inclusão",
        deNome: "Advogado",
        deEmail: "advogado@escritorio.example",
        recebidoEm: new Date("2026-10-26T14:20:18Z"),
        temAnexos: true,
        corpo: "corpo",
        link: "https://outlook.office365.com/owa/?ItemID=M1",
      },
    ]);
    const pedidoMsgs = pedidos.find((p) => p.url.includes("/messages?"))!;
    expect(pedidoMsgs.url).toContain("receivedDateTime ge 2026-10-23T00:00:00.000Z");
    expect(pedidoMsgs.headers.authorization).toBe("Bearer TOKEN");
    expect(pedidoMsgs.headers.prefer).toBe('outlook.body-content-type="text"');
    expect(await l.anexos("M1")).toEqual(["relatorio.pdf"]);
  });

  it("caixa compartilhada pelo endereço; erro da Microsoft vira mensagem", async () => {
    const l = leitorGraph("TOKEN", "dp@example.com", { compartilhada: true, fetch });
    await expect(l.pastas()).rejects.toThrow("Microsoft respondeu 404: ErrorItemNotFound /users/dp%40example.com/mailFolders/inbox");
  });
});
