const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    
    // Quando um novo usuário digita o nome e entra
    socket.on('usuario_entrou', (nome) => {
        socket.nomeUsuario = nome || "Anônimo";
        console.log(`${socket.nomeUsuario} conectou-se.`);
        
        // Avisa a TODOS os outros (broadcast) que essa pessoa entrou
        socket.broadcast.emit('mensagem_sistema', `${socket.nomeUsuario} entrou no chat.`);
    });
    
    // Quando recebe uma mensagem de alguém
    socket.on('mensagem_chat', (dados) => {
        // Envia a mensagem (com o nome do remetente) para TODOS os conectados
        io.emit('mensagem_chat', dados);
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
