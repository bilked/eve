const express = require('express');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const path = require('path');

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

    // Aqui você pode enviar uma mensagem para seu Discord webhook
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await notifyDiscord(session);
    }

    res.json({ received: true });
});

// Notificar Discord
async function notifyDiscord(session) {
    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    
    if (!discordWebhookUrl) return;

    const message = {
        content: `✅ **PAGAMENTO CONFIRMADO**`,
        embeds: [{
            color: 0x00FF00,
            title: "💳 Nova Compra",
            fields: [
                { name: "Usuário", value: session.metadata.userId, inline: true },
                { name: "Produto", value: session.metadata.productName, inline: true },
                { name: "Valor", value: `R$ ${session.metadata.price}`, inline: false },
                { name: "Session ID", value: `\`${session.id}\``, inline: false }
            ],
            timestamp: new Date()
        }]
    };

    try {
        await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });
        console.log('✅ Discord notificado');
    } catch (error) {
        console.error('❌ Erro ao notificar Discord:', error);
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});