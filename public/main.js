const socket = io();

const chatForm = document.getElementById('chat-form');
const inputMsg = document.getElementById('inputMsg');
const mensagensContainer = document.getElementById('mensagens');
const inputArquivo = document.getElementById('inputArquivo');
const btnAnexo = document.getElementById('btnAnexo');
const btnAudio = document.getElementById('btnAudio');

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

// ---------- Anexos (fotos, áudios e arquivos via S3) ----------

// Sobe o arquivo pro servidor (que guarda no S3) e envia a mensagem com o anexo
async function enviarArquivo(arquivo) {
    btnAnexo.disabled = true;
    btnAudio.disabled = true;
    try {
        const form = new FormData();
        form.append('arquivo', arquivo, arquivo.name);

        const resp = await fetch('/upload', { method: 'POST', body: form });
        if (!resp.ok) {
            const corpo = await resp.json().catch(() => ({}));
            throw new Error(corpo.erro || ('HTTP ' + resp.status));
        }
        const anexo = await resp.json();

        socket.emit('mensagem_chat', {
            usuario: meuNome,
            texto: inputMsg.value.trim(),
            anexo: anexo
        });
        inputMsg.value = '';
    } catch (e) {
        alert('Não consegui enviar o arquivo: ' + e.message);
    } finally {
        btnAnexo.disabled = false;
        btnAudio.disabled = false;
    }
}

btnAnexo.addEventListener('click', () => inputArquivo.click());

inputArquivo.addEventListener('change', async () => {
    const arquivo = inputArquivo.files[0];
    if (arquivo) await enviarArquivo(arquivo);
    inputArquivo.value = '';
});

// Gravação de áudio: clica pra começar, clica de novo pra parar e enviar
// (o navegador só libera o microfone em HTTPS ou localhost)
let gravador = null;

btnAudio.addEventListener('click', async () => {
    if (gravador && gravador.state === 'recording') {
        gravador.stop();
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const pedacos = [];
        gravador = new MediaRecorder(stream);
        gravador.ondataavailable = (e) => pedacos.push(e.data);
        gravador.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            btnAudio.classList.remove('gravando');
            btnAudio.textContent = '🎤';
            const blob = new Blob(pedacos, { type: gravador.mimeType || 'audio/webm' });
            const arquivo = new File([blob], 'audio-' + Date.now() + '.webm', { type: blob.type });
            await enviarArquivo(arquivo);
        };
        gravador.start();
        btnAudio.classList.add('gravando');
        btnAudio.textContent = '⏹';
    } catch (e) {
        alert('Não consegui acessar o microfone: ' + e.message);
    }
});

function renderizarMensagem(dados) {
    const divMensagem = document.createElement('div');

    // Cria o rótulo com o nome do usuário
    const spanNome = document.createElement('div');
    spanNome.className = 'user-name';
    spanNome.textContent = dados.usuario;

    // Monta a estrutura
    divMensagem.appendChild(spanNome);

    // Anexo: imagem, áudio ou link de download (URL assinada do S3)
    if (dados.anexo && dados.url) {
        const tipo = dados.anexo.tipo || '';
        let anexoEl;
        if (tipo.startsWith('image/')) {
            anexoEl = document.createElement('img');
            anexoEl.src = dados.url;
            anexoEl.className = 'anexo-imagem';
            anexoEl.onload = () => { mensagensContainer.scrollTop = mensagensContainer.scrollHeight; };
        } else if (tipo.startsWith('audio/')) {
            anexoEl = document.createElement('audio');
            anexoEl.controls = true;
            anexoEl.src = dados.url;
            anexoEl.className = 'anexo-audio';
        } else {
            anexoEl = document.createElement('a');
            anexoEl.href = dados.url;
            anexoEl.target = '_blank';
            anexoEl.rel = 'noopener';
            anexoEl.className = 'anexo-arquivo';
            anexoEl.textContent = '📄 ' + (dados.anexo.nome || 'arquivo');
        }
        divMensagem.appendChild(anexoEl);
    }

    // Cria o texto da mensagem (se houver)
    if (dados.texto) {
        const spanTexto = document.createElement('div');
        spanTexto.textContent = dados.texto;
        divMensagem.appendChild(spanTexto);
    }

    // Verifica se a mensagem é minha ou de outro
    if(dados.usuario === meuNome) {
        divMensagem.className = 'message my-message';
        spanNome.style.display = 'none'; // Esconde meu próprio nome nos meus balões
    } else {
        divMensagem.className = 'message other-message';
    }

    mensagensContainer.appendChild(divMensagem);
    mensagensContainer.scrollTop = mensagensContainer.scrollHeight;
}

// Recebe mensagens de usuários
socket.on('mensagem_chat', renderizarMensagem);

// Recebe o histórico (mensagens da última hora) ao entrar no chat
socket.on('historico_mensagens', function(lista) {
    lista.forEach(renderizarMensagem);
});

// Recebe mensagens do sistema (Entrou/Saiu)
socket.on('mensagem_sistema', function(msg) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = msg;
    
    mensagensContainer.appendChild(div);
    mensagensContainer.scrollTop = mensagensContainer.scrollHeight;
});
