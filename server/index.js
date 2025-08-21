import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import openaiProxy from './openaiProxy.js';
import { authorize } from './auth/supabaseAuth.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.post('/api/chat', authorize(['admin']), openaiProxy);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
