import express from 'express';

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body));
  if (req.body.events && req.body.events.length > 0) {
    req.body.events.forEach(ev => {
      if (ev.type === 'message' && ev.message.type === 'text') {
        console.log(`📩 User said: ${ev.message.text}`);
      }
    });
  }
  res.status(200).send('OK');  // 不做簽章驗證，固定回 200
});

app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
});
