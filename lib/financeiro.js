// Tela Financeiro: coloca o PDF na pasta que o robô financeiro do SERVIDOR2 vigia e acompanha o resultado.
// O robô (fora deste projeto) tira o PDF da pasta de entrada e põe em "JA PROCESSADOS" (deu certo) ou
// "ERROS_LEITURA" (não conseguiu ler). Aqui só se grava o arquivo e se olha onde ele foi parar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fsp = fs.promises;

const TIPOS = { extrato: 'EXTRATO', cartao: 'CARTAO' };
const PROCESSADOS = 'JA PROCESSADOS';
const ERROS = 'ERROS_LEITURA';
const MAX_ENVIOS = 50;
const DIAS_CONFERINDO = 7;

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

async function ehPdf(caminho) {
  const fd = await fsp.open(caminho, 'r');
  try {
    const cabeca = Buffer.alloc(4);
    const { bytesRead } = await fd.read(cabeca, 0, 4, 0);
    return bytesRead === 4 && cabeca.toString('latin1') === '%PDF';
  } finally { await fd.close(); }
}

// Tudo que toca o compartilhamento de rede é assíncrono: SERVIDOR2 lento não pode travar o site inteiro.
const existe = p => fsp.access(p).then(() => true, () => false);

function criarFinanceiro({ raiz, arquivoEstado, agora = Date.now }) {
  let envios = [];
  try {
    const lido = JSON.parse(fs.readFileSync(arquivoEstado, 'utf8'));
    if (Array.isArray(lido.envios)) envios = lido.envios;
  } catch { /* sem arquivo ou corrompido: começa vazio */ }

  // arquivo de estado fica no disco local do site (dados/): gravação síncrona é rápida
  function salvar() {
    envios = envios.slice(-MAX_ENVIOS);
    try {
      fs.mkdirSync(path.dirname(arquivoEstado), { recursive: true });
      fs.writeFileSync(arquivoEstado + '.tmp', JSON.stringify({ envios }, null, 2));
      fs.renameSync(arquivoEstado + '.tmp', arquivoEstado);
    } catch { /* o status continua em memória; volta a gravar no próximo envio */ }
  }

  // Nome livre na entrada e nas duas pastas de resultado (senão o robô ou a conferência confundiriam os arquivos)
  async function nomeLivre(pasta, nome) {
    const ocupado = async n => (await Promise.all([pasta, path.join(pasta, PROCESSADOS), path.join(pasta, ERROS)]
      .map(p => existe(path.join(p, n))))).some(Boolean);
    if (!(await ocupado(nome))) return nome;
    for (let i = 2; ; i++) {
      const outro = nome.replace(/.pdf$/, `_${i}.pdf`);
      if (!(await ocupado(outro))) return outro;
    }
  }

  async function gravar({ tipo, nomeOriginal, origem, email }) {
    const sub = Object.prototype.hasOwnProperty.call(TIPOS, tipo) ? TIPOS[tipo] : null;
    if (!sub) throw erro('TIPO_INVALIDO', 'Tipo de arquivo inválido.');
    if (!(await ehPdf(origem))) throw erro('NAO_PDF', 'O arquivo não é um PDF.');
    const pasta = path.join(raiz, sub);
    if (!(await existe(pasta))) throw erro('PASTA_INDISPONIVEL', `Pasta do robô indisponível: ${pasta}`);
    const momento = agora();
    const arquivo = await nomeLivre(pasta, nomeGravado(nomeOriginal, new Date(momento)));
    // Copia como .part e só depois renomeia: o robô (que pega *.pdf) nunca lê um PDF pela metade
    const parcial = path.join(pasta, arquivo + '.part');
    try {
      await fsp.copyFile(origem, parcial, fs.constants.COPYFILE_EXCL);
      await fsp.rename(parcial, path.join(pasta, arquivo));
    } catch (e) {
      await fsp.unlink(parcial).catch(() => {});
      throw erro('PASTA_INDISPONIVEL', `Não foi possível gravar na pasta do robô: ${e.message}`);
    }
    const envio = { id: crypto.randomUUID(), tipo, arquivo, original: String(nomeOriginal || ''), email: email || null,
      enviado_em: momento, status: 'enviado', concluido_em: null };
    envios.push(envio);
    salvar();
    return { ...envio };
  }

  // Um envio por vez: dois PDFs de mesmo nome ao mesmo tempo não escolhem o mesmo nome livre
  let fila = Promise.resolve();
  function enviar(dados) {
    const vez = fila.then(() => gravar(dados));
    fila = vez.catch(() => {});
    return vez;
  }

  async function statusNaPasta(envio) {
    const pasta = path.join(raiz, TIPOS[envio.tipo]);
    if (!(await existe(pasta))) return null;   // servidor fora do ar: não dá para concluir nada
    if (await existe(path.join(pasta, PROCESSADOS, envio.arquivo))) return 'processado';
    if (await existe(path.join(pasta, ERROS, envio.arquivo))) return 'erro';
    if (await existe(path.join(pasta, envio.arquivo))) return 'enviado';
    return 'processando';
  }

  // Conferência em andamento: a próxima chamada não começa outra por cima (SERVIDOR2 lento acumularia)
  let conferindo = false;
  async function conferir() {
    if (conferindo) return false;
    conferindo = true;
    try {
      let mudou = false;
      const limite = agora() - DIAS_CONFERINDO * 24 * 60 * 60 * 1000;
      for (const envio of envios) {
        if (envio.status === 'processado' || envio.status === 'erro' || !TIPOS[envio.tipo]) continue;
        if (envio.enviado_em < limite) continue;   // robô nunca pegou: para de olhar
        let novo;
        try { novo = await statusNaPasta(envio); } catch { novo = null; }
        if (!novo || novo === envio.status) continue;
        envio.status = novo;
        if (novo === 'processado' || novo === 'erro') envio.concluido_em = agora();
        mudou = true;
      }
      if (mudou) salvar();
      return mudou;
    } finally { conferindo = false; }
  }

  function estado() {
    const ultimo = tipo => {
      for (let i = envios.length - 1; i >= 0; i--) if (envios[i].tipo === tipo) return { ...envios[i] };
      return null;
    };
    // erros que o usuário ainda não limpou (painel da direita), mais novo primeiro;
    // 'agora' deixa a tela contar os 20 s do erro pelo relógio do servidor
    const erros = envios.filter(e => e.status === 'erro' && !e.limpo).reverse().map(e => ({ ...e }));
    return { extrato: ultimo('extrato'), cartao: ultimo('cartao'), erros, agora: agora() };
  }

  // Usuário já resolveu o erro: some do painel (o envio continua no histórico como 'erro')
  function limparErro(id) {
    const envio = envios.find(e => e.id === id);
    if (!envio || envio.status !== 'erro' || envio.limpo) return false;
    envio.limpo = true;
    salvar();
    return true;
  }

  return { enviar, conferir, estado, limparErro };
}

module.exports = { criarFinanceiro, nomeGravado, TIPOS };
