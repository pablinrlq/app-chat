const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mensagemDao = require('./mensagemDao');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Conecta no DynamoDB ao subir o servidor (o chat continua funcionando
// em tempo real mesmo se a conexão falhar — só fica sem histórico)
mensagemDao.conectar();

io.on('connection', (socket) => {

    // Quando um novo usuário digita o nome e entra
    socket.on('usuario_entrou', async (nome) => {
        socket.nomeUsuario = nome || "Anônimo";
        console.log(`${socket.nomeUsuario} conectou-se.`);

        // Envia o histórico (mensagens da última hora) só para quem entrou
        if (mensagemDao.isConectado()) {
            try {
                const historico = await mensagemDao.listarRecentes();
                socket.emit('historico_mensagens', historico);
            } catch (erro) {
                console.error(`Erro ao carregar histórico: ${erro.message}`);
            }
        }

        // Avisa a TODOS os outros (broadcast) que essa pessoa entrou
        socket.broadcast.emit('mensagem_sistema', `${socket.nomeUsuario} entrou no chat.`);
    });

    // Quando recebe uma mensagem de alguém
    socket.on('mensagem_chat', (dados) => {
        // Envia a mensagem (com o nome do remetente) para TODOS os conectados
        io.emit('mensagem_chat', dados);

        // Guarda no DynamoDB (com TTL de 1 hora) sem bloquear o broadcast
        if (mensagemDao.isConectado()) {
            mensagemDao.salvar(dados).catch((erro) => {
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
