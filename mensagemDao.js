// DAO de mensagens do chat — baseado na estrutura do RecursoNuvemDao (Java):
// singleton, conectar() lendo .env, criação automática da tabela (PAY_PER_REQUEST)
// e suporte a DynamoDB Local via DYNAMODB_ENDPOINT.
// As mensagens recebem um TTL de 1 hora (atributo "expiraEm") e o DynamoDB
// as exclui automaticamente após expirar.

require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const {
    DynamoDBClient,
    DescribeTableCommand,
    CreateTableCommand,
    DescribeTimeToLiveCommand,
    UpdateTimeToLiveCommand,
    waitUntilTableExists,
    ResourceNotFoundException
} = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

const TABELA_PADRAO = 'MensagensChat';
const TTL_SEGUNDOS = 60 * 60; // 1 hora

class MensagemDao {
    constructor() {
        this.clienteDynamo = null;
        this.documento = null;
        this.nomeTabela = TABELA_PADRAO;
        this.conectado = false;
        this.tentouConectar = false;
        this.contaAws = null;
        this.regiao = null;
        this.origemCredenciais = null;
        this.erroConexao = null;
    }

    async conectar() {
        if (this.tentouConectar) return this.conectado;
        this.tentouConectar = true;

        try {
            const accessKey = process.env.AWS_ACCESS_KEY_ID;
            const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
            const regiaoEnv = process.env.AWS_REGION;
            const endpointLocal = process.env.DYNAMODB_ENDPOINT;
            this.nomeTabela = process.env.DYNAMODB_TABLE || TABELA_PADRAO;

            this.regiao = (regiaoEnv && regiaoEnv.trim()) || 'us-east-1';

            const config = { region: this.regiao };

            if (accessKey && accessKey.trim() && secretKey && secretKey.trim()) {
                config.credentials = {
                    accessKeyId: accessKey.trim(),
                    secretAccessKey: secretKey.trim()
                };
                this.origemCredenciais = '.env / variáveis de ambiente';
            } else {
                // Sem chaves explícitas, o SDK usa a cadeia padrão (IAM role / ~/.aws)
                this.origemCredenciais = 'cadeia padrão do SDK (IAM role / ~/.aws)';
            }

            if (endpointLocal && endpointLocal.trim()) {
                config.endpoint = endpointLocal.trim();
                this.contaAws = `DynamoDB Local (${endpointLocal.trim()})`;
            }

            this.clienteDynamo = new DynamoDBClient(config);
            this.documento = DynamoDBDocumentClient.from(this.clienteDynamo);

            if (!this.contaAws) {
                const sts = new STSClient(config);
                const identidade = await sts.send(new GetCallerIdentityCommand({}));
                this.contaAws = identidade.Account;
                sts.destroy();
            }

            await this.criarTabelaSeNaoExistir();
            await this.habilitarTtlSeNecessario();

            this.conectado = true;
            console.log(`DynamoDB conectado | conta: ${this.contaAws} | região: ${this.regiao} | tabela: ${this.nomeTabela} | credenciais: ${this.origemCredenciais}`);
        } catch (erro) {
            this.conectado = false;
            this.erroConexao = erro.message;
            console.error(`Falha ao conectar no DynamoDB: ${erro.message}`);
        }

        return this.conectado;
    }

    async reconectar() {
        this.tentouConectar = false;
        this.conectado = false;
        this.erroConexao = null;
        return this.conectar();
    }

    async criarTabelaSeNaoExistir() {
        try {
            await this.clienteDynamo.send(new DescribeTableCommand({ TableName: this.nomeTabela }));
        } catch (erro) {
            if (!(erro instanceof ResourceNotFoundException)) throw erro;

            await this.clienteDynamo.send(new CreateTableCommand({
                TableName: this.nomeTabela,
                AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
                KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
                BillingMode: 'PAY_PER_REQUEST'
            }));

            await waitUntilTableExists(
                { client: this.clienteDynamo, maxWaitTime: 60 },
                { TableName: this.nomeTabela }
            );
        }
    }

    async habilitarTtlSeNecessario() {
        const status = await this.clienteDynamo.send(
            new DescribeTimeToLiveCommand({ TableName: this.nomeTabela })
        );
        const situacao = status.TimeToLiveDescription && status.TimeToLiveDescription.TimeToLiveStatus;
        if (situacao === 'ENABLED' || situacao === 'ENABLING') return;

        await this.clienteDynamo.send(new UpdateTimeToLiveCommand({
            TableName: this.nomeTabela,
            TimeToLiveSpecification: { AttributeName: 'expiraEm', Enabled: true }
        }));
    }

    async salvar(mensagem) {
        const agora = Math.floor(Date.now() / 1000);
        const item = {
            id: crypto.randomUUID(),
            usuario: mensagem.usuario || 'Anônimo',
            texto: mensagem.texto,
            enviadaEm: agora,
            expiraEm: agora + TTL_SEGUNDOS
        };
        await this.documento.send(new PutCommand({ TableName: this.nomeTabela, Item: item }));
        return item;
    }

    // O TTL do DynamoDB não exclui no segundo exato da expiração, então
    // mensagens já expiradas (mas ainda não removidas) são filtradas aqui.
    async listarRecentes() {
        const agora = Math.floor(Date.now() / 1000);
        const itens = [];
        let chaveInicial;

        do {
            const pagina = await this.documento.send(new ScanCommand({
                TableName: this.nomeTabela,
                FilterExpression: 'expiraEm > :agora',
                ExpressionAttributeValues: { ':agora': agora },
                ExclusiveStartKey: chaveInicial
            }));
            itens.push(...(pagina.Items || []));
            chaveInicial = pagina.LastEvaluatedKey;
        } while (chaveInicial);

        return itens.sort((a, b) => a.enviadaEm - b.enviadaEm);
    }

    isConectado() { return this.conectado; }
    getContaAws() { return this.contaAws; }
    getRegiao() { return this.regiao; }
    getNomeTabela() { return this.nomeTabela; }
    getOrigemCredenciais() { return this.origemCredenciais; }
    getErroConexao() { return this.erroConexao; }
}

const INSTANCIA = new MensagemDao();
module.exports = INSTANCIA;
