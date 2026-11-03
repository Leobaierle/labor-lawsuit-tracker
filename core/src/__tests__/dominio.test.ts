import { describe, expect, it } from "bun:test";
import {
  digitoCnj,
  EntradaInvalida,
  hojeEmBrasilia,
  normalizarNumeroCnj,
  normalizarPrazo,
  normalizarResponsavel,
  situacaoPrazo,
} from "../index.ts";

describe("normalizarNumeroCnj", () => {
  // dígito calculado pela fórmula da Resolução CNJ 65/2008 (98 − resto de 97)
  const valido = `0001234-${digitoCnj("0001234", "2026", "5", "04", "0001")}.2026.5.04.0001`;

  it("aceita com ou sem pontuação e devolve formatado", () => {
    expect(normalizarNumeroCnj(valido)).toBe(valido);
    expect(normalizarNumeroCnj(` ${valido.replace(/\D/g, "")} `)).toBe(valido);
  });

  it("aceita números reais publicados", () => {
    // processo do próprio CNJ (Migalhas, 2020) e exemplo do Business::BR::CNJ (TJRJ)
    expect(normalizarNumeroCnj("0003741-14.2019.2.00.0000")).toBe("0003741-14.2019.2.00.0000");
    expect(normalizarNumeroCnj("0058967-77.2016.8.19.0000")).toBe("0058967-77.2016.8.19.0000");
  });

  it("recusa tamanho errado e dígito errado", () => {
    expect(() => normalizarNumeroCnj("123")).toThrow(EntradaInvalida);
    const dv = Number(valido.slice(8, 10));
    const errado = `${valido.slice(0, 8)}${String((dv + 1) % 100).padStart(2, "0")}${valido.slice(10)}`;
    expect(() => normalizarNumeroCnj(errado)).toThrow(/dígito verificador/);
  });
});

describe("normalizarResponsavel", () => {
  it("e-mail da Êxito em minúsculas; vazio = sem responsável", () => {
    expect(normalizarResponsavel(" Ana@Example.com ")).toBe("ana@example.com");
    expect(normalizarResponsavel("")).toBeNull();
    expect(normalizarResponsavel(null)).toBeNull();
    expect(() => normalizarResponsavel("ana@gmail.com")).toThrow(EntradaInvalida);
  });
});

describe("normalizarPrazo", () => {
  it("só data real do calendário", () => {
    expect(normalizarPrazo("2026-10-30")).toBe("2026-10-30");
    expect(normalizarPrazo(" ")).toBeNull();
    expect(() => normalizarPrazo("2026-02-30")).toThrow(EntradaInvalida);
    expect(() => normalizarPrazo("30/10/2026")).toThrow(EntradaInvalida);
  });
});

describe("situacaoPrazo", () => {
  // sexta-feira, 23/10/2026: 3 dias úteis à frente = quarta 28/10
  const hoje = "2026-10-23";
  it("vencido, próximo (até 3 dias úteis), no prazo, sem prazo", () => {
    expect(situacaoPrazo("2026-10-22", hoje)).toBe("VENCIDO");
    expect(situacaoPrazo("2026-10-23", hoje)).toBe("PROXIMO");
    expect(situacaoPrazo("2026-10-28", hoje)).toBe("PROXIMO");
    expect(situacaoPrazo("2026-10-29", hoje)).toBe("NO_PRAZO");
    expect(situacaoPrazo(null, hoje)).toBe("SEM_PRAZO");
  });
  it("etapa que encerra não conta prazo", () => {
    expect(situacaoPrazo("2026-10-01", hoje, true)).toBe("SEM_PRAZO");
  });
  it("hoje no fuso de Brasília", () => {
    expect(hojeEmBrasilia(new Date("2026-10-24T02:30:00Z"))).toBe("2026-10-23");
  });
});
