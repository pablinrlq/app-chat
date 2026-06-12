const socket = io();

const chatForm = document.getElementById('chat-form');
const inputMsg = document.getElementById('inputMsg');
const mensagensContainer = document.getElementById('mensagens');

// Pergunta o nome do usuário assim que a tela carrega
let meuNome = prompt("Qual é o seu nome?") || "Anônimo";
socket.emit('usuario_entrou', meuNome);

chatForm.addEventListener('submit', function(e) {
    e.preventDefault(); 
    
    const texto = inputMsg.value.trim();
    
    if (texto) {
        // Agora enviamos um objeto com o Nome e o Texto
        socket.emit('mensagem_chat', {
            usuario: meuNome,
            texto: texto
        });
        inputMsg.value = '';
        inputMsg.focus();
    }
});

// Recebe mensagens de usuários
socket.on('mensagem_chat', function(dados) {
    const divMensagem = document.createElement('div');
    
    // Cria o rótulo com o nome do usuário
    const spanNome = document.createElement('div');
    spanNome.className = 'user-name';
    spanNome.textContent = dados.usuario;

    // Cria o texto da mensagem
    const spanTexto = document.createElement('div');
    spanTexto.textContent = dados.texto;

    // Monta a estrutura
    divMensagem.appendChild(spanNome);
    divMensagem.appendChild(spanTexto);
    
    // Verifica se a mensagem é minha ou de outro
    if(dados.usuario === meuNome) {
        divMensagem.className = 'message my-message';
        spanNome.style.display = 'none'; // Esconde meu próprio nome nos meus balões
    } else {
        divMensagem.className = 'message other-message';
    }

    mensagensContainer.appendChild(divMensagem);
    mensagensContainer.scrollTop = mensagensContainer.scrollHeight;
});

// Recebe mensagens do sistema (Entrou/Saiu)
socket.on('mensagem_sistema', function(msg) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = msg;
    
    mensagensContainer.appendChild(div);
    mensagensContainer.scrollTop = mensagensContainer.scrollHeight;
});
