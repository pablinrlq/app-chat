require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const mensagemDao = require('./mensagemDao');
const anexoDao = require('./anexoDao');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Upload em memória, limitado a 10 MB por arquivo
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Com mais de uma instância atrás de um load balancer, o io.emit só alcança
// os sockets do próprio processo. O adapter de Redis faz o pub/sub entre as
// instâncias. Só ativa se REDIS_URL estiver definida — sem ela, o servidor
// funciona normalmente sozinho.
async function configurarAdapterRedis() {
    const url = process.env.REDIS_URL;
    if (!url) return;

    try {
        const { createClient } = require('redis');
        const { createAdapter } = require('@socket.io/redis-adapter');

        const pubClient = createClient({ url });
        const subClient = pubClient.duplicate();
        pubClient.on('error', (e) => console.error(`Redis (pub): ${e.message}`));
        subClient.on('error', (e) => console.error(`Redis (sub): ${e.message}`));

        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
        console.log('Socket.io com adapter Redis ativo (broadcast entre instâncias).');
    } catch (erro) {
        console.error(`Falha ao ativar o adapter Redis: ${erro.message}`);
    }
}
configurarAdapterRedis();

app.use(express.static('public'));

// Recebe foto/áudio/arquivo do front, guarda no S3 e devolve a chave
app.post('/upload', (req, res) => {
    upload.single('arquivo')(req, res, async (erro) => {
        if (erro) return res.status(400).json({ erro: erro.message });
        if (!req.file) return res.status(400).json({ erro: 'nenhum arquivo enviado' });

        try {
            // multer decodifica o nome como latin1; reverte para UTF-8 (acentos)
            const nome = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
            const key = await anexoDao.enviar({
                buffer: req.file.buffer,
                nome,
                tipo: req.file.mimetype
            });
            res.json({ key, nome, tipo: req.file.mimetype, tamanho: req.file.size });
        } catch (e) {
            console.error(`Erro no upload: ${e.message}`);
            res.status(500).json({ erro: 'falha ao guardar o arquivo' });
        }
    });
});

// Conecta no DynamoDB ao subir o servidor (o chat continua funcionando
// em tempo real mesmo se a conexão falhar — só fica sem histórico)
mensagemDao.conectar();

// De 5 em 5 minutos, apaga fisicamente as mensagens expiradas
// (o TTL nativo do DynamoDB fica como plano B, pois não exclui na hora exata)
const INTERVALO_LIMPEZA = 5 * 60 * 1000;
setInterval(async () => {
    if (!mensagemDao.isConectado()) return;
    try {
        const { excluidas, chavesAnexos } = await mensagemDao.excluirExpiradas();
        // Apaga do S3 os anexos das mensagens que expiraram
        for (const key of chavesAnexos) {
            await anexoDao.excluir(key).catch((e) =>
                console.error(`Erro ao excluir anexo ${key}: ${e.message}`));
        }
        if (excluidas > 0) {
            console.log(`Limpeza: ${excluidas} mensagem(ns) e ${chavesAnexos.length} anexo(s) excluído(s).`);
        }
    } catch (erro) {
        console.error(`Erro na limpeza de mensagens: ${erro.message}`);
    }
}, INTERVALO_LIMPEZA);

io.on('connection', (socket) => {

    // Quando um novo usuário digita o nome e entra
    socket.on('usuario_entrou', async (nome) => {
        socket.nomeUsuario = nome || "Anônimo";
        console.log(`${socket.nomeUsuario} conectou-se.`);

        // Envia o histórico recente só para quem entrou
        if (mensagemDao.isConectado()) {
            try {
                const historico = await mensagemDao.listarRecentes();
                // Anexos: gera URL assinada nova para cada um (a guardada expiraria)
                for (const m of historico) {
                    if (m.anexo && m.anexo.key) {
                        m.url = await anexoDao.gerarUrl(m.anexo.key);
                    }
                }
                socket.emit('historico_mensagens', historico);
            } catch (erro) {
                console.error(`Erro ao carregar histórico: ${erro.message}`);
            }
        }

        // Avisa a TODOS os outros (broadcast) que essa pessoa entrou
        socket.broadcast.emit('mensagem_sistema', `${socket.nomeUsuario} entrou no chat.`);
    });

    // Quando recebe uma mensagem de alguém (texto e/ou anexo)
    socket.on('mensagem_chat', async (dados) => {
        const mensagem = {
            usuario: dados.usuario,
            texto: dados.texto,
            anexo: dados.anexo
        };

        // Se tem anexo, gera a URL assinada que o front usa para exibir
        if (mensagem.anexo && mensagem.anexo.key) {
            try {
                mensagem.url = await anexoDao.gerarUrl(mensagem.anexo.key);
            } catch (erro) {
                console.error(`Erro ao gerar URL do anexo: ${erro.message}`);
            }
        }

        // Envia a mensagem (com o nome do remetente) para TODOS os conectados
        io.emit('mensagem_chat', mensagem);

        // Guarda no DynamoDB (com TTL de 5 minutos) sem bloquear o broadcast
        if (mensagemDao.isConectado()) {
            mensagemDao.salvar(mensagem).catch((erro) => {
                console.error(`Erro ao salvar mensagem: ${erro.message}`);
            });
        }
    });

    // Quando o usuário fecha a aba do navegador
    socket.on('disconnect', () => {
        if (socket.nomeUsuario) {
            console.log(`${socket.nomeUsuario} desconectou-se.`);
            io.emit('mensagem_sistema', `${socket.nomeUsuario} saiu do chat.`);
        }
    });
});

server.listen(8081, () => {
    console.log('Servidor de WebSockets rodando na porta 8081');
});
