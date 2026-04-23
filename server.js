const express = require('express');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');
const { applyProduct } = require('./src/database/shop'); // ✅ IMPORTAR AQUI

const app = express();

// Middlewares
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// Servir arquivos HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

app.get('/cancel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'cancel.html'));
});

// Webhook Stripe
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
        console.error(`❌ Erro de webhook: ${err.message}`);
        return res.sendStatus(400);
    }

    console.log(`✅ Webhook recebido: ${event.type}`);

    // PROCESSAR PAGAMENTO COMPLETO
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const { userId, productId, productName, price } = session.metadata;

        console.log(`💳 Processando pagamento: ${userId} - ${productName}`);

        try {
            // ✅ ENTREGAR O PRODUTO AO USUÁRIO
            const result = await applyProduct(userId, productId);

            if (result.success) {
                console.log(`✅ Produto entregue: ${productName} para ${userId}`);
                
                // Notificar Discord com sucesso
                await notifyDiscord(session, true, `✅ Produto entregue automaticamente!`);
            } else {
                console.error(`❌ Erro ao entregar: ${result.error}`);
                
                // Notificar Discord do erro
                await notifyDiscord(session, false, `❌ Erro: ${result.error}`);
            }

        } catch (error) {
            console.error('🔴 Erro ao processar pagamento:', error);
            await notifyDiscord(session, false, `❌ Erro crítico: ${error.message}`);
        }
    }

    // PAGAMENTO FALHOU
    if (event.type === 'charge.failed') {
        const charge = event.data.object;
        console.error(`❌ Pagamento falhou: ${charge.id}`);
        
        await notifyDiscord({
            metadata: {
                userId: charge.metadata?.userId || 'Unknown',
                productName: charge.metadata?.productName || 'Unknown',
                price: (charge.amount / 100).toFixed(2)
            }
        }, false, `❌ Pagamento recusado: ${charge.failure_message}`);
    }

    res.json({ received: true });
});

// Notificar Discord
async function notifyDiscord(session, success = true, customMessage = null) {
    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    
    if (!discordWebhookUrl) {
        console.warn('⚠️ DISCORD_WEBHOOK_URL não configurada');
        return;
    }

    const { userId, productName, price } = session.metadata;

    const embed = {
        color: success ? 0x00FF00 : 0xFF0000,
        title: success ? "✅ Nova Compra" : "❌ Erro na Compra",
        fields: [
            { name: "👤 Usuário", value: userId, inline: true },
            { name: "📦 Produto", value: productName, inline: true },
            { name: "💵 Valor", value: `R$ ${price}`, inline: false },
            { name: "Session ID", value: `\`${session.id}\``, inline: false },
            { 
                name: "Status", 
                value: customMessage || (success ? "✅ Entregue" : "❌ Falha"),
                inline: false 
            }
        ],
        timestamp: new Date(),
        footer: { text: "Zany Shop System" }
    };

    const message = {
        content: success ? `✅ **PAGAMENTO CONFIRMADO**` : `❌ **PAGAMENTO FALHOU**`,
        embeds: [embed]
    };

    try {
        const response = await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });

        if (!response.ok) {
            console.error(`❌ Erro ao notificar Discord: ${response.status}`);
        } else {
            console.log('✅ Discord notificado com sucesso');
        }
    } catch (error) {
        console.error('❌ Erro ao notificar Discord:', error.message);
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        stripe: !!process.env.STRIPE_SECRET_KEY,
        webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
        discord: !!process.env.DISCORD_WEBHOOK_URL
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 Webhook endpoint: /webhook`);
    console.log(`💚 Health check: /health`);
});
