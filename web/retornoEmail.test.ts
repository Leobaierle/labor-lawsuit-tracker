import { describe, expect, it } from 'bun:test';
import { lerRetorno } from './retornoEmail';

describe('lerRetorno', () => {
  it('código e state da Microsoft', () => {
    expect(lerRetorno('?code=abc&state=x.y&session_state=1')).toEqual({ tipo: 'codigo', code: 'abc', state: 'x.y' });
  });
  it('cancelado e outros erros viram mensagem', () => {
    expect(lerRetorno('?error=access_denied&error_description=AADSTS65004')).toEqual({
      tipo: 'erro',
      mensagem: 'A conexão foi cancelada na Microsoft.',
    });
    expect(lerRetorno('?error=invalid_request&error_description=AADSTS50011%3A+redirect+mismatch%0D%0ATrace')).toEqual({
      tipo: 'erro',
      mensagem: 'A Microsoft não concluiu a conexão (invalid_request: AADSTS50011: redirect mismatch).',
    });
    expect(lerRetorno('')).toEqual({ tipo: 'erro', mensagem: 'A Microsoft não concluiu a conexão.' });
  });
});
