import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import openaiProxy from './openaiProxy.js';
import { authorize } from './auth/supabaseAuth.js';
import superAdminRoutes from './auth/superAdminRoutes.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.post('/api/chat', authorize(['admin', 'user']), openaiProxy);
app.use('/api/superadmin', superAdminRoutes);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
