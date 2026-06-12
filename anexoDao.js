// DAO de anexos (fotos, áudios e arquivos) — guarda os arquivos num bucket
// S3 privado e gera URLs assinadas temporárias para o front exibir/baixar.
// Segue o mesmo padrão do mensagemDao: singleton e configuração via .env.

require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET_PADRAO = 'chat-anexos-381491935073';
const URL_VALIDADE_SEGUNDOS = 10 * 60;

class AnexoDao {
    constructor() {
        this.clienteS3 = null;
        this.bucket = BUCKET_PADRAO;
    }

    conectar() {
        if (this.clienteS3) return;

        this.bucket = process.env.S3_BUCKET || BUCKET_PADRAO;
        const config = { region: (process.env.AWS_REGION || 'us-east-1').trim() };

        const accessKey = process.env.AWS_ACCESS_KEY_ID;
        const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
        if (accessKey && accessKey.trim() && secretKey && secretKey.trim()) {
            config.credentials = {
                accessKeyId: accessKey.trim(),
                secretAccessKey: secretKey.trim()
            };
        }

        this.clienteS3 = new S3Client(config);
    }

    // Sobe o arquivo para o S3 e devolve a chave gerada
    async enviar(arquivo) {
        this.conectar();

        const nomeLimpo = (arquivo.nome || 'arquivo').replace(/[^\w.\-]+/g, '_').slice(-80);
        const key = `anexos/${crypto.randomUUID()}-${nomeLimpo}`;

        await this.clienteS3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: arquivo.buffer,
            ContentType: arquivo.tipo || 'application/octet-stream'
        }));

        return key;
    }

    // URL assinada de leitura — o bucket é privado, só quem tem a URL acessa,
    // e ela expira sozinha (a assinatura é local, não chama a AWS)
    gerarUrl(key) {
        this.conectar();
        return getSignedUrl(
            this.clienteS3,
            new GetObjectCommand({ Bucket: this.bucket, Key: key }),
            { expiresIn: URL_VALIDADE_SEGUNDOS }
        );
    }

    async excluir(key) {
        this.conectar();
        await this.clienteS3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
}

module.exports = new AnexoDao();
