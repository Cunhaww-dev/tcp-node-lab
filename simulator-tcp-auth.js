// server TCP cru (sem framework nenhum) para estudar sessions e sniffing.
// Fases 1 a 3: tudo trafega em texto puro DE PROPOSITO, para o token
// aparecer exposto quando voce espionar a rede com o tcpdump.
// "net" e o modulo nativo do Node que faz o papel do ServerSocket do Java.
// "crypto" gera o token de sessao.

const net = require('net');
const crypto = require('crypto');
const os = require('os');

const PORT = 8080;

// "Banco de dados" de sessions guardado so na memoria do processo.
// Guarde isso na cabeca: no Nivel 3, esse Map em memoria e justamente
// o que quebra atras do Load Balancer, cada container tem o seu proprio.
const sessions = new Map();

// Monta uma resposta HTTP simples a partir de um texto.
// Como o cliente de teste e o "curl", o server precisa devolver algo que
// pareca HTTP, mesmo a gente trabalhando no socket cru.
function responseHttp(status, corpo) {
  const bytes = Buffer.byteLength(corpo);
  return (
    `HTTP/1.1 ${status}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `Content-Length: ${bytes}\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    corpo
  );
}

// net.createServer e o equivalente do "new ServerSocket()" do Java.
// A funcao recebe cada conexao nova que chega (o "socket" do cliente).
const server = net.createServer((socket) => {
  socket.on('data', (dados) => {
    const request = dados.toString('utf-8'); // A primeira linha de uma request HTTP e algo tipo: GET /login HTTP/1.1

    const firstLine = request.split('\r\n')[0] || '';
    const [method, path] = firstLine.split(' ');

    // rota de saude: o Load Balancer bate aqui pra checar se o container
    // esta vivo. Sem isso, ele marca o container como unhealthy.
    if (path === '/') {
      socket.end(responseHttp('200 OK', 'ok\n'));
      return;
    }

    if (path === '/login') {
      // Gera um token de sessao e guarda na memoria.
      const token = crypto.randomUUID();
      sessions.set(token, {
        user: 'fabri',
        createdAt: new Date().toISOString(),
      }); // ATENCAO: o token vai no corpo em texto puro. E exatamente por isso
      // que ele vaza no sniffing da Fase 3.

      // hostname mostra QUAL container respondeu, pra voce ver o balanceamento.
      socket.end(
        responseHttp(
          '200 OK',
          `login ok\ntoken=${token}\nhostname=${os.hostname()}\n`,
        ),
      );
      return;
    }

    if (path === '/dashboard') {
      // Area protegida: so entra quem mandar um token valido no cabecalho
      // "Authorization". E aqui que voce simula o roubo de sessao: se copiar o token de outra pessoa, voce entra como ela.
      const lineAuth = request
        .split('\r\n')
        .find((l) => l.toLowerCase().startsWith('authorization:'));
      const token = lineAuth ? lineAuth.split(':')[1].trim() : '';

      const sessao = sessions.get(token);
      if (sessao) {
        socket.end(
          responseHttp(
            '200 OK',
            `area logada de ${sessao.user}\nhostname=${os.hostname()}\n`,
          ),
        );
      } else {
        socket.end(
          responseHttp(
            '401 Unauthorized',
            `token invalido\nhostname=${os.hostname()}\n`,
          ),
        );
      }
      return;
    }

    socket.end(responseHttp('404 Not Found', 'rota nao encontrada\n'));
  }); // Evita que o processo caia quando o curl fecha a conexao de forma abrupta.

  socket.on('error', () => {});
});

// listen com '0.0.0.0' faz o server aceitar conexoes de qualquer IP.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`server ouvindo na porta ${PORT} (${os.hostname()})`);
});
