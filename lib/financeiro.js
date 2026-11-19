// Tela Financeiro: coloca o PDF na pasta que o robô financeiro do SERVIDOR2 vigia e acompanha o resultado.
// O robô (fora deste projeto) tira o PDF da pasta de entrada e põe em "JA PROCESSADOS" (deu certo) ou
// "ERROS_LEITURA" (não conseguiu ler). Aqui só se grava o arquivo e se olha onde ele foi parar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TIPOS = { extrato: 'EXTRATO', cartao: 'CARTAO' };
const PROCESSADOS = 'JA PROCESSADOS';
const ERROS = 'ERROS_LEITURA';
const MAX_ENVIOS = 50;

function erro(codigo, mensagem) {
  const e = new Error(mensagem);
  e.codigo = codigo;
  return e;
}

const dois = n => String(n).padStart(2, '0');

// Nome com data e hora no final: um nome antigo que já está em JA PROCESSADOS não vira falso "concluído".
function nomeGravado(original, data) {
  const base = String(original || '').replace(/\.pdf$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'arquivo';
  const carimbo = `${data.getFullYear()}${dois(data.getMonth() + 1)}${dois(data.getDate())}_` +
    `${dois(data.getHours())}${dois(data.getMinutes())}${dois(data.getSeconds())}`;
  return `${base}_${carimbo}.pdf`;
}

function ehPdf(caminho) {
  const fd = fs.openSync(caminho, 'r');
  try {
    const cabeca = Buffer.alloc(4);
    return fs.readSync(fd, cabeca, 0, 4, 0) === 4 && cabeca.toString('latin1') === '%PDF';
  } finally { fs.closeSync(fd); }
}

function criarFinanceiro({ raiz, arquivoEstado, agora = Date.now }) {
  let envios = [];
  try {
    const lido = JSON.parse(fs.readFileSync(arquivoEstado, 'utf8'));
    if (Array.isArray(lido.envios)) envios = lido.envios;
  } catch { /* sem arquivo ou corrompido: começa vazio */ }

  function salvar() {
    envios = envios.slice(-MAX_ENVIOS);
    try {
      fs.mkdirSync(path.dirname(arquivoEstado), { recursive: true });
      fs.writeFileSync(arquivoEstado + '.tmp', JSON.stringify({ envios }, null, 2));
      fs.renameSync(arquivoEstado + '.tmp', arquivoEstado);
    } catch { /* o status continua em memória; volta a gravar no próximo envio */ }
  }

  // Nome livre na entrada e nas duas pastas de resultado (senão o robô ou a conferência confundiriam os arquivos)
  function nomeLivre(pasta, nome) {
    const ocupado = n => [pasta, path.join(pasta, PROCESSADOS), path.join(pasta, ERROS)].some(p => fs.existsSync(path.join(p, n)));
    if (!ocupado(nome)) return nome;
    for (let i = 2; ; i++) {
      const outro = nome.replace(/\.pdf$/, `_${i}.pdf`);
      if (!ocupado(outro)) return outro;
    }
  }

  function enviar({ tipo, nomeOriginal, origem, email }) {
    const sub = Object.prototype.hasOwnProperty.call(TIPOS, tipo) ? TIPOS[tipo] : null;
    if (!sub) throw erro('TIPO_INVALIDO', 'Tipo de arquivo inválido.');
    if (!ehPdf(origem)) throw erro('NAO_PDF', 'O arquivo não é um PDF.');
    const pasta = path.join(raiz, sub);
    if (!fs.existsSync(pasta)) throw erro('PASTA_INDISPONIVEL', `Pasta do robô indisponível: ${pasta}`);
    const momento = agora();
    const arquivo = nomeLivre(pasta, nomeGravado(nomeOriginal, new Date(momento)));
    try {
      fs.copyFileSync(origem, path.join(pasta, arquivo), fs.constants.COPYFILE_EXCL);
    } catch (e) {
      throw erro('PASTA_INDISPONIVEL', `Não foi possível gravar na pasta do robô: ${e.message}`);
    }
    const envio = { id: crypto.randomUUID(), tipo, arquivo, original: String(nomeOriginal || ''), email: email || null,
      enviado_em: momento, status: 'enviado', concluido_em: null };
    envios.push(envio);
    salvar();
    return { ...envio };
  }

  function statusNaPasta(envio) {
    const pasta = path.join(raiz, TIPOS[envio.tipo]);
    if (!fs.existsSync(pasta)) return null;   // servidor fora do ar: não dá para concluir nada
    if (fs.existsSync(path.join(pasta, PROCESSADOS, envio.arquivo))) return 'processado';
    if (fs.existsSync(path.join(pasta, ERROS, envio.arquivo))) return 'erro';
    if (fs.existsSync(path.join(pasta, envio.arquivo))) return 'enviado';
    return 'processando';
  }

  function conferir() {
    let mudou = false;
    for (const envio of envios) {
      if (envio.status === 'processado' || envio.status === 'erro' || !TIPOS[envio.tipo]) continue;
      let novo;
      try { novo = statusNaPasta(envio); } catch { novo = null; }
      if (!novo || novo === envio.status) continue;
      envio.status = novo;
      if (novo === 'processado' || novo === 'erro') envio.concluido_em = agora();
      mudou = true;
    }
    if (mudou) salvar();
    return mudou;
  }

  function estado() {
    const ultimo = tipo => {
      for (let i = envios.length - 1; i >= 0; i--) if (envios[i].tipo === tipo) return { ...envios[i] };
      return null;
    };
    return { extrato: ultimo('extrato'), cartao: ultimo('cartao') };
  }

  return { enviar, conferir, estado };
}

module.exports = { criarFinanceiro, nomeGravado, TIPOS };
