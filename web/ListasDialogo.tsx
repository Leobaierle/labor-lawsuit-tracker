import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/Button';
import { Dialogo } from '../importacao-xml/Dialogo';
import { alterarLista, type ItemLista, type Lista } from './api';
import { contar } from './rotulos';

const CAMPO =
  'h-9 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent-strong))]';
const ICONE = 'rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30';

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

const Secao = ({
  lista,
  titulo,
  dica,
  itens,
  onAlterada,
}: {
  lista: Lista;
  titulo: string;
  dica: string;
  itens: ItemLista[];
  onAlterada: (itens: ItemLista[]) => void;
}) => {
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fazer = async (p: Promise<ItemLista[]>) => {
    setOcupado(true);
    setErro(null);
    try {
      onAlterada(await p);
      return true;
    } catch (e) {
      setErro(mensagemDe(e));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
        <p className="text-[12px] text-muted-foreground">{dica}</p>
      </div>
      {erro && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {erro}
        </p>
      )}
      <ol className="divide-y divide-border rounded-xl border border-border">
        {itens.map((i, n) => (
          <li key={i.id} className="flex items-center gap-2 px-3 py-1.5">
            {editando?.id === i.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void fazer(alterarLista(lista, { acao: 'renomear', id: i.id, nome: editando.nome })).then((ok) => ok && setEditando(null));
                }}
              >
                <input className={CAMPO} value={editando.nome} onChange={(e) => setEditando({ id: i.id, nome: e.target.value })} autoFocus />
                <button type="submit" className={ICONE} aria-label="Salvar nome" disabled={ocupado}>
                  <Check className="h-4 w-4" aria-hidden />
                </button>
                <button type="button" className={ICONE} aria-label="Cancelar" onClick={() => setEditando(null)}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </form>
            ) : (
              <>
                <span className="flex-1 text-sm text-foreground">
                  {i.nome}
                  {i.encerra && <span className="ml-2 text-[12px] text-muted-foreground">(não conta prazo)</span>}
                </span>
                <span className="text-[12px] tabular-nums text-muted-foreground">{contar(i.processos, 'processo')}</span>
                <button type="button" className={ICONE} aria-label={`Renomear ${i.nome}`} onClick={() => setEditando({ id: i.id, nome: i.nome })}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={ICONE}
                  aria-label={`Subir ${i.nome}`}
                  disabled={ocupado || n === 0}
                  onClick={() => void fazer(alterarLista(lista, { acao: 'mover', id: i.id, direcao: -1 }))}
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={ICONE}
                  aria-label={`Descer ${i.nome}`}
                  disabled={ocupado || n === itens.length - 1}
                  onClick={() => void fazer(alterarLista(lista, { acao: 'mover', id: i.id, direcao: 1 }))}
                >
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className={ICONE}
                  aria-label={`Remover ${i.nome}`}
                  title={i.processos > 0 ? 'Mude os processos desta lista antes de remover' : undefined}
                  disabled={ocupado || i.processos > 0}
                  onClick={() => void fazer(alterarLista(lista, { acao: 'remover', id: i.id }))}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!novo.trim()) return;
          void fazer(alterarLista(lista, { acao: 'criar', nome: novo })).then((ok) => ok && setNovo(''));
        }}
      >
        <input className={CAMPO} value={novo} onChange={(e) => setNovo(e.target.value)} placeholder={`Nova ${lista === 'ETAPA' ? 'etapa' : 'opção de tipo'}`} />
        <Button type="submit" size="sm" variant="outline" className="h-9" disabled={ocupado || !novo.trim()}>
          <Plus className="h-4 w-4" aria-hidden />
          Incluir
        </Button>
      </form>
    </section>
  );
};

/** O DP cria, renomeia, reordena e remove etapas (as abas) e tipos de processo, sem deploy. */
export const ListasDialogo = ({
  etapas,
  tipos,
  onFechar,
  onAlteradas,
}: {
  etapas: ItemLista[];
  tipos: ItemLista[];
  onFechar: () => void;
  onAlteradas: () => void;
}) => {
  const [e, setE] = useState(etapas);
  const [t, setT] = useState(tipos);
  return (
    <Dialogo titulo="Etapas e tipos" onFechar={onFechar} largura="max-w-xl">
      <div className="space-y-6">
        <Secao
          lista="ETAPA"
          titulo="Etapas"
          dica="Cada etapa é uma aba. Etapa nova entra antes de “Encerrado”."
          itens={e}
          onAlterada={(itens) => {
            setE(itens);
            onAlteradas();
          }}
        />
        <Secao
          lista="TIPO"
          titulo="Tipos de processo"
          dica="Opções do campo Tipo."
          itens={t}
          onAlterada={(itens) => {
            setT(itens);
            onAlteradas();
          }}
        />
      </div>
    </Dialogo>
  );
};
